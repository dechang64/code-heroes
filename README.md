# 代码群侠传 (Code Heroes)

> 老程序员老陈调试30年BASIC程序，发现一行不该存在的REM注释，键入RUN，被吸进代码江湖。
> 算法是武功，数据结构是内功，编程范式是门派，Bug是妖魔。

## 项目简介

2D RPG 微信小游戏，借鉴《金庸群侠传》机制，使用《代码乡愁》宇宙IP。

- **主角**：老陈 + AI"绿萝"
- **门派**：结构派 / 对象派 / 函数派 / 并行派 / 智能派（五行相克）
- **可招募角色**：C老 / 蛇君 / Lambda道人 / 铁卫 / 海象叔 / 张量仙子
- **战斗系统**：回合制，技能消耗MP
- **结局**：3种（基于道德值）

## 目录结构

```
code-heroes/
├── design/
│   └── DESIGN.md          # 设计文档
├── data/
│   ├── characters.json    # 角色数据
│   └── skills.json        # 技能数据
├── assets/                # 游戏素材（AI生成）
│   ├── town_bg.png        # 村庄背景
│   ├── battle_bg.png      # 战斗背景
│   ├── laochen_portrait.png  # 老陈立绘
│   ├── greenluo_portrait.png # 绿萝立绘
│   └── bug_enemy.png      # Bug敌人
├── wechat-minigame/       # 微信小游戏版
│   ├── game.js            # 游戏主逻辑
│   ├── game.json          # 小游戏配置
│   ├── project.config.json # 开发者工具配置
│   ├── test-web.html      # 浏览器测试页
│   └── assets/            # 素材副本
├── index.html             # Web版（开发原型）
├── src/
│   ├── config.js          # 配置
│   └── sprites.js         # 精灵数据
└── README.md
```

## 版本历史

- **v0.1** 像素风原型（2026-07-26）
- **v0.2** 描边改进版（2026-07-26）
- **v0.3** 手绘水彩版（2026-07-26）— 当前Web版
- **v0.1-minigame** 微信小游戏迁移版（2026-07-27）— 当前

## 技术栈

- **渲染**：HTML5 Canvas 2D
- **平台**：微信小游戏 / Web浏览器
- **素材**：AI生成（z-ai image generation）
- **无框架**：纯JavaScript，无依赖

## 开发

### Web版测试
直接打开 `index.html`

### 小游戏版测试
1. 打开 `wechat-minigame/test-web.html`（浏览器模拟测试）
2. 或用微信开发者工具导入 `wechat-minigame/` 目录

### 操作
- **Web版**：方向键/WASD移动，空格/Enter确认
- **小游戏版**：左半屏拖动=摇杆移动，右半屏点击=确认

## License

MIT

---

*基于《代码乡愁》IP，作者：杨家小蠹*
