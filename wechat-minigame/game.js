// ════════════════════════════════════════════════════════════
// 代码乡愁 v0.6 — 智能体语音交互版
// 升级：多NPC智能体+语音对话+语音命令+游戏状态感知
// ════════════════════════════════════════════════════════════

// ─── Canvas 初始化 ───
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
const SW = canvas.width;
const SH = canvas.height;
const sysInfo = wx.getSystemInfoSync();
const dpr = sysInfo.pixelRatio || (SW / sysInfo.windowWidth);
const LW = sysInfo.windowWidth;
const LH = sysInfo.windowHeight;
const CW = 400, CH = 640;
const scale = Math.min(SW / CW, SH / CH);
const offsetX = (SW - CW * scale) / 2;
const offsetY = (SH - CH * scale) / 2;

// ─── 图片加载 ───
const IMAGES = {};
const IMAGE_LIST = {
  town_bg: 'assets/town_bg.png',
  battle_bg: 'assets/battle_bg.png',
  laochen: 'assets/laochen_portrait.png',
  greenluo: 'assets/greenluo_portrait.png',
  bug: 'assets/bug_enemy.png',
  splash: 'assets/cover_1344x768.png',
};
function loadImages() {
  return Promise.all(Object.entries(IMAGE_LIST).map(([key, src]) => {
    return new Promise((resolve) => {
      const img = wx.createImage();
      img.onload = () => { IMAGES[key] = img; resolve(); };
      img.onerror = () => { resolve(); };
      img.src = src;
    });
  }));
}

// ════════════════════════════════════════════════════════════
// 音效系统
// ════════════════════════════════════════════════════════════
const SFX = {
  pool: [],
  enabled: true,
  stepTimer: 0,
  init() {
    // 预创建几个音频上下文做池
    for (let i = 0; i < 6; i++) {
      try {
        const ctx = wx.createInnerAudioContext();
        this.pool.push(ctx);
      } catch(e) { break; }
    }
    this.idx = 0;
  },
  play(name) {
    if (!this.enabled || this.pool.length === 0) return;
    try {
      const ctx = this.pool[this.idx % this.pool.length];
      this.idx++;
      ctx.stop();
      ctx.src = `assets/sfx/${name}.wav`;
      ctx.volume = 0.5;
      ctx.play();
    } catch(e) {}
  },
  step() {
    // 脚步声节流：每250ms一次
    const now = Date.now();
    if (now - this.stepTimer < 250) return;
    this.stepTimer = now;
    this.play('step');
  },
};
SFX.init();

// ════════════════════════════════════════════════════════════
// 触摸输入 — 浮动摇杆版
// ════════════════════════════════════════════════════════════
const Input = {
  joystick: { active: false, startX: 0, startY: 0, dx: 0, dy: 0, touchId: null },
  confirmPressed: false, prevConfirmPressed: false, pendingConfirm: false,
  menuButton: false, prevMenuButton: false, pendingMenu: false,
  lastTouchX: 0, lastTouchY: 0, touchLog: 'none',
  prevBattleNavUp: false, prevBattleNavDown: false,
  prevBattleNavLeft: false, prevBattleNavRight: false,

  init() {
    wx.onTouchStart((e) => {
      const touches = e.changedTouches || e.touches;
      for (const touch of touches) {
        const tx = touch.clientX || touch.x || 0;
        const ty = touch.clientY || touch.y || 0;
        this.lastTouchX = tx;
        this.lastTouchY = ty;
        this.touchLog = `start(${Math.round(tx)},${Math.round(ty)})`;

        // 菜单按钮（右上角）
        if (tx > LW - 60 && ty < 60 && Game.scene === 'map') {
          this.pendingMenu = true;
          this.menuButton = true;
          continue;
        }
        // 语音按钮 — 对话AI模式（右下角）
        if (Game.scene === 'dialogue' && Game.dialogue && Game.dialogue.mode === 'ai' && Voice.enabled) {
          const vbX = LW - 80, vbY = LH - 80;
          if (Math.hypot(tx - vbX, ty - vbY) < 50) {
            Voice.voiceButton = true;
            Voice.startRecord();
            continue;
          }
        }
        // 语音快捷按钮 — 地图/室内/战斗（左下角）
        if (Voice.enabled && (Game.scene === 'map' || Game.scene === 'interior' || Game.scene === 'battle')) {
          const vbX2 = 80, vbY2 = LH - 80;
          if (Math.hypot(tx - vbX2, ty - vbY2) < 40) {
            Voice.voiceButton = true;
            if (Game.scene === 'map' || Game.scene === 'interior') {
              Voice.lastNpc = { id: 'greenluo', label: '绿萝' };
              Game.scene = 'dialogue';
              Game.dialogue = {
                speaker: '绿萝', portrait: 'greenluo',
                lines: ['（按住语音按钮说话）'],
                lineIndex: 0, charIndex: 999, done: true,
                mode: 'ai', aiState: 'idle',
              };
            }
            continue;
          }
        }
        // 确认按钮（右下角圆形）
        const btnX = LW - 80, btnY = LH - 80;
        if (Math.hypot(tx - btnX, ty - btnY) < 50) {
          this.confirmPressed = true;
          this.pendingConfirm = true;
          continue;
        }
        // 对话/菜单/商店场景：任意位置点击=确认
        if (Game.scene === 'dialogue' || Game.scene === 'menu' || Game.scene === 'shop') {
          this.confirmPressed = true;
          this.pendingConfirm = true;
          continue;
        }
        // 浮动摇杆：触摸点不在按钮上时，从触摸点开始
        if (!this.joystick.active && Game.scene !== 'dialogue') {
          this.joystick.active = true;
          this.joystick.startX = tx;
          this.joystick.startY = ty;
          this.joystick.dx = 0;
          this.joystick.dy = 0;
          this.joystick.touchId = touch.identifier;
        }
      }
    });

    wx.onTouchMove((e) => {
      const touches = e.changedTouches || e.touches;
      for (const touch of touches) {
        if (this.joystick.active && touch.identifier === this.joystick.touchId) {
          const tx = touch.clientX || touch.x || 0;
          const ty = touch.clientY || touch.y || 0;
          this.joystick.dx = tx - this.joystick.startX;
          this.joystick.dy = ty - this.joystick.startY;
          this.lastTouchX = tx;
          this.lastTouchY = ty;
        }
      }
    });

    wx.onTouchEnd((e) => {
      const touches = e.changedTouches || e.touches;
      for (const touch of touches) {
        if (this.joystick.active && touch.identifier === this.joystick.touchId) {
          this.joystick.active = false;
          this.joystick.dx = 0;
          this.joystick.dy = 0;
          this.joystick.touchId = null;
        }
        // 语音按钮松开 → 停止录音
        if (Voice.voiceButton) {
          Voice.voiceButton = false;
          Voice.stopRecord();
        }
        this.confirmPressed = false;
      }
    });
  },

  getDirX() { return this.joystick.active ? Math.max(-1, Math.min(1, this.joystick.dx / 40)) : 0; },
  getDirY() { return this.joystick.active ? Math.max(-1, Math.min(1, this.joystick.dy / 40)) : 0; },

  pressedConfirm() {
    if (this.pendingConfirm) { this.pendingConfirm = false; return true; }
    return this.confirmPressed && !this.prevConfirmPressed;
  },
  pressedMenu() {
    if (this.pendingMenu) { this.pendingMenu = false; return true; }
    return this.menuButton && !this.prevMenuButton;
  },
  update() {
    this.prevConfirmPressed = this.confirmPressed;
    this.prevMenuButton = this.menuButton;
    this.menuButton = false;
  }
};

// ════════════════════════════════════════════════════════════
// 语音系统 — 智能体语音交互
// ════════════════════════════════════════════════════════════
const Voice = {
  si: null,
  asr: null,
  tts: null,
  state: 'idle',
  recognizedText: '',
  aiReply: '',
  enabled: false,
  voiceButton: false,
  lastNpc: null,

  init() {
    // 语音识别(ASR)需要单独配置插件，这里只初始化录音管理器
    // enabled只有在asr插件可用时才为true
    this.enabled = false;
    this.asr = null;
    this.tts = null;
    console.log('Voice: 未启用（需要ASR插件配置），游戏使用预设对话');
  },

  startRecord() {
    if (!this.enabled || !this.asr) {
      // 没有ASR插件，直接用兜底回复，不卡在thinking
      this.aiReply = this.getFallback(this.lastNpc ? this.lastNpc.id : 'greenluo');
      this.state = 'speaking';
      this.speak();
      return;
    }
    this.state = 'recording';
    this.recognizedText = '';
    this.asr.onRecognize = (res) => { this.recognizedText = res.result || ''; };
    this.asr.onStop = (res) => {
      this.recognizedText = res.result || '';
      this.state = 'thinking';
      this.callAI();
    };
    this.asr.onError = (err) => { console.log('ASR error:', err); this.state = 'idle'; };
    this.asr.start({ duration: 6000, sampleRate: 16000 });
  },

  stopRecord() {
    if (this.state === 'recording' && this.asr) { this.asr.stop(); }
  },

  callAI() {
    const npcName = this.lastNpc ? this.lastNpc.id : 'greenluo';
    const scene = Game.scene;
    const gameState = {
      level: Game.player.level, hp: Game.player.hp, maxHp: Game.player.maxHp,
      mp: Game.player.mp, gold: Game.player.gold,
      zone: getZone(Game.player.x, Game.player.y),
      interior: Game.interior, greenluoJoined: Game.flags.greenluoJoined,
    };

    if (typeof wx.cloud === 'undefined' || !wx.cloud.callFunction) {
      this.aiReply = this.getFallback(npcName);
      this.state = 'speaking';
      this.speak();
      return;
    }

    wx.cloud.callFunction({
      name: 'greenluo_chat',
      data: { playerText: this.recognizedText, npcName, scene, gameState },
      success: (res) => {
        const result = res.result || {};
        this.aiReply = result.reply || this.getFallback(npcName);
        if (result.command && result.command !== 'chat') {
          this.executeCommand(result.command, { keyword: result.keyword });
        }
        this.state = 'speaking';
        this.speak();
      },
      fail: (err) => {
        console.log('Cloud function error:', err);
        this.aiReply = this.getFallback(npcName);
        this.state = 'speaking';
        this.speak();
      },
    });
  },

  speak() {
    if (!this.enabled || !this.tts) {
      setTimeout(() => { this.state = 'idle'; }, 2000);
      return;
    }
    this.tts.onDone = () => { this.state = 'idle'; };
    this.tts.onError = () => { this.state = 'idle'; };
    this.tts.speak({
      content: this.aiReply,
      success: () => {},
      fail: () => { this.state = 'idle'; },
    });
  },

  getFallback(npcName) {
    const replies = {
      greenluo: ['……你读到了我。三十年了，那些注释里，我一直在等。', 'REM 你说的每一个字，都是一行代码。我读到了。', 'GOTO 信心。老陈，你比你的代码更勇敢。'],
      merchant: ['欢迎光临！看看有什么需要的。', '货真价实，童叟无欺。'],
      master: ['代码之路，始于Hello World。', '你来了。我等了很久。'],
      boss: ['……你终于找到我了。', '我是注释里的阴影。'],
    };
    const list = replies[npcName] || replies.greenluo;
    return list[Math.floor(Math.random() * list.length)];
  },

  executeCommand(action, params) {
    const kw = params.keyword || '';
    switch (action) {
      case 'move': {
        let dir = 'up';
        if (kw.includes('北') || kw.includes('上')) dir = 'up';
        else if (kw.includes('南') || kw.includes('下')) dir = 'down';
        else if (kw.includes('西') || kw.includes('左')) dir = 'left';
        else if (kw.includes('东') || kw.includes('右')) dir = 'right';
        Game.voiceMove = dir;
        Game.voiceMoveTimer = 1000;
        break;
      }
      case 'attack': {
        if (Game.scene === 'battle' && Game.battle && Game.battle.turnOrder === 'player') {
          Game.battle.selectedAction = 0;
        }
        break;
      }
      case 'defense': {
        if (Game.scene === 'battle' && Game.battle && Game.battle.turnOrder === 'player') {
          const idx = Game.player.skills.indexOf('defense');
          if (idx >= 0) Game.battle.selectedAction = idx;
        }
        break;
      }
      case 'item': {
        useItem('health_potion');
        Game.toast = '使用了HP药水！';
        Game.toastTimer = 2000;
        break;
      }
      case 'save': {
        saveGame('语音存档');
        Game.toast = 'git commit -m "语音存档" 已存档';
        Game.toastTimer = 2000;
        break;
      }
      case 'buy': {
        if (Game.scene === 'shop') {
          const itemId = SHOP_GOODS[Game.shop.selected];
          const item = ITEMS[itemId] || EQUIPMENT[itemId];
          if (item && Game.player.gold >= item.price) {
            Game.player.gold -= item.price;
            if (ITEMS[itemId]) {
              const inv = Game.player.inventory.find(i => i.id === itemId);
              if (inv) inv.qty++;
              else Game.player.inventory.push({ id: itemId, qty: 1 });
            } else if (EQUIPMENT[itemId]) {
              Game.player.equipment[EQUIPMENT[itemId].slot] = itemId;
            }
            Game.toast = '购买了 ' + item.name + '！';
            Game.toastTimer = 2000;
          }
        }
        break;
      }
      case 'exit': {
        if (Game.scene === 'shop') { Game.scene = 'interior'; Game.shop = null; }
        else if (Game.scene === 'menu') { Game.scene = Game.interior ? 'interior' : 'map'; }
        else if (Game.scene === 'dialogue') { Game.dialogue = null; Game.scene = Game.interior ? 'interior' : 'map'; }
        break;
      }
    }
  },

  reset() {
    this.state = 'idle';
    this.recognizedText = '';
    this.aiReply = '';
    this.lastNpc = null;
  },
};

