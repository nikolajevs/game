// Low-poly рельеф острова, вода и морское дно.
// Высоты чисто визуальные: игровая логика на сервере плоская (x, y).
// Рельеф нарезан на участки: рисуются только видимые и не слишком далёкие.
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T } from '/shared/config.js';
import { makeNoise, zoneStrength } from '/shared/worldgen.js';
import { hash2 } from './util.js';

// 2 вершины на клетку: на большом острове 3 дали бы ~3 млн вершин и сотни МБ памяти
const RES = 2;
export const CELL = TILE / RES;
const GW = MAP_W * RES + 1;
const GH = MAP_H * RES + 1;
const CHUNK_CELLS = 48; // клеток сетки в стороне участка
const BASE_H = [-46, -13, 4, 12, 16, 26];
const TILE_COL = ['#1b4f63', '#3c8a86', '#e3d09a', '#78b153', '#3f8040', '#8f8e86'];
const BEACH = new THREE.Color('#e8d7a2');
const CLIFF = new THREE.Color('#7d7a72');
const SNOWY = new THREE.Color('#b9b8b0');
const DRY = new THREE.Color('#b5b866');
const LUSH = new THREE.Color('#3f8a45');
const WASTE = new THREE.Color('#857f55'); // выжженная земля радиационных зон
const ASH = new THREE.Color('#5c5848');
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

