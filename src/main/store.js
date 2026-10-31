import Store from "electron-store";

let store = null;

export function initStore() {
  store = new Store({
    defaults: {
      pet: { name: "猎猫", scale: 1, x: null, y: null },
      settings: {
        engine: "openai",
        searchIntervalMinutes: 60,
        dailyBubbleLimit: 3,
        interests: [],
        blockedTopics: [],
        quietHours: { enabled: true, start: "22:00", end: "08:00" },
        // 偏好反馈（文档第 2/3 节）：引擎读取以调整后续查询
        feedback: { mutedTopics: [], likedTopics: [], mutedUrls: [] },
        // 可配置参数（文档第 6 节）
        monthlyBubbleLimit: 0,        // 每月提醒上限（0=不限）
        queryCount: 3,                // 每次巡逻查询数
        fetchLimit: 6,                // 单次 Fetch 上限
        modelMaxTokens: 16000,         // 模型输出上限
        eventRetentionDays: 30,       // 事件保存期限
        firstRunDone: false,          // 首次引导完成标记
        firstLookbackHours: 48,       // 首次回看小时数
        useJsonMode: true,            // 模型 JSON Output
        searchRange: "today",         // 搜索时间范围：today=当天, week=近7天
        githubRecommend: true,        // GitHub 热榜推荐开关
        githubMaxItems: 3,            // 每次最多推荐几个 GitHub 项目
        bubbleDurationSec: 30,        // 气泡显示时长（秒）
        carouselIntervalSec: 2,       // 气泡间隔（秒，1=几乎不停）
        carouselEnabled: true,        // 未阅轮播开关
        launchAtLogin: false,         // 开机启动
        openai: {
          baseURL: "",
          apiKey: "",
          model: "deepseek-chat",
          searchKey: "",
          searchBase: "https://api.deepseek.com",
        },
        rotation: 0,
      },
      // 文档第 5 节：文章 / 事件 / 通知 三表
      articles: [],
      events: [],
      notifications: [],
      // 待核实列表（uncertain 候选持久化）
      pendingReview: [],
      // 候选处理状态（避免重复提交模型）
      candidateStatus: {},
      // 已推荐的 GitHub 仓库（去重）
      githubRecommended: [],
      discoveries: [],
      lastCheck: null,
      bubbleCountToday: 0,
      bubbleDate: null,
      // 月度提醒统计
      monthlyBubbleCount: 0,
      monthlyBubbleDate: null,
    },
  });
}

export function getStore() {
  if (!store) initStore();
  return store;
}
