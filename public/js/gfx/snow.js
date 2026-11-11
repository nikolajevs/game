// Снегопад зимнего биома: хлопья падают в объёме вокруг камеры и появляются, только когда игрок в снегах.
import * as THREE from 'three';
import { glowTexture } from './util.js';

const N = 900;
const BOX = 900; // сторона объёма со снегом
const TOP = 420;

export class Snowfall {
  constructor(scene) {
    this.k = 0; // 0 — снега нет, 1 — идёт в полную силу
    this.flakes = [];
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.flakes.push({ x: (Math.random() - 0.5) * BOX, y: Math.random() * TOP, z: (Math.random() - 0.5) * BOX, v: 38 + Math.random() * 40, w: Math.random() * 6.28 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 4.2, map: glowTexture(), color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  // cold — стоит ли игрок в зимнем биоме; target — точка, вокруг которой идёт снег
  update(dt, t, cold, target) {
    this.k += ((cold ? 1 : 0) - this.k) * (1 - Math.exp(-dt * 0.9));
    this.points.visible = this.k > 0.02;
    if (!this.points.visible) return;
    this.points.material.opacity = this.k * 0.9;
    const a = this.points.geometry.attributes.position;
    const half = BOX / 2;
    for (let i = 0; i < N; i++) {
      const f = this.flakes[i];
      f.y -= f.v * dt;
      f.x += (Math.sin(t * 0.7 + f.w) * 14 + 22) * dt; // ветер несёт хлопья вбок
      f.z += Math.cos(t * 0.5 + f.w) * 10 * dt;
      if (f.y < -20) f.y += TOP;
      if (f.x > half) f.x -= BOX;
      if (f.z > half) f.z -= BOX;
      else if (f.z < -half) f.z += BOX;
      a.array[i * 3] = target.x + f.x;
      a.array[i * 3 + 1] = target.y - 60 + f.y;
      a.array[i * 3 + 2] = target.z + f.z;
    }
    a.needsUpdate = true;
  }
}
