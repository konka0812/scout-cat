/**
 * 巡逻管道：编排搜索 → 去重 → 判断 → 校验 → 落库 → 提醒决策
 * 文档第 4、8、9 节
 */

import { randomUUID } from "node:crypto";
import { getEngine as defaultGetEngine } from "./registry.js";
import { titleSignature } from "./dedup.js";
import { contentFingerprint, cleanExcerpt } from "./normalize.js";
import { backpackIndex, isFreshCandidate, mergeDiscoveries } from "../discovery.js";

let _defaultStore = null;
async function getDefaultStore() {
  if (!_defaultStore) {
    const { getStore } = await import("../../main/store.js");
    _defaultStore = getStore();
  }
  return _defaultStore;
}

/**
 * 执行一次完整巡逻
 * @param {object} cfg 配置（含 engine、interests 等）
 * @param {object|null} storeOverride 可注入内存 store（测试用）
 * @param {object|null} engineOverride 可注入引擎实例（测试用）
 */
export async function runPipeline(cfg = {}, storeOverride = null, engineOverride = null) {
  const store = storeOverride || (await getDefaultStore());
  const engine = engineOverride || defaultGetEngine(cfg.engine || "openai");

  const historyEvents = store.get("events", []);

  const result = await engine.run({
    prompt: "",
    timeoutMs: 300000,
    cfg: { ...cfg, historyEvents },
  });

  if (!result?.ok) {
    return {
      ok: false,
      error: result?.error || "引擎失败",
      items: [],
      queries: result?.queries || [],
    };
  }

  const allCandidates = result.candidates || [];

  // [背包去重] 以背包（discoveries）为“已见过”的唯一账本：
  //  - 背包里已有该 URL 且内容指纹未变 -> 跳过（同一消息反复搜到只处理一次）
  //  - 背包里没有该 URL，或内容指纹变化（实质新进展）-> 进入模型判断
  //  - 用户从背包删除某条后，该 URL 重新可用，可再次推荐
  const backpack = backpackIndex(store.get("discoveries", []) || []);
  const freshCandidates = allCandidates.filter((c) => isFreshCandidate(c, backpack));
  // 注意：不过滤 decisions，交给 validateDecisions 校验。
  // 引用了已处理候选的 decision 会因 candidate_ids 校验失败而被拒绝，不会重复创建。
  const decisions = result.decisions || [];

  // 落库：文章 upsert（含历史更新）+ 候选状态
  const articleEventId = upsertArticles(store, allCandidates);
  const candidates = freshCandidates;
  const candidateStatus = store.get("candidateStatus", {});

  // 校验 + 处理 decisions
  const validated = validateDecisions(decisions, candidates, historyEvents);

  // 处理分类：创建/更新事件，生成通知
  const notifyItems = [];
  const pendingReview = [];
  const processed = { created: 0, updated: 0, duplicate: 0, uncertain: 0, rejected: 0 };

  for (const d of validated) {
    const validIds = d.candidate_ids.filter((id) => candidates.some((c) => c.candidateId === id));
    if (!validIds.length) { processed.rejected++; continue; }

    if (d.existing_event_id && !historyEvents.some((e) => e.id === d.existing_event_id)) {
      processed.rejected++;
      continue;
    }

    let sourceArticle = null;
    if (d.source_candidate_id) {
      sourceArticle = candidates.find((c) => c.candidateId === d.source_candidate_id) || null;
      if (!sourceArticle) { processed.rejected++; continue; }
    }
    if (!sourceArticle && validIds.length) {
      sourceArticle = candidates.find((c) => c.candidateId === validIds[0]) || null;
    }

    const url = sourceArticle?.url || "";
    if (!/^https?:\/\//.test(url)) { processed.rejected++; continue; }

    // 标记候选已处理
    for (const id of validIds) {
      candidateStatus[id] = { status: d.classification, at: new Date().toISOString(), url };
    }

    if (d.classification === "new_event") {
      const eventId = randomUUID();
      const event = {
        id: eventId,
        topic: sourceArticle?.source || "",
        subject: extractSubject(d.fact || sourceArticle?.title || ""),
        knownFacts: d.fact || sourceArticle?.title || "",
        status: "active",
        firstOccurredAt: d.published_at || sourceArticle?.publishedAt || null,
        relatedArticles: validIds.map((id) => candidates.find((c) => c.candidateId === id)?.url).filter(Boolean),
        lastSubstantiveUpdate: d.fact || null,
        updatedAt: new Date().toISOString(),
        titleSignature: titleSignature(d.fact || sourceArticle?.title || ""),
      };
      store.set("events", [...store.get("events", []), event]);
      // 关联文章 → 事件
      linkArticlesToEvent(store, event.relatedArticles, eventId);
      processed.created++;
      notifyItems.push(buildNotifyItem(event, d, sourceArticle));
    } else if (d.classification === "substantive_update") {
      const evId = d.existing_event_id;
      const events = store.get("events", []);
      const ev = events.find((e) => e.id === evId);
      if (!ev) { processed.uncertain++; continue; }
      const existingNotifs = store.get("notifications", []);
      const already = existingNotifs.some((n) => n.eventId === evId && n.version === (d.change || d.fact));
      if (already) { processed.duplicate++; continue; }

      ev.lastSubstantiveUpdate = d.fact || d.change || ev.lastSubstantiveUpdate;
      ev.updatedAt = new Date().toISOString();
      ev.status = "active";
      const urls = validIds.map((id) => candidates.find((c) => c.candidateId === id)?.url).filter(Boolean);
      ev.relatedArticles = [...new Set([...(ev.relatedArticles || []), ...urls])];
      store.set("events", events);
      linkArticlesToEvent(store, urls, evId);
      processed.updated++;
      notifyItems.push(buildNotifyItem(ev, d, sourceArticle));
    } else if (d.classification === "duplicate") {
      const evId = d.existing_event_id;
      if (evId) {
        const events = store.get("events", []);
        const ev = events.find((e) => e.id === evId);
        if (ev) {
          const urls = validIds.map((id) => candidates.find((c) => c.candidateId === id)?.url).filter(Boolean);
          ev.relatedArticles = [...new Set([...(ev.relatedArticles || []), ...urls])];
          ev.updatedAt = new Date().toISOString();
          store.set("events", events);
          linkArticlesToEvent(store, urls, evId);
        }
      }
      processed.duplicate++;
    } else {
      // uncertain：持久化到待核实列表
      processed.uncertain++;
      pendingReview.push({
        id: randomUUID(),
        fact: d.fact || sourceArticle?.title || "",
        url,
        source: sourceArticle?.source || "",
        publishedAt: sourceArticle?.publishedAt || d.published_at || null,
        reason: "证据不足，待核实",
        createdAt: new Date().toISOString(),
        candidateIds: validIds,
      });
    }
  }

  // 候选状态落盘
  store.set("candidateStatus", candidateStatus);

  // 待核实列表（去重 + 限量）
  if (pendingReview.length) {
    const existing = store.get("pendingReview", []);
    const seen = new Set(existing.map((p) => p.url));
    const merged = [...existing];
    for (const p of pendingReview) {
      if (p.url && !seen.has(p.url)) { merged.unshift(p); seen.add(p.url); }
    }
    store.set("pendingReview", merged.slice(0, 200));
  }

  // 事件保存期限清理（文档第 6 节）
  pruneEvents(store, cfg.eventRetentionDays);

  // 落库通知（幂等）
  const notifs = store.get("notifications", []);
  for (const item of notifyItems) {
    const exists = notifs.some((n) => n.id === item.id);
    if (!exists) notifs.push(item);
  }
  store.set("notifications", notifs.slice(0, 500));

  // 转换为背包 items
  const items = notifyItems.map((n) => ({
    title: n.bubble || n.fact || "新发现",
    // 背包卡片的简要介绍（文章原文片段）；桌宠气泡优先用 bubble
    summary: n.summary || n.bubble || n.fact || "",
    bubble: n.bubble || n.fact || "",
    url: n.url || "",
    source: n.source || "",
    publishedAt: n.publishedAt || null,
    firstSeenAt: n.firstSeenAt || null,
    reason: n.relevanceReason || "",
    eventId: n.eventId,
    shouldNotify: n.shouldNotify ?? true,
    contentFingerprint: n.contentFingerprint || "",
  }));

  // 背包落库（upsert）：新条目 / 新进展进背包，已存在且未变化的跳过
  if (items.length) {
    store.set("discoveries", mergeDiscoveries(store.get("discoveries", []) || [], items));
  }

  return {
    ok: true,
    items,
    queries: result.queries || [],
    processed,
    error: "",
  };
}

/** 校验 decisions 结构（文档第 8 节） */
export function validateDecisions(decisions, candidates, historyEvents) {
  const out = [];
  const seen = new Set();
  for (const d of decisions) {
    if (!d || typeof d !== "object") continue;
    const classification = d.classification;
    if (!["new_event", "substantive_update", "duplicate", "uncertain"].includes(classification)) continue;
    if (!Array.isArray(d.candidate_ids)) continue;
    const key = [...d.candidate_ids].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      candidate_ids: d.candidate_ids.filter((id) => candidates.some((c) => c.candidateId === id)),
      classification,
      existing_event_id: d.existing_event_id || null,
      fact: d.fact || "",
      summary: d.summary || "",
      change: d.change || null,
      bubble: d.bubble || null,
      source_candidate_id: d.source_candidate_id || null,
      published_at: d.published_at || null,
      relevance_reason: d.relevance_reason || null,
    });
  }
  return out;
}

