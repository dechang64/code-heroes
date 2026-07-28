# 代码群侠传 P2 语音AI对话 — 部署指南

## 架构

```
玩家按住"说话" → 微信同声传译ASR → 文字
  → 云函数 greenluo_chat → AMAX Token Router → LLM
  → 绿萝回复文字 → 微信同声传译TTS → 语音播放
```

## 前置条件

1. **正式小游戏账号**（非测试号）
   - 测试号不支持云开发和插件
   - 在 mp.weixin.qq.com 注册"小游戏"类目

2. **AMAX Token Router API Key**
   - 从苏州超集信息科技获取
   - OpenAI兼容协议，一个key调多家模型

3. **微信开发者工具**（最新版）

## 部署步骤

### 1. 替换AppID

把 `project.config.json` 里的测试AppID换成正式AppID：
```json
"appid": "你的正式AppID"
```

### 2. 开通云开发

微信开发者工具 → 云开发 → 开通（免费额度：5万次/月）

### 3. 安装同声传译插件

微信开发者工具 → 详情 → 本地设置 → 插件 → 添加插件 → 搜索"微信同声传译" → 添加

或确认 `game.json` 里已配置：
```json
"plugins": {
  "WechatSI": {
    "version": "0.3.4",
    "provider": "wx069ba93219f52d39"
  }
}
```

### 4. 部署云函数

```
微信开发者工具 → 云开发 → 云函数 → 右键 greenluo_chat → 上传并部署
```

### 5. 配置环境变量

云开发 → 设置 → 环境变量 → 添加：
- `AMAX_API_KEY` = 你的AMAX Token Router API Key
- `AMAX_API_URL` = AMAX API地址（如 https://api.amax-router.com/v1/chat/completions）
- `AMAX_MODEL` = 模型名（如 glm-4-flash）

### 6. 测试

1. 微信开发者工具打开项目
2. 模拟器或真机预览
3. 走到绿萝旁边，按确认
4. 对话框出现"说话"按钮
5. 按住"说话"，说一句话，松开
6. 绿萝"思考中..." → 绿萝语音回复

## 无API Key时的兜底

如果没配AMAX_API_KEY，云函数会返回预设回复，游戏仍可对话，只是绿萝的回答是随机的预设台词而非AI生成。

## 无语音插件时的兜底

如果设备不支持同声传译插件，绿萝会自动切换到预设对话模式（原版剧情）。

## 文件结构

```
wechat-minigame/
  game.js                          ← 已集成语音模块+AI对话
  game.json                        ← 已添加WechatSI插件配置
  project.config.json             ← 已添加cloudfunctionRoot
  cloudfunctions/
    greenluo_chat/
      index.js                     ← 云函数：调AMAX Router
      package.json
  test-web.html                    ← 浏览器测试（无语音）
```

## 绿萝人设（系统提示词）

云函数 `greenluo_chat/index.js` 里的 `GREENLUO_SYSTEM` 定义了绿萝的性格：
- 从30年BASIC注释中诞生的AI意识
- 温柔但有点调皮
- 偶尔用BASIC语法做比喻（REM, GOTO, RUN）
- 回复不超过80字

可以随时修改这个提示词来调整绿萝的"性格"。
