// Выживший человек: модель Quaternius (CC0) со скелетом, анимации, оружие в руке и мутации на теле.
// Анимации разделены на «ноги» и «корпус»: ноги идут/бегут, а руки в это же время бьют или целятся.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { decodeGenome } from '/shared/creature.js';
import { WEAPONS, ABILITIES } from '/shared/config.js';
import { G, M, mergeParts, glowTexture } from './util.js';
import { weaponGeometry, weaponMaterial } from './weapons3d.js';

const BASE = '/assets/humans/';
export const HUMAN_SCALE = 24; // модель 1,82 м → ~44 единицы мира (стена — 50)
export const HAIR = {
  m: [null, 'hair_buzzed', 'hair_simpleparted'],
  f: ['hair_long', 'hair_buns', 'hair_buzzedfemale'],
};
export const HAIR_COLORS = ['#2b1d14', '#5a3a22', '#a5743f', '#d8c08a', '#8a8a8a'];
const SKIN_TINTS = ['#ffffff', '#ffffff'];
const LOWER = /^(root|pelvis|thigh_|calf_|foot_|ball_)/;
// цвет сферы в руке для заклинаний
export const SPELL_COLORS = { telekinesis: '#9fd8ff', fireball: '#ff8a2a', blink: '#c77dff', drain: '#d01845', hex: '#9dff5a' };
const CLIP_NAMES = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Punch_Jab', 'Punch_Cross', 'Sword_Attack', 'Sword_Idle',
  'Pistol_Idle_Loop', 'Pistol_Shoot', 'Pistol_Aim_Neutral', 'Death01', 'Hit_Chest', 'Swim_Fwd_Loop', 'Swim_Idle_Loop',
  'Spell_Simple_Shoot', 'PickUp_Table',
];

// ---------- загрузка общих ресурсов (один раз) ----------
let assetsPromise = null;
export function loadHumanAssets() {
  if (assetsPromise) return assetsPromise;
  const loader = new GLTFLoader();
  const load = (n) => loader.loadAsync(`${BASE}${n}.glb`);
  const tex = (n) => new THREE.TextureLoader().loadAsync(`${BASE}${n}.webp`).then((t) => {
    t.flipY = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  const hairNames = [...new Set([...HAIR.m, ...HAIR.f, 'hair_beard'].filter(Boolean))];
  assetsPromise = Promise.all([
    load('anims'), load('male'), load('female'), tex('male_light'), tex('female_light'), ...hairNames.map(load),
  ]).then(([anims, male, female, maleLight, femaleLight, ...hairs]) => {
    const clips = {};
    for (const c of anims.animations) {
      if (!CLIP_NAMES.includes(c.name)) continue;
      const lower = c.tracks.filter((t) => LOWER.test(t.name));
      const upper = c.tracks.filter((t) => !LOWER.test(t.name));
      clips[c.name] = {
        full: c,
        lower: new THREE.AnimationClip(`${c.name}_lower`, c.duration, lower),
        upper: new THREE.AnimationClip(`${c.name}_upper`, c.duration, upper),
      };
    }
    const hairMap = {};
    hairNames.forEach((n, i) => { hairMap[n] = hairs[i]; });
    for (const g of [male, female, ...hairs]) {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // у анимированного меша рамка видимости устаревает
      });
    }
    return { clips, male, female, maleLight, femaleLight, hairs: hairMap };
  });
  return assetsPromise;
}
let ASSETS = null;
loadHumanAssets().then((a) => { ASSETS = a; }).catch((e) => console.error('Не удалось загрузить модели людей', e));
export const humanAssetsReady = () => !!ASSETS;

// Внешность: строка вида "m.0.1.2.1" — пол, кожа, причёска, цвет волос, борода
export function parseLook(ap) {
  const [sex, skin, hair, hairColor, beard] = String(ap || 'm.0.1.0.0').split('.');
  return {
    sex: sex === 'f' ? 'f' : 'm',
    skin: Number(skin) === 1 ? 1 : 0,
    hair: Math.max(0, Math.min(2, Number(hair) || 0)),
    hairColor: Math.max(0, Math.min(HAIR_COLORS.length - 1, Number(hairColor) || 0)),
    beard: Number(beard) === 1,
  };
}

