// Traffic: civilian cars, pedestrians and dispatched emergency vehicles.
// Cars random-walk the road graph; emergency vehicles BFS to incidents.

import { TILE, roadNeighbors, nearestRoadAdjacent, findRoadPath, isRoad, GRID_W, GRID_H } from './citygen.js';
import { key, pick, rnd, chance, uid, lerp, clamp } from './utils.js';

const CAR_COLORS = ['#e8734a', '#f2c14e', '#7bb661', '#5b8dd9', '#b17aff', '#e05f8a', '#c9cdd6', '#4fc3b8'];
const PED_COLORS = ['#ffd8b1', '#c6e2ff', '#ffe0f0', '#d6ffd6', '#fff3b0', '#e6d6ff'];

const center = (t) => ({ x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE });

function randomRoadTile(city) {
  const keys = [...city.roads];
  const k = pick(keys).split(',').map(Number);
  return { x: k[0], y: k[1] };
}

export function initTraffic(state) {
  state.cars = [];
  state.peds = [];
  state.vehicles = [];
  for (let i = 0; i < 15; i++) {
    const t = randomRoadTile(state.city);
    state.cars.push(makeWalker(state, t, {
      speed: rnd(1.1, 1.7), laneOff: 10, color: pick(CAR_COLORS), kind: 'car',
    }));
  }
  for (let i = 0; i < 12; i++) {
    const t = randomRoadTile(state.city);
    state.peds.push(makeWalker(state, t, {
      speed: rnd(0.25, 0.45), laneOff: 17, color: pick(PED_COLORS), kind: 'ped',
      bob: rnd(0, Math.PI * 2),
    }));
  }
  // Park loiterers
  for (const row of state.city.tiles) {
    for (const t of row) {
      if (t.type === 'park' && chance(0.5)) {
        state.peds.push({
          kind: 'loiter', tile: t, color: pick(PED_COLORS),
          x: (t.x + rnd(0.25, 0.75)) * TILE, y: (t.y + rnd(0.25, 0.75)) * TILE,
          tx: (t.x + rnd(0.2, 0.8)) * TILE, ty: (t.y + rnd(0.2, 0.8)) * TILE,
          speed: rnd(4, 8), bob: rnd(0, Math.PI * 2), wait: rnd(0, 2),
        });
      }
    }
  }
}

function makeWalker(state, tile, opts) {
  const next = pickNext(state, tile, null);
  return {
    from: tile, to: next || tile, p: rnd(0, 0.8), wait: 0,
    x: 0, y: 0, angle: 0, ...opts,
  };
}

function pickNext(state, at, from) {
  const opts = roadNeighbors(state.city, at.x, at.y)
    .filter((n) => !state.blocked.has(key(n.x, n.y)));
  if (!opts.length) return null;
  const forward = opts.filter((n) => !from || !(n.x === from.x && n.y === from.y));
  const pool = forward.length ? forward : opts;
  // Prefer continuing straight
  if (from) {
    const dx = at.x - from.x, dy = at.y - from.y;
    const straight = pool.find((n) => n.x === at.x + dx && n.y === at.y + dy);
    if (straight && chance(0.65)) return straight;
  }
  return pick(pool);
}

function tickWalker(state, w, dt) {
  if (w.wait > 0) { w.wait -= dt; return; }
  const a = center(w.from), b = center(w.to);
  const same = w.from.x === w.to.x && w.from.y === w.to.y;
  if (!same) w.p += (w.speed * dt) / 1; // speed in tiles/sec
  if (w.p >= 1 || same) {
    const arrived = w.to;
    const next = pickNext(state, arrived, w.from);
    if (!next) { w.wait = rnd(0.4, 1.2); w.p = 1; }
    else { w.from = arrived; w.to = next; w.p = same ? 0 : w.p - 1; }
  }
  const p = clamp(w.p, 0, 1);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // drive on the right: perpendicular offset
  const ox = (-dy / len) * w.laneOff, oy = (dx / len) * w.laneOff;
  w.x = lerp(a.x, b.x, p) + ox;
  w.y = lerp(a.y, b.y, p) + oy;
  if (!same) w.angle = Math.atan2(dy, dx);
}

function tickLoiter(w, dt) {
  const dx = w.tx - w.x, dy = w.ty - w.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) {
    w.tx = (w.tile.x + rnd(0.15, 0.85)) * TILE;
    w.ty = (w.tile.y + rnd(0.15, 0.85)) * TILE;
    w.wait = rnd(0.5, 3);
  } else if (w.wait > 0) {
    w.wait -= dt;
  } else {
    w.x += (dx / d) * w.speed * dt;
    w.y += (dy / d) * w.speed * dt;
  }
}

// ---------- Emergency vehicles ----------

const STATION_FOR = { fire: 'fire', police: 'police', medical: 'hospital', repair: 'depot' };

export function dispatchVehicle(state, kind, incident) {
  const stationId = STATION_FOR[kind] || 'cityhall';
  const station = state.city.specials[stationId] || state.city.specials.cityhall;
  const start = nearestRoadAdjacent(state.city, station);
  const goal = nearestRoadAdjacent(state.city, incident.tile);
  let path = findRoadPath(state.city, start, goal, state.blocked);
  if (!path) path = findRoadPath(state.city, start, goal, null);
  if (!path) path = [goal];
  const c = center(path[0]);
  const v = {
    uid: uid(), kind, path, i: 0, p: 0, speed: 3.1, phase: 'go',
    x: c.x, y: c.y, angle: 0, alpha: 1, flash: rnd(0, 1),
    incidentUid: incident.uid,
    target: center(incident.tile),
  };
  state.vehicles.push(v);
  return v;
}

export function releaseVehicles(state, incidentUid) {
  for (const v of state.vehicles) {
    if (v.incidentUid === incidentUid && v.phase !== 'leave') v.phase = 'leave';
  }
}

function tickVehicle(state, v, dt) {
  v.flash += dt * 6;
  if (v.phase === 'leave') {
    v.alpha -= dt / 1.1;
    v.y -= dt * 3;
    return v.alpha > 0;
  }
  if (v.phase === 'work') return true;

  // travel along path
  if (v.i >= v.path.length - 1) {
    // arrive: park just off the road toward the incident
    v.phase = 'work';
    const inc = state.incidents.find((n) => n.uid === v.incidentUid);
    if (inc && inc.state === 'responding') {
      inc.state = 'working';
      inc.workStarted = state.time;
    }
    v.x = lerp(v.x, v.target.x, 0.35);
    v.y = lerp(v.y, v.target.y, 0.35);
    return true;
  }
  const a = center(v.path[v.i]), b = center(v.path[v.i + 1]);
  v.p += (v.speed * dt);
  while (v.p >= 1 && v.i < v.path.length - 1) { v.p -= 1; v.i++; }
  const i2 = Math.min(v.i + 1, v.path.length - 1);
  const a2 = center(v.path[v.i]), b2 = center(v.path[i2]);
  const p = clamp(v.p, 0, 1);
  v.x = lerp(a2.x, b2.x, p);
  v.y = lerp(a2.y, b2.y, p);
  if (b2.x !== a2.x || b2.y !== a2.y) v.angle = Math.atan2(b2.y - a2.y, b2.x - a2.x);
  return true;
}

export function tickTraffic(state, dt) {
  for (const c of state.cars) tickWalker(state, c, dt);
  for (const p of state.peds) {
    if (p.kind === 'loiter') tickLoiter(p, dt);
    else tickWalker(state, p, dt);
  }
  state.vehicles = state.vehicles.filter((v) => tickVehicle(state, v, dt));
}
