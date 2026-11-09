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

// Ветер как в ez-tree: качается верх пучка, корень стоит; порывы бегут волнами по лугу.
// tipHeight — высота модели (верх качается сильнее всего), strength — размах у верхушки.
// fade — у густого слоя вокруг игрока трава к краю плавно «уходит в землю», чтобы не было видно границы.
const grassUniforms = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uFade: { value: new THREE.Vector2(330, 430) } };
function addGrassWind(material, { tipHeight = 2, strength = 2.6, fade = false } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, grassUniforms);
    shader.vertexShader = `uniform float uTime;\nuniform vec2 uCenter;\nuniform vec2 uFade;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 local = transformed;
      ${fade ? 'local *= 1.0 - smoothstep(uFade.x, uFade.y, distance(root.xz, uCenter));' : ''}
      vec4 mvPosition = instanceMatrix * vec4(local, 1.0);
      float h = clamp(position.y / ${tipHeight.toFixed(2)}, 0.0, 1.0);
      float gust = sin(uTime * 0.9 + root.x * 0.004 + root.z * 0.003) * 0.5 + 0.5;
      float phase = uTime * 1.6 + root.x * 0.02 + root.z * 0.017;
      float bend = h * h * ${strength.toFixed(2)} * (0.45 + 0.75 * gust);
      mvPosition.x += sin(phase) * bend;
      mvPosition.z += cos(phase * 0.81) * bend * 0.6;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
    `);
    material.userData.shader = shader;
  };
  material.customProgramCacheKey = () => `grass-wind-v2-${tipHeight}-${strength}-${fade}`;
}

