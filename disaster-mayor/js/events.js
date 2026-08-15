// The disaster system: event definitions, spawning, escalation, responses,
// limited emergency units, district modifiers and cascading consequences.

import { locName, districtAt, tileAt, intersections, roadNeighbors, neighbors4 } from './citygen.js';
import { key, pick, rnd, chance, uid, clamp } from './utils.js';
import { dispatchVehicle, releaseVehicles } from './traffic.js';

// ---------------------------------------------------------------- units

export const UNIT_DEFS = {
  fire: { label: 'Fire engine', plural: 'fire engines', icon: '🚒', total: 2 },
  police: { label: 'Police unit', plural: 'police units', icon: '🚓', total: 2 },
  medical: { label: 'Medical team', plural: 'medical teams', icon: '🚑', total: 1 },
  repair: { label: 'Repair crew', plural: 'repair crews', icon: '🛠️', total: 2 },
};

export function makeUnits() {
  const u = {};
  for (const [k, d] of Object.entries(UNIT_DEFS)) u[k] = { total: d.total, busy: 0 };
  return u;
}

export function unitsTotal(state, kind) {
  return state.units[kind].total + (state.boosts.reserves > 0 ? 1 : 0);
}
export function unitsAvailable(state, kind) {
  return Math.max(0, unitsTotal(state, kind) - state.units[kind].busy);
}

export function freeUnit(state, kind) {
  if (state.units[kind].busy > 0) {
    state.units[kind].busy--;
    const d = UNIT_DEFS[kind];
    log(state, `${d.icon} A ${d.label.toLowerCase()} is back at the station.`, 'status',
      `${d.label} available again. ${unitsAvailable(state, kind)} of ${unitsTotal(state, kind)} ${d.plural} available.`);
    state.uiDirty = true;
  }
}

// ---------------------------------------------------------------- definitions

