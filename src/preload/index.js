import { contextBridge, ipcRenderer } from "electron";

const on = (channel, cb) => {
  const handler = (_, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld("scoutcat", {
  getPetDir: () => ipcRenderer.invoke("assets:petDir"),

  getPetState: () => ipcRenderer.invoke("pet:getState"),
  setPetState: (patch) => ipcRenderer.invoke("pet:setState", patch),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),

  listDiscoveries: () => ipcRenderer.invoke("discoveries:list"),
  addDiscoveries: (items) => ipcRenderer.invoke("discoveries:add", items),
  updateDiscovery: (id, patch) => ipcRenderer.invoke("discoveries:update", id, patch),
  removeDiscovery: (id) => ipcRenderer.invoke("discoveries:remove", id),
  markAllRead: () => ipcRenderer.invoke("discoveries:markAllRead"),
  removeRead: () => ipcRenderer.invoke("discoveries:removeRead"),
  clearDiscoveries: () => ipcRenderer.invoke("discoveries:clear"),
  listUnread: () => ipcRenderer.invoke("discoveries:unread"),
  getBubbleConfig: () => ipcRenderer.invoke("bubbleConfig"),


  listReview: () => ipcRenderer.invoke("review:list"),
  resolveReview: (id, patch) => ipcRenderer.invoke("review:resolve", id, patch),
  clearReview: () => ipcRenderer.invoke("review:clear"),

  listNotifications: () => ipcRenderer.invoke("notifications:list"),
  updateNotification: (id, patch) => ipcRenderer.invoke("notifications:update", id, patch),

  getFeedback: () => ipcRenderer.invoke("feedback:get"),
  addFeedback: (patch) => ipcRenderer.invoke("feedback:add", patch),
  removeFeedback: (patch) => ipcRenderer.invoke("feedback:remove", patch),

  play: (action) => ipcRenderer.invoke("pet:play", action),
  showBubble: (msg) => ipcRenderer.invoke("pet:showBubble", msg),
  hideBubble: () => ipcRenderer.invoke("pet:hideBubble"),
  notifyBubbleHidden: () => ipcRenderer.invoke("pet:bubbleHidden"),
  setClickThrough: (ignore) => ipcRenderer.invoke("pet:setClickThrough", ignore),
  movePet: (x, y) => ipcRenderer.invoke("pet:move", x, y),
  getPetBounds: () => ipcRenderer.invoke("pet:getBounds"),
  resizePet: (scale) => ipcRenderer.invoke("pet:resize", scale),
  setHitRect: (rect) => ipcRenderer.invoke("pet:setHitRect", rect),
  setBubbleSize: (size) => ipcRenderer.invoke("pet:setBubbleSize", size),
  dockPet: (edge) => ipcRenderer.invoke("pet:dock", edge),

  openUrl: (url) => ipcRenderer.invoke("open:url", url),
  openBackpack: () => ipcRenderer.invoke("open:backpack"),
  openSettings: () => ipcRenderer.invoke("open:settings"),
  finishOnboarding: () => ipcRenderer.invoke("onboarding:finish"),

  schedulerStatus: () => ipcRenderer.invoke("scheduler:status"),
  runNow: () => ipcRenderer.invoke("scheduler:runNow"),
  checkEngine: (name) => ipcRenderer.invoke("engine:check", name),

  onPetAction: (cb) => on("pet:action", cb),
  onBubble: (cb) => on("pet:bubble", cb),
});
