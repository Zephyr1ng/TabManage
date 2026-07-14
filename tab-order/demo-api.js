(() => {
  if (globalThis.chrome?.tabs || !new URLSearchParams(location.search).has("demo")) return;

  let settings = {
    autoOrganize: true,
    collapseInactive: true,
    minimumTabs: 6,
    categoryRules: null,
    classificationMode: "customDomain"
  };
  let mockTabs = [
    { id: 1, title: "产品迭代看板 - 飞书", url: "https://example.feishu.cn/base/plan", active: true, pinned: false, lastAccessed: 90 },
    { id: 2, title: "Q3 用户访谈记录", url: "https://www.notion.so/interviews", active: false, pinned: false, lastAccessed: 80 },
    { id: 3, title: "openai/codex: Lightweight coding agent", url: "https://github.com/openai/codex", active: false, pinned: false, lastAccessed: 70 },
    { id: 4, title: "Tabs API - Chrome for Developers", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs", active: false, pinned: false, lastAccessed: 65 },
    { id: 5, title: "侧边栏交互稿 - Figma", url: "https://www.figma.com/design/sidebar", active: false, pinned: false, lastAccessed: 50 },
    { id: 6, title: "收件箱 (12) - Gmail", url: "https://mail.google.com/mail/u/0/#inbox", active: false, pinned: false, lastAccessed: 40 },
    { id: 7, title: "如何设计更好的浏览器工具", url: "https://sspai.com/post/88888", active: false, pinned: false, lastAccessed: 30 },
    { id: 8, title: "B站稍后再看", url: "https://www.bilibili.com/watchlater", active: false, pinned: false, lastAccessed: 20 },
    { id: 9, title: "Tabs API - Chrome for Developers", url: "https://developer.chrome.com/docs/extensions/reference/api/tabs?utm_source=demo", active: false, pinned: false, lastAccessed: 10 }
  ];
  const noopEvent = { addListener() {} };

  globalThis.chrome = {
    tabs: {
      query: async () => mockTabs,
      update: async (id) => { mockTabs = mockTabs.map((tab) => ({ ...tab, active: tab.id === id })); },
      remove: async (ids) => { const removeIds = new Set(Array.isArray(ids) ? ids : [ids]); mockTabs = mockTabs.filter((tab) => !removeIds.has(tab.id)); },
      onCreated: noopEvent,
      onRemoved: noopEvent,
      onUpdated: noopEvent,
      onActivated: noopEvent
    },
    tabGroups: { onUpdated: noopEvent },
    windows: { getCurrent: async () => ({ id: 1 }) },
    runtime: { sendMessage: async () => ({ ok: true, groupCount: 5 }) },
    sessions: {
      getRecentlyClosed: async () => Array.from({ length: 18 }, (_, index) => ({
        tab: {
          sessionId: `demo-${index + 1}`,
          title: index === 0 ? "刚刚关闭的产品方案" : `最近关闭的页面 ${index + 1}`,
          url: `https://${index === 0 ? "docs.example.com" : `site-${index + 1}.example.com`}/page`
        },
        lastModified: 1000 - index
      })),
      restore: async () => ({})
    },
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...settings }),
        set: async (next) => { settings = { ...settings, ...next }; }
      }
    }
  };
})();
