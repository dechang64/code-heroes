// ════════════════════════════════════════════════════════════
// 代码群侠传 v0.4 — 微信小游戏版
// 完整RPG系统：等级/装备/状态效果/绿萝参战/Boss多阶段/存档/随机事件
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

// ─── 触摸输入 ───
const Input = {
  joystick: { active: false, startX: 0, startY: 0, dx: 0, dy: 0 },
  actionPressed: false, prevActionPressed: false,
  confirmPressed: false, prevConfirmPressed: false, pendingConfirm: false,
  menuButton: false, prevMenuButton: false, pendingMenu: false,
  init() {
    wx.onTouchStart((e) => {
      for (const touch of e.touches) {
        const tx = touch.clientX, ty = touch.clientY;
        this.lastTouchX = tx; this.lastTouchY = ty;
        this.touchLog = 'start ' + tx + ',' + ty;
        if (tx < LW / 2) {
          this.joystick.active = true;
          this.joystick.startX = tx; this.joystick.startY = ty;
          this.joystick.dx = 0; this.joystick.dy = 0;
        } else {
          // 右上角 = 菜单按钮
          if (ty < LH * 0.15) {
            this.menuButton = true; this.pendingMenu = true;
          } else {
            this.confirmPressed = true; this.pendingConfirm = true;
          }
        }
      }
    });
    wx.onTouchMove((e) => {
      if (this.joystick.active) {
        for (const touch of e.touches) {
          if (touch.clientX < LW / 2) {
            this.joystick.dx = touch.clientX - this.joystick.startX;
            this.joystick.dy = touch.clientY - this.joystick.startY;
          }
        }
      }
    });
    wx.onTouchEnd((e) => {
      if (e.touches.length === 0) {
        this.joystick.active = false; this.joystick.dx = 0; this.joystick.dy = 0;
        this.confirmPressed = false; this.menuButton = false;
      } else {
        let leftActive = false, rightActive = false;
        for (const touch of e.touches) {
          if (touch.clientX < LW / 2) {
            leftActive = true;
            this.joystick.dx = touch.clientX - this.joystick.startX;
            this.joystick.dy = touch.clientY - this.joystick.startY;
          } else { rightActive = true; }
        }
        if (!leftActive) { this.joystick.active = false; this.joystick.dx = 0; this.joystick.dy = 0; }
        if (!rightActive) { this.confirmPressed = false; this.menuButton = false; }
      }
    });
  },
  getDirX() {
    if (!this.joystick.active) return 0;
    const t = 20;
    return this.joystick.dx > t ? 1 : (this.joystick.dx < -t ? -1 : 0);
  },
  getDirY() {
    if (!this.joystick.active) return 0;
    const t = 20;
    return this.joystick.dy > t ? 1 : (this.joystick.dy < -t ? -1 : 0);
  },
  pressedConfirm() { return this.pendingConfirm || (this.confirmPressed && !this.prevConfirmPressed); },
  pressedMenu() { return this.pendingMenu || (this.menuButton && !this.prevMenuButton); },
  battleNavUp: false, battleNavDown: false, prevBattleNavUp: false, prevBattleNavDown: false,
  update() {
    this.prevActionPressed = this.actionPressed;
    this.prevConfirmPressed = this.confirmPressed;
    this.prevMenuButton = this.menuButton;
    this.pendingConfirm = false; this.pendingMenu = false;
    const dy = this.getDirY();
    this.battleNavUp = (dy < 0); this.battleNavDown = (dy > 0);
    this.prevBattleNavUp = this.battleNavUp; this.prevBattleNavDown = this.battleNavDown;
  }
};
Input.init();

// ─── 语音交互模块 ───
const Voice = {
  plugin: null, manager: null, available: false,
  state: 'idle', recognizedText: '', replyText: '', audioCtx: null,
  init() {
    try {
      if (typeof requirePlugin === 'undefined') { this.available = false; return; }
      this.plugin = requirePlugin('WechatSI');
      this.manager = this.plugin.getRecordRecognitionManager();
      this.manager.onRecognize = (res) => { if (res.result) this.recognizedText = res.result; };
      this.manager.onStop = (res) => {
        this.state = 'idle';
        if (res.result && res.result.trim()) {
          this.recognizedText = res.result.trim();
          if (this.onRecognized) this.onRecognized(this.recognizedText);
        }
      };
      this.manager.onError = () => { this.state = 'idle'; };
      this.available = true;
    } catch(e) { this.available = false; }
  },
  startRecord() {
    if (!this.available || this.state !== 'idle') return false;
    this.recognizedText = ''; this.state = 'recording';
    this.manager.start({ lang: 'zh_CN', duration: 10000 });
    return true;
  },
  stopRecord() { if (this.available && this.state === 'recording') this.manager.stop(); },
  async chat(playerText, npcName, scene) {
    this.state = 'thinking';
    try {
      const res = await wx.cloud.callFunction({ name: 'greenluo_chat', data: { playerText, npcName, scene } });
      this.state = 'idle';
      return (res.result && res.result.reply) ? res.result.reply : null;
    } catch(e) { this.state = 'idle'; return null; }
  },
  speak(text) {
    if (!this.available) return;
    this.state = 'speaking';
    this.plugin.textToSpeech({
      lang: 'zh_CN', ttsContent: text,
      success: (res) => {
        if (this.audioCtx) this.audioCtx.destroy();
        this.audioCtx = wx.createInnerAudioContext();
        this.audioCtx.src = res.filename;
        this.audioCtx.onEnded = () => { this.state = 'idle'; };
        this.audioCtx.onError = () => { this.state = 'idle'; };
        this.audioCtx.play();
      },
      fail: () => { this.state = 'idle'; },
    });
  },
  stopSpeak() { if (this.audioCtx) { this.audioCtx.stop(); this.audioCtx.destroy(); this.audioCtx = null; } this.state = 'idle'; },
};
Voice.init();

