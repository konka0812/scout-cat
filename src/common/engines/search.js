/**
 * DeepSeek 搜索与抓取封装
 * 文档: https://api-docs.deepseek.com/zh-cn/api/search.md
 *       https://api-docs.deepseek.com/zh-cn/api/fetch.md
 *
 * Search: POST /v1/tools/search  -> { results: [...] }
 * Fetch:  POST /v1/tools/fetch   -> { title, content }
 *
 * 鉴权: Bearer <DeepSeek API Key>（与 DeepSeek 模型 API 同一个 key）
 */

const DEFAULT_BASE = "https://api.deepseek.com";

/** 搜索网页，返回结构化结果 */
export async function search(query, { apiKey, count = 10, needContent = false, base = DEFAULT_BASE } = {}) {
  const res = await fetch(`${base}/v1/tools/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, count, need_content: needContent }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Search HTTP ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.results || [];
}

/** 抓取单个网页，返回 Markdown 正文 */
export async function fetchPage(url, { apiKey, base = DEFAULT_BASE } = {}) {
  const res = await fetch(`${base}/v1/tools/fetch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Fetch HTTP ${res.status}: ${err?.error?.message || res.statusText}`);
  }
  return await res.json();
}

/**
 * 搜索 + 抓取正文，返回带正文的结果列表。
 * 用于给模型提供可追溯的原始资料。
 */
export async function searchAndFetch(query, { apiKey, count = 5, maxPages = 3, base = DEFAULT_BASE } = {}) {
  const results = await search(query, { apiKey, count, needContent: false, base });
  const out = [];
  for (const r of results.slice(0, maxPages)) {
    let content = r.content || "";
    if (!content && r.url) {
      try {
        const page = await fetchPage(r.url, { apiKey, base });
        content = page.content || "";
      } catch (e) {
        content = "";
      }
    }
    out.push({
      title: r.title || "",
      url: r.url || "",
      summary: r.summary || "",
      content,
      source: r.source || "",
      date: r.date || null,
    });
  }
  return out;
}
