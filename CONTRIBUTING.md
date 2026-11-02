# 参与贡献

感谢关注情报猎猫。

## 本地跑起来

```bash
git clone https://github.com/konka0812/scout-cat.git
cd scout-cat
npm install
npm start
```

`npm start` 会先自动 build 再启动，改代码后重启即可。

## 提交前

跑一遍离线测试（77 例，不需要网络和 API Key）：

```bash
node test-pipeline.mjs
node test-review-fixes.mjs
node test-backpack-dedup.mjs
```

## 改动代码时注意

1. **设置项读取要带兜底**。`electron-store` 的 `defaults` 是**浅合并**，
   老用户的 `config.json` 里新字段会是 `undefined`。
   读设置请写成 `settings.x !== false` 或 `settings.x || default`，
   不要直接依赖 `defaults` 生效。

2. **帧对象用的是 `.canvas`**。精灵图裁剪后返回的是
   `{ canvas, left, top, content }`，不要引用 `.naturalWidth` 或 `.width`。

3. **去重准绳是背包**。任何"是否已经处理过"的判断都应该走
   `src/common/discovery.js`（`isFreshCandidate` / `mergeDiscoveries`），
   不要再引入第二本账。

4. **提醒要遵守用户设置**。免打扰、每日上限、全屏暂缓、气泡队列
   由 `src/main/scheduler.js` 统一裁决，不要在别处直接弹气泡。

## 提交规范

Commit message 用 `type: 简述`：

- `feat:` 新功能
- `fix:` 修复
- `refactor:` 重构
- `docs:` 文档
- `ci:` 构建配置
- `chore:` 杂项

## 行为准则

对人友善一点。就这一条。
