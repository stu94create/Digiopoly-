// Canvas renderer: pseudo-3D miniature city, traffic, weather, disaster FX,
// day/night tint, particles and incident markers.

import { TILE, GRID_W, GRID_H, tileAt, isRoad } from './citygen.js';
import { DAY_LEN } from './state.js';
import { clamp, lerp, rnd, chance } from './utils.js';

const W = GRID_W * TILE;
const H = GRID_H * TILE;

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const ROOF = {
  res: ['#d1654c', '#c97a4e', '#b8574e', '#d18b5a'],
  shop: ['#e8647e', '#5fb8ae', '#e8a04c', '#8f7ae0'],
  office: ['#9db4d4', '#8aa5c8', '#a9bedd'],
  civic: ['#c3b083', '#cbb98f'],
  fire: ['#e05548'], police: ['#4a6fc0'], hospital: ['#f4f7fa'],
  power: ['#9aa0ad'], depot: ['#c08a4a'],
};
const WALL = {
  res: ['#a34e3b', '#9c5e3c', '#8f443d', '#a36c46'],
  shop: ['#b54d62', '#4a8f88', '#b57c3b', '#6f5fb0'],
  office: ['#7c94b8', '#6b83a8', '#8aa0bf'],
  civic: ['#a3926a', '#aa9a75'],
  fire: ['#b43e33', '#b43e33'], police: ['#3d5a99'], hospital: ['#c9d2de'],
  power: ['#767b87'], depot: ['#9c6f3a'],
};
const SPECIAL_EMOJI = { cityhall: '🏛️', fire: '🚒', police: '🚓', hospital: '🏥', power: '⚡', depot: '🛠️' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cityCanvas = document.createElement('canvas');
  cityCanvas.width = W; cityCanvas.height = H;
  const cctx = cityCanvas.getContext('2d');

  const view = { scale: 1, ox: 0, oy: 0, fitScale: 1, userMoved: false };
  let dpr = 1, cssW = 0, cssH = 0;
  let lastLit = null;
  let particles = [];
  let settings = { effects: 'high', shake: true };
  let markerHits = [];

  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = r.width; cssH = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    view.fitScale = Math.min((cssW - 16) / W, (cssH - 16) / H);
    if (!view.userMoved) fit();
    else clampView();
  }

  function fit() {
    view.scale = Math.max(view.fitScale, Math.min(0.62, view.fitScale * 1.4));
    clampView();
  }

  function clampView() {
    const vw = W * view.scale, vh = H * view.scale;
    if (vw <= cssW) view.ox = (cssW - vw) / 2;
    else view.ox = clamp(view.ox, cssW - vw - 8, 8);
    if (vh <= cssH) view.oy = (cssH - vh) / 2;
    else view.oy = clamp(view.oy, cssH - vh - 8, 8);
  }

  function pan(dx, dy) {
    view.ox += dx; view.oy += dy;
    view.userMoved = true;
    clampView();
  }

  function zoom(factor, cx, cy) {
    const old = view.scale;
    const ns = clamp(old * factor, view.fitScale * 0.85, 2.4);
    view.ox = cx - ((cx - view.ox) / old) * ns;
    view.oy = cy - ((cy - view.oy) / old) * ns;
    view.scale = ns;
    view.userMoved = true;
    clampView();
  }

  function centerOn(wx, wy) {
    view.ox = cssW / 2 - wx * view.scale;
    view.oy = cssH / 2 - wy * view.scale;
    view.userMoved = true;
    clampView();
  }

  const screenToWorld = (sx, sy) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });
  const worldToScreen = (wx, wy) => ({ x: wx * view.scale + view.ox, y: wy * view.scale + view.oy });

  // ------------------------------------------------ static city layer

  function renderCityLayer(state, lit) {
    const { city } = state;
    cctx.clearRect(0, 0, W, H);
    // terrain first
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        drawGround(cctx, city, city.tiles[y][x]);
      }
    }
    // buildings sorted by row for overlap
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = city.tiles[y][x];
        if (!['road', 'grass', 'park', 'rubble'].includes(t.type)) drawBuilding(cctx, t, lit);
        if (t.type === 'rubble') drawRubble(cctx, t);
      }
    }
  }

  function drawGround(g, city, t) {
    const px = t.x * TILE, py = t.y * TILE;
    if (t.type === 'road') {
      // sidewalk base
      g.fillStyle = '#cbd2da';
      g.fillRect(px, py, TILE, TILE);
      // asphalt, extended toward neighbouring road tiles
      const L = isRoad(city, t.x - 1, t.y), R = isRoad(city, t.x + 1, t.y);
      const U = isRoad(city, t.x, t.y - 1), D = isRoad(city, t.x, t.y + 1);
      const inset = 7;
      const ax = L ? px : px + inset;
      const aw = TILE - (L ? 0 : inset) - (R ? 0 : inset);
      const ay = U ? py : py + inset;
      const ah = TILE - (U ? 0 : inset) - (D ? 0 : inset);
      g.fillStyle = '#4e5666';
      g.fillRect(ax, ay, aw, ah);
      // lane dashes
      const deg = (L ? 1 : 0) + (R ? 1 : 0) + (U ? 1 : 0) + (D ? 1 : 0);
      g.fillStyle = 'rgba(247, 217, 76, 0.75)';
      if (deg <= 2) {
        if (L && R) for (let i = 0; i < 3; i++) g.fillRect(px + 5 + i * 16, py + TILE / 2 - 1.5, 9, 3);
        else if (U && D) for (let i = 0; i < 3; i++) g.fillRect(px + TILE / 2 - 1.5, py + 5 + i * 16, 3, 9);
      }
      if (t.broken) drawCrater(g, px + TILE / 2, py + TILE / 2, 17);
      return;
    }
    // grass base for everything else
    const v = t.variant;
    const shade = 1 + (v - 0.5) * 0.08;
    g.fillStyle = t.type === 'park' ? '#6fb35d' : `rgb(${Math.round(126 * shade)}, ${Math.round(180 * shade)}, ${Math.round(106 * shade)})`;
    g.fillRect(px, py, TILE, TILE);
    if (t.type === 'park') {
      drawTree(g, px + TILE * (0.28 + v * 0.1), py + TILE * 0.34, 9 + v * 3);
      drawTree(g, px + TILE * 0.68, py + TILE * (0.62 + v * 0.12), 7 + v * 4);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      if (v > 0.55) { g.beginPath(); g.arc(px + TILE * 0.5, py + TILE * 0.78, 1.6, 0, 7); g.fill(); }
    } else if (t.type === 'grass') {
      // sprinkle flowers
      if (v > 0.6) {
        g.fillStyle = v > 0.8 ? '#f2c14e' : '#e8869e';
        g.beginPath(); g.arc(px + TILE * v, py + TILE * (1 - v) * 0.9 + 4, 1.8, 0, 7); g.fill();
        g.beginPath(); g.arc(px + TILE * (1 - v), py + TILE * v * 0.8 + 5, 1.5, 0, 7); g.fill();
      }
    }
  }

  function drawTree(g, x, y, r) {
    g.fillStyle = 'rgba(20, 40, 20, 0.25)';
    g.beginPath(); g.ellipse(x + 2, y + r * 0.55, r * 0.8, r * 0.36, 0, 0, 7); g.fill();
    g.fillStyle = '#7a5230';
    g.fillRect(x - 1.5, y - 2, 3, r * 0.6);
    g.fillStyle = '#4e8f42';
    g.beginPath(); g.arc(x, y - r * 0.35, r * 0.72, 0, 7); g.fill();
    g.fillStyle = '#5ea64f';
    g.beginPath(); g.arc(x - r * 0.22, y - r * 0.5, r * 0.5, 0, 7); g.fill();
  }

  function drawCrater(g, cx, cy, r) {
    g.fillStyle = '#1d222c';
    g.beginPath(); g.ellipse(cx, cy, r, r * 0.72, 0, 0, 7); g.fill();
    g.strokeStyle = '#343b49';
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.72);
      g.lineTo(cx + Math.cos(a) * (r + 7), cy + Math.sin(a) * (r * 0.72 + 6));
      g.stroke();
    }
  }

  function drawRubble(g, t) {
    const px = t.x * TILE, py = t.y * TILE;
    g.fillStyle = 'rgba(30, 34, 44, 0.3)';
    g.fillRect(px + 6, py + 8, TILE - 12, TILE - 14);
    const rocks = [[0.3, 0.4, 7], [0.55, 0.55, 9], [0.42, 0.68, 6], [0.68, 0.35, 5], [0.62, 0.72, 5]];
    for (const [rx, ry, rr] of rocks) {
      g.fillStyle = ['#6e7583', '#7d8494', '#5d6472'][(rr + t.x) % 3];
      g.beginPath();
      g.moveTo(px + rx * TILE - rr, py + ry * TILE + rr * 0.5);
      g.lineTo(px + rx * TILE, py + ry * TILE - rr * 0.7);
      g.lineTo(px + rx * TILE + rr, py + ry * TILE + rr * 0.4);
      g.closePath(); g.fill();
    }
  }

  function drawBuilding(g, t, lit) {
    const pad = 5;
    const fx = t.x * TILE + pad, fy = t.y * TILE + pad;
    const fw = TILE - pad * 2, fh = TILE - pad * 2;
    const vIdx = Math.floor(t.variant * 100);
    const stories = Math.max(1, t.h);
    const depth = 5 + stories * 6;
    const roofC = ROOF[t.type] ? ROOF[t.type][vIdx % ROOF[t.type].length] : '#999';
    const wallC = WALL[t.type] ? WALL[t.type][vIdx % WALL[t.type].length] : '#777';

    // ground shadow
    g.fillStyle = 'rgba(18, 26, 44, 0.28)';
    g.beginPath(); roundRect(g, fx + 3, fy + 4, fw, fh, 6); g.fill();

    // wall (visible strip below the lifted roof)
    g.fillStyle = wallC;
    g.beginPath(); roundRect(g, fx, fy - depth + 4, fw, fh + depth - 4, 6); g.fill();

    // windows on the wall strip
    const rows = stories;
    const cols = t.type === 'office' ? 4 : 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = fx + 5 + c * ((fw - 10) / cols) + 1.5;
        const wy = fy + fh - depth + 2 + r * 6 + (r * 0.5);
        const on = lit && ((vIdx + r * 3 + c * 7) % 10) < 6;
        g.fillStyle = on ? '#ffd97a' : 'rgba(20, 28, 46, 0.55)';
        g.fillRect(wx, wy, (fw - 10) / cols - 4, 4);
      }
    }

    // roof
    g.fillStyle = roofC;
    g.beginPath(); roundRect(g, fx, fy - depth, fw, fh, 6); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 1.5;
    g.beginPath(); roundRect(g, fx + 1, fy - depth + 1, fw - 2, fh - 2, 5); g.stroke();

    // roof details
    if (t.type === 'hospital') {
      g.fillStyle = '#e0443c';
      g.fillRect(fx + fw / 2 - 3, fy - depth + fh / 2 - 10, 6, 20);
      g.fillRect(fx + fw / 2 - 10, fy - depth + fh / 2 - 3, 20, 6);
    } else if (t.type === 'shop' && !t.special) {
      // striped awning at the bottom edge
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? '#fff' : wallC;
        g.fillRect(fx + 3 + i * ((fw - 6) / 5), fy + fh - 3, (fw - 6) / 5, 5);
      }
    } else if (t.type === 'power') {
      g.fillStyle = '#f2c14e';
      for (let i = 0; i < 3; i++) g.fillRect(fx + 4 + i * 11, fy - depth + 4, 6, 4);
    } else {
      // AC unit
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(fx + fw - 13, fy - depth + 5, 8, 8);
    }
    if (t.special && SPECIAL_EMOJI[t.special]) {
      g.font = `15px ${EMOJI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(SPECIAL_EMOJI[t.special], fx + fw / 2, fy - depth + fh / 2 + 1);
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // ------------------------------------------------ particles

  function spawn(p) {
    const cap = settings.effects === 'high' ? 320 : 120;
    if (particles.length < cap) particles.push(p);
  }

  function tickParticles(dt) {
    particles = particles.filter((p) => {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
      return p.age < p.life;
    });
  }

  function drawParticles(g) {
    for (const p of particles) {
      const k = 1 - p.age / p.life;
      g.globalAlpha = p.fadeIn ? Math.min(1, p.age * 4) * k * p.alpha : k * p.alpha;
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (p.growAmt ? 1 + p.age * p.growAmt : 1), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------ incident FX

  function incidentFX(g, state, now) {
    const fxHigh = settings.effects === 'high';
    for (const inc of state.incidents) {
      const cx = (inc.tile.x + 0.5) * TILE;
      const cy = (inc.tile.y + 0.5) * TILE;
      const sev = inc.sev / 100;
      const t = now + inc.fxSeed;
      switch (inc.def.id) {
        case 'fire': {
          const fl = 0.85 + Math.sin(t * 17) * 0.15;
          const grad = g.createRadialGradient(cx, cy - 12, 2, cx, cy - 12, 26 * fl);
          grad.addColorStop(0, 'rgba(255, 210, 90, 0.95)');
          grad.addColorStop(0.5, 'rgba(255, 120, 40, 0.7)');
          grad.addColorStop(1, 'rgba(255, 60, 20, 0)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(cx, cy - 12, 26 * fl, 0, 7); g.fill();
          if (chance((fxHigh ? 0.5 : 0.2) * (0.4 + sev))) {
            spawn({ x: cx + rnd(-10, 10), y: cy - 16, vx: rnd(-4, 4), vy: rnd(-26, -14), age: 0, life: rnd(1.4, 2.4), size: rnd(4, 8), color: '#5a5f6b', alpha: 0.55, growAmt: 0.8, fadeIn: true });
          }
          if (chance(0.3)) {
            spawn({ x: cx + rnd(-8, 8), y: cy - 10, vx: rnd(-8, 8), vy: rnd(-30, -12), age: 0, life: 0.5, size: rnd(1.5, 3), color: '#ffb347', alpha: 0.9 });
          }
          break;
        }
        case 'flood': {
          const r = 12 + sev * 26;
          g.fillStyle = 'rgba(64, 140, 220, 0.55)';
          g.beginPath(); g.ellipse(cx, cy, r, r * 0.7, 0, 0, 7); g.fill();
          g.strokeStyle = 'rgba(190, 225, 255, 0.5)';
          g.lineWidth = 1.5;
          for (let i = 0; i < 2; i++) {
            const rr = (r * ((t * 0.4 + i * 0.5) % 1));
            g.globalAlpha = 1 - ((t * 0.4 + i * 0.5) % 1);
            g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.7, 0, 0, 7); g.stroke();
          }
          g.globalAlpha = 1;
          drawEmojiActor(g, '🦆', cx + Math.sin(t * 0.8) * r * 0.4, cy + Math.cos(t * 0.6) * r * 0.25, 12);
          break;
        }
        case 'powercut': {
          g.fillStyle = `rgba(8, 10, 20, ${0.12 + sev * 0.14})`;
          g.fillRect(0, 0, W, H);
          if (chance(0.06)) {
            spawn({ x: cx + rnd(-14, 14), y: cy - 20, vx: rnd(-20, 20), vy: rnd(-10, 30), grav: 60, age: 0, life: 0.4, size: 2, color: '#8be9fd', alpha: 1 });
          }
          break;
        }
        case 'pileup': {
          const cars = [[-9, -4, 0.5, '#e8734a'], [7, 3, -0.8, '#5b8dd9'], [-2, 8, 2.2, '#f2c14e']];
          for (const [ox, oy, rot, col] of cars) {
            g.save();
            g.translate(cx + ox, cy + oy);
            g.rotate(rot);
            g.fillStyle = col;
            g.beginPath(); roundRect(g, -10, -5, 20, 10, 3); g.fill();
            g.restore();
          }
          if (chance(fxHigh ? 0.25 : 0.1)) {
            spawn({ x: cx + rnd(-8, 8), y: cy - 4, vx: rnd(-3, 3), vy: rnd(-14, -8), age: 0, life: 1.2, size: rnd(3, 5), color: '#aeb6c2', alpha: 0.5, growAmt: 0.6, fadeIn: true });
          }
          drawEmojiActor(g, '💢', cx + 12, cy - 14 + Math.sin(t * 5) * 2, 13);
          break;
        }
        case 'storm': {
          const clouds = [[-12, -30, 13], [4, -36, 15], [16, -28, 11]];
          g.fillStyle = 'rgba(70, 78, 96, 0.9)';
          for (const [ox, oy, r] of clouds) {
            g.beginPath(); g.arc(cx + ox + Math.sin(t * 0.7) * 3, cy + oy, r, 0, 7); g.fill();
          }
          if (Math.sin(t * 3.1) > 0.96) {
            g.strokeStyle = '#ffe97a'; g.lineWidth = 2.5;
            g.beginPath();
            g.moveTo(cx, cy - 22); g.lineTo(cx - 5, cy - 8); g.lineTo(cx + 3, cy - 8); g.lineTo(cx - 2, cy + 6);
            g.stroke();
          }
          break;
        }
        case 'sinkhole': {
          drawCrater(g, cx, cy, 8 + sev * 13);
          if (chance(0.08)) {
            spawn({ x: cx + rnd(-12, 12), y: cy + rnd(-6, 6), vx: rnd(-2, 2), vy: rnd(-8, -3), age: 0, life: 1, size: rnd(2, 4), color: '#8a7f6d', alpha: 0.5, fadeIn: true });
          }
          break;
        }
        case 'llamas': {
          for (let i = 0; i < 3; i++) {
            const a = t * (0.5 + i * 0.13) + i * 2.1;
            drawEmojiActor(g, '🦙', cx + Math.sin(a) * (16 + i * 7), cy + Math.cos(a * 0.8) * (10 + i * 5), 17, Math.sin(a) > 0);
          }
          break;
        }
        case 'pigeons': {
          for (let i = 0; i < 4; i++) {
            const a = t * (1.1 + i * 0.2) + i * 1.7;
            drawEmojiActor(g, '🐦', cx + Math.cos(a) * (14 + i * 5), cy - 8 + Math.sin(a) * 9, 13 + (i % 2) * 4);
          }
          break;
        }
        case 'float': {
          drawEmojiActor(g, '🎈', cx, cy - 6 + Math.sin(t * 1.4) * 3, 30);
          if (chance(fxHigh ? 0.3 : 0.12)) {
            spawn({ x: cx + rnd(-16, 16), y: cy - 20, vx: rnd(-12, 12), vy: rnd(6, 18), grav: 18, age: 0, life: rnd(1, 2), size: 2.2, color: ['#ff6b6b', '#ffd166', '#3fd0c9', '#b17aff'][(Math.random() * 4) | 0], alpha: 0.95 });
          }
          break;
        }
        case 'ufo': {
          const uy = cy - 34 + Math.sin(t * 1.8) * 4;
          g.fillStyle = 'rgba(140, 255, 190, 0.16)';
          g.beginPath();
          g.moveTo(cx, uy);
          g.lineTo(cx - 17, cy + 8); g.lineTo(cx + 17, cy + 8);
          g.closePath(); g.fill();
          drawEmojiActor(g, '🛸', cx, uy, 26);
          if (chance(0.1)) {
            spawn({ x: cx + rnd(-12, 12), y: cy + rnd(-4, 6), vx: 0, vy: rnd(-16, -8), age: 0, life: 0.8, size: 1.8, color: '#a9ffcf', alpha: 0.9 });
          }
          break;
        }
        case 'mascot': {
          const bounce = Math.abs(Math.sin(t * 4)) * 14;
          drawEmojiActor(g, '🎭', cx + Math.sin(t * 1.2) * 14, cy - 6 - bounce, 22);
          if (chance(0.12)) {
            spawn({ x: cx + rnd(-14, 14), y: cy - 10, vx: rnd(-24, 24), vy: rnd(-30, -6), grav: 50, age: 0, life: 1.1, size: 2.4, color: '#fff', alpha: 0.85 });
          }
          break;
        }
        case 'coffee': {
          drawEmojiActor(g, '☕', cx + 12, cy - 26 + Math.sin(t * 2) * 2, 16);
          if (chance(0.15)) {
            spawn({ x: cx + 12 + rnd(-3, 3), y: cy - 32, vx: rnd(-2, 2), vy: -8, age: 0, life: 1.3, size: rnd(2, 3.5), color: '#c9cdd6', alpha: 0.4, growAmt: 0.5, fadeIn: true });
          }
          break;
        }
      }
    }
  }

  function drawEmojiActor(g, emoji, x, y, size, flip) {
    g.save();
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    g.font = `${size}px ${EMOJI_FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, 0, 0);
    g.restore();
  }

  // ------------------------------------------------ actors

  function drawCars(g, state) {
    for (const c of state.cars) {
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.angle);
      g.fillStyle = 'rgba(15, 22, 38, 0.3)';
      g.beginPath(); roundRect(g, -10, -4, 20, 10, 3.5); g.fill();
      g.fillStyle = c.color;
      g.beginPath(); roundRect(g, -10, -5.5, 20, 10, 3.5); g.fill();
      g.fillStyle = 'rgba(25, 35, 55, 0.75)';
      g.fillRect(1, -3.8, 5, 6.8);
      g.restore();
    }
  }

  function drawPeds(g, state, now) {
    for (const p of state.peds) {
      const bob = Math.sin(now * 7 + p.bob) * 1.1;
      g.fillStyle = 'rgba(15, 22, 38, 0.3)';
      g.beginPath(); g.arc(p.x, p.y + 2, 2.6, 0, 7); g.fill();
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y + bob - 1.5, 3, 0, 7); g.fill();
    }
  }

  const VEHICLE_STYLE = {
    fire: { body: '#e0443c', stripe: '#fff' },
    police: { body: '#2f5fd0', stripe: '#fff' },
    medical: { body: '#f2f5f8', stripe: '#e0443c' },
    repair: { body: '#f0a13c', stripe: '#3a3f4c' },
  };

  function drawVehicles(g, state) {
    for (const v of state.vehicles) {
      const st = VEHICLE_STYLE[v.kind] || VEHICLE_STYLE.repair;
      g.save();
      g.globalAlpha = v.alpha;
      g.translate(v.x, v.y);
      if (v.phase === 'work') {
        // soft "working" glow
        const pu = 0.5 + Math.sin(v.flash * 1.4) * 0.2;
        g.fillStyle = `rgba(63, 208, 201, ${0.16 * pu * v.alpha})`;
        g.beginPath(); g.arc(0, 0, 20, 0, 7); g.fill();
      }
      g.rotate(v.angle);
      g.fillStyle = 'rgba(15, 22, 38, 0.35)';
      g.beginPath(); roundRect(g, -12, -4.5, 25, 12, 4); g.fill();
      g.fillStyle = st.body;
      g.beginPath(); roundRect(g, -12.5, -6.5, 25, 12.5, 4); g.fill();
      g.fillStyle = st.stripe;
      g.fillRect(-12.5, -1.4, 25, 3);
      if (v.kind === 'medical') {
        g.fillStyle = '#e0443c';
        g.fillRect(-2, -5, 4, 4); g.fillRect(-4, -3.5, 8, 1.6);
      }
      // flashing light bar
      const phase = Math.sin(v.flash * 3) > 0;
      g.fillStyle = phase ? '#ff5c5c' : '#5cb2ff';
      g.fillRect(-4, -6.2, 3.4, 3);
      g.fillStyle = phase ? '#5cb2ff' : '#ff5c5c';
      g.fillRect(0.6, -6.2, 3.4, 3);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------ markers

  function drawMarkers(g, state, now) {
    markerHits = [];
    for (const inc of state.incidents) {
      const cx = (inc.tile.x + 0.5) * TILE;
      const cy = (inc.tile.y + 0.5) * TILE;
      const my = cy - TILE * 0.95 - Math.sin(now * 3 + inc.fxSeed) * 3;
      const sev = inc.sev / 100;
      const col = sev > 0.7 ? '#ff5c5c' : sev > 0.4 ? '#ff9a3c' : '#ffd166';

      // pulse ring
      const pr = 14 + ((now * (inc.escalated ? 1.6 : 0.9) + inc.fxSeed) % 1) * 16;
      g.strokeStyle = col;
      g.globalAlpha = 1 - ((now * (inc.escalated ? 1.6 : 0.9) + inc.fxSeed) % 1);
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(cx, cy, pr, 0, 7); g.stroke();
      g.globalAlpha = 1;

      // pointer
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(cx, my + 17); g.lineTo(cx - 6, my + 8); g.lineTo(cx + 6, my + 8);
      g.closePath(); g.fill();
      // badge
      g.beginPath(); g.arc(cx, my, 14, 0, 7); g.fill();
      // severity arc
      g.strokeStyle = col; g.lineWidth = 3.5;
      g.beginPath(); g.arc(cx, my, 14, -Math.PI / 2, -Math.PI / 2 + sev * Math.PI * 2); g.stroke();
      g.font = `15px ${EMOJI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(inc.def.icon, cx, my + 1);

      const s = worldToScreen(cx, my);
      markerHits.push({ x: s.x, y: s.y, r: 20 * view.scale + 8, uid: inc.uid });
    }
  }

  // ------------------------------------------------ main draw

  function draw(state, dt, now) {
    if (!cssW) resize();
    tickParticles(dt);

    const dayFrac = (state.time % DAY_LEN) / DAY_LEN;
    const night = nightAmount(dayFrac);
    const lit = night > 0.45;
    if (state.cityDirty || lit !== lastLit) {
      renderCityLayer(state, lit);
      state.cityDirty = false;
      lastLit = lit;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    let sx = 0, sy = 0;
    if (settings.shake && state.fx.shake > 0.1) {
      sx = Math.sin(now * 71) * state.fx.shake;
      sy = Math.cos(now * 53) * state.fx.shake * 0.7;
    }

    ctx.save();
    ctx.translate(view.ox + sx, view.oy + sy);
    ctx.scale(view.scale, view.scale);

    // map plinth
    ctx.fillStyle = 'rgba(10, 16, 30, 0.55)';
    ctx.beginPath(); roundRect(ctx, -8, -6, W + 16, H + 18, 12); ctx.fill();

    ctx.drawImage(cityCanvas, 0, 0);

    drawCars(ctx, state);
    drawPeds(ctx, state, now);
    drawVehicles(ctx, state);
    incidentFX(ctx, state, now);
    drawParticles(ctx);
    if (!state.attract) drawMarkers(ctx, state, now);

    // night tint over the world
    if (night > 0.01) {
      ctx.fillStyle = `rgba(14, 22, 52, ${night * 0.38})`;
      ctx.fillRect(-8, -6, W + 16, H + 18);
    }
    const dusk = duskAmount(dayFrac);
    if (dusk > 0.01) {
      ctx.fillStyle = `rgba(255, 140, 70, ${dusk * 0.13})`;
      ctx.fillRect(-8, -6, W + 16, H + 18);
    }
    ctx.restore();

    // rain (screen space) while a storm is active
    if (state.incidents.some((i) => i.def.weather === 'rain')) {
      ctx.strokeStyle = 'rgba(160, 200, 255, 0.35)';
      ctx.lineWidth = 1.2;
      const n = settings.effects === 'high' ? 60 : 24;
      for (let i = 0; i < n; i++) {
        const rx = ((i * 137.5 + now * 260) % (cssW + 40)) - 20;
        const ry = ((i * 89.3 + now * 540) % (cssH + 40)) - 20;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 3, ry + 11);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40, 50, 80, 0.13)';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // vignette
    const vg = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.42, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(4, 8, 18, 0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cssW, cssH);
  }

  function nightAmount(f) {
    if (f < 0.52) return 0;
    if (f < 0.62) return (f - 0.52) / 0.1;
    if (f < 0.88) return 1;
    if (f < 0.98) return 1 - (f - 0.88) / 0.1;
    return 0;
  }
  function duskAmount(f) {
    const d1 = Math.abs(f - 0.55), d2 = Math.abs(f - 0.92);
    return Math.max(0, 1 - Math.min(d1, d2) / 0.06);
  }

  return {
    draw, resize, fit, pan, zoom, centerOn,
    screenToWorld, worldToScreen,
    get markerHits() { return markerHits; },
    get view() { return view; },
    invalidate: () => { lastLit = null; },
    setSettings: (s) => { settings = s; },
    clearParticles: () => { particles = []; },
    isDayNight: (state) => nightAmount((state.time % DAY_LEN) / DAY_LEN) > 0.45,
  };
}
