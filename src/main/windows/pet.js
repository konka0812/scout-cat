import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const WIN_W = 320;
const WIN_H = 380;

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
    const h = Math.round(WIN_H * this.scale);
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
  }

  play(action) {
    this.win.webContents.send("pet:action", action);
  }
  showBubble(message) {
    this.bubbleVisible = true;
    this.win.webContents.send("pet:bubble", message);
  }
  hideBubble() {
    this.bubbleVisible = false;
    this.win.webContents.send("pet:bubble", null);
  }
  hasBubble() {
    return !!this.bubbleVisible;
  }
  onBubbleHidden() {
    this.bubbleVisible = false;
  }
  setClickThrough(ignore) {
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
    this.setClickThrough(ignore);
  }
  moveTo(x, y) {
    // 夹在可视工作区内：拖太远会够不着（窗口平时是点击穿透的）
    const { workArea } = screen.getPrimaryDisplay();
    const maxX = workArea.x + workArea.width - this.w;
    const maxY = workArea.y + workArea.height - this.h;
    const cx = Math.max(workArea.x, Math.min(Math.round(x), maxX));
    const cy = Math.max(workArea.y, Math.min(Math.round(y), maxY));
    this.win.setPosition(cx, cy, false);
  }
  getBounds() {
    return this.win.getBounds();
  }
  setScale(scale) {
    const s = Math.max(0.5, Number(scale) || 1);
    this.scale = s;
    const w = Math.round(WIN_W * s);
    const h = Math.round(WIN_H * s);
    const b = this.win.getBounds();
    this.win.setMinimumSize(1, 1);
    this.win.setSize(w, h, false);
    // 保持右下角不动，避免放大后跑出屏幕
    this.win.setPosition(b.x + (b.width - w), b.y + (b.height - h), false);
    this.w = w;
    this.h = h;
  }
  isDestroyed() {
    return this.win.isDestroyed();
  }
}
