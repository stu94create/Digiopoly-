// Core game state: creation, per-tick simulation, difficulty ramp,
// win/lose checks and the end-of-term mayor report.

import { generateCity } from './citygen.js';
import { initTraffic, tickTraffic } from './traffic.js';
import { spawnEvent, tickIncidents, recomputeBlocked, log } from './events.js';
import { clamp, rnd } from './utils.js';

export const DAY_LEN = 90;      // seconds of sim time per day
export const TERM_DAYS = 7;     // survive this many days to finish your term

export function newGame(opts = {}) {
  const seed = opts.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  const state = {
    seed,
    city: generateCity(seed),
    stats: {
      population: 1240,
      budget: 500,
      happiness: 72,
      safety: 78,
      infrastructure: 75,
      chaos: 0,
    },
    time: DAY_LEN * 0.15, // start mid-morning
    day: 1,
    speed: 1,
    paused: false,
    over: false,
    outcome: null,
    attract: !!opts.attract,
    incidents: [],
    vehicles: [],
    cars: [],
    peds: [],
    blocked: new Set(),
    log: [],
    score: { resolved: 0, catastrophes: 0, spent: 0 },
    spawnT: opts.attract ? Infinity : 8,
    cooldowns: {},
    fx: { shake: 0 },
    cityDirty: true,
    uiDirty: true,
  };
  recomputeBlocked(state);
  initTraffic(state);
  if (!opts.attract) {
    log(state, '🏛️ Welcome to Port Fiasco, Mayor. Try not to let it become a verb.', 'info');
  }
  return state;
}

const maxActive = (day) => 3 + (day >= 3 ? 1 : 0) + (day >= 5 ? 1 : 0);

export function simTick(state, dt) {
  if (state.paused || state.over) return;

  const prevDay = state.day;
  state.time += dt;
  state.day = Math.floor(state.time / DAY_LEN) + 1;
  if (state.day !== prevDay && !state.attract) {
    log(state, `🌅 Day ${state.day} of your term. The city wakes up and immediately regrets it.`, 'info');
    state.uiDirty = true;
  }

  const s = state.stats;

  // income: taxes trickle in, happier citizens spend more
  s.budget += dt * (4 + 5 * (s.happiness / 100));

  // gentle recovery toward a soft ceiling when things are calm
  const calm = state.incidents.length === 0;
  for (const k of ['happiness', 'safety', 'infrastructure']) {
    if (s[k] < 70) s[k] = clamp(s[k] + dt * (calm ? 0.6 : 0.2), 0, 100);
  }

  // chaos decays when quiet, simmers when incidents pile up
  const pressure = state.incidents.reduce((a, i) => a + i.sev, 0);
  s.chaos = clamp(s.chaos + dt * (pressure / 320) - dt * (calm ? 1.6 : 0.35), 0, 100);

  // population drifts with mood
  if (s.happiness > 70) s.population += dt * 1.2;
  else if (s.happiness < 30) s.population = Math.max(300, s.population - dt * 2);

  // cooldowns
  for (const k of Object.keys(state.cooldowns)) {
    state.cooldowns[k] = Math.max(0, state.cooldowns[k] - dt);
  }

  tickIncidents(state, dt);
  tickTraffic(state, dt);

  // event spawner with difficulty ramp
  if (!state.attract) {
    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      if (state.incidents.length < maxActive(state.day)) spawnEvent(state);
      const base = Math.max(8, 19 - state.day * 1.6);
      state.spawnT = base * rnd(0.75, 1.3);
    }
  }

  state.fx.shake = Math.max(0, state.fx.shake - dt * 12);

  if (!state.attract) checkEnd(state);
}

function checkEnd(state) {
  const s = state.stats;
  if (s.happiness <= 0) return endRun(state, 'riots');
  // chaos decays a little every tick before this check runs, so use a
  // near-100 threshold or a maxed bar could never actually trigger the loss
  if (s.chaos >= 99.5) return endRun(state, 'chaos');
  if (s.budget <= -500) return endRun(state, 'bankrupt');
  if (state.time >= TERM_DAYS * DAY_LEN) return endRun(state, 'term');
}

const RANKS = {
  beloved: {
    title: 'Beloved Mayor', emoji: '👑',
    sub: 'They are naming a sandwich after you. A good sandwich.',
  },
  competent: {
    title: 'Competent Survivor', emoji: '🎖️',
    sub: 'The city stands. The paperwork is on fire, but the city stands.',
  },
  barely: {
    title: 'Barely Holding It Together', emoji: '🩹',
    sub: 'Technically still the mayor. The llamas send a get-well-soon card.',
  },
  disaster: {
    title: 'Walking Disaster', emoji: '🌪️',
    sub: 'The disasters have started dispatching responses to YOU.',
  },
  resign: {
    title: 'Resign Immediately', emoji: '📉',
    sub: 'The interim mayor is a traffic cone. Approval is up 40 points.',
  },
};

const END_REASONS = {
  term: 'You completed your full term. Historians will call this era “fine, mostly”.',
  riots: 'Happiness hit zero. The citizens have formed a conga line of grievance toward City Hall.',
  chaos: 'Total chaos. The city map is now legally classified as abstract art.',
  bankrupt: 'The city is bankrupt. The office stapler has been repossessed.',
};

export function endRun(state, reason) {
  if (state.over) return;
  state.over = true;
  const s = state.stats;
  const survived = reason === 'term';
  const daysLasted = survived ? TERM_DAYS : Math.min(TERM_DAYS, state.day);
  const score = Math.max(0, Math.round(
    state.score.resolved * 100 +
    daysLasted * 150 +
    (s.happiness + s.safety + s.infrastructure) * 2 -
    state.score.catastrophes * 120
  ));
  let rankId;
  if (survived) rankId = score >= 2400 ? 'beloved' : score >= 1800 ? 'competent' : 'barely';
  else rankId = state.day >= 4 ? 'disaster' : 'resign';

  state.outcome = {
    reason, reasonText: END_REASONS[reason], survived,
    days: daysLasted, score, rankId, rank: RANKS[rankId],
    resolved: state.score.resolved, catastrophes: state.score.catastrophes,
    stats: { ...s },
    date: Date.now(),
  };
  state.uiDirty = true;
}
