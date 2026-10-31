const $ = (id) => document.getElementById(id);
const steps = document.querySelectorAll(".step");
const dotsEl = $("dots");
let current = 0;
let interests = [];
let testOk = false;

const PRESETS = ["AI 工具", "AI 视频", "开源项目", "产品更新", "AI 编程", "设计工具"];

function renderDots() {
  dotsEl.innerHTML = steps.length
    ? Array.from(steps).map((_, i) => `<span class="${i === current ? "active" : ""}"></span>`).join("")
    : "";
}

function showStep(i) {
  current = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((s, idx) => s.classList.toggle("active", idx === current));
  $("prevBtn").style.visibility = current === 0 ? "hidden" : "visible";
  $("nextBtn").textContent = current === steps.length - 1 ? "开始使用" : "下一步";
  renderDots();
}

function renderPresets() {
  $("presets").innerHTML = PRESETS.map((p) => `<span class="preset ${interests.includes(p) ? "active" : ""}" data-p="${p}">${p}</span>`).join("");
  $("presets").querySelectorAll(".preset").forEach((el) =>
    el.addEventListener("click", () => {
      const p = el.dataset.p;
      if (interests.includes(p)) interests = interests.filter((x) => x !== p);
      else interests.push(p);
      renderPresets();
    })
  );
}

$("customInterest").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const v = $("customInterest").value.trim();
    if (v && !interests.includes(v)) interests.push(v);
    $("customInterest").value = "";
    renderPresets();
    // 显示已选
    if (interests.length) {
      const el = document.createElement("div");
      el.className = "hint";
      el.id = "selHint";
      el.textContent = `已选：${interests.join("、")}`;
      const old = $("selHint");
      if (old) old.remove();
      $("customInterest").after(el);
    }
  }
});

$("testBtn").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  const baseUrl = $("baseUrl").value.trim();
  const model = $("model").value.trim();
  if (!apiKey || !baseUrl || !model) { $("testResult").innerHTML = `<span class="err">请填写完整</span>`; return; }
  $("testResult").textContent = "测试中…";
  // 保存临时配置用于测试
  await window.scoutcat.setSettings({ openai: { baseURL: baseUrl, apiKey, model, searchKey: "", searchBase: "https://api.deepseek.com" } });
  const r = await window.scoutcat.checkEngine("openai");
  testOk = r.ok;
  const bits = [];
  if (r.model) bits.push("模型✓");
  if (r.search) bits.push("搜索✓");
  $("testResult").innerHTML = r.ok ? `<span class="ok">${bits.join(" ")}</span>` : `<span class="err">${r.message || "连接失败"}</span>`;
});

$("prevBtn").addEventListener("click", () => showStep(current - 1));

$("nextBtn").addEventListener("click", async () => {
  if (current === 2) {
    // 保存引擎配置
    const apiKey = $("apiKey").value.trim();
    const baseUrl = $("baseUrl").value.trim();
    const model = $("model").value.trim();
    if (apiKey && baseUrl && model) {
      await window.scoutcat.setSettings({ engine: "openai", openai: { baseURL: baseUrl, apiKey, model, searchKey: "", searchBase: "https://api.deepseek.com" } });
    }
  }
  if (current === steps.length - 1) {
    // 完成
    await window.scoutcat.setPetState({ name: $("petName").value.trim() || "猎猫" });
    await window.scoutcat.setSettings({ interests, firstRunDone: true });
    window.scoutcat.finishOnboarding();
    return;
  }
  showStep(current + 1);
});

renderPresets();
showStep(0);

// 加载宠物头像
try {
  const dir = await window.scoutcat.getPetDir();
  const img = document.querySelector(".logo img");
  if (img && dir) img.src = dir + "character-base.png";
} catch { /* 忽略 */ }