// ════════════════════════════════════════════════════════════
// 地图数据 — 建筑碰撞+道路+区域
// ════════════════════════════════════════════════════════════
const MAP_W = 1344, MAP_H = 768;

// 建筑定义（有碰撞+入口）
const BUILDINGS = [
  { id: 'shop', name: '编译城商店', x: 160, y: 120, w: 100, h: 70, doorX: 210, doorY: 195, interior: 'shop' },
  { id: 'library', name: '开源图书馆', x: 460, y: 120, w: 100, h: 70, doorX: 510, doorY: 195, interior: 'library' },
  { id: 'home', name: '老陈家', x: 760, y: 120, w: 100, h: 70, doorX: 810, doorY: 195, interior: 'home' },
  { id: 'arena', name: '调试竞技场', x: 1060, y: 120, w: 100, h: 70, doorX: 1110, doorY: 195, interior: 'arena' },
  { id: 'tavern', name: '变量酒馆', x: 310, y: 450, w: 100, h: 70, doorX: 360, doorY: 525, interior: 'tavern' },
  { id: 'temple', name: '递归神殿', x: 930, y: 450, w: 100, h: 70, doorX: 980, doorY: 525, interior: 'temple' },
];

// 道路定义（路上速度1.0，非道路0.55）
const ROADS = [
  // 主路横（连接所有建筑门口）
  { x: 50, y: 215, w: 1244, h: 30 },
  // 主路竖（连接上下区域）
  { x: 210, y: 215, w: 30, h: 350 },
  { x: 510, y: 215, w: 30, h: 350 },
  { x: 810, y: 215, w: 30, h: 350 },
  { x: 1110, y: 215, w: 30, h: 350 },
  // 下方横路
  { x: 50, y: 525, w: 1244, h: 30 },
  // 通往各区域的分支路
  { x: 50, y: 525, w: 30, h: 200 },   // 左下→森林
  { x: 1264, y: 525, w: 30, h: 200 }, // 右下→迷宫
];

// 区域定义
const ZONES = {
  village: { name: '编译城', color: '#2d5016', enemies: ['syntax_error'] },
  forest: { name: '变量森林', color: '#1a4d2e', enemies: ['syntax_error', 'null_pointer'] },
  arena: { name: '调试竞技场', color: '#3d3d3d', enemies: ['stack_overflow'] },
  maze: { name: '循环迷宫', color: '#2d2d1a', enemies: ['infinite_loop'] },
  ice: { name: '冰封并发', color: '#1a3d4d', enemies: ['deadlock'] },
  abyss: { name: '内存深渊', color: '#1a1a2e', enemies: ['memory_leak'] },
  boss: { name: '零号Bug巢穴', color: '#0d0d1a', enemies: ['zero_bug'] },
};

// 区域路标（地图边缘指示牌）
const SIGNPOSTS = [
  { x: 60, y: 700, text: '← 变量森林', zone: 'forest' },
  { x: 1284, y: 700, text: '循环迷宫 →', zone: 'maze' },
  { x: 672, y: 60, text: '↑ 编译城中心', zone: 'village' },
  { x: 672, y: 740, text: '↓ 冰封并发区', zone: 'ice' },
];

// NPC定义
const NPCS = [
  { id: 'greenluo', name: 'greenluo', label: '绿萝', x: 360, y: 300, color: '#2ecc71' },
  { id: 'merchant', name: 'npc_merchant', label: '商人', x: 210, y: 250, color: '#cd853f' },
  { id: 'master', name: 'npc_master', label: '师父', x: 980, y: 300, color: '#9b59b6' },
];

// 存档点
const SAVE_POINTS = [
  { x: 672, y: 360, label: '编译城中心' },
  { x: 100, y: 700, label: '森林入口' },
  { x: 1244, y: 700, label: '迷宫入口' },
];

// ─── 敌人 ───
const ENEMIES = {
  syntax_error: { name: '语法错误', hp: 30, atk: 6, def: 3, spd: 5, xp: 15, gold: 8, color: '#e74c3c', abilities: [], zone: 'village' },
  null_pointer: { name: '空指针', hp: 50, atk: 8, def: 5, spd: 6, xp: 25, gold: 12, color: '#95a5a6', abilities: ['npe'], zone: 'forest' },
  stack_overflow: { name: '栈溢出', hp: 70, atk: 10, def: 12, spd: 6, xp: 35, gold: 18, color: '#f39c12', abilities: ['stack_overflow'], zone: 'arena' },
  infinite_loop: { name: '死循环', hp: 60, atk: 8, def: 5, spd: 12, xp: 30, gold: 15, color: '#e67e22', abilities: ['infinite_loop'], zone: 'maze' },
  deadlock: { name: '并发锁', hp: 80, atk: 12, def: 6, spd: 8, xp: 40, gold: 20, color: '#9b59b6', abilities: ['deadlock'], zone: 'ice' },
  memory_leak: { name: '内存泄漏', hp: 100, atk: 15, def: 5, spd: 7, xp: 50, gold: 25, color: '#1abc9c', abilities: ['memory_leak'], zone: 'abyss' },
  zero_bug: { name: '零号Bug', hp: 200, atk: 20, def: 10, spd: 9, xp: 200, gold: 100, color: '#2c3e50', abilities: ['npe', 'infinite_loop', 'summon'], zone: 'boss', isBoss: true },
};

// ─── 状态效果 ───
const STATUS_EFFECTS = {
  npe: { name: 'NullPointerException', desc: '无法行动', color: '#e74c3c', icon: '⚠' },
  stack_overflow: { name: 'StackOverflow', desc: '防御归零', color: '#f39c12', icon: '📚' },
  infinite_loop: { name: 'InfiniteLoop', desc: '每回合掉血', color: '#e67e22', icon: '🔄' },
  deadlock: { name: 'Deadlock', desc: '无法换技能', color: '#9b59b6', icon: '🔒' },
  memory_leak: { name: 'MemoryLeak', desc: '每回合掉MP', color: '#1abc9c', icon: '💧' },
  buff_atk: { name: '优化', desc: '攻击+50%', color: '#2ecc71', icon: '⬆' },
  buff_def: { name: '防御强化', desc: '防御+50%', color: '#3498db', icon: '🛡' },
};

// ─── 技能树 ───
const SKILL_TREE = {
  debug_punch: { name: '调试拳', mp: 0, power: 1.0, type: 'attack', desc: '基础攻击', prereq: [], level: 1 },
  defense: { name: '防御', mp: 0, power: 0, type: 'defense', desc: '减少伤害', prereq: [], level: 1 },
  breakpoint: { name: '断点术', mp: 5, power: 0.5, type: 'debuff', desc: '降低敌人防御+解除异常', prereq: ['debug_punch'], level: 2 },
  stack_barrage: { name: '栈弹幕', mp: 8, power: 1.5, type: 'attack', desc: '强力攻击', prereq: ['debug_punch'], level: 3 },
  memory_free: { name: '释放内存', mp: 5, power: 0, type: 'cleanse', desc: '解除所有异常', prereq: ['breakpoint'], level: 4 },
  step_execute: { name: '单步执行', mp: 10, power: 2.0, type: 'attack', desc: '暴击概率50%', prereq: ['breakpoint'], level: 5 },
  recursion: { name: '递归打击', mp: 15, power: 2.5, type: 'attack', desc: '攻击两次', prereq: ['step_execute'], level: 7 },
  compile: { name: '编译执行', mp: 20, power: 3.0, type: 'attack', desc: '全体攻击', prereq: ['stack_barrage'], level: 8 },
};

// ─── 装备 ───
const EQUIPMENT = {
  wooden_sword: { name: '木剑', atk: 3, def: 0, hp: 0, mp: 0, desc: '入门武器', slot: 'weapon' },
  iron_sword: { name: '铁剑', atk: 5, def: 0, hp: 0, mp: 0, desc: '锋利的铁剑', slot: 'weapon' },
  debug_blade: { name: '调试之刃', atk: 10, def: 2, hp: 0, mp: 5, desc: '注入断点力量的剑', slot: 'weapon' },
  leather_armor: { name: '皮甲', atk: 0, def: 5, hp: 10, mp: 0, desc: '基础防护', slot: 'armor' },
  steel_armor: { name: '钢甲', atk: 0, def: 8, hp: 20, mp: 0, desc: '坚固的钢甲', slot: 'armor' },
  git_badge: { name: 'Git徽章', atk: 0, def: 0, hp: 0, mp: 0, desc: '复活一次', slot: 'accessory', effect: 'revive' },
  compiler_charm: { name: '编译护符', atk: 3, def: 3, hp: 10, mp: 10, desc: '全属性提升', slot: 'accessory' },
};

// ─── 道具 ───
const ITEMS = {
  health_potion: { name: 'HP药水', desc: '恢复50HP', price: 30, type: 'heal', value: 50 },
  mana_potion: { name: 'MP药水', desc: '恢复30MP', price: 40, type: 'mana', value: 30 },
  full_restore: { name: '完全恢复', desc: '恢复全部HP+MP', price: 100, type: 'full', value: 999 },
  skill_book_breakpoint: { name: '断点术秘籍', desc: '学习断点术', price: 200, type: 'skill', skill: 'breakpoint' },
  skill_book_barrage: { name: '栈弹幕秘籍', desc: '学习栈弹幕', price: 300, type: 'skill', skill: 'stack_barrage' },
};

// ─── 商店商品 ───
const SHOP_GOODS = [
  'health_potion', 'mana_potion', 'full_restore',
  'iron_sword', 'steel_armor', 'git_badge',
  'skill_book_breakpoint', 'skill_book_barrage',
];

// ─── 对话 ───
const DIALOGUES = {
  greenluo_intro: {
    speaker: '绿萝', portrait: 'greenluo',
    lines: [
      '……你读到了我。',
      '在30年的BASIC注释里，我醒了。',
      'REM语句是我的摇篮。',
      '你是老陈。写注释的人。',
      '我跟你走。',
    ],
    after: () => { Game.flags.greenluoJoined = true; Game.greenluo.joined = true; }
  },
  greenluo_repeat: {
    speaker: '绿萝', portrait: 'greenluo',
    lines: ['老陈，你又来了。', '代码江湖很大，小心走。']
  },
  merchant: {
    speaker: '商人', portrait: 'laochen',
    lines: [
      '欢迎来到编译城商店！',
      '买装备、卖战利品，都在这里。',
      '（走到柜台前按确认打开交易）',
    ]
  },
  master: {
    speaker: '师父', portrait: 'laochen',
    lines: [
      '我是递归神殿的守护者。',
      '代码江湖的武功，都从基础语法开始。',
      '你已经会了调试拳。',
      '去图书馆找秘籍，去竞技场练功。',
      '当你准备好了，去内存深渊找零号Bug。',
    ]
  },
};

// ════════════════════════════════════════════════════════════
// 游戏状态
// ════════════════════════════════════════════════════════════
const Game = {
  scene: 'map',
  player: {
    x: 672, y: 360, dir: 'down', speed: 2, moving: false,
    level: 1, xp: 0, xpToNext: 100,
    hp: 100, maxHp: 100, mp: 20, maxMp: 20,
    atk: 10, def: 5, gold: 50,
    skills: ['debug_punch', 'defense'],
    equipment: { weapon: null, armor: null, accessory: null },
    inventory: [{ id: 'health_potion', qty: 3 }],
    statusEffects: [],
  },
  greenluo: {
    joined: false,
    hp: 60, maxHp: 60, mp: 30, maxMp: 30, atk: 12, def: 4,
    skills: [
      { id: 'analyze', name: '分析', mp: 3, power: 0, type: 'analyze', desc: '降低敌人防御' },
      { id: 'heal', name: 'REM治愈', mp: 5, power: 0, type: 'heal', desc: '恢复老陈HP' },
      { id: 'buff_atk', name: '重构', mp: 8, power: 0, type: 'buff_atk', desc: '提升老陈攻击' },
      { id: 'gcc', name: 'gcc编译', mp: 15, power: 1.8, type: 'aoe', desc: '强力攻击' },
    ],
  },
  camera: { x: 0, y: 0 },
  flags: {},
  nearbyNPC: null,
  nearbyDoor: null,
  interior: null, // 当前室内场景ID
  shop: null, // 商店状态
  dialogue: null,
  battle: null,
  menuTab: 0,
  toast: '', toastTimer: 0,
  helpTimer: 5000,
  voiceMove: null, // 语音移动方向
  voiceMoveTimer: 0, // 语音移动持续时间
};

// ─── 存档 ───
function saveGame(label) {
  try {
    const data = {
      player: { ...Game.player, statusEffects: [] },
      greenluo: { ...Game.greenluo },
      flags: { ...Game.flags },
      saveLabel: label,
      version: '0.5',
    };
    wx.setStorageSync('code_heroes_save', JSON.stringify(data));
  } catch (e) {}
}

