const $ = (id) => document.getElementById(id);
let settings = {};
let pet = {};
let interests = [];
let blocked = [];
let feedback = { mutedTopics: [], likedTopics: [], mutedUrls: [] };

async function load() {
  settings = await window.scoutcat.getSettings();
  pet = await window.scoutcat.getPetState();
  interests = [...(settings.interests || [])];
  blocked = [...(settings.blockedTopics || [])];
  feedback = await window.scoutcat.getFeedback();

  $("petName").value = pet.name || "";
  $("interval").value = settings.searchIntervalMinutes || 60;
  $("bubbleLimit").value = settings.dailyBubbleLimit ?? 3;
  $("monthlyLimit").value = settings.monthlyBubbleLimit || 0;
  $("watchBypass").value = settings.watchBypassLimit ? "yes" : "no";
  $("launchAtLogin").checked = settings.launchAtLogin || false;
  $("quietEnabled").checked = settings.quietHours?.enabled ?? true;
  $("quietStart").value = settings.quietHours?.start || "22:00";
  $("quietEnd").value = settings.quietHours?.end || "08:00";
  $("scale").value = String(pet.scale || 1);
  $("queryCount").value = settings.queryCount || 3;
  $("fetchLimit").value = settings.fetchLimit ?? 6;
  $("retention").value = settings.eventRetentionDays || 30;
  $("jsonMode").checked = settings.useJsonMode !== false;
  $("searchRange").value = settings.searchRange || "today";
  $("githubRecommend").checked = settings.githubRecommend !== false;
  $("githubMaxItems").value = settings.githubMaxItems || 3;
  $("bubbleDuration").value = settings.bubbleDurationSec || 30;
  $("carouselInterval").value = settings.carouselIntervalSec || 2;
  $("carouselEnabled").checked = settings.carouselEnabled !== false;

  const oc = settings.openai || {};
  $("baseUrl").value = oc.baseURL || "";
  $("apiKey").value = oc.apiKey || "";
  $("model").value = oc.model || "deepseek-chat";
  $("searchKey").value = oc.searchKey || "";
  $("searchBase").value = oc.searchBase || "https://api.deepseek.com";

  renderTags();
  renderFeedback();
  markEngine(settings.engine || "demo");
  checkEngines();
  refreshPatrolStatus();
  refreshReview();
}

function renderTags() {
  $("interestTags").innerHTML = interests.map((t, i) => tagHtml(t, i, "interest")).join("");
  $("blockTags").innerHTML = blocked.map((t, i) => tagHtml(t, i, "block")).join("");
  $("interestTags").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { interests.splice(Number(b.dataset.i), 1); renderTags(); })
  );
  $("blockTags").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { blocked.splice(Number(b.dataset.i), 1); renderTags(); })
  );
}

function renderFeedback() {
  const el = $("fbList");
  const parts = [];
  if (feedback.likedTopics?.length) parts.push(`<div class="row"><span>喜欢方向：${feedback.likedTopics.join("、")}</span></div>`);
  if (feedback.mutedTopics?.length) parts.push(`<div class="row"><span>不感兴趣：${feedback.mutedTopics.join("、")}</span></div>`);
  if (feedback.mutedUrls?.length) parts.push(`<div class="row"><span>屏蔽链接：${feedback.mutedUrls.length} 条</span></div>`);
  el.innerHTML = parts.length ? parts.join("") : `<div class="hint">暂无反馈记录</div>`;
}

async function refreshPatrolStatus() {
  const s = await window.scoutcat.schedulerStatus();
  const stateBadge = { idle: "warn", running: "ok", success: "ok", error: "err" };
  $("ps-state").innerHTML = `<span class="badge ${stateBadge[s.lastStatus] || "warn"}">${s.lastStatus || "idle"}${s.paused ? "（已暂停）" : ""}</span>`;
  $("ps-last").textContent = s.lastRun ? new Date(s.lastRun).toLocaleString("zh-CN") : "—";
  $("ps-fs").textContent = s.fullscreen ? "全屏中（暂缓弹出）" : "正常";
  $("ps-pending").textContent = s.pendingCount || 0;
  $("ps-err").textContent = s.lastError || "—";
}

async function refreshReview() {
  const list = await window.scoutcat.listReview();
  $("reviewInfo").textContent = list.length ? `共 ${list.length} 条待核实` : "暂无待核实内容";
}

const tagHtml = (t, i, kind) => `<span class="tag">${escapeHtml(t)}<button data-i="${i}">×</button></span>`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function addTag(inputId, list) {
  const el = $(inputId);
  const v = el.value.trim();
  if (!v) return;
  if (!list.includes(v)) list.push(v);
  el.value = "";
  renderTags();
}

