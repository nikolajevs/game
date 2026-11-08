// 3D-сцена игры: рельеф, объекты, существа с сервера, эффекты, камера.
import * as THREE from 'three';
import { NPCS } from '/shared/config.js';
import { Terrain } from './gfx/terrain.js';
import { Sky } from './gfx/sky.js';
import { StaticsView } from './gfx/statics3d.js';
import { Creature3D } from './gfx/creature3d.js';
import { Effects } from './gfx/effects.js';
import { Decor } from './gfx/decor.js';
import { G } from './gfx/util.js';

const HIT_COLORS = {
  tree: ['#6b4423', '#4f8a3a'], rock: ['#8a8a85', '#6e6e68'], bush: ['#3f7d3a', '#c8324b'],
  crystal: ['#b06bff', '#e6d3ff'], wood: ['#8b5a2b', '#5a3a1c'], stone: ['#8e8f8a', '#6e6e68'],
};
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class WorldView {
  constructor(canvas, labelsEl, floatersEl) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.projMat = new THREE.MeshStandardMaterial({ color: '#8dff5a', emissive: '#3fd400', emissiveIntensity: 1, roughness: 0.3 });
    this.bubbleMat = new THREE.MeshBasicMaterial({ color: '#9cf0a4', transparent: true, opacity: 0.16, depthWrite: false });
  }

  init(tiles, seed, myUid) {
    this.terrain = new Terrain(tiles, seed);
    this.scene.add(this.terrain.group);
    this.decor = new Decor(this.terrain, tiles, seed);
    this.scene.add(this.decor.group);
    this.statics = new StaticsView(this.scene, this.terrain);
    this.statics.myUid = myUid;
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#6fff8a', transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    this.scene.add(this.ghost);
  }

  ground(x, y) {
    return this.terrain.heightAt(x, y);
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
    const v = { creature, look: e.g, color: e.c, px: e.x, py: e.y, speed: 0, at: 0, hf: 0, label: null, hpFill: null, lastHp: -1 };
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
          m = new THREE.Mesh(G.sphere, this.projMat);
          m.scale.setScalar(6);
          this.scene.add(m);
          this.projs.set(e.i, m);
        }
        m.position.set(e.x, this.standY(e.x, e.y, 20) + 18, e.y);
        if (Math.random() < 0.5) this.effects.burst(e.x, m.position.y, e.y, '#8dff5a', 1, { speed: 15, size: 1.6, life: 0.35, gravity: 0 });
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
      if (e.at && !v.at) v.creature.attack();
      v.at = e.at;
      if (e.hf && !v.hf) v.creature.hit();
      v.hf = e.hf;
      const gy = this.standY(x, y, v.creature.tpl.hb);
      v.creature.group.position.set(x, gy, y);
      v.creature.group.rotation.y = -a;
      v.creature.update(dt, { speed: v.speed, charging: !!e.ch, night: this.night });
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
  handleFx(list, myX, myY) {
    const fx = this.effects;
    for (const f of list) {
      const gy = this.ground(f.x, f.y);
      switch (f.k) {
        case 'dmg':
          fx.text(f.x, gy + 34, f.y, `-${f.n}`, f.c);
          fx.burst(f.x, gy + 20, f.y, '#c0392b', 6, { speed: 70 });
          break;
        case 'hit':
          for (const c of HIT_COLORS[f.m] || ['#cccccc']) fx.burst(f.x, gy + 18, f.y, c, 5, { speed: 70 });
          if (f.id) this.statics.hit(f.id);
          break;
        case 'gain':
          fx.text(f.x, gy + 44, f.y, f.text, '#c8f7c5', 'gain');
          break;
        case 'die':
          fx.burst(f.x, gy + 15, f.y, f.c || '#ffffff', 28, { speed: 130, size: 3.5, life: 1 });
          fx.burst(f.x, gy + 15, f.y, '#ffffff', 8, { speed: 90 });
          break;
        case 'evolve':
          fx.burst(f.x, gy + 10, f.y, '#b98cff', 34, { speed: 70, up: 1.6, gravity: 40, life: 1.4 });
          fx.burst(f.x, gy + 10, f.y, f.c || '#ffffff', 18, { speed: 50, up: 2, gravity: 30, life: 1.2 });
          break;
        case 'spit':
          fx.burst(f.x, gy + 18, f.y, '#8dff5a', 4, { speed: 40, size: 1.8 });
          break;
        case 'splash':
          fx.burst(f.x, gy + 15, f.y, '#8dff5a', 14, { speed: 90, size: 2.2 });
          break;
        case 'thud':
          fx.burst(f.x, gy + 8, f.y, '#b5a585', 16, { speed: 100, size: 3 });
          if (Math.hypot(f.x - myX, f.y - myY) < 300) this.shake = Math.max(this.shake, 4);
          break;
        case 'break':
          for (const c of HIT_COLORS[f.m] || ['#cccccc']) fx.burst(f.x, gy + 20, f.y, c, 18, { speed: 150, size: 4, life: 1.1 });
          break;
        case 'meteor':
          this.meteorImpact(f.x, f.y, myX, myY);
          break;
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

  // точка на земле под прицелом (центр экрана)
  groundPick(maxDist = 1400) {
    const dir = _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const p = _v2.copy(this.camera.position);
    let step = 4;
    for (let d = 0; d < maxDist; d += step) {
      p.addScaledVector(dir, step);
      if (p.y <= Math.max(this.ground(p.x, p.z), 0)) return { x: p.x, y: p.z };
      step = Math.min(14, step * 1.04);
    }
    return null;
  }

  // ---------- кадр ----------
  updateCamera(x, y, hb, cam, dt) {
    const ty = this.standY(x, y, hb) + hb + 18;
    this.camTarget.set(x, ty, y);
    const cp = Math.cos(cam.pitch);
    const c = this.camera.position;
    c.set(x - Math.cos(cam.yaw) * cp * cam.dist, ty + Math.sin(cam.pitch) * cam.dist, y - Math.sin(cam.yaw) * cp * cam.dist);
    const minY = Math.max(this.ground(c.x, c.z), 0) + 10;
    if (c.y < minY) c.y = minY;
    if (this.shake > 0) {
      c.x += (Math.random() - 0.5) * this.shake;
      c.y += (Math.random() - 0.5) * this.shake;
      c.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 30);
    }
    this.camera.lookAt(this.camTarget);
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
    this.terrain.update(this.time);
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