export const EVENTS = [
  // ---------------- realistic ----------------
  {
    id: 'fire', name: 'Structure Fire', icon: '🔥', tone: 'real', locType: 'building',
    growth: 1.6, drain: { happiness: 0.35, safety: 0.5, infrastructure: 0.25 },
    flavor: [
      '{loc} is on fire. Witnesses describe the flames as “rude”.',
      'Smoke reported at {loc}. The building insists it’s “just a phase”.',
    ],
    escalate: { msg: 'The fire at {loc} has spread to the second floor, which it does not own.', effects: { safety: -4 }, spreads: true },
    cat: { msg: '{loc} has burned down. The insurance paperwork alone will take years.', effects: { happiness: -8, safety: -10, chaos: 12 }, rubble: true },
    responses: [
      { label: 'Dispatch Fire Engine', icon: '🚒', cost: 150, dispatch: 'fire', power: 11, quip: 'Engine 7 rolls out — sirens optional, morale mandatory.' },
      { label: '“Stay Calm” Presser', icon: '📢', cost: 60, effects: { happiness: 4 }, sev: -12, quip: 'You assure everyone the smoke is “mostly decorative”.' },
    ],
    resolved: { msg: 'Fire at {loc} extinguished. The crew poses for a calendar photo.', effects: { happiness: 3, safety: 2 } },
  },
  {
    id: 'flood', name: 'Flash Flood', icon: '🌊', tone: 'real', locType: 'road', blocks: true,
    growth: 1.2, drain: { infrastructure: 0.5, happiness: 0.2 },
    flavor: [
      '{loc} is now a river. Kayak commuters report record travel times.',
      'Water levels rising at {loc}. Several ducks have claimed squatters’ rights.',
    ],
    escalate: { msg: 'The flood at {loc} is spreading and chewing up nearby roads.', effects: { infrastructure: -4 }, damagesRoads: true },
    cat: { msg: 'The flood at {loc} caused serious water damage. The ducks send their regards.', effects: { infrastructure: -12, happiness: -6, chaos: 10 }, damagesRoads: true },
    responses: [
      { label: 'Send Repair Crew', icon: '🛠️', cost: 120, dispatch: 'repair', power: 9, quip: 'Sandbags deployed with tremendous attitude.' },
      { label: 'Emergency Pumps', icon: '💸', cost: 200, sev: -35, quip: 'You rent the loud pumps. The very loud pumps.' },
    ],
    resolved: { msg: '{loc} drained. The ducks file a formal complaint.', effects: { infrastructure: 3 } },
  },
  {
    id: 'powercut', name: 'Power Outage', icon: '⚡', tone: 'real', locType: 'power',
    growth: 1.4, drain: { happiness: 0.5, safety: 0.3 }, incomeMult: 0.6, lightsOut: true,
    flavor: [
      'The power plant made a noise technicians describe as “not a good noise”. Lights out across town.',
      'Blackout! The city’s fridges have entered their villain era.',
    ],
    escalate: { msg: 'The outage continues. Citizens are rediscovering board games, violently.', effects: { happiness: -4 } },
    cat: { msg: 'Extended blackout. Someone has founded a candle-based religion.', effects: { happiness: -10, safety: -8, chaos: 10 } },
    responses: [
      { label: 'Send Repair Crew', icon: '🛠️', cost: 100, dispatch: 'repair', power: 9, quip: 'A technician percussively maintains the transformer.' },
      { label: 'Candlelit Festival', icon: '📢', cost: 50, effects: { happiness: 6 }, sev: -8, quip: 'You rebrand the blackout as “ambience”. It half works.' },
    ],
    resolved: { msg: 'Power restored. The fridges stand down.', effects: { happiness: 3 } },
  },
  {
    id: 'pileup', name: 'Traffic Pile-Up', icon: '🚗', tone: 'real', locType: 'intersection', blocks: true,
    growth: 1.5, drain: { happiness: 0.4, infrastructure: 0.1 },
    flavor: [
      'Multi-car fender-bender at {loc}. Everyone involved claims they had right of way, including a cyclist who wasn’t there.',
      'Pile-up at {loc}. Horn usage has reached “orchestral” levels.',
    ],
    escalate: { msg: 'The pile-up at {loc} is now a landmark. Tour buses are adding to it.', effects: { happiness: -3 } },
    cat: { msg: 'The pile-up at {loc} dissolved into a week-long insurance feud.', effects: { happiness: -8, safety: -6, chaos: 8 } },
    responses: [
      { label: 'Send Police Unit', icon: '🚓', cost: 80, dispatch: 'police', power: 10, quip: 'An officer directs traffic with balletic contempt.' },
      { label: 'Send Medical Team', icon: '🚑', cost: 100, dispatch: 'medical', power: 12, quip: 'Paramedics treat two bumped heads and one bruised ego.' },
    ],
    resolved: { msg: '{loc} is moving again. The horns fall silent. Mostly.', effects: { happiness: 2 } },
  },
  {
    id: 'storm', name: 'Storm Damage', icon: '⛈️', tone: 'real', locType: 'building', weather: 'rain',
    growth: 1.3, drain: { infrastructure: 0.45, happiness: 0.25 },
    flavor: [
      'A storm is throwing garden furniture around {loc} like it’s redecorating.',
      'High winds at {loc}. One trampoline has achieved low orbit.',
    ],
    escalate: { msg: 'The storm has upgraded itself. Umbrellas are now legally kites.', effects: { infrastructure: -4 } },
    cat: { msg: 'The storm wrecked {loc} before wandering off, unapologetic.', effects: { infrastructure: -12, chaos: 8 }, rubble: true },
    responses: [
      { label: 'Send Repair Crew', icon: '🛠️', cost: 140, dispatch: 'repair', power: 8, quip: 'Tarps. So many tarps.' },
      { label: 'Hot Soup Initiative', icon: '📢', cost: 40, effects: { happiness: 5 }, sev: -8, quip: 'Municipal soup is deployed. Morale stabilises.' },
    ],
    resolved: { msg: 'Storm damage at {loc} patched up. The trampoline remains at large.', effects: { infrastructure: 3 } },
  },
  // ---------------- absurd (each with a real mechanic) ----------------
  {
    id: 'sinkhole', name: 'Sinkhole', icon: '🕳️', tone: 'funny', locType: 'roadPlain', blocks: true,
    growth: 1.1, drain: { infrastructure: 0.5 },
    flavor: [
      'A sinkhole at {loc} has developed unfortunate opinions about your road budget.',
      'The ground at {loc} has opted out. Geologists shrug professionally.',
    ],
    escalate: { msg: 'The sinkhole is expanding. It has started a newsletter.', effects: { infrastructure: -5 } },
    cat: { msg: 'The sinkhole at {loc} is now permanent infrastructure. It pays no taxes.', effects: { infrastructure: -15, chaos: 12 }, breaksRoad: true },
    responses: [
      { label: 'Send Repair Crew', icon: '🛠️', cost: 200, dispatch: 'repair', power: 7, quip: 'Concrete is poured. The sinkhole is offended but sealed.' },
      { label: 'Declare It Public Art', icon: '📢', cost: 30, effects: { happiness: 5, chaos: 5 }, sev: -6, quip: 'Critics call it “a bold statement on municipal decay”.' },
    ],
    resolved: { msg: 'The sinkhole at {loc} has been filled and its newsletter discontinued.', effects: { infrastructure: 4 } },
  },
  {
    // Llamas physically block the road they occupy.
    id: 'llamas', name: 'Llama Invasion', icon: '🦙', tone: 'funny', locType: 'roadPlain', blocks: true,
    growth: 1.2, drain: { safety: 0.3, happiness: -0.1, chaos: 0.05 },
    flavor: [
      'A herd of llamas is blocking {loc} and refuses to respect zoning regulations.',
      'Llamas have occupied {loc}. Traffic is at a standstill. The llamas are thriving.',
    ],
    escalate: { msg: 'The llamas have formed an orderly queue across the entire road. This is somehow worse.', effects: { safety: -3 } },
    cat: { msg: 'The llamas now hold council meetings at {loc}. Attendance is better than yours.', effects: { safety: -8, happiness: 4, chaos: 10 } },
    responses: [
      { label: 'Send Llama Wranglers', icon: '🚓', cost: 90, dispatch: 'police', power: 9, quip: 'Officers herd llamas with lasso and mild embarrassment.' },
      { label: 'Buy Them Snacks', icon: '🥕', cost: 40, sev: -25, effects: { happiness: 3 }, quip: 'The llamas accept your tribute and shuffle to the verge, for now.' },
    ],
    resolved: { msg: 'The llamas have left {loc}, taking three traffic cones as souvenirs.', effects: { happiness: 3 } },
  },
  {
    // Pigeons disrupt the whole district's commerce (income penalty).
    id: 'pigeons', name: 'Giant Pigeon Swarm', icon: '🐦', tone: 'funny', locType: 'shop', incomeMult: 0.7,
    growth: 1.3, drain: { happiness: 0.35, budget: 2 },
    flavor: [
      'Residents report a suspicious number of oversized pigeons near {loc}. Shops district-wide are losing customers. And baguettes.',
      'Enormous pigeons occupy {loc}. Commerce in the district has cooed to a halt.',
    ],
    escalate: { msg: 'The pigeons have discovered the food court. Casualties: several baguettes.', effects: { happiness: -3 } },
    cat: { msg: 'The pigeons unionized. Their demands are non-negotiable and mostly crumbs.', effects: { happiness: -8, budget: -60, chaos: 8 } },
    responses: [
      { label: 'Falcon Task Force', icon: '🦅', cost: 110, power: 9, quip: 'A single professional falcon named Susan restores order.' },
      { label: 'Anti-Pigeon Spikes', icon: '🛠️', cost: 80, dispatch: 'repair', power: 6, quip: 'Spikes installed. The pigeons take it personally.' },
    ],
    resolved: { msg: 'The pigeons have relocated to the next town over. Godspeed, next town.', effects: { happiness: 3 } },
  },
  {
    // Float blocks a major intersection AND congests nearby streets.
    id: 'float', name: 'Runaway Parade Float', icon: '🎈', tone: 'funny', locType: 'intersection', blocks: true,
    congestion: { r: 1.8, mult: 0.55 },
    growth: 1.4, drain: { happiness: 0.25, chaos: 0.04 },
    flavor: [
      'A parade float has become lodged at {loc} — the busiest intersection in the city. Nearby streets are gridlocked.',
      'A 12-metre inflatable badger is blocking {loc}. It is smiling. Nobody else is.',
    ],
    escalate: { msg: 'The float has begun playing its theme song on loop. Negotiators requested.', effects: { happiness: -3 } },
    cat: { msg: 'The float has declared itself a permanent monument. Pigeons have moved in.', effects: { happiness: -6, chaos: 12 } },
    responses: [
      { label: 'Send Police Escort', icon: '🚓', cost: 70, dispatch: 'police', power: 10, quip: 'The badger is escorted away with full honours.' },
      { label: 'Join The Parade', icon: '🎺', cost: 30, effects: { happiness: 7, chaos: 6 }, sev: -12, quip: 'You declare an impromptu festival. Fiscally dubious, emotionally correct.' },
    ],
    resolved: { msg: 'The float has been removed from {loc}. The theme song lingers in everyone’s heads.', effects: { happiness: 3 } },
  },
  {
    // UFO gawkers congest a wide area of streets.
    id: 'ufo', name: 'UFO Sightseeing Tour', icon: '🛸', tone: 'funny', locType: 'park',
    congestion: { r: 3, mult: 0.45 },
    growth: 1.2, drain: { safety: 0.25, happiness: -0.15, chaos: 0.05 },
    flavor: [
      'A UFO is hovering over {loc}, taking photos. Traffic for blocks around has stopped to take photos of it taking photos.',
      'Visitors from beyond have rated {loc} “quaint”. Roads nearby are gridlocked with gawkers.',
    ],
    escalate: { msg: 'The UFO has started abducting shopping trolleys. Purely for souvenirs, it claims.', effects: { safety: -3 } },
    cat: { msg: 'The tourists left, leaving a five-star review and mild existential dread.', effects: { safety: -8, happiness: 5, chaos: 10 } },
    responses: [
      { label: 'Crowd Control', icon: '🚓', cost: 90, dispatch: 'police', power: 8, quip: 'Police disperse the crowd. The UFO honks appreciatively.' },
      { label: 'Sell Alien Souvenirs', icon: '👽', cost: 0, gain: 180, effects: { chaos: 6 }, sev: -10, quip: 'The gift shop does numbers. The aliens buy fridge magnets of themselves.' },
    ],
    resolved: { msg: 'The UFO has departed {loc}, leaving a perfect crop circle in the car park.', effects: { happiness: 4 } },
  },
  {
    // Mascot panic escalates: chaos drain doubles once escalated.
    id: 'mascot', name: 'Rampaging Mascot', icon: '🎭', tone: 'funny', locType: 'shop', panic: true,
    growth: 1.5, drain: { safety: 0.4, happiness: 0.2, chaos: 0.05 },
    flavor: [
      'Gerald the Gull, official city mascot, is rampaging near {loc} after his contract talks collapsed.',
      'The mascot has gone rogue at {loc}. He is armed with a t-shirt cannon.',
    ],
    escalate: { msg: 'Gerald has taken the t-shirt cannon to the rooftops. Panic is spreading fast.', effects: { safety: -4 } },
    cat: { msg: 'Gerald unionized with the pigeons. The city’s HR department resigns as one.', effects: { safety: -10, chaos: 8 } },
    responses: [
      { label: 'Send Police Unit', icon: '🚓', cost: 80, dispatch: 'police', power: 10, quip: 'Gerald is talked down. He keeps the cannon, “for emergencies”.' },
      { label: 'Juice & A Nap', icon: '🚑', cost: 60, dispatch: 'medical', power: 7, quip: 'Paramedics administer juice. Gerald weeps into his beak.' },
    ],
    resolved: { msg: 'Gerald has signed a new contract with a strict t-shirt cannon clause.', effects: { safety: 3, happiness: 2 } },
  },
  {
    // Coffee crisis weakens Mayor's Desk actions while active.
    id: 'coffee', name: 'City Hall Coffee Crisis', icon: '☕', tone: 'funny', locType: 'cityhall', weakensDesk: true,
    growth: 1.6, drain: { budget: 2, happiness: 0.3 },
    flavor: [
      'City Hall has run out of coffee. Governance has slowed to interpretive gestures. Mayor actions cost more and recover slower.',
      'The espresso machine at City Hall has died mid-shot. Your administrative powers are visibly weakening.',
    ],
    escalate: { msg: 'The planning department is attempting to brew tea from pot-plant leaves. Intervene.', effects: { happiness: -3 } },
    cat: { msg: 'Decaf was served. Three departments have seceded.', effects: { happiness: -10, budget: -80, chaos: 8 } },
    responses: [
      { label: 'Espresso Airlift', icon: '💸', cost: 120, sev: -100, quip: 'Beans arrive by drone. A cheer echoes through the corridors of power.' },
      { label: 'Declare Tea Acceptable', icon: '📢', cost: 20, effects: { happiness: -4 }, sev: -30, quip: 'A brave policy. Half the office defects to the tea faction.' },
    ],
    resolved: { msg: 'Coffee supply restored. The city grinds back into motion, pun intended.', effects: { happiness: 3 } },
  },
];

