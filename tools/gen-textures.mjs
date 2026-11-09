// Бесшовные процедурные текстуры песка и скалы для рельефа (public/assets/textures).
// RGB — «детальный» цвет (около 0,9 в среднем, оттенок даёт цвет вершин рельефа), A — высота для рельефа (bump).
// Пересоздать: npm install --no-save sharp && node tools/gen-textures.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'textures');
const N = 1024;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Периодический градиентный шум: решётка повторяется с периодом P — текстура стыкуется без швов
function makeNoise(seed) {
  const r = rng(seed);
  const G = new Float32Array(512 * 2);
  for (let i = 0; i < 512; i++) {
    const a = r() * Math.PI * 2;
    G[i * 2] = Math.cos(a);
    G[i * 2 + 1] = Math.sin(a);
  }
  const perm = new Uint16Array(1024);
  for (let i = 0; i < 1024; i++) perm[i] = Math.floor(r() * 512);
  const hash = (x, y) => perm[(perm[x & 1023] + y) & 1023];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, P) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const g = (cx, cy, dx, dy) => {
      const h = hash(((cx % P) + P) % P, ((cy % P) + P) % P) * 2;
      return G[h] * dx + G[h + 1] * dy;
    };
    const u = fade(fx);
    const v = fade(fy);
    const a = g(ix, iy, fx, fy);
    const b = g(ix + 1, iy, fx - 1, fy);
    const c = g(ix, iy + 1, fx, fy - 1);
    const d = g(ix + 1, iy + 1, fx - 1, fy - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4; // ≈ -1..1
  };
}

function fbm(n, u, v, P, oct, ridged = false) {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    const p = P << o;
    let x = n(u * p, v * p, p);
    if (ridged) x = 1 - Math.abs(x) * 2 - 0.0, x = x * x;
    else x = x * 0.5 + 0.5;
    s += x * amp;
    norm += amp;
    amp *= 0.5;
  }
  return s / norm;
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// освещение рельефа «вшито» в цвет: нормаль из высоты, свет сверху-слева
function shade(H, strength, light = [-0.5, -0.55, 0.67]) {
  const S = new Float32Array(N * N);
  const ln = Math.hypot(...light);
  const L = light.map((x) => x / ln);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const hx = H[j * N + ((i + 1) % N)] - H[j * N + ((i - 1 + N) % N)];
      const hy = H[((j + 1) % N) * N + i] - H[((j - 1 + N) % N) * N + i];
      const nx = -hx * strength;
      const ny = -hy * strength;
      const nl = Math.hypot(nx, ny, 1);
      S[j * N + i] = (nx * L[0] + ny * L[1] + L[2]) / nl;
    }
  }
  return S;
}

async function save(name, H, C) {
  const buf = Buffer.alloc(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    buf[k * 4] = Math.round(clamp(C[k * 3]) * 255);
    buf[k * 4 + 1] = Math.round(clamp(C[k * 3 + 1]) * 255);
    buf[k * 4 + 2] = Math.round(clamp(C[k * 3 + 2]) * 255);
    buf[k * 4 + 3] = Math.round(clamp(H[k]) * 255);
  }
  await sharp(buf, { raw: { width: N, height: N, channels: 4 } }).webp({ quality: 88, alphaQuality: 90 }).toFile(`${OUT}/${name}.webp`);
}

// ---------- песок: рябь от ветра, мелкое зерно, крупинки ----------
{
  const n1 = makeNoise(11);
  const n2 = makeNoise(12);
  const n3 = makeNoise(13);
  const R = rng(99);
  const H = new Float32Array(N * N);
  const L0 = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const v = j / N;
      const warp = fbm(n1, u, v, 3, 3);
      // рябь: целые частоты по осям — бесшовно; асимметричный профиль, как у настоящих волн песка
      const ph = 2 * Math.PI * (11 * u + 4 * v) + warp * 7;
      const rip = Math.pow(0.5 + 0.5 * Math.sin(ph + 0.6 * Math.sin(ph)), 1.5);
      const ripMask = clamp((fbm(n3, u, v, 2, 2) - 0.35) * 2.2); // местами рябь сглажена
      const med = fbm(n2, u, v, 8, 4);
      const grain = fbm(n3, u, v, 128, 2);
      const h = 0.42 * rip * ripMask + 0.33 * med + 0.25 * grain;
      H[j * N + i] = h;
      L0[j * N + i] = 0.9 + (med - 0.5) * 0.22 + (grain - 0.5) * 0.28 + (R() - 0.5) * 0.07;
    }
  }
  const S = shade(H, 26);
  const C = new Float32Array(N * N * 3);
  for (let k = 0; k < N * N; k++) {
    let l = L0[k] * (0.72 + 0.38 * S[k]);
    let tint = [1.0, 0.975, 0.93];
    const sp = R();
    if (sp < 0.006) l *= 0.6; // тёмные крупинки
    else if (sp < 0.01) { l *= 1.12; tint = [1.02, 1.0, 0.98]; } // светлые песчинки и осколки ракушек
    C[k * 3] = l * tint[0];
    C[k * 3 + 1] = l * tint[1];
    C[k * 3 + 2] = l * tint[2];
  }
  await save('sand', H, C);
}