function markEngine(name) {
  document.querySelectorAll("#engineRow button").forEach((b) => {
    const active = b.dataset.engine === name;
    b.classList.toggle("active", active);
  });
  $("apiConfig").classList.toggle("show", name === "openai");
}

async function checkEngines() {
  for (const name of ["openai", "demo"]) {
    const el = $("st-" + name);
    try {
      const r = await window.scoutcat.checkEngine(name);
      const bits = [];
      if (r.model) bits.push("模型✓");
      if (r.search) bits.push("搜索✓");
      el.textContent = r.ok ? bits.join(" ") : `✗ ${r.message || "不可用"}`;
    } catch {
      el.textContent = "✗ 检测失败";
    }
  }
}

$("interestInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTag("interestInput", interests); } });
$("blockInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addTag("blockInput", blocked); } });

document.querySelectorAll("#engineRow button").forEach((b) =>
  b.addEventListener("click", () => { markEngine(b.dataset.engine); })
);

$("scale").addEventListener("change", async () => {
  const scale = Number($("scale").value);
  await window.scoutcat.setPetState({ scale });
  window.scoutcat.resizePet(scale);
});

$("playAction").addEventListener("click", () => window.scoutcat.play($("action").value));

$("addWatch").addEventListener("click", async () => {
  const target = $("watchTarget").value.trim();
  const condition = $("watchCond").value.trim();
  if (!target || !condition) { $("watchStatus").textContent = "请填写完整"; return; }
  await window.scoutcat.addWatch({
    id: crypto.randomUUID(),
    target,
    condition,
    status: "active",
    createdAt: Date.now(),
    lastCheck: null,
  });
  $("watchTarget").value = "";
  $("watchCond").value = "";
  $("watchStatus").textContent = "已添加关注任务";
});

$("refreshStatus").addEventListener("click", refreshPatrolStatus);

$("clearReview").addEventListener("click", async () => {
  await window.scoutcat.clearReview();
  refreshReview();
});

$("save").addEventListener("click", async () => {
  await window.scoutcat.setPetState({ name: $("petName").value.trim() || "猎猫" });
  await window.scoutcat.setSettings({
    interests,
    blockedTopics: blocked,
    searchIntervalMinutes: Math.max(15, Number($("interval").value) || 60),
    dailyBubbleLimit: Math.max(0, Number($("bubbleLimit").value) || 0),
    monthlyBubbleLimit: Math.max(0, Number($("monthlyLimit").value) || 0),
    watchBypassLimit: $("watchBypass").value === "yes",
    launchAtLogin: $("launchAtLogin").checked,
    quietHours: {
      enabled: $("quietEnabled").checked,
      start: $("quietStart").value,
      end: $("quietEnd").value,
    },
    queryCount: Math.max(1, Number($("queryCount").value) || 3),
    fetchLimit: Math.max(0, Number($("fetchLimit").value) || 0),
    eventRetentionDays: Math.max(1, Number($("retention").value) || 30),
    useJsonMode: $("jsonMode").checked,
    searchRange: $("searchRange").value || "today",
    githubRecommend: $("githubRecommend").checked,
    githubMaxItems: Math.max(1, Number($("githubMaxItems").value) || 3),
    bubbleDurationSec: Math.max(5, Number($("bubbleDuration").value) || 30),
    carouselIntervalSec: Math.max(1, Number($("carouselInterval").value) || 2),
    carouselEnabled: $("carouselEnabled").checked,
    engine: document.querySelector("#engineRow button.active")?.dataset.engine || "demo",
    openai: {
      baseURL: $("baseUrl").value.trim(),
      apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim() || "deepseek-chat",
      searchKey: $("searchKey").value.trim(),
      searchBase: $("searchBase").value.trim() || "https://api.deepseek.com",
    },
  });
  $("saveStatus").textContent = "已保存";
  setTimeout(() => ($("saveStatus").textContent = ""), 2000);
});

$("runNow").addEventListener("click", async () => {
  $("status").textContent = "正在查找…";
  const r = await window.scoutcat.runNow();
  if (r?.ok) {
    if (r.items?.length) {
      await window.scoutcat.addDiscoveries(r.items);
      window.scoutcat.play("discover");
      if (r.items[0]) window.scoutcat.showBubble(r.items[0]);
      $("status").textContent = `找到 ${r.items.length} 条新发现`;
    } else {
      $("status").textContent = "这次没有新发现";
    }
  } else {
    $("status").textContent = `查找失败：${r?.error || "未知"}`;
  }
  refreshPatrolStatus();
  refreshReview();
});

// 定期刷新巡逻状态
setInterval(refreshPatrolStatus, 5000);

load();