export const sevLevel = (sev) => Math.min(5, 1 + Math.floor(sev / 20));

export const isEventActive = (state, id) => state.incidents.some((i) => i.def.id === id);

// income multiplier from active events (pigeons, blackout…)
export function incomeMult(state) {
  let m = 1;
  for (const inc of state.incidents) if (inc.def.incomeMult) m *= inc.def.incomeMult;
  return m;
}

// ---------------------------------------------------------------- district modifiers

// How strongly a stat drain bites depends on the district the incident is in.
function drainMult(stat, dtype) {
  if (dtype === 'residential') {
    if (stat === 'happiness') return 1.4;
    if (stat === 'safety') return 1.3;
  } else if (dtype === 'commercial') {
    if (stat === 'budget') return 1.5;
    if (stat === 'happiness') return 1.2;
  } else if (dtype === 'industrial') {
    if (stat === 'infrastructure') return 1.5;
  }
  return 1;
}

function growthMult(state, inc) {
  let m = 1 + state.day * 0.06;
  if (state.stats.infrastructure < 40) m *= 1.25;           // neglect bites
  const d = districtAt(state.city, inc.tile.x, inc.tile.y);
  if (d && d.type === 'industrial' && inc.def.id === 'fire') m *= 1.2;
  return m;
}

export function workRate(state) {
  let m = state.boosts.overtime > 0 ? 1.5 : 1;
  if (state.stats.infrastructure < 40) m *= 0.85;
  return m;
}