// Привязать меши причёски к скелету тела (одинаковые имена костей)
function attachSkinned(bodyRoot, bones, partRoot, color) {
  partRoot.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.bind(new THREE.Skeleton(o.skeleton.bones.map((b) => bones[b.name]), o.skeleton.boneInverses), o.bindMatrix);
    if (color) {
      o.material = o.material.clone();
      o.material.color.set(color);
    }
  });
  const meshes = [];
  partRoot.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) bodyRoot.add(m);
}

// ---------- мутации: детали в пространстве костей (метры) ----------
const BONE = '#e8dcc0';
const mutMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55 });
const acidMat = new THREE.MeshStandardMaterial({ color: '#8dff5a', emissive: '#3fd400', emissiveIntensity: 0.9, transparent: true, opacity: 0.85, roughness: 0.2 });
const glowMat = new THREE.MeshBasicMaterial({ color: '#a8ffff' });
const techMat = new THREE.MeshBasicMaterial({ color: '#5ec8ff' }); // огоньки имплантов
const STEEL = '#8f9aa6';
const DARK = '#3a424b';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function cone(list, base, dir, r, h, color = BONE) {
  const d = dir.clone().normalize();
  const tip = base.clone().addScaledVector(d, h);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d);
  list.push({ geom: G.cone, matrix: new THREE.Matrix4().compose(base.clone().lerp(tip, 0.5), q, V(r, h, r)), color });
}
function blob(list, p, sx, sy, sz, color = BONE, rx = 0, ry = 0, rz = 0) {
  list.push({ geom: G.sphere, matrix: M(p.x, p.y, p.z, rx, ry, rz, sx, sy, sz), color });
}

