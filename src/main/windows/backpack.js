import { BrowserWindow } from "electron";
import { join } from "node:path";

function rendererUrl(name) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev}${name}/`;
  return join(__dirname, "..", "renderer", name, "index.html");
}

export class BackpackWindow {
  constructor() {
    const win = new BrowserWindow({
      width: 420,
      height: 620,
      minWidth: 360,
      minHeight: 480,
      frame: true,
      resizable: true,
      skipTaskbar: false,
      autoHideMenuBar: true,
      title: "发现背包",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.loadURL(rendererUrl("backpack"));
    win.on("closed", () => {
      if (global.__backpackWindow === win) global.__backpackWindow = null;
    });
    this.win = win;
    global.__backpackWindow = win;
  }
  show() { this.win.show(); }
  focus() { this.win.focus(); }
  isDestroyed() { return this.win.isDestroyed(); }
}
