import { DEFAULT_CATEGORY_RULES, classifyTab, getCategoryRules, isManageableTab } from "./core.js";

const DEFAULT_SETTINGS = {
  autoOrganize: true,
  collapseInactive: true,
  minimumTabs: 6,
  categoryRules: null
};
const pendingWindows = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(stored);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const current = await chrome.windows.getCurrent();
  scheduleOrganize(current.id, 300);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onCreated.addListener((tab) => scheduleOrganize(tab.windowId));
chrome.tabs.onRemoved.addListener((_tabId, info) => scheduleOrganize(info.windowId));
chrome.tabs.onMoved.addListener((_tabId, info) => scheduleOrganize(info.windowId));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) scheduleOrganize(tab.windowId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "organize") {
    organizeWindow(message.windowId, true)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

function scheduleOrganize(windowId, delay = 900) {
  if (!windowId || windowId === chrome.windows.WINDOW_ID_NONE) return;
  clearTimeout(pendingWindows.get(windowId));
  pendingWindows.set(windowId, setTimeout(() => {
    pendingWindows.delete(windowId);
    organizeWindow(windowId).catch(() => {});
  }, delay));
}

async function organizeWindow(windowId, force = false) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!force && !settings.autoOrganize) return { groupCount: 0 };
  const categoryRules = getCategoryRules(settings.categoryRules);

  let tabs = await chrome.tabs.query({ windowId });
  let manageable = tabs.filter(isManageableTab);
  if (!force && manageable.length < settings.minimumTabs) return { groupCount: 0 };

  const groups = await chrome.tabGroups.query({ windowId });
  const storedGroups = await chrome.storage.session.get({ managedGroups: [], managedGroupIds: [] });
  const records = new Map(storedGroups.managedGroups.map((record) => [record.id, record.categoryId]));
  const labelsByCategory = new Map(
    categoryRules.flatMap((category) => {
      const defaultLabel = DEFAULT_CATEGORY_RULES.find((item) => item.id === category.id)?.label;
      return [[category.label, category.id], [defaultLabel, category.id]];
    })
  );
  for (const group of groups) {
    if (!records.has(group.id) && storedGroups.managedGroupIds.includes(group.id)) {
      const categoryId = labelsByCategory.get(group.title);
      if (categoryId) records.set(group.id, categoryId);
    }
  }
  const managedGroups = new Map(
    groups
      .filter((group) => records.has(group.id))
      .map((group) => [records.get(group.id), group])
  );
  const managedGroupById = new Map(
    [...managedGroups.entries()].map(([categoryId, group]) => [group.id, { categoryId, group }])
  );
  const misplacedIds = manageable
    .filter((tab) => {
      const managed = managedGroupById.get(tab.groupId);
      return managed && classifyTab(tab, categoryRules) !== managed.categoryId;
    })
    .map((tab) => tab.id);
  if (misplacedIds.length) {
    await chrome.tabs.ungroup(misplacedIds);
    tabs = await chrome.tabs.query({ windowId });
    manageable = tabs.filter(isManageableTab);
  }
  const activeTab = tabs.find((tab) => tab.active);
  const activeCategory = activeTab ? classifyTab(activeTab, categoryRules) : null;
  let groupCount = 0;

  for (const category of categoryRules) {
    const existing = managedGroups.get(category.id);
    const candidates = manageable.filter((tab) => {
      if (classifyTab(tab, categoryRules) !== category.id) return false;
      return tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE || tab.groupId === existing?.id;
    });

    if (candidates.length < 2 && !existing) continue;
    if (candidates.length >= 2 || (existing && candidates.length >= 1)) {
      const groupId = await chrome.tabs.group({
        tabIds: candidates.map((tab) => tab.id),
        ...(existing ? { groupId: existing.id } : { createProperties: { windowId } })
      });
      const collapsed = settings.collapseInactive && category.id !== activeCategory;
      await chrome.tabGroups.update(groupId, {
        title: category.label,
        color: category.color,
        collapsed
      });
      records.set(groupId, category.id);
      groupCount += 1;
    }
  }

  const liveGroupIds = new Set((await chrome.tabGroups.query({})).map((group) => group.id));
  await chrome.storage.session.set({
    managedGroups: [...records]
      .filter(([groupId]) => liveGroupIds.has(groupId))
      .map(([id, categoryId]) => ({ id, categoryId })),
    managedGroupIds: []
  });
  return { groupCount };
}
