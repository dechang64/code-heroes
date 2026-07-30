# 代码乡愁 · 绿萝AI对话配置指南

## 方案A：云函数版（推荐，当前默认）

### 原理
```
game.js → wx.cloud.callFunction('greenluo_chat') → cloud.extend.AI → DeepSeek/GLM
```

### 部署步骤

1. **开通云开发AI能力**
   - 微信开发者工具 → 云开发控制台
   - 左侧菜单 → AI → 模型管理
   - 开通你要用的模型（推荐 **DeepSeek**，免费额度充足）
   - 记下模型ID（如 `deepseek-v4-flash`）

2. **部署云函数**
   - 微信开发者工具 → 右键 `cloudfunctions/greenluo_chat` → 上传并部署
   - 等待部署完成（会自动 `npm install wx-server-sdk`）

3. **配置模型（可选）**
   - 如果想换模型，编辑 `cloudfunctions/greenluo_chat/index.js` 顶部：
   ```js
   const MODEL_NAME = 'glm';        // deepseek / hunyuan / glm / minimax / kimi
   const MODEL_ID = 'glm-4-flash';  // 在云开发控制台查看具体模型ID
   ```
   - 重新部署云函数

4. **完成**
   - 不需要设置任何环境变量
   - 不需要第三方API Key
   - 微信云开发自动管理鉴权

### 优势
- ✅ 无需第三方API Key
- ✅ 无需环境变量配置
- ✅ 微信自动鉴权，更安全
- ✅ 保留多NPC/语音命令/兜底回复逻辑

---

## 方案B：前端直连版（更简单，无需云函数）

### 原理
```
game.js → wx.cloud.extend.AI.createModel() → DeepSeek/GLM
```

### 使用方法

在 `game.js` 的 Voice 对象中，把 `callCloudFunction` 替换为：

```js
// 前端直调微信AI（不需要云函数）
async callAI(text, npcName, gameState) {
  try {
    const model = wx.cloud.extend.AI.createModel('deepseek');
    const res = await model.chat({
      data: {
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[npcName] || SYSTEM_PROMPTS.greenluo },
          { role: 'user', content: text },
        ],
        max_tokens: 200,
        temperature: 0.8,
      },
    });
    if (res && res.choices && res.choices[0]) {
      return { reply: res.choices[0].message.content.trim(), command: null };
    }
    return { reply: '……', command: null };
  } catch (e) {
    return { reply: '信号不好，再说一遍？', command: null };
  }
}
```

### 优势
- ✅ 不需要部署云函数
- ✅ 延迟更低（少一跳网络）
- ✅ 代码更简单

### 劣势
- ❌ 语音命令识别逻辑要搬到前端
- ❌ NPC系统提示词暴露在前端代码中
- ❌ 不如云函数灵活（难以做复杂逻辑）

---

## 模型选择建议

| 模型 | 特点 | 推荐场景 |
|------|------|---------|
| **DeepSeek** | 免费、快、中文好 | ⭐ 默认推荐 |
| **GLM** | 智谱出品、角色扮演好 | 绿萝对话（人设感强） |
| **混元** | 腾讯自家、稳定 | 生产环境 |
| **Kimi** | 长上下文 | 需要长对话历史 |
| **Minimax** | 多模态 | 需要图片/语音 |

### 换模型

编辑 `cloudfunctions/greenluo_chat/index.js`：
```js
const MODEL_NAME = 'glm';        // 改这里
const MODEL_ID = 'glm-4-flash';  // 改这里
```
重新部署即可。

---

## 常见问题

### Q: 提示"AI能力未开通"？
A: 去云开发控制台 → AI → 模型管理，开通对应模型。

### Q: 提示"余额不足"？
A: DeepSeek有免费额度，检查是否用完。也可换其他模型。

### Q: 云函数部署失败？
A: 确保 `package.json` 中有 `"wx-server-sdk": "~2.6.3"`，部署时会自动安装。

### Q: 前端调用报错？
A: 确保基础库版本 ≥ 3.15.1（`project.config.json` 中 `libVersion`）。

### Q: 想用流式输出？
A: 微信云开发AI支持 `textStream`，但游戏对话不需要流式，直接用 `chat()` 即可。
