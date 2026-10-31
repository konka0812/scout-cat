/**
 * 审核反馈专项验证
 * 验收：同一消息只提醒一次 / 真实新进展才再提醒 / 搜索失败不当作没消息
 */
import { runPipeline } from "./src/common/engines/pipeline.js";
import { engines } from "./src/common/engines/registry.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

function memStore(initial = {}) {
  const data = { articles: [], events: [], notifications: [], discoveries: [], candidateStatus: [], pendingReview: [], ...initial };
  return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, _data: data };
}
function mockEngine(candidates, decisions) {
  return { name: "mock", check: async () => ({ ok: true }), run: async () => ({ ok: true, candidates, decisions, queries: [], error: "", raw: "" }) };
}
const C = (id, url, title, extra = {}) => ({ candidateId: id, url, title, summary: "", source: "t.com", publishedAt: null, contentSnippet: "", matchedEventId: null, taskId: "", ...extra });
const D = (ids, cls, extra = {}) => ({ candidate_ids: ids, classification: cls, existing_event_id: null, fact: "", change: null, bubble: "气泡", source_candidate_id: ids[0], published_at: null, relevance_reason: null, watch_task_id: null, condition_met: false, ...extra });

console.log("\n=== A. 同一消息反复搜到只提醒一次 ===");
{
  const store = memStore();
  const art = C("c0", "https://a.com/x", "某工具发布 v1.0", { summary: "发布 v1.0" });
  engines.mock = mockEngine([art], [D(["c0"], "new_event", { fact: "发布 v1.0" })]);
  await runPipeline({ engine: "mock" }, store);
  const ev1 = store.get("events").length;
  // 第二次：同一 URL、同一内容
  engines.mock = mockEngine([art], [D(["c0"], "new_event", { fact: "发布 v1.0" })]);
  const r2 = await runPipeline({ engine: "mock" }, store);
  ok("第一次创建 1 事件", ev1 === 1);
  ok("第二次不重复创建事件", store.get("events").length === 1);
  ok("第二次不重复通知", store.get("notifications").length === 1);
  ok("第二次 items 为空", r2.items.length === 0);
}

console.log("\n=== B. 内容变化才重新提醒（真实新进展）===");
{
  const store = memStore();
  engines.mock = mockEngine([C("c0", "https://a.com/x", "某工具", { summary: "v1.0" })], [D(["c0"], "new_event", { fact: "v1.0" })]);
  await runPipeline({ engine: "mock" }, store);
  // 内容变化（v1.0 → v2.0）
  engines.mock = mockEngine([C("c0", "https://a.com/x", "某工具", { summary: "v2.0 全量开放" })], [D(["c0"], "new_event", { fact: "v2.0" })]);
  await runPipeline({ engine: "mock" }, store);
  ok("内容变化后重新提醒", store.get("notifications").length === 2);
}

console.log("\n=== D. 搜索失败不当作没消息 ===");
{
  const store = memStore();
  engines.mock = { name: "mock", check: async () => ({ ok: false }), run: async () => ({ ok: false, candidates: [], decisions: [], queries: [{ topic: "AI", ok: false, error: "网络超时" }], error: "搜索失败：网络超时", raw: "" }) };
  const r = await runPipeline({ engine: "mock" }, store);
  ok("失败时 ok=false", r.ok === false);
  ok("失败时带错误信息", !!r.error && r.error.includes("搜索失败"));
  ok("失败时不产生 items", r.items.length === 0);
  ok("失败时不产生通知", store.get("notifications").length === 0);
}

console.log(`\n========== 结果: ${pass} 通过, ${fail} 失败 ==========\n`);
process.exit(fail > 0 ? 1 : 0);