// ---------- скала: угловатые сколы (ячейки Вороного), трещины по их краям, слои и лишайник ----------
// Периодический шум Вороного: возвращает [F1, F2, номер ячейки]
function makeWorley(seed, G) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < G * G; i++) pts.push([r(), r(), r()]);
  return (u, v) => {
    const x = u * G;
    const y = v * G;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const p = pts[(((cy % G) + G) % G) * G + (((cx % G) + G) % G)];
        const d = Math.hypot(cx + p[0] - x, cy + p[1] - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = p[2];
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2, id];
  };
}
{
  const n1 = makeNoise(21);
  const n2 = makeNoise(22);
  const n4 = makeNoise(24);
  const w1 = makeWorley(31, 6); // крупные сколы
  const w2 = makeWorley(32, 17); // мелкие
  const R = rng(77);
  const H = new Float32Array(N * N);
  const L0 = new Float32Array(N * N);
  const Lich = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const v = j / N;
      const warp = fbm(n1, u, v, 2, 3);
      // края ячеек чуть искривлены шумом — трещины не идеально прямые
      const wu = u + (fbm(n2, u, v, 8, 2) - 0.5) * 0.02;
      const wv = v + (fbm(n2, u + 0.5, v + 0.5, 8, 2) - 0.5) * 0.02;
      const [a1, a2, aid] = w1(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1);
      const [b1, b2] = w2(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1);
      const mask = clamp((fbm(n4, u + 0.21, v + 0.63, 3, 3) - 0.38) * 3); // где трещины есть, а где — сплошной камень
      const crackBig = (1 - clamp((a2 - a1) / 0.06)) * mask;
      const crackSmall = (1 - clamp((b2 - b1) / 0.03)) * mask * mask * 0.3;
      const crack = Math.max(crackBig, crackSmall);
      const ridge = fbm(n2, u, v, 4, 5, true);
      const strata = 0.5 + 0.5 * Math.sin(2 * Math.PI * (5 * v + 1 * u) + warp * 5);
      const med = fbm(n4, u, v, 6, 4);
      const grain = fbm(n4, u, v, 96, 2);
      // каждый скол — немного своего тона и наклона
      const facet = (aid - 0.5) * 0.12 + (a1 - 0.4) * 0.12;
      const h = 0.35 * ridge + 0.15 * strata + 0.2 * med + 0.12 * grain + facet - 0.4 * crack;
      H[j * N + i] = clamp(h + 0.25);
      L0[j * N + i] = 0.87 + (ridge - 0.5) * 0.22 + (strata - 0.5) * 0.16 + (grain - 0.5) * 0.22 + facet * 0.9 - crack * 0.42 + (R() - 0.5) * 0.06;
      Lich[j * N + i] = clamp((fbm(n1, u + 0.37, v + 0.71, 5, 4) - 0.6) * 4) * (1 - crack);
    }
  }
  const S = shade(H, 30);
  const C = new Float32Array(N * N * 3);
  for (let k = 0; k < N * N; k++) {
    const l = L0[k] * (0.7 + 0.4 * S[k]);
    const li = Lich[k] * 0.45; // лишайник: зеленовато-жёлтые пятна
    C[k * 3] = l * (1 - li * 0.15);
    C[k * 3 + 1] = l * (1 + li * 0.05);
    C[k * 3 + 2] = l * (1 - li * 0.45);
  }
  await save('rock', H, C);
}
// ---------- вода: карта нормалей ряби (RGB = нормаль, z вверх), бесшовная ----------
{
  const W = 512;
  const n1 = makeNoise(41);
  const n2 = makeNoise(42);
  const H = new Float32Array(W * W);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const u = i / W;
      const v = j / W;
      // мягкие волны + острые гребешки ряби
      const soft = fbm(n1, u, v, 3, 4);
      const crest = fbm(n2, u, v, 6, 3, true);
      H[j * W + i] = soft * 0.6 + crest * 0.4;
    }
  }
  const buf = Buffer.alloc(W * W * 3);
  const k = 6.5;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const hx = H[j * W + ((i + 1) % W)] - H[j * W + ((i - 1 + W) % W)];
      const hy = H[((j + 1) % W) * W + i] - H[((j - 1 + W) % W) * W + i];
      let nx = -hx * k;
      let ny = -hy * k;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (j * W + i) * 3;
      buf[o] = Math.round((nx * 0.5 + 0.5) * 255);
      buf[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      buf[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  await sharp(buf, { raw: { width: W, height: W, channels: 3 } }).webp({ quality: 92 }).toFile(`${OUT}/water_normal.webp`);
}
console.log('done');
