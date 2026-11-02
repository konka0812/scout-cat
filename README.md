# 情报猎猫（Scout Cat）

AI 情报桌面宠物。你把关注的事情交给它，它持续寻找，带回值得花几十秒了解的发现。

Windows 桌面应用（Electron）。猎猫蹲在屏幕角落，按时巡逻；搜到与你关注内容相关的
新消息就弹气泡提醒，其余的默默进背包，等你有空再翻。

---

## 功能

| 模块 | 说明 |
|---|---|
| **桌面宠物** | 透明悬浮窗、拖动、点击穿透（只在猫身上才接收鼠标，不挡别的窗口）、托盘驻留 |
| **情报巡逻** | 按设定频率调用 OpenAI 兼容模型 + DeepSeek 搜索，搜集 AI 新闻 / 工具 / 项目进展 |
| **GitHub 热榜** | 独立于搜索，每次巡逻推荐今日热榜项目（带中文简介） |
| **发现背包** | 新发现 / 已收藏 / 待核实 三个页签，点开直达原文 |
| **气泡提醒** | 高度相关的发现触发报信动作 + 气泡；未读条目按间隔轮播提醒 |
| **免打扰 / 上限** | 免打扰时段、每日最多弹出次数、每月上限、全屏暂缓 |

### 去重逻辑（以背包为准绳）

背包（`discoveries`）是「你看到过什么」的唯一账本：

- 背包里**已有**该 URL 且内容指纹未变 → 跳过
- 背包里**没有**，或内容指纹变化（实质新进展）→ 当作新发现推出
- **你从背包删掉某条** → 该 URL 重新可用，会再推一次

模型判 `duplicate` 时，如果这些 URL 都不在背包里，同样会重新推出——
内部历史事件不会拦住你删掉的东西回来。

---

## 快速开始

### 方式一：直接运行（已打包）

| 文件 | 说明 |
|---|---|
| `dist\scout-cat-0.1.0-win.exe` | 安装版，可选路径，带桌面/开始菜单快捷方式 |
| `dist\scout-cat-0.1.0-portable.exe` | 便携版，双击即用，不写注册表 |

> 未做代码签名，Windows 会提示「未知发布者」，点「仍要运行」即可。

### 方式二：从源码跑

```bash
npm install
npm start          # 自动先 build，再启动
```

### 配置

首次打开后进「设置 → 接口」填：

| 字段 | 说明 |
|---|---|
| Base URL | OpenAI 兼容接口地址，如 `https://api.deepseek.com/v1` |
| API Key | 模型 API Key（本地保存，不入库） |
| Model | 模型名，如 `deepseek-chat` |
| Search Base URL | 搜索服务地址，默认 `https://api.deepseek.com` |

> Key 保存在 `%APPDATA%\scout-cat\config.json`，**不在仓库里**。

---

## 文件说明

```
.
├── .gitignore                      排除 node_modules / out / dist / 日志 / 打包产物
├── package.json                    工程清单 + electron-builder 打包配置
├── package-lock.json               依赖锁定（201 KB）
├── electron.vite.config.mjs        electron-vite 配置
├── longcat.png                     托盘图标 + 程序图标（361×361）
├── README.md                       本文件
│
├── DeepSeek桌宠搜索去重与提示词设计.md    搜索/去重/提示词设计文档
└── 情报猎猫桌宠产品方案.md                产品方案
│
├── assets/pet/                     宠物素材（已预生成，运行时只读）
│   ├── character-base.png          角色标准图（引导页 logo）
│   ├── idle.png                    待机 5×5 精灵图（运行时用第 0 帧 + 程序动画）
│   ├── sleep.png                   睡觉 5×5 精灵图（同上）
│   ├── walk.png                    行走 5×5 精灵图（同上）
│   ├── discover.png                发现动作 5×5 精灵图（顺序播放）
│   ├── deliver.png                 报信动作 5×5 精灵图（顺序播放）
│   └── pet.png                     被摸动作 5×5 精灵图（顺序播放）
│
├── src/
│   ├── main/                               主进程
│   │   ├── index.js                        应用入口：窗口创建、IPC、光标轮询、托盘
│   │   ├── scheduler.js                    巡逻调度：定时巡逻、气泡队列、未读轮播、GitHub 推荐
│   │   ├── store.js                        持久化（electron-store）
│   │   ├── tray.js                         系统托盘
│   │   └── windows/
│   │       ├── pet.js                      宠物窗：尺寸/缩放/锚点/点击穿透/气泡区
│   │       ├── backpack.js                 发现背包窗
│   │       ├── settings.js                 设置窗
│   │       └── onboarding.js               首次引导窗
│   │
│   ├── preload/
│   │   └── index.js                        上下文桥（IPC 白名单）
│   │
│   ├── renderer/                           渲染层（每个目录一个独立窗口）
│   │   ├── pet/                            宠物：Canvas 动画、气泡、拖动、双击开背包、右键开设置
│   │   │   ├── index.html
│   │   │   └── main.js
│   │   ├── backpack/                       背包：列表、已阅/收藏/少看、按日期倒序
│   │   │   ├── index.html
│   │   │   └── main.js
│   │   ├── settings/                       设置：接口、偏好、提醒、外观、高级
│   │   │   ├── index.html
│   │   │   └── main.js
│   │   └── onboarding/                     首次引导
│   │       ├── index.html
│   │       └── main.js
│   │
│   └── common/
│       ├── discovery.js                     背包账本：去重、URL upsert、旧条目回填
│       └── engines/
│           ├── openai.js                    OpenAI 兼容 + DeepSeek 搜索/抓取、模型判断、中文简介
│           ├── prompt.js                    提示词（搜索查询、事件判断、JSON schema）
│           ├── pipeline.js                  巡逻管道：搜索 → 去重 → 判断 → 落库 → 提醒决策
│           ├── dedup.js                     批内去重：URL 去重、标题相似合并、历史事件关联
│           ├── normalize.js                 URL 规范化、内容指纹、文本清洗、中文判断
│           ├── search.js                    DeepSeek 搜索 / 抓取封装
│           ├── github-trending.js           GitHub 热榜抓取（HTML 解析）
│           ├── github-recommend.js          热榜去重、兴趣打分、中文简介
│           ├── registry.js                  引擎注册表
│           ├── index.js                     引擎入口（check / runPatrol）
│           └── util.js                      通用工具
│
└── test-*.mjs                               离线验证脚本（不需要网络/模型）
    ├── test-pipeline.mjs                    管道与去重（35 例）
    ├── test-review-fixes.mjs                审核项回归（9 例）
    └── test-backpack-dedup.mjs              背包去重专项（33 例）
```

