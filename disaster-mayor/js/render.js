// Canvas renderer: pseudo-3D miniature city with distinct districts, traffic,
// weather, disaster FX, day/night tint, particles and incident markers.

import { TILE, GRID_W, GRID_H, tileAt, isRoad, intersections } from './citygen.js';
import { DAY_LEN } from './state.js';
import { sevLevel } from './events.js';
import { clamp, lerp, rnd, chance } from './utils.js';

const W = GRID_W * TILE;
const H = GRID_H * TILE;

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const ROOF = {
  res: ['#d1654c', '#c97a4e', '#b8574e', '#d18b5a'],
  shop: ['#e8647e', '#5fb8ae', '#e8a04c', '#8f7ae0'],
  office: ['#9db4d4', '#8aa5c8', '#a9bedd'],
  civic: ['#c3b083', '#cbb98f'],
  factory: ['#8d939e', '#98866f'],
  warehouse: ['#a89078', '#9aa0a8', '#b09a70'],
  fire: ['#e05548'], police: ['#4a6fc0'], hospital: ['#f4f7fa'],
  power: ['#9aa0ad'], depot: ['#c08a4a'],
};
const WALL = {
  res: ['#a34e3b', '#9c5e3c', '#8f443d', '#a36c46'],
  shop: ['#b54d62', '#4a8f88', '#b57c3b', '#6f5fb0'],
  office: ['#7c94b8', '#6b83a8', '#8aa0bf'],
  civic: ['#a3926a', '#aa9a75'],
  factory: ['#6b7280', '#7a6a55'],
  warehouse: ['#8a7458', '#7d838b', '#8f7c55'],
  fire: ['#b43e33'], police: ['#3d5a99'], hospital: ['#c9d2de'],
  power: ['#767b87'], depot: ['#9c6f3a'],
};
const SPECIAL_EMOJI = { cityhall: '🏛️', fire: '🚒', police: '🚓', hospital: '🏥', power: '⚡', depot: '🛠️' };