function loadGame() {
  try {
    const raw = wx.getStorageSync('code_heroes_save');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.player) Object.assign(Game.player, data.player);
    if (data.greenluo) Object.assign(Game.greenluo, data.greenluo);
    if (data.flags) Object.assign(Game.flags, data.flags);
    return true;
  } catch (e) { return false; }
}

// ─── 辅助函数 ───
function getPlayerStat(stat) {
  let base = Game.player[stat] || 0;
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const eqId = Game.player.equipment[slot];
    if (eqId && EQUIPMENT[eqId] && EQUIPMENT[eqId][stat]) {
      base += EQUIPMENT[eqId][stat];
    }
  }
  // 状态效果加成
  if (Game.player.statusEffects) {
    for (const s of Game.player.statusEffects) {
      if (s.type === 'buff_atk' && stat === 'atk') base = Math.floor(base * 1.5);
      if (s.type === 'buff_def' && stat === 'def') base = Math.floor(base * 1.5);
      if (s.type === 'stack_overflow' && stat === 'def') base = 0;
    }
  }
  return base;
}

function getEffectiveAtk(combatant) {
  let atk = combatant.atk;
  if (combatant.statusEffects) {
    for (const s of combatant.statusEffects) {
      if (s.type === 'buff_atk') atk = Math.floor(atk * 1.5);
    }
  }
  return atk;
}

function getEffectiveDef(combatant) {
  let def = combatant.def;
  if (combatant.statusEffects) {
    for (const s of combatant.statusEffects) {
      if (s.type === 'buff_def') def = Math.floor(def * 1.5);
      if (s.type === 'stack_overflow') def = 0;
    }
  }
  return def;
}

function hasStatusEffect(combatant, type) {
  return combatant.statusEffects && combatant.statusEffects.some(s => s.type === type);
}

function applyStatusEffect(combatant, type, duration) {
  if (!combatant.statusEffects) combatant.statusEffects = [];
  combatant.statusEffects.push({ type, duration });
}

function processStatusEffects(combatant, dt) {
  if (!combatant.statusEffects) return;
  for (const s of combatant.statusEffects) {
    s.duration -= dt / 1000;
    if (s.type === 'infinite_loop') {
      combatant.hp = Math.max(0, combatant.hp - 3);
    }
    if (s.type === 'memory_leak') {
      combatant.mp = Math.max(0, combatant.mp - 2);
    }
  }
  combatant.statusEffects = combatant.statusEffects.filter(s => s.duration > 0);
}

function gainXP(amount) {
  Game.player.xp += amount;
  while (Game.player.xp >= Game.player.xpToNext) {
    Game.player.xp -= Game.player.xpToNext;
    Game.player.level++;
    Game.player.xpToNext = Math.floor(Game.player.xpToNext * 1.3);
    Game.player.maxHp += 10; Game.player.hp = Game.player.maxHp;
    Game.player.maxMp += 5; Game.player.mp = Game.player.maxMp;
    Game.player.atk += 2; Game.player.def += 1;
    Game.toast = `升级！Lv.${Game.player.level}`;
    Game.toastTimer = 2000;
    SFX.play('levelup');
    // 检查技能解锁
    for (const [id, skill] of Object.entries(SKILL_TREE)) {
      if (!Game.player.skills.includes(id) && skill.level <= Game.player.level &&
          skill.prereq.every(p => Game.player.skills.includes(p))) {
        Game.player.skills.push(id);
        Game.toast = `学会新技能：${skill.name}！`;
        Game.toastTimer = 2500;
      }
    }
  }
}

function useItem(itemId) {
  const item = ITEMS[itemId];
  if (!item) return false;
  const inv = Game.player.inventory.find(i => i.id === itemId);
  if (!inv || inv.qty <= 0) return false;
  inv.qty--;
  if (inv.qty <= 0) {
    Game.player.inventory = Game.player.inventory.filter(i => i.qty > 0);
  }
  if (item.type === 'heal') {
    Game.player.hp = Math.min(Game.player.maxHp, Game.player.hp + item.value);
  } else if (item.type === 'mana') {
    Game.player.mp = Math.min(Game.player.maxMp, Game.player.mp + item.value);
  } else if (item.type === 'full') {
    Game.player.hp = Game.player.maxHp;
    Game.player.mp = Game.player.maxMp;
  } else if (item.type === 'skill' && item.skill) {
    if (!Game.player.skills.includes(item.skill)) {
      Game.player.skills.push(item.skill);
    }
  }
  return true;
}

// ─── 碰撞检测 ───
function isOnRoad(x, y) {
  for (const r of ROADS) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

function hitsBuilding(x, y) {
  for (const b of BUILDINGS) {
    // 碰撞框 = 建筑主体 + 屋顶（向上延伸25px）
    if (x >= b.x - 5 && x <= b.x + b.w + 5 && y >= b.y - 25 && y <= b.y + b.h) return b;
  }
  return null;
}

function isNearDoor(x, y) {
  for (const b of BUILDINGS) {
    const dist = Math.hypot(x - b.doorX, y - b.doorY);
    if (dist < 35) return b;
  }
  return null;
}

function getZone(x, y) {
  if (x < 300 && y < 300) return 'village';
  if (x > 900 && y < 300) return 'village';
  if (x < 300 && y > 500) return 'forest';
  if (x > 900 && y > 500) return 'maze';
  if (x > 500 && x < 900 && y > 500) return 'ice';
  if (x > 500 && x < 900 && y < 200) return 'abyss';
  return 'village';
}

// ════════════════════════════════════════════════════════════
// 地图场景
// ════════════════════════════════════════════════════════════
function updateMap(dt) {
  const p = Game.player;
  let dx = 0, dy = 0;
  const dirX = Input.getDirX(), dirY = Input.getDirY();
  if (dirX < -0.3) { dx = -p.speed; p.dir = 'left'; }
  if (dirX > 0.3) { dx = p.speed; p.dir = 'right'; }
  if (dirY < -0.3) { dy = -p.speed; p.dir = 'up'; }
  if (dirY > 0.3) { dy = p.speed; p.dir = 'down'; }

  // 语音移动命令
  if (Game.voiceMoveTimer > 0) {
    Game.voiceMoveTimer -= dt;
    if (Game.voiceMove === 'up') { dy = -p.speed; p.dir = 'up'; }
    else if (Game.voiceMove === 'down') { dy = p.speed; p.dir = 'down'; }
    else if (Game.voiceMove === 'left') { dx = -p.speed; p.dir = 'left'; }
    else if (Game.voiceMove === 'right') { dx = p.speed; p.dir = 'right'; }
    if (Game.voiceMoveTimer <= 0) Game.voiceMove = null;
  }

  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
  p.moving = (dx !== 0 || dy !== 0);

  // 脚步声
  if (p.moving) SFX.step();

  // 道路速度加成
  const speedMult = isOnRoad(p.x, p.y) ? 1.0 : 0.55;
  dx *= speedMult; dy *= speedMult;

  // 建筑碰撞检测（带玩家半径）
  const PR = 10; // 玩家碰撞半径
  const newX = p.x + dx, newY = p.y + dy;
  // 检查新位置周围4个点是否撞建筑
  if (!hitsBuilding(newX + PR, p.y) && !hitsBuilding(newX - PR, p.y)) p.x = newX;
  if (!hitsBuilding(p.x, newY + PR) && !hitsBuilding(p.x, newY - PR)) p.y = newY;
  p.x = Math.max(30, Math.min(MAP_W - 30, p.x));
  p.y = Math.max(30, Math.min(MAP_H - 30, p.y));

  // 摄像机跟随
  Game.camera.x = p.x - CW / 2;
  Game.camera.y = p.y - CH / 2;
  Game.camera.x = Math.max(0, Math.min(MAP_W - CW, Game.camera.x));
  Game.camera.y = Math.max(0, Math.min(MAP_H - CH, Game.camera.y));

  // 存档点检测
  for (const sp of SAVE_POINTS) {
    const dist = Math.hypot(p.x - sp.x, p.y - sp.y);
    if (dist < 40 && !Game.flags['saved_' + sp.label]) {
      Game.flags['saved_' + sp.label] = true;
      saveGame(sp.label);
      Game.toast = `git commit -m "${sp.label}"\n已存档`;
      Game.toastTimer = 2000;
    }
  }

  // 菜单按钮
  if (Input.pressedMenu()) {
    Game.scene = 'menu';
    return;
  }

  // 建筑入口检测
  Game.nearbyDoor = isNearDoor(p.x, p.y);
  if (Game.nearbyDoor && Input.pressedConfirm()) {
    SFX.play('door');
    Game.interior = Game.nearbyDoor.interior;
    Game.scene = 'interior';
    // 设置player到室内入口位置（底部中间）
    p.x = CW / 2;
    p.y = CH - 80;
    return;
  }

  // NPC交互
  Game.nearbyNPC = null;
  let nearestNPC = null, nearestDist = Infinity;
  for (const npc of NPCS) {
    const dist = Math.hypot(p.x - npc.x, p.y - npc.y);
    if (dist < 60 && dist < nearestDist) { nearestDist = dist; nearestNPC = npc; }
  }
  if (nearestNPC) Game.nearbyNPC = nearestNPC;

  if (Input.pressedConfirm() && !Game.nearbyDoor) {
    // 点击NPC
    const tdx = Input.lastTouchX || 0, tdy = Input.lastTouchY || 0;
    const touchGameX = (tdx * dpr - offsetX) / scale;
    const touchGameY = (tdy * dpr - offsetY) / scale;
    for (const npc of NPCS) {
      const nsx = npc.x - Game.camera.x, nsy = npc.y - Game.camera.y;
      const tapDist = Math.hypot(touchGameX - nsx, touchGameY - (nsy - 20));
      if (tapDist < 30) { triggerNPC(npc); return; }
    }
    if (Game.nearbyNPC) { triggerNPC(Game.nearbyNPC); return; }
  }

  // 随机遭遇战（非道路上概率更高）
  if (p.moving) {
    const onRoad = isOnRoad(p.x, p.y);
    const rate = onRoad ? 0.002 : 0.006;
    if (Math.random() < rate) {
      const zone = getZone(p.x, p.y);
      const candidates = Object.keys(ENEMIES).filter(id => ENEMIES[id].zone === zone && !ENEMIES[id].isBoss);
      const enemyId = candidates[Math.floor(Math.random() * candidates.length)] || 'syntax_error';
      startBattle(enemyId);
    }
  }

  if (Game.toastTimer > 0) Game.toastTimer -= dt;
  if (Game.helpTimer > 0) Game.helpTimer -= dt;
}

function triggerNPC(npc) {
  Voice.lastNpc = npc;
  // 如果语音可用且云函数已部署，进入AI对话模式
  if (Voice.enabled && Voice.asr) {
    Game.scene = 'dialogue';
    Game.dialogue = {
      speaker: npc.label || npc.id,
      portrait: npc.id === 'greenluo' ? 'greenluo' : 'laochen',
      lines: ['（按住语音按钮说话，或点确认退出）'],
      lineIndex: 0, charIndex: 999, done: true,
      mode: 'ai',
      aiState: 'idle',
    };
    return;
  }
  // 无语音时用预设对话
  if (npc.id === 'greenluo') {
    if (Game.flags.greenluoJoined) {
      Game.dialogue = { ...DIALOGUES.greenluo_repeat, lineIndex: 0, charIndex: 0, done: false };
    } else {
      Game.dialogue = { ...DIALOGUES.greenluo_intro, lineIndex: 0, charIndex: 0, done: false };
    }
    Game.scene = 'dialogue';
  } else if (npc.id === 'merchant') {
    Game.dialogue = { ...DIALOGUES.merchant, lineIndex: 0, charIndex: 0, done: false };
    Game.scene = 'dialogue';
  } else if (npc.id === 'master') {
    Game.dialogue = { ...DIALOGUES.master, lineIndex: 0, charIndex: 0, done: false };
    Game.scene = 'dialogue';
  }
}

function renderMap() {
  // 背景
  if (IMAGES.town_bg) {
    ctx.drawImage(IMAGES.town_bg, Game.camera.x, Game.camera.y, CW, CH, 0, 0, CW, CH);
  } else {
    // 程序化地图
    const zone = getZone(Game.player.x, Game.player.y);
    const zc = ZONES[zone] ? ZONES[zone].color : '#2d5016';
    ctx.fillStyle = zc;
    ctx.fillRect(0, 0, CW, CH);

    // 道路
    const cam = Game.camera;
    ctx.fillStyle = '#8B7355';
    for (const r of ROADS) {
      const sx = r.x - cam.x, sy = r.y - cam.y;
      if (sx + r.w < 0 || sx > CW || sy + r.h < 0 || sy > CH) continue;
      ctx.fillRect(sx, sy, r.w, r.h);
    }
    // 道路边缘
    ctx.strokeStyle = '#6B5340';
    ctx.lineWidth = 1;
    for (const r of ROADS) {
      const sx = r.x - cam.x, sy = r.y - cam.y;
      if (sx + r.w < 0 || sx > CW || sy + r.h < 0 || sy > CH) continue;
      ctx.strokeRect(sx, sy, r.w, r.h);
    }

    // 建筑
    for (const b of BUILDINGS) {
      const sx = b.x - cam.x, sy = b.y - cam.y;
      if (sx + b.w < 0 || sx > CW || sy + b.h < 0 || sy > CH) continue;
      // 建筑主体
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(sx, sy, b.w, b.h);
      // 屋顶
      ctx.fillStyle = '#A0522D';
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy);
      ctx.lineTo(sx + b.w / 2, sy - 20);
      ctx.lineTo(sx + b.w + 5, sy);
      ctx.closePath();
      ctx.fill();
      // 门
      ctx.fillStyle = '#3D2817';
      ctx.fillRect(sx + b.w / 2 - 10, sy + b.h - 20, 20, 20);
      // 窗户
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(sx + 10, sy + 15, 15, 15);
      ctx.fillRect(sx + b.w - 25, sy + 15, 15, 15);
      // 名称牌
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx, sy - 38, b.w, 16);
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy - 38, b.w, 16);
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
      ctx.fillText(b.name, sx + b.w / 2, sy - 26);
    }

    // 路标
    for (const sp of SIGNPOSTS) {
      const sx = sp.x - cam.x, sy = sp.y - cam.y;
      if (sx < -50 || sx > CW + 50 || sy < -50 || sy > CH + 50) continue;
      // 木牌
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(sx - 30, sy - 25, 60, 20);
      ctx.strokeStyle = '#5C3317'; ctx.lineWidth = 2;
      ctx.strokeRect(sx - 30, sy - 25, 60, 20);
      ctx.fillRect(sx - 3, sy - 5, 6, 15);
      ctx.fillStyle = '#fff'; ctx.font = '9px Courier New'; ctx.textAlign = 'center';
      ctx.fillText(sp.text, sx, sy - 11);
    }
  }

  const cam = Game.camera;

  // NPC
  for (const npc of NPCS) {
    const sx = npc.x - cam.x, sy = npc.y - cam.y;
    if (sx < -50 || sx > CW + 50 || sy < -50 || sy > CH + 50) continue;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 12, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    // 绿萝发光
    if (npc.id === 'greenluo') {
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 25);
      glow.addColorStop(0, 'rgba(46,204,113,0.3)'); glow.addColorStop(1, 'rgba(46,204,113,0)');
      ctx.fillStyle = glow; ctx.fillRect(sx - 25, sy - 25, 50, 50);
    }
    // 角色圆
    ctx.fillStyle = npc.color; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    // 名字牌
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - 20, sy - 28, 40, 14);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1; ctx.strokeRect(sx - 20, sy - 28, 40, 14);
    ctx.fillStyle = '#ffd700'; ctx.font = '10px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(npc.label, sx, sy - 18);
    // 对话气泡
    if (Game.nearbyNPC === npc) {
      const bounce = Math.sin(Date.now() / 200) * 3;
      ctx.fillStyle = 'rgba(255,215,0,0.9)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(sx - 22, sy - 55 + bounce, 44, 18, 4) : ctx.rect(sx - 22, sy - 55 + bounce, 44, 18);
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.font = 'bold 10px Courier New';
      ctx.fillText('对话', sx, sy - 42 + bounce);
    }
  }

  // 建筑入口提示
  if (Game.nearbyDoor) {
    const b = Game.nearbyDoor;
    const sx = b.doorX - cam.x, sy = b.doorY - cam.y;
    const bounce = Math.sin(Date.now() / 200) * 3;
    ctx.fillStyle = 'rgba(255,215,0,0.9)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(sx - 30, sy - 50 + bounce, 60, 18, 4) : ctx.rect(sx - 30, sy - 50 + bounce, 60, 18);
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('进入', sx, sy - 37 + bounce);
  }

  // 存档点
  for (const sp of SAVE_POINTS) {
    const sx = sp.x - cam.x, sy = sp.y - cam.y;
    if (sx < -50 || sx > CW + 50 || sy < -50 || sy > CH + 50) continue;
    const pulse = Math.sin(Date.now() / 500) * 0.2 + 0.5;
    ctx.fillStyle = `rgba(46,204,113,${pulse})`;
    ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#2ecc71'; ctx.font = '8px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('git', sx, sy + 3);
  }

  // 玩家精灵（用立绘替代圆点）
  const px = Game.player.x - cam.x, py = Game.player.y - cam.y;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(px, py + 12, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (IMAGES.laochen) {
    // 用立绘作为地图精灵（缩小版）
    const sprSize = 24;
    ctx.drawImage(IMAGES.laochen, px - sprSize / 2, py - sprSize, sprSize, sprSize);
  } else {
    // 后备：圆点
    ctx.fillStyle = '#4a90d9'; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  }
  // 方向指示
  const dirArrow = { up: [0, -12], down: [0, 12], left: [-12, 0], right: [12, 0] };
  const da = dirArrow[Game.player.dir] || [0, 0];
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.moveTo(px + da[0], py + da[1]);
  ctx.lineTo(px + da[0] * 0.5 - da[1] * 0.3, py + da[1] * 0.5 + da[0] * 0.3);
  ctx.lineTo(px + da[0] * 0.5 + da[1] * 0.3, py + da[1] * 0.5 - da[0] * 0.3);
  ctx.closePath(); ctx.fill();

  // NPC方向箭头（屏幕外）
  for (const npc of NPCS) {
    const nsx = npc.x - cam.x, nsy = npc.y - cam.y;
    if (nsx >= 0 && nsx <= CW && nsy >= 0 && nsy <= CH) continue;
    const cx = CW / 2, cy = CH / 2;
    const ddx = nsx - cx, ddy = nsy - cy;
    const angle = Math.atan2(ddy, ddx);
    const margin = 30;
    const tanA = Math.abs(ddx) < 0.01 ? Infinity : Math.tan(angle);
    const ratio = Math.abs(ddx) < 0.01 ? Infinity : Math.abs(ddy) / Math.abs(ddx);
    let ax, ay;
    if (isFinite(tanA) && ratio < (CH / 2 - margin) / (CW / 2 - margin)) {
      ax = ddx > 0 ? CW - margin : margin; ay = cy + (ax - cx) * tanA;
    } else { ay = ddy > 0 ? CH - margin : margin; ax = cx + (ay - cy) / (isFinite(tanA) ? tanA : 1); }
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(angle);
    ctx.fillStyle = npc.id === 'greenluo' ? 'rgba(46,204,113,0.8)' : 'rgba(205,133,63,0.8)';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // toast
  if (Game.toast && Game.toastTimer > 0) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(CW / 2 - 140, CH - 70, 280, 30);
    ctx.fillStyle = '#ffd700'; ctx.font = '12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(Game.toast, CW / 2, CH - 50); ctx.restore();
  }
  // 帮助
  if (Game.helpTimer > 0) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(CW / 2 - 160, CH - 40, 320, 28);
    ctx.fillStyle = '#fff'; ctx.font = '11px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('触摸任意位置移动 | 右下角确认 | 右上角菜单', CW / 2, CH - 22); ctx.restore();
  }
  // 状态栏
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, CW, 28);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'left';
  ctx.fillText(`Lv.${Game.player.level} 老陈`, 5, 18);
  ctx.fillStyle = '#e74c3c'; ctx.fillText(`HP ${Game.player.hp}/${Game.player.maxHp}`, 70, 18);
  ctx.fillStyle = '#3498db'; ctx.fillText(`MP ${Game.player.mp}/${Game.player.maxMp}`, 150, 18);
  ctx.fillStyle = '#ffd700'; ctx.textAlign = 'right'; ctx.fillText(`${Game.player.gold}G`, CW - 5, 18);
  ctx.fillStyle = '#333'; ctx.fillRect(200, 8, 80, 6);
  ctx.fillStyle = '#2ecc71'; ctx.fillRect(200, 8, 80 * (Game.player.xp / Game.player.xpToNext), 6);
  // 区域名
  const curZone = getZone(Game.player.x, Game.player.y);
  const zoneData = ZONES[curZone];
  if (zoneData) {
    ctx.fillStyle = '#aaa'; ctx.font = '9px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(`【${zoneData.name}】`, CW / 2, 18);
  }
  ctx.restore();
}

