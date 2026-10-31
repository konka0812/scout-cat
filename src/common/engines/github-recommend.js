/**
 * GitHub 热榜推荐
 * 流程：获取热榜 → 去重 → 按热度排序 → 兴趣筛选 → 生成推荐
 */
import { getGithubTrending } from "./github-trending.js";
import { summarizeInChinese } from "./openai.js";
import { itemFingerprint } from "../discovery.js";

/**
 * 去重：排除背包里已有的条目
 * @param {Array} trending 热榜
 * @param {object} opts excludeRepos（仓库名 owner/repo）/ excludeUrls（背包条目 URL）
 */
export function filterExcluded(trending, { excludeRepos = [], excludeUrls = [] } = {}) {
  const seenRepos = new Set(excludeRepos.map((r) => String(r).toLowerCase()));
  const seenUrls = new Set(excludeUrls.map((u) => String(u || "").trim().toLowerCase()));
  return (trending || []).filter((t) => {
    if (seenRepos.has(String(t.repo || "").toLowerCase())) return false;
    if (seenUrls.size && seenUrls.has(String(t.url || "").trim().toLowerCase())) return false;
    return true;
  });
}

/**
 * 获取 GitHub 热榜推荐
 * @param {object} opts
 *   - proxy: 代理地址
 *   - interests: 用户兴趣（用于筛选相关项目）
 *   - excludeUrls: 背包里已有的条目 URL（去重，主推）
 *   - excludeRepos: 已推荐过的仓库名 owner/repo（老参数，保留兼容）
 *   - maxItems: 最多返回几个
 *   - langFilter: 语言过滤（可选）
 */
export async function getGithubRecommendations({
  proxy = "http://127.0.0.1:7897",
  interests = [],
  excludeRepos = [],
  excludeUrls = [],
  maxItems = 3,
  langFilter = [],
  openai = {},
} = {}) {
  let trending;
  try {
    trending = await getGithubTrending({ proxy });
  } catch (e) {
    return { ok: false, error: `GitHub 热榜获取失败: ${e.message}`, items: [] };
  }

  // 1. 去重：排除背包里已有的条目（按仓库名或 URL）
  let fresh = filterExcluded(trending, { excludeRepos, excludeUrls });

  // 2. 语言过滤（如果指定）
  if (langFilter.length) {
    const langs = new Set(langFilter.map((l) => l.toLowerCase()));
    fresh = fresh.filter((t) => !t.lang || langs.has(t.lang.toLowerCase()));
  }

  // 3. 按今日 star 排序（热度）
  fresh.sort((a, b) => b.starsToday - a.starsToday);

  // 4. 兴趣相关性打分（简单关键词匹配 + 描述）
  const interestKeys = (interests || []).join(" ").toLowerCase();
  if (interestKeys) {
    const score = (t) => {
      const text = `${t.repo} ${t.desc} ${t.lang}`.toLowerCase();
      let s = 0;
      for (const k of interestKeys.split(/[\s,，、]+/).filter(Boolean)) {
        if (text.includes(k)) s += 1;
      }
      return s;
    };
    // 相关度高的优先，但保留热度
    fresh.sort((a, b) => score(b) * 1000 + b.starsToday - (score(a) * 1000 + a.starsToday));
  }

  // 5. 生成推荐项
  let items = fresh.slice(0, maxItems).map((t) => ({
    repo: t.repo,
    url: t.url,
    title: `${t.repo.split("/").pop()} — GitHub 今日热榜`,
    summary: `${t.desc.slice(0, 80)}${t.desc.length > 80 ? "…" : ""}（${t.lang || "未知语言"}，今日 +${t.starsToday} ★）`,
    source: "github.com",
    lang: t.lang,
    starsToday: t.starsToday,
    totalStars: t.totalStars,
    publishedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    kind: "github",
  }));

  // 6. 生成中文简介（仓库描述往往是英文，用户看不懂）
  items = await withChineseSummary(items, openai);

  return { ok: true, items, error: "" };
}

/** 把推荐项7的外文描述换成中文简介；模型不可用时保留原文 */
async function withChineseSummary(items, openai) {
  if (!items.length) return items;
  if (!(openai?.baseURL && openai?.apiKey && openai?.model)) return items;
  try {
    const summaries = await summarizeInChinese(openai, items.map((it) => ({
      key: it.repo,
      title: it.title,
      text: it.summary,
    })));
    if (!summaries.size) return items;
    console.log(`[scout-cat] GitHub 中文简介: ${summaries.size}/${items.length}`);
    return items.map((it) => {
      const zh = summaries.get(it.repo);
      if (!zh) return it;
      return {
        ...it,
        summary: `${zh}（${it.lang || "未知语言"}，今日 +${it.starsToday} ★）`,
      };
    });
  } catch {
    return items;
  }
}

/** 判断文本是否主要是中文 */
export function needsChinese(text) {
  const s = String(text || "").replace(/[\s\d\u2605+,.\uff0c\u3002\uff1a:;()\uff08\uff09\-\u2014\u2026\u00b7]/g, "");
  if (!s) return false;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk / s.length < 0.3;
}

function isGithubItem(item) {
  return String(item?.url || "").includes("github.com");
}

/**
 * 把背包里简介是外文的 GitHub 条目改写成中文
 * @returns {Promise<number>} 改写条数
 */
export async function refreshGithubSummaries(store, cfg = {}, { maxItems = 12 } = {}) {
  if (!store) return 0;
  const discoveries = store.get("discoveries", []) || [];
  const stale = discoveries.filter((d) => isGithubItem(d) && needsChinese(d.summary)).slice(0, maxItems);
  if (!stale.length) return 0;
  console.log(`[scout-cat] 背包里有 ${stale.length} 条外文 GitHub 简介待改写`);
  const summaries = await summarizeInChinese(cfg, stale.map((d) => ({
    key: d.id,
    title: d.title,
    text: d.summary,
  })));
  if (!summaries.size) return 0;
  let changed = 0;
  for (const d of discoveries) {
    const zh = summaries.get(d.id);
    if (!zh) continue;
    d.summary = zh;
    d.contentFingerprint = itemFingerprint(d);
    changed++;
  }
  if (changed) store.set("discoveries", discoveries);
  return changed;
}