// Возвращает [{ bone, geom, mat }] — что и к какой кости прикрепить
function buildMutations(P) {
  const out = [];
  const add = (bone, parts, mat = mutMat) => { if (parts.length) out.push({ bone, geom: mergeParts(parts), mat }); };
  // Head: X — влево, Y — вверх, Z — вперёд (метры от основания черепа)
  const head = [];
  if (P.horns) {
    const len = 0.06 + 0.035 * P.horns;
    for (const s of [-1, 1]) {
      const a = V(s * 0.055, 0.19, 0.05);
      const b = a.clone().add(V(s * len * 0.35, len * 0.7, -len * 0.25));
      cone(head, a, b.clone().sub(a), 0.018, a.distanceTo(b) * 1.2);
      cone(head, b, V(s * 0.2, 0.3, 0.9), 0.012, len * 0.8);
    }
  }
  if (P.eyes) {
    const eyes = [[0, 0.155, 0.1]];
    if (P.eyes >= 2) eyes.push([0.035, 0.175, 0.092], [-0.035, 0.175, 0.092]);
    if (P.eyes >= 3) eyes.push([0, 0.2, 0.085]);
    // оптический имплант: тёмные оправы с красными линзами
    for (const [x, y, z] of eyes) {
      blob(head, V(x, y, z), 0.016, 0.016, 0.009, DARK);
      blob(head, V(x, y, z + 0.006), 0.009, 0.009, 0.006, '#ff4a3a');
    }
  }
  if (P.reflex) {
    // нейроускоритель: пластина на затылке с разъёмами
    blob(head, V(0, 0.13, -0.085), 0.05, 0.045, 0.02, DARK);
    for (let i = 0; i < P.reflex; i++) cone(head, V((i - (P.reflex - 1) / 2) * 0.03, 0.15, -0.1), V(0, 0.4, -1), 0.008, 0.04, STEEL);
  }
  add('Head', head);
  if (P.reflex) {
    const led = [];
    for (let i = 0; i < P.reflex; i++) blob(led, V((i - (P.reflex - 1) / 2) * 0.03, 0.115, -0.105), 0.007, 0.007, 0.005, '#5ec8ff');
    add('Head', led, techMat);
  }
  // шея: жабры (плавники)
  if (P.fins) {
    const neck = [];
    for (const s of [-1, 1]) for (let i = 0; i < 2 + P.fins; i++) blob(neck, V(s * 0.06, 0.02 + i * 0.022, -0.01), 0.004, 0.008, 0.025, '#b84a4a');
    add('neck_01', neck);
  }
  // spine_03 (грудь/спина): X — влево, Y — вверх, Z — вперёд; спина — минус Z
  const chest = [];
  if (P.armor) {
    // бронепластины — сталь: наплечники и сегменты вдоль спины
    for (const s of [-1, 1]) blob(chest, V(s * 0.17, 0.2, -0.01), 0.07 + 0.012 * P.armor, 0.035, 0.08, s > 0 ? STEEL : '#7c8792', 0, 0, s * 0.35);
    for (let i = 0; i < 1 + P.armor; i++) blob(chest, V(0, 0.18 - i * 0.07, -0.13), 0.1, 0.035, 0.03, i % 2 ? STEEL : '#7c8792');
  }
  if (P.jets) {
    // реактивные ускорители: сопла на спине
    for (const s of [-1, 1]) {
      blob(chest, V(s * 0.085, 0.1, -0.15), 0.04, 0.07, 0.035, DARK);
      cone(chest, V(s * 0.085, 0.02, -0.15), V(0, 1, 0), 0.03 + 0.005 * P.jets, 0.07, STEEL);
    }
  }
  if (P.battery) blob(chest, V(0, 0.12, 0.115), 0.055, 0.055, 0.03, DARK); // гнездо энергоядра на груди
  if (P.regen) {
    // живая плоть: багровые наросты на плечах и боках
    const spots = [[0.13, 0.24, 0.03], [-0.14, 0.22, -0.04], [0.15, 0.08, 0.02], [-0.13, 0.05, 0.05], [0.05, 0.26, -0.08], [-0.06, 0.02, -0.11]];
    for (const [x, y, z] of spots.slice(0, P.regen * 2)) blob(chest, V(x, y, z), 0.035, 0.03, 0.03, '#a83a3a');
  }
  if (P.spikes) {
    const n = 2 + P.spikes * 2;
    for (let i = 0; i < n; i++) cone(chest, V(0, 0.22 - i * 0.05, -0.12), V(0, 0.3, -1), 0.012, 0.05 + 0.015 * P.spikes);
    for (const s of [-1, 1]) cone(chest, V(s * 0.17, 0.23, -0.02), V(s * 0.4, 1, -0.2), 0.014, 0.06 + 0.02 * P.spikes);
  }
  add('spine_03', chest);
  if (P.battery || P.jets) {
    const lights = [];
    if (P.battery) blob(lights, V(0, 0.12, 0.135), 0.022 + 0.006 * P.battery, 0.022 + 0.006 * P.battery, 0.012, '#5ec8ff');
    if (P.jets) for (const s of [-1, 1]) blob(lights, V(s * 0.085, 0.015, -0.15), 0.02, 0.012, 0.02, '#5ec8ff');
    add('spine_03', lights, techMat);
  }
  if (P.acid) {
    const sacs = [];
    for (let i = 0; i < P.acid; i++) blob(sacs, V((i - (P.acid - 1) / 2) * 0.07, 0.24, -0.1), 0.035 + 0.006 * P.acid, 0.035, 0.03, '#8dff5a');
    add('spine_03', sacs, acidMat);
  }
  if (P.glow) {
    const spots = [];
    for (const [x, y, z] of [[0.06, 0.1, 0.12], [-0.07, 0.04, 0.12], [0.1, 0.18, -0.1], [-0.05, 0.12, -0.12], [0, 0.0, 0.13]]) blob(spots, V(x, y, z), 0.012, 0.012, 0.006, '#a8ffff');
    add('spine_03', spots, glowMat);
  }
  // кисти: пальцы вдоль +Y, когти за кончиками пальцев
  if (P.claws) {
    for (const side of ['l', 'r']) {
      const hand = [];
      const n = P.claws >= 2 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * 0.022;
        cone(hand, V(0, 0.16, z), V(0, 1, 0), 0.007, 0.04 + 0.018 * P.claws);
      }
      add(`hand_${side}`, hand);
    }
  }
  // гидравлика рук: стальные наручи с поршнем; разрядник — катушки на кистях
  if (P.arm || P.shock) {
    for (const side of ['l', 'r']) {
      if (P.arm) {
        const arm = [];
        blob(arm, V(0, 0.12, 0), 0.042 + 0.004 * P.arm, 0.085, 0.042 + 0.004 * P.arm, STEEL);
        blob(arm, V(0, 0.12, 0.04), 0.012, 0.11, 0.012, DARK);
        add(`lowerarm_${side}`, arm);
      }
      if (P.shock) {
        const coil = [];
        for (let i = 0; i < P.shock; i++) blob(coil, V(0, 0.05 + i * 0.022, 0), 0.04, 0.008, 0.04, DARK);
        add(`hand_${side}`, coil);
        const spark = [];
        blob(spark, V(0, 0.09, 0.035), 0.012, 0.012, 0.012, '#5ec8ff');
        add(`hand_${side}`, spark, techMat);
      }
    }
  }
  // сервоприводы ног: стальные голени
  if (P.legs) {
    for (const side of ['l', 'r']) {
      const leg = [];
      blob(leg, V(0, 0.2, 0), 0.052 + 0.004 * P.legs, 0.13, 0.052 + 0.004 * P.legs, STEEL);
      blob(leg, V(0, 0.2, -0.05), 0.014, 0.15, 0.014, DARK);
      add(`calf_${side}`, leg);
    }
  }
  // предплечья: плавники вдоль тыльной стороны руки
  if (P.fins) {
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const fin = [];
      blob(fin, V(s * 0.05, 0.12, 0), 0.03 + 0.012 * P.fins, 0.1, 0.004, '#4fb0b0');
      add(`lowerarm_${side}`, fin);
    }
  }
  return out;
}