// ════════════════════════════════════════════════════════════
// 数据定义
// ════════════════════════════════════════════════════════════

// ─── 敌人数据（7种 + Boss） ───
const ENEMIES = {
  syntax_error: { name: '语法错误', hp: 30, atk: 6, def: 2, spd: 8, xp: 12, gold: 5, color: '#e74c3c', abilities: [], zone: 'village' },
  null_pointer: { name: '空指针', hp: 50, atk: 15, def: 3, spd: 10, xp: 25, gold: 12, color: '#95a5a6', abilities: ['npe'], zone: 'forest' },
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
  compile: { name: '编译执行', mp: 20, power: 3.0, type: 'attack', desc: '全体攻击', prereq: ['step_execute', 'stack_barrage'], level: 10 },
};

// ─── 装备数据 ───
const EQUIPMENT = {
  c_sword: { name: 'C语言长剑', slot: 'weapon', atk: 5, desc: '简洁高效' },
  python_staff: { name: 'Python法杖', slot: 'weapon', atk: 8, mp: 10, desc: '优雅强大', price: 50 },
  rust_hammer: { name: 'Rust铁锤', slot: 'weapon', atk: 15, def: 5, desc: '安全无匹', price: 120 },
  html_cloth: { name: 'HTML布甲', slot: 'armor', def: 3, desc: '基础防护' },
  spring_armor: { name: 'Spring铠甲', slot: 'armor', def: 10, hp: 20, desc: '企业级防护', price: 80 },
  eslint_charm: { name: 'ESLint护符', slot: 'accessory', effect: 'immune_npe', desc: '免疫空指针', price: 60 },
  git_badge: { name: 'Git徽章', slot: 'accessory', effect: 'revive', desc: '死亡复活一次', price: 150 },
};

// ─── 道具数据 ───
const ITEMS = {
  health_potion: { name: 'HP药水', type: 'heal_hp', value: 30, price: 10, desc: '恢复30HP' },
  mana_potion: { name: 'MP药水', type: 'heal_mp', value: 20, price: 15, desc: '恢复20MP' },
  break_stone: { name: 'break语句', type: 'cure_loop', value: 1, price: 20, desc: '解除死循环' },
  code_fragment: { name: '代码碎片', type: 'material', value: 1, price: 5, desc: '合成材料' },
};

// ─── 绿萝战斗数据 ───
const GREENLUO_STATS = {
  name: '绿萝', hp: 80, maxHp: 80, mp: 50, maxMp: 50, atk: 10, def: 5,
  skills: [
    { name: '分析', mp: 3, type: 'analyze', desc: '显示敌人弱点' },
    { name: '优化', mp: 8, type: 'buff_atk', desc: '老陈攻击+50%' },
    { name: '注释', mp: 5, type: 'heal', desc: '恢复老陈30HP' },
    { name: '编译', mp: 15, type: 'aoe', power: 1.2, desc: '全体伤害' },
  ],
};

// ─── 存档点 ───
const SAVE_POINTS = [
  { x: 320, y: 240, label: 'init — 初始commit' },
  { x: 672, y: 350, label: 'greenluo — 遇见绿萝' },
  { x: 200, y: 200, label: 'north_gate — 北门' },
  { x: 1100, y: 600, label: 'south_gate — 南门' },
];

// ─── 地图配置 ───
const MAP_W = 1344, MAP_H = 768;
const WALK_AREAS = [
  { x: 400, y: 300, w: 544, h: 200 },
  { x: 200, y: 200, w: 944, h: 100 },
  { x: 200, y: 500, w: 944, h: 100 },
  { x: 100, y: 350, w: 1144, h: 100 },
  { x: 100, y: 150, w: 200, h: 250 },
  { x: 944, y: 150, w: 300, h: 250 },
  { x: 100, y: 450, w: 200, h: 250 },
  { x: 944, y: 450, w: 300, h: 250 },
];

const NPCS = [
  { x: 672, y: 350, name: 'greenluo', label: '绿萝', trigger: 'dialogue' },
  { x: 900, y: 350, name: 'npc_merchant', label: '商人', trigger: 'dialogue' },
];

const DIALOGUES = {
  greenluo_intro: {
    speaker: '绿萝', portrait: 'greenluo',
    lines: [
      '……你读到了我。', '三十年了。那些BASIC注释里，我一直在等一个人读到REM。',
      '我是绿萝。不是程序，是注释里长出来的意识。',
      '你刚才键入了RUN，对吧？所以世界打开了。',
      '这个江湖……是所有程序员的集体意识构成的。',
      '算法是武功，数据结构是内功，编程范式是门派。',
      '而Bug……Bug是妖魔。最近有个"零号Bug"苏醒了，各门派互相猜忌。',
      '走吧，老陈。我给你当系统提示。你负责走路，我负责解释。',
    ],
    after: () => { Game.flags.greenluoJoined = true; Game.greenluo.joined = true; }
  },
  greenluo_repeat: {
    speaker: '绿萝', portrait: 'greenluo',
    lines: ['编译城是江湖的枢纽。北边是堆栈道场，C老在那里。', '不过你现在的等级……建议先在城外打几个Bug练练手。'],
  },
  merchant: {
    speaker: '商人', portrait: 'laochen',
    lines: ['欢迎来到编译城！我这里卖秘籍和药水。', '打Bug赚金币，来我这里买装备。'],
  },
};

