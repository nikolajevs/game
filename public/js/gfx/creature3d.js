// Процедурное 3D-существо, собранное из частей генома (ноги, когти, панцирь, рога...).
// Локальные оси: +X — вперёд, Y — вверх, Z — вбок.
import * as THREE from 'three';
import { computeStats, decodeGenome } from '/shared/creature.js';
import { G, M, between, shade, mix, glowTexture } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BONE = '#efe6cf';
const templates = new Map();
const creatureSphere = new THREE.SphereGeometry(1, 24, 16);
const creatureCone = new THREE.ConeGeometry(1, 1, 12);
const creatureTapers = new Map();
const eyeForward = new THREE.Vector3(0, 0, 1);
const eyeQuaternion = new THREE.Quaternion();
const eyePosition = new THREE.Vector3();
const eyeScale = new THREE.Vector3();
const eyeMatrix = new THREE.Matrix4();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth01 = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const contactShadowTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.48)');
  gradient.addColorStop(0.42, 'rgba(0,0,0,0.28)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
})();
const contactShadowGeometry = new THREE.PlaneGeometry(1, 1);
contactShadowGeometry.rotateX(-Math.PI / 2);
const contactShadowMaterial = new THREE.MeshBasicMaterial({
  map: contactShadowTexture,
  color: '#14170f',
  transparent: true,
  opacity: 0.68,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});

function creatureTaper(ratio) {
  const k = Math.round(ratio * 20) / 20;
  if (!creatureTapers.has(k)) creatureTapers.set(k, new THREE.CylinderGeometry(k, 1, 1, 12));
  return creatureTapers.get(k);
}

