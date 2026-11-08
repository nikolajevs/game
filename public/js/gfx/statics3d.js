// 3D-вид статичных объектов: деревья, камни, кусты, кристаллы, постройки, останки.
// Ресурсов много, поэтому они рисуются через InstancedMesh (пулы).
import * as THREE from 'three';
import { TILE, STRUCTURES } from '/shared/config.js';
import { G, M, between, mergeParts, rng, shade, taper } from './util.js';
import { Fire } from './fire.js';

const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const STATIC_CHUNK = 600;
// ресурсы рисуются пулами по участкам карты; постройки — отдельными мешами
const RESOURCE_KINDS = new Set(['tree', 'rock', 'sulfur', 'bush', 'crystal', 'scrap']);
const _hidden = new THREE.Matrix4();

class Pool {
  constructor(parent, kind, geom, material, capacity, shadow = true) {
    this.parent = parent;
    this.kind = kind;
    this.geom = geom;
    this.material = material;
    this.max = Math.max(1, capacity);
    this.shadow = shadow;
    this.mesh = new THREE.InstancedMesh(geom, material, this.max);
    this.mesh.count = 0;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.keys = [];
    this.slot = new Map();
    this.dirty = false;
    parent.add(this.mesh);
  }

  set(key, matrix, color) {
    let i = this.slot.get(key);
    if (i === undefined) {
      if (this.mesh.count >= this.max) this.grow(this.mesh.count + 1);
      i = this.mesh.count++;
      this.slot.set(key, i);
      this.keys[i] = key;
    }
    this.mesh.setMatrixAt(i, matrix);
    if (color) this.mesh.setColorAt(i, color);
    this.dirty = true;
  }

  grow(required) {
    const previous = this.mesh;
    while (this.max < required) this.max *= 2;
    const next = new THREE.InstancedMesh(this.geom, this.material, this.max);
    next.count = previous.count;
    next.castShadow = this.shadow;
    next.receiveShadow = true;
    next.frustumCulled = true;
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < previous.count; i++) {
      previous.getMatrixAt(i, _m);
      next.setMatrixAt(i, _m);
      if (previous.instanceColor) {
        previous.getColorAt(i, _c);
        next.setColorAt(i, _c);
      }
    }
    this.parent.remove(previous);
    this.parent.add(next);
    previous.dispose?.();
    this.mesh = next;
  }

  remove(key) {
    const i = this.slot.get(key);
    if (i === undefined) return;
    const last = --this.mesh.count;
    if (i !== last) {
      const lk = this.keys[last];
      this.mesh.getMatrixAt(last, _m);
      this.mesh.setMatrixAt(i, _m);
      if (this.mesh.instanceColor) {
        this.mesh.getColorAt(last, _c);
        this.mesh.setColorAt(i, _c);
      }
      this.keys[i] = lk;
      this.slot.set(lk, i);
    }
    this.keys.length = last;
    this.slot.delete(key);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.dirty = false;
  }
}

const flatMat = (opts = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.85, ...opts });