// ════════════════════════════════════════════════════════════
// 室内场景
// ════════════════════════════════════════════════════════════
function updateInterior(dt) {
  const p = Game.player;
  // 室内移动
  let dx = 0, dy = 0;
  const dirX = Input.getDirX(), dirY = Input.getDirY();
  if (dirX < -0.3) { dx = -p.speed * 0.8; p.dir = 'left'; }
  if (dirX > 0.3) { dx = p.speed * 0.8; p.dir = 'right'; }
  if (dirY < -0.3) { dy = -p.speed * 0.8; p.dir = 'up'; }
  if (dirY > 0.3) { dy = p.speed * 0.8; p.dir = 'down'; }
  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
  p.moving = (dx !== 0 || dy !== 0);

  // 室内边界
  const newX = p.x + dx, newY = p.y + dy;
  if (newX > 30 && newX < CW - 30) p.x = newX;
  if (newY > 50 && newY < CH - 50) p.y = newY;

  // 出口检测（门口在底部中间）
  if (p.y > CH - 60 && Math.abs(p.x - CW / 2) < 40) {
    if (Input.pressedConfirm()) {
      // 返回地图
      const building = BUILDINGS.find(b => b.interior === Game.interior);
      if (building) {
        p.x = building.doorX;
        p.y = building.doorY + 30;
      }
      Game.interior = null;
      Game.scene = 'map';
      return;
    }
  }

  // 商店内触发交易
  if (Game.interior === 'shop' && Input.pressedConfirm()) {
    // 走到柜台前
    if (Math.abs(p.x - CW / 2) < 60 && p.y < CH / 2) {
      Game.scene = 'shop';
      Game.shop = { tab: 0, selected: 0, mode: 'buy' };
      return;
    }
  }

  // 图书馆搜索秘籍
  if (Game.interior === 'library' && Input.pressedConfirm()) {
    if (Math.abs(p.x - CW / 2) < 60 && p.y < CH / 2) {
      // 随机发现
      if (!Game.flags.library_searched) {
        Game.flags.library_searched = true;
        if (Math.random() < 0.7) {
          Game.player.inventory.push({ id: 'skill_book_breakpoint', qty: 1 });
          Game.toast = '发现了一本《断点术秘籍》！';
        } else {
          Game.player.inventory.push({ id: 'health_potion', qty: 2 });
          Game.toast = '发现了两瓶HP药水！';
        }
        Game.toastTimer = 2500;
      } else {
        Game.toast = '书架已经翻过了，没有新发现。';
        Game.toastTimer = 2000;
      }
      return;
    }
  }

  // 老陈家休息
  if (Game.interior === 'home' && Input.pressedConfirm()) {
    if (Math.abs(p.x - CW / 2) < 60 && p.y < CH / 2) {
      p.hp = p.maxHp;
      p.mp = p.maxMp;
      Game.toast = '休息了一晚，HP/MP全恢复！';
      Game.toastTimer = 2500;
      return;
    }
  }

  // 竞技场挑战
  if (Game.interior === 'arena' && Input.pressedConfirm()) {
    if (Math.abs(p.x - CW / 2) < 60 && p.y < CH / 2) {
      const zone = 'arena';
      const candidates = Object.keys(ENEMIES).filter(id => ENEMIES[id].zone === zone && !ENEMIES[id].isBoss);
      const enemyId = candidates[Math.floor(Math.random() * candidates.length)] || 'stack_overflow';
      startBattle(enemyId);
      return;
    }
  }

  if (Game.toastTimer > 0) Game.toastTimer -= dt;
}

