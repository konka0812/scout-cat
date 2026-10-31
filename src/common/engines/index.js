import { buildPatrolPrompt } from "./prompt.js";
import { getEngine, listEngines } from "./registry.js";
import { runPipeline } from "./pipeline.js";

/** 执行一次完整巡逻（委托给 pipeline） */
export async function runPatrol(cfg) {
  return runPipeline(cfg);
}

/** 兼容：单引擎运行（保留给测试用） */
export async function runWithEngine(name, cfg) {
  const engine = getEngine(name);
  const prompt = buildPatrolPrompt({
    interests: cfg.interests,
    blockedTopics: cfg.blockedTopics,
    lastCheck: cfg.lastCheck,
    now: new Date().toISOString(),
  });
  return engine.run({ prompt, timeoutMs: 300000, cfg });
}

export async function checkEngine(name, cfg = {}) {
  const engine = getEngine(name);
  return engine.check(cfg);
}

export { listEngines, getEngine };
