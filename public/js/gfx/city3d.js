// Мёртвый город: руины домов по клеткам T.WALL, разметка улиц и обломки.
// Сервер знает про стены (сквозь них не пройти), всё остальное здесь — только облик.
// Строится участками рядом с камерой и выгружается вдали.
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, T, CITY } from '/shared/config.js';
import { cityInfo } from '/shared/worldgen.js';
import { G, M, mergeParts, hash2 } from './util.js';

const CHUNK = 12; // клеток в стороне участка
const CONCRETE = ['#8d8a82', '#7b7871', '#9a968c', '#6f6c66'];
const BRICK = ['#7a4f40', '#6b4438', '#855848'];
const SOOT = new THREE.Color('#1c1a18');
const _c = new THREE.Color();

export class CityView {
  constructor(scene, terrain, tiles) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.terrain = terrain;
    this.tiles = tiles;
    this.city = cityInfo(tiles);
    this.built = new Map();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    this.warm = true;
    if (this.city) {
      this.cx = Math.floor(this.city.x / TILE);
      this.cy = Math.floor(this.city.y / TILE);
    }
  }

  tile(tx, ty) {
    return tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? T.DEEP : this.tiles[ty * MAP_W + tx];
  }

  buildChunk(ci, cj) {
    const parts = [];
    const { cx, cy, terrain } = this;
    const B = CITY.block;
    const mod = (a) => ((a % B) + B) % B;
    for (let ty = cj * CHUNK; ty < (cj + 1) * CHUNK; ty++) {
      for (let tx = ci * CHUNK; tx < (ci + 1) * CHUNK; tx++) {
        const t = this.tile(tx, ty);
        if (t !== T.WALL && t !== T.CITY) continue;
        const x = (tx + 0.5) * TILE;
        const z = (ty + 0.5) * TILE;
        const g0 = Math.max(0, terrain.heightAt(x, z));
        const far = Math.min(1, Math.hypot(tx - cx, ty - cy) / CITY.r); // 0 у воронки, 1 на окраине
        if (t === T.CITY) {
          // разметка посреди улиц и редкие обломки
          const lx = mod(tx - cx);
          const ly = mod(ty - cy);
          const mid = Math.floor(CITY.street / 2);
          const h = hash2(tx, ty, 5);
          if (far > 0.22 && h < 0.55 && ((lx === mid && ly >= CITY.street && ly % 2 === 0) || (ly === mid && lx >= CITY.street && lx % 2 === 0))) {
            parts.push({ geom: G.box, matrix: M(x, g0 + 0.5, z, 0, lx === mid ? Math.PI / 2 : 0, 0, 20, 0.5, 2.4), color: '#8f8a72' });
          }
          let nearWall = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.tile(tx + dx, ty + dy) === T.WALL) nearWall = true;
          if (h > (nearWall ? 0.55 : 0.93)) {
            // куча битого бетона
            const n = 2 + Math.floor(hash2(tx, ty, 6) * 3);
            for (let i = 0; i < n; i++) {
              const s = 4 + hash2(tx + i, ty, 7) * 7;
              parts.push({
                geom: G.dodeca,
                matrix: M(x + (hash2(tx, ty + i, 8) - 0.5) * 30, g0 + s * 0.35, z + (hash2(tx + i, ty + i, 9) - 0.5) * 30, h * 6, i, h * 3, s, s * 0.6, s * 0.8),
                color: CONCRETE[(tx + i) & 3],
              });
            }
          }
          continue;
        }
        // стена дома: высота — общая на квартал, изломы — у каждой клетки свои
        const bx = Math.floor((tx - cx) / B);
        const by = Math.floor((ty - cy) / B);
        const brick = hash2(bx, by, 21) < 0.35;
        const pal = brick ? BRICK : CONCRETE;
        const top = (70 + hash2(bx, by, 22) * 80) * (0.45 + 0.55 * far);
        const hh = Math.max(34, top * (0.5 + 0.5 * hash2(tx, ty, 23)));
        const soot = (1 - far) * 0.65 + hash2(tx, ty, 24) * 0.12;
        const col = (i) => `#${_c.set(pal[i % pal.length]).lerp(SOOT, Math.min(0.85, soot)).getHexString()}`;
        const y0 = g0 - 6;
        parts.push({ geom: G.box, matrix: M(x, y0 + (hh + 6) / 2, z, 0, 0, 0, TILE, hh + 6, TILE), color: col(tx + ty) });
        // обломанный верх: уцелевший угол выше остальной стены
        const jag = 10 + hash2(tx, ty, 25) * 34;
        const qx = hash2(tx, ty, 26) < 0.5 ? -1 : 1;
        const qz = hash2(tx, ty, 27) < 0.5 ? -1 : 1;
        parts.push({ geom: G.box, matrix: M(x + qx * TILE * 0.22, y0 + 6 + hh + jag / 2, z + qz * TILE * 0.2, 0, 0, 0, TILE * 0.56, jag, TILE * 0.6), color: col(tx + ty + 1) });
        // арматура
        if (hash2(tx, ty, 28) < 0.4) {
          parts.push({ geom: G.cyl6, matrix: M(x - qx * 9, y0 + 6 + hh + 9, z - qz * 8, 0.25 * qz, 0, 0.3 * qx, 0.7, 22, 0.7), color: '#4a2f24' });
        }
        // пустые окна на сторонах, которые смотрят наружу
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (this.tile(tx + dx, ty + dy) === T.WALL) continue;
          for (let fy = 20; fy + 16 < hh; fy += 34) {
            parts.push({
              geom: G.box,
              matrix: M(x + dx * (TILE / 2 + 0.2), y0 + 6 + fy + 8, z + dy * (TILE / 2 + 0.2), 0, 0, 0, dx ? 0.8 : 17, 15, dy ? 0.8 : 17),
              color: '#121110',
            });
          }
        }
      }
    }
    if (!parts.length) return null;
    const mesh = new THREE.Mesh(mergeParts(parts), this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  update(target, far) {
    const c = this.city;
    if (!c || Math.hypot(c.x - target.x, c.y - target.z) > c.r + far + 900) {
      if (this.built.size) {
        for (const m of this.built.values()) this.drop(m);
        this.built.clear();
      }
      return;
    }
    const size = CHUNK * TILE;
    const lim = far + size;
    let budget = this.warm ? Infinity : 2;
    this.warm = false;
    const i0 = Math.floor((target.x - lim) / size);
    const i1 = Math.floor((target.x + lim) / size);
    const j0 = Math.floor((target.z - lim) / size);
    const j1 = Math.floor((target.z + lim) / size);
    for (let j = j0; j <= j1 && budget > 0; j++) {
      for (let i = i0; i <= i1 && budget > 0; i++) {
        const key = i * 4096 + j;
        if (this.built.has(key)) continue;
        if (Math.hypot((i + 0.5) * size - target.x, (j + 0.5) * size - target.z) > lim) continue;
        if (Math.hypot((i + 0.5) * size - c.x, (j + 0.5) * size - c.y) > c.r + size) continue;
        this.built.set(key, this.buildChunk(i, j));
        budget--;
      }
    }
    for (const [key, m] of this.built) {
      const i = Math.floor(key / 4096);
      const j = key % 4096;
      const d = Math.hypot((i + 0.5) * size - target.x, (j + 0.5) * size - target.z);
      if (m) m.visible = d <= lim + size * 0.5;
      if (d > lim + size * 3) {
        this.drop(m);
        this.built.delete(key);
      }
    }
  }

  drop(m) {
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
  }
}
