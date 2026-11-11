// Чудовища острова: готовые анимированные модели со скелетом (см. public/assets/monsters/LICENSE.txt).
// Духи и мутанты леса — органика, машины мёртвого города — роботы. Интерфейс тот же, что у Human3D.
// Локальные оси группы: +X — вперёд, Y — вверх.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { NPCS } from '/shared/config.js';
import { glowTexture } from './util.js';

const BASE = '/assets/monsters/';
// h — рост в единицах мира (человек — 44), yaw — доворот модели, чтобы она смотрела вдоль +X,
// clips — какие клипы модели играть; impact — доля клипа атаки, на которую приходится сам удар.
// Чего в модели нет (смерть утробника, шаг дрона), доигрывается наклоном и смещением всей модели.
const MODELS = {
  stag: { h: 60, clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack_Headbutt', hit: 'Idle_HitReact1', death: 'Death' }, runAt: 80 },
  crooked: { h: 56, alphaTest: 0.5, clips: { walk: 'crooked_run', run: 'crooked_run', attack: 'crooked_attack', death: 'dead_by_headshot' }, runAt: 60, stride: 150, impact: 0.5, tint: '#c9b0a0' },
  claw: { h: 62, alphaTest: 0.5, clips: { walk: 'claw_run', run: 'claw_run', attack: 'claw_attack', death: 'claw_deadF' }, runAt: 60, stride: 160, impact: 0.5, tint: '#d0b8b0' },
  glutton: { h: 84, clips: { walk: 'glutton_Walk', run: 'glutton_Walk' }, runAt: 999, stride: 70 },
  wraith: {
    h: 54, hover: 12, clips: { idle: 'Flying_Idle', walk: 'Flying_Idle', run: 'Fast_Flying', attack: 'Punch', shoot: 'Headbutt', hit: 'HitReact', death: 'Death' },
    runAt: 60, impact: 0.4, ghost: true,
  },
  // проводник в мир духов: тот же призрак, но золотой и ярче — его видно только в трипе испытания
  guide: {
    file: 'wraith', h: 62, hover: 16, clips: { idle: 'Flying_Idle', walk: 'Flying_Idle', run: 'Fast_Flying', hit: 'HitReact', death: 'Death' },
    runAt: 60, ghost: true, ghostTint: '#ffe9a0', glow: '#ffd76a',
  },
  // зима: снежный волк и снежный зверь (та же модель, что у утробника, но белая)
  wolf: { h: 30, clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', hit: 'Idle_HitReact1', death: 'Death' }, runAt: 80, impact: 0.4, tint: '#f4f8ff' },
  frostbeast: { file: 'glutton', h: 80, clips: { walk: 'glutton_Walk', run: 'glutton_Walk' }, runAt: 999, stride: 70, recolor: '#dfeaf5' },
  spider: { h: 30, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', hit: 'Hit', death: 'TurnOff' }, runAt: 90, stride: 120, impact: 0.45, eye: 0.6, tint: '#a4a4ac' },
  drone: { h: 26, hover: 36, clips: { idle: 'Idle', walk: 'Idle', run: 'Idle', shoot: 'Attack', hit: 'Hit' }, runAt: 999, impact: 0.3, eye: 0.5, lean: 0.35, tint: '#a4a4ac' },
  reaper: { h: 66, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', hit: 'Hit', death: 'TurnOff' }, runAt: 70, stride: 90, impact: 0.45, eye: 0.7, tint: '#a4a4ac' },
  mech: { h: 96, clips: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Punch', shoot: 'Shoot', hit: 'HitRecieve_1', death: 'Death' }, runAt: 70, stride: 80, impact: 0.45, eye: 0.84, tint: '#b8b0a8' },
};

const _box = new THREE.Box3();
const _b = new THREE.Box3();
const _size = new THREE.Vector3();

// Клип без «ухода» модели с места: корневые кости в игре двигает сервер
function inPlace(clip, rootNames) {
  for (const t of clip.tracks) {
    const [node, prop] = t.name.split('.');
    if (prop !== 'position' || !rootNames.has(node)) continue;
    const v = t.values;
    for (let i = 3; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 2] = v[2];
    }
  }
  return clip;
}

// ---------- загрузка (один раз на вид) ----------
const assets = new Map(); // вид -> { scene, clips, scale, offset } (после загрузки)
const pending = new Map();
let loader = null;
function loadModel(kind) {
  if (pending.has(kind)) return pending.get(kind);
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  const def = MODELS[kind];
  const p = loader.loadAsync(`${BASE}${def.file || kind}.glb`).then((gltf) => {
    const scene = gltf.scene;
    const roots = new Set();
    scene.traverse((o) => {
      if (o.isBone && !(o.parent && o.parent.isBone)) roots.add(o.name);
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // у анимированного меша рамка видимости устаревает
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (def.alphaTest) {
          m.alphaTest = def.alphaTest;
          m.transparent = false;
        }
        m.side = def.alphaTest ? THREE.DoubleSide : THREE.FrontSide;
        m.metalness = Math.min(m.metalness, 0.5); // без карты окружения металл выглядит чёрным
        if (def.tint) m.color.multiply(new THREE.Color(def.tint));
        if (def.recolor) {
          // перекраска поверх текстуры: модель становится светлой, фактура остаётся
          m.color.set(def.recolor).multiplyScalar(1.5);
        }
      }
    });
    const clips = {};
    for (const [role, name] of Object.entries(def.clips)) {
      const c = gltf.animations.find((a) => a.name === name);
      if (c) clips[role] = inPlace(c, roots);
    }
    // размер и положение — по позе покоя первого клипа
    const mixer = new THREE.AnimationMixer(scene);
    const pose = clips.idle || clips.walk;
    if (pose) {
      mixer.clipAction(pose).play();
      mixer.setTime(0);
    }
    scene.updateMatrixWorld(true);
    _box.makeEmpty();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) {
        o.computeBoundingBox();
        _box.union(_b.copy(o.boundingBox).applyMatrix4(o.matrixWorld));
      } else _box.expandByObject(o);
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
    _box.getSize(_size);
    const scale = def.h / Math.max(0.001, _size.y);
    const a = { scene, clips, scale, offset: new THREE.Vector3(-(_box.min.x + _box.max.x) / 2, -_box.min.y, -(_box.min.z + _box.max.z) / 2) };
    assets.set(kind, a);
    return a;
  });
  pending.set(kind, p);
  return p;
}
export function loadMonsterAssets() {
  return Promise.all(Object.keys(MODELS).map((k) => loadModel(k).catch((e) => console.error(`Не удалось загрузить модель «${k}»`, e))));
}
loadMonsterAssets();

const eyeMats = new Map();
function eyeMaterial(color) {
  if (!eyeMats.has(color)) {
    eyeMats.set(color, new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  }
  return eyeMats.get(color);
}

export class Monster3D {
  constructor(kind) {
    this.kind = MODELS[kind] ? kind : 'crooked';
    this.def = MODELS[this.kind];
    this.npc = NPCS[kind] || NPCS.crooked;
    this.R = this.npc.r;
    this.height = this.def.h;
    this.hover = this.def.hover || 0;
    this.labelHeight = this.height + this.hover + 8;
    this.tpl = { hb: (this.height + this.hover) * 0.5, R: this.R };
    this.group = new THREE.Group();
    this.root = new THREE.Group(); // наклоны, выпады, парение
    this.group.add(this.root);
    this.mats = [];
    this.actions = {};
    this.current = null;
    this.mixer = null;
    this.t = Math.random() * 10;
    this.flash = 0;
    this.busy = 0; // сколько ещё идёт разовая анимация (удар, выстрел, боль)
    this.lunge = -1; // выпад без клипа
    this.deadT = -1;
    this.hi = null; // { r, g, b } — свечение цели под прицелом
    this.wasWarning = false;
    this.disposed = false;
    const a = assets.get(this.kind);
    if (a) this.build(a);
    else loadModel(this.kind).then((asset) => { if (!this.disposed) this.build(asset); }).catch(() => {});
  }

  build(a) {
    const model = SkeletonUtils.clone(a.scene);
    model.position.copy(a.offset).multiplyScalar(a.scale);
    model.scale.setScalar(a.scale);
    const turn = new THREE.Group();
    turn.rotation.y = Math.PI / 2 + (this.def.yaw || 0); // модели смотрят вдоль +Z
    turn.add(model);
    this.root.add(turn);
    // свои материалы: вспышка при попадании и призрачность — у каждого существа отдельно
    const own = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => {
        if (!own.has(m)) {
          const c = m.clone();
          if (this.def.ghost) {
            c.transparent = true;
            c.opacity = 0.78;
            c.depthWrite = true;
            c.color.multiply(new THREE.Color(this.def.ghostTint || '#b8ffe0'));
          }
          own.set(m, c);
          this.mats.push(c);
        }
        return own.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    this.mixer = new THREE.AnimationMixer(model);
    for (const [role, clip] of Object.entries(a.clips)) {
      const act = this.mixer.clipAction(clip);
      if (role === 'attack' || role === 'shoot' || role === 'hit' || role === 'death') {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = role === 'death';
      }
      this.actions[role] = act;
    }
    // огонёк: у машин — красный или жёлтый «глаз», у духа — холодное сияние
    if (this.def.eye || this.def.ghost) {
      this.eye = new THREE.Sprite(eyeMaterial(this.def.glow || (this.def.ghost ? '#7dffd0' : this.npc.color)));
      this.eye.scale.setScalar(this.def.ghost ? this.height * 1.5 : this.height * 0.55);
      this.eye.position.set(this.def.ghost ? 0 : this.height * 0.12, this.height * (this.def.ghost ? 0.5 : this.def.eye), 0);
      this.root.add(this.eye);
    }
    this.play(this.actions.idle ? 'idle' : 'walk', 0);
    if (this.deadT >= 0) this.startDeath();
  }

  play(role, fade = 0.2) {
    const next = this.actions[role];
    if (!next || next === this.current) return next;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
    this.role = role;
    return next;
  }

  // разовая анимация; from — с какой доли клипа начать, rate — скорость
  once(role, from = 0, rate = 1) {
    const act = this.actions[role];
    if (!act) return false;
    const dur = act.getClip().duration;
    this.play(role, 0.08);
    act.time = dur * from;
    act.timeScale = rate;
    this.busy = (dur * (1 - from)) / rate;
    return true;
  }

  // замах: клип удара подгоняется так, чтобы сам удар пришёлся на конец замаха
  windup() {
    const act = this.actions.attack;
    if (!act || this.deadT >= 0) return;
    const hitAt = act.getClip().duration * (this.def.impact ?? 0.45);
    this.once('attack', 0, Math.max(0.5, Math.min(2.5, hitAt / (this.npc.windup || 0.3))));
  }

  // удар (fromWindup — замах уже проигран) или выстрел (ranged)
  attack(fromWindup = false, ranged = false) {
    if (this.deadT >= 0) return;
    if (ranged) {
      if (!this.once('shoot', this.def.impact ?? 0.3, 1.2)) this.lunge = 0.1;
      return;
    }
    if (fromWindup && this.role === 'attack' && this.busy > 0) return; // клип уже идёт с замаха
    if (!this.once('attack', this.def.impact ?? 0.45, 1)) this.lunge = fromWindup ? 0.12 : 0;
  }

  hit() {
    this.flash = 1;
    if (this.busy <= 0 && this.deadT < 0) this.once('hit', 0, 1.3);
  }

  setWeapon() {}

  startDeath() {
    if (!this.mixer) return;
    this.busy = 0;
    const act = this.actions.death;
    if (act) {
      this.play('death', 0.1);
      act.timeScale = 1;
    } else if (this.current) this.current.paused = true;
  }

  die() {
    if (this.deadT >= 0) return;
    this.deadT = 0;
    if (this.eye) this.eye.visible = false;
    this.startDeath();
  }

  // speed — скорость движения (ед/с), night — 0..1 насколько темно
  update(dt, { speed = 0, warning = false, night = 0, dead = false } = {}) {
    this.t += dt;
    if (dead) this.die();
    const def = this.def;
    if (warning && !this.wasWarning) this.windup();
    this.wasWarning = warning;
    if (this.busy > 0) this.busy -= dt;

    if (this.deadT >= 0) {
      this.deadT += dt;
      // без клипа смерти — заваливается набок и оседает
      if (!this.actions.death) {
        const k = Math.min(1, this.deadT / 0.6);
        const e = k * k * (3 - 2 * k);
        this.root.rotation.x = e * (this.hover ? 0.9 : 1.45);
        this.root.position.y = this.hover * (1 - e) + (this.hover ? this.height * 0.15 * e : 0);
      } else if (this.hover) {
        this.root.position.y = this.hover * Math.max(0, 1 - this.deadT / 0.5);
      }
    } else if (this.mixer && this.busy <= 0) {
      const moving = speed > 10;
      const role = !moving ? (this.actions.idle ? 'idle' : 'walk') : speed > def.runAt && this.actions.run ? 'run' : 'walk';
      const act = this.play(role, 0.25);
      if (act) {
        if (!moving && !this.actions.idle) act.timeScale = 0.06; // покоя в модели нет — замирает, едва шевелясь
        else if (moving && def.stride) act.timeScale = Math.max(0.5, Math.min(2.2, speed / def.stride));
        else act.timeScale = 1;
      }
    }
    if (this.mixer) this.mixer.update(dt);

    if (this.deadT < 0) {
      // парение, наклон в полёте и выпад для моделей без клипа удара
      const move = Math.min(1, speed / 90);
      let x = 0;
      let lean = (def.lean || 0) * move;
      if (this.lunge >= 0) {
        this.lunge += dt;
        const k = this.lunge / 0.42;
        if (k >= 1) this.lunge = -1;
        else {
          const s = Math.sin(Math.min(1, k) * Math.PI);
          x = s * this.R * 0.7;
          lean += s * 0.3;
        }
      }
      if (warning && !this.actions.attack) lean -= 0.16 + Math.sin(this.t * 24) * 0.02; // отклоняется назад перед ударом
      this.root.position.x = x;
      this.root.rotation.z = -lean;
      this.root.position.y = this.hover ? this.hover + Math.sin(this.t * 2.2) * (def.ghost ? 3 : 1.6) : 0;
      if (!this.actions.idle && !this.hover && speed <= 10) this.root.rotation.x = Math.sin(this.t * 1.3) * 0.02;
      else this.root.rotation.x = 0;
    }
    if (this.eye) this.eye.material.opacity = def.ghost ? 0.25 + night * 0.35 : 0.55 + night * 0.4;

    // вспышка при попадании и предупреждение о замахе
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    const warn = warning ? 0.2 + (0.5 + 0.5 * Math.sin(this.t * 26)) * 0.25 : 0;
    const gold = def.glow ? 0.28 + Math.sin(this.t * 3) * 0.08 : 0; // проводник светится тёплым
    const hi = this.hi; // свечение цели под прицелом (задаёт TargetMark)
    const r = Math.max(this.flash * 0.8, warn * 0.7) + gold + (hi ? hi.r : 0);
    const g = this.flash * 0.25 + warn * 0.12 + (def.ghost ? 0.1 + night * 0.12 : 0) + gold * 0.7 + (hi ? hi.g : 0);
    const b = this.flash * 0.25 + (def.ghost ? 0.08 + night * 0.1 : 0) + (hi ? hi.b : 0);
    for (const m of this.mats) if (m.emissive) m.emissive.setRGB(r, g, b);
  }

  dispose() {
    this.disposed = true;
    if (this.mixer) this.mixer.stopAllAction();
    for (const m of this.mats) m.dispose();
  }
}
