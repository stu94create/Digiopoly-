// Small shared helpers. No dependencies.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const key = (x, y) => x + ',' + y;

// Deterministic RNG (mulberry32) for city generation.
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

// Non-deterministic helpers for runtime FX / gameplay variety.
export const rnd = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const irnd = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

export const fmtMoney = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

let _uid = 1;
export const uid = () => _uid++;