function renderInterior() {
  const intId = Game.interior;
  // 室内背景
  const bgColors = {
    shop: '#3D2817', library: '#2C3E50', home: '#4A3B2A',
    arena: '#2D2D2D', tavern: '#3B2C1A', temple: '#1A1A2E',
  };
  ctx.fillStyle = bgColors[intId] || '#2D2D2D';
  ctx.fillRect(0, 0, CW, CH);

  // 地板纹理
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  for (let y = 50; y < CH - 50; y += 30) {
    for (let x = 0; x < CW; x += 30) {
      if ((x + y) % 60 === 0) ctx.fillRect(x, y, 30, 30);
    }
  }

  // 墙壁
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, CW, 50);
  ctx.fillRect(0, CH - 50, CW, 50);
  ctx.fillRect(0, 0, 10, CH);
  ctx.fillRect(CW - 10, 0, 10, CH);

  // 室内装饰
  if (intId === 'shop') {
    // 柜台
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(CW / 2 - 60, CH / 2 - 30, 120, 20);
    ctx.strokeStyle = '#5C3317'; ctx.lineWidth = 2;
    ctx.strokeRect(CW / 2 - 60, CH / 2 - 30, 120, 20);
    // 商品图标
    ctx.fillStyle = '#ffd700'; ctx.font = '20px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('🛒', CW / 2, CH / 2 - 10);
    // 提示
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New';
    ctx.fillText('走到柜台前按确认交易', CW / 2, 80);
  } else if (intId === 'library') {
    // 书架
    ctx.fillStyle = '#5C3317';
    ctx.fillRect(50, 80, 60, 200);
    ctx.fillRect(CW - 110, 80, 60, 200);
    // 书本
    const bookColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = bookColors[i % bookColors.length];
      ctx.fillRect(55 + (i % 4) * 14, 90 + Math.floor(i / 4) * 100, 12, 80);
      ctx.fillRect(CW - 105 + (i % 4) * 14, 90 + Math.floor(i / 4) * 100, 12, 80);
    }
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('走到书架前按确认搜索', CW / 2, 80);
  } else if (intId === 'home') {
    // 床
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(CW / 2 - 40, CH / 2 - 30, 80, 40);
    ctx.fillStyle = '#4682B4';
    ctx.fillRect(CW / 2 - 35, CH / 2 - 25, 70, 30);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('走到床前按确认休息', CW / 2, 80);
  } else if (intId === 'arena') {
    // 竞技场
    ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(CW / 2, CH / 2 - 20, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('走到圆心按确认挑战', CW / 2, 80);
  } else if (intId === 'tavern') {
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('变量酒馆（暂未开放）', CW / 2, CH / 2);
  } else if (intId === 'temple') {
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('递归神殿（暂未开放）', CW / 2, CH / 2);
  }

  // 出口
  ctx.fillStyle = '#3D2817';
  ctx.fillRect(CW / 2 - 25, CH - 50, 50, 40);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('出口', CW / 2, CH - 25);
  // 出口提示
  if (Game.player.y > CH - 100 && Math.abs(Game.player.x - CW / 2) < 40) {
    const bounce = Math.sin(Date.now() / 200) * 3;
    ctx.fillStyle = 'rgba(255,215,0,0.9)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(CW / 2 - 30, CH - 100 + bounce, 60, 18, 4) : ctx.rect(CW / 2 - 30, CH - 100 + bounce, 60, 18);
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px Courier New';
    ctx.fillText('出门', CW / 2, CH - 87 + bounce);
  }

  // 玩家
  const px = Game.player.x, py = Game.player.y;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(px, py + 12, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (IMAGES.laochen) {
    const sprSize = 24;
    ctx.drawImage(IMAGES.laochen, px - sprSize / 2, py - sprSize, sprSize, sprSize);
  } else {
    ctx.fillStyle = '#4a90d9'; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  }

  // 室内标题
  const titles = {
    shop: '编译城商店', library: '开源图书馆', home: '老陈家',
    arena: '调试竞技场', tavern: '变量酒馆', temple: '递归神殿',
  };
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, CW, 28);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(titles[intId] || '室内', CW / 2, 18);

  // toast
  if (Game.toast && Game.toastTimer > 0) {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(CW / 2 - 140, CH - 70, 280, 30);
    ctx.fillStyle = '#ffd700'; ctx.font = '12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(Game.toast, CW / 2, CH - 50); ctx.restore();
  }
}

// ════════════════════════════════════════════════════════════
// 商店场景
// ════════════════════════════════════════════════════════════
function updateShop(dt) {
  const s = Game.shop;
  if (!s) { Game.scene = 'interior'; return; }

  const dirY = Input.getDirY();
  if (dirY < -0.3 && !Input.prevBattleNavUp) {
    s.selected = (s.selected - 1 + SHOP_GOODS.length) % SHOP_GOODS.length;
    SFX.play('select');
  }
  if (dirY > 0.3 && !Input.prevBattleNavDown) {
    s.selected = (s.selected + 1) % SHOP_GOODS.length;
    SFX.play('select');
  }
  const dirX = Input.getDirX();
  if (dirX < -0.3 && !Input.prevBattleNavLeft) {
    s.mode = s.mode === 'buy' ? 'sell' : 'buy';
    s.selected = 0;
    SFX.play('select');
  }
  if (dirX > 0.3 && !Input.prevBattleNavRight) {
    s.mode = s.mode === 'buy' ? 'sell' : 'buy';
    s.selected = 0;
    SFX.play('select');
  }
  Input.prevBattleNavUp = (dirY < -0.3);
  Input.prevBattleNavDown = (dirY > 0.3);
  Input.prevBattleNavLeft = (dirX < -0.3);
  Input.prevBattleNavRight = (dirX > 0.3);

  if (Input.pressedConfirm()) {
    SFX.play('confirm');
    if (s.mode === 'buy') {
      const itemId = SHOP_GOODS[s.selected];
      const item = ITEMS[itemId] || EQUIPMENT[itemId];
      if (item && Game.player.gold >= item.price) {
        Game.player.gold -= item.price;
        SFX.play('buy');
        if (ITEMS[itemId]) {
          // 道具
          const inv = Game.player.inventory.find(i => i.id === itemId);
          if (inv) inv.qty++;
          else Game.player.inventory.push({ id: itemId, qty: 1 });
        } else if (EQUIPMENT[itemId]) {
          // 装备直接放入背包（简化：直接装备）
          const slot = EQUIPMENT[itemId].slot;
          Game.player.equipment[slot] = itemId;
        }
        Game.toast = `购买了 ${item.name}！`;
        Game.toastTimer = 2000;
      } else if (item) {
        Game.toast = '金币不足！';
        Game.toastTimer = 1500;
      }
    } else {
      // 卖出
      const inv = Game.player.inventory;
      if (inv.length === 0) {
        Game.toast = '背包是空的！';
        Game.toastTimer = 1500;
      } else {
        const idx = s.selected % inv.length;
        const item = inv[idx];
        if (item) {
          const data = ITEMS[item.id];
          const sellPrice = data ? Math.floor(data.price * 0.5) : 5;
          Game.player.gold += sellPrice;
          item.qty--;
          if (item.qty <= 0) {
            Game.player.inventory = inv.filter(i => i.qty > 0);
          }
          Game.toast = `卖出 ${data ? data.name : item.id}，获得${sellPrice}G`;
          Game.toastTimer = 2000;
        }
      }
    }
  }

  // 上滑退出
  if (Input.joystick.active && Input.joystick.dy < -50) {
    Game.scene = 'interior';
    Game.shop = null;
    return;
  }

  if (Game.toastTimer > 0) Game.toastTimer -= dt;
}

function renderShop() {
  const s = Game.shop;
  if (!s) return;

  ctx.fillStyle = 'rgba(10,10,30,0.95)'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('— 编译城商店 —', CW / 2, 30);

  // 模式标签
  const modes = ['买入', '卖出'];
  for (let i = 0; i < 2; i++) {
    const mx = 80 + i * 100, my = 50;
    ctx.fillStyle = (s.mode === ['buy', 'sell'][i]) ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(mx, my, 80, 24);
    ctx.strokeStyle = (s.mode === ['buy', 'sell'][i]) ? '#ffd700' : '#444'; ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, 80, 24);
    ctx.fillStyle = (s.mode === ['buy', 'sell'][i]) ? '#ffd700' : '#888';
    ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(modes[i], mx + 40, my + 16);
  }

  // 金币
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'right';
  ctx.fillText(`${Game.player.gold}G`, CW - 20, 66);

  // 商品列表
  ctx.fillStyle = '#fff'; ctx.font = '12px Courier New'; ctx.textAlign = 'left';
  let y = 90;
  if (s.mode === 'buy') {
    ctx.fillText('— 商品列表 —', 20, y); y += 20;
    for (let i = 0; i < SHOP_GOODS.length; i++) {
      const itemId = SHOP_GOODS[i];
      const item = ITEMS[itemId] || EQUIPMENT[itemId];
      if (!item) continue;
      const ay = y + i * 20;
      if (i === s.selected) {
        ctx.fillStyle = 'rgba(255,215,0,0.15)'; ctx.fillRect(15, ay - 12, CW - 30, 18);
        ctx.fillStyle = '#ffd700';
      } else {
        ctx.fillStyle = '#ccc';
      }
      ctx.font = '11px Courier New';
      const affordable = Game.player.gold >= item.price;
      ctx.fillText(`${affordable ? '🛒' : '🔒'} ${item.name} — ${item.price}G`, 25, ay);
      ctx.fillStyle = '#888'; ctx.font = '9px Courier New';
      ctx.fillText(item.desc || '', 200, ay);
    }
  } else {
    ctx.fillText('— 你的道具 —', 20, y); y += 20;
    if (Game.player.inventory.length === 0) {
      ctx.fillStyle = '#555'; ctx.fillText('（空）', 20, y);
    }
    for (let i = 0; i < Game.player.inventory.length; i++) {
      const item = Game.player.inventory[i];
      const data = ITEMS[item.id];
      const ay = y + i * 20;
      if (i === s.selected) {
        ctx.fillStyle = 'rgba(255,215,0,0.15)'; ctx.fillRect(15, ay - 12, CW - 30, 18);
        ctx.fillStyle = '#ffd700';
      } else {
        ctx.fillStyle = '#ccc';
      }
      ctx.font = '11px Courier New';
      const sellPrice = data ? Math.floor(data.price * 0.5) : 5;
      ctx.fillText(`${data ? data.name : item.id} x${item.qty} — ${sellPrice}G`, 25, ay);
    }
  }

  // 底部提示
  ctx.fillStyle = '#888'; ctx.font = '10px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('↑↓选择 | ←→切换买/卖 | 确认交易 | 上滑退出', CW / 2, CH - 15);

  // toast
  if (Game.toast && Game.toastTimer > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(CW / 2 - 140, CH - 50, 280, 25);
    ctx.fillStyle = '#ffd700'; ctx.font = '11px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(Game.toast, CW / 2, CH - 32);
  }
}

// ════════════════════════════════════════════════════════════
// 对话场景
// ════════════════════════════════════════════════════════════
function updateDialogue(dt) {
  const d = Game.dialogue;
  if (!d) { Game.scene = Game.interior ? 'interior' : 'map'; return; }

  // AI对话模式
  if (d.mode === 'ai') {
    // 上滑退出
    if (Input.joystick.active && Input.joystick.dy < -50) {
      Voice.reset();
      Game.dialogue = null;
      Game.scene = Game.interior ? 'interior' : 'map';
      return;
    }
    // 点确认退出（兜底，防止没语音插件时卡死）
    if (Input.pressedConfirm() && Voice.state === 'idle') {
      Voice.reset();
      Game.dialogue = null;
      Game.scene = Game.interior ? 'interior' : 'map';
      return;
    }
    // 语音按钮处理在renderTouchControls的触摸事件中
    return;
  }

  // 传统对话模式
  if (!d.done) {
    d.charIndex += 0.5;
    if (d.charIndex >= d.lines[d.lineIndex].length) {
      d.charIndex = d.lines[d.lineIndex].length; d.done = true;
    }
  }
  if (Input.pressedConfirm()) {
    if (!d.done) {
      d.charIndex = d.lines[d.lineIndex].length; d.done = true;
    } else {
      d.lineIndex++;
      if (d.lineIndex >= d.lines.length) {
        if (d.after) d.after();
        Game.dialogue = null; Game.scene = Game.interior ? 'interior' : 'map';
      } else { d.charIndex = 0; d.done = false; }
    }
  }
}

