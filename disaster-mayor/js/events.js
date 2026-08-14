// The disaster system: event definitions, spawning, escalation,
// responses and consequences.

import { locName, tileAt, intersections, roadNeighbors } from './citygen.js';
import { key, pick, rnd, chance, uid, clamp } from './utils.js';
import { dispatchVehicle, releaseVehicles } from './traffic.js';

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
    escalate: { msg: 'The fire at {loc} has spread to the second floor, which it does not own.', effects: { safety: -4 } },
    cat: { msg: '{loc} has burned down. The insurance paperwork alone will take years.', effects: { happiness: -8, safety: -10, chaos: 12 }, rubble: true },
    responses: [
      { label: 'Dispatch Fire Crew', icon: '🚒', cost: 150, dispatch: 'fire', power: 11, quip: 'Engine 7 rolls out — sirens optional, morale mandatory.' },
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
    escalate: { msg: 'The flood at {loc} has started offering gondola tours.', effects: { infrastructure: -4 } },
    cat: { msg: 'The flood at {loc} caused serious water damage. The ducks send their regards.', effects: { infrastructure: -12, happiness: -6, chaos: 10 } },
    responses: [
      { label: 'Send Repair Crew', icon: '🛠️', cost: 120, dispatch: 'repair', power: 9, quip: 'Sandbags deployed with tremendous attitude.' },
      { label: 'Emergency Pumps', icon: '💸', cost: 200, sev: -35, quip: 'You rent the loud pumps. The very loud pumps.' },
    ],
    resolved: { msg: '{loc} drained. The ducks file a formal complaint.', effects: { infrastructure: 3 } },
  },
  {
    id: 'powercut', name: 'Power Outage', icon: '⚡', tone: 'real', locType: 'power',
    growth: 1.4, drain: { happiness: 0.5, safety: 0.3 },
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
      { label: 'Send Police', icon: '🚓', cost: 80, dispatch: 'police', power: 10, quip: 'An officer directs traffic with balletic contempt.' },
      { label: 'Send Ambulance', icon: '🚑', cost: 100, dispatch: 'medical', power: 12, quip: 'Paramedics treat two bumped heads and one bruised ego.' },
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
  // ---------------- absurd ----------------
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
    id: 'llamas', name: 'Llama Invasion', icon: '🦙', tone: 'funny', locType: 'park',
    growth: 1.2, drain: { safety: 0.3, happiness: -0.1, chaos: 0.05 },
    flavor: [
      'A llama has entered the civic district and refuses to respect zoning regulations. It brought friends.',
      'Llamas at {loc}. They are chewing on things that are municipally significant.',
    ],
    escalate: { msg: 'The llamas have formed an orderly queue outside City Hall. This is somehow worse.', effects: { safety: -3 } },
    cat: { msg: 'The llamas now hold council meetings. Attendance is better than yours.', effects: { safety: -8, happiness: 4, chaos: 10 } },
    responses: [
      { label: 'Llama Wranglers', icon: '🚓', cost: 90, dispatch: 'police', power: 9, quip: 'Officers herd llamas with lasso and mild embarrassment.' },
      { label: 'Buy Them Snacks', icon: '🥕', cost: 40, sev: -25, effects: { happiness: 3 }, quip: 'The llamas accept your tribute and disperse, for now.' },
    ],
    resolved: { msg: 'The llamas have left {loc}, taking three traffic cones as souvenirs.', effects: { happiness: 3 } },
  },
  {
    id: 'pigeons', name: 'Giant Pigeon Swarm', icon: '🐦', tone: 'funny', locType: 'shop',
    growth: 1.3, drain: { happiness: 0.35, budget: 2 },
    flavor: [
      'Residents report a suspicious number of oversized pigeons near {loc}. The pigeons deny everything.',
      'Enormous pigeons occupy {loc}. They have opinions about your sandwich.',
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
    id: 'float', name: 'Runaway Parade Float', icon: '🎈', tone: 'funny', locType: 'intersection', blocks: true,
    growth: 1.4, drain: { happiness: 0.25, chaos: 0.04 },
    flavor: [
      'A parade float has become lodged at {loc} — the busiest intersection in the city.',
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
    id: 'ufo', name: 'UFO Sightseeing Tour', icon: '🛸', tone: 'funny', locType: 'park',
    growth: 1.2, drain: { safety: 0.25, happiness: -0.15, chaos: 0.05 },
    flavor: [
      'A UFO is hovering over {loc}, taking photos. Traffic has stopped to take photos of it taking photos.',
      'Visitors from beyond have rated {loc} “quaint”. Roads are gridlocked with gawkers.',
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
    id: 'mascot', name: 'Rampaging Mascot', icon: '🎭', tone: 'funny', locType: 'shop',
    growth: 1.5, drain: { safety: 0.4, happiness: 0.2 },
    flavor: [
      'Gerald the Gull, official city mascot, is rampaging near {loc} after his contract talks collapsed.',
      'The mascot has gone rogue at {loc}. He is armed with a t-shirt cannon.',
    ],
    escalate: { msg: 'Gerald has taken the t-shirt cannon to the rooftops. Morale is confusingly high.', effects: { safety: -4 } },
    cat: { msg: 'Gerald unionized with the pigeons. The city’s HR department resigns as one.', effects: { safety: -10, chaos: 8 } },
    responses: [
      { label: 'Send Police', icon: '🚓', cost: 80, dispatch: 'police', power: 10, quip: 'Gerald is talked down. He keeps the cannon, “for emergencies”.' },
      { label: 'Juice & A Nap', icon: '🚑', cost: 60, dispatch: 'medical', power: 7, quip: 'Paramedics administer juice. Gerald weeps into his beak.' },
    ],
    resolved: { msg: 'Gerald has signed a new contract with a strict t-shirt cannon clause.', effects: { safety: 3, happiness: 2 } },
  },
  {
    id: 'coffee', name: 'City Hall Coffee Crisis', icon: '☕', tone: 'funny', locType: 'cityhall',
    growth: 1.6, drain: { budget: 2, happiness: 0.3 },
    flavor: [
      'City Hall has run out of coffee. Governance has slowed to interpretive gestures.',
      'The espresso machine at City Hall has made a sound like a dying accordion. Productivity is in freefall.',
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
      if (['res', 'shop', 'office'].includes(t.type) && !t.special) buildings.push(t);
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

export function spawnEvent(state, forcedId) {
  const activeIds = new Set(state.incidents.map((i) => i.def.id));
  let pool = EVENTS.filter((d) => !activeIds.has(d.id));
  if (forcedId) pool = EVENTS.filter((d) => d.id === forcedId);
  if (!pool.length) return null;
  // early days lean realistic, later days lean chaotic
  const funnyBias = clamp(0.25 + state.day * 0.1, 0.25, 0.7);
  const weighted = pool.filter((d) => (d.tone === 'funny' ? chance(funnyBias) : true));
  const def = pick(weighted.length ? weighted : pool);
  const tile = findLocation(state, def);
  if (!tile) return null;

  const inc = {
    uid: uid(), def, tile: { x: tile.x, y: tile.y },
    sev: rnd(10, 20), state: 'active', power: 0,
    used: [], escalated: false, min: false,
    locName: locName(state.city, tile.x, tile.y),
    flavor: pick(def.flavor).replace(/\{loc\}/g, locName(state.city, tile.x, tile.y)),
    born: state.time, fxSeed: Math.random() * 1000,
  };
  state.incidents.push(inc);
  recomputeBlocked(state);
  log(state, `${def.icon} ${inc.flavor}`, 'alert');
  state.fx.shake = Math.max(state.fx.shake, 3);
  state.uiDirty = true;
  return inc;
}

export function recomputeBlocked(state) {
  const b = new Set();
  for (const inc of state.incidents) {
    if (inc.def.blocks) b.add(key(inc.tile.x, inc.tile.y));
  }
  for (const row of state.city.tiles) {
    for (const t of row) if (t.broken) b.add(key(t.x, t.y));
  }
  state.blocked = b;
}

// ---------------------------------------------------------------- responses

export function respond(state, incidentUid, respIdx) {
  const inc = state.incidents.find((i) => i.uid === incidentUid);
  if (!inc || inc.state !== 'active') return;
  const resp = inc.def.responses[respIdx];
  if (!resp || inc.used.includes(respIdx)) return;

  state.stats.budget -= resp.cost || 0;
  if (resp.gain) state.stats.budget += resp.gain;
  state.score.spent += resp.cost || 0;
  if (resp.effects) applyEffects(state, resp.effects);
  if (resp.sev) inc.sev = Math.max(0, inc.sev + resp.sev);
  inc.used.push(respIdx);
  log(state, `${resp.icon} ${resp.quip}`, 'action');

  if (inc.sev <= 0) { resolveIncident(state, inc, true); return; }

  if (resp.power) {
    inc.power = resp.power;
    if (resp.dispatch) {
      dispatchVehicle(state, resp.dispatch, inc);
      inc.state = 'responding';
    } else {
      inc.state = 'working';
      inc.workStarted = state.time;
    }
  }
  state.uiDirty = true;
}

export function toggleMinimize(state, incidentUid) {
  const inc = state.incidents.find((i) => i.uid === incidentUid);
  if (inc) { inc.min = !inc.min; state.uiDirty = true; }
}

// ---------------------------------------------------------------- ticking

export function tickIncidents(state, dt) {
  const day = state.day;
  for (const inc of [...state.incidents]) {
    const def = inc.def;
    if (inc.state === 'working') {
      inc.sev -= inc.power * dt;
      if (inc.sev <= 0) { resolveIncident(state, inc, true); continue; }
    } else if (inc.state === 'responding') {
      inc.sev += def.growth * dt * 0.3;
    } else {
      inc.sev += def.growth * dt * (1 + day * 0.06);
    }
    inc.sev = clamp(inc.sev, 0, 100);

    // ongoing drains scale with severity
    const s = (inc.sev / 100) * dt;
    if (def.drain) {
      for (const [stat, amt] of Object.entries(def.drain)) {
        if (stat === 'budget') state.stats.budget -= amt * s * 10;
        else if (stat === 'chaos') state.stats.chaos = clamp(state.stats.chaos + amt * s * 60, 0, 100);
        else state.stats[stat] = clamp(state.stats[stat] - amt * s, 0, 100);
      }
    }

    if (!inc.escalated && inc.sev >= 60 && inc.state === 'active') {
      inc.escalated = true;
      applyEffects(state, def.escalate.effects);
      log(state, `⚠️ ${def.escalate.msg.replace(/\{loc\}/g, inc.locName)}`, 'alert');
      state.fx.shake = Math.max(state.fx.shake, 4);
      state.uiDirty = true;
    }

    if (inc.sev >= 100 && inc.state === 'active') {
      catastrophe(state, inc);
    }
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
  state.score.catastrophes++;
  state.fx.shake = Math.max(state.fx.shake, 10);
  log(state, `💥 ${def.cat.msg.replace(/\{loc\}/g, inc.locName)}`, 'bad');
  removeIncident(state, inc);
}

export function resolveIncident(state, inc, good) {
  const def = inc.def;
  if (good) {
    state.score.resolved++;
    if (def.resolved) {
      applyEffects(state, def.resolved.effects);
      log(state, `✅ ${def.resolved.msg.replace(/\{loc\}/g, inc.locName)}`, 'good');
    }
  }
  removeIncident(state, inc);
}

function removeIncident(state, inc) {
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

export function log(state, msg, kind = 'info') {
  state.log.push({ t: state.time, msg, kind, id: uid() });
  if (state.log.length > 60) state.log.shift();
}

// ---------------------------------------------------------------- mayor's desk

export const DESK_ACTIONS = [
  { id: 'presser', label: 'Press Conference', icon: '📢', cost: 50, cd: 40, effects: { happiness: 5 }, quip: 'You hold a press conference. You say “synergy”. Somehow it helps.' },
  { id: 'funds', label: 'Fund Drive', icon: '💵', cost: 0, gain: 250, cd: 60, effects: { happiness: -4 }, quip: 'A “voluntary” fundraising gala. The string quartet was non-negotiable.' },
  { id: 'roads', label: 'Improve Roads', icon: '🛣️', cost: 250, cd: 45, effects: { infrastructure: 10 }, quip: 'Fresh asphalt! The city inhales that new-road smell.' },
  { id: 'utilities', label: 'Repair Utilities', icon: '🔧', cost: 200, cd: 45, effects: { infrastructure: 8, safety: 4 }, quip: 'Pipes patched, wires taped, one mystery valve left respectfully alone.' },
];

export function deskAction(state, id) {
  const act = DESK_ACTIONS.find((a) => a.id === id);
  if (!act) return;
  if ((state.cooldowns[id] || 0) > 0) return;
  state.stats.budget -= act.cost;
  if (act.gain) state.stats.budget += act.gain;
  state.score.spent += act.cost;
  applyEffects(state, act.effects);
  state.cooldowns[id] = act.cd;
  log(state, `${act.icon} ${act.quip}`, 'action');
  state.uiDirty = true;
}
