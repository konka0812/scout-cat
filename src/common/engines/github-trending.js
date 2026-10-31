/**
 * GitHub Trending 爬取与解析
 * 数据源：https://github.com/trending?since=daily （需代理）
 * 无需 API Key，纯 HTML 解析
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** 爬取 GitHub Trending HTML（走代理） */
export async function fetchTrendingHtml(proxy = "http://127.0.0.1:7897", timeoutMs = 30000) {
  const { stdout } = await execFileP(
    "curl.exe",
    ["-sS", "-x", proxy, "-A", "Mozilla/5.0", "--max-time", String(Math.round(timeoutMs / 1000)), "https://github.com/trending?since=daily"],
    { timeout: timeoutMs + 5000, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout;
}

/** 解析 Trending HTML → 项目列表 */
export function parseTrending(html) {
  const rows = html.match(/<article class="Box-row">[\s\S]*?<\/article>/g) || [];
  const clean = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const out = [];

  for (const row of rows) {
    const links = row.match(/href="\/([^"/]+\/[^"/]+)"/g) || [];
    const repo = links
      .map((l) => l.replace(/href="\//, "").replace(/"$/, ""))
      .find((l) => !l.startsWith("sponsors/") && !l.startsWith("trending/"));
    if (!repo) continue;

    const descM = row.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const langM = row.match(/itemprop="programmingLanguage">([\s\S]*?)<\/span>/);
    const todayM = row.match(/([\d,]+)\s*stars today/);
    const totalM = row.match(/href="\/[^/]+\/[^/]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/);

    out.push({
      repo,                                        // owner/repo
      url: `https://github.com/${repo}`,
      desc: descM ? clean(descM[1]) : "",
      lang: langM ? clean(langM[1]) : "",
      starsToday: todayM ? Number(todayM[1].replace(/,/g, "")) : 0,
      totalStars: totalM ? clean(totalM[1]).replace(/,/g, "") : "",
    });
  }
  return out;
}

/** 一站式：爬取 + 解析 */
export async function getGithubTrending(opts = {}) {
  const html = await fetchTrendingHtml(opts.proxy, opts.timeoutMs);
  return parseTrending(html);
}
