// City generation for Port Fiasco: tile grid, road network, named districts
// (residential / commercial / civic / industrial), special civic buildings
// and silly street/building names.

import { makeRng, key } from './utils.js';

export const TILE = 48;
export const GRID_W = 22;
export const GRID_H = 16;

export const ROAD_COLS = [3, 8, 13, 18];
export const ROAD_ROWS = [3, 7, 11];

const AVE_NAMES = ['Llama Avenue', 'Second Avenue', 'Civic Avenue', 'Pigeon Parkway'];
const ST_NAMES = ['Maple Street', 'High Street', 'Sinkhole Lane'];

const NAMES = {
  res: ['The Cosy Flats', 'Bumble Terrace', 'Sunnyside Homes', 'Wobbly Gables', 'The Snug', 'Pigeon View Apartments', 'Ordinary House', 'Duck Pond Villas', 'The Leaning Semis', 'Modest Manor', 'Casa Adequate', 'Twelve Chimneys'],
  shop: ["Bianchi's Bagels", 'Discount Umbrella Hut', 'The Sock Emporium', 'Chez Fancy', 'Waffle Depot', 'Big Kevin’s Electronics', 'The Suspicious Antique Shop', 'Yarn & Consequences', 'Pizza Solutions', 'The 24hr Cheese Kiosk', 'Books & Regret', 'Salon de Hairdo'],
  office: ['Synergy Tower', 'The Spreadsheet Building', 'Vague Consulting HQ', 'Initech West', 'The Beige Monolith', 'Bureaucracy Plaza', 'Meetings Unlimited', 'The Glass Rectangle', 'Paperwork Point'],
  park: ['Squirrel Commons', 'Damp Meadow Park', 'Memorial Shrub Garden', 'The Good Bench Park', 'Fountain of Mild Interest', 'Kite Accident Field'],
  civic: ['Civic Annex', 'Hall of Records', 'Department of Vibes', 'Municipal Depot'],
  factory: ['The Gizmo Works', 'Sprocket & Sons', 'Amalgamated Widgets', 'The Steam Concern', 'Novelty Anvil Co.', 'Bulk Soup Refinery'],
  warehouse: ['Warehouse 13½', 'Big Box Storage', 'Crate Expectations', 'The Forgotten Depot', 'Mystery Pallets Ltd.', 'Boxes About Town'],
};

const SPECIAL_META = {
  cityhall: { name: 'City Hall', h: 3 },
  fire: { name: 'Fire Station 7', h: 2 },
  police: { name: 'Police HQ', h: 2 },
  hospital: { name: 'St. Fiasco Hospital', h: 3 },
  power: { name: 'Power Plant', h: 2 },
  depot: { name: 'Public Works Depot', h: 1 },
};

// ------------------------------------------------------------ districts

// Block indices: bi 0..4 (5 column bands), bj 0..3 (4 row bands).
function districtFor(bi, bj) {
  if ((bi >= 3 && bj === 0) || (bi === 4 && bj === 1)) return { name: 'The Works', type: 'industrial' };
  if (bi === 2 && bj === 1) return { name: 'Civic Quarter', type: 'civic' };
  if (bi >= 1 && bi <= 3 && (bj === 1 || bj === 2)) return { name: 'Midtown', type: 'commercial' };
  if (bj === 0) return { name: 'Northside', type: 'residential' };
  if (bj === 3) return { name: 'Sunnyside', type: 'residential' };
  if (bi === 0) return { name: 'Westbrook', type: 'residential' };
  return { name: 'Eastfield', type: 'residential' };
}

function blockOf(x, y) {
  let bi = 0;
  for (const c of ROAD_COLS) if (x > c) bi++;
  let bj = 0;
  for (const r of ROAD_ROWS) if (y > r) bj++;
  return [bi, bj];
}

export function districtAt(city, x, y) {
  const t = tileAt(city, x, y);
  return t ? city.districts[t.district] : null;
}

export const DISTRICT_TYPE_LABEL = {
  residential: 'Residential', commercial: 'Commercial', civic: 'Civic', industrial: 'Industrial',
};

// ------------------------------------------------------------ generation

