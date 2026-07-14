import {
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CLASSIFICATION_MODE,
  classifyTab,
  findRebuildableGroupIds,
  getCategoriesForTabs,
  getCategoryRules,
  isManageableTab,
  normalizeClassificationMode
} from "./core.js";

const DEFAULT_SETTINGS = {
  autoOrganize: true,
  collapseInactive: true,
  minimumTabs: 6,
  categoryRules: null,
  classificationMode: DEFAULT_CLASSIFICATION_MODE
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
    organizeWindow(message.windowId, true, Boolean(message.rebuild))
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

async function organizeWindow(windowId, force = false, rebuild = false) {
  const settings = await chrome.storage.local.get({
    ...DEFAULT_SETTINGS,
    managedGroupRecords: []
  });
  if (!force && !settings.autoOrganize) return { groupCount: 0 };
  const categoryRules = getCategoryRules(settings.categoryRules);
  const classificationMode = normalizeClassificationMode(settings.classificationMode);

  let tabs = await chrome.tabs.query({ windowId });
  let manageable = tabs.filter(isManageableTab);
  if (!force && manageable.length < settings.minimumTabs) return { groupCount: 0 };

  let groups = await chrome.tabGroups.query({ windowId });
  const storedGroups = await chrome.storage.session.get({ managedGroups: [], managedGroupIds: [] });
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const records = new Map();
  for (const record of storedGroups.managedGroups) {
    if (groupsById.has(record.id)) records.set(record.id, record.categoryId);
  }
  for (const record of settings.managedGroupRecords) {
    const group = groupsById.get(record.id);
    if (
      group &&
      record.title === group.title &&
      (!record.color || record.color === group.color)
    ) records.set(record.id, record.categoryId);
  }
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

  let reclaimedCount = 0;
  if (rebuild) {
    const detectedIds = new Set([
      ...records.keys(),
      ...findRebuildableGroupIds(
        manageable,
        groups,
        settings.managedGroupRecords,
        categoryRules
      )
    ]);
    const rebuildTabIds = manageable
      .filter((tab) => detectedIds.has(tab.groupId))
      .map((tab) => tab.id);
    if (rebuildTabIds.length) {
      await chrome.tabs.ungroup(rebuildTabIds);
      reclaimedCount = detectedIds.size;
      detectedIds.forEach((groupId) => records.delete(groupId));
      tabs = await chrome.tabs.query({ windowId });
      manageable = tabs.filter(isManageableTab);
      groups = await chrome.tabGroups.query({ windowId });
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
      return managed && classifyTab(tab, categoryRules, classificationMode) !== managed.categoryId;
    })
    .map((tab) => tab.id);
  if (misplacedIds.length) {
    await chrome.tabs.ungroup(misplacedIds);
    tabs = await chrome.tabs.query({ windowId });
    manageable = tabs.filter(isManageableTab);
  }
  const activeTab = tabs.find((tab) => tab.active);
  const activeCategory = activeTab
    ? classifyTab(activeTab, categoryRules, classificationMode)
    : null;
  const categories = getCategoriesForTabs(manageable, categoryRules, classificationMode);
  let groupCount = 0;

  for (const category of categories) {
    const existing = managedGroups.get(category.id);
    const candidates = manageable.filter((tab) => {
      if (classifyTab(tab, categoryRules, classificationMode) !== category.id) return false;
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

  const liveGroups = await chrome.tabGroups.query({});
  const liveGroupsById = new Map(liveGroups.map((group) => [group.id, group]));
  await chrome.storage.session.set({
    managedGroups: [...records]
      .filter(([groupId]) => liveGroupsById.has(groupId))
      .map(([id, categoryId]) => ({ id, categoryId })),
    managedGroupIds: []
  });
  await chrome.storage.local.set({
    managedGroupRecords: [...records]
      .filter(([groupId]) => liveGroupsById.has(groupId))
      .map(([id, categoryId]) => ({
        id,
        categoryId,
        title: liveGroupsById.get(id).title || "",
        color: liveGroupsById.get(id).color
      }))
  });
  return { groupCount, reclaimedCount };
}
