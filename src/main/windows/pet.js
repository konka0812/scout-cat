import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const WIN_W = 320;
const WIN_H = 380;
const FRAME = 256;

function rendererUrl(name) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev}${name}/`;
  return join(__dirname, "..", "renderer", name, "index.html");
}

export class PetWindow {
  constructor() {
    const { workArea } = screen.getPrimaryDisplay();
    this.scale = 1;
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
  moveTo(x, y) {
    this.win.setPosition(Math.round(x), Math.round(y), false);
  }
  getBounds() {
    return this.win.getBounds();
  }
  setScale(scale) {
    this.scale = scale;
    this.w = Math.round(WIN_W * scale);
    this.h = Math.round(WIN_H * scale);
    this.win.setSize(this.w, this.h, false);
  }
  isDestroyed() {
    return this.win.isDestroyed();
  }
}
