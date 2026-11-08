// Облик радиационных зон: руины, бочки, знаки, разрушенный реактор и парящие частицы.
// Всё декоративное: сервер про эти обломки не знает и сквозь них можно пройти.
import * as THREE from 'three';
import { G, M, mergeParts, rng, glowTexture } from './util.js';

const CONCRETE = ['#9a968c', '#85827a', '#a8a397', '#77746d'];
const MOTES_PER_ZONE = 220;

export class ZonesView {
  constructor(scene, terrain, zones) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.terrain = terrain;
    this.zones = zones;
    this.items = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    const moteMat = new THREE.PointsMaterial({
      color: '#a8ff5a', size: 3.2, sizeAttenuation: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(),
    });
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#8dff5a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
    for (const z of zones) {
      const r = rng(((z.x * 0.0137 + z.y * 0.0071) % 1 + 1) % 1);
      const parts = [];
      const gy = (x, y) => Math.max(terrain.heightAt(x, y), 0);
      const at = (rad, ang) => [z.x + Math.cos(ang) * rad, z.y + Math.sin(ang) * rad];

      // разрушенный реактор в центре
      {
        const cy = gy(z.x, z.y);
        for (let i = 0; i < 3; i++) {
          const h = 18 - i * 3;
          parts.push({ geom: G.cyl, matrix: M(z.x, cy + i * 16 + h / 2 - 2, z.y, 0, r() * 3, (r() - 0.5) * 0.08, 40 - i * 7, h, 40 - i * 7), color: CONCRETE[i % 4] });
        }
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          parts.push({ geom: G.box, matrix: M(z.x + Math.cos(a) * 30, cy + 46 + r() * 10, z.y + Math.sin(a) * 30, 0, a, 0.2, 9, 14 + r() * 14, 5), color: CONCRETE[(i + 1) % 4] });
        }
        const glow = new THREE.Sprite(glowMat);
        glow.scale.setScalar(140);
        glow.position.set(z.x, cy + 50, z.y);
        this.group.add(glow);
      }

      // обломки стен с арматурой
      const walls = 7 + Math.floor(r() * 5);
      for (let i = 0; i < walls; i++) {
        const [x, y] = at(z.r * (0.3 + r() * 0.55), r() * Math.PI * 2);
        const g0 = gy(x, y);
        const rot = r() * Math.PI;
        const len = 30 + r() * 40;
        const col = CONCRETE[Math.floor(r() * 4)];
        let h0 = 0;
        for (let k = 0; k < 3; k++) {
          const h = 10 + r() * 12;
          const l = len * (1 - k * 0.28) * (0.8 + r() * 0.3);
          const off = (r() - 0.5) * len * 0.3;
          parts.push({ geom: G.box, matrix: M(x + Math.cos(rot) * off, g0 + h0 + h / 2 - 3, y + Math.sin(rot) * off, 0, -rot, (r() - 0.5) * 0.12, l, h, 5), color: col });
          h0 += h;
        }
        for (let k = 0; k < 3; k++) {
          const off = (r() - 0.5) * len * 0.5;
          parts.push({ geom: G.cyl6, matrix: M(x + Math.cos(rot) * off, g0 + h0 + 4, y + Math.sin(rot) * off, (r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6, 0.6, 12, 0.6), color: '#7a4a2a' });
        }
      }

      // бочки с отходами
      const barrels = 6 + Math.floor(r() * 5);
      for (let i = 0; i < barrels; i++) {
        const [x, y] = at(z.r * (0.15 + r() * 0.7), r() * Math.PI * 2);
        const g0 = gy(x, y);
        const tipped = r() < 0.35;
        const col = r() < 0.7 ? '#c9a227' : '#4a6b3a';
        parts.push({ geom: G.cyl, matrix: M(x, g0 + (tipped ? 6 : 9), y, tipped ? Math.PI / 2 : 0, r() * 3, 0, 6, 18, 6), color: col });
        parts.push({ geom: G.cyl, matrix: M(x, g0 + (tipped ? 6 : 9), y, tipped ? Math.PI / 2 : 0, r() * 3, 0, 6.2, 3, 6.2), color: '#2b2b2e' });
        if (r() < 0.5) parts.push({ geom: G.cyl, matrix: M(x + 10, g0 + 0.6, y + 6, 0, 0, 0, 12 + r() * 8, 1, 12 + r() * 8), color: '#7dd63a' }); // лужа
      }

      // крупные обломки
      for (let i = 0; i < 18; i++) {
        const [x, y] = at(z.r * r() * 0.9, r() * Math.PI * 2);
        const s = 3 + r() * 6;
        parts.push({ geom: G.dodeca, matrix: M(x, gy(x, y) + s * 0.4, y, r() * 3, r() * 3, r() * 3, s * (1 + r()), s, s), color: CONCRETE[Math.floor(r() * 4)] });
      }

      // знаки радиации по краю зоны
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + r() * 0.3;
        const [x, y] = at(z.r * 0.97, a);
        const g0 = gy(x, y);
        parts.push({ geom: G.cyl6, matrix: M(x, g0 + 14, y, 0, 0, 0, 1.2, 28, 1.2), color: '#5e5e64' });
        parts.push({ geom: G.box, matrix: M(x, g0 + 30, y, 0, -a + Math.PI / 2, 0, 16, 12, 1), color: '#e8c22a' });
        parts.push({ geom: G.cyl6, matrix: M(x, g0 + 30, y, Math.PI / 2, 0, -a, 3.2, 1.4, 3.2), color: '#1d1d1f' });
      }

      const mesh = new THREE.Mesh(mergeParts(parts), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // парящие частицы
      const pos = new Float32Array(MOTES_PER_ZONE * 3);
      const base = new Float32Array(MOTES_PER_ZONE);
      for (let i = 0; i < MOTES_PER_ZONE; i++) {
        const [x, y] = at(Math.sqrt(r()) * z.r, r() * Math.PI * 2);
        base[i] = gy(x, y);
        pos[i * 3] = x;
        pos[i * 3 + 1] = base[i] + r() * 70;
        pos[i * 3 + 2] = y;
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const points = new THREE.Points(pg, moteMat);
      points.frustumCulled = false;
      this.group.add(points);
      this.items.push({ z, mesh, points, base });
    }
  }

  update(dt, target, far) {
    for (const it of this.items) {
      const d = Math.hypot(it.z.x - target.x, it.z.y - target.z) - it.z.r;
      const vis = d < far + 200;
      it.mesh.visible = vis;
      it.points.visible = vis;
      if (!vis) continue;
      // частицы медленно поднимаются и начинают заново у земли
      const a = it.points.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        let y = a.array[i * 3 + 1] + dt * (6 + (i % 5) * 2);
        if (y > it.base[i] + 75) y = it.base[i] + 2;
        a.array[i * 3 + 1] = y;
      }
      a.needsUpdate = true;
    }
  }
}
