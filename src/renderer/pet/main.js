const canvas = document.getElementById("pet");
const ctx = canvas.getContext("2d");
const bubbleEl = document.getElementById("bubble");

const GRID = 5;
const FPS = 12;
const FRAME_MS = 1000 / FPS;
const TOTAL = GRID * GRID;
const ACTIONS = ["idle", "sleep", "walk", "discover", "deliver", "pet"];
const SINGLE_SHOT = new Set(["discover", "deliver", "pet"]);

// 精灵表单帧原始 205px（1024/5）。基准窗口 320 宽 → 占比 0.6406。
// 渲染尺寸 = 窗口尺寸 × 这个比例，所以「缩放」设置改窗口大小时猫会跟着变。
const FRAME_NATURAL = 205;
const BASE_WIN_W = 320;
const FRAME_RATIO = FRAME_NATURAL / BASE_WIN_W;

/** 猫的渲染高度：宠物区高度 - 上下固定边距 */
function spriteHeight() {
  return Math.max(24, petArea.h - 16);
}

// ===== 动画配置 =====
// prog = 单帧 + 程序动画（正弦呼吸/浮动，流畅无抖动）
// sheet = 5×5 精灵表（单次动作，顺序播放）
const ANIM = {
  idle:     { mode: "prog", breathAmp: 0.018, breathPeriod: 2600, bobAmp: 2.0, bobPeriod: 3600, blink: true  },
  sleep:    { mode: "prog", breathAmp: 0.032, breathPeriod: 5200, bobAmp: 0.8, bobPeriod: 6000, blink: false },
  walk:     { mode: "prog", breathAmp: 0.010, breathPeriod: 1600, bobAmp: 3.2, bobPeriod: 800,  blink: true  },
  discover: { mode: "sheet" },
  deliver:  { mode: "sheet" },
  pet:      { mode: "sheet" },
};

