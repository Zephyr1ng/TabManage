const CATEGORY_DEFINITIONS = [
  { id: "work", label: "工作", color: "blue" },
  { id: "dev", label: "开发", color: "cyan" },
  { id: "docs", label: "文档", color: "green" },
  { id: "social", label: "沟通", color: "purple" },
  { id: "media", label: "影音", color: "red" },
  { id: "shopping", label: "购物", color: "yellow" },
  { id: "reading", label: "阅读", color: "orange" },
  { id: "other", label: "其他", color: "grey" }
];

const DEFAULT_DOMAIN_RULES = {
  work: [
    "feishu.cn", "larksuite.com", "dingtalk.com", "notion.so", "airtable.com",
    "trello.com", "asana.com", "monday.com", "figma.com", "miro.com"
  ],
  dev: [
    "github.com", "gitlab.com", "gitee.com", "stackoverflow.com", "npmjs.com",
    "vercel.com", "netlify.com", "localhost", "127.0.0.1", "codepen.io", "replit.com"
  ],
  docs: [
    "docs.google.com", "drive.google.com", "office.com", "yuque.com", "wolai.com",
    "shimo.im", "dropbox.com", "icloud.com"
  ],
  social: [
    "mail.google.com", "outlook.live.com", "outlook.office.com", "slack.com", "discord.com",
    "web.telegram.org", "web.whatsapp.com", "weibo.com", "zhihu.com", "x.com", "twitter.com"
  ],
  media: [
    "youtube.com", "bilibili.com", "vimeo.com", "iqiyi.com", "youku.com", "mgtv.com",
    "music.163.com", "spotify.com", "podcasts.apple.com", "douyin.com"
  ],
  shopping: [
    "taobao.com", "tmall.com", "jd.com", "amazon.com", "amazon.cn", "pinduoduo.com",
    "suning.com", "smzdm.com", "ebay.com"
  ],
  reading: [
    "medium.com", "substack.com", "sspai.com", "36kr.com", "thepaper.cn", "nytimes.com",
    "bbc.com", "cnn.com", "news.google.com", "readhub.cn", "juejin.cn"
  ]
};

export const DEFAULT_CATEGORY_RULES = CATEGORY_DEFINITIONS.map((category) => ({
  ...category,
  domains: [...(DEFAULT_DOMAIN_RULES[category.id] || [])]
}));

const TITLE_RULES = {
  work: ["项目", "任务", "看板", "会议", "dashboard", "project", "calendar"],
  dev: ["api", "developer", "代码", "仓库", "console", "documentation", "reference"],
  docs: ["文档", "表格", "演示文稿", "document", "spreadsheet", "presentation"],
  social: ["邮箱", "收件箱", "消息", "mail", "inbox", "chat"],
  media: ["视频", "直播", "音乐", "video", "watch", "playlist"],
  shopping: ["购物", "商品", "订单", "shop", "cart", "product"],
  reading: ["新闻", "博客", "文章", "news", "blog", "article"]
};

export function getHostname(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isManageableTab(tab) {
  if (!tab || tab.pinned || !tab.url) return false;
  return /^(https?|file):/.test(tab.url);
}

export function normalizeDomain(value = "") {
  let input = value.trim().toLowerCase();
  if (!input) return "";
  input = input.replace(/^\*\./, "");

  try {
    const parsed = new URL(input.includes("://") ? input : `http://${input}`);
    if (!parsed.hostname || /\s/.test(parsed.hostname)) return "";
    return parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function parseDomainList(value = "") {
  const entries = Array.isArray(value) ? value : value.split(/[\n,，;；]+/);
  return [...new Set(entries.map(normalizeDomain).filter(Boolean))];
}

export function getCategoryRules(storedRules) {
  const storedById = new Map(
    (Array.isArray(storedRules) ? storedRules : []).map((category) => [category?.id, category])
  );
  const claimedDomains = new Set();

  return DEFAULT_CATEGORY_RULES.map((defaults) => {
    const stored = storedById.get(defaults.id);
    const label = typeof stored?.label === "string" && stored.label.trim()
      ? stored.label.trim().slice(0, 12)
      : defaults.label;
    const sourceDomains = stored && Array.isArray(stored.domains) ? stored.domains : defaults.domains;
    const domains = parseDomainList(sourceDomains).filter((domain) => {
      if (claimedDomains.has(domain)) return false;
      claimedDomains.add(domain);
      return true;
    });
    return { id: defaults.id, label, color: defaults.color, domains };
  });
}

export function validateCategoryRules(rules) {
  const labels = new Set();
  const domains = new Map();

  for (const category of rules) {
    const label = category.label.trim();
    if (!label) return "分类名称不能为空";
    if (labels.has(label)) return `分类名称“${label}”重复`;
    labels.add(label);

    for (const rawDomain of category.domains) {
      const domain = normalizeDomain(rawDomain);
      if (!domain) return `“${rawDomain}”不是有效域名`;
      if (domains.has(domain)) return `域名 ${domain} 同时出现在“${domains.get(domain)}”和“${label}”中`;
      domains.set(domain, label);
    }
  }

  return "";
}

export function classifyTab(tab, categoryRules = DEFAULT_CATEGORY_RULES) {
  const hostname = getHostname(tab.url);
  const title = (tab.title || "").toLowerCase();

  const domainMatch = categoryRules
    .flatMap((category) => category.domains.map((domain) => ({ categoryId: category.id, domain })))
    .filter(({ domain }) => hostname === domain || hostname.endsWith(`.${domain}`))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
  if (domainMatch) {
    return domainMatch.categoryId;
  }

  for (const category of categoryRules) {
    const keywords = TITLE_RULES[category.id] || [];
    if (keywords.some((keyword) => title.includes(keyword))) return category.id;
  }

  return "other";
}

export function normalizeUrl(url = "") {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|spm$|from$|ref$|source$|fbclid$|gclid$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/$/, "");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function findDuplicateTabIds(tabs) {
  const byUrl = new Map();
  const duplicateIds = [];

  for (const tab of tabs) {
    if (!isManageableTab(tab)) continue;
    const key = normalizeUrl(tab.url);
    const current = byUrl.get(key);
    if (!current) {
      byUrl.set(key, tab);
      continue;
    }

    const keepCurrent = Boolean(current.active) || (!tab.active && (current.lastAccessed || 0) >= (tab.lastAccessed || 0));
    if (keepCurrent) {
      duplicateIds.push(tab.id);
    } else {
      duplicateIds.push(current.id);
      byUrl.set(key, tab);
    }
  }

  return duplicateIds;
}

export function matchesSearch(tab, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${tab.title || ""} ${getHostname(tab.url)} ${tab.url || ""}`.toLowerCase().includes(needle);
}

export function getRecentClosedTabs(sessions, limit = 15) {
  return sessions
    .flatMap((session, sessionIndex) => {
      if (session.tab) {
        return [{
          tab: session.tab,
          lastModified: session.lastModified || 0,
          sessionIndex,
          tabIndex: 0
        }];
      }

      const windowTabs = session.window?.tabs || [];
      return [...windowTabs]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.index - b.index)
        .map((tab, tabIndex) => ({
          tab,
          lastModified: session.lastModified || 0,
          sessionIndex,
          tabIndex
        }));
    })
    .sort((a, b) =>
      b.lastModified - a.lastModified ||
      a.sessionIndex - b.sessionIndex ||
      a.tabIndex - b.tabIndex
    )
    .filter(({ tab }) => tab.sessionId)
    .slice(0, limit)
    .map(({ tab }) => tab);
}
