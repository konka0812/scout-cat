import { openaiAdapter } from "./openai.js";
import { demoAdapter } from "./demo.js";

export const engines = {
  openai: openaiAdapter,
  demo: demoAdapter,
};

export function getEngine(name) {
  return engines[name] || demoAdapter;
}

export function listEngines() {
  return Object.values(engines);
}