/** 裁掉画布周围的透明留白，返回紧贴内容的画布 */
function trim(canvas, threshold = 24) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let top = -1, bottom = -1, left = -1, right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > threshold) {
        if (top < 0) top = y;
        bottom = y;
        if (left < 0 || x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (top < 0) return canvas;
  const c = document.createElement("canvas");
  c.width = right - left + 1;
  c.height = bottom - top + 1;
  c.getContext("2d").drawImage(canvas, left, top, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/** 裁切精灵表第 0 帧并去掉留白，作为程序动画的单帧源 */
function cropFrame(img, grid = GRID) {
  const w = Math.round((img.naturalWidth || img.width) / grid);
  const h = Math.round((img.naturalHeight || img.height) / grid);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  // 9 参数：源 (0,0,w,h) → 目标 (0,0,w,h)，才是裁切；3 参数是缩放（错误）
  c.getContext("2d").drawImage(img, 0, 0, w, h, 0, 0, w, h);
  return trim(c);
}

/** 精灵表逐帧裁切并去留白 */
function cropSheet(img, grid = GRID) {
  const fw = Math.round((img.naturalWidth || img.width) / grid);
  const fh = Math.round((img.naturalHeight || img.height) / grid);
  const frames = [];
  for (let i = 0; i < grid * grid; i++) {
    const col = i % grid;
    const row = Math.floor(i / grid);
    const tmp = document.createElement("canvas");
    tmp.width = fw; tmp.height = fh;
    tmp.getContext("2d").drawImage(img, col * fw, row * fh, fw, fh, 0, 0, fw, fh);
    frames.push(trim(tmp));
  }
  return frames;
}

let petArea = { w: 320, h: 380 };   // 宠物区尺寸（不含气泡区），主进程下发
let petDir = "";
let sheets = {};      // action -> Image
let singleFrame = {}; // action -> bool（true 表示用单帧 + 程序动画）
let currentAction = "idle";
let frameIndex = 0;
let lastFrameTime = 0;
let bubbleTimer = null;
let currentBubble = null;
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let winBounds = null;
let hitThrottle = 0;
let blinkUntil = 0;
let nextBlink = 4000;

async function init() {
  try {
    petDir = await window.scoutcat.getPetDir();
  } catch {
    petDir = "";
  }

  // 素材缺失就跳过该动作，不回退到别的图
  for (const a of ACTIONS) loadSheet(a);
  reportHitRect();
  window.addEventListener("resize", reportHitRect);
  loadBubbleConfig();
  requestAnimationFrame(loop);
  setupInteraction();
  setupEvents();
}

/** 加载动作；prog 模式裁切第 0 帧做程序动画，sheet 模式用整张精灵表 */
async function loadSheet(action) {
  if (action in sheets) return true;
  const cfg = ANIM[action] || {};
  const tryLoad = async (file) => {
    const img = new Image();
    img.src = `${petDir}${file}`;
    try {
      await img.decode();
      return img;
    } catch {
      return null;
    }
  };
  const src = await tryLoad(`${action}.png`);
  if (!src) return false;   // 缺素材就跳过该动作，不回退到别的图

  if (cfg.mode === "prog") {
    // 程序动画：裁切第 0 帧（已去留白），配合正弦运动（流畅）
    sheets[action] = cropFrame(src);
    singleFrame[action] = true;
    reportHitRect();
    return true;
  }
  // 精灵表：逐帧裁切并去留白
  sheets[action] = cropSheet(src);
  singleFrame[action] = false;
  reportHitRect();
  return true;
}

function drawSheet(frames, winW, winH) {
  const img = frames[frameIndex % frames.length];
  const h = spriteHeight();
  const w = Math.round(h * (img.width / img.height));
  const x = (winW - w) / 2;
  const y = winH - 8 - h;
  ctx.clearRect(0, 0, winW, winH);
  ctx.drawImage(img, x, y, w, h);
  return { x, y, w, h };
}

/** 程序动画：呼吸 + 浮动 + 眨眼（正弦驱动，流畅无抖动） */
function drawProg(img, winW, winH, t, cfg = {}) {
  const breath = 1 + (cfg.breathAmp ?? 0.018) * Math.sin((t / (cfg.breathPeriod ?? 2600)) * Math.PI * 2);
  const bob = (cfg.bobAmp ?? 2) * Math.sin((t / (cfg.bobPeriod ?? 3600)) * Math.PI * 2);
  const blinkState = cfg.blink ? updateBlink() : false;

  const h = spriteHeight() * breath;
  const w = Math.round(h * (img.width / img.height));
  const x = (winW - w) / 2;
  const y = winH - 8 - h + bob;

  ctx.clearRect(0, 0, winW, winH);
  ctx.drawImage(img, x, y, w, h);

  if (blinkState) {
    ctx.save();
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = Math.max(1.5, h * 0.012);
    ctx.lineCap = "round";
    const ey = y + h * 0.3;
    const e1x = x + w * 0.38;
    const e2x = x + w * 0.62;
    ctx.beginPath();
    ctx.moveTo(e1x - w * 0.045, ey);
    ctx.lineTo(e1x + w * 0.045, ey);
    ctx.moveTo(e2x - w * 0.045, ey);
    ctx.lineTo(e2x + w * 0.045, ey);
    ctx.stroke();
    ctx.restore();
  }
}

function updateBlink() {
  const now = performance.now();
  if (now > nextBlink && !blinkUntil) {
    blinkUntil = now + 130;
    nextBlink = now + 2600 + Math.random() * 3200;
  }
  if (blinkUntil && now > blinkUntil) blinkUntil = 0;
  return Boolean(blinkUntil);
}

function drawFrame(t = performance.now()) {
  const stored = sheets[currentAction];
  if (!stored) return;
  // 精灵表存的是帧数组，程序动画是单张
  const img = Array.isArray(stored) ? stored[frameIndex % stored.length] : stored;
  if (!img || !(img.naturalWidth || img.width)) return;
  const W = canvas.clientWidth || 320;
  const H = canvas.clientHeight || 381;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cfg = ANIM[currentAction] || {};
  if (cfg.mode === "prog") drawProg(img, W, H, t, cfg);
  else drawSheet(stored, W, H);
}

function loop(t) {
  const cfg = ANIM[currentAction] || {};
  const isProg = cfg.mode === "prog";
  // prog：30fps 正弦动画（流畅省电）；sheet：12fps 按精灵表帧率
  const interval = isProg ? 33 : FRAME_MS;
  if (t - lastFrameTime >= interval) {
    lastFrameTime = t;
    if (!isProg) frameIndex = (frameIndex + 1) % TOTAL;
    drawFrame(t);
  }
  requestAnimationFrame(loop);
}

function play(action) {
  if (!ACTIONS.includes(action)) action = "idle";
  currentAction = action;
  frameIndex = 0;
  lastFrameTime = 0;
  drawFrame();
  if (SINGLE_SHOT.has(action)) {
    setTimeout(() => {
      if (currentAction === action) play("idle");
    }, 2200);
  }
}

function hitTest(x, y) {
  const rect = canvas.getBoundingClientRect();
  // canvas.width/height 是设备像素（×dpr），而 clientX/Y 是 CSS 像素
  const dpr = window.devicePixelRatio || 1;
  const px = (x - rect.left) * dpr;
  const py = (y - rect.top) * dpr;
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
  try {
    const d = ctx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
    return d[3] > 24;
  } catch {
    return true;
  }
}

/** 把气泡尺寸报给主进程，主进程据此把窗口长高，避免气泡压到猫 */
function reportBubbleSize(visible) {
  const b = bubbleEl.getBoundingClientRect();
  try {
    window.scoutcat.setBubbleSize({
      visible,
      w: Math.ceil(b.width),
      h: visible ? Math.ceil(b.height) : 0,
    });
  } catch { /* 忽略 */ }
}

/** 把猫的碰撞矩形（窗口内 CSS 坐标）报给主进程，用于判断光标是否在身上 */
function reportHitRect() {
  const winW = canvas.clientWidth || petArea.w;
  const winH = canvas.clientHeight || petArea.h;
  const h = spriteHeight();
  const stored = sheets[currentAction] || sheets.idle;
  if (!stored) return;   // 素材还没加载完，等加载完再报
  const first = Array.isArray(stored) ? stored[0] : stored;
  if (!first) return;
  const w = Math.round(h * (first.width / first.height));
  const rect = {
    x: (winW - w) / 2,
    y: winH - 8 - h - 8,
    w,
    h: h + 8,
  };
  try { window.scoutcat.setHitRect(rect); } catch { /* 忽略 */ }
}

async function refreshBounds() {
  try {
    winBounds = await window.scoutcat.getPetBounds();
  } catch {
    winBounds = null;
  }
}

function setupInteraction() {
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    window.scoutcat.movePet(e.screenX - dragOffset.x, e.screenY - dragOffset.y);
  });

  document.addEventListener("mousedown", async (e) => {
    if (!hitTest(e.clientX, e.clientY)) return;
    if (!winBounds) await refreshBounds();
    dragging = true;
    dragOffset.x = e.screenX - (winBounds?.x ?? 0);
    dragOffset.y = e.screenY - (winBounds?.y ?? 0);
    play("walk");
  });

  document.addEventListener("mouseup", async () => {
    if (!dragging) return;
    dragging = false;
    await refreshBounds();
    play("pet");
    // 边缘停靠：靠近屏幕边缘时由主进程自动吸附
    try {
      await window.scoutcat.dockPet();
    } catch { /* 停靠失败忽略 */ }
  });

  // 双击 → 打开背包
  document.addEventListener("dblclick", (e) => {
    if (!hitTest(e.clientX, e.clientY)) return;
    window.scoutcat.openBackpack();
  });

  // 右键 → 打开设置
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!hitTest(e.clientX, e.clientY)) return;
    window.scoutcat.openSettings();
  });
}

