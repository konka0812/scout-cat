/**
 * 管道与去重逻辑测试（文档第 10 节最小验证集）
 * 运行: node test-pipeline.mjs
 */
import { runPipeline, validateDecisions } from "./src/common/engines/pipeline.js";
import { engines } from "./src/common/engines/registry.js";
import { normalizeUrl } from "./src/common/engines/normalize.js";
import { dedupByUrl, dedupByTitleSimilarity, relateToHistory } from "./src/common/engines/dedup.js";
import { parseDecisions } from "./src/common/engines/openai.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

/** 内存 store */
function memStore(initial = {}) {
  const data = { articles: [], events: [], notifications: [], discoveries: [], watchTasks: [], ...initial };
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; },
    _data: data,
  };
}

/** 注入 mock 引擎 */
function mockEngine(candidates, decisions) {
  return {
    name: "mock",
    check: async () => ({ ok: true }),
    run: async () => ({ ok: true, candidates, decisions, queries: [], error: "", raw: "" }),
  };
}

const C = (id, url, title, extra = {}) => ({
  candidateId: id, url, title, summary: "", source: "test.com", publishedAt: null, contentSnippet: "", matchedEventId: null, taskId: "", ...extra,
});
const D = (ids, classification, extra = {}) => ({
  candidate_ids: ids, classification, existing_event_id: null, fact: "", change: null, bubble: null,
  source_candidate_id: ids[0] || null, published_at: null, relevance_reason: null, ...extra,
});

console.log("\n=== 1. URL 规范化 ===");
ok("去跟踪参数", normalizeUrl("https://a.com/p?utm_source=x&id=1") === "https://a.com/p?id=1");
ok("去 hash", normalizeUrl("https://a.com/p#sec") === "https://a.com/p");
ok("小写 host", normalizeUrl("https://WWW.A.com/p") === "https://www.a.com/p");
ok("去末尾斜杠", normalizeUrl("https://a.com/p/") === "https://a.com/p");

console.log("\n=== 2. URL 级去重（验证集 1）===");
const dup1 = [C("c0", "https://a.com/news"), C("c1", "https://a.com/news")];
const r2 = dedupByUrl(dup1);
ok("同 URL 只保留一条", r2.kept.length === 1);
ok("重复项被丢弃", r2.dropped.length === 1);

console.log("\n=== 3. 标题相似去重（验证集 2/3）===");
const dup3 = [
  C("c0", "https://a.com/1", "某视频工具开放参考图上传试用"),
  C("c1", "https://b.com/2", "某视频工具开放参考图上传试用 最新消息"),
];
const r3 = dedupByTitleSimilarity(dup3);
ok("标题高度相似合并", r3.kept.length === 1);

console.log("\n=== 4. 不同版本不合并（验证集 4）===");
const dup4 = [
  C("c0", "https://a.com/v1", "项目发布 v1.0 正式版"),
  C("c1", "https://a.com/v2", "项目发布 v2.0 正式版"),
];
const r4 = dedupByTitleSimilarity(dup4);
ok("不同版本不误合并", r4.kept.length === 2);

console.log("\n=== 5. 历史事件关联（验证集 5/6）===");
const historyEv = [{
  id: "ev-1", knownFacts: "某视频工具发布测试版", status: "active",
  relatedArticles: ["https://old.com/a"], subject: "某视频工具", lastSubstantiveUpdate: "发布测试版",
}];
const rel1 = [C("c0", "https://new.com/a", "某视频工具开放所有用户试用")];
const r5 = relateToHistory(rel1, historyEv);
ok("语义相关关联到已有事件", r5[0] === "ev-1");
const rel2 = [C("c1", "https://new.com/b", "某视频工具测试版发布 媒体报道")];
const r5b = relateToHistory(rel2, historyEv);
ok("重复转述也关联（由模型判 duplicate）", r5b[0] === "ev-1");

console.log("\n=== 6. decisions 解析 ===");
const parsed = parseDecisions("```json\n{\"decisions\":[{\"candidate_ids\":[\"c0\"],\"classification\":\"new_event\"}]}\n```");
ok("从代码块解析", parsed.decisions.length === 1 && parsed.decisions[0].classification === "new_event");
const parsedEmpty = parseDecisions('{"decisions":[]}');
ok("空数组是有效无推荐", parsedEmpty.decisions.length === 0 && !parsedEmpty.error);
const parsedBad = parseDecisions("not json at all");
ok("无效 JSON 报错", !!parsedBad.error);

console.log("\n=== 7. 管道：新事件创建 ===");
{
  const store = memStore();
  const eng = mockEngine(
    [C("c0", "https://news.com/a", "AI 工具新发布", { summary: "新工具上线", source: "news.com" })],
    [D(["c0"], "new_event", { fact: "某 AI 工具正式发布", bubble: "你关注的工具上线了", source_candidate_id: "c0", published_at: "2026-10-30T00:00:00Z" })]
  );
  engines.mock = eng;
  const r = await runPipeline({ engine: "mock", interests: ["AI"] }, store);
  ok("管道成功", r.ok === true);
  ok("创建 1 个事件", store.get("events").length === 1);
  ok("生成 1 条通知", store.get("notifications").length === 1);
  ok("落库 1 篇文章", store.get("articles").length === 1);
  ok("items 有 1 条", r.items.length === 1);
  ok("事件有 ID", !!store.get("events")[0].id);
  ok("通知有 bubble", !!store.get("notifications")[0].bubble);
}

