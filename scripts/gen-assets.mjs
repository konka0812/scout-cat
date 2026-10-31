/**
 * 素材生成脚本（基于中转站图生图）
 * 用法: node scripts/gen-assets.mjs <task> [inputImage] [outName]
 * task: character | idle | sleep | walk | discover | deliver | pet
 */
import { imageToImage, downloadImage } from "../test-api/image-api.mjs";
import { prompts } from "./prompts.js";
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "assets", "pet");
fs.mkdirSync(OUT, { recursive: true });

const task = process.argv[2];
const prompt = prompts[task];
if (!prompt) { console.error("unknown task:", task, "| available:", Object.keys(prompts).join(", ")); process.exit(1); }
const input = process.argv[3] || "longcat.png";
const outName = process.argv[4] || `${task}.png`;

console.log(`=== generating [${task}] ===`);
console.log(`  input: ${input}`);
const result = await imageToImage(input, prompt, { size: "1024x1024", quality: "medium", onTick: (st, el) => console.log("  poll status=" + st + " elapsed=" + el + "s") });
console.log("  result keys:", Object.keys(result));
console.log("  items len:", result.items?.length);
console.log("  raw:", JSON.stringify(result.raw).slice(0, 400));
const items = result.items;
const file = path.join(OUT, outName);
await downloadImage(items[0], file);
console.log("saved:", file);
