// Core game state: creation, per-tick simulation, cascading pressures,
// difficulty ramp, win/lose checks and the end-of-term mayor report.

import { generateCity, districtAt } from './citygen.js';
import { initTraffic, tickTraffic } from './traffic.js';
import { spawnEvent, tickIncidents, recomputeBlocked, log, makeUnits, incomeMult, unitsAvailable, UNIT_DEFS } from './events.js';
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
    congestion: [],
    units: makeUnits(),
    boosts: { overtime: 0, reserves: 0 },
    dangerFlags: {},
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

const maxActive = (day) => 3 + (day >= 2 ? 1 : 0) + (day >= 4 ? 1 : 0) + (day >= 6 ? 1 : 0);

const DANGER_DEFS = [
  { key: 'happiness', bad: (s) => s.happiness < 25, good: (s) => s.happiness > 33, msg: 'Happiness is critically low. The city is close to riots.' },
  { key: 'safety', bad: (s) => s.safety < 30, good: (s) => s.safety > 38, msg: 'Safety is critically low. Unrest is feeding the chaos.' },
  { key: 'infrastructure', bad: (s) => s.infrastructure < 30, good: (s) => s.infrastructure > 38, msg: 'Infrastructure is crumbling. Disasters will grow faster and crews will slow down.' },
  { key: 'budget', bad: (s) => s.budget < 0, good: (s) => s.budget > 50, msg: 'The budget is in the red. Below minus $500 means bankruptcy.' },
  { key: 'chaos', bad: (s) => s.chaos > 70, good: (s) => s.chaos < 60, msg: 'Chaos is dangerously high. At 100 the city collapses.' },
];

export function simTick(state, dt) {
  if (state.paused || state.over) return;

  const prevDay = state.day;
  state.time += dt;
  state.day = Math.floor(state.time / DAY_LEN) + 1;
  if (state.day !== prevDay && !state.attract) {
    log(state, `🌅 Day ${state.day} of your term. The city wakes up and immediately regrets it.`, 'status',
      `Day ${state.day} of ${TERM_DAYS} begins.`);
    state.uiDirty = true;
  }

  const s = state.stats;

  // income: taxes trickle in; blackouts and pigeon-based commerce collapse hurt
  s.budget += dt * (4 + 5 * (s.happiness / 100)) * incomeMult(state);

  // gentle recovery toward a soft ceiling when things are calm
  const calm = state.incidents.length === 0;
  for (const k of ['happiness', 'safety', 'infrastructure']) {
    if (s[k] < 70) s[k] = clamp(s[k] + dt * (calm ? 0.6 : 0.2), 0, 100);
  }

  // chaos decays when quiet, simmers when incidents pile up
  const pressure = state.incidents.reduce((a, i) => a + i.sev, 0);
  s.chaos = clamp(s.chaos + dt * (pressure / 320) - dt * (calm ? 1.6 : 0.35), 0, 100);

  // cascading unrest: low safety keeps stoking chaos
  if (s.safety < 35) s.chaos = clamp(s.chaos + dt * (35 - s.safety) * 0.02, 0, 100);

  // population drifts with mood
  if (s.happiness > 70) s.population += dt * 1.2;
  else if (s.happiness < 30) s.population = Math.max(300, s.population - dt * 2);

  // boosts wind down
  for (const k of Object.keys(state.boosts)) {
    state.boosts[k] = Math.max(0, state.boosts[k] - dt);
  }

  // cooldowns recover slower while a civic-district incident dents public confidence
  const civicTrouble = state.incidents.some((i) => {
    const d = districtAt(state.city, i.tile.x, i.tile.y);
    return d && d.type === 'civic';
  });
  const cdRate = civicTrouble ? 0.7 : 1;
  for (const k of Object.keys(state.cooldowns)) {
    state.cooldowns[k] = Math.max(0, state.cooldowns[k] - dt * cdRate);
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

    // danger threshold crossings (announced once per crossing, with hysteresis)
    for (const d of DANGER_DEFS) {
      if (!state.dangerFlags[d.key] && d.bad(s)) {
        state.dangerFlags[d.key] = true;
        log(state, `🚨 ${d.msg}`, 'danger', d.msg);
        state.uiDirty = true;
      } else if (state.dangerFlags[d.key] && d.good(s)) {
        state.dangerFlags[d.key] = false;
        state.uiDirty = true;
      }
    }
  }

  state.fx.shake = Math.max(0, state.fx.shake - dt * 12);

  if (!state.attract) checkEnd(state);
}

export function statusSummary(state) {
  const s = state.stats;
  const danger = (k) => (state.dangerFlags[k] ? ' — danger' : '');
  const parts = [
    `Day ${Math.min(state.day, TERM_DAYS)} of ${TERM_DAYS}.`,
    `Population ${Math.round(s.population).toLocaleString('en-US')}.`,
    `Budget ${s.budget < 0 ? 'minus ' : ''}$${Math.abs(Math.round(s.budget)).toLocaleString('en-US')}${danger('budget')}.`,
    `Happiness ${Math.round(s.happiness)}%${danger('happiness')}.`,
    `Safety ${Math.round(s.safety)}%${danger('safety')}.`,
    `Infrastructure ${Math.round(s.infrastructure)}%${danger('infrastructure')}.`,
    `Chaos ${Math.round(s.chaos)}%${danger('chaos')}.`,
  ];
  const n = state.incidents.length;
  parts.push(n === 0 ? 'No incidents active.' : `${n} incident${n === 1 ? '' : 's'} active.`);
  const avail = Object.keys(UNIT_DEFS)
    .map((k) => `${UNIT_DEFS[k].plural} ${unitsAvailable(state, k)}`)
    .join(', ');
  parts.push(`Available: ${avail}.`);
  return parts.join(' ');
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
