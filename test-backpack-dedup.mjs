/**
 * 背包去重专项验证
 * 验收：
 *  - 背包是"已见过"的唯一账本（不再依赖 articles 表）
 *  - 同一消息反复搜到只进背包一次、只提醒一次
 *  - 用户从背包删除后，该 URL 可再次推荐
 *  - 背包内条目内容变化（实质新进展）会更新而不是重复插入
 *  - GitHub 热榜按背包去重
 */
import { runPipeline } from "./src/common/engines/pipeline.js";
import { engines } from "./src/common/engines/registry.js";
import { mergeDiscoveries, backpackIndex, isFreshCandidate } from "./src/common/discovery.js";
import { filterExcluded, needsChinese } from "./src/common/engines/github-recommend.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  \u2713 ${name}`); } else { fail++; console.log(`  \u2717 ${name}`); } };

function memStore(initial = {}) {
  const data = { articles: [], events: [], notifications: [], discoveries: [], watchTasks: [], candidateStatus: {}, pendingReview: [], ...initial };
  return { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, _data: data };
}
function mockEngine(candidates, decisions) {
  return { name: "mock", check: async () => ({ ok: true }), run: async () => ({ ok: true, candidates, decisions, queries: [], error: "", raw: "" }) };
}
const C = (id, url, title, extra = {}) => ({ candidateId: id, url, title, summary: "", source: "t.com", publishedAt: null, contentSnippet: "", matchedEventId: null, taskId: "", ...extra });
const D = (ids, cls, extra = {}) => ({ candidate_ids: ids, classification: cls, existing_event_id: null, fact: "", change: null, bubble: "\u6c14\u6ce1", source_candidate_id: ids[0], published_at: null, relevance_reason: null, watch_task_id: null, condition_met: false, ...extra });

console.log("\n=== 1. mergeDiscoveries \u6309 URL upsert ===");
{
  const base = mergeDiscoveries([], [
    { url: "https://a.com/1", title: "A", summary: "s1" },
    { url: "https://a.com/2", title: "B", summary: "s2" },
  ]);
  ok("\u65b0\u6761\u76ee\u5165\u5305", base.length === 2);
  ok("\u5e26\u6307\u7eb9", !!base[1].contentFingerprint);
  const again = mergeDiscoveries(base, [{ url: "https://a.com/1", title: "A", summary: "s1" }]);
  ok("\u540c URL \u540c\u6307\u7eb9\u4e0d\u91cd\u590d\u63d2\u5165", again.length === 2);
  const changed = mergeDiscoveries(base, [{ url: "https://a.com/1", title: "A", summary: "s1 \u65b0\u5185\u5bb9" }]);
  ok("\u540c URL \u6307\u7eb9\u53d8\u5316 -> \u4ecd\u662f 1 \u6761\uff08\u66f4\u65b0\uff09", changed.length === 2);
  ok("\u6307\u7eb9\u5df2\u66f4\u65b0", changed.find((d) => d.url === "https://a.com/1").contentFingerprint !== base.find((d) => d.url === "https://a.com/1").contentFingerprint);
}

console.log("\n=== 2. \u7ba1\u9053\uff1a\u540c\u4e00\u6d88\u606f\u53ea\u5904\u7406\u4e00\u6b21 ===");
{
  const store = memStore();
  const art = C("c0", "https://a.com/x", "\u67d0\u5de5\u5177\u53d1\u5e03 v1.0", { summary: "\u53d1\u5e03 v1.0" });
  engines.mock = mockEngine([art], [D(["c0"], "new_event", { fact: "\u53d1\u5e03 v1.0" })]);
  await runPipeline({ engine: "mock" }, store);
  const n1 = store.get("notifications").length;
  engines.mock = mockEngine([art], [D(["c0"], "new_event", { fact: "\u53d1\u5e03 v1.0" })]);
  const r2 = await runPipeline({ engine: "mock" }, store);
  ok("\u7b2c\u4e00\u6b21 1 \u6761\u901a\u77e5", n1 === 1);
  ok("\u7b2c\u4e8c\u6b21\u4e0d\u91cd\u590d\u901a\u77e5", store.get("notifications").length === 1);
  ok("\u7b2c\u4e8c\u6b21 items \u4e3a\u7a7a", r2.items.length === 0);
  ok("\u80cc\u5305\u53ea\u6709 1 \u6761", store.get("discoveries").length === 1);
}

console.log("\n=== 3. \u4ece\u80cc\u5305\u5220\u9664\u540e\u53ef\u518d\u6b21\u63a8\u8350\uff08articles \u8868\u4e0d\u518d\u62e6\u622a\uff09===");
{
  const store = memStore();
  const art = C("c0", "https://a.com/y", "\u67d0\u5de5\u5177\u53d1\u5e03", { summary: "\u4e0a\u7ebf" });
  engines.mock = mockEngine([art], [D(["c0"], "new_event", { fact: "\u4e0a\u7ebf" })]);
  await runPipeline({ engine: "mock" }, store);
  ok("\u7b2c\u4e00\u6b21\u5165\u5305", store.get("discoveries").length === 1);
  ok("articles \u8868\u4ecd\u8bb0\u5f55\u5386\u53f2", store.get("articles").length === 1);
  store.set("discoveries", []);
  engines.mock = mockEngine([art], [D(["c0"], "new_event", { fact: "\u4e0a\u7ebf" })]);
  const r3 = await runPipeline({ engine: "mock" }, store);
  ok("\u5220\u9664\u540e\u53ef\u518d\u6b21\u63a8\u8350", r3.items.length === 1);
  ok("\u91cd\u65b0\u5165\u5305", store.get("discoveries").length === 1);
}

