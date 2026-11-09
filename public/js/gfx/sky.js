// Небо, солнце/луна, звёзды, туман и свет в зависимости от времени суток.
import * as THREE from 'three';
import { lightAt } from '/shared/config.js';

const C = (h) => new THREE.Color(h);

// Облака: шум на «потолке» над головой, плывут по ветру. Общая функция — её же использует вода,
// чтобы отражать облака по отражённому лучу (без второй отрисовки мира).
export const CLOUDS_GLSL = /* glsl */ `
  float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float cFbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * cNoise(p);
      p = p * 2.07 + vec2(13.1, 7.7);
      a *= 0.5;
    }
    return v;
  }
  // плотность облаков в направлении d (0..1); cover — чем больше, тем меньше облаков
  float cloudDensity(vec3 d, float t, float cover) {
    if (d.y <= 0.0) return 0.0;
    vec2 uv = d.xz / (d.y + 0.12) * 1.1 + vec2(t * 0.007, t * 0.0025);
    float n = cFbm(uv * 1.5);
    float c = smoothstep(cover, cover + 0.3, n);
    return c * smoothstep(0.0, 0.22, d.y);
  }
  // цвет облаков: светлые к солнцу, сероватые с теневой стороны; ночью тёмные, на закате тёплые
  vec3 cloudColor(vec3 d, vec3 sunDir, vec3 sunColor, vec3 hor, float light) {
    float s = max(dot(d, sunDir), 0.0);
    vec3 lit = mix(vec3(0.68, 0.72, 0.8), vec3(1.0, 0.99, 0.97), 0.45 + 0.55 * s) + sunColor * pow(s, 6.0) * 0.25;
    return mix(hor * 0.55 + vec3(0.03, 0.03, 0.05), lit, light);
  }
`;

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const domeFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uTime;
  uniform float uLight;
  uniform float uCover;
  varying vec3 vDir;
  ${CLOUDS_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHor, uTop, pow(h, 0.55));
    if (d.y < 0.0) col = uHor * 0.8;
    // ореол вокруг солнца
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.35) * uLight;
    float c = cloudDensity(d, uTime, uCover);
    col = mix(col, cloudColor(d, uSunDir, uSunColor, uHor, uLight), c * 0.92);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
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

    // купол неба: градиент, ореол солнца и облака — всё в шейдере
    this.cover = 0.55; // чем больше, тем меньше облаков
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHor: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uTime: { value: 0 },
        uLight: { value: 1 },
        uCover: { value: this.cover },
      },
      vertexShader: domeVertex,
      fragmentShader: domeFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), this.domeMat);
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

    // купол: цвета, солнце и облака (плывут по ветру)
    this.cloudTime = performance.now() / 1000;
    this.sunDir = dir;
    this.dayLight = k;
    const du = this.domeMat.uniforms;
    du.uTop.value.copy(this.top);
    du.uHor.value.copy(this.hor);
    du.uSunDir.value.copy(dir);
    du.uSunColor.value.copy(this.sun.color);
    du.uTime.value = this.cloudTime;
    du.uLight.value = k;
    du.uCover.value = this.cover;

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
