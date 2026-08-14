// City generation for Port Fiasco: tile grid, road network, districts,
// special civic buildings and silly street/building names.

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
};

const SPECIAL_META = {
  cityhall: { name: 'City Hall', h: 3 },
  fire: { name: 'Fire Station 7', h: 2 },
  police: { name: 'Police HQ', h: 2 },
  hospital: { name: 'St. Fiasco Hospital', h: 3 },
  power: { name: 'Power Plant', h: 2 },
  depot: { name: 'Public Works Depot', h: 1 },
};

export function generateCity(seed) {
  const rng = makeRng(seed);
  const tiles = [];
  const roads = new Set();

  for (let y = 0; y < GRID_H; y++) {
    const row = [];
    for (let x = 0; x < GRID_W; x++) {
      row.push({ x, y, type: 'grass', variant: rng.next(), h: 0, name: '', special: null, broken: false });
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

  for (let bi = 0; bi < colBounds.length - 1; bi++) {
    for (let bj = 0; bj < rowBounds.length - 1; bj++) {
      const x0 = colBounds[bi] + 1, x1 = colBounds[bi + 1] - 1;
      const y0 = rowBounds[bj] + 1, y1 = rowBounds[bj + 1] - 1;
      if (x1 < x0 || y1 < y0) continue;

      const centerish = bi >= 1 && bi <= 3 && bj >= 1 && bj <= 2;
      let district;
      if (centerish) district = rng.pick(['shop', 'office', 'shop', 'civic']);
      else district = rng.chance(0.18) ? 'park' : 'res';

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = tiles[y][x];
          if (district === 'park') {
            t.type = 'park';
            t.name = takeName('park');
            continue;
          }
          const r = rng.next();
          if (r < 0.1) { t.type = 'park'; t.name = takeName('park'); continue; }
          if (r < 0.16) { continue; } // leave a grassy gap
          let bt = district;
          if (district === 'res' && r > 0.9) bt = 'shop';
          if (district === 'shop' && r > 0.85) bt = 'office';
          if (district === 'civic' && r > 0.5) bt = rng.pick(['office', 'shop']);
          t.type = bt;
          t.name = takeName(bt);
          t.h = bt === 'office' ? rng.int(2, 4) : bt === 'res' ? rng.int(1, 2) : bt === 'civic' ? 2 : 1;
        }
      }
    }
  }

  // Special buildings — placed on a non-road tile adjacent to a road.
  const specials = {};
  const place = (id, px, py) => {
    let best = null, bestD = Infinity;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const t = tiles[y][x];
        if (t.type === 'road' || t.special) continue;
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
  place('depot', 2, 13);

  return { seed, tiles, roads, specials };
}

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
  // BFS outward across all tiles until we hit a road.
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
    case 'park': return 'Green space. Home to squirrels with strong opinions.';
    case 'civic': return 'Municipal building. Smells faintly of laminated forms.';
    case 'fire': return 'Fire Station 7. The crew is playing cards and pretending not to hope for action.';
    case 'police': return 'Police HQ. The donut budget is classified.';
    case 'hospital': return 'The hospital. Please stop testing the sinkhole with your bicycle.';
    case 'power': return 'The power plant. Do not lick anything in here.';
    case 'depot': return 'Public Works Depot. Where potholes go to be argued about.';
    case 'road': return 'A road. Technically. The line between “road” and “suggestion” is thin here.';
    case 'rubble': return 'Rubble. This used to be a building. The city holds a small grudge.';
    default: return 'Grass. Municipal, load-bearing grass.';
  }
}

export const TYPE_LABEL = {
  res: 'Residential', shop: 'Shop', office: 'Office', park: 'Park', civic: 'Civic',
  fire: 'Fire Station', police: 'Police', hospital: 'Hospital', power: 'Utility',
  depot: 'Public Works', road: 'Road', grass: 'Open space', rubble: 'Rubble',
};