export function generateCity(seed) {
  const rng = makeRng(seed);
  const tiles = [];
  const roads = new Set();
  const districts = {};

  for (let y = 0; y < GRID_H; y++) {
    const row = [];
    for (let x = 0; x < GRID_W; x++) {
      const [bi, bj] = blockOf(x, y);
      const d = districtFor(bi, bj);
      if (!districts[d.name]) districts[d.name] = d;
      row.push({
        x, y, type: 'grass', variant: rng.next(), h: 0, name: '',
        special: null, broken: false, damaged: false, fountain: false,
        district: d.name,
      });
    }
    tiles.push(row);
  }

  // Roads
  for (const cx of ROAD_COLS) {
    for (let y = 0; y < GRID_H; y++) { tiles[y][cx].type = 'road'; roads.add(key(cx, y)); }
  }
  for (const ry of ROAD_ROWS) {
    for (let x = 0; x < GRID_W; x++) { tiles[ry][x].type = 'road'; roads.add(key(x, ry)); }
  }

  // Blocks between roads
  const colBounds = [-1, ...ROAD_COLS, GRID_W];
  const rowBounds = [-1, ...ROAD_ROWS, GRID_H];
  const nameUsed = {};
  const takeName = (t) => {
    const list = NAMES[t] || NAMES.res;
    nameUsed[t] = (nameUsed[t] || 0);
    const n = list[nameUsed[t] % list.length];
    nameUsed[t]++;
    return n;
  };

  const fillTile = (t, dtype, r) => {
    let bt = null;
    if (dtype === 'industrial') {
      if (r < 0.42) bt = 'factory';
      else if (r < 0.82) bt = 'warehouse';
      else if (r < 0.9) return; // gravel gap
      else bt = 'shop';
    } else if (dtype === 'civic') {
      if (r < 0.5) bt = 'civic';
      else if (r < 0.78) bt = 'park';
      else if (r < 0.9) bt = 'office';
      else bt = 'shop';
    } else if (dtype === 'commercial') {
      if (r < 0.45) bt = 'shop';
      else if (r < 0.85) bt = 'office';
      else if (r < 0.93) bt = 'park';
      else return;
    } else { // residential
      if (r < 0.7) bt = 'res';
      else if (r < 0.84) bt = 'park';
      else if (r < 0.92) bt = 'shop';
      else return;
    }
    t.type = bt;
    t.name = takeName(bt);
    t.h = bt === 'office' ? rngInt(rng, 2, 4)
      : bt === 'res' ? rngInt(rng, 1, 2)
      : bt === 'civic' ? 2
      : bt === 'factory' ? 2
      : 1;
  };

  for (let bi = 0; bi < colBounds.length - 1; bi++) {
    for (let bj = 0; bj < rowBounds.length - 1; bj++) {
      const x0 = colBounds[bi] + 1, x1 = colBounds[bi + 1] - 1;
      const y0 = rowBounds[bj] + 1, y1 = rowBounds[bj + 1] - 1;
      if (x1 < x0 || y1 < y0) continue;
      const d = districtFor(bi, bj);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          fillTile(tiles[y][x], d.type, rng.next());
        }
      }
    }
  }

  // Landmark fountain: first park tile in the Civic Quarter.
  outer:
  for (const row of tiles) {
    for (const t of row) {
      if (t.type === 'park' && t.district === 'Civic Quarter') { t.fountain = true; break outer; }
    }
  }

  // Special buildings — placed on a non-road tile adjacent to a road.
  const specials = {};
  const place = (id, px, py) => {
    let best = null, bestD = Infinity;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = tiles[y][x];
        if (t.type === 'road' || t.special || t.fountain) continue;
        if (!neighbors4(x, y).some(([nx, ny]) => roads.has(key(nx, ny)))) continue;
        const d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < bestD) { bestD = d; best = t; }
      }
    }
    if (best) {
      best.type = id === 'cityhall' ? 'civic' : id;
      best.special = id;
      best.name = SPECIAL_META[id].name;
      best.h = SPECIAL_META[id].h;
      specials[id] = { x: best.x, y: best.y };
    }
  };
  place('cityhall', 10, 5);
  place('fire', 6, 9);
  place('police', 15, 9);
  place('hospital', 10, 13);
  place('power', 20, 1);
  place('depot', 19, 5);

  return { seed, tiles, roads, specials, districts };
}

function rngInt(rng, a, b) { return rng.int(a, b); }

export function neighbors4(x, y) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H);
}

export const tileAt = (city, x, y) =>
  (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) ? city.tiles[y][x] : null;

export const isRoad = (city, x, y) => city.roads.has(key(x, y));

export function roadNeighbors(city, x, y) {
  return neighbors4(x, y).filter(([nx, ny]) => isRoad(city, nx, ny)).map(([nx, ny]) => ({ x: nx, y: ny }));
}

export function intersections(city) {
  const out = [];
  for (const k of city.roads) {
    const [x, y] = k.split(',').map(Number);
    if (roadNeighbors(city, x, y).length >= 3) out.push({ x, y });
  }
  return out;
}

