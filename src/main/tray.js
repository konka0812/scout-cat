import { Tray, Menu, nativeImage, app, BrowserWindow } from "electron";
import { join } from "node:path";

export function createTray({ openBackpack, openSettings, runNow }) {
  const iconPath = join(process.cwd(), "longcat.png");
  let image;
  try {
    image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = nativeImage.createEmpty();
    else image = image.resize({ width: 20, height: 20 });
  } catch {
    image = nativeImage.createEmpty();
  }

  const tray = new Tray(image);
  tray.setToolTip("情报猎猫");

  const template = [
    { label: "打开发现背包", click: openBackpack },
    { label: "设置", click: openSettings },
    { type: "separator" },
    { label: "立即查找一次", click: runNow },
    { type: "separator" },
    {
      label: "宠物",
      submenu: [
        { label: "待机", click: () => sendToPet("idle") },
        { label: "巡逻", click: () => sendToPet("walk") },
        { label: "发现", click: () => sendToPet("discover") },
        { label: "报信", click: () => sendToPet("deliver") },
        { label: "睡觉", click: () => sendToPet("sleep") },
      ],
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on("click", openBackpack);
  return tray;
}

function sendToPet(action) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (w.getTitle() === "scout-cat-pet") w.webContents.send("pet:action", action);
  }
}
