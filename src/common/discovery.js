/**
 * 背包（discoveries）去重账本
 *
 * 设计原则：背包是"已见过"的唯一账本。
 *  - 背包里已有该 URL 且内容指纹未变 -> 重复，不再推送
 *  - 背包里没有该 URL，或内容指纹变化（实质新进展）-> 视为新条目
 *  - 用户从背包删除某条后，该 URL 重新可用，可再次推荐
 */

import { contentFingerprint, cleanExcerpt } from "./engines/normalize.js";

/** 生成条目 ID（不依赖 node:crypto，便于打包到渲染层） */
function genId() {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 条目去重键：URL */
export function discoveryKey(item) {
  return String(item?.url || "").trim();
}

/** 条目内容指纹（标题 + 摘要） */
export function itemFingerprint(item) {
  return contentFingerprint(item?.title, item?.summary || item?.contentSnippet || "");
}

/** 背包索引：URL -> 条目 */
export function backpackIndex(discoveries = []) {
  const map = new Map();
  for (const d of discoveries || []) {
    const k = discoveryKey(d);
    if (k && !map.has(k)) map.set(k, d);
  }
  return map;
}

/** 判断候选相对背包是否为"新"条目 */
export function isFreshCandidate(candidate, index) {
  const key = discoveryKey(candidate);
  if (!key) return false;
  const ex = index.get(key);
  if (!ex) return true;
  const fp = candidate.contentFingerprint || itemFingerprint(candidate);
  const exFp = ex.contentFingerprint || itemFingerprint(ex);
  return Boolean(fp && exFp && fp !== exFp);
}

/** 规范化 URL 用于比较（去空白 + 小写） */
function normUrl(u) {
  return String(u || "").trim().toLowerCase();
}

/**
 * 合并新条目到背包（按 URL upsert）
 *  - 新 URL：插入最前
 *  - 已有 URL 但指纹变化：更新内容并移到最前（保留已读 / 收藏状态）
 *  - 已有 URL 且指纹未变：跳过
 */
export function mergeDiscoveries(existing = [], incoming = [], { limit = 500 } = {}) {
  const byUrl = backpackIndex(existing);
  const out = [...existing];
  for (const item of incoming || []) {
    const key = discoveryKey(item);
    if (!key) continue;
    const fp = item.contentFingerprint || itemFingerprint(item);
    const ex = byUrl.get(key);
    if (ex) {
      const exFp = ex.contentFingerprint || itemFingerprint(ex);
      if (fp && exFp && fp !== exFp) {
        const idx = out.indexOf(ex);
        const updated = {
          ...ex,
          ...item,
          id: ex.id,
          read: ex.read === true,
          favorite: ex.favorite === true,
          createdAt: ex.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        updated.contentFingerprint = fp;
        if (idx >= 0) out.splice(idx, 1);
        out.unshift(updated);
        byUrl.set(key, updated);
      }
      continue;
    }
    const entry = {
      ...item,
      id: item.id || genId(),
      createdAt: item.createdAt || Date.now(),
      read: item.read === true,
      favorite: item.favorite === true,
    };
    if (fp) entry.contentFingerprint = fp;
    out.unshift(entry);
    byUrl.set(key, entry);
  }
  return out.slice(0, limit);
}

/**
 * 回填旧条目的简要介绍
 * 之前 summary 存的是气泡文案（往往和标题重复），这里从历史4文章表里拿原文片段补上。
 * @param {object} store electron-store 实例
 */
export function backfillSummaries(store) {
  if (!store) return 0;
  const discoveries = store.get("discoveries", []) || [];
  if (!discoveries.length) return 0;
  const articles = store.get("articles", []) || [];
  const byUrl = new Map();
  for (const a of articles) {
    const k = discoveryKey(a);
    if (k && !byUrl.has(k)) byUrl.set(k, a);
  }
  let changed = 0;
  for (const d of discoveries) {
    let touched = false;
    const title = String(d.title || "").trim();
    const isGithub = String(d.url || "").includes("github.com");
    // GitHub 条目的标题只是 "xxx — GitHub 今日热榜"，气泡不该用它
    if (isGithub && d.bubble && d.bubble === title) {
      delete d.bubble;
      touched = true;
    }
    const cur = String(d.summary || "").trim();
    if (!(cur && cur !== title)) {
      const a = byUrl.get(discoveryKey(d));
      const text = a ? cleanExcerpt(a.summary || a.contentSnippet) : "";
      if (text) {
        d.summary = text;
        if (!d.bubble) d.bubble = title;   // 旧条目标题即dt8d27泡文案
        d.contentFingerprint = d.contentFingerprint || itemFingerprint(d);
        touched = true;
      }
    }
    if (touched) changed++;
  }
  if (changed) store.set("discoveries", discoveries);
  return changed;
}

export { normUrl };