// ---------- геометрия построек (склеенная, с цветами вершин) ----------
function buildStructureGeoms() {
  const out = {};
  const r = rng(0.4242);
  const woods = ['#8b5a2b', '#7a4e25', '#94643a', '#6f4622'];

  // частокол 3x3 из заострённых брёвен
  {
    const parts = [];
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const h = 46 + r() * 8;
        const c = woods[Math.floor(r() * woods.length)];
        parts.push({ geom: G.cyl6, matrix: M(ix * 13, h / 2 - 8, iz * 13, 0, r(), 0, 6.8, h, 6.8), color: c });
        parts.push({ geom: G.cone, matrix: M(ix * 13, h - 8 + 4, iz * 13, 0, r(), 0, 6.8, 8, 6.8), color: shade(c, 0.15) });
      }
    }
    for (const y of [10, 30]) {
      parts.push({ geom: G.box, matrix: M(0, y, 0, 0, 0, 0, 41, 3, 41), color: '#4b3018' });
    }
    out.wall_wood = mergeParts(parts);
  }

  // каменная стена: ряды блоков
  {
    const parts = [];
    const greys = ['#8e8f8a', '#7d7e79', '#9c9b94', '#86857e'];
    for (let row = 0; row < 3; row++) {
      for (let ix = 0; ix < 2; ix++) {
        for (let iz = 0; iz < 2; iz++) {
          const off = row % 2 ? 2 : -2;
          parts.push({
            geom: G.box,
            matrix: M(-10 + ix * 20 + off, row * 17 + 2, -10 + iz * 20, 0, (r() - 0.5) * 0.08, 0, 19.5, 16.5, 19.5),
            color: greys[Math.floor(r() * greys.length)],
          });
        }
      }
    }
    parts.push({ geom: G.box, matrix: M(0, 52, 0, 0, 0, 0, 42, 3, 42), color: '#6c6b66' });
    out.wall_stone = mergeParts(parts);
  }

  // дверь (ориентирована вдоль X)
  {
    const parts = [];
    for (const s of [-1, 1]) parts.push({ geom: G.cyl6, matrix: M(s * 17, 22, 0, 0, 0, 0, 4.5, 60, 4.5), color: '#6b4422' });
    parts.push({ geom: G.cyl6, matrix: M(0, 50, 0, 0, 0, Math.PI / 2, 4.5, 40, 4.5), color: '#6b4422' });
    for (let i = 0; i < 3; i++) {
      parts.push({ geom: G.box, matrix: M(-9 + i * 9.5, 22, 0, 0, 0, 0, 9, 44, 4), color: woods[i] });
    }
    for (const y of [10, 34]) parts.push({ geom: G.box, matrix: M(0, y, 0, 0, 0, 0, 30, 3, 5), color: '#3d3d40' });
    out.door = mergeParts(parts);
  }

  // хранилище — сундук
  {
    const parts = [];
    parts.push({ geom: G.box, matrix: M(0, 9, 0, 0, 0, 0, 32, 18, 24), color: '#7a4e25' });
    parts.push({ geom: G.box, matrix: M(0, 21, 0, 0, 0, 0, 33, 6, 25), color: '#8b5a2b' });
    for (const x of [-12, 12]) parts.push({ geom: G.box, matrix: M(x, 12, 0, 0, 0, 0, 3, 25, 26), color: '#3d3d40' });
    parts.push({ geom: G.box, matrix: M(0, 16, 12.8, 0, 0, 0, 5, 6, 2), color: '#d8b04a' });
    out.storage = mergeParts(parts);
  }

  // костёр без пламени
  {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      parts.push({ geom: G.dodeca, matrix: M(Math.cos(a) * 13, 2, Math.sin(a) * 13, r(), r(), r(), 4.5 + r() * 1.5), color: i % 2 ? '#80807a' : '#6e6e68' });
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      parts.push({ geom: G.cyl6, matrix: M(0, 3, 0, 0, a, Math.PI / 2 - 0.25, 2.6, 22, 2.6), color: '#5a3a1c' });
    }
    parts.push({ geom: G.cyl, matrix: M(0, 0.5, 0, 0, 0, 0, 11, 1, 11), color: '#2b2522' });
    out.campfire = mergeParts(parts);
  }

  // колья
  {
    const parts = [];
    parts.push({ geom: G.box, matrix: M(0, 1.5, 0, 0, 0, 0, 38, 3, 38), color: '#4b3018' });
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const base = new THREE.Vector3(ix * 12, 2, iz * 12);
        const tip = new THREE.Vector3(ix * 12 + ix * 9 + (r() - 0.5) * 6, 26 + r() * 6, iz * 12 + iz * 9 + (r() - 0.5) * 6);
        const mid = base.clone().lerp(tip, 0.7);
        parts.push({ geom: G.cyl6, matrix: between(base, mid, 2.6), color: '#a07a4a' });
        parts.push({ geom: G.cone5, matrix: between(mid, tip, 2.6), color: '#e0c89a' });
      }
    }
    out.spikes = mergeParts(parts);
  }

  // гнездо
  {
    const parts = [];
    parts.push({ geom: new THREE.TorusGeometry(14, 5.5, 6, 14), matrix: M(0, 4, 0, Math.PI / 2, 0, 0), color: '#8a6a3a' });
    parts.push({ geom: G.cyl, matrix: M(0, 1.5, 0, 0, 0, 0, 13, 2, 13), color: '#5a4426' });
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      parts.push({ geom: G.cyl6, matrix: M(Math.cos(a) * 15, 6 + r() * 3, Math.sin(a) * 15, r() * 3, a, Math.PI / 2 + (r() - 0.5), 0.9, 16, 0.9), color: '#a1824e' });
    }
    out.nest = mergeParts(parts);
  }

  // останки: кости и мешок
  {
    const parts = [];
    parts.push({ geom: G.ico1, matrix: M(-4, 5, 2, 0, 0, 0, 6.5, 5.5, 6), color: '#e9e2cf' });
    parts.push({ geom: G.sphere, matrix: M(-1, 5, 4.5, 0, 0, 0, 1.4), color: '#222' });
    parts.push({ geom: G.sphere, matrix: M(-1, 5, -0.5, 0, 0, 0, 1.4), color: '#222' });
    for (let i = 0; i < 3; i++) {
      parts.push({ geom: G.cyl6, matrix: M(4 + i * 2, 1.5, -4 + i * 4, 0, i * 1.1, Math.PI / 2, 1.5, 18, 1.5), color: '#ddd5c0' });
    }
    parts.push({ geom: G.ico1, matrix: M(8, 6, 6, 0, 0, 0, 8, 6.5, 7), color: '#7a5a34' });
    out.remains = mergeParts(parts);
  }

  // ящик с добычей: армейский зелёный, с полосой и защёлками
  {
    const parts = [];
    parts.push({ geom: G.box, matrix: M(0, 9, 0, 0, 0, 0, 30, 18, 20), color: '#4c5e3a' });
    parts.push({ geom: G.box, matrix: M(0, 19, 0, 0, 0, 0, 31, 3, 21), color: '#3e4d30' });
    parts.push({ geom: G.box, matrix: M(0, 10, 10.2, 0, 0, 0, 30, 4, 0.8), color: '#d9b43a' });
    for (const x of [-9, 9]) parts.push({ geom: G.box, matrix: M(x, 15, 10.6, 0, 0, 0, 3, 5, 1.2), color: '#9a9a9a' });
    for (const x of [-15.5, 15.5]) parts.push({ geom: G.box, matrix: M(x, 11, 0, 0, 0, 0, 1.5, 6, 8), color: '#2e3a24' });
    out.crate = mergeParts(parts);
  }

  // верстак: стол с тисками, пилой и молотом
  {
    const parts = [];
    parts.push({ geom: G.box, matrix: M(0, 20, 0, 0, 0, 0, 38, 4, 26), color: '#8b5a2b' });
    for (const [x, z] of [[-16, -10], [16, -10], [-16, 10], [16, 10]]) parts.push({ geom: G.box, matrix: M(x, 9, z, 0, 0, 0, 4, 18, 4), color: '#6b4423' });
    parts.push({ geom: G.box, matrix: M(0, 6, 0, 0, 0, 0, 34, 2, 22), color: '#5a3a1c' });
    parts.push({ geom: G.box, matrix: M(-11, 25, -6, 0, 0, 0, 9, 6, 7), color: '#5e5e64' });
    parts.push({ geom: G.cyl6, matrix: M(-11, 25, 0, Math.PI / 2, 0, 0, 1.2, 10, 1.2), color: '#3d3d40' });
    parts.push({ geom: G.box, matrix: M(8, 22.6, 4, 0, 0.4, 0, 18, 1, 6), color: '#c0c0c8' });
    parts.push({ geom: G.cyl6, matrix: M(10, 23, -7, 0, 0, Math.PI / 2, 1, 14, 1), color: '#7a4e25' });
    parts.push({ geom: G.box, matrix: M(17, 23, -7, 0, 0, 0, 4, 5, 6), color: '#5e5e64' });
    out.workbench = mergeParts(parts);
  }

  // лаборатория: бетонный блок с экранами, колбами и антенной
  {
    const parts = [];
    parts.push({ geom: G.box, matrix: M(0, 13, 0, 0, 0, 0, 38, 26, 30), color: '#9a968c' });
    parts.push({ geom: G.box, matrix: M(0, 27, 0, 0, 0, 0, 40, 3, 32), color: '#6e6e68' });
    parts.push({ geom: G.box, matrix: M(-8, 15, 15.4, 0, 0, 0, 14, 9, 1), color: '#1d2b33' });
    parts.push({ geom: G.box, matrix: M(-8, 15, 15.9, 0, 0, 0, 12, 7, 0.4), color: '#5ec8ff' });
    parts.push({ geom: G.box, matrix: M(10, 10, 15.4, 0, 0, 0, 8, 20, 1), color: '#4a4a50' });
    for (const [x, c] of [[-14, '#7dff4a'], [-10, '#c77dff'], [-6, '#ffd166']]) {
      parts.push({ geom: G.cyl, matrix: M(x, 31.5, -8, 0, 0, 0, 1.6, 6, 1.6), color: c });
    }
    parts.push({ geom: G.cyl6, matrix: M(12, 40, -6, 0, 0, 0, 0.8, 24, 0.8), color: '#5e5e64' });
    parts.push({ geom: G.sphere, matrix: M(12, 52, -6, 0, 0, 0, 2.2), color: '#d9534f' });
    parts.push({ geom: G.cyl, matrix: M(4, 30, 6, 0.5, 0, 0, 7, 1.2, 7), color: '#c0c0c8' });
    out.lab = mergeParts(parts);
  }

  // автотурель: тренога, вращающаяся голова со стволом и сенсором
  {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push({ geom: G.box, matrix: M(Math.cos(a) * 8, 8, Math.sin(a) * 8, Math.sin(a) * 0.45, -a, -Math.cos(a) * 0.45, 2.4, 18, 2.4), color: '#4a4a50' });
    }
    parts.push({ geom: G.cyl, matrix: M(0, 2, 0, 0, 0, 0, 13, 4, 13), color: '#5e5e64' });
    parts.push({ geom: G.cyl, matrix: M(0, 18, 0, 0, 0, 0, 5, 6, 5), color: '#3d3d40' });
    parts.push({ geom: G.box, matrix: M(0, 25, 0, 0, 0, 0, 16, 9, 12), color: '#6b7380' });
    parts.push({ geom: G.cyl6, matrix: M(14, 25, -2.5, 0, 0, Math.PI / 2, 1.3, 18, 1.3), color: '#2b2b2e' });
    parts.push({ geom: G.cyl6, matrix: M(14, 25, 2.5, 0, 0, Math.PI / 2, 1.3, 18, 1.3), color: '#2b2b2e' });
    parts.push({ geom: G.box, matrix: M(4, 30.5, 0, 0, 0, 0, 5, 2, 5), color: '#d9534f' });
    parts.push({ geom: G.box, matrix: M(8.2, 26, 0, 0, 0, 0, 0.6, 3, 4), color: '#5ec8ff' });
    out.turret = mergeParts(parts);
  }
  return out;
}