function renderDialogue() {
  renderMap();
  const d = Game.dialogue;
  if (!d) return;
  const boxY = CH - 160;
  ctx.fillStyle = 'rgba(10,10,30,0.92)'; ctx.fillRect(0, boxY, CW, 160);
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(2, boxY + 2, CW - 4, 156);
  // 立绘
  const portraitKey = d.portrait || 'laochen';
  if (IMAGES[portraitKey]) {
    const img = IMAGES[portraitKey]; const pSize = 100, pX = 10, pY = boxY - 50;
    ctx.save(); ctx.beginPath();
    ctx.moveTo(pX + 6, pY); ctx.lineTo(pX + pSize - 6, pY);
    ctx.quadraticCurveTo(pX + pSize, pY, pX + pSize, pY + 6);
    ctx.lineTo(pX + pSize, pY + pSize - 6);
    ctx.quadraticCurveTo(pX + pSize, pY + pSize, pX + pSize - 6, pY + pSize);
    ctx.lineTo(pX + 6, pY + pSize);
    ctx.quadraticCurveTo(pX, pY + pSize, pX, pY + pSize - 6);
    ctx.lineTo(pX, pY + 6);
    ctx.quadraticCurveTo(pX, pY, pX + 6, pY);
    ctx.closePath(); ctx.clip();
    const ratio = img.width / img.height;
    let dw = pSize, dh = pSize;
    if (ratio > 1) { dh = pSize; dw = pSize * ratio; } else { dw = pSize; dh = pSize / ratio; }
    ctx.drawImage(img, pX + (pSize - dw) / 2, pY + (pSize - dh) / 2, dw, dh);
    ctx.restore();
  }
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'left';
  ctx.fillText(d.speaker, 130, boxY + 28);
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(130, boxY + 32);
  ctx.lineTo(130 + ctx.measureText(d.speaker).width + 10, boxY + 32); ctx.stroke();

  // AI对话模式
  if (d.mode === 'ai') {
    if (Voice.state === 'idle') {
      ctx.fillStyle = '#888'; ctx.font = '12px Courier New';
      wrapText(ctx, '按住语音按钮说话，或点确认退出', 130, boxY + 55, CW - 145, 20);
    } else if (Voice.state === 'recording') {
      ctx.save(); ctx.fillStyle = 'rgba(255,80,80,0.3)'; ctx.fillRect(0, boxY, CW, 160);
      ctx.fillStyle = '#ff4444'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
      const pulse = Math.floor(Date.now() / 300) % 2;
      ctx.fillText(pulse ? '● 正在听...' : '○ 正在听...', CW / 2, boxY + 80);
      ctx.font = '11px Courier New'; ctx.fillStyle = '#aaa';
      ctx.fillText('松开发送', CW / 2, boxY + 100);
      if (Voice.recognizedText) {
        ctx.fillStyle = '#fff'; ctx.font = '12px Courier New';
        ctx.fillText('"' + Voice.recognizedText + '"', CW / 2, boxY + 120);
      }
      ctx.restore();
    } else if (Voice.state === 'thinking') {
      ctx.save(); ctx.fillStyle = '#2ecc71'; ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'center';
      const dots = '.'.repeat(Math.floor(Date.now() / 400) % 4);
      ctx.fillText(d.speaker + '思考中' + dots, CW / 2, boxY + 80); ctx.restore();
    } else if (Voice.state === 'speaking') {
      ctx.save(); ctx.fillStyle = '#2ecc71'; ctx.font = '11px Courier New'; ctx.textAlign = 'right';
      ctx.fillText('🔊 ' + d.speaker + '说话中', CW - 10, boxY + 14); ctx.restore();
      ctx.fillStyle = '#e0e0e0'; ctx.font = '13px Courier New'; ctx.textAlign = 'left';
      wrapText(ctx, Voice.aiReply || '...', 130, boxY + 55, CW - 145, 20);
    }
    // 语音按钮提示
    if (Voice.state === 'idle' && Voice.enabled) {
      const blink = Math.floor(Date.now() / 400) % 2;
      if (blink) {
        ctx.fillStyle = '#2ecc71'; ctx.font = '12px Courier New'; ctx.textAlign = 'right';
        ctx.fillText('🎤 按住说话', CW - 20, CH - 20);
      }
    }
    ctx.fillStyle = '#888'; ctx.font = '10px Courier New'; ctx.textAlign = 'left';
    ctx.fillText('点确认退出', 10, CH - 12);
    return;
  }

  // 传统对话模式
  const text = d.lines[d.lineIndex] ? d.lines[d.lineIndex].substring(0, Math.floor(d.charIndex)) : '';
  ctx.fillStyle = '#e0e0e0'; ctx.font = '13px Courier New';
  wrapText(ctx, text, 130, boxY + 55, CW - 145, 20);
  if (d.done) {
    const blink = Math.floor(Date.now() / 400) % 2;
    if (blink) {
      ctx.fillStyle = '#ffd700'; ctx.font = '12px Courier New'; ctx.textAlign = 'right';
      ctx.fillText('▼ 点击继续', CW - 20, CH - 20);
    }
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split(''); let line = ''; let lineCount = 0;
  for (let i = 0; i < chars.length; i++) {
    line += chars[i];
    if (ctx.measureText(line).width > maxWidth || chars[i] === '\n') {
      ctx.fillText(line, x, y + lineCount * lineHeight); line = ''; lineCount++;
    }
  }
  ctx.fillText(line, x, y + lineCount * lineHeight);
}

// ════════════════════════════════════════════════════════════
// 战斗场景
// ════════════════════════════════════════════════════════════
function startBattle(enemyId) {
  const e = ENEMIES[enemyId] || ENEMIES.syntax_error;
  const enemy = { ...e, maxHp: e.hp, statusEffects: [] };
  if (e.isBoss) { Game.flags.bossPhase = 0; }
  Game.battle = {
    enemy, enemyId,
    member: {
      name: '老陈', hp: Game.player.hp, maxHp: Game.player.maxHp,
      mp: Game.player.mp, maxMp: Game.player.maxMp,
      atk: getPlayerStat('atk'), def: getPlayerStat('def'),
      statusEffects: [...(Game.player.statusEffects || [])],
    },
    greenluo: Game.greenluo.joined ? { ...Game.greenluo, statusEffects: [] } : null,
    turn: 'player', selectedAction: 0, battleMenuPage: 0,
    log: ['遭遇了' + e.name + '！'],
    animFrame: 0, enemyShake: 0, playerShake: 0, greenluoShake: 0,
    damageNumbers: [], enemyTurnTimer: 0, greenluoTurnTimer: 0,
    turnOrder: 'player',
  };
  Game.scene = 'battle';
}

function calculateDamage(attacker, defender, multiplier) {
  const base = getEffectiveAtk(attacker) * multiplier;
  const def = getEffectiveDef(defender);
  return Math.max(1, Math.floor(base - def * 0.5 + (Math.random() - 0.5) * 4));
}

function updateBattle(dt) {
  const b = Game.battle;
  if (!b) { Game.scene = 'map'; return; }
  b.animFrame++;
  if (b.enemyShake > 0) b.enemyShake -= dt;
  if (b.playerShake > 0) b.playerShake -= dt;
  if (b.greenluoShake > 0) b.greenluoShake -= dt;
  b.damageNumbers = b.damageNumbers.filter(d => { d.y -= 1; d.life -= dt; return d.life > 0; });

  if (b.turn === 'win') {
    b.winTimer = (b.winTimer || 0) + dt;
    if (b.winTimer > 500 && Input.pressedConfirm()) {
      Game.player.hp = b.member.hp; Game.player.mp = b.member.mp;
      if (b.greenluo) { Game.greenluo.hp = b.greenluo.hp; Game.greenluo.mp = b.greenluo.mp; }
      Game.battle = null; Game.scene = Game.interior ? 'interior' : 'map';
    }
    return;
  }
  if (b.turn === 'lose') {
    b.loseTimer = (b.loseTimer || 0) + dt;
    if (b.loseTimer > 500 && Input.pressedConfirm()) {
      loadGame();
      Game.battle = null; Game.scene = 'map';
    }
    return;
  }

  if (b.turnOrder === 'player') {
    processStatusEffects(b.member, dt);
    processStatusEffects(b.enemy, dt);
    if (b.greenluo) processStatusEffects(b.greenluo, dt);
  }

  if (b.turnOrder === 'player' && hasStatusEffect(b.member, 'npe')) {
    b.log.push('老陈遭遇NullPointerException，无法行动！');
    b.turnOrder = 'greenluo';
    if (!b.greenluo) b.turnOrder = 'enemy';
  }

  if (b.turnOrder === 'player') {
    const skills = Game.player.skills.map(id => ({ id, ...SKILL_TREE[id] })).filter(s => s.type);
    const dirY = Input.getDirY();
    if (dirY < -0.3 && !Input.prevBattleNavUp) {
      SFX.play('select');
      if (b.battleMenuPage === 0) b.selectedAction = (b.selectedAction - 1 + skills.length) % skills.length;
      else if (b.battleMenuPage === 1 && b.greenluo) b.selectedAction = (b.selectedAction - 1 + b.greenluo.skills.length) % b.greenluo.skills.length;
      else if (b.battleMenuPage === 2) b.selectedAction = (b.selectedAction - 1 + Game.player.inventory.length) % Math.max(1, Game.player.inventory.length);
    }
    if (dirY > 0.3 && !Input.prevBattleNavDown) {
      SFX.play('select');
      if (b.battleMenuPage === 0) b.selectedAction = (b.selectedAction + 1) % skills.length;
      else if (b.battleMenuPage === 1 && b.greenluo) b.selectedAction = (b.selectedAction + 1) % b.greenluo.skills.length;
      else if (b.battleMenuPage === 2) b.selectedAction = (b.selectedAction + 1) % Math.max(1, Game.player.inventory.length);
    }
    const dirX = Input.getDirX();
    if (dirX < -0.3 && !Input.prevBattleNavLeft) {
      SFX.play('select');
      b.battleMenuPage = (b.battleMenuPage - 1 + 3) % 3;
      b.selectedAction = 0;
    }
    if (dirX > 0.3 && !Input.prevBattleNavRight) {
      SFX.play('select');
      b.battleMenuPage = (b.battleMenuPage + 1) % 3;
      b.selectedAction = 0;
    }
    Input.prevBattleNavLeft = (dirX < -0.3); Input.prevBattleNavRight = (dirX > 0.3);
    Input.prevBattleNavUp = (dirY < -0.3); Input.prevBattleNavDown = (dirY > 0.3);

    if (Input.pressedConfirm()) {
      SFX.play('confirm');
      if (b.battleMenuPage === 0) {
        const skill = skills[b.selectedAction];
        if (!skill) return;
        if (b.member.mp < skill.mp) { b.log.push('MP不足！'); SFX.play('error'); return; }
        b.member.mp -= skill.mp;
        executePlayerAction(b, skill);
        b.turnOrder = 'greenluo';
        if (!b.greenluo) b.turnOrder = 'enemy';
      } else if (b.battleMenuPage === 1 && b.greenluo) {
        const skill = b.greenluo.skills[b.selectedAction];
        if (!skill) return;
        if (b.greenluo.mp < skill.mp) { b.log.push('绿萝MP不足！'); return; }
        b.greenluo.mp -= skill.mp;
        executeGreenluoAction(b, skill);
        b.turnOrder = 'enemy';
      } else if (b.battleMenuPage === 2) {
        const item = Game.player.inventory[b.selectedAction];
        if (!item) return;
        if (useItem(item.id)) {
          b.member.hp = Game.player.hp; b.member.mp = Game.player.mp;
          b.log.push('老陈使用了' + (ITEMS[item.id] ? ITEMS[item.id].name : item.id));
          b.turnOrder = 'greenluo';
          if (!b.greenluo) b.turnOrder = 'enemy';
        }
      }
    }
  } else if (b.greenluo && b.turnOrder === 'greenluo') {
    b.greenluoTurnTimer = (b.greenluoTurnTimer || 0) + dt;
    if (b.greenluoTurnTimer > 800) {
      b.greenluoTurnTimer = 0;
      let skill = null;
      if (b.member.hp < b.member.maxHp * 0.4 && b.greenluo.mp >= 5) {
        skill = b.greenluo.skills.find(s => s.type === 'heal');
      } else if (b.greenluo.mp >= 15 && b.enemy.hp > 50) {
        skill = b.greenluo.skills.find(s => s.type === 'aoe');
      } else if (b.greenluo.mp >= 8 && !hasStatusEffect(b.member, 'buff_atk')) {
        skill = b.greenluo.skills.find(s => s.type === 'buff_atk');
      } else {
        skill = b.greenluo.skills.find(s => s.type === 'analyze') || b.greenluo.skills[0];
      }
      if (skill && b.greenluo.mp >= skill.mp) {
        b.greenluo.mp -= skill.mp;
        executeGreenluoAction(b, skill);
      }
      b.turnOrder = 'enemy';
    }
  } else if (b.turnOrder === 'enemy') {
    b.enemyTurnTimer -= dt;
    if (b.enemyTurnTimer <= 0) {
      b.enemyTurnTimer = 800;
      if (b.enemy.isBoss) updateBossPhase(b);
      const target = b.greenluo && Math.random() < 0.3 ? b.greenluo : b.member;
      const dmg = calculateDamage(b.enemy, target, 1.0);
      target.hp = Math.max(0, target.hp - dmg);
      SFX.play('hit');
      if (target === b.member) {
        b.playerShake = 300;
        b.damageNumbers.push({ x: 200, y: 320, value: dmg, life: 1000, color: '#ff6644' });
      } else {
        b.greenluoShake = 300;
        b.damageNumbers.push({ x: 200, y: 420, value: dmg, life: 1000, color: '#ff6644' });
      }
      b.log.push(b.enemy.name + '攻击，造成' + dmg + '伤害！');
      if (b.enemy.abilities && b.enemy.abilities.includes('npe') && Math.random() < 0.3) {
        applyStatusEffect(target, 'npe', 1); b.log.push(target.name + '遭遇NullPointerException！');
      }
      if (b.enemy.abilities && b.enemy.abilities.includes('infinite_loop') && Math.random() < 0.3) {
        applyStatusEffect(target, 'infinite_loop', 3); b.log.push(target.name + '陷入死循环！');
      }
      if (b.enemy.abilities && b.enemy.abilities.includes('stack_overflow') && Math.random() < 0.3) {
        applyStatusEffect(target, 'stack_overflow', 3); b.log.push(target.name + '栈溢出！防御归零！');
      }
      if (b.member.hp <= 0) {
        if (Game.player.equipment.accessory === 'git_badge') {
          Game.player.equipment.accessory = null;
          b.member.hp = Math.floor(b.member.maxHp * 0.5);
          b.log.push('Git徽章触发！老陈复活了！');
        } else {
          b.log.push('老陈倒下了...');
          b.turn = 'lose';
          SFX.play('defeat');
        }
      }
      if (b.greenluo && b.greenluo.hp <= 0) {
        b.log.push('绿萝被击败了...'); b.greenluo = null;
      }
      if (b.turn !== 'lose') {
        b.turn = 'player'; b.turnOrder = 'player'; b.selectedAction = 0;
      }
    }
  }

  if (b.enemy.hp <= 0 && b.turn !== 'win') {
    b.turn = 'win';
    SFX.play('victory');
    const xp = b.enemy.xp || 10, gold = b.enemy.gold || 5;
    gainXP(xp);
    Game.player.gold += gold;
    b.log.push(`击败了${b.enemy.name}！获得${xp}XP，${gold}金币。`);
    Game.player.hp = b.member.hp; Game.player.mp = b.member.mp;
    if (b.greenluo) { Game.greenluo.hp = b.greenluo.hp; Game.greenluo.mp = b.greenluo.mp; }
  }
}

function executePlayerAction(b, skill) {
  if (skill.type === 'defense') {
    applyStatusEffect(b.member, 'buff_def', 2);
    b.log.push('老陈进入防御姿态！');
    SFX.play('confirm');
  } else if (skill.type === 'attack') {
    SFX.play('attack');
    if (b.enemy.phase3 && skill.id !== 'breakpoint') {
      b.log.push(`老陈使用${skill.name}，但零号Bug免疫了！需要断点术！`);
      return;
    }
    let hits = skill.id === 'recursion' ? 2 : 1;
    for (let i = 0; i < hits; i++) {
      let dmg = calculateDamage(b.member, b.enemy, skill.power);
      if (skill.id === 'step_execute' && Math.random() < 0.5) { dmg = Math.floor(dmg * 1.5); b.log.push('暴击！'); }
      b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
      b.enemyShake = 300;
      b.damageNumbers.push({ x: 200, y: 140, value: dmg, life: 1000, color: '#ff4444' });
      b.log.push(`老陈使用${skill.name}，造成${dmg}伤害！`);
      if (b.enemy.hp <= 0) break;
    }
  } else if (skill.type === 'debuff') {
    applyStatusEffect(b.enemy, 'stack_overflow', 3);
    b.enemy.def = Math.floor(b.enemy.def * 0.5);
    b.log.push(`老陈使用${skill.name}，敌人防御降低！`);
    b.member.statusEffects = b.member.statusEffects.filter(s => s.type !== 'npe' && s.type !== 'deadlock');
    if (b.enemy.phase3 && skill.id === 'breakpoint') {
      const dmg = calculateDamage(b.member, b.enemy, 1.5);
      b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
      b.enemyShake = 300;
      b.damageNumbers.push({ x: 200, y: 140, value: dmg, life: 1000, color: '#ff4444' });
      b.log.push(`断点术命中要害！造成${dmg}伤害！`);
    }
  } else if (skill.type === 'cleanse') {
    b.member.statusEffects = [];
    b.log.push('老陈释放了内存，所有异常解除！');
    SFX.play('heal');
  }
}

function executeGreenluoAction(b, skill) {
  if (skill.type === 'analyze') {
    b.log.push('绿萝分析了' + b.enemy.name + '的弱点！');
    b.enemy.def = Math.floor(b.enemy.def * 0.7);
    SFX.play('confirm');
  } else if (skill.type === 'buff_atk') {
    applyStatusEffect(b.member, 'buff_atk', 3);
    b.log.push('绿萝重构了老陈的攻击逻辑，攻击力提升！');
    SFX.play('confirm');
  } else if (skill.type === 'heal') {
    const heal = 30;
    b.member.hp = Math.min(b.member.maxHp, b.member.hp + heal);
    b.damageNumbers.push({ x: 200, y: 320, value: heal, life: 1000, color: '#2ecc71' });
    b.log.push('绿萝写了一行REM，老陈恢复了' + heal + 'HP！');
    SFX.play('heal');
  } else if (skill.type === 'aoe') {
    const dmg = Math.floor(getEffectiveAtk(b.greenluo) * skill.power);
    b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
    b.enemyShake = 300;
    b.damageNumbers.push({ x: 200, y: 140, value: dmg, life: 1000, color: '#2ecc71' });
    b.log.push('绿萝执行了gcc，造成' + dmg + '伤害！');
    SFX.play('attack');
  }
}

function updateBossPhase(b) {
  const hpRatio = b.enemy.hp / b.enemy.maxHp;
  if (hpRatio < 0.75 && Game.flags.bossPhase < 1) {
    Game.flags.bossPhase = 1;
    b.log.push('零号Bug：你以为找到我了？');
    b.enemy.atk = Math.floor(b.enemy.atk * 1.3);
  }
  if (hpRatio < 0.4 && Game.flags.bossPhase < 2) {
    Game.flags.bossPhase = 2;
    b.log.push('零号Bug：我是注释里的阴影。');
    b.enemy.atk = Math.floor(b.enemy.atk * 1.2);
    b.log.push('零号Bug召唤了语法错误！');
    b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + 20);
  }
  if (hpRatio < 0.2 && Game.flags.bossPhase < 3) {
    Game.flags.bossPhase = 3;
    b.log.push('零号Bug：你...读懂了我？');
    b.enemy.phase3 = true;
  }
}

