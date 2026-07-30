# 代码乡愁 · 绿萝AI对话配置指南（AMAX版）

## 原理

```
game.js → wx.cloud.callFunction('greenluo_chat') → AMAX Token Router → GLM-4-Flash
```

## 部署步骤

### 第1步：部署云函数

1. 微信开发者工具 → 右键 `cloudfunctions/greenluo_chat` → **上传并部署：云端安装依赖**
2. 等待部署完成

### 第2步：设置环境变量

1. 微信开发者工具 → 云开发控制台 → 云函数 → `greenluo_chat`
2. 点击 **配置** 或 **环境变量**
3. 添加以下环境变量：

| 变量名 | 值 | 必填 | 说明 |
|--------|-----|------|------|
| `AI_API_KEY` | 你的AMAX API Key | ✅ 必填 | AMAX Token Router 的 API Key |
| `AI_BASE_URL` | `https://api.amax-router.com/v1/chat/completions` | 可选 | 不填用默认值 |
| `AI_PROVIDER` | `glm` | 可选 | 不填默认glm → glm-4-flash |

4. 保存

### 第3步：获取AMAX API Key

1. 访问 AMAX Token Router 平台注册
2. 创建 API Key
3. 粘贴到云函数环境变量 `AI_API_KEY` 中

### 第4步：测试

1. 在游戏中走到绿萝旁边
2. 点击对话
3. 说话或打字
4. 如果绿萝正常回复 → 配置成功
5. 如果回复兜底台词 → 检查环境变量是否设置正确

---

## 换模型/Provider

在环境变量中修改 `AI_PROVIDER`：

| AI_PROVIDER | 实际模型 | 特点 |
|-------------|---------|------|
| **glm** | `glm-4-flash` | ⭐ 默认，免费额度，中文好 |
| `glm4` | `glm-4` | 更强，收费 |
| `deepseek` | `deepseek-chat` | 推理强 |
| `gpt4o` | `gpt-4o-mini` | OpenAI |
| `claude` | `claude-3-haiku-20240307` | Anthropic |
| `kimi` | `moonshot-v1-8k` | 长上下文 |

具体可用模型列表见 AMAX Token Router 平台文档。

---

## 无API Key时的行为

如果未设置 `AI_API_KEY`，云函数不会报错，而是返回预设的兜底台词：
- 绿萝：「……你读到了我。三十年了，那些注释里，我一直在等。」
- 商人：「欢迎光临！看看有什么需要的。」
- 师父：「代码之路，始于Hello World。」
- Boss：「……你终于找到我了。」

游戏可以正常运行，只是对话内容固定。设置API Key后，对话变为AI生成。

---

## 语音命令（不需要AI）

以下语音命令在云函数中本地识别，**不消耗AI额度**：

| 命令 | 关键词 |
|------|--------|
| 移动 | 向北走/向南走/向东走/向西走/上/下/左/右 |
| 攻击 | 攻击/打/战斗/出手 |
| 防御 | 防御/防守/格挡 |
| 技能 | 用技能/释放/断点术/递归/编译 |
| 道具 | 用药水/吃药/恢复 |
| 买 | 买/购买 |
| 卖 | 卖/出售 |
| 存档 | 存档/保存/git commit |
| 休息 | 休息/睡觉/回血 |
| 搜索 | 搜索/找/翻/秘籍 |
| 出门 | 出去/离开/出门 |
| 菜单 | 菜单/背包/装备/技能树 |
| 绿萝治愈 | 绿萝治愈/绿萝治疗 |
| 绿萝攻击 | 绿萝攻击/绿萝gcc |

只有**非命令**的对话（如"你是谁""这个江湖是什么"）才会调AMAX API。
