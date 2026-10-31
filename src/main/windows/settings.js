import { BrowserWindow } from "electron";
import { join } from "node:path";

function rendererUrl(name) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev}${name}/`;
  return join(__dirname, "..", "renderer", name, "index.html");
}

export class SettingsWindow {
  constructor() {
    const win = new BrowserWindow({
      width: 460,
      height: 640,
      minWidth: 400,
      minHeight: 520,
      frame: true,
      resizable: true,
      autoHideMenuBar: true,
      title: "设置",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.loadURL(rendererUrl("settings"));
    win.on("closed", () => {
      if (global.__settingsWindow === win) global.__settingsWindow = null;
    });
    this.win = win;
    global.__settingsWindow = win;
  }
  show() { this.win.show(); }
  focus() { this.win.focus(); }
  isDestroyed() { return this.win.isDestroyed(); }
}
