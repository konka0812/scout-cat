import { app, BrowserWindow, ipcMain, shell, screen } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PetWindow } from "./windows/pet.js";
import { BackpackWindow } from "./windows/backpack.js";
import { SettingsWindow } from "./windows/settings.js";
import { OnboardingWindow } from "./windows/onboarding.js";
import { createTray } from "./tray.js";
import { initStore, getStore } from "./store.js";
import { Scheduler } from "./scheduler.js";
import { checkEngine } from "../common/engines/index.js";
import { mergeDiscoveries, backfillSummaries } from "../common/discovery.js";
import { refreshGithubSummaries } from "../common/engines/github-recommend.js";

let petWindow = null;
let backpackWindow = null;
let settingsWindow = null;
let onboardingWindow = null;
let scheduler = null;

function openBackpack() {
  if (!backpackWindow || backpackWindow.isDestroyed()) backpackWindow = new BackpackWindow();
  backpackWindow.show();
  backpackWindow.focus();
}

function openSettings() {
  if (!settingsWindow || settingsWindow.isDestroyed()) settingsWindow = new SettingsWindow();
  settingsWindow.show();
  settingsWindow.focus();
}

app.whenReady().then(async () => {
  initStore();
  // 回填背包里旧条目的简要介绍（之前存的是与标题重复的气泡文案）
  try {
    const n = backfillSummaries(getStore());
    if (n) console.log(`[scout-cat] 回填了 ${n} 条背包简要介绍`);
  } catch (e) {
    console.warn("[scout-cat] 回填简要介绍失败", e?.message || e);
  }
  // 把背包里简介是外文的 GitHub 条目改写成中文（一次性，不阻塞启动）
  try {
    const st = getStore().get("settings") || {};
    refreshGithubSummaries(getStore(), st.openai || {})
      .then((n) => { if (n) console.log(`[scout-cat] 改写 ${n} 条 GitHub 条目为中文简介`); })
      .catch(() => {});
  } catch { /* 静默 */ }
  // 首次引导：未完成的插入 24~48h 回看
  const store = getStore();
  if (!store.get("settings.firstRunDone")) {
    const hours = store.get("settings.firstLookbackHours") || 48;
    store.set("lastCheck", Date.now() - hours * 3600e3);
  }
  // 开机启动
  app.setLoginItemSettings({ openAtLogin: store.get("settings.launchAtLogin") || false });

  petWindow = new PetWindow();
  createTray({ openBackpack, openSettings, runNow: () => scheduler?.runNow() });
  scheduler = new Scheduler({ petWindow });
  scheduler.start();
  registerIpc();

  // 首次引导：未完成则打开引导窗口
  if (!store.get("settings.firstRunDone")) {
    onboardingWindow = new OnboardingWindow();
  }
});

