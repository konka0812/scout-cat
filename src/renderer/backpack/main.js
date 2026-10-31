const $ = (id) => document.getElementById(id);
const listEl = document.getElementById("list");
const tabBtns = document.querySelectorAll(".tabs button");
let discoveries = [];
let watchTasks = [];
let reviewList = [];
let tab = "new";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const fmtTime = (t) => {
  if (!t) return "时间未知";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 3600e3) return `${Math.max(1, Math.round(diff / 60e3))} 分钟前`;
  if (diff < 86400e3) return `${Math.round(diff / 3600e3)} 小时前`;
  if (diff < 7 * 86400e3) return `${Math.round(diff / 86400e3)} 天前`;
  return d.toLocaleDateString("zh-CN");
};

async function load() {
  discoveries = await window.scoutcat.listDiscoveries();
  watchTasks = await window.scoutcat.listWatch();
  reviewList = await window.scoutcat.listReview();
  render();
}

/** 按时间倒序（越新越靠上） */
function sortByNewest(items) {
  return [...items].sort((a, b) => {
    const ta = new Date(a.publishedAt || a.firstSeenAt || a.createdAt || 0).getTime();
    const tb = new Date(b.publishedAt || b.firstSeenAt || b.createdAt || 0).getTime();
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
}

function render() {
  if (tab === "watch") return renderWatch();
  if (tab === "review") return renderReview();
  const items = sortByNewest(tab === "fav" ? discoveries.filter((d) => d.favorite) : discoveries);
  if (!items.length) {
    listEl.innerHTML = `<div class="empty">${tab === "fav" ? "还没有收藏" : "还没有新发现，猎猫会帮你留意"}</div>`;
    return;
  }
  listEl.innerHTML = items.map(itemHtml).join("");
  bindItemEvents();
  updateUnreadCount();
}

function itemHtml(d) {
  const msgTime = fmtTime(d.publishedAt);
  const searchTime = fmtTime(d.firstSeenAt || d.createdAt);
  const unread = !d.read;
  // 简要介绍：与标题重复或为空时丄展示
  const summary = String(d.summary || "").trim();
  const title = String(d.title || "").trim();
  const summaryHtml = summary && summary !== title ? `<div class="summary">${esc(summary)}</div>` : "";
  return `<div class="item ${d.favorite ? "fav" : ""} ${d.muted ? "muted" : ""} ${unread ? "unread" : ""}" data-id="${esc(d.id)}">
    <div class="title">${unread ? '<span class="dot"></span>' : ""}${esc(d.title)}</div>
    ${summaryHtml}
    <div class="meta">${esc(d.source || "来源未知")}</div>
    <div class="meta">消息 ${msgTime} · 搜到 ${searchTime}</div>
    <div class="actions">
      <button class="primary" data-act="open">打开原文</button>
      <button data-act="fav">${d.favorite ? "取消收藏" : "收藏"}</button>
      <button data-act="less" class="${d.muted ? "on" : ""}">${d.muted ? "已少看这类" : "少看这类"}</button>
      <button data-act="del" class="danger">删除</button>
    </div>
  </div>`;
}

function bindItemEvents() {
  listEl.querySelectorAll(".item").forEach((el) => {
    const id = el.dataset.id;
    el.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const d = discoveries.find((x) => x.id === id);
        if (!d) return;
        if (btn.dataset.act === "open") {
          if (d.url) window.scoutcat.openUrl(d.url);
          window.scoutcat.updateDiscovery(id, { read: true });
          d.read = true;
        } else if (btn.dataset.act === "fav") {
          // 收藏 → 记录喜欢方向；取消收藏 → 移除
          if (!d.favorite) {
            await window.scoutcat.addFeedback({ likedTopics: [d.source || "该来源"].filter(Boolean) });
          }
          window.scoutcat.updateDiscovery(id, { favorite: !d.favorite });
        } else if (btn.dataset.act === "less") {
          // 少看这类 → 记录屏蔽 URL + 来源
          if (!d.muted) {
            await window.scoutcat.addFeedback({
              mutedUrls: d.url ? [d.url] : [],
              mutedTopics: [d.source || ""].filter(Boolean),
            });
          } else {
            await window.scoutcat.removeFeedback({ mutedUrls: d.url ? [d.url] : [] });
          }
          window.scoutcat.updateDiscovery(id, { read: true, muted: !d.muted });
        } else if (btn.dataset.act === "del") {
          // 删除
          await window.scoutcat.removeDiscovery(id);
        }
        await load();
      });
    });
  });
}

function renderWatch() {
  if (!watchTasks.length) {
    listEl.innerHTML = `<div class="empty">还没有关注任务，去设置里添加</div>`;
    return;
  }
  listEl.innerHTML = watchTasks
    .map(
      (t) => `<div class="item watch-item" data-id="${esc(t.id)}">
        <div class="info">
          <div class="title">${esc(t.target)}</div>
          <div class="meta">${esc(t.condition)}</div>
          <div class="status">最近检查：${t.lastCheck ? fmtTime(t.lastCheck) : "尚未检查"} · ${t.status === "paused" ? "已暂停" : t.status === "done" ? "已达成" : "进行中"}</div>
        </div>
        <button data-act="toggle">${t.status === "paused" ? "继续" : "暂停"}</button>
      </div>`
    )
    .join("");
  listEl.querySelectorAll(".item button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".item").dataset.id;
      const t = watchTasks.find((x) => x.id === id);
      if (!t) return;
      window.scoutcat.updateWatch(id, { status: t.status === "paused" ? "active" : "paused" });
      await load();
    });
  });
}

function renderReview() {
  if (!reviewList.length) {
    listEl.innerHTML = `<div class="empty">暂无待核实内容</div>`;
    return;
  }
  listEl.innerHTML = reviewList
    .map(
      (p) => `<div class="item" data-id="${esc(p.id)}">
        <div class="title">${esc(p.fact || p.title || "证据不足")}</div>
        <div class="meta">${esc(p.source || "来源未知")} · ${fmtTime(p.publishedAt)}</div>
        <div class="meta" style="color:var(--muted)">${esc(p.reason || "待核实")}</div>
        <div class="actions">
          ${p.url ? `<button class="primary" data-act="open">打开原文</button>` : ""}
          <button data-act="dismiss">忽略</button>
        </div>
      </div>`
    )
    .join("");
  listEl.querySelectorAll(".item button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".item").dataset.id;
      const p = reviewList.find((x) => x.id === id);
      if (!p) return;
      if (btn.dataset.act === "open" && p.url) window.scoutcat.openUrl(p.url);
      else await window.scoutcat.resolveReview(id, { status: "dismissed", resolvedAt: Date.now() });
      await load();
    });
  });
}

tabBtns.forEach((b) =>
  b.addEventListener("click", () => {
    tabBtns.forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    tab = b.dataset.tab;
    render();
  })
);

function updateUnreadCount() {
  const n = discoveries.filter((d) => !d.read).length;
  $("unreadCount").textContent = n ? `未读 ${n}` : "";
}

$("markAllRead").addEventListener("click", async () => {
  await window.scoutcat.markAllRead();
  await load();
});
$("removeRead").addEventListener("click", async () => {
  if (!confirm("确定删除所有已读项？")) return;
  await window.scoutcat.removeRead();
  await load();
});
$("clearAll").addEventListener("click", async () => {
  if (!confirm("确定清空全部发现？")) return;
  await window.scoutcat.clearDiscoveries();
  await load();
});

load();
setInterval(load, 15000);
