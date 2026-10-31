import { BrowserWindow } from "electron";
import { join } from "node:path";

function rendererUrl(name) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev}${name}/`;
  return join(__dirname, "..", "renderer", name, "index.html");
}

export class OnboardingWindow {
  constructor() {
    const win = new BrowserWindow({
      width: 480,
      height: 620,
      resizable: false,
      autoHideMenuBar: true,
      title: "欢迎使用情报猎猫",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.loadURL(rendererUrl("onboarding"));
    win.on("closed", () => {
      if (global.__onboardingWindow === win) global.__onboardingWindow = null;
    });
    this.win = win;
    global.__onboardingWindow = win;
  }
  show() { this.win.show(); }
  focus() { this.win.focus(); }
  isDestroyed() { return this.win.isDestroyed(); }
}
