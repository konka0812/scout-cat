/**
 * OpenAI 兼容引擎：多主题搜索 + 事件判断
 *
 * 流程（文档第 4 节）：
 *   1. 生成 1～3 条主题查询（轮换）
 *   2. 逐条搜索 + 标准化 + URL 去重
 *   3. 批内标题相似去重
 *   4. 关联历史事件
 *   5. 按需 Fetch 高价值候选正文
 *   6. 调模型判断（decisions 格式）
 *   7. 返回候选 + 模型决策（落库由 pipeline 负责）
 */

import { search, fetchPage } from "./search.js";
import { buildSearchQueries, buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./prompt.js";
import { normalizeArticle, normalizeUrl, extractSource } from "./normalize.js";
import { dedupByUrl, dedupByTitleSimilarity, relateToHistory } from "./dedup.js";

export const openaiAdapter = {
  name: "openai",
  label: "OpenAI 兼容 + 搜索",
  docs: "https://api-docs.deepseek.com/zh-cn/api/search.md",

  async check(cfg = {}) {
    const baseUrl = cfg.baseURL || "";
    const apiKey = cfg.apiKey || "";
    const model = cfg.model || "";
    const searchKey = cfg.searchKey || apiKey;
    const searchBase = cfg.searchBase || "https://api.deepseek.com";
    const result = { ok: true, version: model, message: "", model: false, search: false };

    if (!baseUrl || !apiKey || !model) {
      return { ok: false, version: "", message: "请在设置中填写 Base URL、API Key 和 Model" };
    }
    // 测试模型
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
      });
      if (res.ok) result.model = true;
      else {
        const err = await res.json().catch(() => ({}));
        result.message = `模型 HTTP ${res.status}: ${err?.error?.message || res.statusText}`;
      }
    } catch (e) {
      result.message = `模型: ${e.message}`;
    }
    // 测试搜索
    try {
      const sres = await fetch(`${searchBase}/v1/tools/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${searchKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "AI", count: 1 }),
      });
      if (sres.ok) result.search = true;
      else {
        const err = await sres.json().catch(() => ({}));
        result.message += `${result.message ? "；" : ""}搜索 HTTP ${sres.status}: ${err?.error?.message || sres.statusText}`;
      }
    } catch (e) {
      result.message += `${result.message ? "；" : ""}搜索: ${e.message}`;
    }
    result.ok = result.model || result.search;
    return result;
  },

  async run({ prompt, timeoutMs = 300000, cfg = {} }) {
    const baseUrl = cfg.baseURL || "";
    const apiKey = cfg.apiKey || "";
    const model = cfg.model || "";
    const searchKey = cfg.searchKey || apiKey;
    const searchBase = cfg.searchBase || "https://api.deepseek.com";
    const rotation = cfg.rotation || 0;
    const feedback = cfg.feedback || {};
    const maxTokens = cfg.modelMaxTokens || 3000;
    const fetchLimit = cfg.fetchLimit || 6;
    const queryCount = cfg.queryCount || 3;
    const useJsonMode = cfg.useJsonMode !== false;

    const now = new Date().toISOString();

    // 1. 生成主题查询（含偏好反馈）
    const queries = buildSearchQueries({
      interests: cfg.interests || [],
      watchTasks: cfg.watchTasks || [],
      blockedTopics: cfg.blockedTopics || [],
      feedback,
      rotation,
      maxQueries: queryCount,
      lastCheck: cfg.lastCheck || null,
      lookbackHours: cfg.lookbackHours || 48,
      searchRange: cfg.searchRange || "today",
    });

    // 2. 逐条搜索 + 标准化 + URL 去重
    let allArticles = [];
    const queryResults = [];
    for (const q of queries) {
      try {
        const raw = await search(q.query, { apiKey: searchKey, count: 10, needContent: false, base: searchBase });
        const articles = (raw || []).map((r, i) => normalizeArticle(r, {
          candidateId: `q${queryResults.length}-c${i}`,
          taskId: q.topic,
        }));
        const { kept } = dedupByUrl(articles);
        allArticles.push(...kept);
        queryResults.push({ topic: q.topic, ok: true, count: kept.length });
      } catch (e) {
        queryResults.push({ topic: q.topic, ok: false, error: e.message });
      }
    }

    if (!allArticles.length) {
      // 【问题6】区分"搜索失败"和"没有消息"：全部查询失败时明确报错
      const failed = queryResults.filter((q) => !q.ok);
      if (failed.length && failed.length === queryResults.length) {
        return {
          ok: false,
          candidates: [],
          decisions: [],
          queries: queryResults,
          error: `搜索失败：${failed[0]?.error || "未知网络错误"}`,
          raw: "",
        };
      }
      // 搜索成功但无结果
      return { ok: true, candidates: [], decisions: [], queries: queryResults, error: "", raw: "" };
    }

    // 3. 批内标题相似去重
    const { kept: deduped } = dedupByTitleSimilarity(allArticles);

    // 4. 关联历史事件
    const historyEvents = cfg.historyEvents || [];
    const matchedEventIds = relateToHistory(deduped, historyEvents);
    const candidates = deduped.map((a, i) => ({
      ...a,
      matchedEventId: matchedEventIds[i] || null,
    }));

    // 5. 按需 Fetch：对高价值候选读取正文（受 fetchLimit 限制）
    let fetchCount = 0;
    for (const c of candidates) {
      if (fetchCount >= fetchLimit) break;
      const isOfficial = /github\.com|gitlab|ietf|w3|python|nodejs|mozilla|apple|microsoft|google|openai|anthropic|deepseek/.test(c.source || "");
      const hasWatchMatch = Boolean(c.matchedEventId);
      if ((isOfficial || hasWatchMatch) && c.url && !c.contentSnippet) {
        try {
          const page = await fetchPage(c.url, { apiKey: searchKey, base: searchBase });
          c.contentSnippet = (page.content || "").slice(0, 1500);
          fetchCount++;
        } catch {
          // 抓取失败不阻塞
        }
      }
    }

    // 6. 调模型判断
    const systemPrompt = buildJudgeSystemPrompt();
    const userPrompt = buildJudgeUserPrompt({
      interests: cfg.interests,
      blockedTopics: cfg.blockedTopics,
      watchTasks: cfg.watchTasks,
      feedback,
      now,
      candidates: candidates.slice(0, 8),
      events: historyEvents,
    });

    let decisions = [];
    let modelError = "";
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const body = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
        };
        if (useJsonMode) body.response_format = { type: "json_object" };
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          modelError = `模型 HTTP ${res.status}: ${err?.error?.message || res.statusText}`;
        } else {
          const data = await res.json();
          const choice = data.choices?.[0];
          const text = choice?.message?.content || "";
          // 诊断：记录响应详情，便于定位空响应
          const dbg = `finish=${choice?.finish_reason} completionTokens=${data.usage?.completion_tokens} promptTokens=${data.usage?.prompt_tokens} contentLen=${text.length}`;
          if (!text) {
            modelError = `模型返回空响应 [${dbg}]`;
          } else {
            const parsed = parseDecisions(text);
            decisions = parsed.decisions || [];
            modelError = parsed.error || "";
            if (!modelError) break; // 成功
            // 解析失败：记录模型返回片段，便于定位
            const snippet = text.replace(/\s+/g, " ").slice(0, 300);
            modelError = `JSON 解析失败 [${dbg}] 模型返回: ${snippet}`;
          }
        }
      } catch (e) {
        modelError = e.message;
      }
      // 重试（指数退避）
      if (modelError && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        modelError = ""; // 清空，重试
      }
    }

    return {
      ok: !modelError,
      candidates: candidates.map((c) => ({
        candidateId: c.candidateId,
        url: c.url,
        title: c.title,
        summary: c.summary,
        source: c.source,
        publishedAt: c.publishedAt,
        contentSnippet: c.contentSnippet || "",
        matchedEventId: c.matchedEventId,
        taskId: c.taskId,
      })),
      decisions,
      queries: queryResults,
      error: modelError,
      raw: "",
    };
  },
};

/**
 * 批量把一批条目写成中文一句话简介
 * @param {object} cfg 模型配置：baseURL / apiKey / model
 * @param {Array<{key:string,title:string,text:string}>} items
 * @returns {Promise<Map<string,string>>} key -> 中文简介（失败返回空 Map）
 */
export async function summarizeInChinese(cfg = {}, items = []) {
  const out = new Map();
  const baseUrl = String(cfg.baseURL || "").replace(/\/$/, "");
  const apiKey = cfg.apiKey || "";
  const model = cfg.model || "";
  if (!baseUrl || !apiKey || !model || !items.length) return out;

  const list = items
    .map((it, i) => `${i + 1}. ${it.title}\n   ${String(it.text || "").replace(/\s+/g, " ").slice(0, 200)}`)
    .join("\n");
  const system =
    "\u4f60\u662f\u60c5\u62a5\u7f16\u8f91\u3002\u628a\u7528\u6237\u7ed9\u7684\u6bcf\u6761\u5185\u5bb9\u5199\u6210\u4e00\u53e5\u4e2d\u6587\u7b80\u4ecb\uff0c\u8bf4\u660e\u5b83\u662f\u4ec0\u4e48\u3001\u6709\u4ec0\u4e48\u7528\u3002\u8981\u6c42\uff1a30\uff5e50 \u4e2a\u6c49\u5b57\uff1b\u5fc5\u987b\u7528\u4e2d\u6587\uff1b\u4e0d\u8981\u7167\u6284\u82f1\u6587\u539f\u6587\uff1b\u4e0d\u8981\u5938\u5927\u3002\u53ea\u8f93\u51fa JSON\u3002";
  const user = `\u8bf7\u4e3a\u4e0b\u9762 ${items.length} \u6761\u5185\u5bb9\u5404\u5199\u4e00\u53e5\u4e2d\u6587\u7b80\u4ecb\uff0c\u6309\u987a\u5e8f\u8f93\u51fa\uff0c\u5171 ${items.length} \u53e5\uff1a\n${list}\n\n\u53ea\u8f93\u51fa JSON\uff1a{"summaries":["\u7b2c1\u6761","\u7b2c2\u6761",...]}`;

  let modelError = "";
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: 1500,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        modelError = `\u6a21\u578b HTTP ${res.status}: ${err?.error?.message || res.statusText}`;
      } else {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        const arr = parseSummaries(text);
        if (arr.length) {
          items.forEach((it, i) => { if (arr[i]) out.set(String(it.key), arr[i].trim()); });
          return out;
        }
        modelError = "\u6a21\u578b\u8fd4\u56de\u7a7a\u7b80\u4ecb";
      }
    } catch (e) {
      modelError = e.message;
    }
    if (modelError && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      modelError = "";
    }
  }
  console.warn("[scout-cat] \u4e2d\u6587\u7b80\u4ecb\u751f\u6210\u5931\u8d25:", modelError);
  return out;
}

/** \u4ece\u6a21\u578b\u8f93\u51fa\u89e3\u6790 summaries \u6570\u7ec4\uff08\u5bb9\u9519\u4ee3\u7801\u5757\uff09 */
function parseSummaries(text) {
  let json = null;
  try { json = JSON.parse(text); } catch { /* \u843d\u5230\u4e0b\u9762\u7684\u5bb9\u9519 */ }
  if (!json) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) { try { json = JSON.parse(m[0]); } catch { /* ignore */ } }
  }
  return Array.isArray(json?.summaries) ? json.summaries.filter((s) => typeof s === "string" && s.trim()) : [];
}

/** \u89e3\u6790\u6a21\u578b\u8f93\u51fa\u7684 decisions JSON */
export function parseDecisions(text) {
  if (!text) return { decisions: [], error: "empty response" };
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    let depth = 0, inStr = false, esc = false, start = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") { if (depth === 0) start = i; depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          try { json = JSON.parse(text.slice(start, i + 1)); } catch {}
          break;
        }
      }
    }
  }
  if (!json || !Array.isArray(json.decisions)) {
    return { decisions: [], error: "invalid decisions JSON" };
  }
  const valid = new Set(["new_event", "substantive_update", "duplicate", "uncertain"]);
  const decisions = json.decisions.filter((d) => valid.has(d.classification));
  return { decisions, error: "" };
}