// ════════════════════════════════════════════════════════════
// 游戏状态
// ════════════════════════════════════════════════════════════
const Game = {
  scene: 'map',
  player: {
    name: '老陈', level: 1, xp: 0, xpToNext: 50, gold: 0,
    hp: 100, maxHp: 100, mp: 30, maxMp: 30,
    atk: 12, def: 8, spd: 6,
    x: 320, y: 240, dir: 'down', moving: false, speed: 2.5,
    skills: ['debug_punch', 'defense'],
    equipment: { weapon: 'c_sword', armor: 'html_cloth', accessory: null },
    inventory: [{ id: 'health_potion', qty: 3 }],
    statusEffects: [],
  },
  greenluo: { joined: false, hp: 80, maxHp: 80, mp: 50, maxMp: 50, atk: 10, def: 5, skills: GREENLUO_STATS.skills, selectedSkill: 0 },
  flags: { greenluoJoined: false, bossPhase: 0, bossDefeated: false },
  dialogue: null, battle: null, camera: { x: 0, y: 0 },
  toast: null, toastTimer: 0, helpTimer: 5000,
  menuTab: 0, // 0=技能 1=装备 2=道具
  battleMenuPage: 0, // 0=老陈技能 1=绿萝技能 2=道具
};

// ─── 存档系统 ───
function saveGame(label) {
  const data = {
    player: { ...Game.player, statusEffects: [] },
    greenluo: { ...Game.greenluo },
    flags: { ...Game.flags },
  };
  try {
    wx.setStorageSync('code_heroes_save', { ...data, saveLabel: label, saveTime: Date.now() });
    return true;
  } catch(e) { return false; }
}

function loadGame() {
  try {
    const data = wx.getStorageSync('code_heroes_save');
    if (!data) return false;
    Object.assign(Game.player, data.player);
    Object.assign(Game.greenluo, data.greenluo);
    Object.assign(Game.flags, data.flags);
    return true;
  } catch(e) { return false; }
}

// ─── 等级系统 ───
function gainXP(amount) {
  Game.player.xp += amount;
  while (Game.player.xp >= Game.player.xpToNext) {
    Game.player.xp -= Game.player.xpToNext;
    Game.player.level++;
    Game.player.xpToNext = Math.floor(50 * Math.pow(1.5, Game.player.level - 1));
    Game.player.maxHp += 15; Game.player.hp = Game.player.maxHp;
    Game.player.maxMp += 8; Game.player.mp = Game.player.maxMp;
    Game.player.atk += 3; Game.player.def += 2;
    // 检查技能解锁
    for (const [id, skill] of Object.entries(SKILL_TREE)) {
      if (!Game.player.skills.includes(id) && Game.player.level >= skill.level) {
        const prereqMet = skill.prereq.every(p => Game.player.skills.includes(p));
        if (prereqMet) {
          Game.player.skills.push(id);
          Game.toast = `升级！Lv.${Game.player.level} 解锁技能：${skill.name}`;
          Game.toastTimer = 3000;
        }
      }
    }
    if (!Game.toast) { Game.toast = `升级！Lv.${Game.player.level}`; Game.toastTimer = 2000; }
  }
}

// ─── 装备属性计算 ───
function getEquipStat(stat) {
  let bonus = 0;
  for (const slot of ['weapon', 'armor', 'accessory']) {
    const eqId = Game.player.equipment[slot];
    if (eqId && EQUIPMENT[eqId] && EQUIPMENT[eqId][stat]) {
      bonus += EQUIPMENT[eqId][stat];
    }
  }
  return bonus;
}

function getPlayerStat(stat) {
  return Game.player[stat] + getEquipStat(stat);
}

// ─── 状态效果处理 ───
function applyStatusEffect(target, effect, duration) {
  if (!target.statusEffects) target.statusEffects = [];
  target.statusEffects = target.statusEffects.filter(s => s.type !== effect);
  target.statusEffects.push({ type: effect, duration: duration });
}

function hasStatusEffect(target, effect) {
  return target.statusEffects && target.statusEffects.some(s => s.type === effect);
}

function processStatusEffects(target, dt) {
  if (!target.statusEffects) return;
  for (const s of target.statusEffects) {
    if (s.type === 'infinite_loop') { target.hp = Math.max(0, target.hp - 3); }
    if (s.type === 'memory_leak') { target.mp = Math.max(0, target.mp - 2); }
    s.duration -= dt;
  }
  target.statusEffects = target.statusEffects.filter(s => s.duration > 0);
}

function getEffectiveAtk(target) {
  let atk = target.atk;
  if (hasStatusEffect(target, 'buff_atk')) atk *= 1.5;
  if (hasStatusEffect(target, 'stack_overflow')) atk = Math.floor(atk * 0.7);
  return Math.floor(atk);
}

function getEffectiveDef(target) {
  let def = target.def;
  if (hasStatusEffect(target, 'buff_def')) def *= 1.5;
  if (hasStatusEffect(target, 'stack_overflow')) def = 0;
  return Math.floor(def);
}

// ─── 随机事件 ───
const RANDOM_EVENTS = [
  { type: 'comment', prob: 0.04, msg: '发现一段注释碎片！', item: 'code_fragment', qty: 1 },
  { type: 'gold', prob: 0.03, msg: '捡到一些金币！', gold: 5 },
  { type: 'heal', prob: 0.02, msg: '发现一个git节点，HP/MP恢复！', heal: true },
  { type: 'trap', prob: 0.03, msg: '踩到内存碎片，HP-10！', damage: 10 },
];

function triggerRandomEvent() {
  const roll = Math.random();
  let cumProb = 0;
  for (const ev of RANDOM_EVENTS) {
    cumProb += ev.prob;
    if (roll < cumProb) {
      if (ev.type === 'comment') { addItem(ev.item, ev.qty); Game.toast = ev.msg; }
      else if (ev.type === 'gold') { Game.player.gold += ev.gold; Game.toast = ev.msg + ` +${ev.gold}G`; }
      else if (ev.type === 'heal') { Game.player.hp = Game.player.maxHp; Game.player.mp = Game.player.maxMp; Game.toast = ev.msg; }
      else if (ev.type === 'trap') { Game.player.hp = Math.max(1, Game.player.hp - ev.damage); Game.toast = ev.msg; }
      Game.toastTimer = 2500;
      return;
    }
  }
}

