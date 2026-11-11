// 3D-сцена игры: рельеф, объекты, существа с сервера, эффекты, камера.
import * as THREE from 'three';
import { MAP_H, MAP_W, NPCS, PLAYER, T, TILE, RESOURCES, RES_CHUNK, ABILITIES, WEAPONS } from '/shared/config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
import { Terrain } from './gfx/terrain.js';
import { Sky } from './gfx/sky.js';
import { StaticsView } from './gfx/statics3d.js';
import { Monster3D } from './gfx/monster3d.js';
import { Human3D } from './gfx/human3d.js';
import { Effects } from './gfx/effects.js';
import { Decor } from './gfx/decor.js';
import { ZonesView } from './gfx/zones3d.js';
import { CityView } from './gfx/city3d.js';
import { Snowfall } from './gfx/snow.js';
import { Hallucinations } from './gfx/hallucinations.js';
import { TargetMark } from './gfx/target.js';
import { G, M, mergeParts, glowTexture } from './gfx/util.js';

// след за снарядом: [цвет, вероятность частицы за кадр, размер]
const PROJ_TRAIL = {
  acid: ['#8dff5a', 0.5, 1.6], bomb: ['#ff8a2a', 0.8, 1.8], bullet: ['#ffe9a8', 0.6, 1.1],
  laser: ['#bff8ff', 0.7, 1.2], force: ['#cfeaff', 0.8, 2.2], fireball: ['#ffb347', 1, 2.6], drain: ['#8a0f3a', 0.9, 2.2], hex: ['#a14bff', 0.9, 2.2],
};
// свечение вокруг снарядов-заклинаний: [цвет, размер]
const PROJ_GLOW = { laser: ['#7ff7ff', 26], force: ['#9fd8ff', 40], fireball: ['#ff8a2a', 56], drain: ['#d01845', 36], hex: ['#9dff5a', 36] };
const glowMats = {};
// модели снарядов (смотрят вдоль +X)
const PROJ_GEO = {
  acid: mergeParts([{ geom: G.sphere, matrix: M(0, 0, 0, 0, 0, 0, 6), color: '#8dff5a' }]),
  stone: mergeParts([{ geom: G.dodeca, matrix: M(0, 0, 0, 0, 0, 0, 3.2), color: '#8a8a85' }]),
  arrow: mergeParts([
    { geom: G.cyl6, matrix: M(0, 0, 0, 0, 0, -Math.PI / 2, 0.5, 20, 0.5), color: '#c9b48a' },
    { geom: G.cone5, matrix: M(11, 0, 0, 0, 0, -Math.PI / 2, 1.3, 3, 1.3), color: '#8a8a85' },
    { geom: G.box, matrix: M(-9, 0, 0, 0, 0, 0, 3, 0.2, 2.4), color: '#e8e0c8' },
  ]),
  bullet: mergeParts([{ geom: G.cyl6, matrix: M(0, 0, 0, 0, 0, -Math.PI / 2, 0.9, 12, 0.9), color: '#fff2b0' }]),
  bomb: mergeParts([
    { geom: G.sphere, matrix: M(0, 0, 0, 0, 0, 0, 5), color: '#2b2b2e' },
    { geom: G.box, matrix: M(0, 0, 0, 0, 0, 0, 10.4, 2, 2), color: '#c9a227' },
  ]),
  laser: mergeParts([{ geom: G.cyl6, matrix: M(0, 0, 0, 0, 0, -Math.PI / 2, 1.1, 46, 1.1), color: '#e8ffff' }]),
  force: mergeParts([{ geom: G.ico, matrix: M(0, 0, 0, 0, 0, 0, 7, 7, 7), color: '#dff3ff' }]),
  fireball: mergeParts([{ geom: G.sphere, matrix: M(0, 0, 0, 0, 0, 0, 7), color: '#ffd27a' }]),
  drain: mergeParts([{ geom: G.sphere, matrix: M(0, 0, 0, 0, 0, 0, 6), color: '#5a0820' }]),
  hex: mergeParts([{ geom: G.dodeca, matrix: M(0, 0, 0, 0, 0, 0, 6), color: '#b6ff7a' }]),
};
const MAGIC = new Set(['laser', 'force', 'fireball', 'drain', 'hex']);
const IMPACT_COLORS = { laser: '#bff8ff', force: '#cfeaff', drain: '#c4163c', hex: '#a14bff', bullet: '#ffd166' };

const HIT_COLORS = {
  tree: ['#6b4423', '#4f8a3a'], rock: ['#8a8a85', '#6e6e68'], bush: ['#3f7d3a', '#c8324b'],
  crystal: ['#b06bff', '#e6d3ff'], wood: ['#8b5a2b', '#5a3a1c'], stone: ['#8e8f8a', '#6e6e68'],
  sulfur: ['#d9c23a', '#8a8a85'], scrap: ['#8a5a3a', '#9a9a9a'], car: ['#8a5a3a', '#6e7a86'], cactus: ['#6fae78', '#ff8fc4'], frog: ['#3f8f4a', '#9dffb0'], terminal: ['#5ec8ff', '#3a3f48'],
  mush_brown: ['#7a4a22', '#e8dcc0'], mush_red: ['#d42e26', '#ffffff'], mush_glow: ['#5ec8ff', '#bfe6ff'],
};
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _white = new THREE.Color('#ffffff');