export class Terrain {
  constructor(tiles, seed, zones = []) {
    this.tiles = tiles;
    this.zones = zones;
    this.h = new Float32Array(GW * GH);
    this.group = new THREE.Group();
    this.chunks = [];
    this.surfaceTextures = makeSurfaceTextures();
    this.computeHeights(seed);
    this.patch = makeNoise(seed + 779);
    this.buildChunks();
    this.water = this.buildWater();
    this.group.add(this.water);
    this.group.add(this.buildSeabed());
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

  computeHeights(seed) {
    const n0 = makeNoise(seed + 776);
    const n1 = makeNoise(seed + 777);
    const n2 = makeNoise(seed + 778);
    const n3 = makeNoise(seed + 779);
    const tmp = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x = i * CELL;
        const z = j * CELL;
        const base = this.sampleTiles(x, z, (t) => BASE_H[t]);
        const rockW = this.sampleTiles(x, z, (t) => (t === T.ROCK ? 1 : 0));
        const landW = Math.max(0, Math.min(1, (base + 2) / 14));
        const broad = n0(x / 420, z / 420, 4) - 0.5;
        const a = n1(x / 160, z / 160, 4) - 0.5;
        const b = n2(x / 58, z / 58, 3) - 0.5;
        const c = n3(x / 24, z / 24, 2) - 0.5;
        let h = base + broad * 32 * landW + a * 36 * landW + b * 16 * landW + c * 8 * landW;
        // скалистые клетки поднимаются в холмы и горы
        h += Math.pow(rockW, 1.5) * (14 + Math.max(0, a + 0.3) * 150 + b * 30 + c * 28);
        if (base < -2) h += b * 6; // неровное дно
        tmp[j * GW + i] = h;
      }
    }
    // сглаживание; суша внутри острова не опускается ниже воды —
    // иначе существо «плыло» бы по траве, которую сервер считает сушей
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
            s += tmp[jj * GW + ii];
            n++;
          }
        }
        let h = tmp[j * GW + i] * 0.5 + (s / n) * 0.5;
        const land = this.sampleTiles(i * CELL, j * CELL, (t) => (t >= T.SAND ? 1 : 0));
        if (land > 0.6) h = Math.max(h, 1.5 + (land - 0.6) * 10);
        this.h[j * GW + i] = h;
      }
    }
  }

  // Высота поверхности суши/дна в точке (x, z) — точно по треугольникам сетки
  heightAt(x, z) {
    const fx = Math.max(0, Math.min(GW - 1.001, x / CELL));
    const fz = Math.max(0, Math.min(GH - 1.001, z / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const ha = this.h[j * GW + i];
    const hb = this.h[j * GW + i + 1];
    const hc = this.h[(j + 1) * GW + i];
    const hd = this.h[(j + 1) * GW + i + 1];
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  // Цвет каждой вершины: биом, пляж, уклон, снег, пятна травы и радиационные зоны
  vertexColors() {
    const tileCols = TILE_COL.map((c) => new THREE.Color(c));
    const vcol = new Float32Array(GW * GH * 3);
    const c = new THREE.Color();
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x = i * CELL;
        const z = j * CELL;
        c.setRGB(0, 0, 0);
        for (let t = 0; t < 6; t++) {
          const w = this.sampleTiles(x, z, (tt) => (tt === t ? 1 : 0));
          if (w > 0) {
            c.r += tileCols[t].r * w;
            c.g += tileCols[t].g * w;
            c.b += tileCols[t].b * w;
          }
        }
        const h = this.h[j * GW + i];
        const il = Math.max(0, i - 1);
        const ir = Math.min(GW - 1, i + 1);
        const jd = Math.max(0, j - 1);
        const ju = Math.min(GH - 1, j + 1);
        const dx = (this.h[j * GW + ir] - this.h[j * GW + il]) / Math.max(CELL, (ir - il) * CELL);
        const dz = (this.h[ju * GW + i] - this.h[jd * GW + i]) / Math.max(CELL, (ju - jd) * CELL);
        const steepness = Math.hypot(dx, dz);
        // пляж — только у настоящего берега, а не в каждой низине острова
        const shore = this.sampleTiles(x, z, (tt) => (tt <= T.SAND ? 1 : 0));
        const beach = smoothstep(-5, 0.5, h) * (1 - smoothstep(6, 13, h)) * shore;
        c.lerp(BEACH, beach * 0.9);
        const patch = this.patch(x / 260, z / 260, 3);
        const grassHeight = smoothstep(2, 9, h) * (1 - smoothstep(55, 76, h));
        if (patch > 0.55) c.lerp(DRY, grassHeight * Math.min(0.42, (patch - 0.55) * 2.4));
        else if (patch < 0.42) c.lerp(LUSH, grassHeight * Math.min(0.38, (0.42 - patch) * 2.4));
        const cliff = smoothstep(0.58, 1.35, steepness) * smoothstep(4, 18, h);
        c.lerp(CLIFF, cliff * 0.92);
        c.lerp(SNOWY, smoothstep(55, 88, h));
        if (h > 0 && this.zones.length) {
          const zs = zoneStrength(this.zones, x, z);
          if (zs > 0) {
            c.lerp(WASTE, Math.min(0.85, 0.35 + zs * 0.25));
            if (hash2(i, j, 77) < 0.18) c.lerp(ASH, 0.6);
          }
        }
        if (h < -3) c.multiplyScalar(Math.max(0.35, 1 + h / 70));
        c.multiplyScalar(0.97 + this.patch(x / 190, z / 190, 2) * 0.07);
        c.multiplyScalar(0.985 + hash2(i, j, 11) * 0.03);
        const o = (j * GW + i) * 3;
        vcol[o] = c.r;
        vcol[o + 1] = c.g;
        vcol[o + 2] = c.b;
      }
    }
    return vcol;
  }

  buildChunks() {
    const vcol = this.vertexColors();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.surfaceTextures.color,
      bumpMap: this.surfaceTextures.height,
      bumpScale: 0.8, // слабее: сильная карта неровностей рисовала заметные полосы
      flatShading: true,
      roughness: 0.96,
      metalness: 0,
    });
    for (let cj = 0; cj < GH - 1; cj += CHUNK_CELLS) {
      for (let ci = 0; ci < GW - 1; ci += CHUNK_CELLS) {
        const mesh = this.buildChunk(ci, cj, Math.min(ci + CHUNK_CELLS, GW - 1), Math.min(cj + CHUNK_CELLS, GH - 1), vcol, mat);
        this.group.add(mesh);
        this.chunks.push(mesh);
      }
    }
  }

  buildChunk(i0, j0, i1, j1, vcol, mat) {
    const quads = (i1 - i0) * (j1 - j0);
    const pos = new Float32Array(quads * 18);
    const col = new Float32Array(quads * 18);
    const uv = new Float32Array(quads * 12);
    let o = 0;
    let u = 0;
    const put = (i, j) => {
      const x = i * CELL;
      const z = j * CELL;
      pos[o] = x;
      pos[o + 1] = this.h[j * GW + i];
      pos[o + 2] = z;
      const k = (j * GW + i) * 3;
      col[o] = vcol[k];
      col[o + 1] = vcol[k + 1];
      col[o + 2] = vcol[k + 2];
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
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.center = new THREE.Vector2(((i0 + i1) / 2) * CELL, ((j0 + j1) / 2) * CELL);
    return mesh;
  }

  buildWater() {
    const size = Math.max(WORLD_W, WORLD_H) * 4;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: '#2f8fb0', transparent: true, opacity: 0.72, roughness: 0.18, metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(WORLD_W / 2, 0, WORLD_H / 2);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
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

  // target — точка, вокруг которой рисуем; far — дальность видимости
  update(t, target, far) {
    // лёгкое «дыхание» воды
    this.water.position.y = Math.sin(t * 0.8) * 0.6;
    if (!target) return;
    const lim = far + CHUNK_CELLS * CELL;
    for (const m of this.chunks) {
      const c = m.userData.center;
      m.visible = Math.hypot(c.x - target.x, c.y - target.z) < lim;
    }
  }
}