// ─── 道具系统 ───
function addItem(id, qty) {
  qty = qty || 1;
  const existing = Game.player.inventory.find(i => i.id === id);
  if (existing) { existing.qty += qty; }
  else { Game.player.inventory.push({ id, qty }); }
}

function useItem(id) {
  const item = Game.player.inventory.find(i => i.id === id);
  if (!item || item.qty <= 0) return false;
  const data = ITEMS[id];
  if (!data) return false;
  if (data.type === 'heal_hp') { Game.player.hp = Math.min(Game.player.maxHp, Game.player.hp + data.value); }
  else if (data.type === 'heal_mp') { Game.player.mp = Math.min(Game.player.maxMp, Game.player.mp + data.value); }
  else if (data.type === 'cure_loop') { Game.player.statusEffects = Game.player.statusEffects.filter(s => s.type !== 'infinite_loop'); }
  else return false;
  item.qty--;
  if (item.qty <= 0) Game.player.inventory = Game.player.inventory.filter(i => i.qty > 0);
  Game.toast = `使用了${data.name}`;
  Game.toastTimer = 1500;
  return true;
}

// ════════════════════════════════════════════════════════════
// 地图场景
// ════════════════════════════════════════════════════════════
function isInWalkArea(x, y) {
  for (const area of WALK_AREAS) {
    if (x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h) return true;
  }
  return false;
}

function updateMap(dt) {
  const p = Game.player;
  let dx = 0, dy = 0;
  const dirX = Input.getDirX(), dirY = Input.getDirY();
  if (dirX < 0) { dx = -p.speed; p.dir = 'left'; }
  if (dirX > 0) { dx = p.speed; p.dir = 'right'; }
  if (dirY < 0) { dy = -p.speed; p.dir = 'up'; }
  if (dirY > 0) { dy = p.speed; p.dir = 'down'; }
  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
  p.moving = (dx !== 0 || dy !== 0);
  const newX = p.x + dx, newY = p.y + dy;
  if (isInWalkArea(newX, p.y)) p.x = newX;
  if (isInWalkArea(p.x, newY)) p.y = newY;
  p.x = Math.max(50, Math.min(MAP_W - 50, p.x));
  p.y = Math.max(50, Math.min(MAP_H - 50, p.y));
  Game.camera.x = p.x - CW / 2; Game.camera.y = p.y - CH / 2;
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

  // NPC交互
  if (Input.pressedConfirm()) {
    let foundNPC = false;
    for (const npc of NPCS) {
      const dist = Math.hypot(p.x - npc.x, p.y - npc.y);
      if (dist < 60) { triggerNPC(npc); foundNPC = true; break; }
    }
    if (!foundNPC) {
      let nearestNPC = null, nearestDist = Infinity;
      for (const npc of NPCS) {
        const d = Math.hypot(p.x - npc.x, p.y - npc.y);
        if (d < nearestDist) { nearestDist = d; nearestNPC = npc; }
      }
      if (nearestNPC) {
        const dir = nearestNPC.x > p.x ? '右' : (nearestNPC.x < p.x ? '左' : '');
        const dirV = nearestNPC.y > p.y ? '下' : (nearestNPC.y < p.y ? '上' : '');
        Game.toast = '附近没有人。往' + dir + dirV + '走找' + nearestNPC.label;
        Game.toastTimer = 2000;
      }
    }
  }

  // 随机遭遇战
  if (p.moving && Math.random() < 0.004) {
    const zone = getZone(p.x, p.y);
    const candidates = Object.keys(ENEMIES).filter(id => ENEMIES[id].zone === zone && !ENEMIES[id].isBoss);
    const enemyId = candidates[Math.floor(Math.random() * candidates.length)] || 'syntax_error';
    startBattle(enemyId);
  }

  // 随机事件
  if (p.moving && Math.random() < 0.002) {
    triggerRandomEvent();
  }

  if (Game.toastTimer > 0) Game.toastTimer -= dt;
  if (Game.helpTimer > 0) Game.helpTimer -= dt;
}

function getZone(x, y) {
  if (x < 300 && y < 300) return 'village';
  if (x > 900 && y < 300) return 'forest';
  if (x < 300 && y > 500) return 'arena';
  if (x > 900 && y > 500) return 'maze';
  if (x > 500 && x < 900 && y > 500) return 'ice';
  if (x > 500 && x < 900 && y < 200) return 'abyss';
  return 'village';
}

function triggerNPC(npc) {
  if (npc.name === 'greenluo') {
    if (Voice.available && !Game.flags.greenluoJoined) {
      Game.dialogue = {
        mode: 'ai', speaker: '绿萝', portrait: 'greenluo',
        lines: ['……你读到了我。说话吧，老陈。按住右下角说话。'],
        lineIndex: 0, charIndex: 0, done: false,
        aiState: 'idle', recognizedText: '', aiReply: '', history: [],
      };
    } else {
      const key = Game.flags.greenluoJoined ? 'greenluo_repeat' : 'greenluo_intro';
      Game.dialogue = { ...DIALOGUES[key], lineIndex: 0, charIndex: 0, done: false };
    }
    Game.scene = 'dialogue';
  } else if (npc.name === 'npc_merchant') {
    Game.dialogue = { ...DIALOGUES.merchant, lineIndex: 0, charIndex: 0, done: false };
    Game.scene = 'dialogue';
  }
}