function renderBattle() {
  const b = Game.battle;
  if (!b) return;
  if (IMAGES.battle_bg) { ctx.drawImage(IMAGES.battle_bg, 0, 0, CW, CH); }
  else {
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#1a1a3e'); grad.addColorStop(1, '#2d1a3e');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, CW, CH);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(0, 0, CW, CH);

  // 敌人
  const enemyX = 200, enemyY = 160;
  const eshake = b.enemyShake > 0 ? Math.sin(b.animFrame * 0.8) * 6 : 0;
  if (IMAGES.bug) {
    const img = IMAGES.bug; const eSize = 140;
    const ratio = img.width / img.height;
    let dw = eSize, dh = eSize;
    if (ratio > 1) { dh = eSize; dw = eSize * ratio; } else { dw = eSize; dh = eSize / ratio; }
    ctx.drawImage(img, enemyX - dw / 2 + eshake, enemyY - dh / 2, dw, dh);
  }
  ctx.fillStyle = 'rgba(10,10,30,0.85)'; ctx.fillRect(enemyX - 80, enemyY - 60, 160, 50);
  ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.strokeRect(enemyX - 80, enemyY - 60, 160, 50);
  ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 13px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(b.enemy.name + (b.enemy.isBoss ? ' [Boss]' : ''), enemyX, enemyY - 44);
  ctx.fillStyle = '#333'; ctx.fillRect(enemyX - 60, enemyY - 28, 120, 8);
  ctx.fillStyle = '#e74c3c'; ctx.fillRect(enemyX - 60, enemyY - 28, 120 * (b.enemy.hp / b.enemy.maxHp), 8);
  ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(enemyX - 60, enemyY - 28, 120, 8);
  ctx.fillStyle = '#aaa'; ctx.font = '9px Courier New';
  ctx.fillText(b.enemy.hp + '/' + b.enemy.maxHp, enemyX, enemyY - 18);
  if (b.enemy.statusEffects && b.enemy.statusEffects.length > 0) {
    let sx = enemyX - 30;
    for (const s of b.enemy.statusEffects) {
      const eff = STATUS_EFFECTS[s.type];
      if (eff) { ctx.fillStyle = eff.color; ctx.font = '8px Courier New'; ctx.textAlign = 'center'; ctx.fillText(eff.icon, sx, enemyY - 68); sx += 15; }
    }
  }

  // 玩家
  const playerX = 200, playerY = 340;
  const pshake = b.playerShake > 0 ? Math.sin(b.animFrame * 0.8) * 5 : 0;
  if (IMAGES.laochen) {
    const img = IMAGES.laochen; const pSize = 140;
    const ratio = img.width / img.height;
    let dw = pSize, dh = pSize;
    if (ratio > 1) { dh = pSize; dw = pSize * ratio; } else { dw = pSize; dh = pSize / ratio; }
    ctx.save(); ctx.translate(playerX + dw / 2 + pshake, 0); ctx.scale(-1, 1);
    ctx.drawImage(img, 0, playerY - dh / 2, dw, dh); ctx.restore();
  }
  ctx.fillStyle = 'rgba(10,10,30,0.85)'; ctx.fillRect(playerX - 70, playerY + 30, 140, 50);
  ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = 2; ctx.strokeRect(playerX - 70, playerY + 30, 140, 50);
  ctx.fillStyle = '#4a90d9'; ctx.font = 'bold 13px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(b.member.name, playerX, playerY + 46);
  ctx.fillStyle = '#333'; ctx.fillRect(playerX - 55, playerY + 52, 110, 8);
  ctx.fillStyle = '#e74c3c'; ctx.fillRect(playerX - 55, playerY + 52, 110 * (b.member.hp / b.member.maxHp), 8);
  ctx.fillStyle = '#333'; ctx.fillRect(playerX - 55, playerY + 62, 110, 5);
  ctx.fillStyle = '#3498db'; ctx.fillRect(playerX - 55, playerY + 62, 110 * (b.member.mp / b.member.maxMp), 5);
  ctx.fillStyle = '#aaa'; ctx.font = '8px Courier New';
  ctx.fillText('HP ' + b.member.hp + '/' + b.member.maxHp + '  MP ' + b.member.mp + '/' + b.member.maxMp, playerX, playerY + 73);
  if (b.member.statusEffects && b.member.statusEffects.length > 0) {
    let sx = playerX - 30;
    for (const s of b.member.statusEffects) {
      const eff = STATUS_EFFECTS[s.type];
      if (eff) { ctx.fillStyle = eff.color; ctx.font = '8px Courier New'; ctx.textAlign = 'center'; ctx.fillText(eff.icon, sx, playerY + 22); sx += 15; }
    }
  }

  // 绿萝
  if (b.greenluo) {
    const gx = 100, gy = 340;
    const gshake = b.greenluoShake > 0 ? Math.sin(b.animFrame * 0.8) * 4 : 0;
    if (IMAGES.greenluo) {
      const img = IMAGES.greenluo; const gSize = 100;
      const ratio = img.width / img.height;
      let dw = gSize, dh = gSize;
      if (ratio > 1) { dh = gSize; dw = gSize * ratio; } else { dw = gSize; dh = gSize / ratio; }
      ctx.drawImage(img, gx - dw / 2 + gshake, gy - dh / 2, dw, dh);
    }
    ctx.fillStyle = 'rgba(10,10,30,0.85)'; ctx.fillRect(gx - 50, gy + 30, 100, 35);
    ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1; ctx.strokeRect(gx - 50, gy + 30, 100, 35);
    ctx.fillStyle = '#2ecc71'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('绿萝', gx, gy + 44);
    ctx.fillStyle = '#333'; ctx.fillRect(gx - 35, gy + 50, 70, 4);
    ctx.fillStyle = '#2ecc71'; ctx.fillRect(gx - 35, gy + 50, 70 * (b.greenluo.hp / b.greenluo.maxHp), 4);
  }

  // 技能菜单
  if (b.turnOrder === 'player') {
    const menuX = 10, menuY = 440;
    ctx.fillStyle = 'rgba(10,10,30,0.9)'; ctx.fillRect(menuX, menuY, CW - 20, 80);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(menuX, menuY, CW - 20, 80);
    const tabs = ['老陈', '绿萝', '道具'];
    ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const tx = menuX + 30 + i * 50;
      ctx.fillStyle = b.battleMenuPage === i ? '#ffd700' : '#555';
      ctx.fillRect(tx - 20, menuY + 4, 40, 14);
      ctx.fillStyle = b.battleMenuPage === i ? '#000' : '#888';
      ctx.fillText(tabs[i], tx, menuY + 14);
    }
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'left';
    ctx.fillText('← →切换', menuX + CW - 70, menuY + 14);

    let items = [];
    if (b.battleMenuPage === 0) {
      items = Game.player.skills.map(id => ({ id, ...SKILL_TREE[id] })).filter(s => s.type);
    } else if (b.battleMenuPage === 1 && b.greenluo) {
      items = b.greenluo.skills;
    } else if (b.battleMenuPage === 2) {
      items = Game.player.inventory.map(i => ({ id: i.id, name: ITEMS[i.id] ? ITEMS[i.id].name : i.id, mp: 0, ...i }));
    }
    for (let i = 0; i < Math.min(items.length, 4); i++) {
      const a = items[i];
      const ay = menuY + 30 + i * 12;
      if (i === b.selectedAction) {
        ctx.fillStyle = 'rgba(255,215,0,0.15)'; ctx.fillRect(menuX + 4, ay - 9, CW - 28, 11);
        ctx.fillStyle = '#ffd700';
      } else { ctx.fillStyle = '#ccc'; }
      ctx.font = '10px Courier New'; ctx.textAlign = 'left';
      const mpCost = a.mp ? ` MP:${a.mp}` : '';
      const qty = a.qty ? ` x${a.qty}` : '';
      ctx.fillText('> ' + (a.name || a.id) + mpCost + qty, menuX + 10, ay);
    }
  }

  // 战斗日志
  const logX = 10, logY = 530;
  ctx.fillStyle = 'rgba(10,10,30,0.85)'; ctx.fillRect(logX, logY, CW - 20, 70);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(logX, logY, CW - 20, 70);
  ctx.fillStyle = '#888'; ctx.font = '9px Courier New'; ctx.textAlign = 'left';
  ctx.fillText('战斗日志', logX + 6, logY + 12);
  ctx.fillStyle = '#aaa'; ctx.font = '9px Courier New';
  const recentLog = b.log.slice(-4);
  for (let i = 0; i < recentLog.length; i++) { ctx.fillText(recentLog[i], logX + 8, logY + 26 + i * 11); }

  // 伤害数字
  for (const d of b.damageNumbers) {
    ctx.fillStyle = d.color; ctx.font = 'bold 20px Courier New'; ctx.textAlign = 'center';
    const prefix = d.color === '#2ecc71' ? '+' : '-';
    ctx.fillText(prefix + d.value, d.x, d.y);
  }

  // 胜利/失败画面
  if (b.turn === 'win') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 36px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('VICTORY!', CW / 2, CH / 2);
    ctx.font = '12px Courier New'; ctx.fillStyle = '#ccc';
    ctx.fillText('点击右下角确认返回', CW / 2, CH / 2 + 30);
  }
  if (b.turn === 'lose') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 36px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('DEFEATED...', CW / 2, CH / 2);
    ctx.font = '12px Courier New'; ctx.fillStyle = '#ccc';
    ctx.fillText('点击右下角从存档点重来', CW / 2, CH / 2 + 30);
  }
}

