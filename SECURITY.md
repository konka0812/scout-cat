# 安全说明

## 你的 API Key 存在哪里

Key 只写入本机：

```
%APPDATA%\scout-cat\config.json
```

- **不进 Git 仓库**（`.gitignore` 已排除 `config.json`）
- **不上传**任何服务器
- 请求直接由你的机器发往你自己填的 Base URL

仓库、CI 和历史记录里都不含任何密钥。

## 其他本地数据

同一个 `config.json` 里还有：

- 背包条目（你看过什么）
- 巡逻状态与通知记录
- 你的关注兴趣 / 屏蔽词

这些全在本机，程序不会往外发。

## 依赖与供应链

- 运行时依赖只有 `electron-store`
- 构建依赖：`electron` / `electron-builder` / `electron-vite` / `vite`
- 依赖锁定在 `package-lock.json`

## 报告安全问题

请**不要**开公开 Issue。用 GitHub 的 Private vulnerability reporting，
或直接联系仓库所有者。

修复前请给维护者合理的时间，不要公开披露未修复的漏洞。