// ---------------------------------------------------------------- spawning

function findLocation(state, def) {
  const { city } = state;
  const taken = new Set(state.incidents.map((i) => key(i.tile.x, i.tile.y)));
  const ok = (t) => t && !taken.has(key(t.x, t.y)) && t.type !== 'rubble' && !t.broken;
  const buildings = [];
  const shops = [];
  const parks = [];
  for (const row of city.tiles) {
    for (const t of row) {
      if (!ok(t)) continue;
      if (['res', 'shop', 'office', 'factory', 'warehouse'].includes(t.type) && !t.special) buildings.push(t);
      if (t.type === 'shop') shops.push(t);
      if (t.type === 'park') parks.push(t);
    }
  }
  switch (def.locType) {
    case 'building': return buildings.length ? pick(buildings) : null;
    case 'shop': return shops.length ? pick(shops) : (buildings.length ? pick(buildings) : null);
    case 'park': return parks.length ? pick(parks) : (buildings.length ? pick(buildings) : null);
    case 'cityhall': { const s = city.specials.cityhall; const t = s && tileAt(city, s.x, s.y); return ok(t) ? t : null; }
    case 'power': { const s = city.specials.power; const t = s && tileAt(city, s.x, s.y); return ok(t) ? t : null; }
    case 'intersection': {
      const xs = intersections(city).map(({ x, y }) => tileAt(city, x, y)).filter(ok);
      return xs.length ? pick(xs) : null;
    }
    case 'road':
    case 'roadPlain': {
      const roads = [];
      for (const k of city.roads) {
        const [x, y] = k.split(',').map(Number);
        const t = tileAt(city, x, y);
        if (!ok(t)) continue;
        const deg = roadNeighbors(city, x, y).length;
        if (def.locType === 'roadPlain' && deg > 2) continue;
        roads.push(t);
      }
      return roads.length ? pick(roads) : null;
    }
    default: return buildings.length ? pick(buildings) : null;
  }
}

