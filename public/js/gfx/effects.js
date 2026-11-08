// Частицы (один InstancedMesh) и всплывающие цифры урона/добычи (DOM).
import * as THREE from 'three';
import { G } from './util.js';

const MAX = 900;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class Effects {
  constructor(scene, floatersEl) {
    this.mesh = new THREE.InstancedMesh(G.ico, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set('#ffffff'));
    scene.add(this.mesh);
    this.p = [];
    this.floatersEl = floatersEl;
    this.texts = [];
    this.pool = [];
  }

  // n частиц цвета color из точки (x, y, z)
  burst(x, y, z, color, n = 10, { speed = 80, size = 2.5, life = 0.7, gravity = 220, up = 0.6 } = {}) {
    _c.set(color);
    for (let i = 0; i < n && this.p.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.p.push({
        x, y, z,
        vx: Math.cos(a) * s, vy: (up + Math.random() * 0.8) * s, vz: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.6 + Math.random() * 0.8), gravity,
        r: _c.r, g: _c.g, b: _c.b, spin: Math.random() * 6,
      });
    }
  }

  text(x, y, z, str, color = '#fff', cls = '') {
    const el = this.pool.pop() || document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = str;
    el.style.color = color;
    el.style.opacity = '1';
    this.floatersEl.appendChild(el);
    this.texts.push({ el, x: x + (Math.random() - 0.5) * 10, y, z: z + (Math.random() - 0.5) * 10, life: 1.1, max: 1.1 });
  }

  update(dt, camera, w, h) {
    let n = 0;
    const arr = this.p;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < -60) continue;
      p.spin += dt * 8;
      const k = Math.min(1, p.life / (p.max * 0.5));
      _p.set(p.x, p.y, p.z);
      _q.setFromAxisAngle(_v.set(0.3, 1, 0.2).normalize(), p.spin);
      _s.setScalar(p.size * k);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c.setRGB(p.r, p.g, p.b));
      arr[n++] = p;
    }
    arr.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // всплывающие надписи
    const keep = [];
    for (const t of this.texts) {
      t.life -= dt;
      if (t.life <= 0) {
        t.el.remove();
        this.pool.push(t.el);
        continue;
      }
      const age = t.max - t.life;
      _v.set(t.x, t.y + 18 + age * 40, t.z).project(camera);
      if (_v.z > 1) {
        t.el.style.opacity = '0';
      } else {
        t.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.2 - age) * 2})`;
        t.el.style.opacity = String(Math.min(1, t.life * 2.5));
      }
      keep.push(t);
    }
    this.texts = keep;
  }
}
