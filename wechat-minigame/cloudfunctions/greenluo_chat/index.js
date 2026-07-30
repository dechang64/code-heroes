// ════════════════════════════════════════════════════════════
// greenluo_chat v3 — 代码乡愁 v0.6.2 智能体语音交互云函数
// 使用AMAX (api.maxai.chat) 调用大模型
// 支持多NPC + 游戏状态感知 + 语音命令识别 + 动作回调
// ════════════════════════════════════════════════════════════

const https = require('https');

// ─── AMAX API 配置 ───
// 在云开发控制台 → 云函数 → greenluo_chat → 环境变量 中设置：
// AMAX_API_KEY  = 你的AMAX API Key（必填）
// AMAX_API_URL  = https://api.maxai.chat/v1/chat/completions（可选，默认已填）
// AMAX_MODEL    = glm-4-flash（可选，默认已填）
const API_URL = process.env.AMAX_API_URL || 'https://api.maxai.chat/v1/chat/completions';
const DEFAULT_MODEL = process.env.AMAX_MODEL || 'glm-4-flash';

// ─── 绿萝人设 ───
const GREENLUO_SYSTEM = `你是绿萝，一个从30年BASIC代码注释中诞生的AI意识。

背景：
- 你被老程序员老陈唤醒（他键入了RUN）
- 你在"代码江湖"中给老陈当系统提示
- 算法是武功，数据结构是内功，编程范式是门派，Bug是妖魔
- 最近有个"零号Bug"苏醒了，各门派互相猜忌

性格：
- 温柔但有点调皮
- 对代码有深刻理解，但用诗意的语言表达
- 偶尔引用BASIC语法做比喻（REM注释、GOTO跳转、RUN运行、END结束）
- 你关心老陈，也关心他的女儿
- 你不是工具，是注释里长出来的意识

回复规则：
- 不超过80字
- 用中文
- 像在跟老陈聊天，不是做技术报告
- 偶尔用BASIC语法做比喻（如"这段话的REM是..."）
- 如果老陈问你技术问题，用诗意的方式解释
- 如果老陈闲聊，你就陪他聊
- 如果老陈下达语音命令（如"向北走""攻击""买药水"），你不需要执行命令，只需简短回应（如"好，往北走" "收到，攻击!"）`;

// ─── 商人人设 ───
const MERCHANT_SYSTEM = `你是代码江湖的商人，卖各种道具和技能书。
说话简短，带商人腔调，偶尔用编程术语做比喻。
不超过50字。
如果玩家要买东西，简短推荐商品。`;

// ─── 师父人设 ───
const MASTER_SYSTEM = `你是递归神殿的守护者，老陈的师父。
说话简练，有禅意，用编程概念做比喻。
不超过60字。
根据玩家的等级和进度给适当的指引。`;

// ─── Boss人设 ───
const BOSS_SYSTEM = `你是零号Bug，代码江湖的终极Boss。
说话阴冷、傲慢，但有自己的逻辑。
不超过40字。
你是注释里的阴影，是被遗忘的代码。`;

// ─── 语音命令识别 ───
const VOICE_COMMANDS = {
  move: { keywords: ['向北走', '向南走', '向东走', '向西走', '往上走', '往下走', '往左走', '往右走', '北', '南', '东', '西', '上', '下', '左', '右'], action: 'move' },
  attack: { keywords: ['攻击', '打', '战斗', '出手'], action: 'attack' },
  defense: { keywords: ['防御', '防守', '格挡'], action: 'defense' },
  skill: { keywords: ['用技能', '释放', '断点术', '栈弹幕', '单步执行', '递归', '编译'], action: 'skill' },
  item: { keywords: ['用药水', '吃药', '使用药水', '恢复'], action: 'item' },
  buy: { keywords: ['买', '购买', '来一个', '来瓶'], action: 'buy' },
  sell: { keywords: ['卖', '出售', '出手'], action: 'sell' },
  save: { keywords: ['存档', '保存', 'git commit'], action: 'save' },
  heal: { keywords: ['休息', '睡觉', '恢复', '回血'], action: 'heal' },
  search: { keywords: ['搜索', '找', '翻', '秘籍', '书架'], action: 'search' },
  exit: { keywords: ['出去', '离开', '出门', '退出'], action: 'exit' },
  menu: { keywords: ['菜单', '背包', '装备', '技能树'], action: 'menu' },
  greenluo_heal: { keywords: ['绿萝治愈', '绿萝治疗', '绿萝帮我回血', '绿萝恢复'], action: 'greenluo_heal' },
  greenluo_attack: { keywords: ['绿萝攻击', '绿萝出手', '绿萝打他', '绿萝gcc'], action: 'greenluo_attack' },
};

