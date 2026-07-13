import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CATEGORY_RULES,
  classifyTab,
  findDuplicateTabIds,
  getCategoryRules,
  getHostname,
  getRecentClosedTabs,
  isManageableTab,
  matchesSearch,
  normalizeDomain,
  normalizeUrl,
  parseDomainList,
  validateCategoryRules
} from "../core.js";

test("extracts normalized hostnames", () => {
  assert.equal(getHostname("https://www.github.com/openai/codex"), "github.com");
  assert.equal(getHostname("invalid"), "");
});

test("classifies known domains and title fallbacks", () => {
  assert.equal(classifyTab({ url: "https://github.com/openai/codex", title: "Codex" }), "dev");
  assert.equal(classifyTab({ url: "https://example.com", title: "本周项目看板" }), "work");
  assert.equal(classifyTab({ url: "https://example.com", title: "Example" }), "other");
});

test("supports custom category names and domain rules", () => {
  const rules = getCategoryRules([
    { id: "work", label: "公司", domains: ["intranet.example.com"] },
    { id: "dev", label: "工程", domains: ["dev.example.com"] }
  ]);
  assert.equal(rules.find((category) => category.id === "work").label, "公司");
  assert.equal(classifyTab({ url: "https://wiki.intranet.example.com", title: "Wiki" }, rules), "work");
  assert.equal(classifyTab({ url: "https://dev.example.com", title: "Project" }, rules), "dev");
});

test("prefers the most specific custom domain", () => {
  const rules = getCategoryRules([
    { id: "work", label: "工作", domains: ["example.com"] },
    { id: "docs", label: "资料", domains: ["docs.example.com"] }
  ]);
  assert.equal(classifyTab({ url: "https://docs.example.com/guide", title: "Guide" }, rules), "docs");
});

test("normalizes full URLs, wildcard domains and domain lists", () => {
  assert.equal(normalizeDomain("https://www.Example.com/path"), "example.com");
  assert.equal(normalizeDomain("*.docs.example.com"), "docs.example.com");
  assert.deepEqual(parseDomainList("example.com, https://www.example.com/a\ndocs.example.com"), [
    "example.com",
    "docs.example.com"
  ]);
});

test("rejects duplicate labels and exact domains across categories", () => {
  const duplicateLabels = DEFAULT_CATEGORY_RULES.map((category) => ({ ...category, domains: [] }));
  duplicateLabels[1].label = duplicateLabels[0].label;
  assert.match(validateCategoryRules(duplicateLabels), /分类名称/);

  const duplicateDomains = DEFAULT_CATEGORY_RULES.map((category) => ({ ...category, domains: [] }));
  duplicateDomains[0].domains = ["example.com"];
  duplicateDomains[1].domains = ["https://www.example.com/path"];
  assert.match(validateCategoryRules(duplicateDomains), /同时出现在/);
});

test("leaves pinned and browser-internal tabs unmanaged", () => {
  assert.equal(isManageableTab({ url: "https://example.com", pinned: false }), true);
  assert.equal(isManageableTab({ url: "https://example.com", pinned: true }), false);
  assert.equal(isManageableTab({ url: "chrome://extensions", pinned: false }), false);
});

test("normalizes tracking parameters without changing useful ones", () => {
  assert.equal(
    normalizeUrl("https://example.com/a/?utm_source=test&id=7#part"),
    "https://example.com/a?id=7"
  );
});

test("finds duplicates and preserves the active copy", () => {
  const duplicates = findDuplicateTabIds([
    { id: 1, url: "https://example.com/page?utm_source=a", active: false, pinned: false, lastAccessed: 10 },
    { id: 2, url: "https://example.com/page", active: true, pinned: false, lastAccessed: 5 },
    { id: 3, url: "https://different.com", active: false, pinned: false }
  ]);
  assert.deepEqual(duplicates, [1]);
});

test("searches title, hostname and URL case-insensitively", () => {
  const tab = { title: "产品方案", url: "https://docs.example.com/plan" };
  assert.equal(matchesSearch(tab, "产品"), true);
  assert.equal(matchesSearch(tab, "DOCS"), true);
  assert.equal(matchesSearch(tab, "missing"), false);
});

test("recent list hidden state is not overridden by its grid layout", async () => {
  const css = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../sidepanel.css", import.meta.url), "utf8"));
  assert.match(css, /\.recent-list\[hidden\]\s*\{\s*display:\s*none;/);
});

test("returns up to 15 recently closed tabs with the newest first", () => {
  const sessions = [
    { tab: { sessionId: "newest", title: "Newest" }, lastModified: 300 },
    {
      window: {
        tabs: [
          { sessionId: "older-1", title: "Older 1", active: false, index: 0 },
          { sessionId: "older-active", title: "Older active", active: true, index: 1 }
        ]
      },
      lastModified: 200
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      tab: { sessionId: `old-${index}`, title: `Old ${index}` },
      lastModified: 100 - index
    }))
  ];

  const tabs = getRecentClosedTabs(sessions, 15);
  assert.equal(tabs.length, 15);
  assert.equal(tabs[0].sessionId, "newest");
  assert.equal(tabs[1].sessionId, "older-active");
});