let bubbleDurationMs = 30000;   // 气泡显示时长（从设置读取）

async function loadBubbleConfig() {
  try {
    const cfg = await window.scoutcat.getBubbleConfig();
    bubbleDurationMs = (cfg.durationSec || 30) * 1000;
    if (cfg.petArea) petArea = cfg.petArea;
  } catch { /* 忽略 */ }
}

function showBubble(message) {
  if (!message) return hideBubble();
  currentBubble = message;
  bubbleEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "text";
  // GitHub 条目标题只是 "xxx — GitHub 今日热榜"，气泡用简介更有用
  const bubbleText = message.summary || message.bubble || message.title || "";
  div.textContent = bubbleText.length > 90 ? bubbleText.slice(0, 90) + "…" : bubbleText;
  const span = document.createElement("span");
  span.className = "src";
  span.textContent = message.source || "";
  bubbleEl.appendChild(div);
  bubbleEl.appendChild(span);
  bubbleEl.classList.add("show");
  reportBubbleSize(true);
  window.scoutcat.setClickThrough(false);   // 气泡显示时禁用穿透，保证可点击
  play("deliver");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, bubbleDurationMs);
}

function hideBubble() {
  bubbleEl.classList.remove("show");
  currentBubble = null;
  reportBubbleSize(false);
  window.scoutcat.setClickThrough(true);    // 气泡隐藏后恢复穿透
  try { window.scoutcat.notifyBubbleHidden(); } catch { /* 忽略 */ }
}

bubbleEl.addEventListener("click", () => {
  if (currentBubble?.url) window.scoutcat.openUrl(currentBubble.url);
  hideBubble();
});

function setupEvents() {
  window.scoutcat.onPetAction((a) => play(a));
  window.scoutcat.onBubble((m) => (m ? showBubble(m) : hideBubble()));
}

init();
