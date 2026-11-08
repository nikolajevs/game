// 3D-сцена игры: рельеф, объекты, существа с сервера, эффекты, камера.
import * as THREE from 'three';
import { MAP_H, MAP_W, NPCS, PLAYER, T, TILE } from '/shared/config.js';
import { Terrain } from './gfx/terrain.js';
import { Sky } from './gfx/sky.js';
import { StaticsView } from './gfx/statics3d.js';
import { Creature3D } from './gfx/creature3d.js';
import { Effects } from './gfx/effects.js';
import { Decor } from './gfx/decor.js';
import { ZonesView } from './gfx/zones3d.js';
import { G, M, mergeParts } from './gfx/util.js';

// след за снарядом: [цвет, вероятность частицы за кадр, размер]
const PROJ_TRAIL = { acid: ['#8dff5a', 0.5, 1.6], bomb: ['#ff8a2a', 0.8, 1.8], bullet: ['#ffe9a8', 0.6, 1.1] };
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
};

const HIT_COLORS = {
  tree: ['#6b4423', '#4f8a3a'], rock: ['#8a8a85', '#6e6e68'], bush: ['#3f7d3a', '#c8324b'],
  crystal: ['#b06bff', '#e6d3ff'], wood: ['#8b5a2b', '#5a3a1c'], stone: ['#8e8f8a', '#6e6e68'],
  sulfur: ['#d9c23a', '#8a8a85'], scrap: ['#8a5a3a', '#9a9a9a'],
};
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

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
  }

  init(tiles, seed, myUid, zones = []) {
    this.terrain = new Terrain(tiles, seed, zones);
    this.scene.add(this.terrain.group);
    this.zonesView = new ZonesView(this.scene, this.terrain, zones);
    this.decor = new Decor(this.terrain, tiles, seed);
    this.scene.add(this.decor.group);
    this.statics = new StaticsView(this.scene, this.terrain);
    this.statics.myUid = myUid;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#6fff8a', transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    this.scene.add(this.ghost);
    const ringMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(7, 10, 28), ringMat('#ffffff', 0.6));
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(PLAYER.buildRange - 2.5, PLAYER.buildRange, 72), ringMat('#9cf0a4', 0.35));
    for (const r of [this.aimRing, this.rangeRing]) {
      r.rotation.x = -Math.PI / 2;
      r.renderOrder = 10;
      r.visible = false;
      this.scene.add(r);
    }
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
    const mat = kind === 'acid' ? this.projMat : kind === 'bullet' ? this.bulletMat : this.projStdMat;
    return new THREE.Mesh(geo, mat);
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

  // ---------- существа ----------
  addEnt(e) {
    const creature = new Creature3D(e.g, e.c);
    this.scene.add(creature.group);
    const v = { creature, look: e.g, color: e.c, px: e.x, py: e.y, speed: 0, stepTimer: Math.random() * 0.25, at: 0, hf: 0, label: null, hpFill: null, lastHp: -1 };
    const el = document.createElement('div');
    el.className = 'label';
    const nm = document.createElement('span');
    if (e.k === 'p') {
      nm.textContent = e.n;
      nm.style.color = '#ffffff';
    } else {
      const def = NPCS[e.t];
      nm.textContent = def.name;
      nm.style.color = def.behavior === 'passive' ? '#e8e0c8' : '#ffb4a8';
    }
    el.appendChild(nm);
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

  removeEnt(id) {
    const v = this.ents.get(id);
    if (!v) return;
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
      if (v && (v.look !== e.g || v.color !== e.c)) {
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
        v.creature.attack(!!v.warning);
        this.audio?.playAt('swing', x, y, me.x, me.y, { volume: isMe ? 0.34 : 0.22, range: 650, yaw, rate: 0.94 });
      }
      if (warns && !v.warning) {
        const colossus = e.t === 'colossus';
        this.audio?.playAt('danger', x, y, me.x, me.y, {
          volume: colossus ? 0.48 : 0.34, range: colossus ? 900 : 700, yaw, rate: colossus ? 0.78 : 1.18,
        });
      }
      v.at = e.at;
      if (e.hf && !v.hf) v.creature.hit();
      v.hf = e.hf;
      v.warning = warns;
      const gy = this.standY(x, y, v.creature.tpl.hb);
      v.creature.group.position.set(x, gy, y);
      v.creature.group.rotation.y = -a;
      v.creature.setWeapon(e.k === 'p' ? e.w || null : null);
      v.creature.update(dt, { speed: v.speed, charging: !!e.ch, warning: warns, night: this.night });
      // шаги: звук по типу почвы
      if (v.speed > 34) {
        v.stepTimer -= dt;
        if (v.stepTimer <= 0) {
          const tx = Math.max(0, Math.min(MAP_W - 1, Math.floor(x / TILE)));
          const ty = Math.max(0, Math.min(MAP_H - 1, Math.floor(y / TILE)));
          const tile = this.terrain.tiles[ty * MAP_W + tx];
          const step = tile === T.ROCK ? 'stepRock' : tile === T.SAND ? 'stepSand' : 'stepGrass';
          this.audio?.playAt(step, x, y, me.x, me.y, { volume: isMe ? 0.52 : 0.26, range: 520, yaw, rate: v.speed > 135 ? 1.08 : 0.96 });
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
      v.e = e;
      v.x = x;
      v.y = y;
      v.gy = gy;
      v.isMe = isMe;
    }
    for (const id of [...this.ents.keys()]) if (!seen.has(id)) this.removeEnt(id);
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
        case 'dmg':
          snd('hit', f, { volume: 0.48, range: 620 });
          fx.text(f.x, gy + 34, f.y, `-${f.n}`, f.c);
          fx.burst(f.x, gy + 20, f.y, '#c0392b', 6, { speed: 70 });
          break;
        case 'hit': {
          const m = f.m;
          const sound = m === 'tree' || m === 'wood' ? 'woodHit'
            : m === 'rock' || m === 'stone' || m === 'sulfur' || m === 'scrap' ? 'stoneHit'
              : m === 'crystal' ? 'crystalHit' : 'softHit';
          snd(sound, f, { volume: 0.44, range: 620, rate: m === 'scrap' ? 1.25 : 1 });
          for (const c of HIT_COLORS[f.m] || ['#cccccc']) fx.burst(f.x, gy + 18, f.y, c, 5, { speed: 70 });
          if (f.id) this.statics.hit(f.id);
          break;
        }
        case 'gain': {
          const sound = f.text?.includes('🍖') ? 'bite' : f.text?.includes('💧') ? 'drink' : 'pickup';
          snd(sound, f, { volume: 0.36, range: 460, rate: sound === 'bite' ? 0.82 : sound === 'drink' ? 1.16 : 1 });
          fx.text(f.x, gy + 44, f.y, f.text, '#c8f7c5', 'gain');
          break;
        }
        case 'die':
          snd('softBreak', f, { volume: 0.52, range: 700 });
          fx.burst(f.x, gy + 15, f.y, f.c || '#ffffff', 28, { speed: 130, size: 3.5, life: 1 });
          fx.burst(f.x, gy + 15, f.y, '#ffffff', 8, { speed: 90 });
          break;
        case 'evolve':
          snd('evolve', f, { volume: 0.56, range: 700 });
          fx.burst(f.x, gy + 10, f.y, '#b98cff', 34, { speed: 70, up: 1.6, gravity: 40, life: 1.4 });
          fx.burst(f.x, gy + 10, f.y, f.c || '#ffffff', 18, { speed: 50, up: 2, gravity: 30, life: 1.2 });
          break;
        case 'spit':
          snd('swing', f, { volume: 0.24, range: 540, rate: 1.18 });
          fx.burst(f.x, gy + 18, f.y, '#8dff5a', 4, { speed: 40, size: 1.8 });
          break;
        case 'splash':
          snd('softHit', f, { volume: 0.4, range: 520, rate: 0.92 });
          fx.burst(f.x, gy + 15, f.y, '#8dff5a', 14, { speed: 90, size: 2.2 });
          break;
        case 'thud':
          snd('heavyHit', f, { volume: 0.62, range: 720 });
          fx.burst(f.x, gy + 8, f.y, '#b5a585', 16, { speed: 100, size: 3 });
          if (Math.hypot(f.x - myX, f.y - myY) < 300) this.shake = Math.max(this.shake, 4);
          break;
        case 'break':
          snd(f.m === 'wood' ? 'woodBreak' : f.m === 'stone' ? 'stoneHit' : 'softBreak', f, { volume: 0.62, range: 700 });
          for (const c of HIT_COLORS[f.m] || ['#cccccc']) fx.burst(f.x, gy + 20, f.y, c, 18, { speed: 150, size: 4, life: 1.1 });
          break;
        case 'meteor':
          snd('heavyHit', f, { volume: 0.74, range: 1150, rate: 0.74 });
          this.meteorImpact(f.x, f.y, myX, myY);
          break;
        case 'shot':
          // отдельных звуков выстрела нет: пуля — резкий тяжёлый удар, тетива и праща — свист
          if (f.m === 'bullet') snd('heavyHit', f, { volume: 0.7, range: 1000, rate: 1.45 });
          else if (f.m === 'bomb') snd('swing', f, { volume: 0.3, range: 600, rate: 0.8 });
          else snd('swing', f, { volume: 0.32, range: 650, rate: 1.3 });
          if (f.m === 'bullet') {
            fx.burst(f.x, gy + 18, f.y, '#ffe066', 6, { speed: 60, size: 2.2, life: 0.18, gravity: 0 });
            fx.burst(f.x, gy + 18, f.y, '#9a9a9a', 4, { speed: 25, size: 3, life: 0.6, gravity: -20 });
            if (Math.hypot(f.x - myX, f.y - myY) < 60) this.shake = Math.max(this.shake, 1.5);
          }
          break;
        case 'impact':
          snd('softHit', f, { volume: 0.32, range: 520, rate: f.m === 'bullet' ? 1.3 : 1 });
          fx.burst(f.x, gy + 16, f.y, f.m === 'bullet' ? '#ffd166' : '#b5a585', 5, { speed: 70, size: 1.8, life: 0.35 });
          break;
        case 'boom': {
          snd('heavyHit', f, { volume: 0.9, range: 1300, rate: 0.62 });
          snd('woodBreak', f, { volume: 0.6, range: 900, rate: 0.7 });
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
  setGhost(kind, x, y, valid) {
    if (!kind) {
      this.ghost.visible = false;
      return;
    }
    if (this.ghost.userData.kind !== kind) {
      this.ghost.geometry = this.statics.sGeo[kind];
      this.ghost.userData.kind = kind;
    }
    this.ghost.position.set(x, this.ground(x, y) + 0.5, y);
    this.ghost.rotation.y = kind === 'door' ? this.statics.doorRotation({ x, y }) : 0;
    this.ghost.material.color.set(valid ? '#6fff8a' : '#ff5d5d');
    this.ghost.visible = true;
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

  // кольцо на земле в точке прицела
  setAim(p, show) {
    this.aimRing.visible = !!(show && p);
    if (!this.aimRing.visible) return;
    this.aimRing.position.set(p.x, Math.max(this.ground(p.x, p.y), 0) + 1, p.y);
  }

  // круг радиуса стройки вокруг игрока
  setBuildRange(x, y, show) {
    this.rangeRing.visible = !!show;
    if (show) this.rangeRing.position.set(x, Math.max(this.ground(x, y), 0) + 1, y);
  }

  // ---------- кадр ----------
  updateCamera(x, y, hb, cam, dt) {
    // высота цели сглажена: иначе камера подпрыгивает на каждой кочке рельефа
    const rawY = this.standY(x, y, hb) + hb + 18;
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
    const env = this.sky.update(phase, this.camTarget, view);
    this.night = 1 - env.k;
    this.decor.update(this.camTarget, this.scene.fog.far);
    this.terrain.update(this.time, this.camTarget, this.scene.fog.far);
    this.zonesView.update(dt, this.camTarget, this.scene.fog.far);
    this.statics.update(dt, this.camera.position, this.night, this.camTarget);
    this.updateMeteor(dt);
    for (const dcl of this.decals) {
      dcl.life -= dt;
      if (dcl.life < 20) dcl.mesh.material.opacity = Math.max(0, dcl.life / 20) * 0.9;
      if (dcl.life <= 0) this.scene.remove(dcl.mesh);
    }
    this.decals = this.decals.filter((d) => d.life > 0);
    this.effects.update(dt, this.camera, w, h);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(w, h);
  }

  updateLabels(w, h) {
    const far = this.scene.fog.far * 0.9;
    for (const v of this.ents.values()) {
      const e = v.e;
      if (!e) continue;
      const damaged = e.h < e.mh;
      const show = !v.isMe && (e.k === 'p' || damaged || e.t === 'colossus');
      if (!show) {
        if (v.label.style.display !== 'none') v.label.style.display = 'none';
        continue;
      }
      _v.set(v.x, v.gy + v.creature.tpl.hb + v.creature.R * 1.3 + 10, v.y);
      const dist = _v.distanceTo(this.camera.position);
      _v.project(this.camera);
      if (_v.z > 1 || dist > far) {
        v.label.style.display = 'none';
        continue;
      }
      v.label.style.display = '';
      v.label.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      v.hpBar.style.display = damaged ? '' : 'none';
      if (e.h !== v.lastHp) {
        v.lastHp = e.h;
        v.hpFill.style.width = `${Math.max(0, Math.round((e.h / e.mh) * 100))}%`;
      }
    }
  }
}