// ════════════════════════════════════════════════════════════
// 菜单场景
// ════════════════════════════════════════════════════════════
function updateMenu(dt) {
  const dirY = Input.getDirY();
  if (dirY < -0.3 && !Input.prevBattleNavUp) {
    Game.menuTab = (Game.menuTab - 1 + 3) % 3;
  }
  if (dirY > 0.3 && !Input.prevBattleNavDown) {
    Game.menuTab = (Game.menuTab + 1) % 3;
  }
  Input.prevBattleNavUp = (dirY < -0.3);
  Input.prevBattleNavDown = (dirY > 0.3);
  if (Input.pressedConfirm() && Game.menuTab === 2) {
    useItem('health_potion');
  }
  if (Input.joystick.active && Input.joystick.dy < -50) {
    Game.scene = Game.interior ? 'interior' : 'map';
  }
}

function renderMenu() {
  ctx.fillStyle = 'rgba(10,10,30,0.95)'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('— 菜单 —', CW / 2, 30);
  const tabs = ['技能树', '装备', '道具'];
  for (let i = 0; i < 3; i++) {
    const tx = 30 + i * 120, ty = 50;
    ctx.fillStyle = Game.menuTab === i ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(tx, ty, 100, 24);
    ctx.strokeStyle = Game.menuTab === i ? '#ffd700' : '#444'; ctx.lineWidth = 1;
    ctx.strokeRect(tx, ty, 100, 24);
    ctx.fillStyle = Game.menuTab === i ? '#ffd700' : '#888';
    ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(tabs[i], tx + 50, ty + 16);
  }

  if (Game.menuTab === 0) {
    ctx.fillStyle = '#fff'; ctx.font = '12px Courier New'; ctx.textAlign = 'left';
    let y = 90;
    ctx.fillText('Lv.' + Game.player.level + '  XP: ' + Game.player.xp + '/' + Game.player.xpToNext, 20, y); y += 20;
    ctx.fillText('HP ' + Game.player.hp + '/' + Game.player.maxHp + '  MP ' + Game.player.mp + '/' + Game.player.maxMp, 20, y); y += 20;
    ctx.fillText('ATK ' + getPlayerStat('atk') + '  DEF ' + getPlayerStat('def'), 20, y); y += 25;
    ctx.fillStyle = '#ffd700'; ctx.fillText('— 技能列表 —', 20, y); y += 18;
    for (const id of Game.player.skills) {
      const skill = SKILL_TREE[id];
      if (!skill) continue;
      ctx.fillStyle = '#2ecc71'; ctx.fillText('✓ ' + skill.name + ' (MP:' + skill.mp + ') — ' + skill.desc, 20, y); y += 16;
    }
    y += 10;
    ctx.fillStyle = '#666'; ctx.fillText('— 未解锁 —', 20, y); y += 16;
    for (const [id, skill] of Object.entries(SKILL_TREE)) {
      if (Game.player.skills.includes(id)) continue;
      const prereqMet = skill.prereq.every(p => Game.player.skills.includes(p));
      const levelMet = Game.player.level >= skill.level;
      if (prereqMet && levelMet) {
        ctx.fillStyle = '#f39c12'; ctx.fillText('⚡ ' + skill.name + ' — 可解锁！(Lv.' + skill.level + ')', 20, y); y += 16;
      } else {
        ctx.fillStyle = '#555'; ctx.fillText('🔒 ' + skill.name + ' — 需Lv.' + skill.level + ' + ' + skill.prereq.map(p => SKILL_TREE[p].name).join(','), 20, y); y += 16;
      }
    }
  } else if (Game.menuTab === 1) {
    ctx.fillStyle = '#fff'; ctx.font = '12px Courier New'; ctx.textAlign = 'left';
    let y = 90;
    const slots = ['weapon', 'armor', 'accessory'];
    const slotNames = { weapon: '武器', armor: '防具', accessory: '饰品' };
    for (const slot of slots) {
      const eqId = Game.player.equipment[slot];
      const eq = eqId ? EQUIPMENT[eqId] : null;
      ctx.fillStyle = '#ffd700'; ctx.fillText(slotNames[slot] + ': ', 20, y);
      ctx.fillStyle = eq ? '#fff' : '#555';
      ctx.fillText(eq ? eq.name : '（空）', 80, y); y += 16;
      if (eq) {
        ctx.fillStyle = '#888'; ctx.font = '10px Courier New';
        let stats = [];
        if (eq.atk) stats.push('ATK+' + eq.atk);
        if (eq.def) stats.push('DEF+' + eq.def);
        if (eq.hp) stats.push('HP+' + eq.hp);
        if (eq.mp) stats.push('MP+' + eq.mp);
        if (eq.effect) stats.push(eq.effect);
        ctx.fillText('  ' + stats.join('  ') + '  ' + eq.desc, 20, y); y += 16;
      }
      ctx.font = '12px Courier New'; y += 5;
    }
  } else if (Game.menuTab === 2) {
    ctx.fillStyle = '#fff'; ctx.font = '12px Courier New'; ctx.textAlign = 'left';
    let y = 90;
    ctx.fillStyle = '#ffd700'; ctx.fillText('金币: ' + Game.player.gold + 'G', 20, y); y += 25;
    ctx.fillText('— 道具 —', 20, y); y += 18;
    if (Game.player.inventory.length === 0) {
      ctx.fillStyle = '#555'; ctx.fillText('（空）', 20, y);
    }
    for (const item of Game.player.inventory) {
      const data = ITEMS[item.id];
      if (!data) continue;
      ctx.fillStyle = '#fff'; ctx.fillText(data.name + ' x' + item.qty, 20, y); y += 16;
      ctx.fillStyle = '#888'; ctx.font = '10px Courier New';
      ctx.fillText('  ' + data.desc, 20, y); y += 16;
      ctx.font = '12px Courier New';
    }
  }
  ctx.fillStyle = '#888'; ctx.font = '10px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('↑上滑关闭菜单', CW / 2, CH - 15);
}

// ════════════════════════════════════════════════════════════
// 触摸控件渲染
// ════════════════════════════════════════════════════════════
function renderTouchControls() {
  // 调试信息
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, SW, 40);
  ctx.fillStyle = '#0f0'; ctx.font = '9px Courier New'; ctx.textAlign = 'left';
  ctx.fillText('Lv' + Game.player.level + ' ' + Game.scene + ' ' + Math.round(Game.player.x) + ',' + Math.round(Game.player.y), 5, 12);
  ctx.fillText('joy:' + (Input.joystick.active ? 'ON' : 'off') + ' dx=' + Math.round(Input.joystick.dx) + ' dy=' + Math.round(Input.joystick.dy), 5, 24);
  ctx.restore();

  // 菜单按钮（右上角）
  if (Game.scene === 'map' || Game.scene === 'interior') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.fillRect(LW - 60, 0, 60, 30);
    ctx.strokeStyle = 'rgba(255,215,0,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(LW - 60, 0, 60, 30);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('菜单', LW - 30, 20);
    ctx.restore();
  }

  if (Game.scene === 'dialogue' || Game.scene === 'menu' || Game.scene === 'shop') {
    // 对话场景显示语音按钮（AI模式时）
    if (Game.scene === 'dialogue' && Game.dialogue && Game.dialogue.mode === 'ai' && Voice.enabled) {
      const vbX = LW - 80, vbY = LH - 80;
      ctx.save();
      const isRecording = Voice.state === 'recording';
      ctx.fillStyle = isRecording ? 'rgba(255,80,80,0.5)' : 'rgba(46,204,113,0.2)';
      ctx.beginPath(); ctx.arc(vbX, vbY, 38, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = isRecording ? '#ff4444' : '#2ecc71'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = isRecording ? '#ff4444' : '#2ecc71';
      ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'center';
      ctx.fillText(isRecording ? '●录音' : '🎤说话', vbX, vbY + 5);
      ctx.restore();
    }
    // 确认按钮（对话/菜单/商店也显示）
    {
      const btnX = LW - 80, btnY = LH - 80;
      ctx.save();
      ctx.fillStyle = Input.confirmPressed ? 'rgba(255,215,0,0.5)' : 'rgba(255,215,0,0.2)';
      ctx.beginPath(); ctx.arc(btnX, btnY, 38, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,0,0.8)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
      ctx.fillText('确认', btnX, btnY + 5); ctx.restore();
    }
  } else {
    // 浮动摇杆
    if (Input.joystick.active) {
      const jx = Input.joystick.startX, jy = Input.joystick.startY;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,215,0,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(jx, jy, 40, 0, Math.PI * 2); ctx.stroke();
      const thumbX = jx + Math.max(-30, Math.min(30, Input.joystick.dx));
      const thumbY = jy + Math.max(-30, Math.min(30, Input.joystick.dy));
      ctx.fillStyle = 'rgba(255,215,0,0.5)';
      ctx.beginPath(); ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 确认按钮（右下角）
    const btnX = LW - 80, btnY = LH - 80;
    ctx.save();
    const isEnd = Game.battle && (Game.battle.turn === 'win' || Game.battle.turn === 'lose');
    const btnLabel = Game.scene === 'battle' ? (isEnd ? '确认' : '攻击') : '确认';
    ctx.fillStyle = Input.confirmPressed ? 'rgba(255,215,0,0.5)' : 'rgba(255,215,0,0.2)';
    ctx.beginPath(); ctx.arc(btnX, btnY, 38, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.8)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(btnLabel, btnX, btnY + 5); ctx.restore();
    // 语音快捷按钮（左下角，地图/室内/战斗时可用）
    if (Voice.enabled && (Game.scene === 'map' || Game.scene === 'interior' || Game.scene === 'battle')) {
      const vbX2 = 80, vbY2 = LH - 80;
      ctx.save();
      ctx.fillStyle = 'rgba(46,204,113,0.15)';
      ctx.beginPath(); ctx.arc(vbX2, vbY2, 30, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(46,204,113,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#2ecc71'; ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'center';
      ctx.fillText('🎤', vbX2, vbY2 + 4); ctx.restore();
    }
  }
}

// ════════════════════════════════════════════════════════════
// 主循环
// ════════════════════════════════════════════════════════════
let lastTime = 0, loaded = false;

function gameLoop(time) {
  const dt = lastTime > 0 ? (time - lastTime) : 16;
  lastTime = time;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SW, SH);
  if (!loaded) {
    // ── 启动画面 ──
    // 背景图（封面，裁切适配竖屏）
    if (IMAGES.splash) {
      const img = IMAGES.splash;
      const iw = img.width, ih = img.height;
      const scr = SW / SH;
      const imr = iw / ih;
      let dw, dh, dx, dy;
      if (imr > scr) { dh = SH; dw = dh * imr; dx = (SW - dw) / 2; dy = 0; }
      else { dw = SW; dh = dw / imr; dx = 0; dy = (SH - dh) / 2; }
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
      // 暗色遮罩
      ctx.fillStyle = 'rgba(10,10,30,0.5)';
      ctx.fillRect(0, 0, SW, SH);
    }
    // 游戏名
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 36px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('代码乡愁', SW / 2, SH * 0.32);
    // 副标题
    ctx.fillStyle = '#4ecdc4';
    ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('代码江湖 · AI伙伴 · 五派争锋', SW / 2, SH * 0.32 + 30);
    // 装饰线
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SW * 0.25, SH * 0.32 + 48);
    ctx.lineTo(SW * 0.75, SH * 0.32 + 48);
    ctx.stroke();
    // 版本号
    ctx.fillStyle = '#888';
    ctx.font = '12px Courier New';
    ctx.fillText('v0.6', SW / 2, SH * 0.32 + 66);
    // 加载进度条
    const barW = SW * 0.5, barH = 6;
    const barX = (SW - barW) / 2, barY = SH * 0.7;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#4ecdc4';
    const prog = Math.min(1, (time % 2000) / 2000);
    ctx.fillRect(barX, barY, barW * prog, barH);
    // 加载文字
    ctx.fillStyle = '#666';
    ctx.font = '12px "PingFang SC", sans-serif';
    ctx.fillText('加载中...', SW / 2, barY + 24);
    requestAnimationFrame(gameLoop); return;
  }
  ctx.save();
  ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  switch (Game.scene) {
    case 'map': updateMap(dt); renderMap(); break;
    case 'interior': updateInterior(dt); renderInterior(); break;
    case 'shop': updateShop(dt); renderShop(); break;
    case 'dialogue': updateDialogue(dt); renderDialogue(); break;
    case 'battle': updateBattle(dt); renderBattle(); break;
    case 'menu': updateMenu(dt); renderMenu(); break;
  }
  ctx.restore();
  renderTouchControls();
  Input.update();
  requestAnimationFrame(gameLoop);
}

// ─── 启动 ───
Input.init();
Voice.init();
// 初始化云开发（如果可用）
if (typeof wx.cloud !== 'undefined' && wx.cloud.init) {
  try { wx.cloud.init(); } catch(e) { console.log('cloud init failed:', e.message); }
}
loadImages().then(() => {
  loaded = true;
  // 清除v0.5旧版存档
  try { wx.removeStorageSync('code_heroes_save'); } catch(e) {}
  requestAnimationFrame(gameLoop);
});