export class StaticsView {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.objs = new Map(); // id -> { s, parts: [[pool, key]], mesh, extra }
    this.poolSets = new Map();
    this.occluders = new Set();
    this.shaking = new Set();
    this.lightObjects = new Set();
    this.lightSources = [];
    this.lastCutaway = null;
    this.time = 0;

    const leaf = flatMat({ roughness: 0.9, side: THREE.DoubleSide });
    this.poolDefs = {
      trunk: [taper(0.68), flatMat(), 24, true],
      branch: [G.cyl6, flatMat(), 96, true],
      pine: [G.cone, leaf, 64, true],
      blob: [G.ico, leaf, 96, true],
      rock: [G.dodeca, flatMat({ roughness: 0.95 }), 32, true],
      berry: [G.ico, flatMat({ roughness: 0.4 }), 32, false],
      crystal: [G.octa, new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: '#7a2bd6', emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3, flatShading: true,
      }), 24, true],
      ore: [G.octa, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: '#6a5a00', emissiveIntensity: 0.35, roughness: 0.4, flatShading: true }), 32, false],
      scrap: [G.box, flatMat({ roughness: 0.7, metalness: 0.35 }), 32, true],
      barrel: [G.cyl, flatMat({ roughness: 0.6, metalness: 0.3 }), 16, true],
    };

    this.sGeo = buildStructureGeoms();
    this.sMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
    this.eggMats = new Map();
    this.mineMat = new THREE.MeshStandardMaterial({ color: '#53d769', emissive: '#1f7a2e', emissiveIntensity: 0.6 });
    this.otherMat = new THREE.MeshStandardMaterial({ color: '#d9534f', emissive: '#7a1f1f', emissiveIntensity: 0.4 });

    // пул точечных источников света: назначаются ближайшим кострам/кристаллам
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight('#ff9a3c', 0, 260, 0);
      l.castShadow = false;
      this.lights.push(l);
      scene.add(l);
    }
    this.myUid = null;
  }

  ground(x, z) {
    return this.terrain.heightAt(x, z);
  }

  getPools(x, z) {
    const cx = Math.floor(x / STATIC_CHUNK);
    const cz = Math.floor(z / STATIC_CHUNK);
    const key = `${cx},${cz}`;
    let pools = this.poolSets.get(key);
    if (pools) return pools;
    const defs = this.poolDefs;
    const parent = this.group;
    pools = new Proxy({}, {
      get: (set, kind) => {
        if (Object.prototype.hasOwnProperty.call(set, kind)) return set[kind];
        const def = defs[kind];
        if (!def) return undefined;
        const [geom, material, capacity, shadow] = def;
        return (set[kind] = new Pool(parent, kind, geom, material, capacity, shadow));
      },
    });
    this.poolSets.set(key, pools);
    return pools;
  }

  // ---------- добавление / обновление / удаление ----------
  upsert(s) {
    const old = this.objs.get(s.i);
    if (old && old.s.k === s.k) {
      const prevH = old.s.h;
      old.s = s;
      if (s.h !== prevH) this.onHpChange(old);
      return;
    }
    if (old) this.remove(s.i);
    const o = { s, parts: [], mesh: null, extra: null, shake: 0 };
    if (RESOURCE_KINDS.has(s.k)) o.pools = this.getPools(s.x, s.y);
    this.objs.set(s.i, o);
    if (s.k === 'tree') this.addTree(o);
    else if (s.k === 'rock' || s.k === 'sulfur') this.addRock(o);
    else if (s.k === 'bush') this.addBush(o);
    else if (s.k === 'crystal') this.addCrystal(o);
    else if (s.k === 'scrap') this.addScrap(o);
    else this.addStructure(o);
    if (o.s.k === 'tree' || o.s.k === 'rock' || o.s.k === 'sulfur') this.occluders.add(o);
    if (o.light) this.lightObjects.add(o);
    this.lastCutaway = null;
  }

  remove(id) {
    const o = this.objs.get(id);
    if (!o) return;
    this.occluders.delete(o);
    this.shaking.delete(o);
    this.lightObjects.delete(o);
    for (const [pool, key] of o.parts) pool.remove(key);
    if (o.mesh) {
      this.group.remove(o.mesh);
    }
    o.extra?.fire?.dispose();
    this.objs.delete(id);
  }

  hit(id) {
    const o = this.objs.get(id);
    if (o) {
      o.shake = 0.35;
      this.shaking.add(o);
    }
  }

  onHpChange(o) {
    const k = o.s.k;
    if ((k === 'rock' || k === 'sulfur') && !o.hidden) this.addRock(o);
    else if (k === 'bush') this.addBush(o);
    else if (k === 'crystal') this.addCrystal(o);
    else if (k === 'scrap') this.addScrap(o);
  }

  // груда металлолома: ржавые ящики, листы и бочка
  addScrap(o) {
    const s = o.s;
    const pools = o.pools;
    const r = rng(s.v || 0.4);
    const gy = this.ground(s.x, s.y);
    const k = 0.6 + 0.4 * (s.h / (s.m || 1));
    const rust = ['#8a5a3a', '#6e4a36', '#7d7a74', '#9a6a3a', '#5e5a55'];
    for (let i = 0; i < 5; i++) {
      const key = `${s.i}:${i}`;
      const a = r() * Math.PI * 2;
      const d = i === 0 ? 0 : 8 + r() * 8;
      const w = (8 + r() * 10) * k;
      const h = (4 + r() * 8) * k;
      pools.scrap.set(key, M(s.x + Math.cos(a) * d, gy + h / 2 + (i === 0 ? 0 : r() * 4), s.y + Math.sin(a) * d, (r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8, w, h, w * (0.4 + r() * 0.8)), _c.set(rust[i]).clone());
      if (o.parts.length < 5) o.parts.push([pools.scrap, key]);
    }
    const bk = `${s.i}:barrel`;
    pools.barrel.set(bk, M(s.x + 12, gy + 9 * k, s.y - 8, 0, 0, r() < 0.4 ? Math.PI / 2 : 0, 6 * k, 18 * k, 6 * k), _c.set(r() < 0.5 ? '#c9a227' : '#4a6b3a').clone());
    if (o.parts.length < 6) o.parts.push([pools.barrel, bk]);
  }

  addTree(o) {
    const s = o.s;
    const pools = o.pools;
    const r = rng(s.v || 0.5);
    const gy = this.ground(s.x, s.y);
    const pine = (s.v || 0.5) < 0.55;
    const sc = 0.85 + r() * 0.45;
    const trunkH = (pine ? 34 : 30) * sc;
    o.base = [];
    const push = (pool, key, m, color) => {
      pool.set(key, m, color);
      o.parts.push([pool, key]);
      o.base.push([pool, key, m.clone(), color]);
    };
    push(pools.trunk, s.i, M(s.x, gy + trunkH / 2 - 4, s.y, 0, r() * 3, 0, 4.2 * sc, trunkH, 4.2 * sc), _c.set(r() < 0.5 ? '#6b4423' : '#5d3b1e').clone());
    if (pine) {
      const g = new THREE.Color().setHSL(0.36 + r() * 0.05, 0.45, 0.22 + r() * 0.06);
      const tiers = 4;
      for (let i = 0; i < tiers; i++) {
        const w = (27 - i * 5.2) * sc * (0.9 + r() * 0.2);
        const h = (27 - i * 2.2) * sc;
        const y = gy + trunkH - 8 + i * 11.5 * sc + h / 2;
        const shadeByTier = i * 0.025 + (r() - 0.5) * 0.025;
        push(pools.pine, `${s.i}:${i}`, M(s.x, y, s.y, 0, r() * Math.PI, 0, w, h, w), g.clone().offsetHSL((r() - 0.5) * 0.02, 0, shadeByTier));
      }
    } else {
      const autumn = r() < 0.14;
      const hue = autumn ? 0.09 + r() * 0.07 : 0.25 + r() * 0.07;
      const g = new THREE.Color().setHSL(hue, autumn ? 0.62 : 0.48, 0.31 + r() * 0.08);
      const trunkBase = new THREE.Vector3(s.x, gy + trunkH * 0.48, s.y);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + r() * 0.35;
        const tip = new THREE.Vector3(
          s.x + Math.cos(a) * 15 * sc,
          gy + trunkH + 5 * sc + r() * 4,
          s.y + Math.sin(a) * 15 * sc,
        );
        const bark = _c.set('#694326').offsetHSL(0, 0, (r() - 0.5) * 0.08).clone();
        push(pools.branch, `${s.i}:branch${i}`, between(trunkBase, tip, 1.35 * sc), bark);
      }
      const clusters = 7;
      for (let i = 0; i < clusters; i++) {
        const a = (i / (clusters - 1)) * Math.PI * 2 + r() * 0.3;
        const center = i === 0;
        const d = center ? 0 : (10 + r() * 4) * sc;
        const radius = (center ? 18 : 12 + r() * 3) * sc;
        const y = gy + trunkH + (center ? 17 : 7 + (i % 2) * 8 + r() * 4) * sc;
        const clusterColor = g.clone().offsetHSL((r() - 0.5) * 0.025, (r() - 0.5) * 0.08, (r() - 0.5) * 0.15);
        push(pools.blob, `${s.i}:crown${i}`, M(
          s.x + Math.cos(a) * d,
          y,
          s.y + Math.sin(a) * d,
          r() * 0.5,
          r() * Math.PI,
          r() * 0.5,
          radius,
          radius * (0.76 + r() * 0.18),
          radius * (0.82 + r() * 0.22),
        ), clusterColor);
      }
    }
  }

  addRock(o) {
    const s = o.s;
    const pools = o.pools;
    const r = rng(s.v || 0.3);
    const gy = this.ground(s.x, s.y);
    const k = 0.55 + 0.45 * (s.h / (s.m || 1));
    const base = 20 * k;
    const g = 0.42 + r() * 0.12;
    const sulfur = s.k === 'sulfur';
    const col = sulfur ? new THREE.Color(g * 1.15, g * 1.05, g * 0.55) : new THREE.Color(g, g, g * 0.95);
    const key = s.i;
    const m = M(s.x, gy + base * 0.35, s.y, r() * 3, r() * 3, r() * 3, base * (1 + r() * 0.4), base * (0.7 + r() * 0.3), base * (1 + r() * 0.4));
    pools.rock.set(key, m, col);
    if (!o.parts.length) o.parts.push([pools.rock, key]);
    // второй камешек рядом
    const key2 = `${s.i}:b`;
    const m2 = M(s.x + (r() - 0.5) * 26, gy + 3, s.y + (r() - 0.5) * 26, r() * 3, r() * 3, r() * 3, base * 0.45);
    pools.rock.set(key2, m2, col.clone().multiplyScalar(0.9));
    if (o.parts.length < 2) o.parts.push([pools.rock, key2]);
    // жёлтые кристаллы серы на валуне
    if (sulfur) {
      for (let i = 0; i < 4; i++) {
        const ok = `${s.i}:o${i}`;
        const a = r() * Math.PI * 2;
        pools.ore.set(ok, M(s.x + Math.cos(a) * base * 0.55, gy + base * (0.55 + r() * 0.3), s.y + Math.sin(a) * base * 0.55, r() * 3, r() * 3, r() * 3, 3.2 * k, 5.5 * k, 3.2 * k), _c.setHSL(0.14, 0.9, 0.55).clone());
        if (o.parts.length < 6) o.parts.push([pools.ore, ok]);
      }
    }
  }

  // Ягодный куст: плотная круглая шапка из нескольких «облачков» листвы (как кроны деревьев),
  // короткие веточки у земли и грозди ягод прямо на поверхности листвы.
  addBush(o) {
    const s = o.s;
    const pools = o.pools;
    const gy = this.ground(s.x, s.y);
    if (!o.shape) {
      const r = rng(s.v || 0.7);
      const size = 0.85 + r() * 0.35;
      const blobs = [{ x: 0, y: 9.5 * size, z: 0, rx: 10.5 * size, ry: 8 * size, rz: 10.5 * size, ry0: r() * 6 }];
      const n = 5 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
        const d = (7 + r() * 2.5) * size;
        const rad = (5.5 + r() * 2.5) * size;
        blobs.push({ x: Math.cos(a) * d, y: rad * 0.8 + r() * 2, z: Math.sin(a) * d, rx: rad, ry: rad * 0.85, rz: rad, ry0: r() * 6 });
      }
      // ягоды гроздьями: точка на верхней/боковой стороне облачка и 2–3 ягоды рядом
      const berries = [];
      const red = r() < 0.5;
      for (let g = 0; berries.length < 12; g++) {
        const b = blobs[g % blobs.length];
        const a = r() * Math.PI * 2;
        const el = 0.1 + r() * 0.9;
        const dir = new THREE.Vector3(Math.cos(el) * Math.cos(a), Math.sin(el), Math.cos(el) * Math.sin(a));
        const c = new THREE.Vector3(b.x + dir.x * b.rx * 0.97, b.y + dir.y * b.ry * 0.97, b.z + dir.z * b.rz * 0.97);
        const count = 2 + Math.floor(r() * 2);
        for (let k = 0; k < count && berries.length < 12; k++) {
          berries.push({
            x: c.x + (r() - 0.5) * 2.6, y: c.y + (r() - 0.5) * 2, z: c.z + (r() - 0.5) * 2.6, sz: 1.5 + r() * 0.5,
            color: new THREE.Color(red ? '#c8324b' : '#3b5bd9').offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.12),
          });
        }
      }
      const leaf = new THREE.Color().setHSL(0.27 + r() * 0.06, 0.45 + r() * 0.12, 0.25 + r() * 0.06);
      o.shape = { blobs, berries, leaf, r };
    }
    const { blobs, berries, leaf, r } = o.shape;
    if (!o.parts.length) {
      o.base = [];
      const push = (pool, key, m, color) => {
        pool.set(key, m, color);
        o.parts.push([pool, key]);
        o.base.push([pool, key, m.clone(), color]);
      };
      // веточки у земли
      const bark = new THREE.Color('#5a3d22');
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + r();
        const from = new THREE.Vector3(s.x, gy, s.y);
        const to = new THREE.Vector3(s.x + Math.cos(a) * 5, gy + 7, s.y + Math.sin(a) * 5);
        push(pools.branch, `${s.i}:stem${i}`, between(from, to, 0.7), bark);
      }
      // облачка листвы: нижние темнее, верхнее светлее
      blobs.forEach((b, i) => {
        const color = leaf.clone().offsetHSL((r() - 0.5) * 0.03, 0, (i === 0 ? 0.04 : -0.02) + (r() - 0.5) * 0.06);
        push(pools.blob, `${s.i}:leaf${i}`, M(s.x + b.x, gy + b.y, s.y + b.z, 0, b.ry0, 0, b.rx, b.ry, b.rz), color);
      });
    }
    // ягоды: чем меньше «здоровья», тем меньше ягод
    const left = Math.ceil(berries.length * (s.h / (s.m || 1)));
    berries.forEach((b, i) => {
      const key = `${s.i}:berry${i}`;
      if (i < left) {
        pools.berry.set(key, M(s.x + b.x, gy + b.y, s.y + b.z, 0, 0, 0, b.sz), b.color);
        if (!o.parts.some((p) => p[1] === key)) o.parts.push([pools.berry, key]);
      } else {
        pools.berry.remove(key);
      }
    });
  }


  addCrystal(o) {
    const s = o.s;
    const pools = o.pools;
    const r = rng(s.v || 0.9);
    const gy = this.ground(s.x, s.y);
    const k = 0.5 + 0.5 * (s.h / (s.m || 1));
    for (let i = 0; i < 4; i++) {
      const key = `${s.i}:${i}`;
      const a = (i / 4) * Math.PI * 2 + r();
      const d = i === 0 ? 0 : 7;
      const h = (i === 0 ? 30 : 18 + r() * 8) * k;
      pools.crystal.set(key, M(s.x + Math.cos(a) * d, gy + h * 0.4, s.y + Math.sin(a) * d, Math.cos(a) * 0.35 * (i ? 1 : 0), 0, Math.sin(a) * 0.35 * (i ? 1 : 0), 5 * k, h, 5 * k), _c.setHSL(0.76 + r() * 0.06, 0.8, 0.6).clone());
      if (o.parts.length < 4) o.parts.push([pools.crystal, key]);
    }
    o.light = 'crystal';
  }

  addStructure(o) {
    const s = o.s;
    const geo = this.sGeo[s.k];
    if (!geo) return;
    const gy = this.ground(s.x, s.y);
    const grp = new THREE.Group();
    const mesh = new THREE.Mesh(geo, this.sMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    grp.add(mesh);
    grp.position.set(s.x, gy, s.y);
    if (s.k === 'door') {
      grp.rotation.y = this.doorRotation(s);
      const handle = new THREE.Mesh(G.sphere, s.o && s.o === this.myUid ? this.mineMat : this.otherMat);
      handle.scale.setScalar(2.2);
      handle.position.set(9, 22, 3.5);
      grp.add(handle);
    }
    if (s.k === 'nest') {
      const color = s.c || '#e8dcc0';
      if (!this.eggMats.has(color)) this.eggMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true }));
      for (let i = 0; i < 3; i++) {
        const egg = new THREE.Mesh(G.sphere, this.eggMats.get(color));
        const a = (i / 3) * Math.PI * 2;
        egg.position.set(Math.cos(a) * 5, 6, Math.sin(a) * 5);
        egg.scale.set(4.5, 6, 4.5);
        egg.castShadow = true;
        grp.add(egg);
      }
    }
    if (s.k === 'campfire') {
      const fire = new Fire(1, (s.i * 0.618) % 1);
      grp.add(fire.group);
      o.extra = { fire };
      o.light = 'fire';
    }
    if (s.k === 'remains' || s.k === 'crate') grp.rotation.y = (s.i * 1.7) % (Math.PI * 2);
    o.mesh = grp;
    this.group.add(grp);
  }

  // Дверь разворачивается поперёк прохода: если стены слева/справа — вдоль X
  doorRotation(s) {
    const wallAt = (x, y) => {
      for (const o of this.objs.values()) {
        if (o.s.x === x && o.s.y === y && (o.s.k === 'wall_wood' || o.s.k === 'wall_stone')) return true;
      }
      return false;
    };
    const horiz = wallAt(s.x - TILE, s.y) || wallAt(s.x + TILE, s.y);
    const vert = wallAt(s.x, s.y - TILE) || wallAt(s.x, s.y + TILE);
    return vert && !horiz ? Math.PI / 2 : 0;
  }

  // Прячет кроны деревьев, которые стоят между камерой и игроком
  cutaway(camPos, target) {
    const ax = camPos.x;
    const az = camPos.z;
    const last = this.lastCutaway;
    if (last && (ax - last.ax) ** 2 + (az - last.az) ** 2 < 144 && (target.x - last.tx) ** 2 + (target.z - last.tz) ** 2 < 36) return;
    this.lastCutaway = { ax, az, tx: target.x, tz: target.z };
    const dx = target.x - ax;
    const dz = target.z - az;
    const len2 = dx * dx + dz * dz || 1;
    for (const o of this.occluders) {
      const tree = o.s.k === 'tree' && o.base;
      const rock = o.s.k === 'rock' || o.s.k === 'sulfur';
      if (!tree && !rock) continue;
      const t = ((o.s.x - ax) * dx + (o.s.y - az) * dz) / len2;
      let hide = false;
      if (t > -0.15 && t < (tree ? 1.15 : 0.9)) {
        const k = Math.max(0, Math.min(1, t));
        hide = Math.hypot(o.s.x - (ax + dx * k), o.s.y - (az + dz * k)) < (tree ? 36 : 34);
      }
      if (hide === !!o.hidden) continue;
      o.hidden = hide;
      _hidden.copy(ZERO);
      _hidden.elements[12] = o.s.x;
      _hidden.elements[13] = this.ground(o.s.x, o.s.y);
      _hidden.elements[14] = o.s.y;
      if (rock) {
        if (hide) for (const [pool, key] of o.parts) pool.set(key, _hidden);
        else this.addRock(o);
        continue;
      }
      for (const [pool, key, m, color] of o.base) {
        if (pool === o.pools.trunk) continue;
        pool.set(key, hide ? _hidden : m, color);
      }
    }
  }

  // ---------- кадр ----------
  update(dt, camPos, night, target) {
    this.time += dt;
    const t = this.time;
    if (target) this.cutaway(camPos, target);
    const lightSources = this.lightSources;
    lightSources.length = 0;
    for (const o of this.shaking) {
      o.shake -= dt;
      const amp = Math.max(0, o.shake) * 6;
      for (const [pool, key, m, color] of o.base || []) {
        if (o.hidden && pool !== o.pools.trunk) continue;
        _m.copy(m);
        if (pool !== o.pools.trunk) _m.elements[12] += Math.sin(t * 50) * amp;
        pool.set(key, _m, color);
      }
      if (o.shake <= 0) this.shaking.delete(o);
    }
    for (const o of this.lightObjects) {
      // огонь оживляем только поблизости — дальние костры всё равно скрыты дымкой
      if (o.extra?.fire && (o.s.x - camPos.x) ** 2 + (o.s.y - camPos.z) ** 2 < 1800 * 1800) {
        o.extra.fire.update(dt, t, camPos, night);
      }
      if (o.light) {
        const dx = o.s.x - camPos.x;
        const dz = o.s.y - camPos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 900 * 900) lightSources.push([d2, o]);
      }
    }
    lightSources.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const src = lightSources[i];
      if (!src) {
        l.intensity = 0;
        continue;
      }
      const o = src[1];
      const fire = o.light === 'fire';
      l.position.set(o.s.x, this.ground(o.s.x, o.s.y) + (fire ? 22 : 18), o.s.y);
      l.color.set(fire ? '#ff9a3c' : '#a35cff');
      l.distance = fire ? 280 : 160;
      const flick = fire ? o.extra?.fire?.light ?? 1 : 1;
      l.intensity = (fire ? 0.6 + night * 3.2 : 0.4 + night * 1.6) * flick;
    }
    for (const pools of this.poolSets.values()) for (const p of Object.values(pools)) p.flush();
  }
}
