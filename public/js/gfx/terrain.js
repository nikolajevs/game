// Low-poly рельеф острова, вода и морское дно.
// Высоты чисто визуальные: игровая логика на сервере плоская (x, y).
// Рельеф нарезан на участки: рисуются только видимые и не слишком далёкие.
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T } from '/shared/config.js';
import { makeNoise, zoneAt, zoneFalloff } from '/shared/worldgen.js';
import { surfaceTextures, TRIPLANAR_GLSL } from './surfaces.js';
import { Water } from './water.js';

const SAND_SCALE = 150; // сколько единиц мира на один повтор текстуры песка
const ROCK_SCALE = 210; // и скалы
const GRASS_SCALE = 70; // мелкий травяной ковёр (и он же крупно — против заметных повторов)
// средний линейный цвет текстур травы и земли — делим на него, чтобы текстура давала фактуру, не меняя оттенок
const GRASS_MEAN = 'vec3(0.0677, 0.0748, 0.0344)';

// Песок и скала поверх цвета вершин: вес каждого — атрибут вершины biome (x — песок, y — скала).
// Скала — трипланарно (на склонах не растягивается), рельеф поверхности — из высот текстур (bump).
function applyTerrainSurfaces(material) {
  const { sand, rock, grass, dirt } = surfaceTextures();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uRock = { value: rock };
    shader.uniforms.uGrass = { value: grass };
    shader.uniforms.uDirt = { value: dirt };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 biome;\nvarying vec3 vBiome;\nvarying vec3 vTerrWP;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vBiome = biome;
        vTerrWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    const heightFn = `
      uniform sampler2D uSand;
      uniform sampler2D uRock;
      uniform sampler2D uGrass;
      uniform sampler2D uDirt;
      varying vec3 vBiome;
      varying vec3 vTerrWP;
      ${TRIPLANAR_GLSL}
      // высота поверхности: общая мелкая фактура, песок (рябь и зерно), скала (сколы и трещины)
      float terrainHeight(vec2 uvD, vec3 wp, vec3 tw) {
        float h = texture2D(bumpMap, uvD).x;
        float hs = texture2D(uSand, wp.xz / ${SAND_SCALE.toFixed(1)}).a;
        float hr = triSample(uRock, wp, ${ROCK_SCALE.toFixed(1)}, tw).a;
        float green = clamp(1.0 - vBiome.x - vBiome.y, 0.0, 1.0);
        float hg = dot(texture2D(uGrass, wp.xz / ${GRASS_SCALE.toFixed(1)}).rgb, vec3(4.0));
        h = mix(h, hg * 0.9, green * 0.6);
        h = mix(h, hs * 1.8, vBiome.x);
        h = mix(h, hr * 3.2, vBiome.y);
        return h;
      }
    `;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <bumpmap_pars_fragment>', `#ifdef USE_BUMPMAP
        uniform sampler2D bumpMap;
        uniform float bumpScale;
        ${heightFn}
        vec2 dHdxy_fwd() {
          vec3 tw = triWeights(vTerrWP);
          vec2 dSTdx = dFdx(vBumpMapUv);
          vec2 dSTdy = dFdy(vBumpMapUv);
          vec3 dPdx = dFdx(vTerrWP);
          vec3 dPdy = dFdy(vTerrWP);
          float Hll = bumpScale * terrainHeight(vBumpMapUv, vTerrWP, tw);
          float dBx = bumpScale * terrainHeight(vBumpMapUv + dSTdx, vTerrWP + dPdx, tw) - Hll;
          float dBy = bumpScale * terrainHeight(vBumpMapUv + dSTdy, vTerrWP + dPdy, tw) - Hll;
          return vec2(dBx, dBy);
        }
        vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
          vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
          vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
          vec3 vN = surf_norm;
          vec3 R1 = cross(vSigmaY, vN);
          vec3 R2 = cross(vN, vSigmaX);
          float fDet = dot(vSigmaX, R1) * faceDirection;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
          return normalize(abs(fDet) * surf_norm - vGrad);
        }
      #endif`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec3 detail = texture2D(map, vMapUv).rgb;
        vec3 sandC = texture2D(uSand, vTerrWP.xz / ${SAND_SCALE.toFixed(1)}).rgb * 1.1;
        vec3 rockC = triSample(uRock, vTerrWP, ${ROCK_SCALE.toFixed(1)}, triWeights(vTerrWP)).rgb * 1.12;
        // зелёная часть: травяной ковёр ez-tree; крупная копия той же текстуры прячет повторы
        float green = clamp(1.0 - vBiome.x - vBiome.y, 0.0, 1.0);
        vec3 gFine = texture2D(uGrass, vTerrWP.xz / ${GRASS_SCALE.toFixed(1)}).rgb / ${GRASS_MEAN};
        vec3 gBig = texture2D(uGrass, vTerrWP.xz / ${(GRASS_SCALE * 7.3).toFixed(1)} + 0.37).rgb / ${GRASS_MEAN};
        vec3 grassD = mix(vec3(1.0), clamp(gFine * mix(vec3(1.0), gBig, 0.4), 0.0, 2.6), 0.6) * 0.96;
        detail = mix(detail, grassD, green);
        detail = mix(detail, sandC, vBiome.x);
        detail = mix(detail, rockC, vBiome.y);
        diffuseColor.rgb *= detail;
        // лесная подстилка: в лесу местами проступает земля
        float patches = smoothstep(0.42, 0.68, texture2D(uRock, vTerrWP.xz / 1600.0).a);
        float dirtMask = vBiome.z * green * (0.25 + 0.55 * patches);
        diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uDirt, vTerrWP.xz / 95.0).rgb * 1.45, dirtMask);
      #endif`);
  };
  material.customProgramCacheKey = () => 'terrain-surfaces-v2';
}
import { hash2 } from './util.js';