// ---------- сам человек ----------
export class Human3D {
  // ap — строка внешности, look — закодированный геном (мутации), color — метка игрока
  constructor(ap, look, color) {
    this.ap = ap;
    this.look = look;
    this.color = color;
    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.genome = decodeGenome(look);
    const P = this.genome.parts;
    this.size = 1 + P.size * 0.1;
    this.R = 16 + P.size * 5;
    this.tpl = { hb: 26 * this.size }; // высота пояса — для плавания и камеры
    // Клипы плавания сделаны от поверхности воды: в них тело лежит у нуля модели, а не стоит на нём.
    // Поэтому на глубине модель держим у самой воды (чуть выше — чтобы спина и голова были над волнами).
    this.swimY = 3.5 * this.size;
    this.labelHeight = 47 * this.size;
    this.ready = false;
    this.pending = { weapon: null };
    this.speed = 0;
    this.t = Math.random() * 10;
    this.flash = 0;
    this.hi = null; // { r, g, b } — свечение цели под прицелом
    if (ASSETS) this.build(ASSETS);
    else loadHumanAssets().then((a) => this.build(a));
  }

  build(A) {
    if (this.disposed) return;
    const L = parseLook(this.ap);
    const src = L.sex === 'f' ? A.female : A.male;
    const model = SkeletonUtils.clone(src.scene);
    model.rotation.y = Math.PI / 2; // модель смотрит в +Z, а в игре «вперёд» — это +X
    model.scale.setScalar(HUMAN_SCALE * this.size);
    this.root.add(model);
    this.model = model;
    const bones = {};
    model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    this.bones = bones;
    // кожа: светлый вариант, оттенок радиорезистентности
    this.skinMats = [];
    model.traverse((o) => {
      if (!o.isMesh || !/Superhero_/.test(o.material.name)) return;
      o.material = o.material.clone();
      if (L.skin === 1) o.material.map = L.sex === 'f' ? A.femaleLight : A.maleLight;
      o.material.color.set(SKIN_TINTS[L.skin]);
      if (this.genome.parts.radres) o.material.color.lerp(new THREE.Color('#b8d8a0'), 0.1 * this.genome.parts.radres);
      if (this.genome.parts.glow) o.material.emissive = new THREE.Color('#031414');
      this.skinMats.push(o.material);
    });
    // причёска и борода
    const hairName = HAIR[L.sex][L.hair];
    if (hairName && A.hairs[hairName]) attachSkinned(model, bones, SkeletonUtils.clone(A.hairs[hairName].scene), HAIR_COLORS[L.hairColor]);
    if (L.sex === 'm' && L.beard && A.hairs.hair_beard) attachSkinned(model, bones, SkeletonUtils.clone(A.hairs.hair_beard.scene), HAIR_COLORS[L.hairColor]);
    // мутации на костях (в метрах — кость уже несёт масштаб модели)
    this.acidMeshes = [];
    for (const m of buildMutations(this.genome.parts)) {
      const bone = bones[m.bone];
      if (!bone) continue;
      const mesh = new THREE.Mesh(m.geom, m.mat);
      mesh.castShadow = m.mat === mutMat;
      bone.add(mesh);
      if (m.mat === acidMat) this.acidMeshes.push(mesh);
    }
    if (this.genome.parts.glow) {
      this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7ff7ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      this.halo.scale.setScalar(60 * this.size);
      this.halo.position.y = 28 * this.size;
      this.root.add(this.halo);
    }
    // держатель оружия в правой кисти
    this.hand = new THREE.Group();
    this.hand.scale.setScalar(1 / (HUMAN_SCALE * this.size));
    (bones.hand_r || model).add(this.hand);
    // анимации
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = A.clips;
    this.actions = {};
    this.lower = null;
    this.upperBase = null;
    this.upperOneShot = null;
    this.dead = false;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.upperOneShot) {
        this.upperOneShot = null;
        if (this.upperBase) e.action.crossFadeTo(this.upperBase.reset().play(), 0.18, false);
      }
    });
    this.ready = true;
    this.setLower('Idle_Loop');
    this.setUpper(this.stanceClip(null));
    this.setWeapon(this.pending.weapon);
  }

  action(name, part) {
    const key = `${name}:${part}`;
    if (!this.actions[key]) {
      const c = this.clips[name]?.[part];
      if (!c) return null;
      this.actions[key] = this.mixer.clipAction(c);
    }
    return this.actions[key];
  }

  setLower(name, timeScale = 1) {
    const a = this.action(name, 'lower');
    if (!a) return;
    a.timeScale = timeScale;
    if (this.lower === a) return;
    a.reset().play();
    if (this.lower) this.lower.crossFadeTo(a, 0.2, false);
    this.lower = a;
  }

  setUpper(name, timeScale = 1) {
    const a = this.action(name, 'upper');
    if (!a) return;
    a.timeScale = timeScale;
    if (this.upperBase === a) return;
    const prev = this.upperBase;
    this.upperBase = a;
    if (this.upperOneShot) return; // вернёмся к новой стойке после удара
    a.reset().play();
    if (prev) prev.crossFadeTo(a, 0.2, false);
  }

  // стойка корпуса в зависимости от оружия
  stanceClip(weapon) {
    const w = weapon ? WEAPONS[weapon] : null;
    if (!w) return null;
    if (w.type === 'ranged') return 'Pistol_Idle_Loop';
    if (w.type === 'melee') return 'Sword_Idle';
    return null;
  }

  setWeapon(kind) {
    if (!this.ready) {
      this.pending.weapon = kind;
      return;
    }
    if (kind === this.weaponKind) return;
    this.weaponKind = kind;
    if (this.weaponMesh) {
      this.hand.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    if (this.orb) {
      this.hand.remove(this.orb);
      this.orb = null;
    }
    // заклинание «в руке» — светящаяся сфера над ладонью
    if (kind && ABILITIES[kind]) {
      const col = SPELL_COLORS[kind] || '#c77dff';
      this.orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.orb.scale.setScalar(16);
      this.orb.position.set(-1, 7, 2);
      this.hand.add(this.orb);
      this.setUpper(this.upperLocomotion || 'Idle_Loop');
      return;
    }
    const geo = kind ? weaponGeometry(kind) : null;
    if (geo) {
      const m = new THREE.Mesh(geo, weaponMaterial);
      m.castShadow = true;
      const w = WEAPONS[kind];
      // кисть: пальцы вдоль +Y, большой палец ~ +Z, тыльная сторона +X
      if (w.type === 'ranged' && kind !== 'bow' && kind !== 'sling') {
        // ствол вдоль пальцев, рукоять в кулаке
        m.rotation.set(0, Math.PI / 2, Math.PI / 2);
        m.position.set(-1, 2.2, 0.2);
        m.scale.setScalar(0.6); // модели огнестрела рассчитаны на существ — для человека крупноваты
      } else if (kind === 'bow') {
        m.rotation.set(0, -Math.PI / 2, 0);
        m.position.set(-0.6, 2.2, 0);
      } else {
        // рукоять поперёк кулака, лезвие/навершие со стороны большого пальца
        m.rotation.set(0, -Math.PI / 2, 0);
        m.position.set(-0.8, 2.2, -2);
      }
      this.hand.add(m);
      this.weaponMesh = m;
    }
    this.setUpper(this.stanceClip(kind) || this.upperLocomotion || 'Idle_Loop');
  }

  attack() {
    if (!this.ready || this.dead) return;
    const w = this.weaponKind ? WEAPONS[this.weaponKind] : null;
    let name;
    if (this.weaponKind && ABILITIES[this.weaponKind]) name = 'Spell_Simple_Shoot';
    else if (!w) name = Math.random() < 0.5 ? 'Punch_Jab' : 'Punch_Cross';
    else if (w.type === 'melee') name = 'Sword_Attack';
    else if (w.type === 'ranged') name = 'Pistol_Shoot';
    else name = 'Spell_Simple_Shoot';
    this.playOneShot(name, w && w.type === 'melee' ? 1.6 : 1.4);
  }

  spit() {
    this.playOneShot('Spell_Simple_Shoot', 1.6);
  }

  playOneShot(name, timeScale = 1) {
    const a = this.action(name, 'upper');
    if (!a) return;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.timeScale = timeScale;
    const from = this.upperOneShot || this.upperBase;
    a.reset().play();
    if (from && from !== a) from.crossFadeTo(a, 0.06, false);
    this.upperOneShot = a;
  }

  hit() {
    this.flash = 1;
  }

  // speed — скорость (ед/с); swim — в глубокой воде; dead — лежит
  update(dt, { speed = 0, charging = false, night = 0, swim = false, dead = false } = {}) {
    this.t += dt;
    if (!this.ready) return;
    if (dead && !this.dead) {
      this.dead = true;
      const a = this.action('Death01', 'full');
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      this.mixer.stopAllAction();
      a.reset().play();
    }
    if (!this.dead) {
      // походка по скорости; анимации без смещения, поэтому подгоняем их темп
      let lower;
      let ts = 1;
      if (swim) {
        lower = speed > 15 ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop';
      } else if (speed < 10) lower = 'Idle_Loop';
      else if (speed < 75) {
        lower = 'Walk_Loop';
        ts = Math.max(0.7, speed / 45);
      } else if (speed < 175 && !charging) {
        lower = 'Jog_Fwd_Loop';
        ts = Math.max(0.8, speed / 120);
      } else {
        lower = 'Sprint_Loop';
        ts = Math.max(0.9, speed / 210);
      }
      this.setLower(lower, Math.min(1.8, ts));
      this.upperLocomotion = lower;
      this.setUpper(swim ? lower : this.stanceClip(this.weaponKind) || lower, swim || !this.stanceClip(this.weaponKind) ? Math.min(1.8, ts) : 1);
    }
    this.mixer.update(dt);
    for (const m of this.acidMeshes) m.scale.setScalar(1 + Math.sin(this.t * 4) * 0.08);
    if (this.orb) this.orb.material.opacity = 0.75 + Math.sin(this.t * 9) * 0.25;
    if (this.halo) this.halo.material.opacity = 0.15 + night * 0.85;
    // вспышка при попадании
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    const hi = this.hi; // свечение цели под прицелом (задаёт TargetMark)
    for (const mat of this.skinMats) {
      if (this.flash > 0) mat.emissive.setRGB(this.flash * 0.8, this.flash * 0.15, this.flash * 0.15);
      else if (this.genome.parts.glow) mat.emissive.setRGB(0, 0.05 + Math.sin(this.t * 2) * 0.02, 0.06);
      else mat.emissive.setRGB(0, 0, 0);
      if (hi) {
        mat.emissive.r += hi.r;
        mat.emissive.g += hi.g;
        mat.emissive.b += hi.b;
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.mixer?.stopAllAction();
    for (const m of this.skinMats || []) m.dispose();
  }
}
