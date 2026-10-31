# 情报猎猫（Scout Cat）

AI 情报桌面宠物。你把关注的事情交给它，它持续寻找，带回值得花几十秒了解的发现。

## 功能

- **桌面宠物**：透明悬浮窗、拖动、点击穿透、托盘驻留、呼吸/眨眼/巡逻/发现/报信/被摸等动作
- **情报巡逻**：按设定频率调用 OpenAI 兼容模型 + DeepSeek 搜索，搜集 AI 新闻、工具与项目进展
- **发现背包**：新发现 / 已收藏 / 正在关注 三个入口，点击直达原文
- **关注任务**：「这个项目发布 Windows 版时告诉我」
- **气泡提醒**：高度相关的发现触发宠物报信动作 + 简短气泡
- **免打扰 / 每日上限**：活跃时段、免打扰时间、每日最多弹出次数

## 快速开始

```bash
npm install
npm run dev
```

首次打开后在「设置」里选择执行引擎：

- **OpenAI 兼容 + 搜索**：填写 Base URL、API Key、Model，搜索使用 DeepSeek Search/Fetch
- **演示模式**：无需任何依赖，立即体验完整流程

### OpenAI 兼容引擎配置

| 字段 | 说明 |
|---|---|
| Base URL | OpenAI 兼容接口地址，如 `https://api.deepseek.com/v1` |
| API Key | 模型 API Key |
| Model | 模型名，如 `deepseek-chat` |
| DeepSeek Search Key | 搜索专用 Key，留空则复用 API Key |
| Search Base URL | 搜索服务地址，默认 `https://api.deepseek.com` |

> 搜索接口：`POST /v1/tools/search`、`POST /v1/tools/fetch`，详见 [DeepSeek 文档](https://api-docs.deepseek.com/zh-cn/api/search.md)

## 生成宠物素材

素材基于中转站图生图（`longcat.png` 作为角色身份参考）：

```bash
# 角色标准图
npm run gen:character

# 六个动作图集（依赖 character-base.png）
npm run gen:sheets
```

> 图集下载需走代理（`http://127.0.0.1:7897`），详见 `test-api/image-api.mjs`。

## 技术栈

- Electron + electron-vite（透明窗口、点击穿透、托盘）
- Canvas 绘制 5×5 sprite sheet 动画（12 fps）
- electron-store 本地持久化
- OpenAI 兼容引擎 + DeepSeek 搜索封装

## 目录结构

```
src/
├── main/            主进程：窗口、托盘、调度、存储
├── preload/         上下文桥
├── renderer/        pet / backpack / settings 三个渲染层
└── common/engines/  引擎适配器与提示词
assets/pet/          生成的角色与动作图集
scripts/             素材生成脚本
test-api/            中转站图生图客户端
```

## 开发状态

第一阶段（Windows 完整桌宠）骨架完成：
- [x] 透明悬浮宠物窗口 + 动画 + 拖动 + 点击穿透
- [x] 托盘菜单
- [x] 发现背包（新发现 / 已收藏 / 正在关注）
- [x] 设置（兴趣、频率、引擎、免打扰、关注任务）
- [x] 引擎适配层（OpenAI 兼容 + DeepSeek 搜索 / 演示）
- [x] 定时调度
- [x] 免打扰时段 + 每日弹出上限
- [x] 休眠恢复合并补查
- [x] 关注任务状态更新与达成提醒
- [x] 免费额度耗尽暂停提示
- [ ] 全屏/专注状态暂缓
