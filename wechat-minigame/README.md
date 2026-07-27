# 代码群侠传 - 微信小游戏版

## 当前状态：v0.1 可运行 ✅

### 已验证功能
- Canvas渲染（地图+战斗双场景）
- 图片加载（5张素材全部加载成功）
- 触摸摇杆（左半屏拖动控制角色移动）
- 随机遭遇战（走动触发战斗）
- 战斗UI（技能菜单、HP/MP、战斗日志）
- 触摸确认按钮（右半屏点击确认/对话）

### 项目结构
```
wechat-minigame/
├── game.js              # 游戏主逻辑（从Web版迁移+触摸控件）
├── game.json            # 小游戏配置
├── project.config.json  # 微信开发者工具配置
├── assets/              # 游戏素材
│   ├── town_bg.png      # 村庄背景
│   ├── battle_bg.png    # 战斗背景
│   ├── laochen_portrait.png  # 老陈立绘
│   ├── greenluo_portrait.png # 绿萝立绘
│   └── bug_enemy.png    # Bug敌人
├── test-web.html        # 浏览器测试页（模拟小游戏环境）
├── screenshot_map.png   # 地图场景截图
└── screenshot_battle.png # 战斗场景截图
```

### 如何在微信开发者工具中运行
1. 打开微信开发者工具
2. 选择"小游戏"项目
3. 导入 `wechat-minigame/` 目录
4. AppID填你自己的小游戏AppID（或用测试号）
5. 点击运行

### 如何在浏览器中测试
直接打开 `test-web.html` 即可。test-web.html 提供了wx API的浏览器模拟层。

### 触摸操作
- **左半屏拖动**：虚拟摇杆，控制角色移动
- **右半屏点击**：确认/对话/战斗选技能

### 从Web版迁移的改动
| 模块 | Web版 | 小游戏版 |
|------|-------|---------|
| Canvas创建 | `document.getElementById('game')` | `wx.createCanvas()` |
| 图片加载 | `new Image()` | `wx.createImage()` |
| 输入 | 键盘事件（WASD/方向键/空格） | 触摸事件（虚拟摇杆+确认按钮） |
| 主循环 | `requestAnimationFrame` | `canvas.requestAnimationFrame` |
| 文件结构 | 单HTML文件 | `game.js` + `game.json` + `project.config.json` |
| DOM操作 | `loadingEl.style.display` | 删除，改canvas内绘制 |

### 已知问题
1. **黑边**：横版640×480在竖屏手机上有letterbox黑边。后续可考虑：
   - 改成竖屏游戏（改地图布局）
   - 或旋转画面（GBA模拟器模式）
2. **角色立绘白底**：AI生图的白底未去透明，画面中显示白边
3. **UI风格偏现代**：半透明黑底边框与手绘水彩风有脱节

### 下一步
- [ ] 去除角色立绘白底（用Canvas抠图或重新生成透明背景素材）
- [ ] 优化竖屏适配（考虑改成竖屏地图布局）
- [ ] 添加更多NPC对话和战斗内容
- [ ] 微信开发者工具真机测试
- [ ] 申请游戏备案号
