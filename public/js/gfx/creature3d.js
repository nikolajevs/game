// Процедурное 3D-существо, собранное из частей генома (ноги, когти, панцирь, рога...).
// Локальные оси: +X — вперёд, Y — вверх, Z — вбок.
import * as THREE from 'three';
import { computeStats, decodeGenome } from '/shared/creature.js';
import { G, M, between, mergeParts, shade, mix, taper, glowTexture } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BONE = '#efe6cf';
const templates = new Map();

// Конус от основания base в направлении dir
function coneAlong(list, base, dir, r, h, color) {
  const tip = base.clone().addScaledVector(dir.clone().normalize(), h);
  list.push({ geom: G.cone, matrix: between(base, tip, r), color });
}

function limb(list, a, b, r1, r2, color) {
  list.push({ geom: taper(r2 / r1), matrix: between(a, b, r1), color });
}

function blob(list, p, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
  list.push({ geom: G.sphere, matrix: M(p.x, p.y, p.z, rx, ry, rz, sx, sy, sz), color });
}

// Шаблон (геометрия + раскладка) кэшируется по геному и цвету
function buildTemplate(look, color) {
  const key = `${look}|${color}`;
  if (templates.has(key)) return templates.get(key);
  const g = decodeGenome(look);
  const st = computeStats(g);
  const P = g.parts;
  const R = st.radius;
  const skin = new THREE.Color(color);
  const dark = shade(color, -0.4);
  const light = shade(color, 0.3);
  const belly = mix(color, '#f3e7c9', 0.55);

  const legLevel = P.legs;
  const pairs = legLevel === 0 ? 1 : legLevel >= 3 ? 3 : 2;
  const L = R * (0.45 + 0.2 * legLevel);
  const hb = R * 0.35 + L; // высота центра тела
  const rx = R * 1.15;
  const ry = R * 0.78;
  const rz = R * 0.88;
  const head = V(R * 1.05, hb + R * 0.2, 0);
  const hr = R * 0.6;

  const body = [];
  // туловище и брюхо
  blob(body, V(0, hb, 0), rx, ry, rz, skin);
  blob(body, V(R * 0.05, hb - R * 0.32, 0), R * 1.0, R * 0.48, R * 0.74, belly);
  // пятна на спине
  for (let i = 0; i < 4; i++) {
    const x = R * (0.55 - i * 0.38);
    blob(body, V(x, hb + ry * 0.82, (i % 2 ? 1 : -1) * R * 0.28), R * 0.2, R * 0.08, R * 0.16, dark);
  }
  // шея и голова
  limb(body, V(R * 0.55, hb + R * 0.05, 0), head, R * 0.5, hr * 0.75, skin);
  blob(body, head, hr, hr * 0.9, hr * 0.92, skin);

  // глаза
  const eyeCount = [2, 2, 3, 4][P.eyes];
  const er = R * (0.15 + 0.045 * P.eyes);
  const eyeDirs = [];
  if (eyeCount >= 2) eyeDirs.push(V(0.7, 0.5, 0.5), V(0.7, 0.5, -0.5));
  if (eyeCount === 3) eyeDirs.push(V(0.55, 0.85, 0));
  if (eyeCount === 4) eyeDirs.push(V(0.35, 0.8, 0.5), V(0.35, 0.8, -0.5));
  for (const d of eyeDirs) {
    d.normalize();
    const p = head.clone().addScaledVector(d, hr * 0.88);
    blob(body, p, er, er, er, '#ffffff');
    const pupil = p.clone().addScaledVector(d, er * 0.55).add(V(er * 0.25, 0, 0));
    blob(body, pupil, er * 0.55, er * 0.55, er * 0.55, '#141414');
  }

  // рот (нижняя челюсть хищника анимируется отдельно)
  let jaw = null;
  const mouthFront = head.clone().add(V(hr * 0.75, -hr * 0.18, 0));
  if (g.mouth === 'herb') {
    coneAlong(body, mouthFront.clone().add(V(-hr * 0.1, hr * 0.06, 0)), V(1, -0.15, 0), hr * 0.32, hr * 0.85, '#e8b830');
    coneAlong(body, mouthFront.clone().add(V(-hr * 0.1, -hr * 0.12, 0)), V(1, -0.35, 0), hr * 0.2, hr * 0.5, '#c99520');
  } else if (g.mouth === 'carn') {
    blob(body, mouthFront.clone().add(V(hr * 0.1, hr * 0.08, 0)), hr * 0.55, hr * 0.28, hr * 0.5, skin);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        coneAlong(body, mouthFront.clone().add(V(hr * (0.05 + i * 0.18), -hr * 0.05, s * hr * (0.35 - i * 0.08))), V(0, -1, 0), hr * 0.06, hr * 0.22, '#fffaf0');
      }
    }
    const jl = [];
    blob(jl, V(hr * 0.45, -hr * 0.05, 0), hr * 0.5, hr * 0.16, hr * 0.42, dark);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        coneAlong(jl, V(hr * (0.35 + i * 0.25), hr * 0.05, s * hr * (0.28 - i * 0.08)), V(0, 1, 0), hr * 0.05, hr * 0.18, '#fffaf0');
      }
    }
    jaw = { pos: head.clone().add(V(hr * 0.35, -hr * 0.4, 0)), geom: mergeParts(jl) };
  } else {
    blob(body, mouthFront, hr * 0.45, hr * 0.32, hr * 0.5, light);
    blob(body, mouthFront.clone().add(V(hr * 0.35, -hr * 0.08, 0)), hr * 0.12, hr * 0.08, hr * 0.3, '#3a1c1c');
    for (const s of [-1, 1]) coneAlong(body, mouthFront.clone().add(V(hr * 0.35, -hr * 0.08, s * hr * 0.18)), V(0.1, -1, 0), hr * 0.06, hr * 0.2, '#fffaf0');
  }

  // рога
  if (P.horns) {
    const len = R * (0.4 + 0.28 * P.horns);
    for (const s of [-1, 1]) {
      const a = head.clone().add(V(hr * 0.05, hr * 0.62, s * hr * 0.45));
      const b = a.clone().add(V(len * 0.15, len * 0.45, s * len * 0.25));
      const c = b.clone().add(V(len * 0.45, len * 0.25, s * len * 0.05));
      const d = c.clone().add(V(len * 0.45, -len * 0.05, -s * len * 0.05));
      limb(body, a, b, R * 0.13, R * 0.1, BONE);
      limb(body, b, c, R * 0.1, R * 0.07, BONE);
      coneAlong(body, c, d.clone().sub(c), R * 0.07, c.distanceTo(d), BONE);
    }
    if (P.horns >= 3) coneAlong(body, head.clone().add(V(hr * 0.75, hr * 0.25, 0)), V(0.6, 1, 0), R * 0.12, R * 0.55, BONE);
  }

  // панцирь: пластины вдоль хребта
  if (P.armor) {
    const n = 2 + P.armor;
    const plate = mix(color, '#4b3d33', 0.65);
    for (let i = 0; i < n; i++) {
      const x = R * 0.6 - (i * R * 1.35) / (n - 1);
      const w = Math.sqrt(Math.max(0.15, 1 - (x / rx) ** 2));
      blob(body, V(x, hb + ry * 0.62 * w + R * 0.05, 0), R * 0.34, R * 0.2, rz * 1.02 * w, i % 2 ? plate : shade(plate, 0.12), 0, 0, -0.35);
    }
  }

  // шипы по спине и бокам
  if (P.spikes) {
    const n = 3 + P.spikes * 3;
    const h = R * (0.28 + 0.12 * P.spikes);
    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      const x = R * (0.65 - 1.45 * u);
      const phi = ((i % 3) - 1) * 0.75;
      const w = Math.sqrt(Math.max(0.1, 1 - (x / rx) ** 2));
      const p = V(x, hb + ry * Math.cos(phi) * w * 0.95, rz * Math.sin(phi) * w * 0.95);
      const n0 = V(x / (rx * rx), (p.y - hb) / (ry * ry), p.z / (rz * rz)).normalize();
      n0.y += 0.3;
      n0.x -= 0.25;
      coneAlong(body, p, n0, R * 0.08, h, BONE);
    }
  }

  // плавники
  if (P.fins) {
    const s = R * (0.55 + 0.25 * P.fins);
    for (const side of [-1, 1]) {
      blob(body, V(-R * 0.05, hb - R * 0.1, side * (rz + s * 0.35)), s * 0.55, R * 0.05, s * 0.45, light, 0, side * 0.5, side * 0.15);
    }
    blob(body, V(-R * 0.15, hb + ry + s * 0.25, 0), s * 0.6, s * 0.45, R * 0.05, light, 0, 0, 0.4);
  }

  // светящиеся пятна (отдельный материал)
  const glow = [];
  if (P.glow) {
    for (let i = 0; i < 6; i++) {
      const x = R * (0.6 - i * 0.28);
      const side = i % 2 ? 1 : -1;
      const w = Math.sqrt(Math.max(0.1, 1 - (x / rx) ** 2));
      glow.push({ geom: G.sphere, matrix: M(x, hb + ry * 0.55 * w, side * rz * 0.7 * w, 0, 0, 0, R * 0.09), color: '#9ffcff' });
    }
  }

  // кислотные мешки
  const acid = [];
  for (let i = 0; i < P.acid; i++) {
    const side = i === 0 ? 0 : i === 1 ? 1 : -1;
    acid.push({ pos: V(-R * (0.45 + 0.12 * Math.abs(side)), hb + ry * 0.75, side * R * 0.35), r: R * (0.2 + 0.04 * P.acid) });
  }

  // ноги
  const legs = [];
  const hipY = hb - R * 0.15;
  for (let i = 0; i < pairs; i++) {
    const x = pairs === 1 ? R * 0.1 : R * 0.55 - (i * R * 1.1) / (pairs - 1);
    for (const side of [-1, 1]) {
      const lg = [];
      const knee = V(0, L * 0.2, side * L * 0.55);
      const foot = V(0, -hipY, side * (R * 0.25 + L * 0.65));
      limb(lg, V(0, 0, side * R * 0.15), knee, R * 0.17, R * 0.13, skin);
      limb(lg, knee, foot, R * 0.13, R * 0.08, dark);
      blob(lg, foot, R * 0.13, R * 0.08, R * 0.13, dark);
      legs.push({ pos: V(x, hipY, side * R * 0.5), geom: mergeParts(lg), side, phase: (i % 2 ? Math.PI : 0) + (side > 0 ? Math.PI : 0) });
    }
  }

  // руки с когтями
  const arms = [];
  if (P.claws) {
    const clawLen = R * (0.28 + 0.12 * P.claws);
    const clawN = P.claws >= 2 ? 3 : 2;
    for (const side of [-1, 1]) {
      const al = [];
      const elbow = V(R * 0.3, -R * 0.2, side * R * 0.3);
      const hand = V(R * 0.7, -R * 0.15, side * R * 0.15);
      limb(al, V(0, 0, 0), elbow, R * 0.15, R * 0.11, skin);
      limb(al, elbow, hand, R * 0.11, R * 0.09, skin);
      blob(al, hand, R * 0.12, R * 0.1, R * 0.12, dark);
      for (let c = 0; c < clawN; c++) {
        const spread = (c - (clawN - 1) / 2) * 0.45;
        coneAlong(al, hand.clone().add(V(R * 0.05, 0, spread * R * 0.15)), V(1, -0.35, spread * 0.6), R * 0.06, clawLen, BONE);
      }
      arms.push({ pos: V(R * 0.75, hb - R * 0.05, side * R * 0.62), geom: mergeParts(al), side });
    }
  }

  // хвост из трёх звеньев
  const tail = [];
  const segLen = R * 0.55;
  for (let i = 0; i < 3; i++) {
    const tl = [];
    const r1 = R * (0.32 - i * 0.09);
    const r2 = R * (0.23 - i * 0.07);
    limb(tl, V(0, 0, 0), V(-segLen, -R * 0.05, 0), r1, Math.max(R * 0.04, r2), skin);
    if (i === 2 && P.fins) blob(tl, V(-segLen - R * 0.2, 0, 0), R * 0.35, R * 0.4, R * 0.05, light);
    if (i === 2 && P.spikes >= 2) coneAlong(tl, V(-segLen, 0, 0), V(-1, 0.2, 0), R * 0.07, R * 0.35, BONE);
    tail.push({ pos: i === 0 ? V(-rx * 0.85, hb + R * 0.05, 0) : V(-segLen, -R * 0.05, 0), geom: mergeParts(tl) });
  }

  const tpl = {
    R, hb, st, g,
    body: mergeParts(body),
    glow: glow.length ? mergeParts(glow) : null,
    jaw, legs, arms, tail, acid,
  };
  templates.set(key, tpl);
  return tpl;
}