/** 文章 upsert 到 store，返回 candidateId → eventId 映射 */
function upsertArticles(store, candidates) {
  const articles = store.get("articles", []);
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  for (const c of candidates) {
    if (!c.url) continue;
    const existing = byUrl.get(c.url);
    if (existing) {
      existing.lastCheckedAt = new Date().toISOString();
      if (c.summary && c.summary.length > (existing.summary || "").length) existing.summary = c.summary;
      if (c.publishedAt && !existing.publishedAt) existing.publishedAt = c.publishedAt;
      if (c.contentSnippet && c.contentSnippet.length > (existing.contentSnippet || "").length) {
        existing.contentSnippet = c.contentSnippet;
        existing.contentFingerprint = contentFingerprint(c.title, c.contentSnippet);
      } else {
        const fp = contentFingerprint(c.title, c.summary || c.contentSnippet || "");
        if (fp && fp !== existing.contentFingerprint) existing.contentFingerprint = fp;
      }
    } else {
      const article = {
        id: randomUUID(),
        url: c.url,
        title: c.title || "",
        summary: c.summary || "",
        source: c.source || "",
        publishedAt: c.publishedAt || null,
        firstSeenAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        contentFingerprint: contentFingerprint(c.title, c.summary || c.contentSnippet || ""),
        contentSnippet: c.contentSnippet || "",
        eventId: null,
        candidateId: c.candidateId,
      };
      articles.unshift(article);
      byUrl.set(c.url, article);
    }
  }
  store.set("articles", articles.slice(0, 2000));
  const map = {};
  for (const a of articles) map[a.candidateId] = a.eventId;
  return map;
}

