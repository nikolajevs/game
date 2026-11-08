// Генерация острова и раскладка ресурсов по зерну (seed).
// Общий код: сервер строит по нему мир, браузер — превью.
import { MAP_W, MAP_H, TILE, T, RESOURCES } from './config.js';

export function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Плавный value-noise с октавами, результат примерно 0..1
export function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rand();
  const lattice = (ix, iy) => vals[perm[(perm[ix & 255] + iy) & 511] & 255];
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = lattice(ix, iy);
    const b = lattice(ix + 1, iy);
    const c = lattice(ix, iy + 1);
    const d = lattice(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  return function fbm(x, y, oct = 4) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

export function generateMap(seed) {
  const elev = makeNoise(seed);
  const moist = makeNoise(seed + 101);
  const rocky = makeNoise(seed + 202);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const nx = x / MAP_W - 0.5;
      const ny = y / MAP_H - 0.5;
      const d = Math.sqrt(nx * nx + ny * ny) * 2;
      const e = elev(x / 22, y / 22, 5) + 0.32 - Math.pow(d, 3) * 1.1;
      let t;
      if (e < 0.3) t = T.DEEP;
      else if (e < 0.36) t = T.SHALLOW;
      else if (e < 0.41) t = T.SAND;
      else {
        const m = moist(x / 16, y / 16, 4);
        const r = rocky(x / 12, y / 12, 3);
        if (e > 0.98 || r > 0.68) t = T.ROCK;
        else if (m > 0.53) t = T.FOREST;
        else t = T.GRASS;
      }
      // по краю карты всегда глубина
      if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2) t = T.DEEP;
      tiles[y * MAP_W + x] = t;
    }
  }
  return tiles;
}

// Раскладка деревьев, камней и кустов. Возвращает [{ kind, x, y, v }]
export function generateResources(tiles, seed) {
  const R = mulberry32(seed ^ 0x5bd1e995);
  const out = [];
  const cell = 80;
  const buckets = new Map();
  const key = (cx, cy) => cx * 65536 + cy;
  const HS = TILE / 2;
  for (let ty = 2; ty < MAP_H - 2; ty++) {
    for (let tx = 2; tx < MAP_W - 2; tx++) {
      const t = tiles[ty * MAP_W + tx];
      const r = R();
      let kind = null;
      if (t === T.FOREST) kind = r < 0.26 ? 'tree' : r < 0.32 ? 'bush' : r < 0.34 ? 'rock' : null;
      else if (t === T.GRASS) kind = r < 0.035 ? 'tree' : r < 0.075 ? 'bush' : r < 0.09 ? 'rock' : null;
      else if (t === T.ROCK) kind = r < 0.2 ? 'rock' : r < 0.23 ? 'tree' : null;
      else if (t === T.SAND) kind = r < 0.015 ? 'rock' : null;
      const x = tx * TILE + HS + (R() - 0.5) * TILE * 0.6;
      const y = ty * TILE + HS + (R() - 0.5) * TILE * 0.6;
      const v = R();
      if (!kind) continue;
      const def = RESOURCES[kind];
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let blocked = false;
      for (let dy = -1; dy <= 1 && !blocked; dy++) {
        for (let dx = -1; dx <= 1 && !blocked; dx++) {
          const arr = buckets.get(key(cx + dx, cy + dy));
          if (!arr) continue;
          for (const o of arr) {
            if (Math.hypot(o.x - x, o.y - y) < (RESOURCES[o.kind].r + def.r) * 0.7) {
              blocked = true;
              break;
            }
          }
        }
      }
      if (blocked) continue;
      const o = { kind, x, y, v: Math.round(v * 1000) / 1000 };
      out.push(o);
      const k = key(cx, cy);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(o);
    }
  }
  return out;
}
