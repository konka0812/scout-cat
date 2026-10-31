/**
 * 规则去重 + 事件关联
 * 模型只负责语义判断，规则负责确定性去重。
 */

import { normalizeUrl, extractSource } from "./normalize.js";

/** URL 级去重：返回 { kept, dropped } */
export function dedupByUrl(articles) {
  const seen = new Map();
  const kept = [];
  const dropped = [];
  for (const a of articles) {
    if (!a.url) { dropped.push(a); continue; }
    const key = a.url;
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (a.summary && a.summary.length > (existing.summary || "").length) existing.summary = a.summary;
      if (a.publishedAt && !existing.publishedAt) existing.publishedAt = a.publishedAt;
      dropped.push(a);
    } else {
      seen.set(key, a);
      kept.push(a);
    }
  }
  return { kept, dropped };
}

/** 提取标题中的数字/版本签名（用于区分不同版本） */
function numericSignature(title) {
  const nums = String(title || "").match(/\d+(?:\.\d+)*/g) || [];
  return new Set(nums);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** 批内标题相似去重（同一事件多篇报道的粗筛，最终由模型确认） */
export function dedupByTitleSimilarity(articles, threshold = 0.6) {
  const kept = [];
  const dropped = [];
  const sigs = [];      // 词集合
  const numSigs = [];   // 数字/版本签名
  for (const a of articles) {
    const sig = titleSignature(a.title);
    if (!sig) { kept.push(a); sigs.push(null); numSigs.push(null); continue; }
    const nums = numericSignature(a.title);
    let merged = false;
    for (let i = 0; i < sigs.length; i++) {
      // 版本号/数字签名不同 → 不合并（验证集 4：不同版本不误合并）
      const otherNums = numSigs[i];
      if (nums.size && otherNums?.size && !setsEqual(nums, otherNums)) continue;
      if (sigs[i] && jaccard(sig, sigs[i]) >= threshold) {
        const target = kept[i];
        if (!target._similar) target._similar = [];
        target._similar.push(a.candidateId);
        if (a.url && !target.url) target.url = a.url;
        merged = true;
        dropped.push(a);
        break;
      }
    }
    if (!merged) {
      sigs.push(sig);
      numSigs.push(nums);
      kept.push(a);
    }
  }
  return { kept, dropped };
}

/** 与历史事件关联：返回每篇文章最可能关联的 eventId 或 null */
export function relateToHistory(articles, events) {
  if (!events?.length) return articles.map(() => null);
  const out = [];
  for (const a of articles) {
    let best = null;
    let bestScore = 0;
    const titleSig = titleSignature(a.title);
    const source = extractSource(a.url);
    const text = `${a.title} ${a.summary}`.toLowerCase();
    for (const ev of events) {
      let score = 0;
      // 已有文章 URL 相同（最强信号）
      if (ev.relatedArticles?.some((u) => normalizeUrl(u) === a.url)) score += 5;
      // 标题相似
      if (titleSig && ev.titleSignature) {
        const sim = jaccard(titleSig, ev.titleSignature);
        if (sim > 0.3) score += sim * 3;
      }
      // knownFacts 关键词命中（bigram 匹配）
      if (ev.knownFacts) {
        const kfSig = titleSignature(ev.knownFacts);
        if (kfSig) {
          let hits = 0;
          for (const t of kfSig) if (text.includes(t)) hits++;
          score += Math.min(hits, 3);
        }
      }
      // subject 命中
      if (ev.subject && text.includes(ev.subject.toLowerCase())) score += 2;
      if (score > bestScore) { bestScore = score; best = ev.id; }
    }
    out.push(bestScore >= 2 ? best : null);
  }
  return out;
}

/** 标题转词集合（英文按词，中文按 bigram） */
export function titleSignature(title) {
  if (!title) return null;
  const s = String(title).toLowerCase();
  const tokens = new Set();
  // 英文/数字词
  const words = s.match(/[a-z0-9]+/g) || [];
  for (const w of words) if (w.length > 1 && !STOPWORDS.has(w)) tokens.add(w);
  // 中文 bigram
  const cjk = s.match(/[\u4e00-\u9fff]/g) || [];
  for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk[i] + cjk[i + 1]);
  if (cjk.length === 1) tokens.add(cjk[0]);
  return tokens.size ? tokens : null;
}

/** Jaccard 相似度 */
function jaccard(a, b) {
  if (!a || !b || !a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "news", "update", "发布", "消息", "报道", "最新",
]);
