// Декор без влияния на игру: пучки травы, цветы, папоротники, галька.
// Разбит на участки, чтобы рисовать только то, что рядом с камерой.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TILE, MAP_W, MAP_H, T, WORLD_W } from '/shared/config.js';
import { zoneAt } from '/shared/worldgen.js';
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

function addGrassWind(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
      float phase = uTime * 1.35 + mvPosition.x * 0.014 + mvPosition.z * 0.011;
      float height = max(0.0, mvPosition.y);
      mvPosition.x += sin(phase) * height * 0.12;
      mvPosition.z += cos(phase * 0.83) * height * 0.045;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => 'ez-tree-instanced-grass-wind-v1';
}

// Участки строятся, когда попадают в поле зрения, и выгружаются далеко за его краем:
// на огромном острове держать в памяти траву всего мира нельзя.
export class Decor {
  constructor(terrain, tiles, seed) {
    this.terrain = terrain;
    this.tiles = tiles;
    this.seed = seed;
    this.group = new THREE.Group();
    this.chunks = new Map(); // участок -> его сетки
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.pebbleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    this.geoms = { tuft: tuftGeom(), flower: flowerGeom(), fern: fernGeom(), pebble: G.dodeca };
    this.grassMaterial = null;
    this.grassTime = 0;
    this.warm = true;
    this.loadGrassModel();
  }

  loadGrassModel() {
    new GLTFLoader().load('/assets/ez-tree/grass.glb', (gltf) => {
      const source = gltf.scene.getObjectByProperty('isMesh', true);
      if (!source?.material?.map) return;
      const fallback = this.geoms.tuft;
      this.geoms.tuft = source.geometry;
      fallback.dispose();
      this.grassMaterial = new THREE.MeshPhongMaterial({
        map: source.material.map,
        color: '#e4f0dc',
        emissive: '#16351b',
        emissiveIntensity: 0.08,
        alphaTest: 0.45,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
      addGrassWind(this.grassMaterial);
      this.clearChunks();
      this.warm = false;
    }, undefined, () => {});
  }

  clearChunks() {
    for (const meshes of this.chunks.values()) {
      for (const mesh of meshes) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    this.chunks.clear();
  }

  buildChunk(cx, cz) {
    const { terrain, tiles, seed } = this;
    const lists = { tuft: [], flower: [], fern: [], pebble: [] };
    const push = (type, x, z, sc, k) => lists[type].push([x, z, sc, k]);
    const per = CHUNK / TILE;
    const tx0 = Math.max(2, cx * per);
    const ty0 = Math.max(2, cz * per);
    const tx1 = Math.min(MAP_W - 2, (cx + 1) * per);
    const ty1 = Math.min(MAP_H - 2, (cz + 1) * per);
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const t = tiles[ty * MAP_W + tx];
        if (t === T.DEEP) continue;
        for (let k = 0; k < 5; k++) {
          const r = hash2(tx, ty, seed + k * 31);
          const x = tx * TILE + hash2(tx, ty, seed + k * 31 + 1) * TILE;
          const z = ty * TILE + hash2(tx, ty, seed + k * 31 + 2) * TILE;
          const sc = 0.7 + hash2(tx, ty, seed + k * 31 + 3) * 0.7;
          if (terrain.heightAt(x, z) < 0.5) continue; // под водой не растёт
          if (terrain.zones.length && zoneAt(terrain.zones, x, z)) {
            if (r < 0.25) push('pebble', x, z, sc * 2.6, k); // в особых местах только обломки
            continue;
          }
          if (t === T.GRASS) {
            if (r < 0.64) push('tuft', x, z, sc);
            else if (r < 0.72) push('flower', x, z, sc, k);
          } else if (t === T.FOREST) {
            if (r < 0.32) push('fern', x, z, sc);
            else if (r < 0.61) push('tuft', x, z, sc * 0.8);
          } else if ((t === T.SAND || t === T.ROCK) && r < 0.18) push('pebble', x, z, sc * 2.4, k);
        }
      }
    }
    const petals = ['#ffffff', '#ff8fb1', '#ffd23f', '#a98bff'];
    const c = new THREE.Color();
    const meshes = [];
    for (const type of Object.keys(lists)) {
      const items = lists[type];
      if (!items.length) continue;
      const material = type === 'pebble' ? this.pebbleMat : type === 'tuft' && this.grassMaterial ? this.grassMaterial : this.mat;
      const mesh = new THREE.InstancedMesh(this.geoms[type], material, items.length);
      items.forEach(([x, z, sc, k], i) => {
        const tuft = type === 'tuft' && this.grassMaterial;
        const sx = tuft ? sc * 2.8 : sc;
        const sy = tuft ? sc * 4.8 : sc;
        const sz = tuft ? sc * 2.8 : sc;
        mesh.setMatrixAt(i, M(x, terrain.heightAt(x, z) - 0.5, z, 0, (x * 13.7 + z) % 6.28, 0, sx, sy, sz));
        if (tuft) {
          const tint = hash2(Math.floor(x), Math.floor(z), seed + 257);
          mesh.setColorAt(i, c.setRGB(0.68 + tint * 0.18, 0.76 + tint * 0.2, 0.6 + tint * 0.2));
        }
        if (type === 'flower') mesh.setColorAt(i, c.set(petals[k % petals.length]));
        if (type === 'pebble') {
          const g = 0.45 + ((x * 7 + z * 3) % 10) / 50;
          mesh.setColorAt(i, c.setRGB(g, g, g * 0.96));
        }
      });
      mesh.castShadow = false;
      mesh.receiveShadow = type !== 'tuft';
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }

  // строим ближние участки (понемногу за кадр), прячем и выгружаем дальние
  update(target, far) {
    if (this.grassMaterial?.userData.shader) {
      this.grassMaterial.userData.shader.uniforms.uTime.value = performance.now() * 0.001;
    }
    const lim = far + CHUNK * 0.75;
    const n = Math.ceil(WORLD_W / CHUNK);
    const cx0 = Math.max(0, Math.floor((target.x - lim) / CHUNK));
    const cx1 = Math.min(n - 1, Math.floor((target.x + lim) / CHUNK));
    const cz0 = Math.max(0, Math.floor((target.z - lim) / CHUNK));
    const cz1 = Math.min(n - 1, Math.floor((target.z + lim) / CHUNK));
    const need = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const d = Math.hypot((cx + 0.5) * CHUNK - target.x, (cz + 0.5) * CHUNK - target.z);
        const key = cx * 4096 + cz;
        if (d <= lim && !this.chunks.has(key)) need.push([d, cx, cz, key]);
      }
    }
    need.sort((a, b) => a[0] - b[0]);
    const budget = this.warm ? need.length : 3;
    for (let i = 0; i < Math.min(budget, need.length); i++) {
      const [, cx, cz, key] = need[i];
      this.chunks.set(key, this.buildChunk(cx, cz));
    }
    this.warm = false;
    for (const [key, meshes] of this.chunks) {
      const cx = Math.floor(key / 4096);
      const cz = key % 4096;
      const d = Math.hypot((cx + 0.5) * CHUNK - target.x, (cz + 0.5) * CHUNK - target.z);
      for (const m of meshes) m.visible = d < lim;
      if (d > lim + CHUNK * 3) {
        for (const m of meshes) {
          this.group.remove(m);
          m.dispose();
        }
        this.chunks.delete(key);
      }
    }
  }
}