const glowMat = new THREE.MeshBasicMaterial({ color: '#b8ffff' });
const acidMat = new THREE.MeshStandardMaterial({ color: '#8dff5a', emissive: '#3fd400', emissiveIntensity: 0.9, transparent: true, opacity: 0.85, roughness: 0.2 });

export class Creature3D {
  constructor(look, color) {
    this.look = look;
    this.color = color;
    const tpl = buildTemplate(look, color);
    this.tpl = tpl;
    this.R = tpl.R;
    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });

    const mk = (geom, parent, pos) => {
      const m = new THREE.Mesh(geom, this.mat);
      m.castShadow = true;
      m.receiveShadow = true;
      if (pos) m.position.copy(pos);
      parent.add(m);
      return m;
    };
    mk(tpl.body, this.root);
    if (tpl.glow) {
      this.root.add(new THREE.Mesh(tpl.glow, glowMat));
      this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7ff7ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      this.halo.scale.setScalar(tpl.R * 6);
      this.halo.position.y = tpl.hb;
      this.root.add(this.halo);
    }
    this.legs = tpl.legs.map((l) => {
      const pivot = new THREE.Group();
      pivot.position.copy(l.pos);
      mk(l.geom, pivot);
      this.root.add(pivot);
      return { pivot, ...l };
    });
    this.arms = tpl.arms.map((a) => {
      const pivot = new THREE.Group();
      pivot.position.copy(a.pos);
      mk(a.geom, pivot);
      this.root.add(pivot);
      return { pivot, ...a };
    });
    this.jaw = null;
    if (tpl.jaw) {
      this.jaw = new THREE.Group();
      this.jaw.position.copy(tpl.jaw.pos);
      mk(tpl.jaw.geom, this.jaw);
      this.root.add(this.jaw);
    }
    let parent = this.root;
    this.tail = tpl.tail.map((t) => {
      const pivot = new THREE.Group();
      pivot.position.copy(t.pos);
      mk(t.geom, pivot);
      parent.add(pivot);
      parent = pivot;
      return pivot;
    });
    this.acid = tpl.acid.map((a) => {
      const m = new THREE.Mesh(G.sphere, acidMat);
      m.position.copy(a.pos);
      m.scale.setScalar(a.r);
      this.root.add(m);
      return { m, r: a.r };
    });

    this.walk = Math.random() * 10;
    this.atk = 0;
    this.flash = 0;
    this.t = Math.random() * 10;
  }

  attack() {
    this.atk = 1;
  }

  hit() {
    this.flash = 1;
  }

  // speed — скорость движения (ед/с), night — 0..1 насколько темно
  update(dt, { speed = 0, charging = false, night = 0 } = {}) {
    this.t += dt;
    const R = this.R;
    const move = Math.min(1, speed / 70);
    this.walk += dt * (2.5 + speed / (R * 0.55));
    const amp = 0.6 * move;
    for (const l of this.legs) {
      const s = Math.sin(this.walk + l.phase);
      l.pivot.rotation.z = s * amp;
      l.pivot.position.y = this.tpl.legs[0].pos.y + Math.max(0, Math.cos(this.walk + l.phase)) * R * 0.1 * move;
    }
    this.root.position.y = Math.abs(Math.sin(this.walk)) * R * 0.06 * move;

    // атака: выпад, челюсть, когти
    if (this.atk > 0) this.atk = Math.max(0, this.atk - dt * 4);
    const a = Math.sin((1 - this.atk) * Math.PI) * (this.atk > 0 ? 1 : 0);
    this.root.position.x = a * R * 0.3;
    if (this.jaw) this.jaw.rotation.z = -a * 0.7 - 0.05;
    for (const arm of this.arms) {
      arm.pivot.rotation.y = arm.side * a * 0.9;
      arm.pivot.rotation.z = a * 0.5 + Math.sin(this.walk + arm.side) * 0.15 * move;
    }
    this.root.rotation.z = charging ? -0.18 : 0;

    // хвост виляет
    this.tail.forEach((p, i) => {
      p.rotation.y = Math.sin(this.t * 4.5 - i * 0.9) * (0.18 + 0.2 * move);
    });
    for (const s of this.acid) s.m.scale.setScalar(s.r * (1 + Math.sin(this.t * 4) * 0.08));
    if (this.halo) this.halo.material.opacity = 0.15 + night * 0.85;

    // вспышка при попадании
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      this.mat.emissive.setRGB(this.flash, this.flash * 0.3, this.flash * 0.3);
    } else if (this.mat.emissive.r) this.mat.emissive.setRGB(0, 0, 0);
  }

  dispose() {
    this.mat.dispose();
    if (this.halo) this.halo.material.dispose();
  }
}

export function creatureRadius(look) {
  return computeStats(decodeGenome(look)).radius;
}
