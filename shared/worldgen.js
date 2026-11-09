// Генерация острова и раскладка ресурсов по зерну (seed).
// Общий код: сервер строит по нему мир, браузер — превью.
import { MAP_W, MAP_H, TILE, T, RESOURCES, RAD, SITES } from './config.js';

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
  // крупные черты большого острова: заливы и внутренние моря, хребты, обширные леса и равнины
  const macro = makeNoise(seed + 303);
  const ridge = makeNoise(seed + 404);
  const biome = makeNoise(seed + 505);
  const warp = makeNoise(seed + 606);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      // изрезанный берег: координаты для «круга острова» слегка искривлены
      const wx = (warp(x / 260, y / 260, 3) - 0.5) * 0.32;
      const wy = (warp(x / 260 + 37, y / 260 + 11, 3) - 0.5) * 0.32;
      const nx = x / MAP_W - 0.5 + wx;
      const ny = y / MAP_H - 0.5 + wy;
      const d = Math.sqrt(nx * nx + ny * ny) * 2;
      const big = macro(x / 170, y / 170, 3) - 0.5;
      const e = elev(x / 22, y / 22, 5) + 0.34 + big * 0.42 - Math.pow(d, 3) * 1.1;
      let t;
      if (e < 0.3) t = T.DEEP;
      else if (e < 0.36) t = T.SHALLOW;
      else if (e < 0.41) t = T.SAND;
      else {
        const m = moist(x / 16, y / 16, 4) * 0.55 + biome(x / 120, y / 120, 3) * 0.45;
        const r = rocky(x / 12, y / 12, 3);
        // хребты: узкие гребни крупного шума
        const rg = 1 - Math.abs(ridge(x / 110, y / 110, 3) * 2 - 1);
        if (e > 1.06 || r > 0.7 || (rg > 0.94 && e > 0.5) || (rg > 0.86 && r > 0.62)) t = T.ROCK;
        else if (m > 0.52) t = T.FOREST;
        else t = T.GRASS;
      }
      // по краю карты всегда глубина
      if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2) t = T.DEEP;
      tiles[y * MAP_W + x] = t;
    }
  }
  return tiles;
}

