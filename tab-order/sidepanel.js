import {
  CLASSIFICATION_MODES,
  DEFAULT_CATEGORY_RULES,
  DEFAULT_CLASSIFICATION_MODE,
  classifyTab,
  findDuplicateTabIds,
  getCategoriesForTabs,
  getCategoryRules,
  getHostname,
  getRecentClosedTabs,
  isManageableTab,
  matchesSearch,
  normalizeClassificationMode,
  validateCategoryRules
} from "./core.js";

const DEFAULT_SETTINGS = {
  autoOrganize: true,
  collapseInactive: true,
  minimumTabs: 6,
  categoryRules: null,
  classificationMode: DEFAULT_CLASSIFICATION_MODE
};
const GROUP_COLORS = {
  blue: "#4f7ed8", cyan: "#1e9eb7", green: "#399267", purple: "#8559ba",
  red: "#d9534f", yellow: "#d59b27", orange: "#d87436", grey: "#89938c",
  pink: "#c85c8e"
};
const state = {
  tabs: [],
  query: "",
  collapsed: new Set(),
  settings: DEFAULT_SETTINGS,
  categoryRules: DEFAULT_CATEGORY_RULES
};
const $ = (selector) => document.querySelector(selector);
let toastTimer;

async function initialize() {
  bindEvents();
  state.settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  state.settings.classificationMode = normalizeClassificationMode(state.settings.classificationMode);
  state.categoryRules = getCategoryRules(state.settings.categoryRules);
  $("#autoOrganize").checked = state.settings.autoOrganize;
  $("#collapseInactive").checked = state.settings.collapseInactive;
  document.querySelector(`input[name="classificationMode"][value="${state.settings.classificationMode}"]`).checked = true;
  renderRulesEditor(state.categoryRules);
  updateStatus();
  await refresh();
}

function bindEvents() {
  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderTabs();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== $("#searchInput")) {
      event.preventDefault();
      $("#searchInput").focus();
    }
    if (event.key === "Escape" && document.activeElement === $("#searchInput")) {
      $("#searchInput").value = "";
      state.query = "";
      renderTabs();
      $("#searchInput").blur();
    }
  });
  $("#organizeButton").addEventListener("click", organizeNow);
  $("#duplicatesButton").addEventListener("click", closeDuplicates);
  $("#recentToggle").addEventListener("click", toggleRecent);
  $("#settingsButton").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
  $("#settingsDialog").addEventListener("click", (event) => {
    if (event.target === $("#settingsDialog")) $("#settingsDialog").close();
  });
  $("#autoOrganize").addEventListener("change", saveSettings);
  $("#collapseInactive").addEventListener("change", saveSettings);
  document.querySelectorAll('input[name="classificationMode"]').forEach((input) => {
    input.addEventListener("change", changeClassificationMode);
  });
  $("#saveRules").addEventListener("click", saveCategoryRules);
  $("#resetRules").addEventListener("click", () => renderRulesEditor(DEFAULT_CATEGORY_RULES));
  $("#syncGroupsButton").addEventListener("click", syncBrowserGroups);
  chrome.tabs.onCreated.addListener(refresh);
  chrome.tabs.onRemoved.addListener(refresh);
  chrome.tabs.onUpdated.addListener(refresh);
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabGroups.onUpdated.addListener(refresh);
}

async function refresh() {
  state.tabs = await chrome.tabs.query({ currentWindow: true });
  renderTabs();
}

function renderTabs() {
  const manageable = state.tabs.filter(isManageableTab);
  const visible = manageable.filter((tab) => matchesSearch(tab, state.query));
  const mode = state.settings.classificationMode;
  const categories = getCategoriesForTabs(visible, state.categoryRules, mode);
  const populatedCategories = categories.filter((category) =>
    visible.some((tab) => classifyTab(tab, state.categoryRules, mode) === category.id)
  );
  const duplicates = findDuplicateTabIds(manageable);
  $("#tabCount").textContent = manageable.length;
  $("#resultCount").textContent = state.query
    ? `${visible.length} 个结果`
    : `${populatedCategories.length} 个分类`;
  $("#duplicateText").textContent = duplicates.length ? `${duplicates.length} 个可清理` : "没有重复页面";
  $("#duplicatesButton").disabled = duplicates.length === 0;

  const container = $("#tabGroups");
  container.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.query ? "没有匹配的标签页" : "当前窗口没有可管理的标签页";
    container.append(empty);
    return;
  }

  for (const category of populatedCategories) {
    const tabs = visible.filter((tab) => classifyTab(tab, state.categoryRules, mode) === category.id);
    if (!tabs.length) continue;
    container.append(createGroup(category, tabs));
  }
}