export function spawnEvent(state, forcedId, forcedTile, startSev) {
  const activeIds = new Set(state.incidents.map((i) => i.def.id));
  let pool = EVENTS.filter((d) => !activeIds.has(d.id));
  if (forcedId) pool = EVENTS.filter((d) => d.id === forcedId);
  if (!pool.length) return null;
  const funnyBias = clamp(0.25 + state.day * 0.1, 0.25, 0.7);
  const weighted = pool.filter((d) => (d.tone === 'funny' ? chance(funnyBias) : true));
  const def = forcedId ? pool[0] : pick(weighted.length ? weighted : pool);
  const tile = forcedTile || findLocation(state, def);
  if (!tile) return null;

  const place = locName(state.city, tile.x, tile.y);
  const district = districtAt(state.city, tile.x, tile.y);
  const inc = {
    uid: uid(), def, tile: { x: tile.x, y: tile.y },
    sev: startSev ?? rnd(10, 20), state: 'active', power: 0,
    used: [], escalated: false, warnedSoon: false, min: false,
    locName: place, district: district ? district.name : 'the outskirts',
    flavor: pick(def.flavor).replace(/\{loc\}/g, place),
    born: state.time, fxSeed: Math.random() * 1000,
  };
  state.incidents.push(inc);
  recomputeBlocked(state);
  log(state, `${def.icon} ${inc.flavor}`, 'alert',
    `New incident: ${def.name}, ${inc.district}, severity ${sevLevel(inc.sev)} of 5.`);
  state.fx.shake = Math.max(state.fx.shake, 3);
  state.uiDirty = true;
  return inc;
}

