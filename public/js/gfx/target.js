// Выделение цели под прицелом: яркий контур вокруг модели, зона на земле под ней, подсветка имени.
// Всё рисуется без тумана и обычной (не аддитивной) смесью цветов: на светлом тумане сложение
// света давало бы белое на белом, и выделение пропадало бы.
import * as THREE from 'three';

export const TARGET_COLORS = { hostile: '#ff3b2f', prey: '#ffc233' };

const OUTLINE_PX = 3.2; // толщина контура на экране, пикселей
const PX_PER_UNIT_DIST = 0.0013; // сколько единиц мира в одном пикселе на единицу расстояния до камеры

let discTexture = null;
// мягкий круг: плотнее у края, чтобы зона читалась кольцом заливки, а не пятном
function zoneTexture() {
  if (discTexture) return discTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0.62)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  discTexture = new THREE.CanvasTexture(c);
  discTexture.colorSpace = THREE.SRGBColorSpace;
  return discTexture;
}

const flat = (opts) => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide, ...opts });

// Контур «вывернутой оболочкой»: копия меша, раздутая вдоль нормалей и видимая только изнутри.
// Для скелетных мешей копия делит скелет с исходным, поэтому двигается вместе с ним.
function outlineMaterial(color) {
  const uThick = { value: 0.5 };
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false, transparent: true, opacity: 1, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uThick = uThick;
    shader.vertexShader = `uniform float uThick;\n${shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + normalize(normal) * uThick;')}`;
  };
  mat.customProgramCacheKey = () => 'target-outline-v1';
  mat.userData.uThick = uThick;
  return mat;
}

export class TargetMark {
  constructor(scene) {
    this.scene = scene;
    this.v = null; // вид существа под прицелом (запись из WorldView.ents)
    this.k = 0; // 0..1 — насколько проявлено выделение
    this.t = 0;
    this.hulls = [];
    this.color = new THREE.Color(TARGET_COLORS.hostile);
    this.group = this.makeZone();
    this.group.visible = false;
    scene.add(this.group);
  }

  makeZone() {
    const group = new THREE.Group();
    const flatGroup = new THREE.Group();
    flatGroup.rotation.x = -Math.PI / 2;
    group.add(flatGroup);
    const dark = { color: '#10080a', opacity: 0.7 };
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), flat({ map: zoneTexture(), color: this.color, opacity: 0.55 }));
    this.edgeDark = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.12, 56), flat(dark));
    this.edge = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 56), flat({ color: this.color, opacity: 1 }));
    this.arcs = new THREE.Group();
    this.arcMats = [];
    for (let i = 0; i < 4; i++) {
      const m = flat({ color: this.color, opacity: 1 });
      this.arcMats.push(m);
      const back = flat(dark);
      const a0 = (i * Math.PI) / 2 + 0.2;
      this.arcs.add(new THREE.Mesh(new THREE.RingGeometry(1.1, 1.52, 12, 1, a0 - 0.05, 0.75), back));
      this.arcs.add(new THREE.Mesh(new THREE.RingGeometry(1.17, 1.45, 12, 1, a0, 0.65), m));
    }
    this.disc.renderOrder = 6;
    this.edgeDark.renderOrder = 7;
    this.edge.renderOrder = 8;
    this.arcs.children.forEach((m, i) => { m.renderOrder = i % 2 ? 9 : 8; });
    flatGroup.add(this.disc, this.edgeDark, this.edge, this.arcs);
    this.pulse = flatGroup;
    return group;
  }

  setColor(hex) {
    this.color.set(hex);
    // материалы копируют цвет при создании, поэтому красим каждый заново
    for (const m of [this.disc.material, this.edge.material, ...this.arcMats]) m.color.copy(this.color);
    for (const h of this.hulls) h.material.color.copy(this.color);
  }

  // контур по всем мешам существа; пока модель не загрузилась, мешей нет — пробуем снова в следующем кадре
  attachHulls(creature) {
    const found = [];
    creature.root.traverse((o) => {
      if (!o.isMesh || o.userData.targetHull || !o.parent || !o.geometry?.attributes.normal || o.material?.wireframe) return;
      found.push(o);
    });
    for (const src of found) {
      const mat = outlineMaterial(this.color);
      let hull;
      if (src.isSkinnedMesh) {
        hull = new THREE.SkinnedMesh(src.geometry, mat);
        hull.bind(src.skeleton, src.bindMatrix);
        hull.bindMode = src.bindMode;
      } else hull = new THREE.Mesh(src.geometry, mat);
      hull.userData.targetHull = true;
      hull.position.copy(src.position);
      hull.quaternion.copy(src.quaternion);
      hull.scale.copy(src.scale);
      hull.frustumCulled = false;
      hull.castShadow = false;
      hull.receiveShadow = false;
      hull.renderOrder = 4;
      src.parent.add(hull);
      hull.userData.src = src;
      this.hulls.push(hull);
    }
    return found.length > 0;
  }

  detachHulls() {
    for (const h of this.hulls) {
      h.parent?.remove(h);
      h.material.dispose();
    }
    this.hulls.length = 0;
  }

  release() {
    this.detachHulls();
    if (this.v?.creature) this.v.creature.hi = null;
    this.v = null;
  }

  // v — вид существа под прицелом или null; kind — 'hostile' | 'prey'
  set(v, kind = 'hostile') {
    if (v !== this.v) {
      this.release();
      this.v = v;
      this.k = Math.min(this.k, 0.35);
    }
    this.kind = kind;
    if (v) this.setColor(TARGET_COLORS[kind] || TARGET_COLORS.hostile);
  }

  update(dt, camera, groundY) {
    this.t += dt;
    const v = this.v;
    this.k = v ? Math.min(1, this.k + dt * 9) : Math.max(0, this.k - dt * 7);
    const on = !!v && this.k > 0.01;
    this.group.visible = on;
    if (!v) return;
    const cr = v.creature;
    if (!this.hulls.length && cr.root) this.attachHulls(cr);
    // зона под ногами: маленькая — чуть шире самого существа
    const r = cr.R * 1.3 + 10;
    this.group.position.set(v.x, groundY(v.x, v.y) + 1.5, v.y);
    const pulse = 1 + Math.sin(this.t * 6) * 0.04;
    this.group.scale.setScalar(r * (1.35 - 0.35 * this.k));
    this.edge.scale.setScalar(pulse);
    this.arcs.rotation.z = this.t * 1.1;
    const o = this.k;
    this.disc.material.opacity = 0.5 * o;
    this.edge.material.opacity = o;
    this.edgeDark.material.opacity = 0.7 * o;
    for (const m of this.arcMats) m.opacity = o;
    this.arcs.children.forEach((m, i) => { if (!(i % 2)) m.material.opacity = 0.7 * o; });
    // контур: постоянная толщина на экране независимо от расстояния
    const dist = camera.position.distanceTo(_p.set(v.x, v.cy ?? v.gy ?? 0, v.y));
    const world = Math.max(0.7, dist * PX_PER_UNIT_DIST * OUTLINE_PX);
    for (const h of this.hulls) {
      const s = h.userData.src.matrixWorld.getMaxScaleOnAxis() || 1;
      h.material.userData.uThick.value = world / s;
      h.material.opacity = o;
    }
    // подсветка самой модели: пульсирующее свечение поверх обычного освещения
    const glow = (0.3 + Math.sin(this.t * 8) * 0.1) * o;
    cr.hi = { r: this.color.r * glow, g: this.color.g * glow, b: this.color.b * glow };
  }
}
const _p = new THREE.Vector3();