---

## 工作原理

```
搜索 → 批内 URL 去重 → 标题相似合并 → 【背包账本过滤】
     → 模型判断 → 校验 → 落库（文章/事件/通知）
     → 背包 upsert → 提醒决策（免打扰 / 上限 / 气泡队列）
     → GitHub 热榜推荐（独立于搜索）
```

1. **搜索**：按兴趣生成查询，带时间范围（今天 / 近 7 天）与屏蔽词
2. **批内去重**：同批相同 URL 合并；标题相似度 ≥ 0.6 合并（版本号不同不合并）
3. **背包过滤**：已在背包且内容未变的直接跳过
4. **模型判断**：输出 `new_event` / `substantive_update` / `duplicate` / `uncertain`，
   并给出**中文一句话简介**
5. **落库**：文章、事件、通知三张表 + 候选状态
6. **提醒**：遵守免打扰 / 每日上限 / 全屏，一次只弹一条，其余进积压队列

---

## 设置说明

| 分组 | 项 | 说明 |
|---|---|---|
| 偏好 | 关注内容 | 兴趣关键词，影响搜索与推荐 |
| | 屏蔽词 | 搜索时排除的主题 |
| | 搜索范围 | 只看今天 / 近 7 天 |
| 提醒 | 检查频率 | 巡逻间隔（分钟） |
| | 每日最多弹气泡 | 0 = 不限；达到后进背包不弹窗 |
| | 免打扰 | 时段内不主动弹 |
| | 未读轮播 | 有未读时持续轮播提醒 |
| 外观 | 缩放 | 小 / 标准 / 大 / 特大（窗口随之缩放） |
| | 气泡时长 | 气泡停留秒数 |
| 高级 | 每次查询数 / Fetch 上限 | 搜索广度 |
| | 事件保存天数 | 内部历史事件保留期 |
| | 模型 JSON Output | 提升解析稳定性 |

---

## 测试

```bash
node test-pipeline.mjs
node test-review-fixes.mjs
node test-backpack-dedup.mjs
```

覆盖：URL 规范化、内容指纹、标题相似去重、背包 upsert、中文简介、
JSON 容错解析、日期解析、背包去重准绳等。

---

## 打包

```bash
npm run build     # 产出 out/
npm run dist      # 打包 exe（NSIS 安装版 + 便携版）
```

### 用 GitHub Actions 打包

已配置 `.github/workflows/build.yml`：

- 推送 `v*` 标签 → 自动构建 NSIS 安装版和便携版，并挂到对应 Release
- 手动触发 → 仓库页 Actions → Build Windows Installer → Run workflow
- 手动触发时可选 target：`nsis`（默认）/ `portable` / `all`
- 产物在该次运行的 Artifacts 里下载，保留 30 天

构建流程：安装依赖 → 编译 → 跑 77 个离线测试 → 打包。全部在 GitHub 的
Windows 服务器上完成，不需要本地环境。

---

## 技术栈

- Electron 33 + electron-vite
- Canvas 2D 绘制宠物（程序化呼吸/眨眼 + 精灵表动作）
- electron-store 本地持久化
- OpenAI 兼容接口 + DeepSeek 搜索 / 抓取
- electron-builder 打包