export function recomputeBlocked(state) {
  const b = new Set();
  const cong = [];
  for (const inc of state.incidents) {
    if (inc.def.blocks) b.add(key(inc.tile.x, inc.tile.y));
    if (inc.def.congestion) cong.push({ x: inc.tile.x + 0.5, y: inc.tile.y + 0.5, ...inc.def.congestion });
  }
  for (const row of state.city.tiles) {
    for (const t of row) if (t.broken) b.add(key(t.x, t.y));
  }
  state.blocked = b;
  state.congestion = cong;
}

// ---------------------------------------------------------------- responses

export function respond(state, incidentUid, respIdx) {
  const inc = state.incidents.find((i) => i.uid === incidentUid);
  if (!inc || inc.state !== 'active') return;
  const resp = inc.def.responses[respIdx];
  if (!resp || inc.used.includes(respIdx)) return;
  if (resp.dispatch && unitsAvailable(state, resp.dispatch) <= 0) return;

  state.stats.budget -= resp.cost || 0;
  if (resp.gain) state.stats.budget += resp.gain;
  state.score.spent += resp.cost || 0;
  if (resp.effects) applyEffects(state, resp.effects);
  if (resp.sev) inc.sev = Math.max(0, inc.sev + resp.sev);
  inc.used.push(respIdx);

  const costPart = resp.cost ? ` Budget minus $${resp.cost}.` : (resp.gain ? ` Budget plus $${resp.gain}.` : '');

  if (inc.sev <= 0) {
    log(state, `${resp.icon} ${resp.quip}`, 'action', `${resp.label}.${costPart}`);
    resolveIncident(state, inc, true);
    return;
  }

  if (resp.power) {
    inc.power = resp.power;
    if (resp.dispatch) {
      const v = dispatchVehicle(state, resp.dispatch, inc);
      state.units[resp.dispatch].busy++;
      inc.state = 'responding';
      inc.unitKind = resp.dispatch;
      const eta = v ? Math.max(2, Math.round(v.path.length / v.speed)) : 5;
      log(state, `${resp.icon} ${resp.quip}`, 'action',
        `${UNIT_DEFS[resp.dispatch].label} dispatched to ${inc.def.name.toLowerCase()} in ${inc.district}.${costPart} Estimated arrival ${eta} seconds.`);
    } else {
      inc.state = 'working';
      inc.workStarted = state.time;
      log(state, `${resp.icon} ${resp.quip}`, 'action', `${resp.label} under way at ${inc.locName}.${costPart}`);
    }
  } else {
    log(state, `${resp.icon} ${resp.quip}`, 'action',
      `${resp.label}.${costPart} ${inc.def.name} severity reduced to ${sevLevel(inc.sev)} of 5.`);
  }
  state.uiDirty = true;
}

export function toggleMinimize(state, incidentUid) {
  const inc = state.incidents.find((i) => i.uid === incidentUid);
  if (inc) { inc.min = !inc.min; state.uiDirty = true; }
}

// ---------------------------------------------------------------- ticking

export function tickIncidents(state, dt) {
  for (const inc of [...state.incidents]) {
    const def = inc.def;
    const district = districtAt(state.city, inc.tile.x, inc.tile.y);
    const dtype = district ? district.type : 'residential';

    if (inc.state === 'working') {
      inc.sev -= inc.power * workRate(state) * dt;
      if (inc.sev <= 0) { resolveIncident(state, inc, true); continue; }
    } else if (inc.state === 'responding') {
      inc.sev += def.growth * dt * 0.3;
    } else {
      inc.sev += def.growth * dt * growthMult(state, inc);
    }
    inc.sev = clamp(inc.sev, 0, 100);

    // ongoing drains scale with severity and district sensitivity
    const s = (inc.sev / 100) * dt;
    if (def.drain) {
      for (const [stat, amt] of Object.entries(def.drain)) {
        const m = drainMult(stat, dtype);
        if (stat === 'budget') state.stats.budget -= amt * m * s * 10;
        else if (stat === 'chaos') {
          const panic = def.panic && inc.escalated ? 2 : 1;
          state.stats.chaos = clamp(state.stats.chaos + amt * m * panic * s * 60, 0, 100);
        } else state.stats[stat] = clamp(state.stats[stat] - amt * m * s, 0, 100);
      }
    }

    // pre-escalation warning (once, only while unattended)
    if (!inc.warnedSoon && !inc.escalated && inc.sev >= 48 && inc.state === 'active') {
      inc.warnedSoon = true;
      log(state, `⏳ ${def.name} at ${inc.locName} is getting worse.`, 'warn',
        `Warning: ${def.name} in ${inc.district} will escalate soon.`);
    }

    if (!inc.escalated && inc.sev >= 60 && inc.state === 'active') {
      inc.escalated = true;
      applyEffects(state, def.escalate.effects);
      log(state, `⚠️ ${def.escalate.msg.replace(/\{loc\}/g, inc.locName)}`, 'warn',
        `${def.name} in ${inc.district} has escalated. Severity ${sevLevel(inc.sev)} of 5.`);
      state.fx.shake = Math.max(state.fx.shake, 4);
      // cascades on escalation
      if (def.escalate.spreads) spreadFire(state, inc);
      if (def.escalate.damagesRoads) damageAdjacentRoads(state, inc, 2);
      state.uiDirty = true;
    }

    if (inc.sev >= 100 && inc.state === 'active') {
      catastrophe(state, inc);
    }
  }
}