// Nearest road tile that is 4-adjacent to the given tile (or the tile itself if road).
export function nearestRoadAdjacent(city, tile) {
  if (isRoad(city, tile.x, tile.y)) return { x: tile.x, y: tile.y };
  const adj = roadNeighbors(city, tile.x, tile.y);
  if (adj.length) return adj[0];
  const seen = new Set([key(tile.x, tile.y)]);
  const q = [[tile.x, tile.y]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [nx, ny] of neighbors4(x, y)) {
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      if (isRoad(city, nx, ny)) return { x: nx, y: ny };
      q.push([nx, ny]);
    }
  }
  return { x: tile.x, y: tile.y };
}

// BFS shortest path over road tiles. `blocked` is a Set of "x,y" keys to avoid
// (start and goal are always allowed).
export function findRoadPath(city, start, goal, blocked) {
  const sk = key(start.x, start.y), gk = key(goal.x, goal.y);
  if (sk === gk) return [start];
  const prev = new Map([[sk, null]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const n of roadNeighbors(city, cur.x, cur.y)) {
      const nk = key(n.x, n.y);
      if (prev.has(nk)) continue;
      if (blocked && blocked.has(nk) && nk !== gk) continue;
      prev.set(nk, cur);
      if (nk === gk) {
        const path = [n];
        let p = cur;
        while (p) { path.unshift(p); p = prev.get(key(p.x, p.y)); }
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

export function colName(x) {
  const i = ROAD_COLS.indexOf(x);
  return i >= 0 ? AVE_NAMES[i] : null;
}
export function rowName(y) {
  const i = ROAD_ROWS.indexOf(y);
  return i >= 0 ? ST_NAMES[i] : null;
}

// Human-readable location name for any tile.
export function locName(city, x, y) {
  const t = tileAt(city, x, y);
  if (!t) return 'the outskirts';
  if (t.type === 'road' || t.type === 'grass') {
    const c = colName(x), r = rowName(y);
    if (c && r) return `${c} & ${r}`;
    if (c) {
      let bestR = ST_NAMES[0], bd = Infinity;
      ROAD_ROWS.forEach((ry, i) => { const d = Math.abs(ry - y); if (d < bd) { bd = d; bestR = ST_NAMES[i]; } });
      return `${c} near ${bestR}`;
    }
    if (r) {
      let bestC = AVE_NAMES[0], bd = Infinity;
      ROAD_COLS.forEach((cx, i) => { const d = Math.abs(cx - x); if (d < bd) { bd = d; bestC = AVE_NAMES[i]; } });
      return `${r} near ${bestC}`;
    }
    return 'a quiet corner of town';
  }
  return t.name || 'an unnamed building';
}

// Descriptive blurb for the tile popup.
export function tileBlurb(t) {
  switch (t.type) {
    case 'res': return 'Residential. Rent is “reasonable” and the walls are “load-bearing enough”.';
    case 'shop': return 'A local business. Reviews range from ★☆☆☆☆ to ★★★★★, often for the same visit.';
    case 'office': return 'An office. Somewhere inside, a meeting that could have been an email is happening.';
    case 'park': return t.fountain
      ? 'The Fountain of Mild Interest. Wishes granted: none confirmed, two disputed.'
      : 'Green space. Home to squirrels with strong opinions.';
    case 'civic': return 'Municipal building. Smells faintly of laminated forms.';
    case 'factory': return 'A factory. Produces widgets, steam, and the occasional mystery clang.';
    case 'warehouse': return 'A warehouse. Contains boxes of boxes, in boxes.';
    case 'fire': return 'Fire Station 7. The crew is playing cards and pretending not to hope for action.';
    case 'police': return 'Police HQ. The donut budget is classified.';
    case 'hospital': return 'The hospital. Please stop testing the sinkhole with your bicycle.';
    case 'power': return 'The power plant. Do not lick anything in here.';
    case 'depot': return 'Public Works Depot. Where potholes go to be argued about.';
    case 'road': return t.damaged
      ? 'A damaged road. Driving here is now a percussion instrument.'
      : 'A road. Technically. The line between “road” and “suggestion” is thin here.';
    case 'rubble': return 'Rubble. This used to be a building. The city holds a small grudge.';
    default: return 'Grass. Municipal, load-bearing grass.';
  }
}

export const TYPE_LABEL = {
  res: 'Residential', shop: 'Shop', office: 'Office', park: 'Park', civic: 'Civic',
  factory: 'Factory', warehouse: 'Warehouse',
  fire: 'Fire Station', police: 'Police', hospital: 'Hospital', power: 'Utility',
  depot: 'Public Works', road: 'Road', grass: 'Open space', rubble: 'Rubble',
};
