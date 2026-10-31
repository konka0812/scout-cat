/**
 * 搜索结果标准化与 URL 规范化
 */

/** 跟踪参数（去重时忽略） */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "utm_reader", "utm_referrer", "utm_social",
  "utm_social-type", "gclid", "fbclid", "mc_cid", "mc_eid", "igshid",
  "ref", "ref_src", "ref_url", "spm", "scm", "_hsenc", "_hsmi",
  "vero_conv", "vero_id", "oly_anon_id", "oly_enc_id",
]);

/** 规范化 URL：去 hash、去跟踪参数、小写 host、去默认端口 */
export function normalizeUrl(raw) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    // 去跟踪参数
    const keys = [...u.searchParams.keys()];
    for (const k of keys) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
    }
    // 去末尾斜杠（path 非根时）
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return String(raw).trim();
  }
}

/** 从 URL 提取站点名 */
export function extractSource(url, fallback = "") {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return fallback || "未知来源";
  }
}

/** 标准化发布时间为 UTC ISO 字符串或 null */
export function normalizeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 生成内容指纹（用于检测文章是否变化） */
export function contentFingerprint(title, summary) {
  const s = `${(title || "").trim().toLowerCase()}|${(summary || "").trim().toLowerCase()}`;
  // 简单 hash
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 清洗文本片段：去 markdown 写法、图片链接，压缩空白 */
export function cleanExcerpt(text, max = 180) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** 标准化一条搜索结果为文章记录 */
export function normalizeArticle(raw, { candidateId, taskId }) {
  const url = normalizeUrl(raw.url || raw.link || "");
  return {
    candidateId,
    url,
    title: (raw.title || "").trim(),
    summary: (raw.summary || raw.content || "").trim().slice(0, 500),
    source: extractSource(url, raw.source || ""),
    publishedAt: normalizeDate(raw.date || raw.publishedAt || raw.published_at),
    firstSeenAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    contentFingerprint: contentFingerprint(raw.title, raw.summary || raw.content),
    taskId: taskId || "",
  };
}