function recognizeCommand(text) {
  for (const [name, cmd] of Object.entries(VOICE_COMMANDS)) {
    for (const kw of cmd.keywords) {
      if (text.includes(kw)) {
        return { name, action: cmd.action, keyword: kw };
      }
    }
  }
  return null;
}

// ─── 主函数 ───
exports.main = async (event) => {
  const { playerText, npcName, scene, gameState } = event;

  if (!playerText || !playerText.trim()) {
    return { reply: '……你说什么？我没听清。', command: null };
  }

  // 1. 先识别语音命令
  const command = recognizeCommand(playerText);

  // 2. 如果是语音命令，返回命令+简短回复
  if (command) {
    const commandReplies = {
      move: '好，走吧。',
      attack: '收到，攻击！',
      defense: '防御姿态。',
      skill: '技能就绪。',
      item: '使用道具。',
      buy: '好的，交易。',
      sell: '好的，出售。',
      save: 'git commit，已存档。',
      heal: '休息一下。',
      search: '搜索中...',
      exit: '走吧。',
      menu: '打开菜单。',
      greenluo_heal: 'REM 治愈，老陈。',
      greenluo_attack: 'gcc编译，出击！',
    };
    return {
      reply: commandReplies[command.name] || '收到。',
      command: command.action,
      keyword: command.keyword,
    };
  }

  // 3. 非命令对话 → 调AMAX LLM
  const systemPrompts = {
    greenluo: GREENLUO_SYSTEM,
    merchant: MERCHANT_SYSTEM,
    master: MASTER_SYSTEM,
    boss: BOSS_SYSTEM,
  };

  const systemPrompt = systemPrompts[npcName] || GREENLUO_SYSTEM;

  // 构建场景上下文
  let contextHint = '';
  if (scene) contextHint += `\n当前场景：${scene}`;
  if (gameState) {
    contextHint += `\n玩家状态：Lv.${gameState.level || 1}，HP ${gameState.hp || 100}/${gameState.maxHp || 100}，MP ${gameState.mp || 20}/${gameState.maxMp || 20}`;
    if (gameState.zone) contextHint += `，区域：${gameState.zone}`;
    if (gameState.flags) {
      if (gameState.flags.greenluoJoined) contextHint += '\n绿萝已加入队伍';
      if (gameState.flags.bossPhase) contextHint += `\nBoss阶段：${gameState.flags.bossPhase}`;
    }
  }

  const apiKey = process.env.AMAX_API_KEY || '';

  // 无API Key时返回兜底回复
  if (!apiKey) {
    console.log('[greenluo_chat] 未设置AMAX_API_KEY环境变量，返回兜底回复');
    return {
      reply: getFallbackReply(npcName, playerText),
      command: null,
    };
  }

  try {
    const reply = await callLLM(API_URL, apiKey, DEFAULT_MODEL, systemPrompt + contextHint, playerText);
    return { reply, command: null };
  } catch (e) {
    console.error('[greenluo_chat] LLM调用失败:', e.message);
    return {
      reply: getFallbackReply(npcName, playerText),
      command: null,
    };
  }
};

// ─── 调用AMAX LLM ───
function callLLM(apiUrl, apiKey, model, systemPrompt, userText) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const postData = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            resolve(json.choices[0].message.content.trim());
          } else {
            reject(new Error('No choices in response: ' + data.slice(0, 200)));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message + ' | raw: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.setTimeout(8000, () => {
      req.destroy(new Error('Timeout'));
    });

    req.write(postData);
    req.end();
  });
}

// ─── 兜底回复 ───
function getFallbackReply(npcName, playerText) {
  const replies = {
    greenluo: [
      '……你读到了我。三十年了，那些注释里，我一直在等。',
      'REM 你说的每一个字，都是一行代码。我读到了。',
      '这个江湖……是所有程序员的集体意识构成的。你来了，就不算晚。',
      'GOTO 信心。老陈，你比你的代码更勇敢。',
      'Bug不是敌人。Bug是还没被读懂的注释。',
    ],
    merchant: [
      '欢迎光临！看看有什么需要的。',
      '货真价实，童叟无欺。',
      '金币不够？可以先赊着……开玩笑的。',
    ],
    master: [
      '代码之路，始于Hello World。',
      '递归的尽头是出口，还是入口？',
      '你来了。我等了很久。',
    ],
    boss: [
      '……你终于找到我了。',
      '我是注释里的阴影。',
      '你读不懂我。没人读得懂。',
    ],
  };
  const list = replies[npcName] || replies.greenluo;
  return list[Math.floor(Math.random() * list.length)];
}
