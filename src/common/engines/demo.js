/**
 * 演示引擎：不调用真实 CLI，返回模拟候选 + 模拟判断。
 * 用途：用户尚未配置 OpenAI 引擎时，也能完整体验桌宠流程。
 */
const SAMPLES = [
  {
    candidateId: "demo-c0",
    url: "https://opencode.ai/docs/cli/",
    title: "AI 视频工具开放参考图上传试用",
    summary: "你关注的视频工具开放试用了，这次支持上传参考图。我把入口带回来了。",
    source: "opencode.ai",
    publishedAt: new Date().toISOString(),
    contentSnippet: "官方文档显示，该工具现已支持上传参考图进行视频生成，所有用户均可试用。",
    taskId: "AI 视频",
  },
  {
    candidateId: "demo-c1",
    url: "https://github.com/example/project/releases",
    title: "某开源项目发布 Windows 安装包",
    summary: "这个开源项目出了 Windows 安装包，你之前让我盯的功能可以试了。",
    source: "github.com",
    publishedAt: new Date(Date.now() - 3600e3).toISOString(),
    contentSnippet: "Release notes 显示 Windows 安装包已开放下载。",
    taskId: "开源工具",
  },
];

export const demoAdapter = {
  name: "demo",
  label: "演示模式",
  docs: "",
  async check() {
    return { ok: true, version: "demo", message: "" };
  },
  async run({ prompt, timeoutMs = 300000, cfg = {} }) {
    await new Promise((r) => setTimeout(r, 1200));
    // 轮换：每次返回不同数量
    const n = 1 + Math.floor(Math.random() * SAMPLES.length);
    const candidates = SAMPLES.slice(0, n).map((s) => ({
      ...s,
      publishedAt: new Date().toISOString(),
      matchedEventId: null,
    }));
    const decisions = candidates.map((c, i) => ({
      candidate_ids: [c.candidateId],
      classification: i === 0 ? "new_event" : "duplicate",
      existing_event_id: null,
      fact: c.title,
      change: null,
      bubble: c.summary,
      source_candidate_id: c.candidateId,
      published_at: c.publishedAt,
      relevance_reason: "与你关注的 AI 工具方向相关",
    }));
    return {
      ok: true,
      candidates,
      decisions,
      queries: [{ topic: "演示", ok: true, count: n }],
      error: "",
      raw: "",
    };
  },
};
