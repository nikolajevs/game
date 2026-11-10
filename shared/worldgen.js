// Генерация острова и раскладка ресурсов по зерну (seed).
// Общий код: сервер строит по нему мир, браузер — превью.
import { MAP_W, MAP_H, TILE, T, RESOURCES, RAD, SITES, CITY } from './config.js';

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
  stampCity(tiles, seed);
  return tiles;
}

// ---- Мёртвый город ----
// Один на острове: круг асфальта (T.CITY) с сеткой улиц, кварталами полуразрушенных домов (T.WALL — их стены)
// и воронкой ядерного взрыва в центре. Чем ближе к воронке, тем меньше стен уцелело.
const cities = new WeakMap();
const hash3 = (a, b, c) => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function stampCity(tiles, seed) {
  const R = mulberry32(seed ^ 0x51c17e3);
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H ? T.DEEP : tiles[y * MAP_W + x]);
  // центр — там, где в радиусе города больше всего ровной суши
  const value = [-1.6, -1.6, 0.5, 1, 0.85, 0.2];
  let best = null;
  const span = Math.max(1, MAP_W - 2 * CITY.r - 20);
  const spanH = Math.max(1, MAP_H - 2 * CITY.r - 20);
  for (let i = 0; i < 400; i++) {
    const cx = CITY.r + 10 + Math.floor(R() * span);
    const cy = CITY.r + 10 + Math.floor(R() * spanH);
    if (at(cx, cy) < T.SAND) continue;
    let score = 0;
    for (let k = 0; k < 90; k++) {
      const a = k * 2.399963;
      const d = Math.sqrt((k + 0.5) / 90) * CITY.r;
      score += value[at(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d))];
    }
    if (!best || score > best.score) best = { cx, cy, score };
  }
  if (!best) return;
  const { cx, cy } = best;
  const edge = makeNoise(seed + 707);
  const ruin = makeNoise(seed + 808);
  const B = CITY.block;
  const lot = B - CITY.street; // сторона квартала без улицы
  const inCity = (x, y) => {
    const t = at(x, y);
    return t === T.CITY || t === T.WALL;
  };
  for (let y = cy - CITY.r - 2; y <= cy + CITY.r + 2; y++) {
    for (let x = cx - CITY.r - 2; x <= cx + CITY.r + 2; x++) {
      if (at(x, y) < T.SAND) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > CITY.r * (0.8 + 0.2 * edge(x / 16, y / 16, 2))) continue;
      tiles[y * MAP_W + x] = T.CITY;
    }
  }
  // стена дома уцелела? у воронки — почти ничего, на окраине — почти всё
  const wall = (x, y) => {
    if (!inCity(x, y)) return;
    const d = Math.hypot(x - cx, y - cy);
    if (d < CITY.crater + 5) return;
    const far = Math.min(1, (d - CITY.crater - 5) / (CITY.r * 0.75));
    const score = ruin(x / 4.5, y / 4.5, 2) * 0.6 + hash3(x, y, seed) * 0.4;
    if (score < 0.5 - far * 0.42) return;
    tiles[y * MAP_W + x] = T.WALL;
  };
  const house = (x0, y0, w, h, r) => {
    const doorX = x0 + 1 + Math.floor(r() * (w - 2));
    const doorY = y0 + 1 + Math.floor(r() * (h - 2));
    for (let x = x0; x < x0 + w; x++) {
      if (x !== doorX) wall(x, y0);
      if (x !== x0 + w - 1 - (doorX - x0)) wall(x, y0 + h - 1);
    }
    for (let y = y0 + 1; y < y0 + h - 1; y++) {
      if (y !== doorY) wall(x0, y);
      if (y !== y0 + h - 1 - (doorY - y0)) wall(x0 + w - 1, y);
    }
    // в большом доме — перегородка с проёмом
    if (w >= 7 && h >= 5) {
      const px = x0 + 3 + Math.floor(r() * (w - 6));
      const gap = y0 + 1 + Math.floor(r() * (h - 2));
      for (let y = y0 + 1; y < y0 + h - 1; y++) if (y !== gap) wall(px, y);
    }
  };
  const nb = Math.ceil(CITY.r / B) + 1;
  for (let by = -nb; by < nb; by++) {
    for (let bx = -nb; bx < nb; bx++) {
      const r = mulberry32((seed ^ Math.imul(bx + 977, 0x9e3779b1) ^ Math.imul(by + 331, 0x85ebca6b)) | 0);
      const x0 = cx + bx * B + CITY.street;
      const y0 = cy + by * B + CITY.street;
      const kind = r();
      const half = Math.floor((lot - 1) / 2);
      if (kind < 0.14) continue; // пустырь или площадь
      if (kind < 0.36) house(x0 + 1, y0 + 1, lot - 2, lot - 2, r);
      else if (kind < 0.58) {
        house(x0, y0, half, lot, r);
        house(x0 + half + 1, y0, lot - half - 1, lot, r);
      } else if (kind < 0.8) {
        house(x0, y0, lot, half, r);
        house(x0, y0 + half + 1, lot, lot - half - 1, r);
      } else {
        for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          if (r() < 0.2) continue;
          house(x0 + qx * (half + 1), y0 + qy * (half + 1), qx ? lot - half - 1 : half, qy ? lot - half - 1 : half, r);
        }
      }
    }
  }
  cities.set(tiles, { x: (cx + 0.5) * TILE, y: (cy + 0.5) * TILE, r: CITY.r * TILE, crater: CITY.crater * TILE });
}