export class WorldView {
  constructor(canvas, labelsEl, floatersEl, audio = null) {
    this.canvas = canvas;
    this.audio = audio;
    this.listenerYaw = 0; // направление камеры — для стереопанорамы звуков
    this.damageFlash = document.getElementById('damageFlash');
    this.damageFlashTimer = 0;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 2, 14000);
    this.sky = new Sky(this.scene);
    this.effects = new Effects(this.scene, floatersEl);
    this.labelsEl = labelsEl;
    this.ents = new Map();
    this.projs = new Map();
    this.shake = 0;
    this.decals = [];
    this.meteorView = null;
    this.night = 0;
    this.time = 0;
    this.camTarget = new THREE.Vector3();
    this.rayDir = new THREE.Vector3(1, 0, 0);
    this.projMat = new THREE.MeshStandardMaterial({ color: '#8dff5a', emissive: '#3fd400', emissiveIntensity: 1, roughness: 0.3 });
    this.bubbleMat = new THREE.MeshBasicMaterial({ color: '#9cf0a4', transparent: true, opacity: 0.16, depthWrite: false });
    this.shieldMat = new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
    this.rings = []; // расходящиеся кольца (ЭМИ, телепорт)
    this.hal = { s: 0, t: 0 }; // галлюцинации от грибов: сила и сколько осталось
    this.myMed = false; // своя медитация у алтаря
  }

  init(tiles, seed, myUid, zones = []) {
    this.terrain = new Terrain(tiles, seed, zones);
    this.scene.add(this.terrain.group);
    this.visions = new Hallucinations(this.renderer, this.scene, this.camera, (x, z) => this.ground(x, z));
    this.zonesView = new ZonesView(this.scene, this.terrain, zones);
    this.cityView = new CityView(this.scene, this.terrain, tiles);
    this.snow = this.snow || new Snowfall(this.scene);
    this.decor = new Decor(this.terrain, tiles, seed);
    this.scene.add(this.decor.group);
    this.statics = new StaticsView(this.scene, this.terrain);
    this.statics.myUid = myUid;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#6fff8a', transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    this.scene.add(this.ghost);
    // рамка клетки под призраком и сетка соседних клеток — видно, куда встанет постройка
    this.cellFrame = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#9cf0a4', transparent: true, opacity: 0.95, depthTest: false }));
    this.buildGrid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    for (const l of [this.cellFrame, this.buildGrid]) {
      l.visible = false;
      l.frustumCulled = false;
      l.renderOrder = 4;
      this.scene.add(l);
    }
    this.gridCell = null;
    const ringMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(PLAYER.buildRange - 2.5, PLAYER.buildRange, 72), ringMat('#9cf0a4', 0.35));
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.renderOrder = 10;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);
    // Прицел на земле: яркое кольцо с точкой и тёмной обводкой с обеих сторон — виден и на светлом
    // тумане, и на тёмной земле. Рисуется без тумана и с ростом при удалении (см. setAim).
    this.aimGroup = new THREE.Group();
    this.aimMat = ringMat('#ffffff', 1);
    const aimDarkMat = ringMat('#0b0f0c', 0.8);
    const aimParts = [
      [new THREE.RingGeometry(5.4, 12.6, 36), aimDarkMat, 10],
      [new THREE.CircleGeometry(4, 16), aimDarkMat, 10],
      [new THREE.RingGeometry(7.2, 10.8, 36), this.aimMat, 11],
      [new THREE.CircleGeometry(2.4, 16), this.aimMat, 11],
    ];
    for (const [geo, mat, order] of aimParts) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = order;
      this.aimGroup.add(m);
    }
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.mark = new TargetMark(this.scene); // выделение цели под прицелом
    this.lockV = null; // цель под курсором и сколько ещё её держим после того, как курсор сошёл
    this.lockT = 0;
  }

  ground(x, y) {
    return this.terrain.heightAt(x, y);
  }

  // по нам попали: тряска камеры и красная вспышка по краям экрана
  damageFeedback(amount) {
    this.shake = Math.max(this.shake, Math.min(4, 1.5 + amount * 0.06));
    if (!this.damageFlash) return;
    this.damageFlash.style.setProperty('--damage-strength', String(Math.min(0.78, 0.36 + amount * 0.012)));
    this.damageFlash.classList.remove('active');
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add('active');
    clearTimeout(this.damageFlashTimer);
    this.damageFlashTimer = setTimeout(() => this.damageFlash?.classList.remove('active'), 520);
  }

  makeProjectile(kind) {
    if (!this.projStdMat) {
      this.projStdMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 });
      this.bulletMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    }
    const geo = PROJ_GEO[kind] || PROJ_GEO.acid;
    const mat = kind === 'acid' ? this.projMat : kind === 'bullet' || MAGIC.has(kind) ? this.bulletMat : this.projStdMat;
    const mesh = new THREE.Mesh(geo, mat);
    const glow = PROJ_GLOW[kind];
    if (glow) {
      if (!glowMats[kind]) glowMats[kind] = new THREE.SpriteMaterial({ map: glowTexture(), color: glow[0], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const sp = new THREE.Sprite(glowMats[kind]);
      sp.scale.setScalar(glow[1]);
      mesh.add(sp);
    }
    return mesh;
  }

  // высота, на которой стоит существо (в глубокой воде — плывёт)
  standY(x, y, hb) {
    return Math.max(this.ground(x, y), -hb * 0.75);
  }

  // ---------- статичные объекты ----------
  applyStatics(sa, sd) {
    if (sd) for (const id of sd) this.statics.remove(id);
    if (sa) {
      const sorted = [...sa].sort((a, b) => (a.k === 'door') - (b.k === 'door'));
      for (const s of sorted) this.statics.upsert(s);
    }
  }

  // забыть ресурсы дальних участков (сервер пришлёт их снова, когда подойдём)
  dropResChunks(keys) {
    const drop = new Set(keys);
    const ids = [];
    for (const [id, o] of this.statics.objs) {
      if (RESOURCES[o.s.k] && drop.has(Math.floor(o.s.x / RES_CHUNK) * 4096 + Math.floor(o.s.y / RES_CHUNK))) ids.push(id);
    }
    for (const id of ids) this.statics.remove(id);
  }

  // ---------- существа ----------
  addEnt(e) {
    // игроки — люди, чудовища — готовые анимированные модели (духи и мутанты леса, машины города)
    const creature = e.k === 'p' ? new Human3D(e.ap, e.g, e.c) : new Monster3D(e.t);
    this.scene.add(creature.group);
    const v = { creature, look: e.g, ap: e.ap, color: e.c, dd: !!e.dd, px: e.x, py: e.y, speed: 0, stepTimer: Math.random() * 0.25, at: 0, hf: 0, label: null, hpFill: null, lastHp: -1 };
    const el = document.createElement('div');
    el.className = 'label';
    const nm = document.createElement('span');
    if (e.k === 'p') {
      nm.textContent = e.n;
      nm.style.color = '#ffffff';
    } else {
      const def = NPCS[e.t];
      nm.textContent = def.name;
      nm.style.color = def.behavior === 'passive' ? '#e8e0c8' : def.faction === 'tech' ? '#ffd27a' : '#ffb4a8';
    }
    el.appendChild(nm);
    v.nm = nm;
    const bar = document.createElement('div');
    bar.className = 'hp';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    el.appendChild(bar);
    el.style.display = 'none';
    this.labelsEl.appendChild(el);
    v.label = el;
    v.hpBar = bar;
    v.hpFill = fill;
    this.ents.set(e.i, v);
    return v;
  }

  // Звук шага по почве под ногами: у каждой свой — трава, камень и асфальт, лёд, песок, снег, плеск по воде.
  // step — имя звука, pitch — высота тона, wet — по воде (тише)
  stepInfo(x, y) {
    const tx = Math.max(0, Math.min(MAP_W - 1, Math.floor(x / TILE)));
    const ty = Math.max(0, Math.min(MAP_H - 1, Math.floor(y / TILE)));
    const tile = this.terrain.tiles[ty * MAP_W + tx];
    const wet = tile === T.SHALLOW || tile === T.DEEP;
    const snowy = tile === T.SNOW || tile === T.TAIGA;
    const step = wet ? 'splash' : tile === T.ROCK || tile === T.CITY || tile === T.WALL || tile === T.ICE ? 'stepRock' : tile === T.SAND ? 'stepSand' : snowy ? 'stepSnow' : 'stepGrass';
    const pitch = tile === T.SAND ? 0.8 : snowy ? 1.12 : tile === T.ICE ? 1.25 : tile === T.FOREST ? 0.9 : 1;
    return { step, pitch, wet };
  }

  // Прыжок своего существа сразу по нажатию, не дожидаясь сервера. false — прыгнуть нельзя:
  // нет существа, оно мертво, плывёт, уже в воздухе или ещё не отошло от приземления.
  jump(id, me) {
    const v = this.ents.get(id);
    return !!v && !!v.e && !v.e.dd && !v.swimming && !v.jp && !(v.sq > 0.5); // сам прыжок считает сервер
  }

  startJump(v, x, y, me, isMe) {
    this.effects.burst(x, Math.max(this.ground(x, y), 0) + 2, y, '#b9ad8a', 4, { speed: 36, size: 2, life: 0.32, gravity: -6 });
    const { step, pitch } = this.stepInfo(x, y);
    this.audio?.playAt(step, x, y, me.x, me.y, { volume: isMe ? 0.42 : 0.2, range: 520, yaw: this.listenerYaw, rate: 1.18 * pitch });
  }

  landJump(v, x, y, me, isMe) {
    this.effects.burst(x, Math.max(this.ground(x, y), 0) + 2, y, '#b9ad8a', 7, { speed: 52, size: 2.4, life: 0.4, gravity: -8 });
    const { step, pitch } = this.stepInfo(x, y);
    this.audio?.playAt(step, x, y, me.x, me.y, { volume: isMe ? 0.6 : 0.3, range: 560, yaw: this.listenerYaw, rate: 0.82 * pitch });
  }

  // ближайшее к точке существо/игрок (для эффектов без id)
  nearestEnt(x, y, maxD) {
    let best = null;
    let bd = maxD;
    for (const v of this.ents.values()) {
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  removeEnt(id) {
    const v = this.ents.get(id);
    if (!v) return;
    if (this.mark?.v === v) this.mark.release();
    if (this.lockV === v) this.lockV = null;
    this.scene.remove(v.creature.group);
    v.creature.dispose();
    v.label.remove();
    this.ents.delete(id);
  }

  // me: { x, y, face } — сглаженная позиция и поворот своего существа
  syncEntities(list, dt, myId, me) {
    const seen = new Set();
    const seenJ = new Set();
    for (const e of list) {
      if (e.k === 'j') {
        seenJ.add(e.i);
        let m = this.projs.get(e.i);
        if (!m) {
          m = this.makeProjectile(e.t || 'acid');
          this.scene.add(m);
          this.projs.set(e.i, m);
        }
        m.position.set(e.x, this.standY(e.x, e.y, 20) + 18, e.y);
        m.rotation.y = -(e.a || 0);
        const trail = PROJ_TRAIL[e.t || 'acid'];
        if (trail && Math.random() < trail[1]) this.effects.burst(e.x, m.position.y, e.y, trail[0], 1, { speed: 12, size: trail[2], life: 0.3, gravity: 0 });
        continue;
      }
      seen.add(e.i);
      let v = this.ents.get(e.i);
      // пересоздаём, если сменились мутации/внешность или погибший игрок возродился
      if (v && (v.look !== e.g || v.color !== e.c || v.ap !== e.ap || (v.dd && !e.dd))) {
        this.removeEnt(e.i);
        v = null;
      }
      if (!v) v = this.addEnt(e);
      const isMe = e.i === myId;
      const x = isMe ? me.x : e.x;
      const y = isMe ? me.y : e.y;
      const a = isMe ? me.face : e.a;
      const d = Math.hypot(x - v.px, y - v.py);
      if (dt > 0) v.speed = v.speed * 0.75 + Math.min(600, d / dt) * 0.25;
      v.px = x;
      v.py = y;
      const yaw = this.listenerYaw;
      // предупреждение: моб замахивается (wu) или чужой игрок идёт на таран
      const warns = !isMe && (!!e.wu || (e.k === 'p' && !!e.ch));
      if (e.at && !v.at) {
        v.creature.attack(!!v.warning, e.at === 2);
        if (e.k === 'p') {
          const wt = WEAPONS[e.w]?.type;
          if (!e.w) this.audio?.playAt('swingFist', x, y, me.x, me.y, { volume: isMe ? 0.5 : 0.32, range: 600, yaw, rate: 1.25 });
          else if (wt === 'melee') this.audio?.playAt('swing', x, y, me.x, me.y, { volume: isMe ? 0.34 : 0.22, range: 650, yaw, rate: e.w === 'club' || e.w === 'axe' || e.w === 'pickaxe' ? 0.8 : e.w === 'dagger' ? 1.2 : 0.96 });
        } else if (e.at !== 2) {
          // чудовище бьёт: звери рвут, машины лязгают
          const tech = NPCS[e.t]?.faction === 'tech';
          this.audio?.playAt(tech ? 'metalHit' : 'swing', x, y, me.x, me.y, { volume: 0.26, range: 650, yaw, rate: tech ? 0.8 : 0.85 });
        }
      }
      if (warns && !v.warning) {
        const colossus = (NPCS[e.t]?.windup || 0) >= 0.5; // тяжёлый замах великанов слышно издалека
        const def = NPCS[e.t];
        // замах: мутанты рычат (чем крупнее — тем ниже), духи воют, машины подают сигнал, игрок-таран — колокол
        const voice = !def ? 'danger' : def.faction === 'tech' ? 'alarm' : def.fly ? 'wail' : 'growl';
        this.audio?.playAt(voice, x, y, me.x, me.y, {
          volume: colossus ? 0.6 : 0.42, range: colossus ? 900 : 700, yaw, rate: colossus ? 0.78 : 1.18, arg: def ? clamp(22 / def.r, 0.55, 1.5) : 1,
        });
      }
      v.at = e.at;
      if (e.hf && !v.hf) v.creature.hit();
      v.hf = e.hf;
      v.warning = warns;
      v.dd = !!e.dd;
      const ground = this.ground(x, y);
      const gy = this.standY(x, y, v.creature.tpl.hb);
      // пловец держится у поверхности: иначе всё тело уходит под воду и его не видно
      const swimming = !e.dd && v.creature.swimY !== undefined && ground < -v.creature.tpl.hb * 0.6;
      const wantY = e.dd ? Math.max(ground, 0) : swimming ? v.creature.swimY : gy;
      // вход в воду и выход из неё — плавно, а не скачком
      if (swimming !== v.swimming) v.easeY = 0.7;
      v.swimming = swimming;
      v.easeY = Math.max(0, (v.easeY || 0) - dt);
      if (v.cy === undefined || e.dd || Math.abs(wantY - v.cy) > 60 || v.easeY <= 0) v.cy = wantY;
      else v.cy += (wantY - v.cy) * (1 - Math.exp(-dt * 7));
      // прыжок (пробел): дуга над землёй, растяжка в полёте, сжатие при приземлении. Чисто зрелищный:
      // свой стартует сразу по нажатию (jump), чужой — по флагу jp с сервера
      // высота над землёй (прыжок, падение, стойка на валуне) приходит с сервера, взлёт и посадка — по флагу jp
      if (e.jp && !v.jp && !e.dd && !swimming) this.startJump(v, x, y, me, isMe);
      if (!e.jp && v.jp && !e.dd) {
        v.sq = 1;
        this.landJump(v, x, y, me, isMe);
      }
      v.jp = e.jp;
      const hop = e.dd || swimming ? 0 : e.z || 0;
      let squash = 1 + (e.jp ? Math.min(0.06, hop * 0.002) : 0);
      if (v.sq > 0) {
        v.sq = Math.max(0, v.sq - dt / 0.16);
        squash -= 0.12 * v.sq;
      }
      v.hop = hop;
      v.creature.group.position.set(x, v.cy + hop, y);
      if (e.k === 'p') v.creature.root.scale.y = squash;
      v.creature.group.rotation.y = -a;
      v.creature.setWeapon(e.k === 'p' && !e.dd ? e.w || null : null);
      v.creature.update(dt, {
        speed: e.dd ? 0 : v.speed, charging: !!e.ch, warning: warns, night: this.night,
        swim: swimming, dead: !!e.dd,
      });
      // шаги: звук по типу почвы (в прыжке ноги землю не касаются)
      if (v.speed > 34 && !v.jp) {
        v.stepTimer -= dt;
        if (v.stepTimer <= 0) {
          const { step, pitch, wet } = this.stepInfo(x, y);
          this.audio?.playAt(step, x, y, me.x, me.y, { volume: (isMe ? 0.52 : 0.26) * (wet ? 0.8 : 1), range: 520, yaw, rate: (v.speed > 135 ? 1.08 : 0.96) * pitch });
          v.stepTimer = Math.max(0.3, Math.min(0.54, 0.58 - v.speed * 0.00135));
        }
      } else {
        v.stepTimer = Math.min(v.stepTimer, 0.1);
      }
      if (e.sp && !v.bubble) {
        v.bubble = new THREE.Mesh(G.sphere, this.bubbleMat);
        v.bubble.scale.setScalar(v.creature.R * 2.4);
        v.bubble.position.y = v.creature.tpl.hb;
        v.creature.group.add(v.bubble);
      }
      if (v.bubble) v.bubble.visible = !!e.sp;
      // щит духа — золотистая сфера
      if (e.sh && !v.shield) {
        v.shield = new THREE.Mesh(G.sphere, this.shieldMat);
        v.shield.scale.setScalar(v.creature.labelHeight ? 30 : v.creature.R * 2.6);
        v.shield.position.y = v.creature.tpl.hb;
        v.creature.group.add(v.shield);
      }
      if (v.shield) {
        v.shield.visible = !!e.sh;
        this.shieldMat.opacity = 0.16 + Math.sin(this.time * 6) * 0.06;
      }
      // проклятие — зелёно-фиолетовая дымка, оглушение — искры над головой, медитация — восходящие огоньки
      v.fxT = (v.fxT || 0) - dt;
      if (v.fxT <= 0 && (e.hx || e.st || (isMe && this.myMed))) {
        v.fxT = 0.12;
        const top = gy + (v.creature.labelHeight || v.creature.tpl.hb * 2);
        if (e.hx) this.effects.burst(x + (Math.random() - 0.5) * 20, gy + 10 + Math.random() * 30, y + (Math.random() - 0.5) * 20, Math.random() < 0.5 ? '#a14bff' : '#7dff4a', 2, { speed: 15, size: 2, life: 0.7, gravity: -30 });
        if (e.st) this.effects.burst(x, top + 4, y, '#bff8ff', 2, { speed: 40, size: 1.8, life: 0.3, gravity: 0 });
        if (isMe && this.myMed) this.effects.burst(x + (Math.random() - 0.5) * 50, gy + 2, y + (Math.random() - 0.5) * 50, '#c77dff', 1, { speed: 8, size: 2.2, life: 1.4, gravity: -40, up: 2 });
      }
      v.e = e;
      v.x = x;
      v.y = y;
      v.gy = gy;
      v.isMe = isMe;
    }
    for (const [id, v] of [...this.ents]) {
      if (seen.has(id)) continue;
      // убитое чудовище ещё пару секунд доигрывает смерть и оседает в землю
      if (v.dying > 0) {
        v.dying -= dt;
        v.e = null;
        v.label.style.display = 'none';
        v.creature.update(dt, { dead: true, night: this.night });
        if (v.dying < 0.8) v.creature.group.position.y -= dt * (v.creature.height || 40) * 0.9;
        if (v.dying > 0) continue;
      }
      this.removeEnt(id);
    }
    for (const [id, m] of this.projs) {
      if (!seenJ.has(id)) {
        this.scene.remove(m);
        this.projs.delete(id);
      }
    }
  }

  // ---------- эффекты с сервера ----------
  handleFx(list, myX, myY, yaw = 0) {
    const fx = this.effects;
    const snd = (name, f, opts) => this.audio?.playAt(name, f.x, f.y, myX, myY, { yaw, ...opts });
    for (const f of list) {
      const gy = this.ground(f.x, f.y);
      switch (f.k) {
        case 'dmg': {
          // по машинам удар звенит металлом, по живым — глухой
          const who = this.nearestEnt(f.x, f.y, 50);
          const metal = who?.e?.k === 'n' && NPCS[who.e.t]?.faction === 'tech';
          snd(metal ? 'metalHit' : f.n >= 25 ? 'heavyHit' : 'hit', f, { volume: 0.48, range: 620, rate: metal ? 1.1 : 1 });
          fx.text(f.x, gy + 34, f.y, `-${f.n}`, f.c);
          fx.burst(f.x, gy + 20, f.y, '#c0392b', 6, { speed: 70 });
          break;
        }
        case 'hit': {
          const m = f.m;
          const sound = m === 'tree' ? 'chop' : m === 'wood' ? 'woodHit'
            : m === 'scrap' || m === 'car' || m === 'terminal' ? 'metalHit'
              : m === 'rock' || m === 'stone' || m === 'sulfur' ? 'stoneHit'
                : m === 'crystal' ? 'crystalHit' : 'softHit';
          snd(sound, f, { volume: 0.44, range: 620, rate: m === 'car' ? 0.8 : m === 'terminal' ? 1.3 : m === 'sulfur' ? 1.15 : 1 });
          for (const c of HIT_COLORS[f.m] || ['#cccccc']) fx.burst(f.x, gy + 18, f.y, c, 5, { speed: 70 });
          if (f.id) this.statics.hit(f.id);
          break;
        }
        case 'gain': {
          // еда хрустит, вода булькает, знания и сила духа звенят, добыча с чудовищ шуршит
          const t = f.text || '';
          const sound = t.includes('🍖') ? 'crunch' : t.includes('💧') ? 'gulp' : t.includes('📘') || t.includes('✨') ? 'rise'
            : t.includes('🔧') ? 'craft' : t.includes('☣') ? 'slime' : t.includes('🦴') || t.includes('⚙️') ? 'loot' : 'pickup';
          snd(sound, f, { volume: sound === 'rise' ? 0.22 : 0.36, range: 460, rate: sound === 'slime' ? 1.5 : 1 });
          fx.text(f.x, gy + 44, f.y, f.text, '#c8f7c5', 'gain');
          break;
        }
        case 'die': {
          const body = f.id ? this.ents.get(f.id) : null;
          if (body && body.creature.die) body.dying = 2.6; // тело остаётся и доигрывает смерть
          if (f.f === 'tech') {
            // машина: искры и дым
            snd('robotDie', f, { volume: 0.5, range: 900 });
            snd('metalHit', f, { volume: 0.6, range: 800, rate: 0.7 });
            fx.burst(f.x, gy + 20, f.y, '#ffd166', 26, { speed: 170, size: 2.2, life: 0.7 });
            fx.burst(f.x, gy + 20, f.y, '#3a3a3a', 12, { speed: 40, size: 5, life: 1.4, gravity: -30 });
          } else if (f.f === 'spirit') {
            snd('softBreak', f, { volume: 0.52, range: 700 });
            snd('slime', f, { volume: 0.45, range: 700, rate: 0.7 });
            fx.burst(f.x, gy + 15, f.y, '#7a1016', 24, { speed: 120, size: 3.2, life: 0.9 });
            fx.burst(f.x, gy + 15, f.y, f.c || '#ffffff', 8, { speed: 80 });
          } else {
            snd('softBreak', f, { volume: 0.52, range: 700 });
            snd('playerDie', f, { volume: 0.5, range: 900 });
            fx.burst(f.x, gy + 15, f.y, f.c || '#ffffff', 28, { speed: 130, size: 3.5, life: 1 });
            fx.burst(f.x, gy + 15, f.y, '#ffffff', 8, { speed: 90 });
          }
          break;
        }
        case 'evolve':
          snd('evolve', f, { volume: 0.56, range: 700 });
          snd('slime', f, { volume: 0.5, range: 700, rate: 0.85 });
          fx.burst(f.x, gy + 10, f.y, '#b98cff', 34, { speed: 70, up: 1.6, gravity: 40, life: 1.4 });
          fx.burst(f.x, gy + 10, f.y, f.c || '#ffffff', 18, { speed: 50, up: 2, gravity: 30, life: 1.2 });
          break;
        case 'spit':
          snd('slime', f, { volume: 0.34, range: 540, rate: 1.9 });
          this.nearestEnt(f.x, f.y, 40)?.creature.spit?.();
          fx.burst(f.x, gy + 18, f.y, '#8dff5a', 4, { speed: 40, size: 1.8 });
          break;
        case 'splash':
          snd('softHit', f, { volume: 0.4, range: 520, rate: 0.92 });
          snd('sizzle', f, { volume: 0.5, range: 520 });
          fx.burst(f.x, gy + 15, f.y, '#8dff5a', 14, { speed: 90, size: 2.2 });
          break;
        case 'thud':
          snd('heavyHit', f, { volume: 0.62, range: 720 });
          fx.burst(f.x, gy + 8, f.y, '#b5a585', 16, { speed: 100, size: 3 });
          if (Math.hypot(f.x - myX, f.y - myY) < 300) this.shake = Math.max(this.shake, 4);
          break;
        case 'dash':
          // рывок на реактивных ускорителях
          snd('thruster', f, { volume: 0.6, range: 800, rate: 1.3 });
          fx.burst(f.x, gy + 16, f.y, '#5ec8ff', 18, { speed: 130, size: 2.4, life: 0.35, gravity: 0 });
          fx.burst(f.x, gy + 6, f.y, '#c9d2da', 10, { speed: 70, size: 3, life: 0.5 });
          break;
        case 'zap':
          // разрядник: удар током
          snd('zap', f, { volume: 0.5, range: 600 });
          fx.burst(f.x, gy + 24, f.y, '#bff8ff', 16, { speed: 170, size: 2, life: 0.25, gravity: 0 });
          break;
        case 'break':
          snd(f.m === 'wood' ? 'woodBreak' : f.m === 'stone' ? 'stoneHit' : 'softBreak', f, { volume: 0.62, range: 700, rate: f.m === 'stone' ? 0.75 : 1 });
          if (f.m === 'wood') snd('creak', f, { volume: 0.5, range: 700 });
          for (const c of HIT_COLORS[f.m] || ['#cccccc']) fx.burst(f.x, gy + 20, f.y, c, 18, { speed: 150, size: 4, life: 1.1 });
          break;
        case 'meteor':
          snd('blast', f, { volume: 0.9, range: 2400, rate: 0.6 });
          snd('rumble', f, { volume: 0.9, range: 3000, rate: 0.7 });
          this.meteorImpact(f.x, f.y, myX, myY);
          break;
        case 'shot':
          // у каждого оружия свой голос (f.w — чем стреляли)
          if (f.m === 'bullet') {
            const heavy = f.w === 'shotgun';
            // хлопок выстрела: короткий взрыв повыше тоном; дробовик — ниже и с раскатом, турель и Каратель — суше
            snd('gunshot', f, { volume: heavy ? 0.85 : f.w === 'pistol' ? 0.6 : 0.42, range: heavy ? 1500 : 1200, rate: heavy ? 1.25 : f.w === 'pistol' ? 2.1 : 2.7 });
            snd('heavyHit', f, { volume: heavy ? 0.6 : 0.4, range: 900, rate: heavy ? 0.9 : 1.45 });
            if (heavy) snd('rumble', f, { volume: 0.4, range: 1200, rate: 1.6 });
          } else if (f.m === 'laser') snd(f.w === 'laser' ? 'laser' : 'laserRetro', f, { volume: 0.4, range: 900, rate: f.w === 'laser' ? 1 : 1.15 });
          else if (f.m === 'arrow') snd('twang', f, { volume: f.w === 'crossbow' ? 0.6 : 0.45, range: 600, rate: 1 });
          else if (f.m === 'force') snd('staff', f, { volume: 0.3, range: 700, rate: 0.7 });
          else if (f.m === 'drain') snd('wail', f, { volume: 0.4, range: 700 });
          else if (f.m === 'bomb') snd('swingFist', f, { volume: 0.5, range: 600, rate: 0.7 });
          else snd('swingFist', f, { volume: 0.5, range: 650, rate: 1.6 });
          if (f.m === 'bullet') {
            fx.burst(f.x, gy + 18, f.y, '#ffe066', 6, { speed: 60, size: 2.2, life: 0.18, gravity: 0 });
            fx.burst(f.x, gy + 18, f.y, '#9a9a9a', 4, { speed: 25, size: 3, life: 0.6, gravity: -20 });
            if (Math.hypot(f.x - myX, f.y - myY) < 60) this.shake = Math.max(this.shake, 1.5);
          }
          break;
        case 'impact':
          if (f.m === 'laser') snd('zap', f, { volume: 0.2, range: 520, rate: 1.4 });
          else if (f.m === 'arrow') snd('woodHit', f, { volume: 0.3, range: 520, rate: 1.5 });
          else if (f.m === 'hex') snd('curse', f, { volume: 0.35, range: 600 });
          else if (MAGIC.has(f.m)) snd('phaserDown', f, { volume: 0.22, range: 560, rate: 0.8 });
          else snd('softHit', f, { volume: 0.32, range: 520, rate: f.m === 'bullet' ? 1.3 : 1 });
          fx.burst(f.x, gy + 16, f.y, IMPACT_COLORS[f.m] || '#b5a585', MAGIC.has(f.m) ? 14 : 5, { speed: MAGIC.has(f.m) ? 110 : 70, size: MAGIC.has(f.m) ? 2.6 : 1.8, life: 0.45 });
          if (f.m === 'force') this.ring(f.x, f.y, '#cfeaff', 70, 0.35);
          break;
        case 'cast':
          // заклинания: телекинез — толчок, огненный шар — рёв пламени, вампиризм — вой, порча — зловещий спуск
          if (f.m === 'fireball') snd('thruster', f, { volume: 0.5, range: 700, rate: 0.8 });
          else if (f.m === 'drain') snd('wail', f, { volume: 0.45, range: 700 });
          else if (f.m === 'hex') snd('curse', f, { volume: 0.4, range: 700, rate: 0.9 });
          else snd('phaseJump', f, { volume: 0.35, range: 650, rate: 0.85 });
          fx.burst(f.x, gy + 26, f.y, PROJ_GLOW[ABILITIES[f.m]?.proj]?.[0] || '#c77dff', 8, { speed: 60, size: 2.2, life: 0.35, gravity: 0 });
          break;
        case 'blink':
          snd(f.to ? 'phaserDown' : 'phaserUp', f, { volume: 0.42, range: 800 });
          fx.burst(f.x, gy + 22, f.y, '#c77dff', 28, { speed: 130, size: 3, life: 0.6, up: 1.2, gravity: 0 });
          fx.burst(f.x, gy + 22, f.y, '#ffffff', 10, { speed: 80, size: 2, life: 0.4, gravity: 0 });
          this.ring(f.x, f.y, '#c77dff', 60, 0.4);
          break;
        case 'emp':
          snd('laserBig', f, { volume: 0.6, range: 1000, rate: 0.8 });
          snd('zap', f, { volume: 0.45, range: 900, rate: 0.7 });
          this.ring(f.x, f.y, '#5ec8ff', f.r || 230, 0.55);
          fx.burst(f.x, gy + 20, f.y, '#bff8ff', 40, { speed: 260, size: 2.4, life: 0.5, gravity: 0, up: 0.1 });
          if (Math.hypot(f.x - myX, f.y - myY) < 400) this.shake = Math.max(this.shake, 3);
          break;
        case 'shield':
          snd('forceField', f, { volume: 0.55, range: 700 });
          fx.burst(f.x, gy + 24, f.y, '#ffd98a', 24, { speed: 90, size: 2.6, life: 0.7, gravity: 0, up: 1 });
          break;
        case 'absorb':
          snd('forceField', f, { volume: 0.3, range: 500, rate: 1.9 });
          fx.burst(f.x, gy + 24, f.y, '#ffe9a8', 10, { speed: 80, size: 2, life: 0.35, gravity: 0 });
          break;
        case 'learn':
          snd('powerUp', f, { volume: 0.45, range: 700 });
          fx.burst(f.x, gy + 10, f.y, f.c || '#c77dff', 36, { speed: 70, up: 1.8, gravity: 30, life: 1.4 });
          fx.burst(f.x, gy + 10, f.y, '#ffffff', 12, { speed: 50, up: 2, gravity: 20, life: 1.1 });
          break;
        case 'drain': {
          // тёмная струя от жертвы к колдуну
          for (let i = 0; i <= 8; i++) {
            const k = i / 8;
            const x = f.x + (f.x2 - f.x) * k;
            const y = f.y + (f.y2 - f.y) * k;
            fx.burst(x, this.ground(x, y) + 22, y, i % 2 ? '#8a0f3a' : '#d01845', 3, { speed: 25, size: 2.4, life: 0.5, gravity: 0 });
          }
          snd('slime', f, { volume: 0.4, range: 600, rate: 0.6 });
          break;
        }
        case 'boom': {
          if (f.m === 'fireball') {
            // огненный шар: вспышка пламени без воронки
            snd('blast', f, { volume: 0.7, range: 1100, rate: 1.35 });
            fx.burst(f.x, gy + 14, f.y, '#ff8a2a', 34, { speed: 170, size: 4.5, life: 0.7, up: 1 });
            fx.burst(f.x, gy + 14, f.y, '#ffe066', 18, { speed: 120, size: 3.5, life: 0.45 });
            fx.burst(f.x, gy + 14, f.y, '#4a3a30', 14, { speed: 60, size: 6, life: 1.2, gravity: -40 });
            this.ring(f.x, f.y, '#ff9a3c', 75, 0.35);
            if (Math.hypot(f.x - myX, f.y - myY) < 250) this.shake = Math.max(this.shake, 3);
            break;
          }
          snd('blast', f, { volume: 0.95, range: 1600, rate: 0.9 });
          snd('rumble', f, { volume: 0.7, range: 1800 });
          snd('woodBreak', f, { volume: 0.5, range: 900, rate: 0.7 });
          fx.burst(f.x, gy + 10, f.y, '#ff8a2a', 45, { speed: 220, size: 5, life: 0.9 });
          fx.burst(f.x, gy + 10, f.y, '#ffe066', 20, { speed: 160, size: 4, life: 0.5 });
          fx.burst(f.x, gy + 10, f.y, '#3a3a3a', 30, { speed: 120, size: 7, life: 1.6, gravity: -30 });
          const d = Math.hypot(f.x - myX, f.y - myY);
          this.shake = Math.max(this.shake, Math.max(0, 16 - d / 30));
          const scorch = new THREE.Mesh(
            new THREE.CircleGeometry(45, 16),
            new THREE.MeshStandardMaterial({ color: '#1d1a18', roughness: 1, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4 }),
          );
          scorch.rotation.x = -Math.PI / 2;
          scorch.position.set(f.x, Math.max(gy, 0) + 1.2, f.y);
          this.scene.add(scorch);
          this.decals.push({ mesh: scorch, life: 60 });
          break;
        }
        default:
          break;
      }
    }
  }

  // расходящееся по земле кольцо: ЭМИ, телепорт, взрыв огненного шара
  ring(x, y, color, radius, life) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, Math.max(this.ground(x, y), 0) + 3, y);
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, life, radius });
  }

  // ---------- метка игрока: столб света, видный издалека, и кольцо на земле ----------
  setMarker(m) {
    if (!m) {
      if (this.markerView) {
        this.scene.remove(this.markerView.group);
        this.markerView = null;
      }
      return;
    }
    if (!this.markerView) {
      const group = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(9, 14, 1400, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ff7a3c', transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      beam.position.y = 700;
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(2.5, 2.5, 1400, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffd9a8', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      core.position.y = 700;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(16, 22, 40),
        new THREE.MeshBasicMaterial({ color: '#ff7a3c', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 2;
      group.add(beam, core, ring);
      this.scene.add(group);
      this.markerView = { group, beam, ring };
    }
    this.markerView.x = m.x;
    this.markerView.y = m.y;
  }

  updateMarker() {
    const v = this.markerView;
    if (!v) return;
    v.group.position.set(v.x, Math.max(this.ground(v.x, v.y), 0), v.y);
    const p = (this.time * 0.8) % 1;
    v.ring.scale.setScalar(1 + p * 1.6);
    v.ring.material.opacity = 0.85 * (1 - p);
    v.beam.material.opacity = 0.26 + Math.sin(this.time * 2.4) * 0.06;
  }

  // ---------- метеорит ----------
  setMeteor(m) {
    if (!m) {
      if (this.meteorView) {
        this.scene.remove(this.meteorView.beam, this.meteorView.rock);
        this.meteorView = null;
      }
      return;
    }
    if (!this.meteorView) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(22, 22, 1800, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: '#b06bff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(26, 0),
        new THREE.MeshStandardMaterial({ color: '#3a2a20', emissive: '#ff6a1a', emissiveIntensity: 1.2, flatShading: true }),
      );
      rock.visible = false;
      this.scene.add(beam, rock);
      this.meteorView = { beam, rock };
    }
    Object.assign(this.meteorView, { x: m.x, y: m.y, s: m.s, at: performance.now() });
  }

  updateMeteor(dt) {
    const mv = this.meteorView;
    if (!mv) return;
    const gy = this.ground(mv.x, mv.y);
    mv.beam.position.set(mv.x, gy + 900, mv.y);
    if (mv.s >= 0) {
      const left = mv.s - (performance.now() - mv.at) / 1000;
      mv.beam.material.opacity = 0.2 + Math.sin(this.time * 6) * 0.08;
      if (left < 3 && left > 0) {
        const k = 1 - left / 3;
        mv.rock.visible = true;
        mv.rock.position.set(mv.x + 900 * (1 - k), gy + 1800 * (1 - k) + 10, mv.y - 600 * (1 - k));
        mv.rock.rotation.x += dt * 4;
        this.effects.burst(mv.rock.position.x, mv.rock.position.y, mv.rock.position.z, '#ff8a2a', 3, { speed: 30, size: 6, life: 0.8, gravity: 0 });
      } else mv.rock.visible = false;
    } else {
      mv.rock.visible = false;
      mv.beam.material.opacity = 0.09 + Math.sin(this.time * 2) * 0.03;
    }
  }

  meteorImpact(x, y, myX, myY) {
    const gy = this.ground(x, y);
    const fx = this.effects;
    fx.burst(x, gy + 10, y, '#ff8a2a', 60, { speed: 260, size: 6, life: 1.4 });
    fx.burst(x, gy + 10, y, '#b06bff', 40, { speed: 200, size: 5, life: 1.6 });
    fx.burst(x, gy + 10, y, '#4a3a2a', 50, { speed: 180, size: 7, life: 1.8 });
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(95, 24),
      new THREE.MeshStandardMaterial({ color: '#1d1820', roughness: 1, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.set(x, Math.max(gy, 0) + 1.5, y);
    this.scene.add(scorch);
    this.decals.push({ mesh: scorch, life: 240 });
    const d = Math.hypot(x - myX, y - myY);
    this.shake = Math.max(this.shake, Math.max(0, 28 - d / 40));
  }

  // ---------- постройка: призрак и выбор точки прицелом ----------
  // color — оттенок призрака и рамки клетки; grid — показывать ли сетку вокруг;
  // solid — подсветка уже стоящей постройки (ремонт, снос): чуть крупнее её самой
  setGhost(kind, x, y, color = '#6fff8a', { grid = true, solid = false } = {}) {
    if (!kind) {
      this.ghost.visible = false;
      this.cellFrame.visible = false;
      this.buildGrid.visible = false;
      return;
    }
    if (this.ghost.userData.kind !== kind) {
      this.ghost.geometry = this.statics.sGeo[kind];
      this.ghost.userData.kind = kind;
    }
    this.ghost.position.set(x, this.ground(x, y) + 0.5, y);
    this.ghost.rotation.y = kind === 'door' ? this.statics.doorRotation({ x, y }) : 0;
    this.ghost.scale.setScalar(solid ? 1.05 : 1);
    this.ghost.material.color.set(color);
    this.ghost.material.opacity = (solid ? 0.42 : 0.5) + Math.sin(this.time * 5) * 0.08;
    this.ghost.visible = true;
    this.cellFrame.material.color.set(color);
    this.cellFrame.visible = true;
    this.buildGrid.visible = grid;
    const key = `${x},${y}`;
    if (this.gridCell === key) return;
    this.gridCell = key;
    // линии идут по рельефу: каждая сторона клетки — два отрезка через середину
    const H = TILE / 2;
    const gy = (px, py) => Math.max(this.ground(px, py), 0) + 1.2;
    const line = (out, x0, y0, x1, y1) => {
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      out.push(x0, gy(x0, y0), y0, mx, gy(mx, my), my, mx, gy(mx, my), my, x1, gy(x1, y1), y1);
    };
    const frame = [];
    line(frame, x - H, y - H, x + H, y - H);
    line(frame, x + H, y - H, x + H, y + H);
    line(frame, x + H, y + H, x - H, y + H);
    line(frame, x - H, y + H, x - H, y - H);
    this.cellFrame.geometry.setAttribute('position', new THREE.Float32BufferAttribute(frame, 3));
    const N = 4; // клеток сетки в каждую сторону
    const pos = [];
    const col = [];
    const fade = (px, py) => Math.max(0, 1 - Math.hypot(px - x, py - y) / ((N + 0.5) * TILE)) ** 1.5;
    const add = (x0, y0, x1, y1) => {
      const n = pos.length;
      line(pos, x0, y0, x1, y1);
      for (let i = n; i < pos.length; i += 3) {
        const f = fade(pos[i], pos[i + 2]);
        col.push(0.55 * f, 0.95 * f, 0.62 * f);
      }
    };
    for (let i = -N; i <= N + 1; i++) {
      for (let j = -N; j <= N; j++) {
        add(x - H + i * TILE, y - H + j * TILE, x - H + i * TILE, y + H + j * TILE);
        add(x - H + j * TILE, y - H + i * TILE, x + H + j * TILE, y - H + i * TILE);
      }
    }
    this.buildGrid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.buildGrid.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  // Иконки построек для меню стройки: настоящие модели, снятые маленькой камерой. { вид: dataURL }
  structureIcons(kinds, size = 112) {
    const px = size * 2; // рисуем вдвое крупнее и уменьшаем — так края гладкие
    const rt = new THREE.WebGLRenderTarget(px, px);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#5a6a58', 2.4));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.6);
    sun.position.set(60, 120, 80);
    scene.add(sun);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.statics.sMat);
    scene.add(mesh);
    const cam = new THREE.PerspectiveCamera(30, 1, 1, 2000);
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const buf = new Uint8Array(px * px * 4);
    const big = document.createElement('canvas');
    big.width = big.height = px;
    const bg = big.getContext('2d');
    const out = {};
    const box = new THREE.Box3();
    for (const kind of kinds) {
      const geo = this.statics.sGeo[kind];
      if (!geo) continue;
      mesh.geometry = geo;
      geo.computeBoundingBox();
      box.copy(geo.boundingBox);
      const c = box.getCenter(_v);
      const rad = box.getSize(_v2).length() / 2;
      const d = rad / Math.sin((cam.fov * Math.PI) / 360) * 1.02;
      cam.position.set(c.x + d * 0.62, c.y + d * 0.5, c.z + d * 0.6);
      cam.lookAt(c);
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, px, px, buf);
      const img = bg.createImageData(px, px);
      for (let y = 0; y < px; y++) {
        const src = (px - 1 - y) * px * 4; // картинка в памяти видеокарты перевёрнута
        const dst = y * px * 4;
        for (let x = 0; x < px * 4; x += 4) {
          const a = buf[src + x + 3];
          // линейный цвет → sRGB
          img.data[dst + x] = Math.round(255 * Math.pow(buf[src + x] / 255, 1 / 2.2));
          img.data[dst + x + 1] = Math.round(255 * Math.pow(buf[src + x + 1] / 255, 1 / 2.2));
          img.data[dst + x + 2] = Math.round(255 * Math.pow(buf[src + x + 2] / 255, 1 / 2.2));
          img.data[dst + x + 3] = a;
        }
      }
      bg.putImageData(img, 0, 0);
      const small = document.createElement('canvas');
      small.width = small.height = size;
      const sg = small.getContext('2d');
      sg.imageSmoothingQuality = 'high';
      sg.drawImage(big, 0, 0, size, size);
      out[kind] = small.toDataURL('image/png');
    }
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    rt.dispose();
    return out;
  }

  // Точка на земле (или воде) под экранной точкой — луч из камеры через курсор.
  // Если луч уходит в небо, возвращает null, а горизонтальное направление луча лежит в this.rayDir.
  pickAt(cx, cy, maxDist = 2500) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dir = _v.set((cx / w) * 2 - 1, -(cy / h) * 2 + 1, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    this.rayDir.copy(dir);
    const p = _v2.copy(this.camera.position);
    const surf = (q) => Math.max(this.ground(q.x, q.z), 0);
    let step = 4;
    for (let d = 0; d < maxDist; d += step) {
      p.addScaledVector(dir, step);
      if (p.y <= surf(p)) {
        // уточняем точку пересечения делением отрезка пополам
        let lo = -step;
        let hi = 0;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          _v3.copy(p).addScaledVector(dir, mid);
          if (_v3.y <= surf(_v3)) hi = mid;
          else lo = mid;
        }
        p.addScaledVector(dir, hi);
        return { x: p.x, y: p.z };
      }
      step = Math.min(16, step * 1.04);
    }
    return null;
  }

  // кольцо на земле в точке прицела; lock — прицел наведён на цель (кольцо краснеет)
  setAim(p, show, lock = false) {
    const g = this.aimGroup;
    g.visible = !!(show && p);
    if (!g.visible) return;
    g.position.set(p.x, Math.max(this.ground(p.x, p.y), 0) + 1, p.y);
    // вдали кольцо росло бы медленнее перспективы и тонуло в тумане — держим его читаемым
    g.scale.setScalar(Math.max(1, this.camera.position.distanceTo(g.position) / 280) * (lock ? 1.25 : 1));
    this.aimMat.color.copy(lock ? this.mark.color : _white); // цвет цели: красный — враг, янтарный — дичь
  }

  // Существо под курсором: луч из камеры через курсор против вертикального отрезка каждого существа
  // (само тело, а не только точка земли под ним). Если луч прошёл мимо, но точка земли под курсором
  // рядом с ногами — тоже считается. aim — точка земли под курсором; active — можно ли целиться.
  // Цель держится ещё ~0.2 с после ухода курсора, чтобы выделение не мигало на краю модели.
  updateTarget(cx, cy, aim, active, dt) {
    let best = null;
    if (active) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const o = this.camera.position;
      const dir = _v.set((cx / w) * 2 - 1, -(cy / h) * 2 + 1, 0.5).unproject(this.camera).sub(o).normalize();
      const far = this.scene.fog.far * 0.95;
      // расстояние до земли под курсором: цель дальше неё скрыта холмом, её не выделяем
      // (если луч уходит в небо, закрыть цель нечему)
      const groundD = aim && !aim.sky ? o.distanceTo(_v3.set(aim.x, Math.max(this.ground(aim.x, aim.y), 0), aim.y)) : Infinity;
      let bt = Infinity;
      for (const v of this.ents.values()) {
        const e = v.e;
        if (!e || v.isMe || e.dd) continue;
        const cr = v.creature;
        const top = Math.max(20, (cr.labelHeight ?? cr.tpl.hb * 2) - 6);
        const bottom = (v.cy ?? v.gy) + (v.hop || 0); // в прыжке цель выше земли
        for (let i = 0; i < 5; i++) {
          _v2.set(v.x, bottom + (top * i) / 4, v.y).sub(o);
          const t = _v2.dot(dir);
          if (t < 0 || t > far || t >= bt || t > groundD + 30) continue;
          const rad = cr.R * 0.9 + 7 + t * 0.006; // чем дальше цель, тем щедрее попадание
          if (_v2.lengthSq() - t * t <= rad * rad) {
            bt = t;
            best = v;
          }
        }
      }
      if (!best && aim && !aim.sky) {
        let bd = Infinity;
        for (const v of this.ents.values()) {
          if (!v.e || v.isMe || v.e.dd) continue;
          const d = Math.hypot(v.x - aim.x, v.y - aim.y);
          if (d < v.creature.R + 10 && d < bd && groundD <= far) {
            bd = d;
            best = v;
          }
        }
      }
    }
    if (best) {
      this.lockV = best;
      this.lockT = 0.2;
    } else if (this.lockV && (this.lockT -= dt) <= 0) this.lockV = null;
    const v = this.lockV && this.lockV.e && !this.lockV.e.dd && this.ents.get(this.lockV.e.i) === this.lockV && active ? this.lockV : null;
    if (!v) this.lockV = null;
    const e = v?.e;
    const beh = e && e.k !== 'p' ? NPCS[e.t]?.behavior : null;
    this.mark.set(v, beh === 'passive' || beh === 'guide' ? 'prey' : 'hostile');
    return v;
  }

  // круг радиуса стройки вокруг игрока
  setBuildRange(x, y, show) {
    this.rangeRing.visible = !!show;
    if (show) this.rangeRing.position.set(x, Math.max(this.ground(x, y), 0) + 1, y);
  }

  // ---------- кадр ----------
  updateCamera(x, y, hb, cam, dt, z = 0) {
    // высота цели сглажена: иначе камера подпрыгивает на каждой кочке рельефа
    const rawY = this.standY(x, y, hb) + hb + 18 + z; // z — высота над землёй: на валуне камера поднимается
    if (this.camY === undefined || Math.abs(rawY - this.camY) > 120) this.camY = rawY;
    else this.camY += (rawY - this.camY) * (1 - Math.exp(-dt * 6));
    const ty = this.camY;
    this.camTarget.set(x, ty, y);
    const cp = Math.cos(cam.pitch);
    const c = this.camera.position;
    c.set(x - Math.cos(cam.yaw) * cp * cam.dist, ty + Math.sin(cam.pitch) * cam.dist, y - Math.sin(cam.yaw) * cp * cam.dist);
    // камера не уходит под землю; «пол» под ней тоже сглажен
    const rawFloor = Math.max(this.ground(c.x, c.z), 0) + 10;
    if (this.camFloor === undefined || Math.abs(rawFloor - this.camFloor) > 120) this.camFloor = rawFloor;
    else this.camFloor += (rawFloor - this.camFloor) * (1 - Math.exp(-dt * 8));
    if (c.y < this.camFloor) c.y = this.camFloor;
    // тряска — плавные колебания, а не случайный скачок каждый кадр
    if (this.shake > 0.05) {
      const t = this.time * 1;
      const s = this.shake * 0.5;
      c.x += Math.sin(t * 47) * s;
      c.y += Math.sin(t * 53 + 1.3) * s;
      c.z += Math.sin(t * 59 + 2.1) * s;
      this.shake *= Math.exp(-dt * 9);
    } else this.shake = 0;
    this.camera.lookAt(this.camTarget);
    this.camera.updateMatrixWorld(); // нужно для луча из курсора в этом же кадре
  }

  render(dt, phase, view) {
    this.time += dt;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const env = this.sky.update(phase, this.camTarget, view, this.camera.position.distanceTo(this.camTarget));
    this.night = 1 - env.k;
    this.terrain.waterSky = { sky: this.sky, light: env.k };
    // сколько видно вокруг персонажа (не зависит от отдаления камеры)
    this.decor.update(this.camTarget, env.far);
    this.terrain.update(this.time, this.camTarget, env.far);
    this.zonesView.update(dt, this.camTarget, env.far);
    this.cityView.update(this.camTarget, env.far);
    this.snow.update(dt, this.time, this.terrain.winterAt(this.camTarget.x, this.camTarget.z), this.camTarget);
    this.statics.update(dt, this.camera.position, this.night, this.camTarget);
    this.updateMeteor(dt);
    this.updateMarker();
    for (const dcl of this.decals) {
      dcl.life -= dt;
      if (dcl.life < 20) dcl.mesh.material.opacity = Math.max(0, dcl.life / 20) * 0.9;
      if (dcl.life <= 0) this.scene.remove(dcl.mesh);
    }
    this.decals = this.decals.filter((d) => d.life > 0);
    for (const r of this.rings) {
      r.t += dt;
      const k = Math.min(1, r.t / r.life);
      r.mesh.scale.setScalar(8 + (r.radius - 8) * (1 - (1 - k) * (1 - k)));
      r.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
      }
    }
    this.rings = this.rings.filter((r) => r.t < r.life);
    this.effects.update(dt, this.camera, w, h);
    this.mark.update(dt, this.camera, (x, z) => Math.max(this.ground(x, z), 0));
    this.visions.update(dt, this.hal.s, this.hal.t, this.camTarget, this.hal.trip);
    if (!this.visions.render()) this.renderer.render(this.scene, this.camera);
    this.updateLabels(w, h);
  }

  updateLabels(w, h) {
    const far = this.scene.fog.far * 0.9;
    for (const v of this.ents.values()) {
      const e = v.e;
      if (!e) continue;
      const damaged = e.h < e.mh;
      const targeted = this.mark.v === v; // цель под прицелом: имя и полоска здоровья видны всегда
      const show = targeted || (!v.isMe && (e.k === 'p' || damaged || NPCS[e.t]?.behavior === 'territorial'));
      if (v.targeted !== targeted) {
        v.targeted = targeted;
        v.label.classList.toggle('target', targeted);
        if (targeted) v.label.dataset.kind = this.mark.kind;
      }
      if (!show) {
        if (v.label.style.display !== 'none') v.label.style.display = 'none';
        continue;
      }
      _v.set(v.x, v.gy + (v.hop || 0) + (v.creature.labelHeight ?? v.creature.tpl.hb + v.creature.R * 1.3) + 10, v.y);
      const dist = _v.distanceTo(this.camera.position);
      _v.project(this.camera);
      if (_v.z > 1 || dist > far) {
        v.label.style.display = 'none';
        continue;
      }
      v.label.style.display = '';
      v.label.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      // игрок: друг — голубым с рукопожатием, говорящий в микрофон — со значком
      if (e.k === 'p') {
        const tag = `${this.friends?.has(e.u) ? 'f' : ''}${e.tk ? 't' : ''}`;
        if (v.tag !== tag) {
          v.tag = tag;
          const friend = tag.includes('f');
          v.nm.textContent = `${friend ? '🤝 ' : ''}${e.n}${e.tk ? ' 🔊' : ''}`;
          v.nm.style.color = friend ? '#7fe0ff' : '#ffffff';
        }
      }
      v.hpBar.style.display = damaged || targeted ? '' : 'none';
      if (e.h !== v.lastHp) {
        v.lastHp = e.h;
        v.hpFill.style.width = `${Math.max(0, Math.round((e.h / e.mh) * 100))}%`;
      }
    }
  }
}
