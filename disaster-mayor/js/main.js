// Bootstrap and game loop: wires state, renderer, input, UI and saving.

import { newGame, simTick, endRun, DAY_LEN } from './state.js';
import { createRenderer } from './render.js';
import { setupInput, setupKeyboard } from './input.js';
import { respond, toggleMinimize, deskAction, EVENTS, recomputeBlocked, log } from './events.js';
import { tileAt, locName, TILE, GRID_W, GRID_H } from './citygen.js';
import * as ui from './ui.js';
import * as save from './save.js';
import { pick, uid, clamp } from './utils.js';

const canvas = document.getElementById('city');
const renderer = createRenderer(canvas);

let settings = save.loadSettings();
renderer.setSettings(settings);

let attract = newGame({ attract: true });
let game = null;            // active run (or null while on the menu)
let reported = false;
let lastFrame = performance.now();
let uiTimer = 0;
let saveTimer = 0;

// ---------------------------------------------------------------- game flow

function startNewGame() {
  save.clearRun();
  game = newGame();
  reported = false;
  renderer.clearParticles();
  renderer.invalidate();
  ui.resetTicker();
  ui.showGame();
  refreshUI(0, true);
}

function continueGame() {
  const data = save.loadRun();
  if (!data) return;
  game = newGame({ seed: data.seed });
  game.time = data.time;
  game.day = Math.floor(game.time / DAY_LEN) + 1;
  Object.assign(game.stats, data.stats);
  Object.assign(game.score, data.score);
  game.spawnT = data.spawnT ?? 10;
  game.cooldowns = data.cooldowns || {};
  for (const bt of data.brokenTiles || []) {
    const t = tileAt(game.city, bt.x, bt.y);
    if (!t) continue;
    if (bt.rubble) { t.type = 'rubble'; t.h = 0; }
    if (bt.broken) t.broken = true;
  }
  for (const si of data.incidents || []) {
    const def = EVENTS.find((d) => d.id === si.defId);
    const t = def && tileAt(game.city, si.tile.x, si.tile.y);
    if (!def || !t) continue;
    game.incidents.push({
      uid: uid(), def, tile: { x: t.x, y: t.y },
      sev: si.sev, state: 'active', power: 0,
      used: [], escalated: !!si.escalated, min: false,
      locName: locName(game.city, t.x, t.y),
      flavor: pick(def.flavor).replace(/\{loc\}/g, locName(game.city, t.x, t.y)),
      born: game.time, fxSeed: Math.random() * 1000,
    });
  }
  recomputeBlocked(game);
  game.cityDirty = true;
  log(game, '📂 Welcome back, Mayor. The crises kept your seat warm.', 'info');
  reported = false;
  renderer.clearParticles();
  renderer.invalidate();
  ui.resetTicker();
  ui.showGame();
  refreshUI(0, true);
}

function quitToMenu() {
  if (game && !game.over) save.saveRun(game);
  game = null;
  ui.showMenu(save.hasRun(), save.loadBest());
}

function endRunUI() {
  reported = true;
  save.clearRun();
  const best = save.recordBest(game.outcome);
  ui.openReport(game.outcome, best);
}

// ---------------------------------------------------------------- UI wiring

ui.initUI({
  onNewGame: startNewGame,
  onContinue: continueGame,
  onRespond: (incUid, idx) => { if (game) respond(game, incUid, idx); },
  onIgnore: (incUid) => { if (game) toggleMinimize(game, incUid); },
  onLocate: (incUid) => {
    if (!game) return;
    const inc = game.incidents.find((i) => i.uid === incUid);
    if (inc) renderer.centerOn((inc.tile.x + 0.5) * TILE, (inc.tile.y + 0.5) * TILE);
  },
  onDesk: (id) => { if (game) deskAction(game, id); },
  onPauseToggle: togglePause,
  onSpeedToggle: () => { if (game) { game.speed = game.speed === 1 ? 2 : 1; refreshUI(0, true); } },
  onForcePause: () => { if (game) game.paused = true; },
  onResume: () => { if (game) { game.paused = false; refreshUI(0, true); } },
  onQuitToMenu: quitToMenu,
  onModalClosed: () => {},
  isInGame: () => !!game,
  getSettings: () => settings,
  setSettings: (s) => {
    settings = s;
    save.saveSettings(s);
    renderer.setSettings(s);
  },
  onClearData: () => {
    save.clearAll();
    settings = save.loadSettings();
    renderer.setSettings(settings);
    if (!game) ui.showMenu(false, []);
  },
});

function togglePause() {
  if (!game || game.over || ui.isModalOpen()) return;
  game.paused = !game.paused;
  refreshUI(0, true);
}

// ---------------------------------------------------------------- input

setupInput(canvas, renderer, {
  onTap: (sx, sy) => {
    if (!game) return;
    // incident markers first
    for (const m of renderer.markerHits) {
      if (Math.hypot(sx - m.x, sy - m.y) <= m.r) {
        ui.hidePopup();
        ui.focusCard(m.uid);
        const inc = game.incidents.find((i) => i.uid === m.uid);
        if (inc && inc.min) toggleMinimize(game, m.uid);
        return;
      }
    }
    const w = renderer.screenToWorld(sx, sy);
    const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) { ui.hidePopup(); return; }
    const t = tileAt(game.city, tx, ty);
    if (t) ui.showPopup(t, sx, sy);
  },
});

setupKeyboard({
  onPauseToggle: togglePause,
  onEscape: () => {
    if (ui.isModalOpen()) {
      if (game && !game.over) ui.closeModal();
    } else if (game) {
      ui.openPauseMenu();
    }
  },
  onSpeed: (n) => { if (game) { game.speed = n; refreshUI(0, true); } },
  onZoom: (f) => {
    const r = canvas.getBoundingClientRect();
    renderer.zoom(f, r.width / 2, r.height / 2);
  },
  onPan: (dx, dy) => renderer.pan(dx, dy),
});

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('pagehide', () => { if (game && !game.over && settings.autosave) save.saveRun(game); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && !game.over) {
    game.paused = true;
    if (settings.autosave) save.saveRun(game);
  }
});

// ---------------------------------------------------------------- loop

function refreshUI(dt, force) {
  if (!game) return;
  uiTimer -= dt;
  if (!force && !game.uiDirty && uiTimer > 0) return;
  uiTimer = 0.15;
  game.uiDirty = false;
  ui.updateHUD(game, renderer.isDayNight(game));
  ui.updateIncidents(game);
  ui.updateDesk(game);
  ui.pumpTicker(game);
}

function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.06);
  lastFrame = now;
  const t = now / 1000;

  if (game) {
    simTick(game, dt * game.speed);
    refreshUI(dt, false);
    if (game.over && !reported) endRunUI();

    if (settings.autosave && !game.over && !game.paused) {
      saveTimer -= dt;
      if (saveTimer <= 0) { save.saveRun(game); saveTimer = 6; }
    }
    renderer.draw(game, game.paused ? 0 : dt * game.speed, t);
  } else {
    simTick(attract, dt);
    renderer.draw(attract, dt, t);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

renderer.resize();
ui.showMenu(save.hasRun(), save.loadBest());
requestAnimationFrame(frame);

// small debug handle for tests/tinkering (not used by the game itself)
window.__dmDebug = {
  getGame: () => game,
  end: (reason) => { if (game) endRun(game, reason || 'term'); },
};