// Контрольная сумма карты (FNV-1a): клиент строит остров сам по зерну и сверяет её с сервером
export function tilesHash(tiles) {
  let h = 0x811c9dc5;
  for (let i = 0; i < tiles.length; i++) {
    h ^= tiles[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Особые места: радиоактивные руины, рудники и логова — круги на суше, далеко друг от друга.
// [{ id, kind, x, y, r, lvl }]; руины идут первыми (их раскладка не зависит от остальных мест).
export function generateZones(tiles, seed) {
  const R = mulberry32(seed ^ 0x2545f491);
  const HS = TILE / 2;
  const zones = [];
  const tileOf = (x, y) => {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.DEEP;
    return tiles[ty * MAP_W + tx];
  };
  const isLand = (x, y) => {
    const t = tileOf(x, y);
    return t !== T.DEEP && t !== T.SHALLOW;
  };
  for (let tries = 0; tries < 6000 + RAD.zones * 400 && zones.length < RAD.zones; tries++) {
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
    zones.push({ id: zones.length, kind: 'ruins', x, y, r: Math.round(r), lvl: 1 + Math.floor(R() * 3) });
  }
  // рудники — в скалах, логова — в лесу или у скал
  const R2 = mulberry32(seed ^ 0x68e31da4);
  const place = (kind, accept, minShare) => {
    const def = SITES[kind];
    let placed = 0;
    for (let tries = 0; tries < 8000 + def.count * 600 && placed < def.count; tries++) {
      const x = (12 + Math.floor(R2() * (MAP_W - 24))) * TILE + HS;
      const y = (12 + Math.floor(R2() * (MAP_H - 24))) * TILE + HS;
      if (!accept(tileOf(x, y))) continue;
      const r = def.r;
      let land = 0;
      let good = 0;
      let n = 0;
      for (let a = 0; a < 10; a++) {
        for (const k of [0.35, 0.8]) {
          const t = tileOf(x + Math.cos(a * 0.628) * r * k, y + Math.sin(a * 0.628) * r * k);
          n++;
          if (t !== T.DEEP && t !== T.SHALLOW) land++;
          if (accept(t)) good++;
        }
      }
      if (land / n < 0.92 || good / n < minShare) continue;
      if (zones.some((z) => Math.hypot(z.x - x, z.y - y) < z.r + r + 450)) continue;
      zones.push({ id: zones.length, kind, x, y, r, lvl: def.lvl });
      placed++;
    }
  };
  place('mine', (t) => t === T.ROCK, 0.4);
  place('lair', (t) => t === T.FOREST || t === T.ROCK, 0.55);
  place('altar', (t) => t === T.GRASS || t === T.FOREST, 0.6); // древние алтари — на лугах и в лесах
  return zones;
}

// Насколько точка внутри места: 1 в центральной части, к краю спадает до 0
export function zoneFalloff(z, x, y) {
  const d = Math.hypot(x - z.x, y - z.y);
  if (d >= z.r) return 0;
  return d < z.r * 0.6 ? 1 : (z.r - d) / (z.r * 0.4);
}

// Индекс мест по ячейкам: на большом острове их сотни, а проверять точку приходится очень часто
const ZONE_CELL = 800;
const zoneIndexes = new WeakMap();
function zonesNear(zones, x, y) {
  let idx = zoneIndexes.get(zones);
  if (!idx) {
    idx = new Map();
    for (const z of zones) {
      for (let i = Math.floor((z.x - z.r) / ZONE_CELL); i <= Math.floor((z.x + z.r) / ZONE_CELL); i++) {
        for (let j = Math.floor((z.y - z.r) / ZONE_CELL); j <= Math.floor((z.y + z.r) / ZONE_CELL); j++) {
          const key = i * 4096 + j;
          if (!idx.has(key)) idx.set(key, []);
          idx.get(key).push(z);
        }
      }
    }
    zoneIndexes.set(zones, idx);
  }
  return idx.get(Math.floor(x / ZONE_CELL) * 4096 + Math.floor(y / ZONE_CELL)) || EMPTY;
}
const EMPTY = [];

// Сила радиации в точке: 0 снаружи, до уровня зоны (1–3) ближе к центру
export function zoneStrength(zones, x, y) {
  let best = 0;
  for (const z of zonesNear(zones, x, y)) {
    if (!z.lvl) continue;
    best = Math.max(best, z.lvl * zoneFalloff(z, x, y));
  }
  return best;
}

export function zoneAt(zones, x, y) {
  return zonesNear(zones, x, y).find((z) => Math.hypot(x - z.x, y - z.y) < z.r) || null;
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
      const site = zoneAt(zones, x, y);
      if (site && site.kind !== 'ruins' && Math.hypot(x - site.x, y - site.y) < 70) continue; // место под шахту/гнездо
      if (site?.kind === 'mine') {
        // рудник: много руды, серы и металлолома
        kind = r < 0.17 ? (r2 < 0.45 ? 'sulfur' : 'rock') : r < 0.22 ? 'scrap' : null;
      } else if (site?.kind === 'altar') {
        // у алтаря: редкие камни, деревья и сияющие поганки
        kind = r < 0.03 ? 'rock' : r < 0.05 ? 'tree' : r < 0.062 ? 'mush_glow' : null;
      } else if (site?.kind === 'lair') {
        // вытоптанная поляна: редкие камни и деревья
        kind = r < 0.03 ? 'rock' : r < 0.05 ? 'tree' : null;
      } else if (site) {
        // в руинах растительности нет — металлолом, редкие камни и сияющие поганки
        kind = r < 0.08 ? 'scrap' : r < 0.1 ? 'rock' : r < 0.103 ? 'mush_glow' : null;
      } else if (t === T.FOREST) {
        kind = r < 0.26 ? 'tree' : r < 0.32 ? 'bush' : r < 0.34 ? 'rock' : r < 0.356 ? 'mush_brown' : r < 0.359 ? 'mush_red' : null;
        // грибы — только в глубине леса, не на опушке у луга
        if ((kind === 'mush_brown' || kind === 'mush_red') && !(tiles[ty * MAP_W + tx - 1] === T.FOREST && tiles[ty * MAP_W + tx + 1] === T.FOREST
          && tiles[(ty - 1) * MAP_W + tx] === T.FOREST && tiles[(ty + 1) * MAP_W + tx] === T.FOREST)) kind = null;
      }
      else if (t === T.GRASS) kind = r < 0.035 ? 'tree' : r < 0.075 ? 'bush' : r < 0.09 ? 'rock' : null;
      else if (t === T.ROCK) kind = r < 0.2 ? (r2 < 0.3 ? 'sulfur' : 'rock') : r < 0.23 ? 'tree' : null;
      else if (t === T.SAND) kind = r < 0.015 ? 'rock' : null;
      if (!kind || (kind === 'tree' && t === T.ROCK)) continue;
      if (kind === 'tree' || kind === 'bush' || kind === 'mush_brown' || kind === 'mush_red') {
        // растения — только если вокруг тоже луг или лес, а не пляж, вода или скалы
        let bare = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nt = tiles[(ty + dy) * MAP_W + tx + dx];
          if (nt !== T.GRASS && nt !== T.FOREST) bare = true;
        }
        if (bare && !site) continue;
      }
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