console.log("\n=== 8. 管道：重复报道不重复通知（验证集 1）===");
{
  const store = memStore();
  const eng = mockEngine(
    [C("c0", "https://news.com/a", "AI 工具新发布")],
    [D(["c0"], "new_event", { fact: "某 AI 工具正式发布", bubble: "上线了" })]
  );
  engines.mock = eng;
  await runPipeline({ engine: "mock" }, store);
  const firstCount = store.get("notifications").length;
  // 第二轮：同样的 URL，模型判 duplicate
  const eng2 = mockEngine(
    [C("c0", "https://news.com/a", "AI 工具新发布")],
    [D(["c0"], "duplicate", { fact: "重复报道" })]
  );
  engines.mock = eng2;
  await runPipeline({ engine: "mock" }, store);
  ok("第二轮不新增通知", store.get("notifications").length === firstCount);
  ok("事件数不变", store.get("events").length === 1);
}

console.log("\n=== 9. 管道：实质进展提醒一次（验证集 5）===");
{
  const store = memStore();
  const eng1 = mockEngine(
    [C("c0", "https://news.com/a", "工具发布测试版")],
    [D(["c0"], "new_event", { fact: "发布测试版", bubble: "开始测试了" })]
  );
  engines.mock = eng1;
  await runPipeline({ engine: "mock" }, store);
  const evId = store.get("events")[0].id;
  // 第二轮：实质进展
  const eng2 = mockEngine(
    [C("c1", "https://news.com/b", "工具开放所有用户")],
    [D(["c1"], "substantive_update", { existing_event_id: evId, fact: "所有用户开放", change: "从测试版到全量开放", bubble: "现在所有人都能用了" })]
  );
  engines.mock = eng2;
  await runPipeline({ engine: "mock" }, store);
  ok("实质进展生成新通知", store.get("notifications").length === 2);
  ok("事件被更新", store.get("events")[0].lastSubstantiveUpdate === "所有用户开放");
  // 第三轮：同样的进展再来 → 幂等
  engines.mock = eng2;
  await runPipeline({ engine: "mock" }, store);
  ok("同进展不重复通知（幂等）", store.get("notifications").length === 2);
}

console.log("\n=== 10. 管道：非法 ID 拒绝（验证集 10）===");
{
  const store = memStore();
  const eng = mockEngine(
    [C("c0", "https://news.com/a", "新闻A"), C("c1", "https://news.com/b", "新闻B")],
    [
      D(["c0"], "new_event", { source_candidate_id: "c0" }),
      D(["nonexistent"], "new_event", { source_candidate_id: "nonexistent" }),
      D(["c1"], "substantive_update", { existing_event_id: "ev-nonexistent" }),
    ]
  );
  engines.mock = eng;
  const r = await runPipeline({ engine: "mock" }, store);
  ok("合法决策被处理", r.processed.created === 1);
  ok("非法 ID 被拒绝", r.processed.rejected === 2);
}

console.log("\n=== 11. 管道：uncertain 不提醒（验证集 7）===");
{
  const store = memStore();
  const eng = mockEngine(
    [C("c0", "https://news.com/a", "证据不足的新闻")],
    [D(["c0"], "uncertain", { fact: "来源不足", bubble: null })]
  );
  engines.mock = eng;
  const r = await runPipeline({ engine: "mock" }, store);
  ok("uncertain 不进通知", store.get("notifications").length === 0);
  ok("items 为空", r.items.length === 0);
  ok("标记为 uncertain", r.processed.uncertain === 1);
}

console.log("\n=== 12. 管道：缺日期仍可入库但不强制提醒（验证集 7）===");
{
  const store = memStore();
  const eng = mockEngine(
    [C("c0", "https://news.com/a", "无日期新闻")],
    [D(["c0"], "new_event", { fact: "无发布时间", bubble: null, published_at: null })]
  );
  engines.mock = eng;
  const r = await runPipeline({ engine: "mock" }, store);
  ok("缺日期仍创建事件", store.get("events").length === 1);
  ok("无 bubble 时不提醒", r.items[0]?.shouldNotify === false);
}

console.log("\n=== 13. 管道：重复候选批内去重（验证集 10）===");
{
  const store = memStore();
  const eng = mockEngine(
    [C("c0", "https://a.com/1", "新闻A"), C("c1", "https://b.com/2", "新闻A转载")],
    [D(["c0", "c1"], "new_event", { fact: "同一事件多篇报道", bubble: "一次提醒", source_candidate_id: "c0" })]
  );
  engines.mock = eng;
  const r = await runPipeline({ engine: "mock" }, store);
  ok("批内多候选合并为一个事件", store.get("events").length === 1);
  ok("只生成一条通知", store.get("notifications").length === 1);
  ok("事件关联两个来源", store.get("events")[0].relatedArticles.length === 2);
}

console.log(`
========== 结果: ${pass} 通过, ${fail} 失败 ==========
`);
process.exit(fail > 0 ? 1 : 0);