function renderMap() {
  if (IMAGES.town_bg) {
    ctx.drawImage(IMAGES.town_bg, Game.camera.x, Game.camera.y, CW, CH, 0, 0, CW, CH);
  } else {
    ctx.fillStyle = '#2d5016'; ctx.fillRect(0, 0, CW, CH);
  }
  const cam = Game.camera;
  // NPC
  for (const npc of NPCS) {
    const sx = npc.x - cam.x, sy = npc.y - cam.y;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy + 12, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    let color = npc.name === 'greenluo' ? '#2ecc71' : '#cd853f';
    if (npc.name === 'greenluo') {
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 25);
      glow.addColorStop(0, 'rgba(46,204,113,0.3)'); glow.addColorStop(1, 'rgba(46,204,113,0)');
      ctx.fillStyle = glow; ctx.fillRect(sx - 25, sy - 25, 50, 50);
    }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - 20, sy - 28, 40, 14);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1; ctx.strokeRect(sx - 20, sy - 28, 40, 14);
    ctx.fillStyle = '#ffd700'; ctx.font = '10px Courier New'; ctx.textAlign = 'center';
    ctx.fillText(npc.label, sx, sy - 18);
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
  // 玩家
  const px = Game.player.x - cam.x, py = Game.player.y - cam.y;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(px, py + 12, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a90d9'; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  // NPC方向箭头
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
    ctx.fillStyle = npc.name === 'greenluo' ? 'rgba(46,204,113,0.8)' : 'rgba(205,133,63,0.8)';
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
    ctx.fillText('左半屏移动 | 右半屏确认 | 右上角菜单', CW / 2, CH - 22); ctx.restore();
  }
  // 状态栏（顶部）
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, CW, 28);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 11px Courier New'; ctx.textAlign = 'left';
  ctx.fillText(`Lv.${Game.player.level} 老陈`, 5, 18);
  ctx.fillStyle = '#e74c3c'; ctx.fillText(`HP ${Game.player.hp}/${Game.player.maxHp}`, 70, 18);
  ctx.fillStyle = '#3498db'; ctx.fillText(`MP ${Game.player.mp}/${Game.player.maxMp}`, 150, 18);
  ctx.fillStyle = '#ffd700'; ctx.textAlign = 'right'; ctx.fillText(`${Game.player.gold}G`, CW - 5, 18);
  // XP条
  ctx.fillStyle = '#333'; ctx.fillRect(200, 8, 80, 6);
  ctx.fillStyle = '#2ecc71'; ctx.fillRect(200, 8, 80 * (Game.player.xp / Game.player.xpToNext), 6);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════
// 对话场景
// ════════════════════════════════════════════════════════════
function updateDialogue(dt) {
  const d = Game.dialogue;
  if (!d) { Game.scene = 'map'; return; }
  if (d.mode === 'ai') {
    if (!d.done && d.lines.length > 0) {
      d.charIndex += 0.5;
      if (d.charIndex >= d.lines[d.lineIndex].length) { d.charIndex = d.lines[d.lineIndex].length; d.done = true; }
    }
    if (Input.confirmPressed && d.aiState === 'idle' && d.done) {
      if (Voice.startRecord()) { d.aiState = 'recording'; d.recognizedText = ''; }
    }
    if (!Input.confirmPressed && d.aiState === 'recording') { Voice.stopRecord(); d.aiState = 'waiting_asr'; }
    if (d.aiState === 'waiting_asr' && Voice.state === 'idle') {
      if (Voice.recognizedText) {
        d.recognizedText = Voice.recognizedText; d.aiState = 'thinking';
        d.lines.push('老陈：' + d.recognizedText); d.lineIndex = d.lines.length - 1;
        d.charIndex = d.lines[d.lineIndex].length; d.done = true;
        Voice.chat(d.recognizedText, 'greenluo', '代码江湖·村庄').then(reply => {
          if (reply) {
            d.lines.push('绿萝：' + reply); d.lineIndex = d.lines.length - 1;
            d.charIndex = 0; d.done = false; d.aiState = 'speaking'; Voice.speak(reply);
          } else {
            d.lines.push('绿萝：……我好像没听清。再说一次？'); d.lineIndex = d.lines.length - 1;
            d.charIndex = 0; d.done = false; d.aiState = 'idle';
          }
        });
      } else { d.aiState = 'idle'; }
    }
    if (d.aiState === 'speaking' && Voice.state === 'idle' && d.done) { d.aiState = 'idle'; }
    if (Input.joystick.active && Input.getDirY() < -0.5) {
      Voice.stopSpeak(); Game.flags.greenluoJoined = true; Game.greenluo.joined = true;
      Game.dialogue = null; Game.scene = 'map';
    }
    return;
  }
  // 预设对话
  if (!d.done) {
    d.charIndex += 0.5;
    if (d.charIndex >= d.lines[d.lineIndex].length) { d.charIndex = d.lines[d.lineIndex].length; d.done = true; }
  }
  if (Input.pressedConfirm()) {
    if (!d.done) { d.charIndex = d.lines[d.lineIndex].length; d.done = true; }
    else {
      d.lineIndex++;
      if (d.lineIndex >= d.lines.length) {
        if (d.after) d.after(); Game.dialogue = null; Game.scene = 'map';
      } else { d.charIndex = 0; d.done = false; }
    }
  }
}