function registerIpc() {
  // 资源目录
  ipcMain.handle("assets:petDir", () => {
    const dir = join(app.getAppPath(), "assets", "pet");
    return pathToFileURL(dir).href.replace(/\/?$/, "/");
  });

  // 宠物状态
  ipcMain.handle("pet:getState", () => getStore().get("pet"));
  ipcMain.handle("pet:setState", (_e, patch) => {
    const store = getStore();
    store.set("pet", { ...store.get("pet"), ...patch });
    return store.get("pet");
  });

  // 设置
  ipcMain.handle("settings:get", () => getStore().get("settings"));
  ipcMain.handle("settings:set", (_e, patch) => {
    const store = getStore();
    store.set("settings", { ...store.get("settings"), ...patch });
    const settings = store.get("settings");
    if (scheduler) {
      scheduler.paused = false;
      scheduler.reschedule(settings.searchIntervalMinutes || 60);
      // 轮播间隔可能变化，重启轮播
      if (scheduler._carouselTimer) {
        clearInterval(scheduler._carouselTimer);
        scheduler._carouselTimer = null;
        scheduler.startCarousel();
      }
    }
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin || false });
    return settings;
  });

  // 发现
  ipcMain.handle("discoveries:list", () => getStore().get("discoveries", []));
  ipcMain.handle("discoveries:add", (_e, items) => {
    const store = getStore();
    const merged = mergeDiscoveries(store.get("discoveries", []), items);
    store.set("discoveries", merged);
    return merged;
  });
  ipcMain.handle("discoveries:remove", (_e, id) => {
    const store = getStore();
    store.set("discoveries", store.get("discoveries", []).filter((d) => d.id !== id));
    return store.get("discoveries", []);
  });
  ipcMain.handle("discoveries:markAllRead", () => {
    const store = getStore();
    store.set("discoveries", store.get("discoveries", []).map((d) => ({ ...d, read: true })));
    return store.get("discoveries", []);
  });
  ipcMain.handle("discoveries:removeRead", () => {
    const store = getStore();
    store.set("discoveries", store.get("discoveries", []).filter((d) => !d.read));
    return store.get("discoveries", []);
  });
  ipcMain.handle("discoveries:clear", () => {
    getStore().set("discoveries", []);
    return [];
  });
  ipcMain.handle("discoveries:unread", () => {
    return getStore().get("discoveries", []).filter((d) => !d.read);
  });
  ipcMain.handle("bubbleConfig", () => {
    const st = getStore().get("settings");
    return {
      durationSec: st.bubbleDurationSec || 30,
      carouselSec: st.carouselIntervalSec || 2,
      carouselEnabled: st.carouselEnabled !== false,
    };
  });
  ipcMain.handle("discoveries:update", (_e, id, patch) => {
    const store = getStore();
    const list = store.get("discoveries", []).map((d) => (d.id === id ? { ...d, ...patch } : d));
    store.set("discoveries", list);
    // 反馈闭环：更新 feedback + notification 状态
    const d = list.find((x) => x.id === id);
    if (d) applyFeedback(store, d, patch);
    return list;
  });

  // 关注任务
  ipcMain.handle("watch:list", () => getStore().get("watchTasks", []));
  ipcMain.handle("watch:add", (_e, task) => {
    const store = getStore();
    const list = store.get("watchTasks", []);
    list.push(task);
    store.set("watchTasks", list);
    return list;
  });
  ipcMain.handle("watch:update", (_e, id, patch) => {
    const store = getStore();
    const list = store.get("watchTasks", []).map((t) => (t.id === id ? { ...t, ...patch } : t));
    store.set("watchTasks", list);
    return list;
  });

  // 待核实列表
  ipcMain.handle("review:list", () => getStore().get("pendingReview", []));
  ipcMain.handle("review:resolve", (_e, id, patch) => {
    const store = getStore();
    const list = store.get("pendingReview", []).map((p) => (p.id === id ? { ...p, ...patch, resolvedAt: Date.now() } : p));
    store.set("pendingReview", list);
    return list;
  });
  ipcMain.handle("review:clear", () => {
    getStore().set("pendingReview", []);
    return [];
  });

  // 通知状态细分
  ipcMain.handle("notifications:list", () => getStore().get("notifications", []));
  ipcMain.handle("notifications:update", (_e, id, patch) => {
    const store = getStore();
    const list = store.get("notifications", []).map((n) => (n.id === id ? { ...n, ...patch } : n));
    store.set("notifications", list);
    return list;
  });

  // 偏好反馈
  ipcMain.handle("feedback:get", () => getStore().get("settings.feedback") || {});
  ipcMain.handle("feedback:add", (_e, patch) => {
    const store = getStore();
    const fb = store.get("settings.feedback") || { mutedTopics: [], likedTopics: [], mutedUrls: [] };
    for (const k of ["mutedTopics", "likedTopics", "mutedUrls"]) {
      if (patch?.[k]) {
        for (const v of patch[k]) {
          if (!fb[k].includes(v)) fb[k].push(v);
        }
        fb[k] = fb[k].slice(0, 50);
      }
    }
    store.set("settings.feedback", fb);
    return fb;
  });
  ipcMain.handle("feedback:remove", (_e, patch) => {
    const store = getStore();
    const fb = store.get("settings.feedback") || { mutedTopics: [], likedTopics: [], mutedUrls: [] };
    for (const k of ["mutedTopics", "likedTopics", "mutedUrls"]) {
      if (patch?.[k]) fb[k] = fb[k].filter((v) => !patch[k].includes(v));
    }
    store.set("settings.feedback", fb);
    return fb;
  });

  // 宠物控制
  ipcMain.handle("pet:play", (_e, action) => petWindow?.play(action));
  ipcMain.handle("pet:showBubble", (_e, message) => petWindow?.showBubble(message));
  ipcMain.handle("pet:hideBubble", () => petWindow?.hideBubble());
  ipcMain.handle("pet:bubbleHidden", () => {
    petWindow?.onBubbleHidden();
    scheduler?.onBubbleHidden?.();
  });
  ipcMain.handle("pet:setClickThrough", (_e, ignore) => petWindow?.setClickThrough(ignore));
  ipcMain.handle("pet:move", (_e, x, y) => petWindow?.moveTo(x, y));
  ipcMain.handle("pet:getBounds", () => petWindow?.getBounds());
  ipcMain.handle("pet:resize", (_e, scale) => petWindow?.setScale(scale));
  ipcMain.handle("pet:dock", () => {
    // 边缘停靠：主进程判断靠近哪条边并吸附
    if (!petWindow) return null;
    const { workArea } = screen.getPrimaryDisplay();
    const b = petWindow.getBounds();
    const threshold = 24;
    const left = Math.abs(b.x - workArea.x);
    const right = Math.abs(workArea.x + workArea.width - (b.x + b.width));
    const top = Math.abs(b.y - workArea.y);
    const bottom = Math.abs(workArea.y + workArea.height - (b.y + b.height));
    const min = Math.min(left, right, top, bottom);
    if (min > threshold) return petWindow.getBounds();
    let x = b.x, y = b.y;
    if (min === left) x = workArea.x + 8;
    else if (min === right) x = workArea.x + workArea.width - b.width - 8;
    else if (min === top) y = workArea.y + 8;
    else y = workArea.y + workArea.height - b.height - 8;
    petWindow.moveTo(x, y);
    return petWindow.getBounds();
  });

  // 窗口与链接
  ipcMain.handle("open:url", (_e, url) => shell.openExternal(url));
  ipcMain.handle("open:backpack", openBackpack);
  ipcMain.handle("open:settings", openSettings);

  // 调度
  ipcMain.handle("scheduler:status", () => scheduler?.status());
  ipcMain.handle("scheduler:runNow", () => scheduler?.runNow());

  // 引导完成
  ipcMain.handle("onboarding:finish", () => {
    if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.win.close();
    onboardingWindow = null;
  });

  // 引擎
  ipcMain.handle("engine:check", async (_e, name) => {
    const settings = getStore().get("settings");
    return checkEngine(name, settings.openai || {});
  });
}

/** 反馈闭环：把用户对发现的反馈写入 feedback 和 notification 状态 */
function applyFeedback(store, discovery, patch) {
  const settings = store.get("settings");
  const fb = settings.feedback || { mutedTopics: [], likedTopics: [], mutedUrls: [] };
  let changed = false;

  if (patch.favorite) {
    // 收藏 → 从 mutedUrls 移除（取消不感兴趣）
    if (discovery.url) fb.mutedUrls = fb.mutedUrls.filter((u) => u !== discovery.url);
    changed = true;
  }
  if (patch.muted) {
    // 少看这类 → 记录 URL
    if (discovery.url && !fb.mutedUrls.includes(discovery.url)) fb.mutedUrls.push(discovery.url);
    changed = true;
  }
  if (patch.read) {
    // 标记通知已读
    const notifs = store.get("notifications", []);
    const n = notifs.find((x) => x.url === discovery.url);
    if (n) { n.status = "read"; n.readAt = Date.now(); store.set("notifications", notifs); }
  }
  if (changed) {
    settings.feedback = fb;
    store.set("settings", settings);
  }
}

app.on("window-all-closed", (e) => e.preventDefault());
app.on("before-quit", () => scheduler?.stop());
