// Декор без влияния на игру: пучки травы, цветы, папоротники, галька.
// Разбит на участки, чтобы рисовать только то, что рядом с камерой.
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, T } from '/shared/config.js';
import { G, M, mergeParts, hash2 } from './util.js';

const CHUNK = 480; // размер участка в единицах мира
const blade = new THREE.ConeGeometry(1, 1, 3);

function tuftGeom() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push({ geom: blade, matrix: M(Math.cos(a) * 1.6, 3.5, Math.sin(a) * 1.6, Math.sin(a) * 0.35, a, -Math.cos(a) * 0.35, 1.2, 7 + (i % 2) * 2, 0.5), color: i % 2 ? '#8fc35a' : '#6fa847' });
  }
  return mergeParts(parts);
}

function flowerGeom() {
  return mergeParts([
    { geom: blade, matrix: M(0, 3, 0, 0, 0, 0, 0.4, 6, 0.4), color: '#5d8f3a' },
    { geom: G.ico, matrix: M(0, 6.5, 0, 0, 0, 0, 1.8, 1.0, 1.8), color: '#ffffff' },
    { geom: G.octa, matrix: M(0, 7.1, 0, 0, 0, 0, 0.7), color: '#ffd23f' },
  ]);
}

function fernGeom() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push({ geom: G.octa, matrix: M(Math.cos(a) * 5, 3, Math.sin(a) * 5, 0, -a, 0.5, 6, 0.7, 1.8), color: i % 2 ? '#2f6b34' : '#3b7d3c' });
  }
  return mergeParts(parts);
}

export class Decor {
  constructor(terrain, tiles, seed) {
    this.group = new THREE.Group();
    this.meshes = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    const geoms = { tuft: tuftGeom(), flower: flowerGeom(), fern: fernGeom(), pebble: G.dodeca };
    const petals = ['#ffffff', '#ff8fb1', '#ffd23f', '#a98bff'];
    const chunks = new Map(); // "cx,cz" -> { tuft: [], ... }
    const push = (type, x, z, s, k) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      if (!chunks.has(key)) chunks.set(key, { tuft: [], flower: [], fern: [], pebble: [] });
      chunks.get(key)[type].push([x, z, s, k]);
    };
    for (let ty = 2; ty < MAP_H - 2; ty++) {
      for (let tx = 2; tx < MAP_W - 2; tx++) {
        const t = tiles[ty * MAP_W + tx];
        for (let k = 0; k < 4; k++) {
          const r = hash2(tx, ty, seed + k * 31);
          const x = tx * TILE + hash2(tx, ty, seed + k * 31 + 1) * TILE;
          const z = ty * TILE + hash2(tx, ty, seed + k * 31 + 2) * TILE;
          const s = 0.7 + hash2(tx, ty, seed + k * 31 + 3) * 0.7;
          if (terrain.heightAt(x, z) < 0.5) continue; // под водой не растёт
          if (t === T.GRASS) {
            if (r < 0.55) push('tuft', x, z, s);
            else if (r < 0.62) push('flower', x, z, s, k);
          } else if (t === T.FOREST) {
            if (r < 0.3) push('fern', x, z, s);
            else if (r < 0.55) push('tuft', x, z, s * 0.8);
          } else if ((t === T.SAND || t === T.ROCK) && r < 0.18) push('pebble', x, z, s * 2.4, k);
        }
      }
    }
    const c = new THREE.Color();
    for (const [key, lists] of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      for (const type of Object.keys(lists)) {
        const items = lists[type];
        if (!items.length) continue;
        const mesh = new THREE.InstancedMesh(geoms[type], type === 'pebble' ? pebbleMat : mat, items.length);
        items.forEach(([x, z, s, k], i) => {
          mesh.setMatrixAt(i, M(x, terrain.heightAt(x, z) - 0.5, z, 0, (x * 13.7 + z) % 6.28, 0, s));
          if (type === 'flower') mesh.setColorAt(i, c.set(petals[k % petals.length]));
          if (type === 'pebble') {
            const g = 0.45 + ((x * 7 + z * 3) % 10) / 50;
            mesh.setColorAt(i, c.setRGB(g, g, g * 0.96));
          }
        });
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        mesh.userData.center = new THREE.Vector2((cx + 0.5) * CHUNK, (cz + 0.5) * CHUNK);
        this.group.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  // показываем только участки в пределах видимости
  update(target, far) {
    const lim = far + CHUNK * 0.75;
    for (const m of this.meshes) {
      const c = m.userData.center;
      m.visible = Math.hypot(c.x - target.x, c.y - target.z) < lim;
    }
  }
}