/** 将文章关联到事件 */
function linkArticlesToEvent(store, urls, eventId) {
  if (!urls?.length || !eventId) return;
  const articles = store.get("articles", []);
  let changed = false;
  for (const a of articles) {
    if (urls.includes(a.url) && a.eventId !== eventId) {
      a.eventId = eventId;
      changed = true;
    }
  }
  if (changed) store.set("articles", articles);
}

/** 事件保存期限清理 */
function pruneEvents(store, retentionDays = 30) {
  if (!retentionDays || retentionDays <= 0) return;
  const cutoff = Date.now() - retentionDays * 86400e3;
  const events = store.get("events", []);
  const kept = events.filter((e) => {
    const t = e.updatedAt ? new Date(e.updatedAt).getTime() : 0;
    return t >= cutoff;
  });
  if (kept.length !== events.length) store.set("events", kept);
}

/**
 * 背包卡片用的简要介绍
 * 优先文章原文片段，避免与标题重复；都没有时回退到气泡文案
 */
function briefSummary(sourceArticle, d) {
  const bubble = String(d.bubble || d.fact || "").trim();
  const headline = String(sourceArticle?.title || "").trim();
  // 1) 模型写的中文简介；2) 模型给的事实描述；3) 原文片段
  const modelSummary = cleanExcerpt(d.summary);
  if (modelSummary && modelSummary !== headline && modelSummary !== bubble) return modelSummary;
  const fact = cleanExcerpt(d.fact);
  if (fact && fact !== headline && fact !== bubble) return fact;
  const snip = cleanExcerpt(sourceArticle?.summary);
  if (snip && snip !== headline && snip !== bubble) return snip;
  const body = cleanExcerpt(sourceArticle?.contentSnippet);
  if (body && body !== bubble && body !== snip) return body;
  return (bubble || headline || "").slice(0, 180);
}

/** 构建通知项（状态细分） */
function buildNotifyItem(event, d, sourceArticle) {
  const url = sourceArticle?.url || (event.relatedArticles || [])[0] || "";
  return {
    id: randomUUID(),
    eventId: event.id,
    version: d.change || d.fact || "",
    bubble: d.bubble || null,
    fact: d.fact || "",
    summary: briefSummary(sourceArticle, d),
    url,
    source: sourceArticle?.source || event.topic || "",
    publishedAt: d.published_at || sourceArticle?.publishedAt || null,
    firstSeenAt: sourceArticle?.firstSeenAt || new Date().toISOString(),
    relevanceReason: d.relevance_reason || "",
    status: "pending",        // pending → shown → read/favorite/ignored
    createdAt: new Date().toISOString(),
    notifiedAt: null,
    shouldNotify: Boolean(d.bubble),
    // 内容指纹：与候选一致，供背包去重比对
    contentFingerprint: sourceArticle
      ? (sourceArticle.contentFingerprint || contentFingerprint(sourceArticle.title, sourceArticle.summary || sourceArticle.contentSnippet || ""))
      : "",
  };
}

/** 从文本提取事件主体 */
function extractSubject(text) {
  if (!text) return "";
  return String(text).trim().slice(0, 20);
}