// A hot fire has a chance to ignite an adjacent building as a second incident.
function spreadFire(state, inc) {
  if (!chance(0.45)) return;
  const cands = neighbors4(inc.tile.x, inc.tile.y)
    .map(([x, y]) => tileAt(state.city, x, y))
    .filter((t) => t && ['res', 'shop', 'office', 'factory', 'warehouse'].includes(t.type) && !t.special
      && !state.incidents.some((i) => i.tile.x === t.x && i.tile.y === t.y));
  if (!cands.length) return;
  const t = pick(cands);
  const nf = spawnEvent(state, 'fire', t, 15);
  if (nf) {
    log(state, `🔥 The fire is spreading to ${nf.locName}!`, 'warn',
      `The fire is spreading. New fire at ${nf.locName}, ${nf.district}.`);
  }
}

// Floods chew up nearby roads: damaged roads slow all vehicles until repaired.
function damageAdjacentRoads(state, inc, count) {
  let n = 0;
  for (const r of roadNeighbors(state.city, inc.tile.x, inc.tile.y)) {
    const t = tileAt(state.city, r.x, r.y);
    if (t && !t.damaged && !t.broken) {
      t.damaged = true;
      n++;
      if (n >= count) break;
    }
  }
  if (n > 0) {
    state.cityDirty = true;
    log(state, `🛣️ Flood water has damaged ${n === 1 ? 'a nearby road' : n + ' nearby roads'}. Traffic and crews will be slower there.`, 'warn',
      `${n === 1 ? 'One road' : n + ' roads'} near the flood damaged. Emergency vehicles will be slower there until roads are repaired.`);
  }
}

function catastrophe(state, inc) {
  const def = inc.def;
  applyEffects(state, def.cat.effects);
  const t = tileAt(state.city, inc.tile.x, inc.tile.y);
  if (t) {
    if (def.cat.rubble && t.type !== 'road') { t.type = 'rubble'; t.h = 0; state.cityDirty = true; }
    if (def.cat.breaksRoad && t.type === 'road') { t.broken = true; state.cityDirty = true; }
  }
  if (def.cat.damagesRoads) damageAdjacentRoads(state, inc, 3);
  state.score.catastrophes++;
  state.fx.shake = Math.max(state.fx.shake, 10);
  log(state, `💥 ${def.cat.msg.replace(/\{loc\}/g, inc.locName)}`, 'danger',
    `Catastrophe: ${def.name} in ${inc.district} was not contained. ${effectsSr(def.cat.effects)}`);
  removeIncident(state, inc);
}

export function resolveIncident(state, inc, good) {
  const def = inc.def;
  if (good) {
    state.score.resolved++;
    if (def.resolved) {
      applyEffects(state, def.resolved.effects);
      log(state, `✅ ${def.resolved.msg.replace(/\{loc\}/g, inc.locName)}`, 'good',
        `${def.name} in ${inc.district} resolved. ${effectsSr(def.resolved.effects)}`);
    }
  }
  removeIncident(state, inc);
}

function removeIncident(state, inc) {
  if (inc.unitKind && (inc.state === 'responding' || inc.state === 'working')) {
    freeUnit(state, inc.unitKind);
  }
  releaseVehicles(state, inc.uid);
  state.incidents = state.incidents.filter((i) => i.uid !== inc.uid);
  recomputeBlocked(state);
  state.uiDirty = true;
}

