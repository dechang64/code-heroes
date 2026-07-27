/**
 * 代码群侠传 - 像素精灵生成器
 * 用Canvas程序化绘制像素风角色，无需外部图片资源
 */

// 像素调色板
const PALETTES = {
  laochen: {  // 老陈 - 蓝衣老程序员
    skin: '#d4a373', hair: '#6b6b6b', shirt: '#4a90d9', pants: '#2c3e50',
    shoes: '#1a1a1a', glasses: '#333'
  },
  greenluo: {  // 绿萝 - AI，绿色调
    skin: '#a8e6cf', hair: '#2ecc71', shirt: '#27ae60', pants: '#1a7d44',
    shoes: '#0d4d2c', glow: '#aaffcc'
  },
  bug: {  // Bug - 红色虫子
    body: '#e74c3c', eye: '#ffff00', leg: '#c0392b', glow: '#ff6b6b'
  },
  npc: {  // 通用NPC
    skin: '#d4a373', hair: '#8b4513', shirt: '#cd853f', pants: '#8b4513',
    shoes: '#654321'
  }
};

/**
 * 绘制16x16像素角色精灵（放大到32x32）
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} character - 角色类型
 * @param {number} x - 屏幕x坐标
 * @param {number} y - 屏幕y坐标
 * @param {string} direction - 'up'|'down'|'left'|'right'
 * @param {number} frame - 动画帧 0-3
 */
function drawCharacter(ctx, character, x, y, direction, frame) {
  const p = PALETTES[character] || PALETTES.npc;
  const px = 2;  // 每个像素块2x2，16x16精灵→32x32屏幕
  const ox = x;
  const oy = y;

  // 动画偏移（走路时上下浮动）
  const bobOffset = (frame % 2 === 1) ? -1 : 0;

  // 简化像素人形：头(4x4) + 身体(4x6) + 腿(4x4) + 脚(4x2)
  // 16x16网格，每格2x2像素

  const drawPixel = (gx, gy, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + gx * px, oy + gy * px + bobOffset, px, px);
  };

  // 头部 (y: 0-4, x: 6-10)
  // 头发
  drawPixel(6, 0, p.hair); drawPixel(7, 0, p.hair); drawPixel(8, 0, p.hair); drawPixel(9, 0, p.hair);
  drawPixel(5, 1, p.hair); drawPixel(6, 1, p.hair); drawPixel(9, 1, p.hair); drawPixel(10, 1, p.hair);
  // 脸
  drawPixel(6, 1, p.skin); drawPixel(7, 1, p.skin); drawPixel(8, 1, p.skin); drawPixel(9, 1, p.skin);
  drawPixel(5, 2, p.skin); drawPixel(6, 2, p.skin); drawPixel(7, 2, p.skin); drawPixel(8, 2, p.skin); drawPixel(9, 2, p.skin); drawPixel(10, 2, p.skin);
  drawPixel(5, 3, p.skin); drawPixel(6, 3, p.skin); drawPixel(7, 3, p.skin); drawPixel(8, 3, p.skin); drawPixel(9, 3, p.skin); drawPixel(10, 3, p.skin);

  // 眼睛（根据方向）
  if (direction === 'down') {
    drawPixel(7, 2, '#000'); drawPixel(8, 2, '#000');
  } else if (direction === 'up') {
    // 看不到眼睛，只有后脑勺
    drawPixel(6, 2, p.hair); drawPixel(7, 2, p.hair); drawPixel(8, 2, p.hair); drawPixel(9, 2, p.hair);
  } else if (direction === 'left') {
    drawPixel(6, 2, '#000');
  } else if (direction === 'right') {
    drawPixel(9, 2, '#000');
  }

  // 老陈的眼镜
  if (character === 'laochen' && direction === 'down') {
    drawPixel(6, 3, p.glasses); drawPixel(9, 3, p.glasses);
  }

  // 身体 (y: 4-9, x: 5-10)
  for (let gy = 4; gy < 9; gy++) {
    for (let gx = 5; gx < 11; gx++) {
      drawPixel(gx, gy, p.shirt);
    }
  }
  // 手臂
  drawPixel(4, 5, p.shirt); drawPixel(4, 6, p.skin);
  drawPixel(11, 5, p.shirt); drawPixel(11, 6, p.skin);

  // 腿 (y: 9-13)
  const legOffset = (frame % 4 === 1) ? 1 : (frame % 4 === 3) ? -1 : 0;
  for (let gy = 9; gy < 13; gy++) {
    drawPixel(6, gy, p.pants);
    drawPixel(7, gy, p.pants);
    drawPixel(8, gy, p.pants);
    drawPixel(9, gy, p.pants);
  }
  // 走路动画 - 腿偏移
  if (frame % 2 === 1) {
    drawPixel(6, 12, p.shoes);
    drawPixel(9, 13, p.shoes);
  } else {
    drawPixel(6, 13, p.shoes);
    drawPixel(9, 12, p.shoes);
  }

  // 脚 (y: 13-14)
  drawPixel(6, 13, p.shoes); drawPixel(7, 13, p.shoes);
  drawPixel(8, 13, p.shoes); drawPixel(9, 13, p.shoes);
}

