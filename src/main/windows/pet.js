import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const WIN_W = 320;
// 精灵表单帧 205px（1024/5）
const FRAME_RATIO = 205 / 320;
// 猫上方的固定边距（不随缩放变化）——这样气泡永远贴在猫上方，
// 不会因为缩放越大被推得越远。
const PET_MARGIN = 24;

/** 宠物区高度 = 精灵高 + 固定边距 */
function petHeight(scale) {
  return Math.round(WIN_W * scale * FRAME_RATIO) + PET_MARGIN;
}

function rendererUrl(name) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev}${name}/`;
  return join(__dirname, "..", "renderer", name, "index.html");
}

export class PetWindow {
  constructor({ scale = 1 } = {}) {
    const { workArea } = screen.getPrimaryDisplay();
    // 启动时就读 settings.pet.scale，之前只在设置界面改才生效
    this.scale = Math.max(0.5, Number(scale) || 1);
    const w = Math.round(WIN_W * this.scale);
    const h = petHeight(this.scale);
    const win = new BrowserWindow({
      width: w,
      height: h,
      x: workArea.width - w - 48,
      y: workArea.height - h - 48,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: false,
      title: "scout-cat-pet",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true, { forward: true });
    // 内容尺寸会把系统最小窗口抬到当前大小，导致放大后缩不回去
    win.setMinimumSize(1, 1);
    win.loadURL(rendererUrl("pet"));
    this.win = win;
    this.w = w;
    this.h = h;
    this.winW = w;
    this.winH = h;
  }

  /** 窗口是否还活着（退出时窗口会被销毁，定时器回调要防一手） */
  get alive() {
    return !!this.win && !this.win.isDestroyed();
  }
  /** 已销毁时返回上次已知的 bounds，避免调用方拿到 undefined */
  safeBounds() {
    if (!this.alive) {
      return this._lastBounds || { x: 0, y: 0, width: this.winW || this.w, height: this.winH || this.h };
    }
    this._lastBounds = this.win.getBounds();
    return this._lastBounds;
  }

  play(action) {
    if (!this.alive) return;
    this.win.webContents.send("pet:action", action);
  }
  showBubble(message) {
    this.bubbleVisible = true;
    if (!this.alive) return;
    this.win.webContents.send("pet:bubble", message);
  }
  hideBubble() {
    this.bubbleVisible = false;
    if (!this.alive) return;
    this.win.webContents.send("pet:bubble", null);
  }

  /** 气泡尺寸变化 → 重新计算窗口大小（气泡在上、猫在下，互不重叠） */
  setBubbleSize(size) {
    this.bubbleSize = size && size.visible ? { w: size.w, h: size.h } : null;
    this.relayout();
  }

  /** 窗口 = 宠物区 + 气泡区（仅气泡显示时）；保持右下角锚点 */
  relayout() {
    if (!this.alive) return;
    let W = this.w;
    let H = this.h;
    if (this.bubbleSize && this.bubbleSize.h > 0) {
      W = Math.max(this.w, 250 + 20);
      H = this.h + this.bubbleSize.h + 12;
    }
    if (this.winW === W && this.winH === H) return;
    const b = this.win.getBounds();
    const x = b.x + (b.width - W);
    const y = b.y + (b.height - H);
    this.win.setMinimumSize(1, 1);
    this.win.setSize(W, H, false);
    this.win.setPosition(x, y, false);
    this.winW = W;
    this.winH = H;
  }
  hasBubble() {
    return !!this.bubbleVisible;
  }
  onBubbleHidden() {
    this.bubbleVisible = false;
  }
  setClickThrough(ignore) {
    if (!this.alive) return;
    this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  /** 记录猫在窗口内的碰撞矩形（CSS 坐标），由渲染层上报 */
  setHitRect(rect) {
    this.hitRect = rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null;
  }

  /** 按状态切换穿透，避免每次轮询都发 IPC */
  applyClickThrough(ignore) {
    if (this._ignore === ignore) return;
    this._ignore = ignore;
    if (!this.alive) return;
    this.setClickThrough(ignore);
  }
  moveTo(x, y) {
    if (!this.alive) return;
    // 夹在可视工作区内：拖太远会够不着（窗口平时是点击穿透的）
    const { workArea } = screen.getPrimaryDisplay();
    const maxX = workArea.x + workArea.width - (this.winW || this.w);
    const maxY = workArea.y + workArea.height - (this.winH || this.h);
    const cx = Math.max(workArea.x, Math.min(Math.round(x), maxX));
    const cy = Math.max(workArea.y, Math.min(Math.round(y), maxY));
    this.win.setPosition(cx, cy, false);
  }
  getBounds() {
    return this.safeBounds();
  }
  setScale(scale) {
    if (!this.alive) return;
    const s = Math.max(0.5, Number(scale) || 1);
    this.scale = s;
    const w = Math.round(WIN_W * s);
    const h = petHeight(s);
    const b = this.win.getBounds();
    this.win.setMinimumSize(1, 1);
    this.win.setSize(w, h, false);
    // 保持右下角不动，避免放大后跑出屏幕
    this.win.setPosition(b.x + (b.width - w), b.y + (b.height - h), false);
    this.w = w;
    this.h = h;
    this.relayout();
  }
  isDestroyed() {
    return this.win.isDestroyed();
  }
}