// ---------- густой луг вокруг игрока ----------
// Пучки травы ez-tree — всего 6 треугольников, поэтому рядом с игроком их можно сажать очень густо.
// Слой разбит на ячейки, ячейки строятся вокруг игрока и выгружаются за краем.
const MEADOW_CELL = 160;
const MEADOW_R = 430; // радиус густого луга (к краю трава плавно уходит в землю)
const FLOWERS = ['flower_white', 'flower_blue', 'flower_yellow'];
const FLOWER_MAX = 600; // цветов одного вида вокруг игрока
// сколько пучков на 1000 кв. единиц по типу клетки
const MEADOW_DENSITY = { [T.GRASS]: 38, [T.FOREST]: 15, [T.SAND]: 1.5, [T.ROCK]: 4 };

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
    this.meadowMaterial = null;
    this.meadow = new Map(); // ячейка густого луга -> { mesh, flowers }
    this.meadowWarm = true;
    this.flowerParts = {}; // вид цветка -> его части (InstancedMesh)
    this.flowersDirty = false;
    this.grassTime = 0;
    this.warm = false;
    this.loadGrassModel();
  }

  loadGrassModel() {
    new GLTFLoader().load('/assets/ez-tree/grass.glb', (gltf) => {
      const source = gltf.scene.getObjectByProperty('isMesh', true);
      if (!source?.material?.map) return;
      const fallback = this.geoms.tuft;
      this.geoms.tuft = source.geometry;
      fallback.dispose();
      // цвет — как на лугу ez-tree: тёмная оливковая зелень с разбросом от пучка к пучку
      const make = (fade) => {
        const m = new THREE.MeshPhongMaterial({
          map: source.material.map,
          color: '#ffffff',
          emissive: '#2f6a2a',
          emissiveIntensity: 0.2,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
        addGrassWind(m, { tipHeight: 2, strength: 1.4, fade });
        return m;
      };
      this.grassMaterial = make(false);
      this.meadowMaterial = make(true);
      this.clearChunks();
      this.warm = false;
    }, undefined, () => {});
    // цветы ez-tree: у каждого несколько частей со своими материалами — на каждую часть свой
    // InstancedMesh на весь луг вокруг игрока
    const loader = new GLTFLoader();
    FLOWERS.forEach((name) => {
      loader.load(`/assets/ez-tree/${name}.glb`, (gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const parts = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
          const src = o.material;
          const mat = new THREE.MeshPhongMaterial({ map: src.map || null, color: src.map ? '#ffffff' : src.color, alphaTest: src.map ? 0.5 : 0, side: THREE.DoubleSide });
          geo.computeBoundingBox();
          parts.push({ geo, mat });
        });
        // высота модели — для ветра (качается верх цветка)
        let top = 0;
        for (const p of parts) top = Math.max(top, p.geo.boundingBox.max.y);
        this.flowerParts[name] = parts.map(({ geo, mat }) => {
          addGrassWind(mat, { tipHeight: top, strength: 0.9, fade: true });
          const mesh = new THREE.InstancedMesh(geo, mat, FLOWER_MAX);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          return mesh;
        });
        this.flowersDirty = true;
      }, undefined, () => {});
    });
  }

  // ячейка густого луга: пучки травы с цветом и размером как у ez-tree, плюс места для цветов
  buildMeadowCell(cx, cz) {
    const { terrain, tiles, seed } = this;
    const x0 = cx * MEADOW_CELL;
    const z0 = cz * MEADOW_CELL;
    const tries = Math.round((MEADOW_CELL * MEADOW_CELL * MEADOW_DENSITY[T.GRASS]) / 1000);
    const mats = [];
    const cols = [];
    const flowers = [];
    const c = new THREE.Color();
    for (let i = 0; i < tries; i++) {
      const hx = hash2(cx * 7919 + i, cz * 104729 + i * 31, seed + 11);
      const hz = hash2(cx * 6271 + i * 17, cz * 3301 + i, seed + 23);
      const x = x0 + hx * MEADOW_CELL;
      const z = z0 + hz * MEADOW_CELL;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(z / TILE);
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      const t = tiles[ty * MAP_W + tx];
      const dens = MEADOW_DENSITY[t];
      if (!dens) continue;
      // поляны и плешины: луг местами гуще, местами реже
      const patch = terrain.patch(x / 300, z / 300, 2);
      const keep = (dens / MEADOW_DENSITY[T.GRASS]) * (patch > 0.62 ? 0.35 : patch > 0.55 ? 0.7 : 1);
      const r = hash2(cx * 131 + i, cz * 977 + i * 7, seed + 5);
      if (r > keep) continue;
      const gy = terrain.heightAt(x, z);
      if (gy < 0.5) continue;
      if (terrain.zones.length && zoneAt(terrain.zones, x, z)) continue;
      const s1 = hash2(i, cx * 31 + cz, seed + 41);
      const s2 = hash2(i * 3, cz * 31 + cx, seed + 43);
      // ширина 5–6, высота 4–6 (как sizeVariation у ez-tree), в наших единицах модель ×2
      const sx = (5 + s1) * 1.15;
      const sy = (4 + 2 * s2) * (t === T.FOREST ? 0.85 : 1.1);
      mats.push(M(x, gy - 0.4, z, 0, s1 * 6.283, 0, sx, sy, sx));
      const g = hash2(i * 5, cx + cz * 3, seed + 47);
      cols.push(c.setRGB(0.25 + g * 0.1, 0.3 + s2 * 0.3, 0.1).multiplyScalar(t === T.FOREST ? 1.3 : 1.55).clone());
      // цветы — только на лугах, редко
      if (t === T.GRASS && hash2(i * 7, cz * 13 + cx, seed + 53) < 0.012) {
        // модель цветка внутри файла уменьшена (≈1,5 ед.) — растягиваем до 13–19 ед., чуть выше травы
        flowers.push([x, gy - 0.3, z, s1 * 6.283, 8.5 + s2 * 4, Math.floor(g * 3) % 3]);
      }
    }
    let mesh = null;
    if (mats.length) {
      mesh = new THREE.InstancedMesh(this.geoms.tuft, this.meadowMaterial, mats.length);
      mats.forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, cols[k]);
      });
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    return { mesh, flowers };
  }

  // густой луг и цветы вокруг игрока: строим ближние ячейки (по 2 за кадр), выгружаем дальние
  updateMeadow(target) {
    grassUniforms.uCenter.value.set(target.x, target.z);
    if (!this.meadowMaterial) return;
    const R = MEADOW_R + MEADOW_CELL;
    const need = [];
    for (let cz = Math.floor((target.z - R) / MEADOW_CELL); cz <= Math.floor((target.z + R) / MEADOW_CELL); cz++) {
      for (let cx = Math.floor((target.x - R) / MEADOW_CELL); cx <= Math.floor((target.x + R) / MEADOW_CELL); cx++) {
        if (cx < 0 || cz < 0) continue;
        const d = Math.hypot((cx + 0.5) * MEADOW_CELL - target.x, (cz + 0.5) * MEADOW_CELL - target.z);
        const key = cx * 4096 + cz;
        if (d < MEADOW_R + MEADOW_CELL * 0.75 && !this.meadow.has(key)) need.push([d, cx, cz, key]);
      }
    }
    need.sort((a, b) => a[0] - b[0]);
    const budget = this.meadowWarm ? need.length : 2;
    for (let i = 0; i < Math.min(budget, need.length); i++) {
      const [, cx, cz, key] = need[i];
      this.meadow.set(key, this.buildMeadowCell(cx, cz));
      this.flowersDirty = true;
    }
    if (need.length) this.meadowWarm = false;
    for (const [key, cell] of this.meadow) {
      const cx = Math.floor(key / 4096);
      const cz = key % 4096;
      if (Math.hypot((cx + 0.5) * MEADOW_CELL - target.x, (cz + 0.5) * MEADOW_CELL - target.z) > MEADOW_R + MEADOW_CELL * 2) {
        if (cell.mesh) {
          this.group.remove(cell.mesh);
          cell.mesh.dispose();
        }
        this.meadow.delete(key);
        this.flowersDirty = true;
      }
    }
    if (this.flowersDirty) this.rebuildFlowers();
  }

  rebuildFlowers() {
    const kinds = FLOWERS.map((n) => this.flowerParts[n]);
    if (kinds.some((k) => !k)) return; // цветы ещё грузятся
    this.flowersDirty = false;
    const counts = [0, 0, 0];
    for (const cell of this.meadow.values()) {
      for (const [x, y, z, rot, sc, kind] of cell.flowers) {
        const n = counts[kind];
        if (n >= FLOWER_MAX) continue;
        const m = M(x, y, z, 0, rot, 0, sc);
        for (const part of kinds[kind]) part.setMatrixAt(n, m);
        counts[kind]++;
      }
    }
    kinds.forEach((parts, k) => {
      for (const part of parts) {
        part.count = counts[k];
        part.instanceMatrix.needsUpdate = true;
      }
    });
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

  buildChunk(cx, cz, target) {
    const { terrain, tiles, seed } = this;
    const lists = { tuft: [], flower: [], fern: [], pebble: [] };
    const push = (type, x, z, sc, k) => lists[type].push([x, z, sc, k]);
    // редкая трава до горизонта; густой луг рядом с игроком — отдельным слоем (updateMeadow)
    const samples = 5;
    const per = CHUNK / TILE;
    const tx0 = Math.max(2, cx * per);
    const ty0 = Math.max(2, cz * per);
    const tx1 = Math.min(MAP_W - 2, (cx + 1) * per);
    const ty1 = Math.min(MAP_H - 2, (cz + 1) * per);
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const t = tiles[ty * MAP_W + tx];
        if (t === T.DEEP) continue;
        for (let k = 0; k < samples; k++) {
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
            if (r < 0.7) push('tuft', x, z, sc);
            else if (r < 0.74) push('flower', x, z, sc, k);
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
        const sx = tuft ? (5 + sc) * 1.4 : sc;
        const sy = tuft ? (4 + sc * 2) * 1.2 : sc;
        mesh.setMatrixAt(i, M(x, terrain.heightAt(x, z) - 0.5, z, 0, (x * 13.7 + z) % 6.28, 0, sx, sy, sx));
        if (tuft) {
          // те же оттенки, что у густого луга
          const tint = hash2(Math.floor(x), Math.floor(z), seed + 257);
          mesh.setColorAt(i, c.setRGB(0.25 + tint * 0.1, 0.3 + sc * 0.2, 0.1).multiplyScalar(1.55));
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
    grassUniforms.uTime.value = performance.now() * 0.001;
    this.updateMeadow(target);
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
      this.chunks.set(key, this.buildChunk(cx, cz, target));
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
