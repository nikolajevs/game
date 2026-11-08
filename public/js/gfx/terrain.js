// Low-poly рельеф острова, вода и морское дно.
// Высоты чисто визуальные: игровая логика на сервере плоская (x, y).
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T } from '/shared/config.js';
import { makeNoise } from '/shared/worldgen.js';
import { hash2 } from './util.js';

const RES = 2; // вершин на клетку
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

export class Terrain {
  constructor(tiles, seed) {
    this.tiles = tiles;
    this.h = new Float32Array(GW * GH);
    this.group = new THREE.Group();
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
    const n1 = makeNoise(seed + 777);
    const n2 = makeNoise(seed + 778);
    const tmp = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const x = i * CELL;
        const z = j * CELL;
        const base = this.sampleTiles(x, z, (t) => BASE_H[t]);
        const rockW = this.sampleTiles(x, z, (t) => (t === T.ROCK ? 1 : 0));
        const landW = Math.max(0, Math.min(1, (base + 2) / 14));
        const a = n1(x / 160, z / 160, 4) - 0.5;
        const b = n2(x / 45, z / 45, 2) - 0.5;
        let h = base + a * 16 * landW + b * 4 * landW;
        // скалистые клетки поднимаются в холмы и горы
        h += Math.pow(rockW, 1.5) * (14 + Math.max(0, a + 0.3) * 140 + b * 22);
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
    const vc = [];
    // цвета в вершинах сетки — билинейно по клеткам
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
        vc.push(c);
      }
    }
    const tmp = new THREE.Color();
    let o = 0;
    const put = (i, j) => {
      pos[o] = i * CELL;
      pos[o + 1] = this.h[j * GW + i];
      pos[o + 2] = j * CELL;
      o += 3;
    };
    const tri = (ia, ja, ib, jb, ic, jc, salt) => {
      const start = o;
      put(ia, ja);
      put(ib, jb);
      put(ic, jc);
      // нормаль грани и средняя высота
      const ax = pos[start + 3] - pos[start];
      const ay = pos[start + 4] - pos[start + 1];
      const az = pos[start + 5] - pos[start + 2];
      const bx = pos[start + 6] - pos[start];
      const by = pos[start + 7] - pos[start + 1];
      const bz = pos[start + 8] - pos[start + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const slope = Math.abs(ny) / Math.hypot(nx, ny, nz);
      const hAvg = (pos[start + 1] + pos[start + 4] + pos[start + 7]) / 3;
      const ca = vc[ja * GW + ia];
      const cb = vc[jb * GW + ib];
      const cc = vc[jc * GW + ic];
      tmp.setRGB((ca.r + cb.r + cc.r) / 3, (ca.g + cb.g + cc.g) / 3, (ca.b + cb.b + cc.b) / 3);
      // пятна сухой травы и тёмной зелени, чтобы луг не был однотонным
      if (hAvg > 3.5) {
        const px = pos[start];
        const pz = pos[start + 2];
        const p = this.patch(px / 260, pz / 260, 3);
        if (p > 0.55) tmp.lerp(DRY, Math.min(0.55, (p - 0.55) * 3));
        else if (p < 0.42) tmp.lerp(LUSH, Math.min(0.5, (0.42 - p) * 3));
      }
      if (hAvg > -3 && hAvg < 3.5) tmp.lerp(BEACH, 0.75); // полоса пляжа
      if (hAvg > 3 && slope < 0.72) tmp.lerp(CLIFF, Math.min(1, (0.72 - slope) * 4));
      if (hAvg > 55) tmp.lerp(SNOWY, Math.min(1, (hAvg - 55) / 30));
      if (hAvg < -3) tmp.multiplyScalar(Math.max(0.35, 1 + hAvg / 70)); // глубже — темнее
      const jit = 0.94 + hash2(ia * 3 + salt, ja * 7, 11) * 0.12;
      tmp.multiplyScalar(jit);
      for (let k = 0; k < 3; k++) {
        col[start + k * 3] = tmp.r;
        col[start + k * 3 + 1] = tmp.g;
        col[start + k * 3 + 2] = tmp.b;
      }
    };
    for (let j = 0; j < GH - 1; j++) {
      for (let i = 0; i < GW - 1; i++) {
        tri(i, j, i, j + 1, i + 1, j, 0); // a, c, b
        tri(i, j + 1, i + 1, j + 1, i + 1, j, 1); // c, d, b
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
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