function createGroup(category, tabs) {
  const group = document.createElement("section");
  group.className = `group${state.collapsed.has(category.id) ? " collapsed" : ""}`;
  group.style.setProperty("--group-color", GROUP_COLORS[category.color] || GROUP_COLORS.grey);

  const header = document.createElement("button");
  header.type = "button";
  header.className = "group-header";
  header.setAttribute("aria-expanded", String(!state.collapsed.has(category.id)));
  header.innerHTML = `<span class="group-dot"></span><span class="group-name"></span><span class="group-count"></span><svg><use href="icons.svg#chevron"></use></svg>`;
  header.querySelector(".group-name").textContent = category.label;
  header.querySelector(".group-count").textContent = tabs.length;
  header.addEventListener("click", () => {
    if (state.collapsed.has(category.id)) state.collapsed.delete(category.id);
    else state.collapsed.add(category.id);
    renderTabs();
  });

  const list = document.createElement("div");
  list.className = "tab-list";
  tabs.sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  tabs.forEach((tab) => list.append(createTabRow(tab)));
  group.append(header, list);
  return group;
}

function createTabRow(tab) {
  const row = document.createElement("div");
  row.className = `tab-row${tab.active ? " active" : ""}`;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `切换到 ${tab.title || "未命名标签页"}`);

  const host = getHostname(tab.url);
  if (tab.favIconUrl) {
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = tab.favIconUrl;
    favicon.alt = "";
    favicon.addEventListener("error", () => favicon.replaceWith(createFaviconFallback(host)));
    row.append(favicon);
  } else {
    row.append(createFaviconFallback(host));
  }

  const copy = document.createElement("span");
  copy.className = "tab-copy";
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.title || "未命名标签页";
  const hostname = document.createElement("span");
  hostname.className = "tab-host";
  hostname.textContent = host || tab.url;
  copy.append(title, hostname);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "close-tab";
  close.title = "关闭标签页";
  close.setAttribute("aria-label", "关闭标签页");
  close.innerHTML = `<svg><use href="icons.svg#x"></use></svg>`;
  close.addEventListener("click", async (event) => {
    event.stopPropagation();
    await chrome.tabs.remove(tab.id);
  });
  const activate = () => chrome.tabs.update(tab.id, { active: true });
  row.addEventListener("click", activate);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") activate();
  });
  row.append(copy, close);
  return row;
}

function createFaviconFallback(host) {
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = (host || "?").charAt(0);
  return fallback;
}

async function organizeNow() {
  const current = await chrome.windows.getCurrent();
  const result = await chrome.runtime.sendMessage({ type: "organize", windowId: current.id });
  if (!result?.ok) {
    showToast("整理失败，请稍后重试");
    return;
  }
  showToast(result.groupCount ? `已整理为 ${result.groupCount} 个标签组` : "当前标签已经很整齐");
  await refresh();
}

async function closeDuplicates() {
  const duplicateIds = findDuplicateTabIds(state.tabs);
  if (!duplicateIds.length) return;
  await chrome.tabs.remove(duplicateIds);
  showToast(`已关闭 ${duplicateIds.length} 个重复页面`);
  await refresh();
}

async function toggleRecent() {
  const toggle = $("#recentToggle");
  const list = $("#recentList");
  const expanded = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!expanded));
  list.hidden = expanded;
  if (!expanded) await renderRecent();
}

async function renderRecent() {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  const list = $("#recentList");
  list.replaceChildren();
  const tabs = getRecentClosedTabs(sessions, 15);
  if (!tabs.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无可恢复的页面";
    list.append(empty);
    return;
  }
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.innerHTML = `<svg><use href="icons.svg#rotate"></use></svg><span class="recent-copy"><b></b><small></small></span>`;
    button.querySelector("b").textContent = tab.title || "未命名标签页";
    button.querySelector("small").textContent = getHostname(tab.url) || tab.url;
    button.addEventListener("click", async () => {
      await chrome.sessions.restore(tab.sessionId);
      showToast("已恢复标签页");
      await renderRecent();
    });
    list.append(button);
  }
}

async function saveSettings() {
  state.settings = {
    ...state.settings,
    autoOrganize: $("#autoOrganize").checked,
    collapseInactive: $("#collapseInactive").checked
  };
  await chrome.storage.local.set(state.settings);
  updateStatus();
}

