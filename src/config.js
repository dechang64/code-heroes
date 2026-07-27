/**
 * 代码群侠传 - 游戏配置
 */

const CONFIG = {
  TILE_SIZE: 32,
  MAP_WIDTH: 20,
  MAP_HEIGHT: 15,
  SCREEN_WIDTH: 640,
  SCREEN_HEIGHT: 480,
  PLAYER_SPEED: 3,
  COLORS: {
    // 地图tile颜色
    GRASS: 0x2d5016,
    PATH: 0x8b7355,
    WATER: 0x2c5f8d,
    WALL: 0x4a4a4a,
    FLOOR: 0xc4a46c,
    ROOF: 0x8b4513,
    DOOR: 0x654321,
    // UI颜色
    DIALOGUE_BG: 0x000000,
    DIALOGUE_BORDER: 0xffd700,
    DIALOGUE_TEXT: 0xffffff,
    HP_BAR: 0xe74c3c,
    MP_BAR: 0x3498db,
    HP_BG: 0x333333,
  },
  // 范式颜色
  PARADIGM_COLORS: {
    structural: 0xc0392b,  // 红
    oop: 0x27ae60,         // 绿
    functional: 0x8e44ad,  // 紫
    parallel: 0x2980b9,   // 蓝
    ai: 0xf39c12,          // 橙
    none: 0x95a5a6,        // 灰
  }
};

// 游戏状态
const GameState = {
  current_scene: 'map',  // 'map' | 'dialogue' | 'battle'
  player: {
    x: 10 * CONFIG.TILE_SIZE,
    y: 7 * CONFIG.TILE_SIZE,
    direction: 'down',
    moving: false,
    anim_frame: 0,
    anim_timer: 0,
  },
  party: [],        // 队伍成员
  inventory: [],     // 物品
  flags: {},         // 事件标志
  morality: 50,      // 道德值
  gold: 100,         // 金币
};

// 输入状态
const Input = {
  keys: {},
  init() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code] = true;
      // 阻止方向键滚动
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code] = false;
    });
  },
  isDown(key) {
    return this.keys[key] || false;
  },
  wasPressed(key) {
    // 简化：返回当前按下状态，由调用方处理边沿
    return this.keys[key] || false;
  }
};

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, GameState, Input };
}
