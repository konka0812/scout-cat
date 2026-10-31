const canvas = document.getElementById("pet");
const ctx = canvas.getContext("2d");
const bubbleEl = document.getElementById("bubble");
const fallbackEl = document.getElementById("fallback");

const GRID = 5;
const FPS = 12;
const FRAME_MS = 1000 / FPS;
const TOTAL = GRID * GRID;
const ACTIONS = ["idle", "sleep", "walk", "discover", "deliver", "pet"];
const SINGLE_SHOT = new Set(["discover", "deliver", "pet"]);

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

/** 裁切精灵表第 0 帧，返回 canvas 作为程序动画的单帧源 */
function cropFrame(img, grid = GRID) {
  const w = Math.round((img.naturalWidth || img.width) / grid);
  const h = Math.round((img.naturalHeight || img.height) / grid);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  // 9 参数：源 (0,0,w,h) → 目标 (0,0,w,h)，才是裁切；3 参数是缩放（错误）
  c.getContext("2d").drawImage(img, 0, 0, w, h, 0, 0, w, h);
  return c;
}

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

  const ok = await loadSheet("idle");
  if (!ok) {
    fallbackEl.style.display = "flex";
    canvas.style.display = "none";
  } else {
    fallbackEl.style.display = "none";
  }
  for (const a of ACTIONS) if (a !== "idle") loadSheet(a);
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
  const src = (await tryLoad(`${action}.png`)) || (await tryLoad("character-base.png"));
  if (!src) return false;

  if (cfg.mode === "prog") {
    // 程序动画：裁切第 0 帧，配合正弦运动（流畅）
    sheets[action] = cropFrame(src);
    singleFrame[action] = true;
    return true;
  }
  // 精灵表：整图 5×5 顺序播放
  sheets[action] = src;
  singleFrame[action] = false;
  return true;
}

function drawSheet(img, W, H, t) {
  const fw = img.naturalWidth / GRID;
  const fh = img.naturalHeight / GRID;
  const frame = Math.min(fw, fh);
  const size = Math.min(256, W * 0.86);
  const x = (W - size) / 2;
  const y = H - size;
  const col = frameIndex % GRID;
  const row = Math.floor(frameIndex / GRID) % GRID;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, col * fw, row * fh, fw, fh, x, y, size, size);
}

/** 程序动画：呼吸 + 浮动 + 眨眼（正弦驱动，流畅无抖动） */
function drawProg(img, W, H, t, cfg = {}) {
  const breath = 1 + (cfg.breathAmp ?? 0.018) * Math.sin((t / (cfg.breathPeriod ?? 2600)) * Math.PI * 2);
  const bob = (cfg.bobAmp ?? 2) * Math.sin((t / (cfg.bobPeriod ?? 3600)) * Math.PI * 2);
  const blinkState = cfg.blink ? updateBlink() : false;

  const maxW = W * 0.86;
  const maxH = H * 0.72;
  const base = Math.min(maxW, maxH, 256);
  const size = base * breath;
  const x = (W - size) / 2;
  const y = H - size - H * 0.04 + bob;

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, x, y, size, size);

  if (blinkState) {
    ctx.save();
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = Math.max(1.5, size * 0.012);
    ctx.lineCap = "round";
    const ey = y + size * 0.3;
    const e1x = x + size * 0.38;
    const e2x = x + size * 0.62;
    ctx.beginPath();
    ctx.moveTo(e1x - size * 0.045, ey);
    ctx.lineTo(e1x + size * 0.045, ey);
    ctx.moveTo(e2x - size * 0.045, ey);
    ctx.lineTo(e2x + size * 0.045, ey);
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
  const img = sheets[currentAction];
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
  else drawSheet(img, W, H, t);
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
  const px = x - rect.left;
  const py = y - rect.top;
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;
  try {
    const d = ctx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
    return d[3] > 24;
  } catch {
    return true;
  }
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
    if (dragging) {
      window.scoutcat.movePet(e.screenX - dragOffset.x, e.screenY - dragOffset.y);
      return;
    }
    const now = performance.now();
    if (now - hitThrottle < 40) return;
    hitThrottle = now;
    window.scoutcat.setClickThrough(!hitTest(e.clientX, e.clientY));
  });

  document.addEventListener("mousedown", async (e) => {
    if (!hitTest(e.clientX, e.clientY)) return;
    if (!winBounds) await refreshBounds();
    dragging = true;
    dragOffset.x = e.screenX - (winBounds?.x ?? 0);
    dragOffset.y = e.screenY - (winBounds?.y ?? 0);
    window.scoutcat.setClickThrough(false);
    play("walk");
  });

  document.addEventListener("mouseup", async () => {
    if (!dragging) return;
    dragging = false;
    await refreshBounds();
    window.scoutcat.setClickThrough(true);
    play("pet");
    // 边缘停靠：靠近屏幕边缘时由主进程自动吸附
    try {
      await window.scoutcat.dockPet();
    } catch { /* 停靠失败忽略 */ }
  });

  document.addEventListener("mouseleave", () => {
    if (!dragging) window.scoutcat.setClickThrough(true);
  });

  // 双击 → 打开背包
  document.addEventListener("dblclick", (e) => {
    if (!hitTest(e.clientX, e.clientY)) return;
    window.scoutcat.setClickThrough(false);
    window.scoutcat.openBackpack();
  });

  // 右键 → 打开设置
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!hitTest(e.clientX, e.clientY)) return;
    window.scoutcat.setClickThrough(false);
    window.scoutcat.openSettings();
  });
}

let bubbleDurationMs = 30000;   // 气泡显示时长（从设置读取）

async function loadBubbleConfig() {
  try {
    const cfg = await window.scoutcat.getBubbleConfig();
    bubbleDurationMs = (cfg.durationSec || 30) * 1000;
  } catch { /* 忽略 */ }
}

function showBubble(message) {
  if (!message) return hideBubble();
  currentBubble = message;
  bubbleEl.innerHTML = "";
  const div = document.createElement("div");
  div.className = "text";
  const isGithub = String(message.url || "").includes("github.com");
  // GitHub 条目标题只是 "xxx — GitHub 今日热榜"，气泡用简介更有用
  const bubbleText = isGithub
    ? message.summary || message.title || ""
    : message.bubble || message.title || "";
  div.textContent = bubbleText.length > 90 ? bubbleText.slice(0, 90) + "…" : bubbleText;
  const span = document.createElement("span");
  span.className = "src";
  span.textContent = message.source || "";
  bubbleEl.appendChild(div);
  bubbleEl.appendChild(span);
  bubbleEl.classList.add("show");
  window.scoutcat.setClickThrough(false);   // 气泡显示时禁用穿透，保证可点击
  play("deliver");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, bubbleDurationMs);
}

function hideBubble() {
  bubbleEl.classList.remove("show");
  currentBubble = null;
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