export function applyEffects(state, effects) {
  if (!effects) return;
  for (const [stat, amt] of Object.entries(effects)) {
    if (stat === 'budget') state.stats.budget += amt;
    else if (stat === 'chaos') state.stats.chaos = clamp(state.stats.chaos + amt, 0, 100);
    else state.stats[stat] = clamp(state.stats[stat] + amt, 0, 100);
  }
}

export function effectsSr(effects) {
  if (!effects) return '';
  const names = { happiness: 'Happiness', safety: 'Safety', infrastructure: 'Infrastructure', budget: 'Budget', chaos: 'Chaos' };
  return Object.entries(effects)
    .map(([k, v]) => `${names[k] || k} ${v > 0 ? 'plus' : 'minus'} ${Math.abs(v)}${k === 'budget' ? ' dollars' : ''}.`)
    .join(' ');
}

export function log(state, msg, kind = 'info', sr = null) {
  state.log.push({ t: state.time, msg, kind, sr, id: uid() });
  if (state.log.length > 60) state.log.shift();
}

// ---------------------------------------------------------------- mayor's desk

export const DESK_ACTIONS = [
  { id: 'presser', label: 'Press Conference', icon: '📢', cost: 50, cd: 40, effects: { happiness: 5 },
    desc: 'Improves happiness by 5', quip: 'You hold a press conference. You say “synergy”. Somehow it helps.' },
  { id: 'funds', label: 'Fund Drive', icon: '💵', cost: 0, gain: 250, cd: 60, effects: { happiness: -4 },
    desc: 'Adds $250 to the budget, happiness minus 4', quip: 'A “voluntary” fundraising gala. The string quartet was non-negotiable.' },
  { id: 'roads', label: 'Repave Roads', icon: '🛣️', cost: 250, cd: 45, effects: { infrastructure: 6 },
    desc: 'Repairs all damaged roads and adds 6 infrastructure', repairsRoads: true,
    quip: 'Fresh asphalt! The city inhales that new-road smell.' },
  { id: 'utilities', label: 'Service Utilities', icon: '🔧', cost: 200, cd: 45, effects: { infrastructure: 8, safety: 4 },
    desc: 'Adds 8 infrastructure and 4 safety', quip: 'Pipes patched, wires taped, one mystery valve left respectfully alone.' },
  { id: 'overtime', label: 'Overtime Shift', icon: '⏱️', cost: 150, cd: 90, effects: { happiness: -3 }, boost: 'overtime', boostFor: 45,
    desc: 'Crews work 50% faster for 45 seconds, happiness minus 3',
    quip: 'Double pay, triple coffee. The crews grumble magnificently and work like heroes.' },
  { id: 'reserves', label: 'Call In Reserves', icon: '🚨', cost: 300, cd: 120, boost: 'reserves', boostFor: 60,
    desc: 'One extra unit of every service for 60 seconds',
    quip: 'Retired Captain Brambles is BACK. She brought her own ladder.' },
];

// Coffee crisis makes governing worse: dearer actions, slower recovery.
export const deskCost = (state, act) => Math.round((act.cost || 0) * (isEventActive(state, 'coffee') ? 1.5 : 1));
export const deskCdMult = (state) => (isEventActive(state, 'coffee') ? 1.5 : 1);

export function deskAction(state, id) {
  const act = DESK_ACTIONS.find((a) => a.id === id);
  if (!act) return;
  if ((state.cooldowns[id] || 0) > 0) return;
  const cost = deskCost(state, act);
  state.stats.budget -= cost;
  if (act.gain) state.stats.budget += act.gain;
  state.score.spent += cost;
  applyEffects(state, act.effects);
  if (act.boost) state.boosts[act.boost] = act.boostFor;
  let extraSr = '';
  if (act.repairsRoads) {
    let n = 0;
    for (const row of state.city.tiles) {
      for (const t of row) if (t.damaged) { t.damaged = false; n++; }
    }
    if (n > 0) { state.cityDirty = true; extraSr = ` ${n} damaged road${n === 1 ? '' : 's'} repaired.`; }
  }
  state.cooldowns[id] = act.cd * deskCdMult(state);
  const costPart = cost ? ` Budget minus $${cost}.` : (act.gain ? ` Budget plus $${act.gain}.` : '');
  log(state, `${act.icon} ${act.quip}`, 'action', `${act.label} done.${costPart}${extraSr}`);
  state.uiDirty = true;
}