// Character meshes keep smooth source normals; environment meshes remain flat-shaded.
function mergeCreatureParts(parts) {
  const prepared = [];
  let total = 0;
  for (const p of parts) {
    const g = p.geom.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    if (nonIndexed !== g) g.dispose();
    nonIndexed.applyMatrix4(p.matrix);
    prepared.push([nonIndexed, new THREE.Color(p.color)]);
    total += nonIndexed.getAttribute('position').count;
  }

  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  let offset = 0;
  for (const [g, color] of prepared) {
    const count = g.getAttribute('position').count;
    positions.set(g.getAttribute('position').array, offset * 3);
    normals.set(g.getAttribute('normal').array, offset * 3);
    for (let i = 0; i < count; i++) {
      colors[(offset + i) * 3] = color.r;
      colors[(offset + i) * 3 + 1] = color.g;
      colors[(offset + i) * 3 + 2] = color.b;
    }
    offset += count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.computeBoundingSphere();
  return out;
}

// Конус от основания base в направлении dir
function coneAlong(list, base, dir, r, h, color) {
  const tip = base.clone().addScaledVector(dir.clone().normalize(), h);
  list.push({ geom: creatureCone, matrix: between(base, tip, r), color });
}

function limb(list, a, b, r1, r2, color) {
  list.push({ geom: creatureTaper(r2 / r1), matrix: between(a, b, r1), color });
}

function blob(list, p, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
  list.push({ geom: creatureSphere, matrix: M(p.x, p.y, p.z, rx, ry, rz, sx, sy, sz), color });
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
  const eyes = [];
  // туловище и брюхо
  blob(body, V(0, hb, 0), rx, ry, rz, skin);
  blob(body, V(R * 0.05, hb - R * 0.32, 0), R * 1.0, R * 0.48, R * 0.74, belly);
  // пятна на спине
  for (let i = 0; i < 4; i++) {
    const x = R * (0.55 - i * 0.38);
    blob(body, V(x, hb + ry * 0.82, (i % 2 ? 1 : -1) * R * 0.28), R * 0.2, R * 0.08, R * 0.16, dark);
  }
  // Контрастная спинная полоса и небольшие боковые пластины делают силуэт читаемее.
  blob(body, V(-R * 0.08, hb + ry * 0.91, 0), R * 0.72, R * 0.055, R * 0.2, light);
  for (let i = 0; i < 3; i++) {
    const x = R * (0.48 - i * 0.44);
    for (const side of [-1, 1]) {
      blob(body, V(x, hb + R * 0.05, side * rz * 0.82), R * 0.16, R * 0.11, R * 0.045, light, 0, 0, -0.18);
    }
  }
  // шея и голова
  limb(body, V(R * 0.55, hb + R * 0.05, 0), head, R * 0.5, hr * 0.75, skin);
  blob(body, head, hr, hr * 0.9, hr * 0.92, skin);

  // глаза
  const eyeCount = [2, 2, 3, 4][P.eyes];
  const er = R * (0.15 + 0.045 * P.eyes);
  const eyeParts = [];
  blob(eyeParts, V(0, 0, 0), er, er, er, '#ffffff');
  blob(eyeParts, V(er * 0.12, 0, er * 0.48), er * 0.61, er * 0.61, er * 0.61, '#36b9c7');
  blob(eyeParts, V(er * 0.12, 0, er * 0.48 + er * 0.61 * 0.52), er * 0.34, er * 0.34, er * 0.34, '#11151a');
  blob(eyeParts, V(-er * 0.12, er * 0.16, er * 0.48 + er * 0.61 * 0.52 + er * 0.34 * 0.28), er * 0.13, er * 0.13, er * 0.13, '#ffffff');
  const eyeDirs = [];
  if (eyeCount >= 2) eyeDirs.push(V(0.7, 0.5, 0.5), V(0.7, 0.5, -0.5));
  if (eyeCount === 3) eyeDirs.push(V(0.55, 0.85, 0));
  if (eyeCount === 4) eyeDirs.push(V(0.35, 0.8, 0.5), V(0.35, 0.8, -0.5));
  for (const d of eyeDirs) {
    d.normalize();
    const p = head.clone().addScaledVector(d, hr * 0.88);
    eyes.push({ pos: p, dir: d.clone() });
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
    jaw = { pos: head.clone().add(V(hr * 0.35, -hr * 0.4, 0)), geom: mergeCreatureParts(jl) };
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
    const plate = mix(color, '#263b4b', 0.34);
    for (let i = 0; i < n; i++) {
      const x = R * 0.6 - (i * R * 1.35) / (n - 1);
      const w = Math.sqrt(Math.max(0.15, 1 - (x / rx) ** 2));
      blob(body, V(x, hb + ry * 0.82 * w + R * 0.015, 0), R * 0.31, R * 0.12, rz * 0.74 * w, i % 2 ? plate : shade(plate, 0.09), 0, 0, -0.28);
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
      const hip = V(0, 0, side * R * 0.15);
      limb(lg, hip, knee, R * 0.17, R * 0.13, skin);
      blob(lg, hip, R * 0.19, R * 0.19, R * 0.19, skin);
      blob(lg, knee, R * 0.145, R * 0.145, R * 0.145, skin);
      limb(lg, knee, foot, R * 0.13, R * 0.08, dark);
      blob(lg, foot, R * 0.13, R * 0.08, R * 0.13, dark);
      if (P.claws) {
        const toes = P.claws >= 2 ? 3 : 2;
        for (let toe = 0; toe < toes; toe++) {
          const spread = (toe - (toes - 1) / 2) * 0.38;
          const base = foot.clone().add(V(R * 0.06, -R * 0.015, spread * R * 0.22));
          coneAlong(lg, base, V(1, -0.28, spread * 0.35), R * 0.035, R * (0.16 + 0.04 * P.claws), BONE);
        }
      }
      legs.push({ pos: V(x, hipY, side * R * 0.5), geom: mergeCreatureParts(lg), side, phase: (i % 2 ? Math.PI : 0) + (side > 0 ? Math.PI : 0) });
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
      blob(al, elbow, R * 0.125, R * 0.125, R * 0.125, skin);
      limb(al, elbow, hand, R * 0.11, R * 0.09, skin);
      blob(al, hand, R * 0.12, R * 0.1, R * 0.12, dark);
      for (let c = 0; c < clawN; c++) {
        const spread = (c - (clawN - 1) / 2) * 0.45;
        coneAlong(al, hand.clone().add(V(R * 0.05, 0, spread * R * 0.15)), V(1, -0.35, spread * 0.6), R * 0.06, clawLen, BONE);
      }
      arms.push({ pos: V(R * 0.75, hb - R * 0.05, side * R * 0.62), geom: mergeCreatureParts(al), side });
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
    tail.push({ pos: i === 0 ? V(-rx * 0.85, hb + R * 0.05, 0) : V(-segLen, -R * 0.05, 0), geom: mergeCreatureParts(tl) });
  }

  const tpl = {
    R, hb, st, g,
    body: mergeCreatureParts(body),
    eyeGeometry: mergeCreatureParts(eyeParts),
    eyes,
    glow: glow.length ? mergeCreatureParts(glow) : null,
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
    this.contactShadow = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
    this.contactShadow.position.y = 0.65;
    this.contactShadow.scale.set(tpl.R * 4.2, tpl.R * 3.4, 1);
    this.contactShadow.renderOrder = 2;
    this.group.add(this.contactShadow);
    this.group.add(this.root);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false, roughness: 0.55, metalness: 0.02 });

    const mk = (geom, parent, pos, castsShadow = false) => {
      const m = new THREE.Mesh(geom, this.mat);
      m.castShadow = castsShadow;
      m.receiveShadow = true;
      if (pos) m.position.copy(pos);
      parent.add(m);
      return m;
    };
    mk(tpl.body, this.root, null, true);
    this.eyes = tpl.eyes;
    this.eyeMesh = new THREE.InstancedMesh(tpl.eyeGeometry, this.mat, tpl.eyes.length);
    this.eyeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.eyeMesh.castShadow = false;
    this.eyeMesh.receiveShadow = false;
    this.root.add(this.eyeMesh);
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
      const m = new THREE.Mesh(creatureSphere, acidMat);
      m.position.copy(a.pos);
      m.scale.setScalar(a.r);
      this.root.add(m);
      return { m, r: a.r };
    });

    this.walk = Math.random() * 10;
    this.attackTime = -1;
    this.flash = 0;
    this.t = Math.random() * 10;
    this.blinkClock = 0;
    this.blinkAt = 2 + Math.random() * 3;
    this.blinkAge = -1;
    this.eyeBlink = 1;
    this.updateEyes(1);
  }

  attack(fromWindup = false) {
    this.attackTime = fromWindup ? 0.25 : 0;
  }

  hit() {
    this.flash = 1;
  }

  updateEyes(blink) {
    this.eyes.forEach((eye, i) => {
      eyeQuaternion.setFromUnitVectors(eyeForward, eye.dir);
      eyePosition.copy(eye.pos);
      eyeScale.set(1, blink, 1);
      eyeMatrix.compose(eyePosition, eyeQuaternion, eyeScale);
      this.eyeMesh.setMatrixAt(i, eyeMatrix);
    });
    this.eyeMesh.instanceMatrix.needsUpdate = true;
  }

  // speed — скорость движения (ед/с), night — 0..1 насколько темно
  update(dt, { speed = 0, charging = false, warning = false, night = 0 } = {}) {
    this.t += dt;
    const R = this.R;
    const move = Math.min(1, speed / 70);
    this.blinkClock += dt;
    if (this.blinkAge < 0 && this.blinkClock >= this.blinkAt) {
      this.blinkClock = 0;
      this.blinkAge = 0;
      this.blinkAt = 2.5 + Math.random() * 4;
    }
    let blink = 1;
    if (this.blinkAge >= 0) {
      this.blinkAge += dt;
      if (this.blinkAge < 0.17) blink = 1 - 0.92 * Math.sin((this.blinkAge / 0.17) * Math.PI);
      else this.blinkAge = -1;
    }
    if (blink !== this.eyeBlink) {
      this.eyeBlink = blink;
      this.updateEyes(blink);
    }
    this.walk += dt * (2.5 + speed / (R * 0.55));
    if (this.attackTime >= 0) {
      this.attackTime += dt;
      if (this.attackTime > 0.58) this.attackTime = -1;
    }
    const attackTime = this.attackTime;
    const windup = attackTime >= 0 && attackTime < 0.12
      ? smooth01(attackTime / 0.12)
      : attackTime >= 0.12 && attackTime < 0.24
        ? 1 - smooth01((attackTime - 0.12) / 0.12) : 0;
    const strike = attackTime >= 0.12 && attackTime <= 0.38
      ? Math.sin(((attackTime - 0.12) / 0.26) * Math.PI) : 0;
    const gaitBob = Math.abs(Math.sin(this.walk * 2)) * R * 0.025 * move;
    const idleBreath = Math.sin(this.t * 2.1) * R * 0.012 * (1 - move);
    this.root.position.x = (-windup * 0.1 + strike * 0.3) * R;
    this.root.position.y = gaitBob + idleBreath - windup * R * 0.025 + strike * R * 0.045;
    this.root.rotation.z = charging
      ? -0.27 - Math.sin(this.t * 16) * 0.025
      : warning ? 0.13 + Math.sin(this.t * 24) * 0.025
        : -windup * 0.12 - strike * 0.2;
    const hitSquash = this.flash * 0.035;
    this.root.scale.set(1 + hitSquash, 1 + Math.sin(this.t * 1.8) * 0.008 - hitSquash, 1 + hitSquash);
    for (const l of this.legs) {
      const s = Math.sin(this.walk + l.phase);
      l.pivot.rotation.z = s * 0.58 * move + Math.cos(l.phase) * strike * 0.42;
      l.pivot.position.y = this.tpl.legs[0].pos.y + Math.max(0, Math.cos(this.walk + l.phase)) * R * 0.1 * move;
    }
    // Замах, резкий выпад и короткое восстановление читаются отдельно.
    if (this.jaw) this.jaw.rotation.z = -0.05 - windup * 0.18 - strike * 1.05;
    for (const arm of this.arms) {
      arm.pivot.rotation.y = arm.side * (windup * 0.22 + strike * 1.25);
      arm.pivot.rotation.z = windup * 0.42 + strike * 0.68 + Math.sin(this.walk + arm.side) * 0.15 * move;
    }

    // Хвост балансирует шаг и резко уходит в противоход во время выпада.
    this.tail.forEach((p, i) => {
      p.rotation.y = Math.sin(this.t * 4.5 - i * 0.9) * (0.18 + 0.2 * move) + strike * (i === 0 ? -0.32 : 0.12);
    });
    for (const s of this.acid) s.m.scale.setScalar(s.r * (1 + Math.sin(this.t * 4) * 0.08));
    if (this.halo) this.halo.material.opacity = 0.15 + night * 0.85;

    // вспышка при попадании
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    const warningGlow = warning ? 0.25 + (0.5 + 0.5 * Math.sin(this.t * 26)) * 0.3 : 0;
    const redGlow = Math.max(this.flash, warningGlow);
    const greenGlow = this.flash * 0.3 + warningGlow * 0.42;
    const blueGlow = this.flash * 0.3;
    if (redGlow || greenGlow || blueGlow) this.mat.emissive.setRGB(redGlow, greenGlow, blueGlow);
    else if (this.mat.emissive.r || this.mat.emissive.g || this.mat.emissive.b) this.mat.emissive.setRGB(0, 0, 0);
  }

  dispose() {
    this.mat.dispose();
    if (this.halo) this.halo.material.dispose();
  }
}

export function creatureRadius(look) {
  return computeStats(decodeGenome(look)).radius;
}