// 2 вершины на клетку: на большом острове 3 дали бы ~3 млн вершин и сотни МБ памяти
const RES = 2;
export const CELL = TILE / RES;
const GW = MAP_W * RES + 1;
const GH = MAP_H * RES + 1;
const CHUNK_CELLS = 48; // клеток сетки в стороне участка
const BASE_H = [-46, -13, 4, 12, 16, 26, 13, 13];
// луг чуть темнее и спокойнее — под цвет травы ez-tree, чтобы вдали, где пучков меньше, не было пятен
const TILE_COL = ['#1b4f63', '#3c8a86', '#e3d09a', '#679b42', '#3f8040', '#8f8e86', '#5d5a55', '#55524e'];
const isCity = (t) => t === T.CITY || t === T.WALL;
const GLASS = new THREE.Color('#26221e'); // оплавленная земля воронки
const BEACH = new THREE.Color('#e8d7a2');
const CLIFF = new THREE.Color('#7d7a72');
const SNOWY = new THREE.Color('#b9b8b0');
const DRY = new THREE.Color('#9fa65a');
const LUSH = new THREE.Color('#3f8a45');
const WASTE = new THREE.Color('#857f55'); // выжженная земля радиационных зон
const ASH = new THREE.Color('#5c5848');
const DUST = new THREE.Color('#7f7564'); // пыль и отвалы рудника
const TRAMPLED = new THREE.Color('#54452f'); // вытоптанная земля логова
const MOSS = new THREE.Color('#3f5f3a'); // мшистая земля у древних алтарей
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Процедурная бесшовная текстура поверхности (светлота) и карта неровностей
const TEXTURE_SIZE = 256;
const TEXTURE_WORLD_SIZE = 220;
function makeSurfaceTextures() {
  const colorData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const heightData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const tau = Math.PI * 2;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    const v = y / TEXTURE_SIZE;
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const u = x / TEXTURE_SIZE;
      // целые частоты — узор стыкуется на краях
      const broad = (Math.sin(tau * (3 * u + 2 * v) + 0.2) + Math.cos(tau * (2 * u - 4 * v) + 1.8)) * 0.5;
      const medium = Math.sin(tau * (11 * u + 7 * v) + 1.2) * Math.cos(tau * (13 * u - 9 * v) + 0.3);
      const fine = Math.sin(tau * (37 * u + 29 * v) + 0.8) * Math.cos(tau * (31 * u - 43 * v) + 0.6);
      const grain = Math.sin(tau * (73 * u + 61 * v) + 0.5) * Math.cos(tau * (67 * u - 59 * v) + 2.1);
      const index = (y * TEXTURE_SIZE + x) * 4;
      const albedo = Math.max(0, Math.min(255, Math.round(240 + broad * 4 + medium * 3 + fine * 3 + grain * 2)));
      const height = Math.max(0, Math.min(255, Math.round(128 + broad * 14 + medium * 16 + fine * 22 + grain * 14)));
      for (let ch = 0; ch < 3; ch++) {
        colorData[index + ch] = albedo;
        heightData[index + ch] = height;
      }
      colorData[index + 3] = 255;
      heightData[index + 3] = 255;
    }
  }
  const makeTexture = (data, colorSpace = THREE.NoColorSpace) => {
    const texture = new THREE.DataTexture(data, TEXTURE_SIZE, TEXTURE_SIZE, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.colorSpace = colorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  return { color: makeTexture(colorData, THREE.SRGBColorSpace), height: makeTexture(heightData) };
}

// Рельеф большого острова считается участками по требованию: высоты — при первом обращении
// к участку, сетка — когда участок попадает в поле зрения; дальние сетки выгружаются.
const NCI = Math.ceil((GW - 1) / CHUNK_CELLS);
const NCJ = Math.ceil((GH - 1) / CHUNK_CELLS);
const CS = CHUNK_CELLS + 1; // вершин в стороне участка (с обеими границами)

export class Terrain {
  constructor(tiles, seed, zones = []) {
    this.tiles = tiles;
    this.zones = zones;
    this.crater = zones.find((z) => z.kind === 'crater') || null;
    this.group = new THREE.Group();
    this.surfaceTextures = makeSurfaceTextures();
    this.n = [makeNoise(seed + 776), makeNoise(seed + 777), makeNoise(seed + 778), makeNoise(seed + 779)];
    this.patch = makeNoise(seed + 779);
    this.heights = new Map(); // участок -> высоты его вершин
    this.meshes = new Map(); // участок -> сетка
    this.tileCols = TILE_COL.map((c) => new THREE.Color(c));
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.surfaceTextures.color,
      bumpMap: this.surfaceTextures.height,
      bumpScale: 0.8, // слабее: сильная карта неровностей рисовала заметные полосы
      flatShading: true,
      roughness: 0.96,
      metalness: 0,
    });
    applyTerrainSurfaces(this.mat);
    this.waterView = new Water(tiles);
    this.water = this.waterView.mesh;
    this.waterSky = null; // { sky, light } — задаёт сцена после обновления неба
    this.group.add(this.water);
    this.group.add(this.buildSeabed());
    this.warm = true; // первый раз строим всё видимое сразу, дальше — понемногу за кадр
  }

  tile(tx, ty) {
    tx = Math.max(0, Math.min(MAP_W - 1, tx));
    ty = Math.max(0, Math.min(MAP_H - 1, ty));
    return this.tiles[ty * MAP_W + tx];
  }

  // Билинейная выборка по центрам клеток
  sampleTiles(x, z, fn) {
    const fx = x / TILE - 0.5;
    const fz = z / TILE - 0.5;
    const tx = Math.floor(fx);
    const tz = Math.floor(fz);
    const ax = fx - tx;
    const az = fz - tz;
    const a = fn(this.tile(tx, tz));
    const b = fn(this.tile(tx + 1, tz));
    const c = fn(this.tile(tx, tz + 1));
    const d = fn(this.tile(tx + 1, tz + 1));
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  }

  // «сырая» высота вершины сетки — до сглаживания
  rawHeight(i, j) {
    const [n0, n1, n2, n3] = this.n;
    const x = i * CELL;
    const z = j * CELL;
    const base = this.sampleTiles(x, z, (t) => BASE_H[t]);
    const rockW = this.sampleTiles(x, z, (t) => (t === T.ROCK ? 1 : 0));
    const landW = Math.max(0, Math.min(1, (base + 2) / 14));
    const broad = n0(x / 420, z / 420, 4) - 0.5;
    const a = n1(x / 160, z / 160, 4) - 0.5;
    const b = n2(x / 58, z / 58, 3) - 0.5;
    const c = n3(x / 24, z / 24, 2) - 0.5;
    // мёртвый город стоит на ровном месте, в его центре — чаша воронки с валом по краю
    const cityW = this.sampleTiles(x, z, (t) => (isCity(t) ? 1 : 0));
    const rough = landW * (1 - cityW * 0.8);
    let h = base + broad * 32 * rough + a * 36 * rough + b * 16 * rough + c * 8 * rough;
    if (this.crater && cityW > 0) {
      const d = Math.hypot(x - this.crater.x, z - this.crater.y) / (this.crater.r * 0.72);
      if (d < 1.5) h += (d < 1 ? -11 * (1 - d * d) : 0) + 9 * Math.exp(-((d - 1.05) ** 2) / 0.02) + (d < 1.2 ? c * 6 : 0);
    }
    // скалистые клетки поднимаются в холмы и горы
    h += Math.pow(rockW, 1.5) * (14 + Math.max(0, a + 0.3) * 150 + b * 30 + c * 28);
    if (base < -2) h += b * 6; // неровное дно
    return h;
  }

  // высоты вершин участка: сглаживание соседями; суша не опускается ниже воды —
  // иначе персонаж «плыл» бы по траве, которую сервер считает сушей
  chunkHeights(ci, cj) {
    const key = ci * 4096 + cj;
    let hs = this.heights.get(key);
    if (hs) return hs;
    const i0 = ci * CHUNK_CELLS;
    const j0 = cj * CHUNK_CELLS;
    const W = CS + 2;
    const raw = new Float32Array(W * W);
    for (let b = 0; b < W; b++) {
      for (let a = 0; a < W; a++) {
        const i = i0 + a - 1;
        const j = j0 + b - 1;
        raw[b * W + a] = i < 0 || j < 0 || i >= GW || j >= GH ? NaN : this.rawHeight(i, j);
      }
    }
    hs = new Float32Array(CS * CS);
    for (let b = 0; b < CS; b++) {
      for (let a = 0; a < CS; a++) {
        const i = i0 + a;
        const j = j0 + b;
        if (i >= GW || j >= GH) continue;
        let sum = 0;
        let n = 0;
        for (let db = 0; db <= 2; db++) {
          for (let da = 0; da <= 2; da++) {
            const v = raw[(b + db) * W + a + da];
            if (Number.isNaN(v)) continue;
            sum += v;
            n++;
          }
        }
        let h = raw[(b + 1) * W + a + 1] * 0.5 + (sum / n) * 0.5;
        const land = this.sampleTiles(i * CELL, j * CELL, (t) => (t >= T.SAND ? 1 : 0));
        if (land > 0.6) h = Math.max(h, 1.5 + (land - 0.6) * 10);
        hs[b * CS + a] = h;
      }
    }
    this.heights.set(key, hs);
    return hs;
  }

  // высота вершины (i, j) всей сетки
  hv(i, j) {
    i = Math.max(0, Math.min(GW - 1, i));
    j = Math.max(0, Math.min(GH - 1, j));
    const ci = Math.min(NCI - 1, Math.floor(i / CHUNK_CELLS));
    const cj = Math.min(NCJ - 1, Math.floor(j / CHUNK_CELLS));
    return this.chunkHeights(ci, cj)[(j - cj * CHUNK_CELLS) * CS + (i - ci * CHUNK_CELLS)];
  }

  // Насколько точка — голый песок или камень (0..1): те же правила, что красят пляж, песчаные
  // клетки, скалистые клетки и крутые обрывы. Растения там не растут.
  bareAt(x, z) {
    const h = this.heightAt(x, z);
    const shore = this.sampleTiles(x, z, (tt) => (tt <= T.SAND ? 1 : 0));
    const beach = smoothstep(-5, 0.5, h) * (1 - smoothstep(6, 13, h)) * shore;
    const sandTile = this.sampleTiles(x, z, (tt) => (tt === T.SAND ? 1 : tt === T.SHALLOW ? 0.75 : 0));
    const sand = Math.max(beach, sandTile * 1.15);
    const d = CELL;
    const sx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const sz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    const cliff = smoothstep(0.58, 1.35, Math.hypot(sx, sz)) * smoothstep(4, 18, h);
    const rockTile = this.sampleTiles(x, z, (tt) => (tt === T.ROCK ? 1 : 0));
    const rock = Math.max(cliff * 1.2, smoothstep(0.25, 0.75, rockTile));
    const city = this.sampleTiles(x, z, (tt) => (isCity(tt) ? 1 : 0));
    return Math.min(1, Math.max(sand, rock, smoothstep(0.15, 0.5, city)));
  }

  // Высота поверхности суши/дна в точке (x, z) — точно по треугольникам сетки
  heightAt(x, z) {
    const fx = Math.max(0, Math.min(GW - 1.001, x / CELL));
    const fz = Math.max(0, Math.min(GH - 1.001, z / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const ha = this.hv(i, j);
    const hb = this.hv(i + 1, j);
    const hc = this.hv(i, j + 1);
    const hd = this.hv(i + 1, j + 1);
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  // Цвет вершины: биом, пляж, уклон, снег, пятна травы и особые места
  vertexColor(i, j, c, zones) {
    const tileCols = this.tileCols;
    const x = i * CELL;
    const z = j * CELL;
    c.setRGB(0, 0, 0);
    for (let t = 0; t < tileCols.length; t++) {
      const w = this.sampleTiles(x, z, (tt) => (tt === t ? 1 : 0));
      if (w > 0) {
        c.r += tileCols[t].r * w;
        c.g += tileCols[t].g * w;
        c.b += tileCols[t].b * w;
      }
    }
    const h = this.hv(i, j);
    const il = Math.max(0, i - 1);
    const ir = Math.min(GW - 1, i + 1);
    const jd = Math.max(0, j - 1);
    const ju = Math.min(GH - 1, j + 1);
    const dx = (this.hv(ir, j) - this.hv(il, j)) / Math.max(CELL, (ir - il) * CELL);
    const dz = (this.hv(i, ju) - this.hv(i, jd)) / Math.max(CELL, (ju - jd) * CELL);
    const steepness = Math.hypot(dx, dz);
    // пляж — только у настоящего берега, а не в каждой низине острова
    const shore = this.sampleTiles(x, z, (tt) => (tt <= T.SAND ? 1 : 0));
    const beach = smoothstep(-5, 0.5, h) * (1 - smoothstep(6, 13, h)) * shore;
    const sandTile = this.sampleTiles(x, z, (tt) => (tt === T.SAND ? 1 : tt === T.SHALLOW ? 0.75 : 0));
    this.wSand = Math.min(1, Math.max(beach, sandTile * 1.15));
    c.lerp(BEACH, beach * 0.9);
    const patch = this.patch(x / 260, z / 260, 3);
    const cityTile = this.sampleTiles(x, z, (tt) => (isCity(tt) ? 1 : 0));
    const grassHeight = smoothstep(2, 9, h) * (1 - smoothstep(55, 76, h)) * (1 - cityTile);
    if (patch > 0.55) c.lerp(DRY, grassHeight * Math.min(0.42, (patch - 0.55) * 2.4));
    else if (patch < 0.42) c.lerp(LUSH, grassHeight * Math.min(0.38, (0.42 - patch) * 2.4));
    const cliff = smoothstep(0.58, 1.35, steepness) * smoothstep(4, 18, h);
    const rockTile = this.sampleTiles(x, z, (tt) => (tt === T.ROCK ? 1 : 0));
    // асфальт и бетон города берут фактуру камня
    this.wRock = Math.min(1, Math.max(cliff * 1.2, smoothstep(0.25, 0.75, rockTile), smoothstep(0.2, 0.7, cityTile) * 0.9));
    this.wSand *= 1 - this.wRock;
    this.wForest = this.sampleTiles(x, z, (tt) => (tt === T.FOREST ? 1 : 0));
    c.lerp(CLIFF, cliff * 0.92);
    c.lerp(SNOWY, smoothstep(55, 88, h));
    if (h > 0 && zones.length) {
      const site = zoneAt(zones, x, z);
      const k = site ? zoneFalloff(site, x, z) : 0;
      if (site && site.kind === 'crater') {
        c.lerp(GLASS, Math.min(0.9, 0.35 + k * 0.6));
        if (hash2(i, j, 77) < 0.2) c.lerp(ASH, 0.5);
      } else if (site && site.kind === 'city') {
        // трещины и пятна гари на асфальте
        if (cityTile > 0.5 && hash2(i, j, 77) < 0.16) c.lerp(GLASS, 0.35);
      } else if (k > 0 && site.kind === 'mine') {
        c.lerp(DUST, Math.min(0.85, 0.3 + k * 0.5));
        if (hash2(i, j, 77) < 0.22) c.lerp(ASH, 0.45);
      } else if (k > 0 && site.kind === 'lair') {
        c.lerp(TRAMPLED, Math.min(0.75, k * 0.7));
      } else if (k > 0 && site.kind === 'altar') {
        c.lerp(MOSS, k * 0.45);
      } else if (k > 0) {
        const zs = site.lvl * k;
        c.lerp(WASTE, Math.min(0.85, 0.35 + zs * 0.25));
        if (hash2(i, j, 77) < 0.18) c.lerp(ASH, 0.6);
      }
    }
    if (h < -3) c.multiplyScalar(Math.max(0.35, 1 + h / 70));
    c.multiplyScalar(0.97 + this.patch(x / 190, z / 190, 2) * 0.07);
    c.multiplyScalar(0.985 + hash2(i, j, 11) * 0.03);
  }

  buildChunk(ci, cj) {
    const i0 = ci * CHUNK_CELLS;
    const j0 = cj * CHUNK_CELLS;
    const i1 = Math.min(i0 + CHUNK_CELLS, GW - 1);
    const j1 = Math.min(j0 + CHUNK_CELLS, GH - 1);
    // цвета и высоты вершин участка (без повторов)
    const vw = i1 - i0 + 1;
    const vh = j1 - j0 + 1;
    const vcol = new Float32Array(vw * vh * 3);
    const vbio = new Float32Array(vw * vh * 3); // веса песка, скалы и леса
    const vh0 = new Float32Array(vw * vh);
    const c = new THREE.Color();
    const zones = this.zones;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = (j - j0) * vw + (i - i0);
        this.vertexColor(i, j, c, zones);
        vcol[k * 3] = c.r;
        vcol[k * 3 + 1] = c.g;
        vcol[k * 3 + 2] = c.b;
        vbio[k * 3] = this.wSand;
        vbio[k * 3 + 1] = this.wRock;
        vbio[k * 3 + 2] = this.wForest;
        vh0[k] = this.hv(i, j);
      }
    }
    const quads = (i1 - i0) * (j1 - j0);
    const pos = new Float32Array(quads * 18);
    const col = new Float32Array(quads * 18);
    const uv = new Float32Array(quads * 12);
    const bio = new Float32Array(quads * 18);
    let o = 0;
    let u = 0;
    const put = (i, j) => {
      const x = i * CELL;
      const z = j * CELL;
      const k = (j - j0) * vw + (i - i0);
      pos[o] = x;
      pos[o + 1] = vh0[k];
      pos[o + 2] = z;
      col[o] = vcol[k * 3];
      col[o + 1] = vcol[k * 3 + 1];
      col[o + 2] = vcol[k * 3 + 2];
      bio[o] = vbio[k * 3];
      bio[o + 1] = vbio[k * 3 + 1];
      bio[o + 2] = vbio[k * 3 + 2];
      uv[u] = x / TEXTURE_WORLD_SIZE;
      uv[u + 1] = z / TEXTURE_WORLD_SIZE;
      o += 3;
      u += 2;
    };
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        put(i, j); put(i, j + 1); put(i + 1, j); // a, c, b
        put(i, j + 1); put(i + 1, j + 1); put(i + 1, j); // c, d, b
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('biome', new THREE.BufferAttribute(bio, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  buildSeabed() {
    const size = Math.max(WORLD_W, WORLD_H) * 4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#123a4a', roughness: 1 }));
    mesh.position.set(WORLD_W / 2, -50, WORLD_H / 2);
    return mesh;
  }

  // target — точка, вокруг которой рисуем; far — дальность видимости.
  // Недостающие участки рядом строятся (ближние первыми, понемногу за кадр), дальние — выгружаются.
  update(t, target, far) {
    // вода: рябь, волны, отражение неба и блики солнца
    this.waterView.update(t, target, this.waterSky?.sky, this.waterSky?.light ?? 1);
    if (!target) return;
    const size = CHUNK_CELLS * CELL;
    const lim = far + size * 0.75;
    const ci0 = Math.max(0, Math.floor((target.x - lim) / size));
    const ci1 = Math.min(NCI - 1, Math.floor((target.x + lim) / size));
    const cj0 = Math.max(0, Math.floor((target.z - lim) / size));
    const cj1 = Math.min(NCJ - 1, Math.floor((target.z + lim) / size));
    const need = [];
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        const d = Math.hypot((ci + 0.5) * size - target.x, (cj + 0.5) * size - target.z);
        if (d > lim) continue;
        const key = ci * 4096 + cj;
        if (!this.meshes.has(key)) need.push([d, ci, cj, key]);
      }
    }
    need.sort((a, b) => a[0] - b[0]);
    const budget = this.warm ? need.length : 2;
    for (let n = 0; n < Math.min(budget, need.length); n++) {
      const [, ci, cj, key] = need[n];
      const mesh = this.buildChunk(ci, cj);
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    }
    this.warm = false;
    // далеко за краем видимости — выгружаем сетку (высоты остаются: они лёгкие)
    for (const [key, mesh] of this.meshes) {
      const ci = Math.floor(key / 4096);
      const cj = key % 4096;
      const d = Math.hypot((ci + 0.5) * size - target.x, (cj + 0.5) * size - target.z);
      mesh.visible = d <= lim;
      if (d > lim + size * 2) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(key);
      }
    }
  }
}
