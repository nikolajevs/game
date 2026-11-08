// Low-poly рельеф острова, вода и морское дно.
// Высоты чисто визуальные: игровая логика на сервере плоская (x, y).
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T } from '/shared/config.js';
import { makeNoise } from '/shared/worldgen.js';
import { hash2 } from './util.js';

const RES = 3; // вершин на клетку: плавнее склоны и больше места для деталей
export const CELL = TILE / RES;
const GW = MAP_W * RES + 1;
const GH = MAP_H * RES + 1;
const BASE_H = [-46, -13, 4, 12, 16, 26];
const TILE_COL = ['#1b4f63', '#3c8a86', '#e3d09a', '#78b153', '#3f8040', '#8f8e86'];
const BEACH = new THREE.Color('#e8d7a2');
const CLIFF = new THREE.Color('#7d7a72');
const SNOWY = new THREE.Color('#b9b8b0');
const DRY = new THREE.Color('#b5b866');
const LUSH = new THREE.Color('#3f8a45');
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
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
      // Integer frequencies make the procedural pattern tile cleanly at every edge.
      const broad = (Math.sin(tau * (3 * u + 2 * v) + 0.2) + Math.cos(tau * (2 * u - 4 * v) + 1.8)) * 0.5;
      const medium = Math.sin(tau * (11 * u + 7 * v) + 1.2) * Math.cos(tau * (13 * u - 9 * v) + 0.3);
      const fine = Math.sin(tau * (37 * u + 29 * v) + 0.8) * Math.cos(tau * (31 * u - 43 * v) + 0.6);
      const grain = Math.sin(tau * (73 * u + 61 * v) + 0.5) * Math.cos(tau * (67 * u - 59 * v) + 2.1);
      const index = (y * TEXTURE_SIZE + x) * 4;
      const albedo = Math.max(0, Math.min(255, Math.round(238 + broad * 11 + medium * 6 + fine * 4 + grain * 2)));
      const height = Math.max(0, Math.min(255, Math.round(128 + broad * 44 + medium * 34 + fine * 24 + grain * 12)));
      for (let channel = 0; channel < 3; channel++) {
        colorData[index + channel] = albedo;
        heightData[index + channel] = height;
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
  return {
    color: makeTexture(colorData, THREE.SRGBColorSpace),
    height: makeTexture(heightData),
  };
}

export class Terrain {
  constructor(tiles, seed) {
    this.tiles = tiles;
    this.h = new Float32Array(GW * GH);
    this.group = new THREE.Group();
    this.surfaceTextures = makeSurfaceTextures();
    this.computeHeights(seed);
    this.patch = makeNoise(seed + 779);
    this.group.add(this.buildMesh());
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
    // одно сглаживание, чтобы склоны были мягче
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
        this.h[j * GW + i] = tmp[j * GW + i] * 0.5 + (s / n) * 0.5;
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

  buildMesh() {
    const quads = (GW - 1) * (GH - 1);
    const pos = new Float32Array(quads * 18);
    const col = new Float32Array(quads * 18);
    const uv = new Float32Array(quads * 12);
    const vc = [];
    // Непрерывная раскраска по высоте, уклону и биому сглаживает границы поверхностей.
    const tileCols = TILE_COL.map((c) => new THREE.Color(c));
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x = i * CELL;
        const z = j * CELL;
        const c = new THREE.Color(0, 0, 0);
        for (let t = 0; t < 6; t++) {
          const w = this.sampleTiles(x, z, (tt) => (tt === t ? 1 : 0));
          if (w > 0) c.r += tileCols[t].r * w, c.g += tileCols[t].g * w, c.b += tileCols[t].b * w;
        }
        const h = this.h[j * GW + i];
        const il = Math.max(0, i - 1);
        const ir = Math.min(GW - 1, i + 1);
        const jd = Math.max(0, j - 1);
        const ju = Math.min(GH - 1, j + 1);
        const dx = (this.h[j * GW + ir] - this.h[j * GW + il]) / Math.max(CELL, (ir - il) * CELL);
        const dz = (this.h[ju * GW + i] - this.h[jd * GW + i]) / Math.max(CELL, (ju - jd) * CELL);
        const steepness = Math.hypot(dx, dz);
        const beach = smoothstep(-5, 0.5, h) * (1 - smoothstep(6, 13, h));
        c.lerp(BEACH, beach * 0.9);

        const patch = this.patch(x / 260, z / 260, 3);
        const grassHeight = smoothstep(2, 9, h) * (1 - smoothstep(55, 76, h));
        if (patch > 0.55) c.lerp(DRY, grassHeight * Math.min(0.42, (patch - 0.55) * 2.4));
        else if (patch < 0.42) c.lerp(LUSH, grassHeight * Math.min(0.38, (0.42 - patch) * 2.4));

        const cliff = smoothstep(0.58, 1.35, steepness) * smoothstep(4, 18, h);
        c.lerp(CLIFF, cliff * 0.92);
        c.lerp(SNOWY, smoothstep(55, 88, h));
        if (h < -3) c.multiplyScalar(Math.max(0.35, 1 + h / 70));
        c.multiplyScalar(0.97 + this.patch(x / 190, z / 190, 2) * 0.07);
        c.multiplyScalar(0.985 + hash2(i, j, 11) * 0.03);
        vc.push(c);
      }
    }
    let o = 0;
    const put = (i, j) => {
      pos[o] = i * CELL;
      pos[o + 1] = this.h[j * GW + i];
      pos[o + 2] = j * CELL;
      o += 3;
    };
    const tri = (ia, ja, ib, jb, ic, jc) => {
      const start = o;
      const uvStart = o / 3 * 2;
      put(ia, ja);
      put(ib, jb);
      put(ic, jc);
      for (let k = 0; k < 3; k++) {
        uv[uvStart + k * 2] = pos[start + k * 3] / TEXTURE_WORLD_SIZE;
        uv[uvStart + k * 2 + 1] = pos[start + k * 3 + 2] / TEXTURE_WORLD_SIZE;
      }
      const indices = [ja * GW + ia, jb * GW + ib, jc * GW + ic];
      for (let k = 0; k < 3; k++) {
        const c = vc[indices[k]];
        col[start + k * 3] = c.r;
        col[start + k * 3 + 1] = c.g;
        col[start + k * 3 + 2] = c.b;
      }
    };
    for (let j = 0; j < GH - 1; j++) {
      for (let i = 0; i < GW - 1; i++) {
        tri(i, j, i, j + 1, i + 1, j); // a, c, b
        tri(i, j + 1, i + 1, j + 1, i + 1, j); // c, d, b
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: this.surfaceTextures.color,
      bumpMap: this.surfaceTextures.height,
      bumpScale: 2.2,
      flatShading: true,
      roughness: 0.96,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
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

  update(t) {
    // лёгкое «дыхание» воды
    this.water.position.y = Math.sin(t * 0.8) * 0.6;
  }
}
