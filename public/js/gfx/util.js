// Мелкие помощники для процедурной 3D-геометрии.
import * as THREE from 'three';

export const UP = new THREE.Vector3(0, 1, 0);

// Детерминированный псевдослучай по целым координатам
export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function rng(seed) {
  let a = Math.floor(seed * 4294967296) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// Матрица из позиции, поворота (эйлер) и масштаба
export function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(rx, ry, rz));
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// Матрица, которая ставит единичный цилиндр/конус (ось Y, высота 1, центр в 0) между точками a и b
export function between(a, b, rx, rz = rx) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 0.0001;
  dir.divideScalar(len);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(rx, len, rz));
}

// Склеивает набор деталей в одну геометрию с цветами вершин (один draw call)
// parts: [{ geom, matrix, color }]
export function mergeParts(parts) {
  const prepared = [];
  let total = 0;
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geom.index ? p.geom.toNonIndexed() : p.geom.clone();
    g.applyMatrix4(p.matrix);
    prepared.push([g, c.set(p.color).clone()]);
    total += g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const [g, color] of prepared) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    for (let i = 0; i < n; i++) {
      col[(o + i) * 3] = color.r;
      col[(o + i) * 3 + 1] = color.g;
      col[(o + i) * 3 + 2] = color.b;
    }
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt < 0) c.lerp(new THREE.Color(0x000000), -amt);
  else c.lerp(new THREE.Color(0xffffff), amt);
  return c;
}

export function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// Общие единичные геометрии
export const G = {
  sphere: new THREE.SphereGeometry(1, 12, 9),
  ico: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 7),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 7),
  cone5: new THREE.ConeGeometry(1, 1, 5),
};

const taperCache = new Map();
// Усечённый конус: радиус низа 1, верха ratio
export function taper(ratio) {
  const k = Math.round(ratio * 20) / 20;
  if (!taperCache.has(k)) taperCache.set(k, new THREE.CylinderGeometry(k, 1, 1, 7));
  return taperCache.get(k);
}

// Мягкая круглая текстура для свечения
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}
