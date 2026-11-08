// Облик особых мест: радиоактивные руины, старые рудники и логова колоссов.
// Всё декоративное: сервер про эти обломки не знает и сквозь них можно пройти.
import * as THREE from 'three';
import { G, M, mergeParts, rng, glowTexture } from './util.js';

const CONCRETE = ['#9a968c', '#85827a', '#a8a397', '#77746d'];
const ROCKS = ['#6f6a62', '#7d776d', '#5e5a54'];
const WOOD = ['#6b4a2b', '#7a5532', '#5a3d22'];
const BONE = ['#e8dcc0', '#d8ccb0', '#cfc2a2'];
const MOTES = { ruins: 220, mine: 70, lair: 0, altar: 90 };
const MOSSY = ['#7d8a78', '#6f7a6a', '#8a9488'];
const _up = new THREE.Vector3(0, 1, 0);

// цилиндр-отрезок от a до b
function seg(parts, a, b, radius, color) {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(_up, d.normalize());
  parts.push({ geom: G.cyl6, matrix: new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(radius, len, radius)), color });
}

export class ZonesView {
  constructor(scene, terrain, zones) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.terrain = terrain;
    this.zones = zones;
    this.items = [];
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.moteMat = new THREE.PointsMaterial({
      color: '#a8ff5a', size: 3.2, sizeAttenuation: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(),
    });
    this.glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#8dff5a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
    this.altarMoteMat = new THREE.PointsMaterial({
      color: '#c77dff', size: 3.6, sizeAttenuation: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(),
    });
    this.runeMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#c77dff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 });
    this.lampMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb347', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
    this.built = new Map(); // id места -> его сетки (строятся, только когда место рядом)
    this.warm = true;
  }

  build(z) {
    const { terrain, mat, moteMat } = this;
    {
      const r = rng(((z.x * 0.0137 + z.y * 0.0071) % 1 + 1) % 1);
      const parts = [];
      const sprites = [];
      const gy = (x, y) => Math.max(terrain.heightAt(x, y), 0);
      const at = (rad, ang) => [z.x + Math.cos(ang) * rad, z.y + Math.sin(ang) * rad];
      const ctx = { z, r, parts, sprites, gy, at };
      if (z.kind === 'mine') this.buildMine(ctx);
      else if (z.kind === 'lair') this.buildLair(ctx);
      else if (z.kind === 'altar') this.buildAltar(ctx);
      else this.buildRuins(ctx);

      const mesh = new THREE.Mesh(mergeParts(parts), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const s of sprites) this.group.add(s);

      // парящие частицы радиации
      let points = null;
      let base = null;
      const motes = MOTES[z.kind] ?? 0;
      if (motes) {
        const pos = new Float32Array(motes * 3);
        base = new Float32Array(motes);
        for (let i = 0; i < motes; i++) {
          const [x, y] = at(Math.sqrt(r()) * z.r, r() * Math.PI * 2);
          base[i] = gy(x, y);
          pos[i * 3] = x;
          pos[i * 3 + 1] = base[i] + r() * 70;
          pos[i * 3 + 2] = y;
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        points = new THREE.Points(pg, z.kind === 'altar' ? this.altarMoteMat : moteMat);
        points.frustumCulled = false;
        this.group.add(points);
      }
      return { z, mesh, points, base, sprites };
    }
  }

  dispose(it) {
    this.group.remove(it.mesh);
    it.mesh.geometry.dispose();
    for (const s of it.sprites) this.group.remove(s);
    if (it.points) {
      this.group.remove(it.points);
      it.points.geometry.dispose();
    }
  }

  // ---------- радиоактивные руины ----------
  buildRuins({ z, r, parts, sprites, gy, at }) {
    // разрушенный реактор в центре
    const cy = gy(z.x, z.y);
    for (let i = 0; i < 3; i++) {
      const h = 18 - i * 3;
      parts.push({ geom: G.cyl, matrix: M(z.x, cy + i * 16 + h / 2 - 2, z.y, 0, r() * 3, (r() - 0.5) * 0.08, 40 - i * 7, h, 40 - i * 7), color: CONCRETE[i % 4] });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      parts.push({ geom: G.box, matrix: M(z.x + Math.cos(a) * 30, cy + 46 + r() * 10, z.y + Math.sin(a) * 30, 0, a, 0.2, 9, 14 + r() * 14, 5), color: CONCRETE[(i + 1) % 4] });
    }
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(140);
    glow.position.set(z.x, cy + 50, z.y);
    sprites.push(glow);

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
      this.barrel(parts, r, x, y, gy(x, y));
    }

    // крупные обломки
    for (let i = 0; i < 18; i++) {
      const [x, y] = at(z.r * r() * 0.9, r() * Math.PI * 2);
      const s = 3 + r() * 6;
      parts.push({ geom: G.dodeca, matrix: M(x, gy(x, y) + s * 0.4, y, r() * 3, r() * 3, r() * 3, s * (1 + r()), s, s), color: CONCRETE[Math.floor(r() * 4)] });
    }
    this.radSigns(parts, r, z, at, gy, 6);
  }

  barrel(parts, r, x, y, g0) {
    const tipped = r() < 0.35;
    const col = r() < 0.7 ? '#c9a227' : '#4a6b3a';
    parts.push({ geom: G.cyl, matrix: M(x, g0 + (tipped ? 6 : 9), y, tipped ? Math.PI / 2 : 0, r() * 3, 0, 6, 18, 6), color: col });
    parts.push({ geom: G.cyl, matrix: M(x, g0 + (tipped ? 6 : 9), y, tipped ? Math.PI / 2 : 0, r() * 3, 0, 6.2, 3, 6.2), color: '#2b2b2e' });
    if (r() < 0.5) parts.push({ geom: G.cyl, matrix: M(x + 10, g0 + 0.6, y + 6, 0, 0, 0, 12 + r() * 8, 1, 12 + r() * 8), color: '#7dd63a' }); // лужа
  }

  // знаки радиации по краю места
  radSigns(parts, r, z, at, gy, n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3;
      const [x, y] = at(z.r * 0.97, a);
      const g0 = gy(x, y);
      parts.push({ geom: G.cyl6, matrix: M(x, g0 + 14, y, 0, 0, 0, 1.2, 28, 1.2), color: '#5e5e64' });
      parts.push({ geom: G.box, matrix: M(x, g0 + 30, y, 0, -a + Math.PI / 2, 0, 16, 12, 1), color: '#e8c22a' });
      parts.push({ geom: G.cyl6, matrix: M(x, g0 + 30, y, Math.PI / 2, 0, -a, 3.2, 1.4, 3.2), color: '#1d1d1f' });
    }
  }

  // ---------- старый рудник ----------
  // Скальный холм со штольней, рельсы с вагонетками, деревянный копёр, отвалы породы и фонари.
  buildMine({ z, r, parts, sprites, gy, at }) {
    const face = r() * Math.PI * 2; // куда смотрит вход в штольню
    const fx = Math.cos(face);
    const fz = Math.sin(face);
    // u — поперёк входа, v — от входа наружу; начало — у входа (чуть позади центра)
    const ox = z.x - fx * 30;
    const oz = z.y - fz * 30;
    const P = (u, v) => [ox - fz * u + fx * v, oz + fx * u + fz * v];
    const rot = Math.atan2(-fx, -fz); // локальная X — поперёк, Z — вглубь холма
    const box = (u, v, y, w, h, d, color, tilt = 0) => {
      const [x, zz] = P(u, v);
      parts.push({ geom: G.box, matrix: M(x, gy(x, zz) + y, zz, tilt, rot, 0, w, h, d), color });
    };

    // скальный холм
    for (let i = 0; i < 12; i++) {
      const u = (r() - 0.5) * 90;
      const v = -30 - r() * 45;
      const s = 20 + r() * 22;
      const [x, zz] = P(u, v);
      parts.push({ geom: G.dodeca, matrix: M(x, gy(x, zz) + s * 0.45, zz, r() * 3, r() * 3, r() * 3, s * 1.25, s, s * 1.1), color: ROCKS[i % 3] });
    }
    // вход: тёмный проём в деревянной раме
    box(0, 2, 16, 28, 32, 10, '#0b0b0d');
    for (const u of [-16, 16]) box(u, 6, 18, 5, 36, 5, WOOD[0]);
    box(0, 6, 37, 40, 5, 6, WOOD[1]);
    box(0, 7, 43, 22, 9, 1.5, '#e8c22a'); // жёлтая табличка над входом
    // рельсы и шпалы
    for (let v = 6; v < 120; v += 10) {
      box(0, v, 0.6, 18, 1.4, 3.2, WOOD[2]);
      for (const u of [-5, 5]) box(u, v + 5, 1.8, 1.4, 1.4, 10.5, '#6d6d72');
    }
    // вагонетки с рудой
    for (const [v, ore] of [[38, '#d9c23a'], [82, '#8a8a85']]) {
      box(0, v, 10, 16, 10, 22, '#7a4a2a');
      box(0, v, 15.5, 17, 1.5, 23, '#5a3420');
      for (let k = 0; k < 5; k++) {
        const [x, zz] = P((r() - 0.5) * 10, v + (r() - 0.5) * 14);
        parts.push({ geom: G.dodeca, matrix: M(x, gy(x, zz) + 17 + r() * 2, zz, r() * 3, r() * 3, r() * 3, 3.5 + r() * 2), color: ore });
      }
      for (const u of [-8.5, 8.5]) {
        for (const dv of [-7, 7]) {
          const [x, zz] = P(u, v + dv);
          parts.push({ geom: G.cyl, matrix: M(x, gy(x, zz) + 4, zz, 0, rot, Math.PI / 2, 3.2, 1.6, 3.2), color: '#2b2b2e' });
        }
      }
    }
    // копёр: четыре ноги, раскосы, площадка и колесо наверху
    {
      const cu = 52;
      const cv = 28;
      const H = 86;
      for (const du of [-12, 12]) {
        for (const dv of [-12, 12]) {
          const [x, zz] = P(cu + du * 0.75, cv + dv * 0.75);
          const g0 = gy(x, zz);
          parts.push({ geom: G.box, matrix: M(x, g0 + H / 2, zz, -Math.sign(dv) * 0.08, rot, Math.sign(du) * 0.08, 3.2, H, 3.2), color: WOOD[1] });
        }
      }
      for (const y of [24, 50]) {
        box(cu, cv - 9, y, 20, 2.2, 2.2, WOOD[2]);
        box(cu, cv + 9, y, 20, 2.2, 2.2, WOOD[2]);
      }
      box(cu, cv, H, 26, 3, 26, WOOD[0]);
      const [wx, wz] = P(cu, cv);
      parts.push({ geom: G.cyl, matrix: M(wx, gy(wx, wz) + H + 13, wz, 0, rot, Math.PI / 2, 13, 2.5, 13), color: '#4a4a50' });
      parts.push({ geom: G.cyl, matrix: M(wx, gy(wx, wz) + H + 13, wz, 0, rot, Math.PI / 2, 3, 4, 3), color: '#2b2b2e' });
    }
    // отвалы породы
    for (let i = 0; i < 4; i++) {
      const [x, y] = at(z.r * (0.45 + r() * 0.35), face + Math.PI * (0.4 + r() * 1.2));
      const s = 14 + r() * 10;
      for (let k = 0; k < 5; k++) {
        const px = x + (r() - 0.5) * s;
        const py = y + (r() - 0.5) * s;
        const ss = s * (0.5 + r() * 0.5);
        parts.push({ geom: G.dodeca, matrix: M(px, gy(px, py) + ss * 0.3, py, r() * 3, r() * 3, r() * 3, ss * 1.3, ss * 0.6, ss * 1.2), color: r() < 0.3 ? '#9a8a4a' : ROCKS[k % 3] });
      }
    }
    // ящики, бочки и фонари на столбах
    for (let i = 0; i < 4; i++) box(-30 - r() * 14, 14 + i * 9, 5, 10, 10, 10, WOOD[i % 3]);
    for (let i = 0; i < 3; i++) {
      const [x, y] = P(26 + r() * 12, 60 + r() * 30);
      this.barrel(parts, r, x, y, gy(x, y));
    }
    for (const [u, v] of [[-22, 14], [22, 14], [-14, 70], [14, 110]]) {
      box(u, v, 16, 1.8, 32, 1.8, WOOD[2]);
      box(u, v, 33, 4, 5, 4, '#3a3a3e');
      const [x, zz] = P(u, v);
      const lamp = new THREE.Sprite(this.lampMat);
      lamp.scale.setScalar(26);
      lamp.position.set(x, gy(x, zz) + 33, zz);
      sprites.push(lamp);
    }
    this.radSigns(parts, r, z, at, gy, 4);
  }

  // ---------- древний алтарь ----------
  // Круг замшелых монолитов с горящими рунами, плита алтаря и парящий кристалл над ней.
  buildAltar({ z, r, parts, sprites, gy, at }) {
    const cy = gy(z.x, z.y);
    // ступенчатое основание и плита
    parts.push({ geom: G.cyl, matrix: M(z.x, cy + 1.5, z.y, 0, r() * 3, 0, 26, 3, 26), color: MOSSY[1] });
    parts.push({ geom: G.cyl, matrix: M(z.x, cy + 4.5, z.y, 0, r() * 3, 0, 18, 3, 18), color: MOSSY[0] });
    parts.push({ geom: G.box, matrix: M(z.x, cy + 10, z.y, 0, r() * 3, 0, 20, 8, 12), color: MOSSY[2] });
    // парящий кристалл
    parts.push({ geom: G.octa, matrix: M(z.x, cy + 30, z.y, 0, r() * 3, 0, 4.5, 8, 4.5), color: '#d8a8ff' });
    const core = new THREE.Sprite(this.runeMat);
    core.scale.setScalar(70);
    core.position.set(z.x, cy + 30, z.y);
    sprites.push(core);
    // монолиты по кругу, у каждого — светящаяся руна
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.2;
      const [x, y] = at(z.r * 0.62, a);
      const g0 = gy(x, y);
      const h = 34 + r() * 18;
      const tilt = (r() - 0.5) * 0.12;
      parts.push({ geom: G.box, matrix: M(x, g0 + h / 2 - 2, y, tilt, -a, tilt, 7, h, 11), color: MOSSY[i % 3] });
      if (i % 2 === 0) parts.push({ geom: G.box, matrix: M(x, g0 + h + 1, y, 0, -a, 0, 9, 4, 13), color: MOSSY[(i + 1) % 3] });
      const rune = new THREE.Sprite(this.runeMat);
      rune.scale.setScalar(16);
      rune.position.set(x - Math.cos(a) * 6, g0 + h * 0.6, y - Math.sin(a) * 6);
      sprites.push(rune);
    }
    // упавшие камни и свечи у основания
    for (let i = 0; i < 6; i++) {
      const [x, y] = at(z.r * (0.25 + r() * 0.3), r() * Math.PI * 2);
      const s = 3 + r() * 3;
      parts.push({ geom: G.dodeca, matrix: M(x, gy(x, y) + s * 0.4, y, r() * 3, r() * 3, r() * 3, s * 1.4, s, s), color: MOSSY[i % 3] });
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const x = z.x + Math.cos(a) * 15;
      const y = z.y + Math.sin(a) * 15;
      parts.push({ geom: G.cyl6, matrix: M(x, cy + 8, y, 0, 0, 0, 0.9, 4, 0.9), color: '#e8dcc0' });
      const flame = new THREE.Sprite(this.lampMat);
      flame.scale.setScalar(9);
      flame.position.set(x, cy + 11.5, y);
      sprites.push(flame);
    }
  }

  // ---------- логово колосса ----------
  // Гнездо из поваленных стволов, рёбра и черепа добычи, разбросанные кости и пятна крови.
  buildLair({ z, r, parts, gy, at }) {
    // гнездо
    const cy = gy(z.x, z.y);
    parts.push({ geom: G.cyl, matrix: M(z.x, cy + 0.5, z.y, 0, 0, 0, 44, 1.2, 44), color: '#6b5a3a' });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r() * 0.2;
      const x = z.x + Math.cos(a) * 46;
      const y = z.y + Math.sin(a) * 46;
      parts.push({ geom: G.cyl6, matrix: M(x, gy(x, y) + 5 + (i % 2) * 4, y, Math.PI / 2, -a + (r() - 0.5) * 0.5, 0.25, 3 + r(), 36 + r() * 14, 3 + r()), color: WOOD[i % 3] });
    }
    // рёбра крупной добычи
    for (let c = 0; c < 2; c++) {
      const [x0, y0] = at(z.r * (0.35 + r() * 0.3), r() * Math.PI * 2);
      const a = r() * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const g0 = gy(x0, y0);
      for (let k = 0; k < 7; k++) {
        const t = (k - 3) * 8;
        const sx = x0 + dx * t;
        const sy = y0 + dy * t;
        parts.push({ geom: G.dodeca, matrix: M(sx, g0 + 3, sy, r() * 3, r() * 3, r() * 3, 3.2), color: BONE[k % 3] });
        const w = 13 - Math.abs(k - 3) * 2;
        const h = 22 - Math.abs(k - 3) * 3;
        for (const side of [-1, 1]) {
          // ребро — дуга из отрезков: от позвоночника вбок и вверх, к макушке загибается внутрь
          const nx = -dy * side;
          const ny = dx * side;
          const pts = [[0, 0], [0.7, 0.3], [1, 0.7], [0.75, 1]].map(([a, b]) => new THREE.Vector3(sx + nx * w * a, g0 + 3 + h * b, sy + ny * w * a));
          for (let q = 0; q < pts.length - 1; q++) seg(parts, pts[q], pts[q + 1], 1, BONE[q % 3]);
        }
      }
    }
    // черепа
    for (let i = 0; i < 4; i++) {
      const [x, y] = at(z.r * (0.2 + r() * 0.6), r() * Math.PI * 2);
      const g0 = gy(x, y);
      const a = r() * Math.PI * 2;
      const s = 0.8 + r() * 0.6;
      parts.push({ geom: G.sphere, matrix: M(x, g0 + 6 * s, y, 0.3, a, 0, 9 * s, 7 * s, 8 * s), color: BONE[0] });
      parts.push({ geom: G.box, matrix: M(x + Math.cos(a) * 9 * s, g0 + 3 * s, y - Math.sin(a) * 9 * s, 0, a, 0, 10 * s, 4 * s, 9 * s), color: BONE[1] });
      for (const side of [-1, 1]) {
        parts.push({ geom: G.sphere, matrix: M(x + Math.cos(a) * 6 * s - Math.sin(a) * side * 3.5 * s, g0 + 8 * s, y - Math.sin(a) * 6 * s - Math.cos(a) * side * 3.5 * s, 0, 0, 0, 2.2 * s), color: '#1d1a16' });
        // рог: от темени вбок и вверх
        const bx = x - Math.sin(a) * side * 5 * s;
        const bz = y - Math.cos(a) * side * 5 * s;
        seg(parts, new THREE.Vector3(bx, g0 + 10 * s, bz), new THREE.Vector3(bx - Math.sin(a) * side * 8 * s, g0 + 21 * s, bz - Math.cos(a) * side * 8 * s), 1.6 * s, BONE[2]);
      }
    }
    // разбросанные кости
    for (let i = 0; i < 26; i++) {
      const [x, y] = at(z.r * Math.sqrt(r()) * 0.85, r() * Math.PI * 2);
      const g0 = gy(x, y);
      const a = r() * Math.PI;
      const len = 8 + r() * 10;
      parts.push({ geom: G.cyl6, matrix: M(x, g0 + 1.2, y, Math.PI / 2, a, 0, 1.1, len, 1.1), color: BONE[i % 3] });
      for (const e of [-0.5, 0.5]) {
        parts.push({ geom: G.sphere, matrix: M(x + Math.sin(a) * len * e, g0 + 1.6, y + Math.cos(a) * len * e, 0, 0, 0, 2), color: BONE[(i + 1) % 3] });
      }
    }
    // пятна крови
    for (let i = 0; i < 7; i++) {
      const [x, y] = at(z.r * r() * 0.7, r() * Math.PI * 2);
      const s = 5 + r() * 8;
      parts.push({ geom: G.cyl, matrix: M(x, gy(x, y) + 0.4, y, 0, r() * 3, 0, s, 0.6, s * (0.6 + r() * 0.5)), color: '#5a1a16' });
    }
  }

  update(dt, target, far) {
    // ближние места достраиваем (по одному за кадр), очень дальние — выгружаем
    let budget = this.warm ? Infinity : 1;
    this.warm = false;
    for (const z of this.zones) {
      const d = Math.hypot(z.x - target.x, z.y - target.z) - z.r;
      const it = this.built.get(z.id);
      if (!it && d < far + 300 && budget > 0) {
        this.built.set(z.id, this.build(z));
        budget--;
      } else if (it && d > far + 2500) {
        this.dispose(it);
        this.built.delete(z.id);
      }
    }
    for (const it of this.built.values()) {
      const d = Math.hypot(it.z.x - target.x, it.z.y - target.z) - it.z.r;
      const vis = d < far + 200;
      it.mesh.visible = vis;
      for (const s of it.sprites) s.visible = vis;
      if (!it.points) continue;
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
