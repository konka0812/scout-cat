/**
 * 重新生成六个动作的 5×5 精灵图
 *
 * 用法：
 *   set IMAGE_API_KEY=sk-xxx      （必填，不写进仓库）
 *   set IMAGE_API_BASE=https://api.ai-media.vip/v1   （可选）
 *   set CHARACTER_BASE=assets/pet/character-base.png （可选）
 *   node scripts/gen-sheets.mjs
 *
 * 关键在提示词里强调「同一角色、同一大小、同一位置，只有姿势变化」，
 * 这样 25 帧构图才一致，动画不会有缩放感。
 * 程序侧还有一层兜底：渲染时会把每帧内容归一化到统一高度并居中。
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const BASE = process.env.IMAGE_API_BASE || "https://api.ai-media.vip/v1";
const KEY = process.env.IMAGE_API_KEY || "";
const CHARACTER_BASE = process.env.CHARACTER_BASE || "assets/pet/character-base.png";
const OUT_DIR = "assets/pet";
const PROXY = process.env.IMAGE_PROXY || "http://127.0.0.1:7897";

if (!KEY) {
  console.error("请先设置 IMAGE_API_KEY（不要提交到仓库）");
  process.exit(1);
}
if (!fs.existsSync(CHARACTER_BASE)) {
  console.error(`找不到角色标准图：${CHARACTER_BASE}`);
  process.exit(1);
}

const ACTIONS = {
  idle:    "待机：站立，轻微呼吸，偶尔眨眼",
  sleep:   "睡觉：蜷缩趴着，闭眼，轻微起伏",
  walk:    "行走：迈步循环，四肢交替",
  discover:"发现：突然抬头竖耳，睁大眼睛，一只前爪抬起指着某处",
  deliver: "报信：站立，双手举着一份报纸/信件",
  pet:     "被摸：眯眼享受，头微微歪向一侧",
};

/** 生成一张 5×5 精灵图（1024x1024，每格 205px） */
async function genSheet(action, desc) {
  const prompt = [
    "生成一张 5x5 的动画精灵图表（sprite sheet），共 25 帧，从左到右、从上到下排列。",
    `动作内容：${desc}。`,
    "严格要求：",
    "1. 每一帧都是同一个角色，外观、配色、服饰完全一致；",
    "2. 角色在每一帧里的大小、位置、在格子中的占比完全一致，不要忽大忽小、不要偏移；",
    "3. 只有姿势和表情在变化，构成一段连贯流畅的动画；",
    "4. 纯白背景，角色完整落在格子内，四周留出均匀边距；",
    "5. 插画风格，干净清晰。",
  ].join("\n");

  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("quality", "high");
  form.append("n", "1");
  form.append("image", new Blob([fs.readFileSync(CHARACTER_BASE)], { type: "image/png" }),
    path.basename(CHARACTER_BASE));

  console.log(`  提交 ${action} …`);
  const res = await fetch(`${BASE.replace(/\/$/, "")}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

  const item = (data.data || [])[0];
  const url = item?.b64_json ? null : item?.url;
  let buf;
  if (item?.b64_json) {
    buf = Buffer.from(item.b64_json, "base64");
  } else if (url) {
    // 下载走代理（直连会超时）
    const tmp = path.join(process.env.TEMP || ".", `gen-${action}.png`);
    await execFileP("curl", ["-sS", "-x", PROXY, "-o", tmp, url]);
    buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
  } else {
    throw new Error(`未拿到图片：${JSON.stringify(data).slice(0, 200)}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, `${action}.png`), buf);
  console.log(`  ✓ ${action}.png  (${(buf.length / 1024).toFixed(0)} KB)`);
}

console.log(`接口：${BASE}`);
console.log(`角色参考：${CHARACTER_BASE}`);
for (const [action, desc] of Object.entries(ACTIONS)) {
  await genSheet(action, desc);
}
console.log("\n全部生成完成。渲染层会自动把每帧归一化到统一高度并居中。");