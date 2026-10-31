/**
 * 批量生成六个动作图集（5x5，25 帧）
 * 用法: node scripts/gen-sheets.mjs [action ...]
 */
import { imageToImage, downloadImage } from "../test-api/image-api.mjs";
import { sheetPrompts } from "./prompts.js";
import path from "node:path";
import fs from "node:fs";

const OUT = path.join(process.cwd(), "assets", "pet");
fs.mkdirSync(OUT, { recursive: true });
const BASE = path.join(OUT, "character-base.png");

if (!fs.existsSync(BASE)) {
  console.error("缺少 character-base.png，请先运行 npm run gen:character");
  process.exit(1);
}

const only = process.argv.slice(2).filter(Boolean);
const actions = only.length ? only : Object.keys(sheetPrompts);

for (const action of actions) {
  if (!sheetPrompts[action]) { console.log(`[${action}] 未知动作，跳过`); continue; }
  const outPath = path.join(OUT, `${action}.png`);
  if (fs.existsSync(outPath)) { console.log(`[${action}] 已存在，跳过`); continue; }
  console.log(`\n=== [${action}] ===`);
  try {
    const result = await imageToImage(BASE, sheetPrompts[action], {
      size: "1024x1024",
      quality: "low",
      onTick: (st, el) => console.log(`  poll status=${st} elapsed=${el}s`),
    });
    await downloadImage(result.items[0], outPath);
    console.log(`  saved: ${outPath}`);
  } catch (e) {
    console.error(`  [${action}] 失败:`, e.message);
  }
}
console.log("\n=== 完成 ===");
