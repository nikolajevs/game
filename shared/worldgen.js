// Генерация острова и раскладка ресурсов по зерну (seed).
// Общий код: сервер строит по нему мир, браузер — превью.
import { MAP_W, MAP_H, TILE, T, RESOURCES, RAD } from './config.js';

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

// Радиационные зоны (руины): круги на суше, далеко друг от друга. [{ id, x, y, r, lvl }]
export function generateZones(tiles, seed) {
  const R = mulberry32(seed ^ 0x2545f491);
  const HS = TILE / 2;
  const zones = [];
  const isLand = (x, y) => {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    const t = tiles[ty * MAP_W + tx];
    return t !== T.DEEP && t !== T.SHALLOW;
  };
  for (let tries = 0; tries < 6000 && zones.length < RAD.zones; tries++) {
    const x = (15 + Math.floor(R() * (MAP_W - 30))) * TILE + HS;
    const y = (15 + Math.floor(R() * (MAP_H - 30))) * TILE + HS;
    const r = 260 + R() * 140;
    let land = isLand(x, y) ? 1 : 0;
    let n = 1;
    for (let a = 0; a < 8; a++) {
      for (const k of [0.4, 0.85]) {
        n++;
        if (isLand(x + Math.cos(a * 0.785) * r * k, y + Math.sin(a * 0.785) * r * k)) land++;
      }
    }
    if (land / n < 0.88) continue;
    if (zones.some((z) => Math.hypot(z.x - x, z.y - y) < z.r + r + 700)) continue;
    zones.push({ id: zones.length, x, y, r: Math.round(r), lvl: 1 + Math.floor(R() * 3) });
  }
  return zones;
}

// Сила радиации в точке: 0 снаружи, до уровня зоны (1–3) ближе к центру
export function zoneStrength(zones, x, y) {
  let best = 0;
  for (const z of zones) {
    const d = Math.hypot(x - z.x, y - z.y);
    if (d >= z.r) continue;
    const k = d < z.r * 0.6 ? 1 : (z.r - d) / (z.r * 0.4);
    best = Math.max(best, z.lvl * k);
  }
  return best;
}

export function zoneAt(zones, x, y) {
  return zones.find((z) => Math.hypot(x - z.x, y - z.y) < z.r) || null;
}

// Раскладка деревьев, камней, кустов, серы и металлолома. Возвращает [{ kind, x, y, v }]
export function generateResources(tiles, seed, zones = []) {
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
      const r2 = R();
      const x = tx * TILE + HS + (R() - 0.5) * TILE * 0.6;
      const y = ty * TILE + HS + (R() - 0.5) * TILE * 0.6;
      const v = R();
      let kind = null;
      if (t === T.DEEP || t === T.SHALLOW) continue;
      if (zoneAt(zones, x, y)) {
        // в руинах растительности нет — только металлолом и редкие камни
        kind = r < 0.08 ? 'scrap' : r < 0.1 ? 'rock' : null;
      } else if (t === T.FOREST) kind = r < 0.26 ? 'tree' : r < 0.32 ? 'bush' : r < 0.34 ? 'rock' : null;
      else if (t === T.GRASS) kind = r < 0.035 ? 'tree' : r < 0.075 ? 'bush' : r < 0.09 ? 'rock' : null;
      else if (t === T.ROCK) kind = r < 0.2 ? (r2 < 0.3 ? 'sulfur' : 'rock') : r < 0.23 ? 'tree' : null;
      else if (t === T.SAND) kind = r < 0.015 ? 'rock' : null;
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