// District ground palettes: makes districts readable at a glance.
const GROUND = {
  residential: (v) => `rgb(${Math.round(126 * v)}, ${Math.round(180 * v)}, ${Math.round(106 * v)})`,
  commercial: () => '#b9bec9',
  civic: () => '#cfc3a0',
  industrial: () => '#9b948a',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cityCanvas = document.createElement('canvas');
  cityCanvas.width = W; cityCanvas.height = H;
  const cctx = cityCanvas.getContext('2d');

  const view = { scale: 1, ox: 0, oy: 0, fitScale: 1, userMoved: false };
  let dpr = 1, cssW = 0, cssH = 0;
  let lastLit = null;
  let particles = [];
  let settings = { effects: 'high', shake: true, reduceMotion: false };
  let markerHits = [];
  let lampCache = null;

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
    if (!lampCache) {
      lampCache = intersections(city).map(({ x, y }) => ({ x: x * TILE + 5, y: y * TILE + 5 }));
    }
    cctx.clearRect(0, 0, W, H);
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        drawGround(cctx, city, city.tiles[y][x]);
      }
    }
    // streetlight poles
    cctx.fillStyle = '#3a4150';
    for (const l of lampCache) {
      cctx.fillRect(l.x - 1, l.y - 5, 2, 6);
      cctx.beginPath(); cctx.arc(l.x, l.y - 6, 2, 0, 7); cctx.fill();
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
    const dtype = city.districts[t.district] ? city.districts[t.district].type : 'residential';
    if (t.type === 'road') {
      // sidewalk base
      g.fillStyle = '#cbd2da';
      g.fillRect(px, py, TILE, TILE);
      const L = isRoad(city, t.x - 1, t.y), R = isRoad(city, t.x + 1, t.y);
      const U = isRoad(city, t.x, t.y - 1), D = isRoad(city, t.x, t.y + 1);
      const inset = 7;
      const ax = L ? px : px + inset;
      const aw = TILE - (L ? 0 : inset) - (R ? 0 : inset);
      const ay = U ? py : py + inset;
      const ah = TILE - (U ? 0 : inset) - (D ? 0 : inset);
      g.fillStyle = '#4e5666';
      g.fillRect(ax, ay, aw, ah);
      const deg = (L ? 1 : 0) + (R ? 1 : 0) + (U ? 1 : 0) + (D ? 1 : 0);
      if (deg <= 2) {
        g.fillStyle = 'rgba(247, 217, 76, 0.75)';
        if (L && R) for (let i = 0; i < 3; i++) g.fillRect(px + 5 + i * 16, py + TILE / 2 - 1.5, 9, 3);
        else if (U && D) for (let i = 0; i < 3; i++) g.fillRect(px + TILE / 2 - 1.5, py + 5 + i * 16, 3, 9);
      } else {
        // crosswalk stripes on each road approach
        g.fillStyle = 'rgba(235, 240, 246, 0.85)';
        if (L) for (let i = 0; i < 4; i++) g.fillRect(px + 2, py + 11 + i * 8, 6, 4);
        if (R) for (let i = 0; i < 4; i++) g.fillRect(px + TILE - 8, py + 11 + i * 8, 6, 4);
        if (U) for (let i = 0; i < 4; i++) g.fillRect(px + 11 + i * 8, py + 2, 4, 6);
        if (D) for (let i = 0; i < 4; i++) g.fillRect(px + 11 + i * 8, py + TILE - 8, 4, 6);
      }
      if (t.damaged) drawRoadDamage(g, px, py, t.variant);
      if (t.broken) drawCrater(g, px + TILE / 2, py + TILE / 2, 17);
      return;
    }
    // district ground
    const v = 1 + (t.variant - 0.5) * 0.08;
    g.fillStyle = t.type === 'park' ? '#6fb35d' : GROUND[dtype](v);
    g.fillRect(px, py, TILE, TILE);
    if (dtype === 'commercial' && t.type !== 'park') {
      // paving joints
      g.strokeStyle = 'rgba(90, 98, 112, 0.18)';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, TILE / 2, TILE / 2);
      g.strokeRect(px + TILE / 2 + 0.5, py + TILE / 2 + 0.5, TILE / 2 - 1, TILE / 2 - 1);
    } else if (dtype === 'industrial' && t.type !== 'park') {
      g.fillStyle = 'rgba(60, 55, 48, 0.16)';
      if (t.variant > 0.4) g.fillRect(px + TILE * t.variant * 0.6, py + TILE * 0.6, 9, 4);
      if (t.variant > 0.7) g.fillRect(px + TILE * 0.2, py + TILE * t.variant * 0.4, 5, 8);
    } else if (dtype === 'civic' && t.type !== 'park') {
      g.strokeStyle = 'rgba(140, 120, 80, 0.2)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, py + TILE / 2); g.lineTo(px + TILE, py + TILE / 2);
      g.stroke();
    }
    if (t.type === 'park') {
      if (t.fountain) { drawFountainBase(g, px, py); return; }
      drawTree(g, px + TILE * (0.28 + t.variant * 0.1), py + TILE * 0.34, 9 + t.variant * 3);
      drawTree(g, px + TILE * 0.68, py + TILE * (0.62 + t.variant * 0.12), 7 + t.variant * 4);
      // flower bed
      if (t.variant > 0.45) {
        g.fillStyle = t.variant > 0.75 ? '#f2c14e' : '#e8869e';
        g.beginPath(); g.arc(px + TILE * 0.5, py + TILE * 0.8, 1.8, 0, 7); g.fill();
        g.beginPath(); g.arc(px + TILE * 0.6, py + TILE * 0.74, 1.5, 0, 7); g.fill();
      }
      // bench
      if (t.variant < 0.3) {
        g.fillStyle = '#8a6a42';
        g.fillRect(px + TILE * 0.55, py + TILE * 0.25, 10, 3);
        g.fillRect(px + TILE * 0.55, py + TILE * 0.25 + 4, 10, 2);
      }
    } else if (t.type === 'grass' && dtype === 'residential') {
      if (t.variant > 0.6) {
        g.fillStyle = t.variant > 0.8 ? '#f2c14e' : '#e8869e';
        g.beginPath(); g.arc(px + TILE * t.variant, py + TILE * (1 - t.variant) * 0.9 + 4, 1.8, 0, 7); g.fill();
        g.beginPath(); g.arc(px + TILE * (1 - t.variant), py + TILE * t.variant * 0.8 + 5, 1.5, 0, 7); g.fill();
      }
    }
  }

  function drawRoadDamage(g, px, py, v) {
    g.strokeStyle = '#2c313d';
    g.lineWidth = 1.6;
    const cx = px + TILE / 2 + (v - 0.5) * 10, cy = py + TILE / 2 + (v - 0.5) * 8;
    for (let i = 0; i < 4; i++) {
      const a = v * 7 + i * 1.7;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * (8 + i * 3), cy + Math.sin(a) * (7 + i * 2));
      g.stroke();
    }
    g.fillStyle = 'rgba(30, 34, 44, 0.5)';
    g.beginPath(); g.ellipse(cx, cy, 5, 3.6, 0, 0, 7); g.fill();
    // hazard cone
    g.fillStyle = '#f0862c';
    g.beginPath();
    g.moveTo(px + 9, py + 12); g.lineTo(px + 12, py + 5); g.lineTo(px + 15, py + 12);
    g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.fillRect(px + 10, py + 8.6, 4, 1.6);
  }

  function drawFountainBase(g, px, py) {
    g.fillStyle = '#b9c4cf';
    g.beginPath(); g.arc(px + TILE / 2, py + TILE / 2, 16, 0, 7); g.fill();
    g.fillStyle = '#5b9fd9';
    g.beginPath(); g.arc(px + TILE / 2, py + TILE / 2, 12, 0, 7); g.fill();
    g.fillStyle = '#cfd8e0';
    g.beginPath(); g.arc(px + TILE / 2, py + TILE / 2, 4, 0, 7); g.fill();
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

    // ground shadow, longer for taller buildings
    g.fillStyle = 'rgba(18, 26, 44, 0.3)';
    g.beginPath(); roundRect(g, fx + 3 + stories, fy + 4 + stories * 0.8, fw, fh, 6); g.fill();

    // wall (visible strip below the lifted roof)
    g.fillStyle = wallC;
    g.beginPath(); roundRect(g, fx, fy - depth + 4, fw, fh + depth - 4, 6); g.fill();
    // right-edge wall shading for depth
    g.fillStyle = 'rgba(20, 26, 40, 0.22)';
    g.fillRect(fx + fw - 5, fy - depth + 6, 5, fh + depth - 10);

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
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1.5;
    g.beginPath(); roundRect(g, fx + 1, fy - depth + 1, fw - 2, fh - 2, 5); g.stroke();
    // roof edge shading (bottom-right) for depth
    g.strokeStyle = 'rgba(20, 26, 40, 0.28)';
    g.beginPath();
    g.moveTo(fx + 3, fy - depth + fh - 1.5);
    g.lineTo(fx + fw - 3, fy - depth + fh - 1.5);
    g.stroke();

    // roof details by type
    if (t.type === 'hospital') {
      g.fillStyle = '#e0443c';
      g.fillRect(fx + fw / 2 - 3, fy - depth + fh / 2 - 10, 6, 20);
      g.fillRect(fx + fw / 2 - 10, fy - depth + fh / 2 - 3, 20, 6);
    } else if (t.type === 'shop' && !t.special) {
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? '#fff' : wallC;
        g.fillRect(fx + 3 + i * ((fw - 6) / 5), fy + fh - 3, (fw - 6) / 5, 5);
      }
      // rooftop sign
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(fx + 5, fy - depth + 4, 12, 5);
    } else if (t.type === 'power') {
      g.fillStyle = '#f2c14e';
      for (let i = 0; i < 3; i++) g.fillRect(fx + 4 + i * 11, fy - depth + 4, 6, 4);
    } else if (t.type === 'factory') {
      // smokestacks
      g.fillStyle = '#565b66';
      g.fillRect(fx + fw - 13, fy - depth - 8, 6, 12);
      g.fillRect(fx + fw - 23, fy - depth - 5, 5, 9);
      g.fillStyle = '#3f4450';
      g.fillRect(fx + fw - 13, fy - depth - 9, 6, 2.4);
      g.fillRect(fx + fw - 23, fy - depth - 6, 5, 2);
      // skylight ridges
      g.fillStyle = 'rgba(255,255,255,0.28)';
      for (let i = 0; i < 3; i++) g.fillRect(fx + 4, fy - depth + 6 + i * 8, 14, 3);
    } else if (t.type === 'warehouse') {
      // ribbed roof
      g.strokeStyle = 'rgba(40, 40, 40, 0.22)';
      g.lineWidth = 1.5;
      for (let i = 1; i < 5; i++) {
        g.beginPath();
        g.moveTo(fx + 3, fy - depth + (fh / 5) * i);
        g.lineTo(fx + fw - 3, fy - depth + (fh / 5) * i);
        g.stroke();
      }
    } else if (t.type === 'res' && !t.special) {
      // wee garden strip out front
      g.fillStyle = '#5ea64f';
      g.fillRect(fx + 3, fy + fh - 2, fw - 6, 4);
      // AC unit
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(fx + fw - 13, fy - depth + 5, 8, 8);
    } else {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(fx + fw - 13, fy - depth + 5, 8, 8);
    }
    if (t.special === 'cityhall') {
      // flagpole
      g.strokeStyle = '#cfd6dd';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(fx + 5, fy - depth - 8); g.lineTo(fx + 5, fy - depth + 4); g.stroke();
      g.fillStyle = '#3fd0c9';
      g.fillRect(fx + 6, fy - depth - 8, 8, 5);
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

  function particleCap() {
    if (settings.reduceMotion) return 60;
    return settings.effects === 'high' ? 340 : 120;
  }
  function spawn(p) {
    if (particles.length < particleCap()) particles.push(p);
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

  function drawFlames(g, cx, cy, t, sev) {
    // three animated flame tongues
    const n = 3;
    for (let i = 0; i < n; i++) {
      const fx = cx - 10 + i * 10;
      const hgt = (10 + sev * 14) * (0.75 + Math.sin(t * (9 + i * 2.4) + i * 2) * 0.25);
      const wid = 5 + sev * 3;
      g.fillStyle = i === 1 ? '#ffb347' : '#ff7a30';
      g.beginPath();
      g.moveTo(fx - wid / 2, cy);
      g.quadraticCurveTo(fx - wid * 0.4, cy - hgt * 0.5, fx, cy - hgt);
      g.quadraticCurveTo(fx + wid * 0.4, cy - hgt * 0.5, fx + wid / 2, cy);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#ffe08a';
    g.beginPath();
    g.ellipse(cx, cy - 3, 6 + sev * 2, 4, 0, 0, 7);
    g.fill();
  }

  function incidentFX(g, state, now) {
    const fxHigh = settings.effects === 'high' && !settings.reduceMotion;
    for (const inc of state.incidents) {
      const cx = (inc.tile.x + 0.5) * TILE;
      const cy = (inc.tile.y + 0.5) * TILE;
      const sev = inc.sev / 100;
      const t = now + inc.fxSeed;
      switch (inc.def.id) {
        case 'fire': {
          const fl = 0.85 + Math.sin(t * 17) * 0.15;
          const grad = g.createRadialGradient(cx, cy - 12, 2, cx, cy - 12, 30 * fl);
          grad.addColorStop(0, 'rgba(255, 210, 90, 0.9)');
          grad.addColorStop(0.5, 'rgba(255, 120, 40, 0.55)');
          grad.addColorStop(1, 'rgba(255, 60, 20, 0)');
          g.fillStyle = grad;
          g.beginPath(); g.arc(cx, cy - 12, 30 * fl, 0, 7); g.fill();
          drawFlames(g, cx, cy + 6, t, sev);
          if (chance((fxHigh ? 0.5 : 0.2) * (0.4 + sev))) {
            spawn({ x: cx + rnd(-10, 10), y: cy - 16, vx: rnd(-4, 4), vy: rnd(-26, -14), age: 0, life: rnd(1.4, 2.4), size: rnd(4, 8), color: '#5a5f6b', alpha: 0.55, growAmt: 0.8, fadeIn: true });
          }
          if (chance(0.3)) {
            spawn({ x: cx + rnd(-8, 8), y: cy - 10, vx: rnd(-8, 8), vy: rnd(-34, -14), age: 0, life: 0.5, size: rnd(1.5, 3), color: '#ffb347', alpha: 0.9 });
          }
          break;
        }
        case 'flood': {
          const r = 12 + sev * 26;
          g.fillStyle = 'rgba(64, 140, 220, 0.55)';
          g.beginPath(); g.ellipse(cx, cy, r, r * 0.7, 0, 0, 7); g.fill();
          // water creeping along the damaged neighbouring roads
          if (inc.escalated) {
            g.fillStyle = 'rgba(64, 140, 220, 0.35)';
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nt = tileAt(state.city, inc.tile.x + dx, inc.tile.y + dy);
              if (nt && nt.type === 'road' && nt.damaged) {
                g.beginPath();
                g.ellipse(cx + dx * TILE * 0.8, cy + dy * TILE * 0.8, 15, 11, 0, 0, 7);
                g.fill();
              }
            }
          }
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
          // handled globally in draw(): city goes dark, streetlights off
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
          // wind-blown debris
          if (chance(fxHigh ? 0.35 : 0.12)) {
            spawn({ x: cx + rnd(-26, 0), y: cy + rnd(-16, 12), vx: rnd(35, 70), vy: rnd(-8, 10), age: 0, life: rnd(0.6, 1.1), size: rnd(1.6, 3), color: ['#8a6a42', '#5ea64f', '#c9cdd6'][(Math.random() * 3) | 0], alpha: 0.85 });
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
          for (let i = 0; i < 4; i++) {
            const a = t * (0.5 + i * 0.13) + i * 2.1;
            drawEmojiActor(g, '🦙', cx + Math.sin(a) * (16 + i * 6), cy + Math.cos(a * 0.8) * (9 + i * 4), 15 + (i % 2) * 4, Math.sin(a) > 0);
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
          // spotlight cone
          const cone = g.createLinearGradient(cx, uy, cx, cy + 8);
          cone.addColorStop(0, 'rgba(140, 255, 190, 0.4)');
          cone.addColorStop(1, 'rgba(140, 255, 190, 0.04)');
          g.fillStyle = cone;
          g.beginPath();
          g.moveTo(cx - 4, uy);
          g.lineTo(cx - 19, cy + 8); g.lineTo(cx + 19, cy + 8); g.lineTo(cx + 4, uy);
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
          drawEmojiActor(g, '💤', cx - 10, cy - 30 + Math.sin(t * 1.4) * 3, 12);
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
      const bob = settings.reduceMotion ? 0 : Math.sin(now * 7 + p.bob) * 1.1;
      g.fillStyle = 'rgba(15, 22, 38, 0.3)';
      g.beginPath(); g.arc(p.x, p.y + 2, 2.6, 0, 7); g.fill();
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y + bob - 1.5, 3, 0, 7); g.fill();
    }
  }

  const VEHICLE_STYLE = {
    fire: { body: '#e0443c', stripe: '#ffd97a', route: 'rgba(255, 110, 90, 0.65)' },
    police: { body: '#2f5fd0', stripe: '#fff', route: 'rgba(110, 160, 255, 0.65)' },
    medical: { body: '#f2f5f8', stripe: '#e0443c', route: 'rgba(255, 255, 255, 0.6)' },
    repair: { body: '#f0a13c', stripe: '#3a3f4c', route: 'rgba(255, 190, 90, 0.65)' },
  };

  function drawVehicles(g, state, now) {
    for (const v of state.vehicles) {
      const st = VEHICLE_STYLE[v.kind] || VEHICLE_STYLE.repair;

      // dashed route line ahead of an en-route vehicle
      if (v.phase === 'go' && v.path.length > 1) {
        g.save();
        g.strokeStyle = st.route;
        g.lineWidth = 3;
        g.setLineDash([7, 7]);
        g.lineDashOffset = settings.reduceMotion ? 0 : -now * 26;
        g.beginPath();
        g.moveTo(v.x, v.y);
        for (let i = v.i + 1; i < v.path.length; i++) {
          g.lineTo((v.path[i].x + 0.5) * TILE, (v.path[i].y + 0.5) * TILE);
        }
        g.lineTo(v.target.x, v.target.y);
        g.stroke();
        g.restore();
        // siren pulse rings while racing
        if (!settings.reduceMotion) {
          const ring = ((now * 1.8 + v.flash) % 1);
          g.strokeStyle = Math.sin(v.flash * 3) > 0 ? 'rgba(255,92,92,0.6)' : 'rgba(92,178,255,0.6)';
          g.globalAlpha = 1 - ring;
          g.lineWidth = 2;
          g.beginPath(); g.arc(v.x, v.y, 8 + ring * 16, 0, 7); g.stroke();
          g.globalAlpha = 1;
        }
      }

      g.save();
      g.globalAlpha = v.alpha;
      g.translate(v.x, v.y);
      if (v.phase === 'work') {
        const pu = settings.reduceMotion ? 0.6 : 0.5 + Math.sin(v.flash * 1.4) * 0.2;
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
      } else if (v.kind === 'fire') {
        // ladder on the roof
        g.strokeStyle = '#cfd6dd';
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(-9, -4.4); g.lineTo(9, -4.4); g.stroke();
        g.beginPath(); g.moveTo(-9, -2.2); g.lineTo(9, -2.2); g.stroke();
        for (let i = -8; i <= 8; i += 4) { g.beginPath(); g.moveTo(i, -4.4); g.lineTo(i, -2.2); g.stroke(); }
      } else if (v.kind === 'repair') {
        // toolbox hump
        g.fillStyle = '#3a3f4c';
        g.fillRect(-10, -5.6, 6, 4);
      }
      // flashing light bar
      const phase = settings.reduceMotion ? true : Math.sin(v.flash * 3) > 0;
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
      const bobA = settings.reduceMotion ? 0 : Math.sin(now * 3 + inc.fxSeed) * 3;
      const my = cy - TILE * 0.95 - bobA;
      const sev = inc.sev / 100;
      const lvl = sevLevel(inc.sev);
      const col = sev > 0.7 ? '#ff5c5c' : sev > 0.4 ? '#ff9a3c' : '#ffd166';

      // pulse ring (static double-ring when reduced motion)
      if (settings.reduceMotion) {
        g.strokeStyle = col;
        g.globalAlpha = 0.55;
        g.lineWidth = 2.5;
        g.beginPath(); g.arc(cx, cy, 17, 0, 7); g.stroke();
        g.globalAlpha = 1;
      } else {
        const spd = inc.escalated ? 1.6 : 0.9;
        const pr = 14 + ((now * spd + inc.fxSeed) % 1) * 16;
        g.strokeStyle = col;
        g.globalAlpha = 1 - ((now * spd + inc.fxSeed) % 1);
        g.lineWidth = 2.5;
        g.beginPath(); g.arc(cx, cy, pr, 0, 7); g.stroke();
        g.globalAlpha = 1;
      }

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
      // numeric severity chip (severity is never colour-only)
      g.fillStyle = '#1a2337';
      g.beginPath(); g.arc(cx + 12, my + 10, 7, 0, 7); g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 9px sans-serif';
      g.fillText(String(lvl), cx + 12, my + 10.5);

      const s = worldToScreen(cx, my);
      markerHits.push({ x: s.x, y: s.y, r: 20 * view.scale + 8, uid: inc.uid });
    }
  }

  // ------------------------------------------------ main draw

  function draw(state, dt, now) {
    if (!cssW) resize();
    tickParticles(dt);

    const dayFrac = (state.time % DAY_LEN) / DAY_LEN;
    const blackout = state.incidents.some((i) => i.def.lightsOut);
    const night = nightAmount(dayFrac);
    const lit = night > 0.45 && !blackout;
    if (state.cityDirty || lit !== lastLit) {
      renderCityLayer(state, lit);
      state.cityDirty = false;
      lastLit = lit;
    }

    // factory chimney smoke — gentle ambient life
    if (!state.attract || true) {
      if (chance(settings.reduceMotion ? 0.03 : 0.1)) {
        for (const row of state.city.tiles) {
          for (const t of row) {
            if (t.type === 'factory' && chance(0.12)) {
              spawn({ x: (t.x + 0.72) * TILE, y: t.y * TILE - t.h * 6 - 6, vx: rnd(2, 7), vy: rnd(-9, -5), age: 0, life: rnd(1.6, 2.6), size: rnd(2.5, 4), color: '#9aa2ad', alpha: 0.3, growAmt: 0.7, fadeIn: true });
            }
          }
        }
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    let sx = 0, sy = 0;
    if (settings.shake && !settings.reduceMotion && state.fx.shake > 0.1) {
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

    // fountain sparkle
    for (const row of state.city.tiles) {
      for (const t of row) {
        if (t.fountain) {
          const fx = (t.x + 0.5) * TILE, fy = (t.y + 0.5) * TILE;
          ctx.fillStyle = 'rgba(200, 235, 255, 0.85)';
          const h = settings.reduceMotion ? 5 : 4 + Math.abs(Math.sin(now * 2.2)) * 5;
          ctx.fillRect(fx - 1, fy - 4 - h, 2, h);
          ctx.beginPath(); ctx.arc(fx, fy - 4 - h, 2, 0, 7); ctx.fill();
          if (!settings.reduceMotion && chance(0.2)) {
            spawn({ x: fx + rnd(-2, 2), y: fy - 8, vx: rnd(-8, 8), vy: rnd(-14, -6), grav: 40, age: 0, life: 0.7, size: 1.3, color: '#bfe4ff', alpha: 0.9 });
          }
        }
      }
    }

    // streetlight glow at night (off in a blackout)
    if (night > 0.4 && !blackout && lampCache) {
      for (const l of lampCache) {
        const gl = ctx.createRadialGradient(l.x, l.y - 6, 1, l.x, l.y - 6, 15);
        gl.addColorStop(0, 'rgba(255, 214, 130, 0.55)');
        gl.addColorStop(1, 'rgba(255, 214, 130, 0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.arc(l.x, l.y - 6, 15, 0, 7); ctx.fill();
      }
    }

    drawCars(ctx, state);
    drawPeds(ctx, state, now);
    drawVehicles(ctx, state, now);
    incidentFX(ctx, state, now);
    drawParticles(ctx);

    // blackout: the whole city dims dramatically
    if (blackout) {
      ctx.fillStyle = 'rgba(6, 8, 18, 0.42)';
      ctx.fillRect(-8, -6, W + 16, H + 18);
    }

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
      const n = settings.reduceMotion ? 14 : settings.effects === 'high' ? 60 : 24;
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
    invalidate: () => { lastLit = null; lampCache = null; },
    setSettings: (s) => { settings = s; },
    clearParticles: () => { particles = []; },
    isDayNight: (state) => nightAmount((state.time % DAY_LEN) / DAY_LEN) > 0.45,
  };
}
