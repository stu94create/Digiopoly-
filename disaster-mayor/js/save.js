// Simple localStorage persistence: settings, continue-game snapshot,
// and a best-results leaderboard.

const KEY_SETTINGS = 'dm_settings_v1';
const KEY_SAVE = 'dm_save_v1';
const KEY_BEST = 'dm_best_v1';

const safeGet = (k) => {
  try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
};
const safeSet = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full/blocked */ }
};

// ---------- settings ----------

export const DEFAULT_SETTINGS = { effects: 'high', shake: true, autosave: true };

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(safeGet(KEY_SETTINGS) || {}) };
}
export function saveSettings(s) { safeSet(KEY_SETTINGS, s); }

// ---------- run snapshot ----------

export function saveRun(state) {
  if (state.over || state.attract) return;
  const brokenTiles = [];
  for (const row of state.city.tiles) {
    for (const t of row) {
      if (t.type === 'rubble') brokenTiles.push({ x: t.x, y: t.y, rubble: true });
      else if (t.broken) brokenTiles.push({ x: t.x, y: t.y, broken: true });
    }
  }
  safeSet(KEY_SAVE, {
    v: 1,
    seed: state.seed,
    time: state.time,
    stats: state.stats,
    score: state.score,
    spawnT: state.spawnT,
    cooldowns: state.cooldowns,
    brokenTiles,
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
