// Simple localStorage persistence: settings, continue-game snapshot,
// and a best-results leaderboard.

const KEY_SETTINGS = 'dm_settings_v2';
const KEY_SAVE = 'dm_save_v1';
const KEY_BEST = 'dm_best_v1';

const safeGet = (k) => {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
};
const safeSet = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ }
};

// ---------- settings ----------

const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function defaultSettings() {
  return {
    effects: 'high',
    shake: true,
    autosave: true,
    reduceMotion: prefersReducedMotion(),
    verbosity: 'standard',
  };
}

export function loadSettings() {
  return { ...defaultSettings(), ...(safeGet(KEY_SETTINGS) || {}) };
}
export function saveSettings(s) { safeSet(KEY_SETTINGS, s); }

// ---------- run snapshot ----------

export function saveRun(state) {
  if (state.over || state.attract) return;
  const changedTiles = [];
  for (const row of state.city.tiles) {
    for (const t of row) {
      if (t.type === 'rubble') changedTiles.push({ x: t.x, y: t.y, rubble: true });
      else if (t.broken) changedTiles.push({ x: t.x, y: t.y, broken: true });
      else if (t.damaged) changedTiles.push({ x: t.x, y: t.y, damaged: true });
    }
  }
  safeSet(KEY_SAVE, {
    v: 2,
    seed: state.seed,
    time: state.time,
    stats: state.stats,
    score: state.score,
    spawnT: state.spawnT,
    cooldowns: state.cooldowns,
    brokenTiles: changedTiles,
    incidents: state.incidents.map((i) => ({
      defId: i.def.id, tile: i.tile, sev: Math.round(i.sev), escalated: i.escalated,
    })),
  });
}

export function loadRun() { return safeGet(KEY_SAVE); }
export function hasRun() { return !!safeGet(KEY_SAVE); }
export function clearRun() { try { localStorage.removeItem(KEY_SAVE); } catch { /* noop */ } }

// ---------- best results ----------

export function loadBest() { return safeGet(KEY_BEST) || []; }

export function recordBest(outcome) {
  const list = loadBest();
  list.push({
    rank: outcome.rank.title, emoji: outcome.rank.emoji,
    score: outcome.score, days: outcome.days, date: outcome.date,
  });
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 5);
  safeSet(KEY_BEST, top);
  return top;
}

export function clearAll() {
  clearRun();
  try { localStorage.removeItem(KEY_BEST); localStorage.removeItem(KEY_SETTINGS); } catch { /* noop */ }
}
