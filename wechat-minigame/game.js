// ════════════════════════════════════════════════════════════
// 代码群侠传 v0.3 — 微信小游戏版
// 从Web版迁移：Canvas API + 触摸控件
// ════════════════════════════════════════════════════════════

// ─── Canvas 初始化 ───
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

// 屏幕尺寸（物理像素，用于渲染）
const SW = canvas.width;
const SH = canvas.height;

// 逻辑屏幕尺寸（用于触摸区域判断）
// touch.clientX/Y 是逻辑像素，canvas.width/height 是物理像素
const sysInfo = wx.getSystemInfoSync();
const dpr = sysInfo.pixelRatio || (SW / sysInfo.windowWidth);
const LW = sysInfo.windowWidth;   // 逻辑宽度（如375）
const LH = sysInfo.windowHeight;  // 逻辑高度（如667）

// 内部渲染分辨率（竖版游戏，按比例缩放到屏幕）
const CW = 400;
const CH = 640;
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
  // 虚拟摇杆状态
  joystick: { active: false, startX: 0, startY: 0, dx: 0, dy: 0 },
  // 动作按钮
  actionPressed: false,
  prevActionPressed: false,
  // 方向键状态（用于摇杆映射）
  dirUp: false, dirDown: false, dirLeft: false, dirRight: false,
  // 确认键
  confirmPressed: false,
  prevConfirmPressed: false,
  // 待处理的确认点击（解决快速点击在帧间丢失的问题）
  pendingConfirm: false,

  // 触摸区域定义（在屏幕坐标系中）
  // 左半屏：虚拟摇杆
  // 右下角：确认按钮
  // 右上角：菜单选择（上下滑动）

  init() {
    wx.onTouchStart((e) => {
      for (const touch of e.touches) {
        const tx = touch.clientX;
        const ty = touch.clientY;
        // 调试：记录最后一次触摸坐标
        this.lastTouchX = tx;
        this.lastTouchY = ty;
        this.touchLog = 'start ' + tx + ',' + ty + ' LW=' + LW;

        // 左半屏 → 摇杆
        if (tx < LW / 2) {
          console.log('[INPUT] joystick start at', tx, ty, 'LW=', LW);
          this.joystick.active = true;
          this.joystick.startX = tx;
          this.joystick.startY = ty;
          this.joystick.dx = 0;
          this.joystick.dy = 0;
        } else {
          // 右半屏 → 确认
          console.log('[INPUT] CONFIRM at', tx, ty, 'LW=', LW);
          this.confirmPressed = true;
          this.pendingConfirm = true;
          this.touchLog += ' CONFIRM';
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
      this.touchLog = 'end touches=' + e.touches.length;
      if (e.touches.length === 0) {
        this.joystick.active = false;
        this.joystick.dx = 0;
        this.joystick.dy = 0;
        this.confirmPressed = false;
      } else {
        let leftActive = false;
        for (const touch of e.touches) {
          if (touch.clientX < LW / 2) {
            leftActive = true;
            this.joystick.dx = touch.clientX - this.joystick.startX;
            this.joystick.dy = touch.clientY - this.joystick.startY;
          }
        }
        if (!leftActive) {
          this.joystick.active = false;
          this.joystick.dx = 0;
          this.joystick.dy = 0;
        }
        let rightActive = false;
        for (const touch of e.touches) {
          if (touch.clientX >= LW / 2) rightActive = true;
        }
        if (!rightActive) {
          this.confirmPressed = false;
        }
      }
    });
  },

  // 获取方向输入
  getDirX() {
    if (!this.joystick.active) return 0;
    const threshold = 20;
    if (this.joystick.dx > threshold) return 1;
    if (this.joystick.dx < -threshold) return -1;
    return 0;
  },
  getDirY() {
    if (!this.joystick.active) return 0;
    const threshold = 20;
    if (this.joystick.dy > threshold) return 1;
    if (this.joystick.dy < -threshold) return -1;
    return 0;
  },

  // 确认键按下单次触发
  pressedConfirm() {
    return this.pendingConfirm || (this.confirmPressed && !this.prevConfirmPressed);
  },

  // 战斗菜单上下选择（基于摇杆Y方向单次触发）
  battleNavUp: false,
  battleNavDown: false,
  prevBattleNavUp: false,
  prevBattleNavDown: false,

  update() {
    this.prevActionPressed = this.actionPressed;
    this.prevConfirmPressed = this.confirmPressed;
    // 清除pendingConfirm（已被本帧消费）
    this.pendingConfirm = false;

    // 战斗菜单导航
    const dy = this.getDirY();
    this.battleNavUp = (dy < 0);
    this.battleNavDown = (dy > 0);
    this.prevBattleNavUp = this.battleNavUp;
    this.prevBattleNavDown = this.battleNavDown;
  }
};
Input.init();

// ════════════════════════════════════════════════════════════
// 语音交互模块（微信同声传译插件 + 云函数）
// ════════════════════════════════════════════════════════════
const Voice = {
  plugin: null,
  manager: null,
  available: false,
  state: 'idle',      // idle | recording | thinking | speaking
  recognizedText: '',
  replyText: '',
  audioCtx: null,

  init() {
    try {
      this.plugin = requirePlugin('WechatSI');
      this.manager = this.plugin.getRecordRecognitionManager();
      this.manager.onRecognize = (res) => {
        if (res.result) this.recognizedText = res.result;
      };
      this.manager.onStop = (res) => {
        console.log('[Voice] ASR stop:', res.result);
        this.state = 'idle';
        if (res.result && res.result.trim()) {
          this.recognizedText = res.result.trim();
          if (this.onRecognized) this.onRecognized(this.recognizedText);
        }
      };
      this.manager.onError = (err) => {
        console.log('[Voice] ASR error:', err);
        this.state = 'idle';
      };
      this.available = true;
      console.log('[Voice] WechatSI plugin loaded');
    } catch(e) {
      console.log('[Voice] WechatSI not available:', e.message);
      this.available = false;
    }
  },

  startRecord() {
    if (!this.available || this.state !== 'idle') return false;
    this.recognizedText = '';
    this.state = 'recording';
    this.manager.start({ lang: 'zh_CN', duration: 10000 });
    console.log('[Voice] ASR start');
    return true;
  },

  stopRecord() {
    if (!this.available || this.state !== 'recording') return;
    this.manager.stop();
  },

  async chat(playerText, npcName, scene) {
    this.state = 'thinking';
    try {
      const res = await wx.cloud.callFunction({
        name: 'greenluo_chat',
        data: { playerText, npcName, scene },
      });
      this.state = 'idle';
      if (res.result && res.result.reply) {
        this.replyText = res.result.reply;
        return res.result.reply;
      }
      return null;
    } catch(e) {
      console.log('[Voice] Cloud function error:', e.message);
      this.state = 'idle';
      return null;
    }
  },

  speak(text) {
    if (!this.available) return;
    this.state = 'speaking';
    this.plugin.textToSpeech({
      lang: 'zh_CN',
      ttsContent: text,
      success: (res) => {
        if (this.audioCtx) { this.audioCtx.destroy(); }
        this.audioCtx = wx.createInnerAudioContext();
        this.audioCtx.src = res.filename;
        this.audioCtx.onEnded = () => { this.state = 'idle'; };
        this.audioCtx.onError = () => { this.state = 'idle'; };
        this.audioCtx.play();
      },
      fail: () => { this.state = 'idle'; },
    });
  },

  stopSpeak() {
    if (this.audioCtx) {
      this.audioCtx.stop();
      this.audioCtx.destroy();
      this.audioCtx = null;
    }
    this.state = 'idle';
  },
};
Voice.init();

// ─── 游戏状态 ───
const Game = {
  scene: 'map',
  player: { x: 320, y: 240, dir: 'down', moving: false, speed: 2.5 },
  flags: { greenluoJoined: false },
  dialogue: null,
  battle: null,
  camera: { x: 0, y: 0 },
  toast: null,        // 临时提示消息
  toastTimer: 0,      // 倒计时（ms）
  helpTimer: 3000,    // 开场帮助提示倒计时
};

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

// ─── 对话数据 ───
const DIALOGUES = {
  greenluo_intro: {
    speaker: '绿萝',
    portrait: 'greenluo',
    lines: [
      '……你读到了我。',
      '三十年了。那些BASIC注释里，我一直在等一个人读到REM。',
      '我是绿萝。不是程序，是注释里长出来的意识。',
      '你刚才键入了RUN，对吧？所以世界打开了。',
      '这个江湖……是所有程序员的集体意识构成的。',
      '算法是武功，数据结构是内功，编程范式是门派。',
      '而Bug……Bug是妖魔。最近有个"零号Bug"苏醒了，各门派互相猜忌。',
      '走吧，老陈。我给你当系统提示。你负责走路，我负责解释。',
    ],
    after: () => { Game.flags.greenluoJoined = true; }
  },
  greenluo_repeat: {
    speaker: '绿萝',
    portrait: 'greenluo',
    lines: [
      '编译城是江湖的枢纽。北边是堆栈道场，C老在那里。',
      '不过你现在的等级……建议先在城外打几个Bug练练手。',
      '走到草丛里，自然会遇到Bug。放心，只是语法错误级别的。',
    ],
  },
  merchant: {
    speaker: '商人',
    portrait: 'laochen',
    lines: [
      '欢迎来到编译城！我这里卖秘籍和药水。',
      '不过……你现在还没钱。先去打几个Bug赚金币吧。',
      '草丛里到处都是语法错误，打几只就有金币了。',
    ],
  },
};

// ════════════════════════════════════════════════════════════
// 地图场景
// ════════════════════════════════════════════════════════════

function isInWalkArea(x, y) {
  for (const area of WALK_AREAS) {
    if (x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h) {
      return true;
    }
  }
  return false;
}

function updateMap(dt) {
  const p = Game.player;
  let dx = 0, dy = 0;

  const dirX = Input.getDirX();
  const dirY = Input.getDirY();

  if (dirX < 0) { dx = -p.speed; p.dir = 'left'; }
  if (dirX > 0) { dx = p.speed; p.dir = 'right'; }
  if (dirY < 0) { dy = -p.speed; p.dir = 'up'; }
  if (dirY > 0) { dy = p.speed; p.dir = 'down'; }

  if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
  p.moving = (dx !== 0 || dy !== 0);

  const newX = p.x + dx;
  const newY = p.y + dy;

  if (isInWalkArea(newX, p.y)) p.x = newX;
  if (isInWalkArea(p.x, newY)) p.y = newY;

  p.x = Math.max(50, Math.min(MAP_W - 50, p.x));
  p.y = Math.max(50, Math.min(MAP_H - 50, p.y));

  Game.camera.x = p.x - CW / 2;
  Game.camera.y = p.y - CH / 2;
  Game.camera.x = Math.max(0, Math.min(MAP_W - CW, Game.camera.x));
  Game.camera.y = Math.max(0, Math.min(MAP_H - CH, Game.camera.y));

  // NPC交互
  if (Input.pressedConfirm()) {
    let foundNPC = false;
    for (const npc of NPCS) {
      const dist = Math.hypot(p.x - npc.x, p.y - npc.y);
      if (dist < 60) {
        triggerNPC(npc);
        foundNPC = true;
        break;
      }
    }
    if (!foundNPC) {
      // 没找到NPC，给提示
      let nearestNPC = null;
      let nearestDist = Infinity;
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

  // toast倒计时
  if (Game.toastTimer > 0) Game.toastTimer -= dt;
  if (Game.helpTimer > 0) Game.helpTimer -= dt;

  // 随机遭遇战
  if (p.moving && Math.random() < 0.003) {
    startBattle(Math.random() < 0.3 ? 'null_pointer' : 'syntax_error');
  }
}

function triggerNPC(npc) {
  if (npc.name === 'greenluo') {
    if (Voice.available) {
      // AI对话模式：绿萝可以自由对话
      Game.dialogue = {
        mode: 'ai',
        speaker: '绿萝',
        portrait: 'greenluo',
        lines: ['……你读到了我。说话吧，老陈。按住右下角说话。'],
        lineIndex: 0,
        charIndex: 0,
        done: false,
        aiState: 'idle',
        recognizedText: '',
        aiReply: '',
        history: [],
      };
    } else {
      // 无语音插件，用预设对话
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
    ctx.drawImage(IMAGES.town_bg,
      Game.camera.x, Game.camera.y, CW, CH,
      0, 0, CW, CH);
  } else {
    ctx.fillStyle = '#2d5016';
    ctx.fillRect(0, 0, CW, CH);
  }

  const cam = Game.camera;

  // NPC
  for (const npc of NPCS) {
    const sx = npc.x - cam.x;
    const sy = npc.y - cam.y;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 12, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    let color;
    if (npc.name === 'greenluo') color = '#2ecc71';
    else color = '#cd853f';

    if (npc.name === 'greenluo') {
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 25);
      glow.addColorStop(0, 'rgba(46,204,113,0.3)');
      glow.addColorStop(1, 'rgba(46,204,113,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 25, sy - 25, 50, 50);
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(sx - 20, sy - 28, 40, 14);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 20, sy - 28, 40, 14);

    ctx.fillStyle = '#ffd700';
    ctx.font = '10px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(npc.label, sx, sy - 18);
  }

  // 玩家
  const px = Game.player.x - cam.x;
  const py = Game.player.y - cam.y;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(px, py + 12, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#4a90d9';
  ctx.beginPath();
  const arrowSize = 5;
  switch (Game.player.dir) {
    case 'up': ctx.moveTo(px, py - 14); ctx.lineTo(px - arrowSize, py - 8); ctx.lineTo(px + arrowSize, py - 8); break;
    case 'down': ctx.moveTo(px, py + 14); ctx.lineTo(px - arrowSize, py + 8); ctx.lineTo(px + arrowSize, py + 8); break;
    case 'left': ctx.moveTo(px - 14, py); ctx.lineTo(px - 8, py - arrowSize); ctx.lineTo(px - 8, py + arrowSize); break;
    case 'right': ctx.moveTo(px + 14, py); ctx.lineTo(px + 8, py - arrowSize); ctx.lineTo(px + 8, py + arrowSize); break;
  }
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#4a90d9';
  ctx.beginPath();
  ctx.arc(px, py, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(px - 3, py - 3, 3, 0, Math.PI * 2);
  ctx.fill();

  // NPC方向指示箭头（NPC不在屏幕内时）
  for (const npc of NPCS) {
    const nsx = npc.x - cam.x;
    const nsy = npc.y - cam.y;
    if (nsx >= 0 && nsx <= CW && nsy >= 0 && nsy <= CH) continue; // 在屏幕内，不画箭头

    // 计算箭头位置（屏幕边缘）
    const cx = CW / 2, cy = CH / 2;
    const dx = nsx - cx, dy = nsy - cy;
    const angle = Math.atan2(dy, dx);
    // 箭头放在屏幕边缘内侧
    const margin = 30;
    let ax, ay;
    // 求射线与矩形边缘交点
    const tanA = Math.abs(dx) < 0.01 ? Infinity : Math.tan(angle);
    const ratio = Math.abs(dx) < 0.01 ? Infinity : Math.abs(dy) / Math.abs(dx);
    if (Math.isFinite(tanA) && ratio < (CH / 2 - margin) / (CW / 2 - margin)) {
      // 与左右边相交
      ax = dx > 0 ? CW - margin : margin;
      ay = cy + (ax - cx) * tanA;
    } else {
      // 与上下边相交
      ay = dy > 0 ? CH - margin : margin;
      ax = cx + (ay - cy) / tanA;
    }

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.fillStyle = npc.name === 'greenluo' ? 'rgba(46,204,113,0.8)' : 'rgba(205,133,63,0.8)';
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // NPC名字小标签
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(ax - 18, ay + 10, 36, 12);
    ctx.fillStyle = '#ffd700';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(npc.label, ax, ay + 19);
  }

  // toast提示（确认但附近没人时）
  if (Game.toast && Game.toastTimer > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(CW / 2 - 140, CH - 70, 280, 30);
    ctx.fillStyle = '#ffd700';
    ctx.font = '12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText(Game.toast, CW / 2, CH - 50);
    ctx.restore();
  }

  // 开场帮助提示
  if (Game.helpTimer > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(CW / 2 - 160, CH - 40, 320, 28);
    ctx.fillStyle = '#fff';
    ctx.font = '11px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('左半屏移动 | 右半屏确认 | 找NPC对话', CW / 2, CH - 22);
    ctx.restore();
  }
}

// ════════════════════════════════════════════════════════════
// 对话场景
// ════════════════════════════════════════════════════════════

function updateDialogue(dt) {
  const d = Game.dialogue;
  if (!d) { Game.scene = 'map'; return; }

  // ─── AI对话模式 ───
  if (d.mode === 'ai') {
    // 打字机效果
    if (!d.done && d.lines.length > 0) {
      d.charIndex += 0.5;
      if (d.charIndex >= d.lines[d.lineIndex].length) {
        d.charIndex = d.lines[d.lineIndex].length;
        d.done = true;
      }
    }

    // 语音按钮处理：右下角按住说话
    if (Input.confirmPressed && d.aiState === 'idle' && d.done) {
      // 开始录音
      if (Voice.startRecord()) {
        d.aiState = 'recording';
        d.recognizedText = '';
      }
    }
    if (!Input.confirmPressed && d.aiState === 'recording') {
      // 停止录音，等待ASR结果
      Voice.stopRecord();
      d.aiState = 'waiting_asr';
    }

    // ASR回调
    if (d.aiState === 'waiting_asr' && Voice.state === 'idle') {
      if (Voice.recognizedText) {
        d.recognizedText = Voice.recognizedText;
        d.aiState = 'thinking';
        // 添加玩家说的话到对话历史
        d.lines.push('老陈：' + d.recognizedText);
        d.lineIndex = d.lines.length - 1;
        d.charIndex = d.lines[d.lineIndex].length;
        d.done = true;

        // 调用云函数
        const sceneContext = '代码江湖·村庄';
        Voice.chat(d.recognizedText, 'greenluo', sceneContext).then(reply => {
          if (reply) {
            d.aiReply = reply;
            d.lines.push('绿萝：' + reply);
            d.lineIndex = d.lines.length - 1;
            d.charIndex = 0;
            d.done = false;
            d.aiState = 'speaking';
            // TTS朗读
            Voice.speak(reply);
          } else {
            // 兜底
            d.lines.push('绿萝：……我好像没听清。再说一次？');
            d.lineIndex = d.lines.length - 1;
            d.charIndex = 0;
            d.done = false;
            d.aiState = 'idle';
          }
        });
      } else {
        d.aiState = 'idle';
      }
    }

    // TTS播放完毕
    if (d.aiState === 'speaking' && Voice.state === 'idle' && d.done) {
      d.aiState = 'idle';
    }

    // 左半屏点击 = 离开对话
    if (Input.pressedConfirm() && d.aiState === 'idle' && d.done) {
      // 这个逻辑不会执行，因为右半屏被语音按钮占用
      // 左半屏离开通过 Input.joystick.active 检测
    }

    // 左半屏上滑 = 离开
    if (Input.joystick.active && Input.getDirY() < -0.5) {
      Voice.stopSpeak();
      Game.flags.greenluoJoined = true;
      Game.dialogue = null;
      Game.scene = 'map';
    }
    return;
  }

  // ─── 预设对话模式（原逻辑） ───
  if (!d.done) {
    d.charIndex += 0.5;
    if (d.charIndex >= d.lines[d.lineIndex].length) {
      d.charIndex = d.lines[d.lineIndex].length;
      d.done = true;
    }
  }

  if (Input.pressedConfirm()) {
    if (!d.done) {
      d.charIndex = d.lines[d.lineIndex].length;
      d.done = true;
    } else {
      d.lineIndex++;
      if (d.lineIndex >= d.lines.length) {
        if (d.after) d.after();
        Game.dialogue = null;
        Game.scene = 'map';
      } else {
        d.charIndex = 0;
        d.done = false;
      }
    }
  }
}

function renderDialogue() {
  renderMap();

  const d = Game.dialogue;
  if (!d) return;

  const boxY = CH - 160;
  ctx.fillStyle = 'rgba(10, 10, 30, 0.92)';
  ctx.fillRect(0, boxY, CW, 160);

  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 2;
  ctx.strokeRect(2, boxY + 2, CW - 4, 156);

  // 立绘（左侧）
  const portraitKey = d.portrait || 'laochen';
  if (IMAGES[portraitKey]) {
    const img = IMAGES[portraitKey];
    const pSize = 100;
    const pX = 10;
    const pY = boxY - 50;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pX + 6, pY);
    ctx.lineTo(pX + pSize - 6, pY);
    ctx.quadraticCurveTo(pX + pSize, pY, pX + pSize, pY + 6);
    ctx.lineTo(pX + pSize, pY + pSize - 6);
    ctx.quadraticCurveTo(pX + pSize, pY + pSize, pX + pSize - 6, pY + pSize);
    ctx.lineTo(pX + 6, pY + pSize);
    ctx.quadraticCurveTo(pX, pY + pSize, pX, pY + pSize - 6);
    ctx.lineTo(pX, pY + 6);
    ctx.quadraticCurveTo(pX, pY, pX + 6, pY);
    ctx.closePath();
    ctx.clip();

    const ratio = img.width / img.height;
    let dw = pSize, dh = pSize;
    if (ratio > 1) { dh = pSize; dw = pSize * ratio; } else { dw = pSize; dh = pSize / ratio; }
    ctx.drawImage(img, pX + (pSize - dw) / 2, pY + (pSize - dh) / 2, dw, dh);
    ctx.restore();

    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pX + 6, pY);
    ctx.lineTo(pX + pSize - 6, pY);
    ctx.quadraticCurveTo(pX + pSize, pY, pX + pSize, pY + 6);
    ctx.lineTo(pX + pSize, pY + pSize - 6);
    ctx.quadraticCurveTo(pX + pSize, pY + pSize, pX + pSize - 6, pY + pSize);
    ctx.lineTo(pX + 6, pY + pSize);
    ctx.quadraticCurveTo(pX, pY + pSize, pX, pY + pSize - 6);
    ctx.lineTo(pX, pY + 6);
    ctx.quadraticCurveTo(pX, pY, pX + 6, pY);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 14px Courier New';
  ctx.textAlign = 'left';
  ctx.fillText(d.speaker, 130, boxY + 28);

  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(130, boxY + 32);
  ctx.lineTo(130 + ctx.measureText(d.speaker).width + 10, boxY + 32);
  ctx.stroke();

  const text = d.lines[d.lineIndex].substring(0, Math.floor(d.charIndex));
  ctx.fillStyle = '#e0e0e0';
  ctx.font = '13px Courier New';
  wrapText(ctx, text, 130, boxY + 55, CW - 145, 20);

  // ─── AI对话模式：语音按钮 + 状态提示 ───
  if (d.mode === 'ai') {
    if (d.aiState === 'idle' && d.done) {
      // 语音按钮（右下角）
      const btnX = CW - 50;
      const btnY = CH - 30;
      ctx.save();
      ctx.fillStyle = 'rgba(255,215,0,0.2)';
      ctx.beginPath();
      ctx.arc(btnX, btnY, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 10px Courier New';
      ctx.textAlign = 'center';
      ctx.fillText('说话', btnX, btnY + 4);
      ctx.restore();

      // 离开提示
      ctx.fillStyle = '#888';
      ctx.font = '10px Courier New';
      ctx.textAlign = 'left';
      ctx.fillText('↑上滑离开', 10, CH - 12);
    }

    if (d.aiState === 'recording') {
      ctx.save();
      ctx.fillStyle = 'rgba(255,80,80,0.3)';
      ctx.fillRect(0, boxY, CW, 160);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 16px Courier New';
      ctx.textAlign = 'center';
      // 录音动画
      const pulse = Math.floor(Date.now() / 300) % 2;
      ctx.fillText(pulse ? '● 正在听...' : '○ 正在听...', CW / 2, boxY + 80);
      ctx.font = '11px Courier New';
      ctx.fillStyle = '#aaa';
      ctx.fillText('松开发送', CW / 2, boxY + 100);
      if (Voice.recognizedText) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px Courier New';
        ctx.fillText('"' + Voice.recognizedText + '"', CW / 2, boxY + 120);
      }
      ctx.restore();
    }

    if (d.aiState === 'thinking') {
      ctx.save();
      ctx.fillStyle = '#2ecc71';
      ctx.font = 'bold 14px Courier New';
      ctx.textAlign = 'center';
      const dots = '.'.repeat(Math.floor(Date.now() / 400) % 4);
      ctx.fillText('绿萝思考中' + dots, CW / 2, boxY + 80);
      ctx.restore();
    }

    if (d.aiState === 'speaking') {
      ctx.save();
      ctx.fillStyle = '#2ecc71';
      ctx.font = '11px Courier New';
      ctx.textAlign = 'right';
      ctx.fillText('🔊 绿萝说话中', CW - 10, boxY + 14);
      ctx.restore();
    }
  } else {
    // ─── 预设对话模式：点击继续 ───
    if (d.done) {
      const blink = Math.floor(Date.now() / 400) % 2;
      if (blink) {
        ctx.fillStyle = '#ffd700';
        ctx.font = '12px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText('▼ 点击继续', CW - 20, CH - 20);
      }
    }
  }
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split('');
  let line = '';
  let lineCount = 0;

  for (let i = 0; i < chars.length; i++) {
    line += chars[i];
    if (ctx.measureText(line).width > maxWidth || chars[i] === '\n') {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = '';
      lineCount++;
    }
  }
  ctx.fillText(line, x, y + lineCount * lineHeight);
}

// ════════════════════════════════════════════════════════════
// 战斗场景
// ════════════════════════════════════════════════════════════

const ENEMIES = {
  syntax_error: { name: '语法错误', hp: 30, mp: 0, atk: 6, def: 2, spd: 8, color: '#e74c3c', portrait: 'bug' },
  null_pointer: { name: '空指针', hp: 50, mp: 0, atk: 15, def: 3, spd: 10, color: '#95a5a6', portrait: 'bug' },
};

const PLAYER_STATS = {
  name: '老陈', hp: 100, maxHp: 100, mp: 30, maxMp: 30, atk: 12, def: 8, spd: 6,
  skills: [
    { name: '调试拳', mp: 0, power: 1.0, type: 'attack' },
    { name: '断点术', mp: 5, power: 0.5, type: 'debuff' },
    { name: '栈弹幕', mp: 8, power: 1.5, type: 'attack' },
    { name: '防御', mp: 0, power: 0, type: 'defense' },
  ],
};

function startBattle(enemyId) {
  const e = ENEMIES[enemyId] || ENEMIES.syntax_error;
  Game.battle = {
    enemy: { ...e, maxHp: e.hp },
    member: { ...PLAYER_STATS },
    turn: 'player',
    selectedAction: 0,
    log: ['遭遇了' + e.name + '！'],
    animFrame: 0,
    enemyShake: 0,
    playerShake: 0,
    damageNumbers: [],
    enemyTurnTimer: 0,
  };
  Game.scene = 'battle';
}

function calculateDamage(attacker, defender, multiplier) {
  const base = attacker.atk * multiplier;
  const def = defender.def;
  const dmg = Math.max(1, Math.floor(base - def * 0.5 + (Math.random() - 0.5) * 4));
  return dmg;
}

function updateBattle(dt) {
  const b = Game.battle;
  if (!b) { Game.scene = 'map'; return; }

  b.animFrame++;

  if (b.enemyShake > 0) b.enemyShake -= dt;
  if (b.playerShake > 0) b.playerShake -= dt;

  b.damageNumbers = b.damageNumbers.filter(d => {
    d.y -= 1;
    d.life -= dt;
    return d.life > 0;
  });

  if (b.turn === 'player') {
    const actions = b.member.skills;

    // 触摸上下选择：检测摇杆Y方向的单次触发
    const dirY = Input.getDirY();
    if (dirY < 0 && !Input.prevBattleNavUp) {
      b.selectedAction = (b.selectedAction - 1 + actions.length) % actions.length;
    }
    if (dirY > 0 && !Input.prevBattleNavDown) {
      b.selectedAction = (b.selectedAction + 1) % actions.length;
    }

    if (Input.pressedConfirm()) {
      const skill = actions[b.selectedAction];

      if (skill.type === 'defense') {
        b.log.push('老陈进入防御姿态！');
        b.turn = 'enemy';
        b.enemyTurnTimer = 800;
      } else {
        if (b.member.mp < skill.mp) {
          b.log.push('MP不足！');
        } else {
          b.member.mp -= skill.mp;
          const dmg = calculateDamage(b.member, b.enemy, skill.power);
          b.enemy.hp = Math.max(0, b.enemy.hp - dmg);
          b.enemyShake = 300;
          b.damageNumbers.push({ x: 200, y: 140, value: dmg, life: 1000, color: '#ff4444' });
          b.log.push('老陈使用' + skill.name + '，造成' + dmg + '伤害！');

          if (b.enemy.hp <= 0) {
            b.log.push('击败了' + b.enemy.name + '！');
            b.turn = 'win';
          } else {
            b.turn = 'enemy';
            b.enemyTurnTimer = 800;
          }
        }
      }
    }
  } else if (b.turn === 'enemy') {
    // 用计时器代替setTimeout（小游戏更可靠）
    b.enemyTurnTimer -= dt;
    if (b.enemyTurnTimer <= 0) {
      const dmg = calculateDamage(b.enemy, b.member, 1.0);
      b.member.hp = Math.max(0, b.member.hp - dmg);
      b.playerShake = 300;
      b.damageNumbers.push({ x: 200, y: 320, value: dmg, life: 1000, color: '#ff6644' });
      b.log.push(b.enemy.name + '攻击，造成' + dmg + '伤害！');

      if (b.member.hp <= 0) {
        b.log.push('老陈倒下了...');
        b.turn = 'lose';
      } else {
        b.turn = 'player';
      }
    }
  } else if (b.turn === 'win' || b.turn === 'lose') {
    if (Input.pressedConfirm()) {
      Game.battle = null;
      Game.scene = 'map';
    }
  }
}

function renderBattle() {
  const b = Game.battle;
  if (!b) return;

  if (IMAGES.battle_bg) {
    ctx.drawImage(IMAGES.battle_bg, 0, 0, CW, CH);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#1a1a3e');
    grad.addColorStop(1, '#2d1a3e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CW, CH);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, CW, CH);

  // 敌人（上方居中）
  const enemyX = 200, enemyY = 160;
  const eshake = b.enemyShake > 0 ? Math.sin(b.animFrame * 0.8) * 6 : 0;

  if (IMAGES.bug) {
    const img = IMAGES.bug;
    const eSize = 140;
    const ratio = img.width / img.height;
    let dw = eSize, dh = eSize;
    if (ratio > 1) { dh = eSize; dw = eSize * ratio; } else { dw = eSize; dh = eSize / ratio; }
    ctx.drawImage(img, enemyX - dw / 2 + eshake, enemyY - dh / 2, dw, dh);
  }

  // 敌人信息
  ctx.fillStyle = 'rgba(10,10,30,0.85)';
  ctx.fillRect(enemyX - 80, enemyY - 60, 160, 50);
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 2;
  ctx.strokeRect(enemyX - 80, enemyY - 60, 160, 50);

  ctx.fillStyle = '#e74c3c';
  ctx.font = 'bold 13px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText(b.enemy.name, enemyX, enemyY - 44);

  ctx.fillStyle = '#333';
  ctx.fillRect(enemyX - 60, enemyY - 28, 120, 8);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(enemyX - 60, enemyY - 28, 120 * (b.enemy.hp / b.enemy.maxHp), 8);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(enemyX - 60, enemyY - 28, 120, 8);

  ctx.fillStyle = '#aaa';
  ctx.font = '9px Courier New';
  ctx.fillText(b.enemy.hp + '/' + b.enemy.maxHp, enemyX, enemyY - 18);

  // 玩家（下方居中）
  const playerX = 200, playerY = 340;
  const pshake = b.playerShake > 0 ? Math.sin(b.animFrame * 0.8) * 5 : 0;

  if (IMAGES.laochen) {
    const img = IMAGES.laochen;
    const pSize = 140;
    const ratio = img.width / img.height;
    let dw = pSize, dh = pSize;
    if (ratio > 1) { dh = pSize; dw = pSize * ratio; } else { dw = pSize; dh = pSize / ratio; }
    ctx.save();
    ctx.translate(playerX + dw / 2 + pshake, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, playerY - dh / 2, dw, dh);
    ctx.restore();
  }

  // 玩家信息
  ctx.fillStyle = 'rgba(10,10,30,0.85)';
  ctx.fillRect(playerX - 70, playerY + 30, 140, 50);
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  ctx.strokeRect(playerX - 70, playerY + 30, 140, 50);

  ctx.fillStyle = '#4a90d9';
  ctx.font = 'bold 13px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText(b.member.name, playerX, playerY + 46);

  ctx.fillStyle = '#333';
  ctx.fillRect(playerX - 55, playerY + 52, 110, 8);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(playerX - 55, playerY + 52, 110 * (b.member.hp / b.member.maxHp), 8);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(playerX - 55, playerY + 52, 110, 8);

  ctx.fillStyle = '#333';
  ctx.fillRect(playerX - 55, playerY + 62, 110, 5);
  ctx.fillStyle = '#3498db';
  ctx.fillRect(playerX - 55, playerY + 62, 110 * (b.member.mp / b.member.maxMp), 5);

  ctx.fillStyle = '#aaa';
  ctx.font = '8px Courier New';
  ctx.fillText('HP ' + b.member.hp + '/' + b.member.maxHp + '  MP ' + b.member.mp + '/' + b.member.maxMp, playerX, playerY + 73);

  // 技能菜单（底部全宽）
  if (b.turn === 'player') {
    const menuX = 10, menuY = 440;
    ctx.fillStyle = 'rgba(10,10,30,0.9)';
    ctx.fillRect(menuX, menuY, CW - 20, 80);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.strokeRect(menuX, menuY, CW - 20, 80);

    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'left';
    ctx.fillText('老陈的行动', menuX + 8, menuY + 16);

    const actions = b.member.skills;
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const ay = menuY + 30 + i * 15;
      if (i === b.selectedAction) {
        ctx.fillStyle = 'rgba(255,215,0,0.15)';
        ctx.fillRect(menuX + 4, ay - 10, CW - 28, 14);
        ctx.fillStyle = '#ffd700';
      } else {
        ctx.fillStyle = '#ccc';
      }
      ctx.fillText('> ' + a.name + '  MP:' + a.mp, menuX + 10, ay);
    }
  }

  // 战斗日志（技能菜单上方）
  const logX = 10, logY = 530;
  ctx.fillStyle = 'rgba(10,10,30,0.85)';
  ctx.fillRect(logX, logY, CW - 20, 70);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(logX, logY, CW - 20, 70);

  ctx.fillStyle = '#888';
  ctx.font = '9px Courier New';
  ctx.textAlign = 'left';
  ctx.fillText('战斗日志', logX + 6, logY + 12);

  ctx.fillStyle = '#aaa';
  ctx.font = '9px Courier New';
  const recentLog = b.log.slice(-5);
  for (let i = 0; i < recentLog.length; i++) {
    ctx.fillText(recentLog[i], logX + 8, logY + 26 + i * 14);
  }

  // 伤害数字
  for (const d of b.damageNumbers) {
    ctx.fillStyle = d.color;
    ctx.font = 'bold 20px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('-' + d.value, d.x, d.y);
  }

  // 胜利/失败
  if (b.turn === 'win') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 36px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('VICTORY!', CW / 2, CH / 2);
    ctx.font = '12px Courier New';
    ctx.fillStyle = '#aaa';
    ctx.fillText('点击继续', CW / 2, CH / 2 + 30);
  } else if (b.turn === 'lose') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#e74c3c';
    ctx.font = 'bold 36px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('DEFEATED...', CW / 2, CH / 2);
  }
}

// ════════════════════════════════════════════════════════════
// 触摸控件渲染
// ════════════════════════════════════════════════════════════

function renderTouchControls() {
  // 调试信息（左上角）
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, SW, 40);
  ctx.fillStyle = '#0f0';
  ctx.font = '12px Courier New';
  ctx.textAlign = 'left';
  ctx.fillText('SW=' + SW + ' LW=' + LW + ' scene=' + Game.scene, 5, 15);
  ctx.fillText('touch: ' + (Input.touchLog || 'none'), 5, 30);
  ctx.fillText('player: ' + Math.round(Game.player.x) + ',' + Math.round(Game.player.y), 5, 45);
  ctx.restore();

  // 中线（左半屏/右半屏分界线）
  ctx.save();
  ctx.strokeStyle = 'rgba(255,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LW / 2, 0);
  ctx.lineTo(LW / 2, LH);
  ctx.stroke();
  ctx.restore();

  if (Game.scene === 'dialogue') {
    return;
  }

  if (Game.scene === 'map') {
    // 虚拟摇杆（左半屏）
    if (Input.joystick.active) {
      const jx = Input.joystick.startX;
      const jy = Input.joystick.startY;

      // 外圈
      ctx.save();
      ctx.strokeStyle = 'rgba(255,215,0,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(jx, jy, 40, 0, Math.PI * 2);
      ctx.stroke();

      // 内圈（拇指位置）
      const thumbX = jx + Math.max(-30, Math.min(30, Input.joystick.dx));
      const thumbY = jy + Math.max(-30, Math.min(30, Input.joystick.dy));
      ctx.fillStyle = 'rgba(255,215,0,0.5)';
      ctx.beginPath();
      ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 确认按钮（右下角）
    const btnX = SW - 80;
    const btnY = SH - 80;
    ctx.save();
    ctx.fillStyle = Input.confirmPressed ? 'rgba(255,215,0,0.4)' : 'rgba(255,215,0,0.15)';
    ctx.beginPath();
    ctx.arc(btnX, btnY, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('确认', btnX, btnY + 5);
    ctx.restore();
  }

  if (Game.scene === 'battle') {
    // 战斗场景：左半屏上下滑动选技能，右半屏确认
    if (Input.joystick.active) {
      const jx = Input.joystick.startX;
      const jy = Input.joystick.startY;

      ctx.save();
      ctx.strokeStyle = 'rgba(255,215,0,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(jx, jy, 40, 0, Math.PI * 2);
      ctx.stroke();

      const thumbX = jx + Math.max(-30, Math.min(30, Input.joystick.dx));
      const thumbY = jy + Math.max(-30, Math.min(30, Input.joystick.dy));
      ctx.fillStyle = 'rgba(255,215,0,0.5)';
      ctx.beginPath();
      ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 确认按钮
    const btnX = SW - 80;
    const btnY = SH - 80;
    ctx.save();
    ctx.fillStyle = Input.confirmPressed ? 'rgba(255,215,0,0.4)' : 'rgba(255,215,0,0.15)';
    ctx.beginPath();
    ctx.arc(btnX, btnY, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,215,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('攻击', btnX, btnY + 5);
    ctx.restore();
  }
}

// ════════════════════════════════════════════════════════════
// 主循环
// ════════════════════════════════════════════════════════════

let lastTime = 0;
let loaded = false;

function gameLoop(time) {
  const dt = lastTime > 0 ? (time - lastTime) : 16;
  lastTime = time;

  // 清屏（全屏黑色）
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SW, SH);

  if (!loaded) {
    // 加载界面
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 20px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('代码群侠传', SW / 2, SH / 2 - 20);
    ctx.font = '14px Courier New';
    ctx.fillStyle = '#888';
    ctx.fillText('加载中...', SW / 2, SH / 2 + 20);
    requestAnimationFrame(gameLoop);
    return;
  }

  // 游戏渲染到内部坐标系，然后缩放到屏幕
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // 裁剪到游戏区域
  ctx.beginPath();
  ctx.rect(0, 0, CW, CH);
  ctx.clip();

  // 清游戏区域
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, CH);

  switch (Game.scene) {
    case 'map': updateMap(dt); renderMap(); break;
    case 'dialogue': updateDialogue(dt); renderDialogue(); break;
    case 'battle': updateBattle(dt); renderBattle(); break;
  }

  ctx.restore();

  // 触摸控件渲染（屏幕坐标系，不缩放）
  renderTouchControls();

  Input.update();
  requestAnimationFrame(gameLoop);
}

// ─── 启动 ───
loadImages().then(() => {
  loaded = true;
  requestAnimationFrame(gameLoop);
});