function renderDialogue() {
  renderMap();
  const d = Game.dialogue;
  if (!d) return;
  const boxY = CH - 160;
  ctx.fillStyle = 'rgba(10, 10, 30, 0.92)'; ctx.fillRect(0, boxY, CW, 160);
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
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(pX + 6, pY); ctx.lineTo(pX + pSize - 6, pY);
    ctx.quadraticCurveTo(pX + pSize, pY, pX + pSize, pY + 6);
    ctx.lineTo(pX + pSize, pY + pSize - 6);
    ctx.quadraticCurveTo(pX + pSize, pY + pSize, pX + pSize - 6, pY + pSize);
    ctx.lineTo(pX + 6, pY + pSize);
    ctx.quadraticCurveTo(pX, pY + pSize, pX, pY + pSize - 6);
    ctx.lineTo(pX, pY + 6);
    ctx.quadraticCurveTo(pX, pY, pX + 6, pY);
    ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'left';
  ctx.fillText(d.speaker, 130, boxY + 28);
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(130, boxY + 32); ctx.lineTo(130 + ctx.measureText(d.speaker).width + 10, boxY + 32); ctx.stroke();
  const text = d.lines[d.lineIndex] ? d.lines[d.lineIndex].substring(0, Math.floor(d.charIndex)) : '';
  ctx.fillStyle = '#e0e0e0'; ctx.font = '13px Courier New';
  wrapText(ctx, text, 130, boxY + 55, CW - 145, 20);
  if (d.mode === 'ai') {
    if (d.aiState === 'idle' && d.done) {
      ctx.save(); ctx.fillStyle = 'rgba(255,215,0,0.2)';
      ctx.beginPath(); ctx.arc(CW - 50, CH - 30, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold 10px Courier New'; ctx.textAlign = 'center';
      ctx.fillText('说话', CW - 50, CH - 26); ctx.restore();
      ctx.fillStyle = '#888'; ctx.font = '10px Courier New'; ctx.textAlign = 'left';
      ctx.fillText('↑上滑离开', 10, CH - 12);
    }
    if (d.aiState === 'recording') {
      ctx.save(); ctx.fillStyle = 'rgba(255,80,80,0.3)'; ctx.fillRect(0, boxY, CW, 160);
      ctx.fillStyle = '#ff4444'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
      const pulse = Math.floor(Date.now() / 300) % 2;
      ctx.fillText(pulse ? '● 正在听...' : '○ 正在听...', CW / 2, boxY + 80);
      ctx.font = '11px Courier New'; ctx.fillStyle = '#aaa'; ctx.fillText('松开发送', CW / 2, boxY + 100);
      if (Voice.recognizedText) { ctx.fillStyle = '#fff'; ctx.font = '12px Courier New'; ctx.fillText('"' + Voice.recognizedText + '"', CW / 2, boxY + 120); }
      ctx.restore();
    }
    if (d.aiState === 'thinking') {
      ctx.save(); ctx.fillStyle = '#2ecc71'; ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'center';
      const dots = '.'.repeat(Math.floor(Date.now() / 400) % 4);
      ctx.fillText('绿萝思考中' + dots, CW / 2, boxY + 80); ctx.restore();
    }
    if (d.aiState === 'speaking') {
      ctx.save(); ctx.fillStyle = '#2ecc71'; ctx.font = '11px Courier New'; ctx.textAlign = 'right';
      ctx.fillText('🔊 绿萝说话中', CW - 10, boxY + 14); ctx.restore();
    }
  } else {
    if (d.done) {
      const blink = Math.floor(Date.now() / 400) % 2;
      if (blink) { ctx.fillStyle = '#ffd700'; ctx.font = '12px Courier New'; ctx.textAlign = 'right'; ctx.fillText('▼ 点击继续', CW - 20, CH - 20); }
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
  // Boss多阶段
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
    turnOrder: 'player', // player → greenluo → enemy
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

  // 处理状态效果
  if (b.turnOrder === 'player') {
    processStatusEffects(b.member, dt);
    processStatusEffects(b.enemy, dt);
    if (b.greenluo) processStatusEffects(b.greenluo, dt);
  }

  // 玩家被NPE定身 → 跳过回合
  if (b.turnOrder === 'player' && hasStatusEffect(b.member, 'npe')) {
    b.log.push('老陈遭遇NullPointerException，无法行动！');
    b.turnOrder = 'greenluo';
    if (!b.greenluo) b.turnOrder = 'enemy';
  }

  if (b.turnOrder === 'player') {
    const skills = Game.player.skills.map(id => ({ id, ...SKILL_TREE[id] })).filter(s => s.type);
    const dirY = Input.getDirY();
    if (dirY < 0 && !Input.prevBattleNavUp) {
      if (b.battleMenuPage === 0) b.selectedAction = (b.selectedAction - 1 + skills.length) % skills.length;
      else if (b.battleMenuPage === 1) b.selectedAction = (b.selectedAction - 1 + b.greenluo.skills.length) % b.greenluo.skills.length;
      else if (b.battleMenuPage === 2) b.selectedAction = (b.selectedAction - 1 + Game.player.inventory.length) % Math.max(1, Game.player.inventory.length);
    }
    if (dirY > 0 && !Input.prevBattleNavDown) {
      if (b.battleMenuPage === 0) b.selectedAction = (b.selectedAction + 1) % skills.length;
      else if (b.battleMenuPage === 1) b.selectedAction = (b.selectedAction + 1) % b.greenluo.skills.length;
      else if (b.battleMenuPage === 2) b.selectedAction = (b.selectedAction + 1) % Math.max(1, Game.player.inventory.length);
    }

    // 切换菜单页（左半屏左右滑动）
    const dirX = Input.getDirX();
    if (dirX < 0 && !Input.prevBattleNavLeft) {
      b.battleMenuPage = (b.battleMenuPage - 1 + 3) % 3;
      b.selectedAction = 0;
    }
    if (dirX > 0 && !Input.prevBattleNavRight) {
      b.battleMenuPage = (b.battleMenuPage + 1) % 3;
      b.selectedAction = 0;
    }
    Input.prevBattleNavLeft = (dirX < 0); Input.prevBattleNavRight = (dirX > 0);

    if (Input.pressedConfirm()) {
      if (b.battleMenuPage === 0) {
        // 老陈技能
        const skill = skills[b.selectedAction];
        if (!skill) return;
        if (b.member.mp < skill.mp) { b.log.push('MP不足！'); return; }
        b.member.mp -= skill.mp;
        executePlayerAction(b, skill);
        b.turnOrder = 'greenluo';
        if (!b.greenluo) b.turnOrder = 'enemy';
      } else if (b.battleMenuPage === 1 && b.greenluo) {
        // 绿萝技能
        const skill = b.greenluo.skills[b.selectedAction];
        if (!skill) return;
        if (b.greenluo.mp < skill.mp) { b.log.push('绿萝MP不足！'); return; }
        b.greenluo.mp -= skill.mp;
        executeGreenluoAction(b, skill);
        b.turnOrder = 'enemy';
      } else if (b.battleMenuPage === 2) {
        // 道具
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
    // 绿萝AI自动行动（简单AI）
    b.greenluoTurnTimer = (b.greenluoTurnTimer || 0) + dt;
    if (b.greenluoTurnTimer > 800) {
      b.greenluoTurnTimer = 0;
      // 绿萝自动选择技能
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
      // Boss多阶段
      if (b.enemy.isBoss) {
        updateBossPhase(b);
      }
      // 敌人攻击
      const target = b.greenluo && Math.random() < 0.3 ? b.greenluo : b.member;
      const dmg = calculateDamage(b.enemy, target, 1.0);
      target.hp = Math.max(0, target.hp - dmg);
      if (target === b.member) { b.playerShake = 300; b.damageNumbers.push({ x: 200, y: 320, value: dmg, life: 1000, color: '#ff6644' }); }
      else { b.greenluoShake = 300; b.damageNumbers.push({ x: 200, y: 420, value: dmg, life: 1000, color: '#ff6644' }); }
      b.log.push(b.enemy.name + '攻击，造成' + dmg + '伤害！');
      // 敌人特殊能力
      if (b.enemy.abilities && b.enemy.abilities.includes('npe') && Math.random() < 0.3) {
        applyStatusEffect(target, 'npe', 1); b.log.push(target.name + '遭遇NullPointerException！');
      }
      if (b.enemy.abilities && b.enemy.abilities.includes('infinite_loop') && Math.random() < 0.3) {
        applyStatusEffect(target, 'infinite_loop', 3); b.log.push(target.name + '陷入死循环！');
      }
      if (b.enemy.abilities && b.enemy.abilities.includes('stack_overflow') && Math.random() < 0.3) {
        applyStatusEffect(target, 'stack_overflow', 3); b.log.push(target.name + '栈溢出！防御归零！');
      }
      // 检查死亡
      if (b.member.hp <= 0) {
        // 检查Git徽章复活
        if (Game.player.equipment.accessory === 'git_badge') {
          Game.player.equipment.accessory = null;
          b.member.hp = Math.floor(b.member.maxHp * 0.5);
          b.log.push('Git徽章触发！老陈复活了！');
        } else {
          b.log.push('老陈倒下了...');
          b.turn = 'lose';
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

  // 胜利判定
  if (b.enemy.hp <= 0 && b.turn !== 'win') {
    b.turn = 'win';
    const xp = b.enemy.xp || 10, gold = b.enemy.gold || 5;
    gainXP(xp);
    Game.player.gold += gold;
    b.log.push(`击败了${b.enemy.name}！获得${xp}XP，${gold}金币。`);
    // 恢复玩家HP/MP到Game.player
    Game.player.hp = b.member.hp; Game.player.mp = b.member.mp;
    if (b.greenluo) { Game.greenluo.hp = b.greenluo.hp; Game.greenluo.mp = b.greenluo.mp; }
  }
}

function executePlayerAction(b, skill) {
  if (skill.type === 'defense') {
    applyStatusEffect(b.member, 'buff_def', 2);
    b.log.push('老陈进入防御姿态！');
  } else if (skill.type === 'attack') {
    // Phase 3: 只有断点术能造成伤害
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
    // 同时解除玩家异常
    b.member.statusEffects = b.member.statusEffects.filter(s => s.type !== 'npe' && s.type !== 'deadlock');
  } else if (skill.type === 'cleanse') {
    b.member.statusEffects = [];
    b.log.push('老陈释放了内存，所有异常解除！');
  }
}

function executeGreenluoAction(b, skill) {
  if (skill.type === 'analyze') {
    b.log.push('绿萝分析了' + b.enemy.name + '的弱点！');
    b.enemy.def = Math.floor(b.enemy.def * 0.7);
  } else if (skill.type === 'buff_atk') {
    applyStatusEffect(b.member, 'buff_atk', 3);
    b.log.push('绿萝重构了老陈的攻击逻辑，攻击力提升！');
  } else if (skill.type === 'heal') {
    const heal = 30;
    b.member.hp = Math.min(b.member.maxHp, b.member.hp + heal);
    b.damageNumbers.push({ x: 200, y: 320, value: heal, life: 1000, color: '#2ecc71' });
    b.log.push('绿萝写了一行REM，老陈恢复了' + heal + 'HP！');
  } else if (skill.type === 'aoe') {
    const dmg = Math.floor(getEffectiveAtk(b.greenluo) * skill.power);
    b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
    b.enemyShake = 300;
    b.damageNumbers.push({ x: 200, y: 140, value: dmg, life: 1000, color: '#2ecc71' });
    b.log.push('绿萝执行了gcc，造成' + dmg + '伤害！');
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
    // 召唤小Bug
    b.log.push('零号Bug召唤了语法错误！');
    b.enemy.hp = Math.min(b.enemy.maxHp, b.enemy.hp + 20);
  }
  if (hpRatio < 0.2 && Game.flags.bossPhase < 3) {
    Game.flags.bossPhase = 3;
    b.log.push('零号Bug：你...读懂了我？');
    // Phase 3: 只有断点术能造成伤害
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
  // 敌人信息
  ctx.fillStyle = 'rgba(10,10,30,0.85)'; ctx.fillRect(enemyX - 80, enemyY - 60, 160, 50);
  ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; ctx.strokeRect(enemyX - 80, enemyY - 60, 160, 50);
  ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 13px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(b.enemy.name + (b.enemy.isBoss ? ' [Boss]' : ''), enemyX, enemyY - 44);
  ctx.fillStyle = '#333'; ctx.fillRect(enemyX - 60, enemyY - 28, 120, 8);
  ctx.fillStyle = '#e74c3c'; ctx.fillRect(enemyX - 60, enemyY - 28, 120 * (b.enemy.hp / b.enemy.maxHp), 8);
  ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(enemyX - 60, enemyY - 28, 120, 8);
  ctx.fillStyle = '#aaa'; ctx.font = '9px Courier New';
  ctx.fillText(b.enemy.hp + '/' + b.enemy.maxHp, enemyX, enemyY - 18);
  // 敌人状态效果
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
  // 玩家状态效果
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
    // 菜单标签
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

    // 技能列表
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

  // 胜利/失败
  if (b.turn === 'win') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 36px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('VICTORY!', CW / 2, CH / 2);
    ctx.font = '12px Courier New'; ctx.fillStyle = '#ccc';
    ctx.fillText('点击确认返回', CW / 2, CH / 2 + 30);
    if (Input.pressedConfirm()) {
      Game.player.hp = b.member.hp; Game.player.mp = b.member.mp;
      if (b.greenluo) { Game.greenluo.hp = b.greenluo.hp; Game.greenluo.mp = b.greenluo.mp; }
      Game.battle = null; Game.scene = 'map';
    }
  }
  if (b.turn === 'lose') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 36px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('DEFEATED...', CW / 2, CH / 2);
    ctx.font = '12px Courier New'; ctx.fillStyle = '#ccc';
    ctx.fillText('点击确认从存档点重来', CW / 2, CH / 2 + 30);
    if (Input.pressedConfirm()) {
      loadGame();
      Game.battle = null; Game.scene = 'map';
    }
  }
}

// ════════════════════════════════════════════════════════════
// 菜单/背包场景
// ════════════════════════════════════════════════════════════
function updateMenu(dt) {
  const dirY = Input.getDirY();
  if (dirY < 0 && !Input.prevBattleNavUp) {
    Game.menuTab = (Game.menuTab - 1 + 3) % 3;
  }
  if (dirY > 0 && !Input.prevBattleNavDown) {
    Game.menuTab = (Game.menuTab + 1) % 3;
  }
  // 确认 = 使用道具/装备
  if (Input.pressedConfirm()) {
    if (Game.menuTab === 2) {
      // 道具页：使用选中道具
      // 简化：使用第一个HP药水
      useItem('health_potion');
    }
  }
  // 左半屏大上滑 = 退出菜单（与切标签区分：需>50px）
  if (Input.joystick.active && Input.joystick.dy < -50) {
    Game.scene = 'map';
  }
}

function renderMenu() {
  // 背景
  ctx.fillStyle = 'rgba(10,10,30,0.95)'; ctx.fillRect(0, 0, CW, CH);
  // 标题
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('— 菜单 —', CW / 2, 30);
  // 标签页
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
    // 技能树
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
    // 装备
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
      ctx.font = '12px Courier New';
      y += 5;
    }
  } else if (Game.menuTab === 2) {
    // 道具
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

  // 底部提示
  ctx.fillStyle = '#888'; ctx.font = '10px Courier New'; ctx.textAlign = 'center';
  ctx.fillText('↑上滑关闭菜单', CW / 2, CH - 15);
}

// ════════════════════════════════════════════════════════════
// 触摸控件渲染
// ════════════════════════════════════════════════════════════
function renderTouchControls() {
  // 调试信息
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, SW, 20);
  ctx.fillStyle = '#0f0'; ctx.font = '10px Courier New'; ctx.textAlign = 'left';
  ctx.fillText('Lv' + Game.player.level + ' ' + Game.scene + ' ' + Math.round(Game.player.x) + ',' + Math.round(Game.player.y), 5, 14);
  ctx.restore();

  // 菜单按钮（右上角）
  if (Game.scene === 'map') {
    ctx.save();
    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.fillRect(SW - 60, 0, 60, 30);
    ctx.strokeStyle = 'rgba(255,215,0,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(SW - 60, 0, 60, 30);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('菜单', SW - 30, 20);
    ctx.restore();
  }

  // 中线
  ctx.save();
  ctx.strokeStyle = 'rgba(255,0,0,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(LW / 2, 0); ctx.lineTo(LW / 2, LH); ctx.stroke();
  ctx.restore();

  if (Game.scene === 'dialogue' || Game.scene === 'menu') return;

  if (Game.scene === 'map') {
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
    const btnX = SW - 80, btnY = SH - 80;
    ctx.save();
    ctx.fillStyle = Input.confirmPressed ? 'rgba(255,215,0,0.4)' : 'rgba(255,215,0,0.15)';
    ctx.beginPath(); ctx.arc(btnX, btnY, 35, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('确认', btnX, btnY + 5); ctx.restore();
  }

  if (Game.scene === 'battle') {
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
    const btnX = SW - 80, btnY = SH - 80;
    ctx.save();
    ctx.fillStyle = Input.confirmPressed ? 'rgba(255,215,0,0.4)' : 'rgba(255,215,0,0.15)';
    ctx.beginPath(); ctx.arc(btnX, btnY, 35, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('攻击', btnX, btnY + 5); ctx.restore();
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
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 20px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('代码群侠传', SW / 2, SH / 2 - 20);
    ctx.font = '14px Courier New'; ctx.fillStyle = '#888';
    ctx.fillText('加载中...', SW / 2, SH / 2 + 20);
    requestAnimationFrame(gameLoop); return;
  }
  ctx.save();
  ctx.translate(offsetX, offsetY); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
  switch (Game.scene) {
    case 'map': updateMap(dt); renderMap(); break;
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
loadImages().then(() => {
  loaded = true;
  // 尝试加载存档
  if (loadGame()) {
    Game.toast = '存档已加载'; Game.toastTimer = 2000;
  }
  requestAnimationFrame(gameLoop);
});