// Где на карте мёртвый город: { x, y, r, crater } в единицах мира или null.
// Для карты, пришедшей с сервера целиком, центр находится по самим клеткам.
export function cityInfo(tiles) {
  if (cities.has(tiles)) return cities.get(tiles);
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== T.CITY && tiles[i] !== T.WALL) continue;
    sx += i % MAP_W;
    sy += Math.floor(i / MAP_W);
    n++;
  }
  const info = n ? { x: (Math.round(sx / n) + 0.5) * TILE, y: (Math.round(sy / n) + 0.5) * TILE, r: CITY.r * TILE, crater: CITY.crater * TILE } : null;
  cities.set(tiles, info);
  return info;
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
  // мёртвый город и воронка в его центре (воронка — первой: внутри неё точка считается воронкой)
  const city = cityInfo(tiles);
  if (city) {
    zones.push({ id: 0, kind: 'crater', x: city.x, y: city.y, r: city.crater + 5 * TILE, lvl: SITES.crater.lvl });
    zones.push({ id: 1, kind: 'city', x: city.x, y: city.y, r: city.r, lvl: SITES.city.lvl });
  }
  const special = zones.length;
  for (let tries = 0; tries < 6000 + RAD.zones * 400 && zones.length < RAD.zones + special; tries++) {
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
  place('shrine', (t) => t === T.GRASS, 0.7); // алтари выбора пути — на открытых лугах
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
      if (t === T.DEEP || t === T.SHALLOW || t === T.WALL) continue;
      const site = zoneAt(zones, x, y);
      if (site && site.kind !== 'ruins' && site.kind !== 'city' && Math.hypot(x - site.x, y - site.y) < 70) continue; // место под шахту/гнездо
      if (t === T.CITY) {
        // мёртвый город: остовы машин, серверные шкафы, груды металла и обломки; в воронке — только сияющие поганки
        if (site?.kind === 'crater') kind = r < 0.012 ? 'mush_glow' : r < 0.03 ? 'scrap' : null;
        else kind = r < 0.02 ? 'car' : r < 0.042 ? 'terminal' : r < 0.066 ? 'scrap' : r < 0.082 ? 'rock' : null;
      } else if (site?.kind === 'city' || site?.kind === 'crater') {
        kind = null; // клочки земли внутри города пусты
      } else if (site?.kind === 'mine') {
        // рудник: много руды, серы и металлолома
        kind = r < 0.17 ? (r2 < 0.45 ? 'sulfur' : 'rock') : r < 0.22 ? 'scrap' : null;
      } else if (site?.kind === 'shrine') {
        kind = r < 0.02 ? 'rock' : null; // вокруг алтаря выбора чисто
      } else if (site?.kind === 'altar') {
        // у алтаря: редкие камни, деревья и сияющие поганки
        kind = r < 0.03 ? 'rock' : r < 0.05 ? 'tree' : r < 0.056 ? 'mush_glow' : null;
      } else if (site?.kind === 'lair') {
        // вытоптанная поляна: редкие камни и деревья
        kind = r < 0.03 ? 'rock' : r < 0.05 ? 'tree' : null;
      } else if (site) {
        // в руинах растительности нет — металлолом, редкие камни и сияющие поганки
        kind = r < 0.08 ? 'scrap' : r < 0.1 ? 'rock' : r < 0.1015 ? 'mush_glow' : null;
      } else if (t === T.FOREST) {
        kind = r < 0.26 ? 'tree' : r < 0.29 ? 'bush' : r < 0.32 ? null : r < 0.34 ? 'rock' : r < 0.348 ? 'mush_brown' : r < 0.3495 ? 'mush_red' : null;
        // грибы — только в глубине леса, не на опушке у луга
        if ((kind === 'mush_brown' || kind === 'mush_red') && !(tiles[ty * MAP_W + tx - 1] === T.FOREST && tiles[ty * MAP_W + tx + 1] === T.FOREST
          && tiles[(ty - 1) * MAP_W + tx] === T.FOREST && tiles[(ty + 1) * MAP_W + tx] === T.FOREST)) kind = null;
      }
      else if (t === T.GRASS) kind = r < 0.035 ? 'tree' : r < 0.055 ? 'bush' : r < 0.075 ? null : r < 0.09 ? 'rock' : null;
      else if (t === T.ROCK) kind = r < 0.2 ? (r2 < 0.3 ? 'sulfur' : 'rock') : r < 0.23 ? 'tree' : null;
      else if (t === T.SAND) {
        // на песке: редкие камни и кактусы-пейотль, а у самой воды — сияющие жабы
        const shore = tiles[ty * MAP_W + tx - 1] === T.SHALLOW || tiles[ty * MAP_W + tx + 1] === T.SHALLOW
          || tiles[(ty - 1) * MAP_W + tx] === T.SHALLOW || tiles[(ty + 1) * MAP_W + tx] === T.SHALLOW;
        kind = r < 0.015 ? 'rock' : r < 0.021 ? 'cactus' : shore && r < 0.035 ? 'frog' : null;
      }
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
