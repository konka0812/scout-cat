import { getStore } from "./store.js";
import { runPipeline } from "../common/engines/pipeline.js";
import { getGithubRecommendations } from "../common/engines/github-recommend.js";
import { mergeDiscoveries } from "../common/discovery.js";
import { powerMonitor } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** 额度/登录失效关键词（命中则暂停调度并提示） */
const QUOTA_ERRORS = ["401", "402", "429", "unauthorized", "insufficient", "balance", "余额", "登录", "quota", "rate limit"];

export class Scheduler {
  constructor({ petWindow } = {}) {
    this.petWindow = petWindow;
    this.timer = null;
    this.running = false;
    this.lastRun = null;
    this.lastStatus = "idle";
    this.lastError = "";
    this.bubblePending = [];
    this.lastSystemSleep = null;
    this.paused = false;
    this.rotation = 0;
    this.fullscreen = false;
    this.lastNotifyAttempt = null;
    this.setupPowerMonitor();
    this.setupFullscreenWatch();
  }

  /** 全屏/专注状态检测（文档第 3.1 节） */
  async checkFullscreen() {
    if (process.platform !== "win32") return false;
    try {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct MONITORINFO { public uint cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
}
"@
$hwnd = [Win32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "0"; exit }
if ([Win32]::IsZoomed($hwnd)) { Write-Output "1"; exit }
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$mon = [Win32]::MonitorFromWindow($hwnd, 2)
$mi = New-Object Win32+MONITORINFO
$mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
[Win32]::GetMonitorInfo($mon, [ref]$mi) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$mw = $mi.rcMonitor.Right - $mi.rcMonitor.Left
$mh = $mi.rcMonitor.Bottom - $mi.rcMonitor.Top
if ($w -ge $mw -and $h -ge $mh) { Write-Output "1" } else { Write-Output "0" }
`.trim();
      const { stdout } = await execFileP("powershell.exe", ["-NoProfile", "-Command", script], { timeout: 5000 });
      return stdout.trim() === "1";
    } catch {
      return false;
    }
  }

  /** 定期检查全屏状态（每 5 秒） */
  setupFullscreenWatch() {
    this._fsTimer = setInterval(async () => {
      const was = this.fullscreen;
      this.fullscreen = await this.checkFullscreen();
      // 从全屏恢复时，尝试弹出积压气泡
      if (was && !this.fullscreen) {
        this.lastSystemSleep = null;
        this.tryFlushPending();
      }
    }, 5000);
  }

  setupPowerMonitor() {
    powerMonitor.on("suspend", () => {
      this.lastSystemSleep = Date.now();
      this.stop();
    });
    powerMonitor.on("resume", () => {
      if (this.lastSystemSleep) {
        const elapsed = Date.now() - this.lastSystemSleep;
        this.lastSystemSleep = null;
        if (elapsed > 60_000) this.runPatrol();
      }
      const minutes = getStore().get("settings.searchIntervalMinutes", 60);
      this.reschedule(minutes);
    });
  }

  start() {
    const minutes = getStore().get("settings.searchIntervalMinutes", 60);
    this.reschedule(minutes);
    this.startCarousel();
    setTimeout(() => this.runPatrol(), 20000);
  }

  reschedule(minutes) {
    this.stop();
    const ms = Math.max(Number(minutes) || 60, 1) * 60 * 1000;
    this.timer = setInterval(() => this.runPatrol(), ms);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._fsTimer) {
      clearInterval(this._fsTimer);
      this._fsTimer = null;
    }
    if (this._carouselTimer) {
      clearInterval(this._carouselTimer);
      this._carouselTimer = null;
    }
  }

  isQuotaError(error) {
    if (!error) return false;
    const s = String(error).toLowerCase();
    return QUOTA_ERRORS.some((k) => s.includes(k.toLowerCase()));
  }

  async runPatrol() {
    if (this.running) return null;
    if (this.paused) return { ok: false, items: [], error: "已暂停：额度或登录失效，请在设置中检查" };
    this.running = true;
    this.lastStatus = "running";
    this.petWindow?.play("walk");   // 巡逻中
    try {
      const store = getStore();
      const settings = store.get("settings");
      // 展开 openai 配置（openai.js 从 cfg.baseURL/apiKey 等读取）
      const oc = settings.openai || {};
      const cfg = {
        baseURL: oc.baseURL || "",
        apiKey: oc.apiKey || "",
        model: oc.model || "deepseek-chat",
        searchKey: oc.searchKey || "",
        searchBase: oc.searchBase || "https://api.deepseek.com",
        interests: settings.interests || [],
        blockedTopics: settings.blockedTopics || [],
        lastCheck: store.get("lastCheck"),
        engine: "openai",
        openai: oc,
        feedback: settings.feedback || {},
        queryCount: settings.queryCount || 3,
        fetchLimit: settings.fetchLimit || 6,
        modelMaxTokens: settings.modelMaxTokens || 16000,
        eventRetentionDays: settings.eventRetentionDays || 30,
        useJsonMode: settings.useJsonMode !== false,
        searchRange: settings.searchRange || "today",
        rotation: this.rotation++,
      };
      const result = await runPipeline(cfg);
      if (process.env.PET_DEBUG) {
        console.log("[patrol] ok=" + result?.ok,
          "items=" + (result?.items?.length || 0),
          "processed=" + JSON.stringify(result?.processed || {}),
          "error=" + (result?.error || "-"),
          "queries=" + JSON.stringify((result?.queries || []).map(q => ({ t: q.topic, ok: q.ok, n: q.count, e: q.error }))));
      }
      this.lastStatus = result?.ok ? "success" : "error";
      this.lastError = result?.error || "";
      this.lastRun = Date.now();
      // 【问题6】只有搜索/模型成功才推进检查时间；失败时保留上次时间，下次继续回看
      if (result?.ok) store.set("lastCheck", this.lastRun);

      if (!result?.ok && this.isQuotaError(result?.error)) {
        this.paused = true;
        this.stop();
        this.petWindow?.showBubble({
          title: "需要你处理",
          summary: "额度或登录已失效，巡逻已暂停。请在设置里检查后重新保存。",
          source: "系统",
          url: "",
        });
        return result;
      }

      if (result?.items?.length) {
        this.petWindow?.play("discover");
        this.notifyItems(result.items);
      } else if (!result?.ok) {
        // 【问题6】搜索/模型失败：明确提示错误，不假装"没有新发现"
        this.petWindow?.showBubble({
          title: "查找失败",
          summary: result?.error || "搜索或模型出错了，请稍后重试。",
          source: "系统",
          url: "",
        });
        this.petWindow?.play("sleep");
      } else {
        this.petWindow?.play("sleep");   // 搜索成功但没有新消息，睡觉
      }
      // GitHub 热榜推荐（独立于搜索，失败不影响主流程）
      await this.runGithubRecommend(store, settings);

      // 每次巡逻后尝试清空积压
      return result;
    } catch (e) {
      this.lastStatus = "error";
      this.lastError = e?.message || String(e);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** 是否允许弹气泡（每日上限 + 免打扰 + 全屏 + 月度上限） */
  shouldBubble() {
    const store = getStore();
    const settings = store.get("settings");
    const today = new Date().toDateString();
    if (store.get("bubbleDate") !== today) {
      store.set("bubbleDate", today);
      store.set("bubbleCountToday", 0);
    }
    const count = store.get("bubbleCountToday", 0);
    const limit = settings.dailyBubbleLimit ?? 3;
    if (limit > 0 && count >= limit) return false;

    // 月度上限
    const month = new Date().toISOString().slice(0, 7);
    if (store.get("monthlyBubbleDate") !== month) {
      store.set("monthlyBubbleDate", month);
      store.set("monthlyBubbleCount", 0);
    }
    const monthlyLimit = settings.monthlyBubbleLimit || 0;
    if (monthlyLimit > 0 && store.get("monthlyBubbleCount", 0) >= monthlyLimit) return false;

    // 免打扰
    const quiet = settings.quietHours;
    if (quiet?.enabled) {
      const now = new Date();
      const mins = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = (quiet.start || "22:00").split(":").map(Number);
      const [eh, em] = (quiet.end || "08:00").split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      if (start <= end) {
        if (mins >= start && mins < end) return false;
      } else {
        if (mins >= start || mins < end) return false;
      }
    }

    // 全屏/专注状态暂缓
    if (this.fullscreen) return false;

    return true;
  }

  /**
   * 【问题5】统一管理提醒：遵守免打扰和每日上限，一次只展示一条，其余进背包。
   * 最新一条优先弹出（未达上限时），达上限时进入积压队列最前，恢复后优先补弹。
   */
  notifyItems(items) {
    const store = getStore();
    const merged = mergeDiscoveries(store.get("discoveries", []), items);
    store.set("discoveries", merged);
    if (!items.length) return;

    const first = items.find((i) => i.shouldNotify !== false) || items[0];
    if (!first) return;

    if (this.shouldBubble()) {
      this.petWindow?.showBubble(first);
      store.set("bubbleCountToday", (store.get("bubbleCountToday", 0) + 1));
      store.set("monthlyBubbleCount", (store.get("monthlyBubbleCount", 0) + 1));
      this.markNotified(first);
      this.bubblePending.push(...items.filter((i) => i !== first));
    } else {
      // 达上限或免打扰：最新一条放积压队列最前，恢复后优先补弹
      this.bubblePending.unshift(first, ...items.filter((i) => i !== first));
    }
  }

  /** 标记通知已展示 */
  markNotified(item) {
    const store = getStore();
    const notifs = store.get("notifications", []);
    const n = notifs.find((x) => x.url === item.url || (item.eventId && x.eventId === item.eventId));
    if (n) {
      n.status = "shown";
      n.notifiedAt = new Date().toISOString();
      store.set("notifications", notifs);
    }
  }

  /** 启动未阅轮播：只要背包里还有未阅项，就持续随机轮播（气泡不停） */
  startCarousel() {
    if (this._carouselTimer) return;
    // 兖底轮询：万一没收到“气泡消失”事件，也能接上下一条
    this._carouselTimer = setInterval(() => this.showUnreadBubble(), 5000);
  }

  /** 气泡刚消失 → 立刻接下一条未读项（轮播不停） */
  onBubbleHidden() {
    if (!this._carouselTimer) return;
    const sec = Number(getStore().get("settings").carouselIntervalSec);
    // 兼容旧配置：旧默认 60s 是“每隔多久弹一次”，新语义是“气泡间隔”，取小值
    const gap = !sec || sec > 10 ? 2 : Math.max(1, sec);
    setTimeout(() => this.showUnreadBubble(), gap * 1000);
  }

  /** 未阅轮播：随机挑一条未读项展示；没有未读项时自然停止 */
  showUnreadBubble() {
    if (!this._carouselTimer) return;
    const store = getStore();
    const settings = store.get("settings");
    if (settings.carouselEnabled === false) return;
    if (this.fullscreen) return;
    if (this.isQuietNow()) return;
    if (this.petWindow?.hasBubble()) return;   // 正在显示，等它消失后再接下一条

    const unread = store.get("discoveries", []).filter((d) => !d.read && !d.muted);
    if (!unread.length) return;   // 没有未读项 → 停止
    const item = unread[Math.floor(Math.random() * unread.length)];
    this.petWindow?.showBubble({
      id: item.id,
      title: item.title,
      summary: item.summary,
      bubble: item.bubble,
      url: item.url,
      source: item.source,
    });
  }

  /** 当前是否处于免打扰时段 */
  isQuietNow() {
    const quiet = getStore().get("settings").quietHours;
    if (!quiet?.enabled) return false;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = (quiet.start || "22:00").split(":").map(Number);
    const [eh, em] = (quiet.end || "08:00").split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (start <= end) return mins >= start && mins < end;
    return mins >= start || mins < end;
  }

  /** GitHub 热榜推荐：获取 → 去重 → 推送 → 记录 */
  async runGithubRecommend(store, settings) {
    // 默认启用（electron-store defaults 浅合并，新字段可能缺失）
    if (settings.githubRecommend === false) return;
    try {
      // [背包去重] 以背包里已有的 GitHub 条目为排除依据；
      // 用户从背包删除后，该仓库可再次进入推荐。
      const excludeUrls = (store.get("discoveries", []) || [])
        .map((d) => String(d.url || ""))
        .filter((u) => u.includes("github.com"));
      const rec = await getGithubRecommendations({
        proxy: "http://127.0.0.1:7897",
        interests: settings.interests || [],
        excludeUrls,
        maxItems: settings.githubMaxItems || 3,
        openai: settings.openai || {},
      });
      if (!rec.ok || !rec.items.length) return;

      // 转为发现项（kind=github 便于背包区分）
      const items = rec.items.map((r) => ({
        title: r.title,
        summary: r.summary,
        url: r.url,
        source: r.source,
        publishedAt: r.publishedAt,
        firstSeenAt: r.firstSeenAt,
        kind: "github",
        shouldNotify: true,
      }));
      this.notifyItems(items);
    } catch (e) {
      // 静默失败（GitHub 不可用时不应影响桌宠）
    }
  }


  runNow() {
    return this.runPatrol();
  }

  status() {
    return {
      running: this.running,
      lastRun: this.lastRun,
      lastStatus: this.lastStatus,
      lastError: this.lastError,
      paused: this.paused,
      fullscreen: this.fullscreen,
      pendingCount: this.bubblePending.length,
    };
  }
}
