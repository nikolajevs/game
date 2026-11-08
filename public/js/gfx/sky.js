// Небо, солнце/луна, звёзды, туман и свет в зависимости от времени суток.
import * as THREE from 'three';
import { lightAt } from '/shared/config.js';

const C = (h) => new THREE.Color(h);
const PAL = {
  day: { top: C('#4f9fe0'), hor: C('#cfe6f2'), hemiSky: C('#cfe8ff'), hemiGround: C('#5b6b45'), sun: C('#fff4e0') },
  dusk: { top: C('#3b4d8f'), hor: C('#f3a463'), hemiSky: C('#f1b98a'), hemiGround: C('#4a3b3a'), sun: C('#ffb067') },
  night: { top: C('#060b1c'), hor: C('#17234a'), hemiSky: C('#4a5f9e'), hemiGround: C('#141a28'), sun: C('#9fb4ff') },
};

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -420;
    sc.right = 420;
    sc.top = 420;
    sc.bottom = -420;
    sc.near = 10;
    sc.far = 2200;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.32;
    this.sun.shadow.radius = 3.5;
    scene.add(this.sun, this.sun.target);

    // купол неба с градиентом в цветах вершин
    const domeGeo = new THREE.SphereGeometry(5000, 32, 16);
    domeGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(domeGeo.attributes.position.count * 3), 3));
    this.dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    }));
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // звёзды
    const n = 900;
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      sp[i * 3] = Math.sin(v) * Math.cos(u) * 4800;
      sp[i * 3 + 1] = Math.cos(v) * 4800;
      sp[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 4800;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
    }));
    scene.add(this.stars);

    // диски солнца и луны
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(120, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff3c4', fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(80, 16, 12), new THREE.MeshBasicMaterial({ color: '#dfe6ff', fog: false }));
    scene.add(this.sunDisc, this.moonDisc);

    scene.fog = new THREE.Fog(0xcfe6f2, 300, 900);
    this.top = new THREE.Color();
    this.hor = new THREE.Color();
    this.light = 1;
  }

  // phase: 0..1 время суток; center: точка, вокруг которой строятся тени; view: дальность видимости
  update(phase, center, view, camDist = 260) {
    const L = lightAt(phase);
    this.light = L;
    const k = (L - 0.12) / 0.88; // 0 ночь .. 1 день
    const dusk = L < 1 && L > 0.12 ? Math.pow(Math.sin(k * Math.PI), 2) : 0;

    this.top.copy(PAL.night.top).lerp(PAL.day.top, k).lerp(PAL.dusk.top, dusk * 0.7);
    this.hor.copy(PAL.night.hor).lerp(PAL.day.hor, k).lerp(PAL.dusk.hor, dusk);
    this.hemi.color.copy(PAL.night.hemiSky).lerp(PAL.day.hemiSky, k).lerp(PAL.dusk.hemiSky, dusk * 0.6);
    this.hemi.groundColor.copy(PAL.night.hemiGround).lerp(PAL.day.hemiGround, k);
    this.hemi.intensity = 0.75 + 0.55 * k;

    // солнце днём, луна ночью — один направленный свет
    const u = (phase + 0.06) % 1;
    const dayFrac = 0.7;
    let elev;
    let az;
    let isSun;
    if (u < dayFrac) {
      const s = u / dayFrac;
      elev = Math.max(0.12, Math.sin(s * Math.PI)) * 1.1;
      az = s * Math.PI;
      isSun = true;
    } else {
      const s = (u - dayFrac) / (1 - dayFrac);
      elev = Math.max(0.2, Math.sin(s * Math.PI)) * 1.0;
      az = s * Math.PI;
      isSun = false;
    }
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), 0.35).normalize();
    this.sun.position.copy(center).addScaledVector(dir, 900);
    this.sun.target.position.copy(center);
    this.sun.color.copy(isSun ? PAL.day.sun : PAL.night.sun).lerp(PAL.dusk.sun, isSun ? dusk : 0);
    this.sun.intensity = isSun ? 0.3 + 2.4 * k : 1.1;

    this.sunDisc.visible = isSun;
    this.moonDisc.visible = !isSun;
    const disc = isSun ? this.sunDisc : this.moonDisc;
    disc.position.copy(center).addScaledVector(dir, 4200);
    this.dome.position.copy(center);
    this.stars.position.copy(center);
    this.stars.material.opacity = Math.max(0, 1 - k * 1.6);

    // градиент купола
    const pos = this.dome.geometry.attributes.position;
    const col = this.dome.geometry.attributes.color;
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 5000;
      const t = Math.pow(Math.max(0, y), 0.55);
      tmp.copy(this.hor).lerp(this.top, t);
      if (y < 0) tmp.copy(this.hor).multiplyScalar(0.8);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    col.needsUpdate = true;

    // туман = дальность обзора; ночью видно гораздо хуже.
    // Отсчёт — от персонажа, а не от камеры: при отдалении камеры видна та же округа, только сверху
    const far = view * (0.55 + 0.45 * k);
    const extra = Math.max(0, camDist - 260);
    this.scene.fog.color.copy(this.hor);
    this.scene.fog.far = far + extra;
    this.scene.fog.near = far * 0.45 + extra;
    return { light: L, k, dusk, far };
  }
}