console.log("\n=== 4. \u80cc\u5305\u5185\u6761\u76ee\u5185\u5bb9\u53d8\u5316 -> \u5b9e\u8d28\u65b0\u8fdb\u5c55 ===");
{
  const store = memStore();
  engines.mock = mockEngine([C("c0", "https://a.com/z", "\u5de5\u5177", { summary: "v1.0" })], [D(["c0"], "new_event", { fact: "v1.0" })]);
  await runPipeline({ engine: "mock" }, store);
  engines.mock = mockEngine([C("c0", "https://a.com/z", "\u5de5\u5177", { summary: "v2.0 \u5168\u91cf\u5f00\u653e" })], [D(["c0"], "new_event", { fact: "v2.0" })]);
  await runPipeline({ engine: "mock" }, store);
  ok("\u5185\u5bb9\u53d8\u5316 -> \u91cd\u65b0\u63d0\u9192", store.get("notifications").length === 2);
  ok("\u80cc\u5305\u4e0d\u91cd\u590d\u5806\u79ef", store.get("discoveries").length === 1);
}

console.log("\n=== 5. isFreshCandidate \u76f4\u63a5\u9a8c\u8bc1 ===");
{
  const idx = backpackIndex([{ url: "https://a.com/1", title: "A", summary: "s1" }]);
  ok("\u80cc\u5305\u6ca1\u6709 -> \u65b0", isFreshCandidate({ url: "https://a.com/9" }, idx) === true);
  ok("\u80cc\u5305\u6709\u4e14\u6307\u7eb9\u540c -> \u4e0d\u65b0", isFreshCandidate({ url: "https://a.com/1", title: "A", summary: "s1" }, idx) === false);
  ok("\u80cc\u5305\u6709\u4f46\u6307\u7eb9\u53d8 -> \u65b0", isFreshCandidate({ url: "https://a.com/1", title: "A", summary: "s2" }, idx) === true);
}

console.log("\n=== 6. GitHub \u70ed\u699c\u6309\u80cc\u5305\u53bb\u91cd ===");
{
  const trending = [
    { repo: "owner/hot", url: "https://github.com/owner/hot", desc: "d", lang: "TS", starsToday: 999, totalStars: 1 },
    { repo: "owner/cold", url: "https://github.com/owner/cold", desc: "d", lang: "Go", starsToday: 1, totalStars: 1 },
  ];
  const r1 = filterExcluded(trending, { excludeUrls: ["https://github.com/owner/hot"] });
  ok("\u80cc\u5305 URL \u53bb\u91cd\u751f\u6548", r1.length === 1 && r1[0].repo === "owner/cold");
  const r2 = filterExcluded(trending, { excludeRepos: ["owner/cold"] });
  ok("\u65e7\u53c2\u6570 excludeRepos \u4ecd\u53ef\u7528", r2.length === 1 && r2[0].repo === "owner/hot");
  const r3 = filterExcluded(trending, {});
  ok("\u65e0\u6392\u9664\u65f6\u5168\u90e8\u4fdd\u7559", r3.length === 2);
}

console.log("\n=== 7. 背包条目的中文简要介绍 ===");
{
  // 7a 模型给了 summary → 用它（即使原文是英文）
  const s1 = memStore();
  engines.mock = mockEngine(
    [C("c0", "https://a.com/s1", "Repo: do things with code", { summary: "Useful code repo." })],
    [D(["c0"], "new_event", { fact: "某仓库上线", bubble: "新仓库", summary: "一个用中文写的简介：它能帮你自动整理代码。" })]
  );
  const r1 = await runPipeline({ engine: "mock" }, s1);
  ok("7a 用模型写的中文简介", r1.items[0].summary === "一个用中文写的简介：它能帮你自动整理代码。");
  ok("7a 不是英文原文", !/Useful code repo/.test(r1.items[0].summary));

  // 7b 没有 summary 但有中文 fact → 用 fact
  const s2 = memStore();
  engines.mock = mockEngine(
    [C("c0", "https://a.com/s2", "Repo: do things", { summary: "English description." })],
    [D(["c0"], "new_event", { fact: "这个仓库把模型的每层拆到多张卡上训练，单卡显存更省。", bubble: "新仓库上线" })]
  );
  const r2 = await runPipeline({ engine: "mock" }, s2);
  ok("7b 退回用模型的事实描述", r2.items[0].summary.includes("单卡显存更省"));

  // 7c 都没有 → 用原文片段
  const s3 = memStore();
  engines.mock = mockEngine(
    [C("c0", "https://a.com/s3", "某工具发布", { summary: "原文摘要：新增了三项能力。" })],
    [D(["c0"], "new_event", { fact: "", bubble: "某工具发布" })]
  );
  const r3 = await runPipeline({ engine: "mock" }, s3);
  ok("7c 退回用原文摘要", r3.items[0].summary === "原文摘要：新增了三项能力。");
  ok("7c 气泡文案单独保存", r3.items[0].bubble === "某工具发布");
}

console.log("\n=== 8. 判断简介是否为中文 ===");
{
  ok("英文简介需要翻译", needsChinese("Vibe code with pi in a lightweight IDE.") === true);
  ok("中英混排但主要是英文", needsChinese("LIST OF ALL MY JAILBREAKS（未知语言，今日 +2055★）") === true);
  ok("中文简介不需要", needsChinese("紫微斗数开源排盘引擎，含完整排盘算法与四化系统。") === false);
  ok("空文本不处理", needsChinese("") === false);
}

console.log(`\n========== \u7ed3\u679c: ${pass} \u901a\u8fc7, ${fail} \u5931\u8d25 ==========\n`);
process.exit(fail > 0 ? 1 : 0);