/**
 * 绘制Bug敌人精灵
 */
function drawBug(ctx, x, y, frame) {
  const p = PALETTES.bug;
  const px = 2;
  const bob = Math.sin(frame * 0.3) * 2;

  const drawPixel = (gx, gy, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + gx * px, y + gy * px + bob, px, px);
  };

  // Bug形状：圆形身体 + 6条腿 + 2只眼 + 触角
  // 身体 (中心区域)
  for (let gy = 4; gy < 11; gy++) {
    for (let gx = 4; gx < 12; gx++) {
      const dx = gx - 7.5, dy = gy - 7.5;
      if (dx*dx + dy*dy < 16) {
        drawPixel(gx, gy, p.body);
      }
    }
  }
  // 眼睛
  drawPixel(6, 6, p.eye); drawPixel(9, 6, p.eye);
  drawPixel(6, 7, '#000'); drawPixel(9, 7, '#000');

  // 腿（动画）
  const legSpread = (frame % 2 === 0) ? 0 : 1;
  drawPixel(3, 5+legSpread, p.leg); drawPixel(2, 6+legSpread, p.leg);
  drawPixel(3, 8-legSpread, p.leg); drawPixel(2, 9-legSpread, p.leg);
  drawPixel(12, 5+legSpread, p.leg); drawPixel(13, 6+legSpread, p.leg);
  drawPixel(12, 8-legSpread, p.leg); drawPixel(13, 9-legSpread, p.leg);

  // 触角
  drawPixel(6, 2, p.leg); drawPixel(5, 1, p.leg);
  drawPixel(9, 2, p.leg); drawPixel(10, 1, p.leg);
}

/**
 * 绘制地图tile
 */
function drawTile(ctx, tileType, x, y) {
  const ts = CONFIG.TILE_SIZE;
  let color;

  switch(tileType) {
    case 0: color = '#2d5016'; break;  // 草地
    case 1: color = '#8b7355'; break;  // 路径
    case 2: color = '#2c5f8d'; break;  // 水
    case 3: color = '#4a4a4a'; break;  // 墙
    case 4: color = '#c4a46c'; break;  // 地板
    case 5: color = '#8b4513'; break;  // 屋顶
    case 6: color = '#654321'; break;  // 门
    case 7: color = '#3a5f0b'; break;  // 深草
    case 8: color = '#1a3a5c'; break;  // 深水
    default: color = '#2d5016';
  }

  ctx.fillStyle = color;
  ctx.fillRect(x, y, ts, ts);

  // 添加纹理细节
  if (tileType === 0 || tileType === 7) {
    // 草地纹理
    ctx.fillStyle = tileType === 7 ? '#2a4a08' : '#3a6018';
    ctx.fillRect(x + 4, y + 4, 2, 2);
    ctx.fillRect(x + 20, y + 12, 2, 2);
    ctx.fillRect(x + 8, y + 24, 2, 2);
  } else if (tileType === 1) {
    // 路径纹理
    ctx.fillStyle = '#9b8365';
    ctx.fillRect(x + 6, y + 6, 3, 3);
    ctx.fillRect(x + 22, y + 18, 3, 3);
  } else if (tileType === 3) {
    // 墙纹理
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(x, y + 15, ts, 1);
    ctx.fillRect(x + 15, y, 1, ts);
  } else if (tileType === 5) {
    // 屋顶纹理
    ctx.fillStyle = '#a5562d';
    ctx.fillRect(x + 2, y + 2, 12, 12);
    ctx.fillRect(x + 18, y + 2, 12, 12);
    ctx.fillRect(x + 2, y + 18, 12, 12);
    ctx.fillRect(x + 18, y + 18, 12, 12);
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { drawCharacter, drawBug, drawTile, PALETTES };
}
