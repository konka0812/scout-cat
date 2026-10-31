import { openaiAdapter } from "./openai.js";

// 目前只有 OpenAI 兼容 + DeepSeek 搜索这一个引擎（演示模式已移除）
export const engines = {
  openai: openaiAdapter,
};

export function getEngine(name) {
  return engines[name] || openaiAdapter;
}

export function listEngines() {
  return Object.values(engines);
}