function renderRulesEditor(rules) {
  const editor = $("#categoryRulesEditor");
  editor.replaceChildren();
  const mode = state.settings.classificationMode;
  const isDomainMode = mode === CLASSIFICATION_MODES.DOMAIN;
  const isTitleMode = mode === CLASSIFICATION_MODES.TITLE;
  $("#rulesTitle").textContent = isDomainMode
    ? "网站域名分类"
    : isTitleMode ? "分类与标题词" : "分类与域名";
  $("#rulesDescription").textContent = isDomainMode
    ? "相同网站域名自动归为一组，无需配置规则。"
    : isTitleMode
      ? "标题词用逗号或换行分隔，仅匹配页面标题。"
      : "域名用逗号或换行分隔，自动包含其子域名。";
  editor.hidden = isDomainMode;
  $("#resetRules").hidden = isDomainMode;
  $("#saveRules").hidden = isDomainMode;
  $("#saveRules").textContent = isTitleMode ? "保存标题规则" : "保存域名规则";
  if (isDomainMode) return;

  const field = isTitleMode ? "keywords" : "domains";
  const valueLabel = isTitleMode ? "标题词" : "域名列表";
  const placeholder = isTitleMode ? "项目, 会议, dashboard" : "example.com, docs.example.com";

  for (const category of rules) {
    const item = document.createElement("div");
    item.className = "rule-item";
    item.dataset.categoryId = category.id;
    item.innerHTML = `
      <div class="rule-name-row">
        <span class="rule-color"></span>
        <input class="rule-name" type="text" maxlength="12" />
      </div>
      <textarea class="rule-values" rows="2"></textarea>
    `;
    item.style.setProperty("--rule-color", GROUP_COLORS[category.color] || GROUP_COLORS.grey);
    const nameInput = item.querySelector(".rule-name");
    const valuesInput = item.querySelector(".rule-values");
    nameInput.value = category.label;
    nameInput.setAttribute("aria-label", `${category.label}分类名称`);
    valuesInput.value = category[field].join(", ");
    valuesInput.placeholder = placeholder;
    valuesInput.setAttribute("aria-label", `${category.label}${valueLabel}`);
    editor.append(item);
  }
}

function collectCategoryRules() {
  const mode = state.settings.classificationMode;
  const field = mode === CLASSIFICATION_MODES.TITLE ? "keywords" : "domains";
  return [...document.querySelectorAll(".rule-item")].map((item) => {
    const current = state.categoryRules.find((category) => category.id === item.dataset.categoryId);
    return {
      ...current,
      label: item.querySelector(".rule-name").value.trim(),
      [field]: item.querySelector(".rule-values").value
        .split(/[\n,，;；]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    };
  });
}

async function saveCategoryRules() {
  const mode = state.settings.classificationMode;
  const draft = collectCategoryRules();
  const error = validateCategoryRules(draft, mode);
  if (error) {
    showToast(error);
    return;
  }

  state.categoryRules = getCategoryRules(draft);
  state.settings = { ...state.settings, categoryRules: state.categoryRules };
  await chrome.storage.local.set({ categoryRules: state.categoryRules });
  renderRulesEditor(state.categoryRules);
  renderTabs();

  const current = await chrome.windows.getCurrent();
  const result = await chrome.runtime.sendMessage({ type: "organize", windowId: current.id });
  showToast(result?.ok ? "分类设置已保存" : "设置已保存，标签组稍后更新");
  await refresh();
}

async function changeClassificationMode(event) {
  const mode = normalizeClassificationMode(event.target.value);
  state.settings = { ...state.settings, classificationMode: mode };
  await chrome.storage.local.set({ classificationMode: mode });
  renderRulesEditor(state.categoryRules);
  renderTabs();

  const current = await chrome.windows.getCurrent();
  const result = await chrome.runtime.sendMessage({ type: "organize", windowId: current.id });
  $("#syncGroupsButton").classList.add("attention");
  showToast(result?.ok ? "分类方式已切换，可同步顶部标签组" : "分类方式已保存，请同步顶部标签组");
  await refresh();
}

async function syncBrowserGroups() {
  const button = $("#syncGroupsButton");
  button.disabled = true;
  button.classList.add("syncing");
  try {
    const current = await chrome.windows.getCurrent();
    const result = await chrome.runtime.sendMessage({
      type: "organize",
      windowId: current.id,
      rebuild: true
    });
    if (!result?.ok) {
      showToast("同步失败，请稍后重试");
      return;
    }
    button.classList.remove("attention");
    showToast(result.groupCount ? `顶部标签组已同步：${result.groupCount} 组` : "当前没有需要同步的标签组");
    await refresh();
  } finally {
    button.disabled = false;
    button.classList.remove("syncing");
  }
}

function updateStatus() {
  const status = $("#statusText");
  status.classList.toggle("off", !state.settings.autoOrganize);
  status.lastChild.textContent = state.settings.autoOrganize ? " 已自动整理" : " 自动整理已暂停";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

initialize().catch(() => showToast("无法读取标签页，请重新打开侧边栏"));
