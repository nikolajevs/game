// Живой огонь: пламя на шейдере (языки бегут вверх, белое ядро, красные края),
// искры, дым, тлеющие угли и тёплое свечение. Пламя всегда повёрнуто к камере.
import * as THREE from 'three';
import { G, glowTexture } from './util.js';

const flameVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const flameFragment = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uPower;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  float t = uTime + uSeed * 13.0;
  // шум «течёт» вверх: крупные языки и мелкая рябь
  float big = fbm(vec2(uv.x * 2.6 + uSeed, uv.y * 1.8 - t * 1.5));
  float fine = fbm(vec2(uv.x * 6.0 - uSeed, uv.y * 4.5 - t * 3.1));
  // пламя колышется сильнее у верхушки
  float x = (uv.x - 0.5) * 2.0 + (big - 0.5) * 0.7 * uv.y;
  // капля: широкое основание, тонкий кончик
  float width = mix(0.78, 0.08, pow(uv.y, 0.85));
  float shape = 1.0 - smoothstep(width * 0.45, width, abs(x));
  // верхний край «облизан» шумом, отдельные язычки отрываются
  float h = uv.y + (fine - 0.5) * 0.42 + (big - 0.5) * 0.2;
  float body = shape * (1.0 - smoothstep(0.3, 0.92, h)) * smoothstep(0.0, 0.07, uv.y);
  float heat = clamp(body * (0.55 + 0.75 * fine) * uPower, 0.0, 1.2);
  // тёмно-красный -> оранжевый -> жёлтый -> почти белое ядро
  vec3 col = mix(vec3(0.45, 0.04, 0.0), vec3(1.0, 0.32, 0.02), smoothstep(0.05, 0.4, heat));
  col = mix(col, vec3(1.0, 0.72, 0.18), smoothstep(0.4, 0.72, heat));
  col = mix(col, vec3(1.0, 0.95, 0.78), smoothstep(0.75, 1.05, heat));
  float alpha = smoothstep(0.06, 0.3, heat);
  gl_FragColor = vec4(col * alpha * 1.6, alpha);
}`;

let flameMatBase = null;
function flameMaterial(seed) {
  if (!flameMatBase) {
    flameMatBase = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: 0 }, uPower: { value: 1 } },
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  const m = flameMatBase.clone();
  m.uniforms.uSeed.value = seed;
  return m;
}

// мягкое пятно для дыма
let smokeTex = null;
function smokeTexture() {
  if (smokeTex) return smokeTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(cv);
  return smokeTex;
}

const coalMat = new THREE.MeshStandardMaterial({ color: '#2a1408', emissive: '#ff4a10', emissiveIntensity: 1.2, roughness: 0.9, flatShading: true });
const flameGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // основание у нуля
const SPARKS = 22;
const SMOKE = 6;

// плавное «мерцание» из нескольких синусов — без резких скачков
function flicker(t, s) {
  return Math.sin(t * 7.3 + s) * 0.5 + Math.sin(t * 13.1 + s * 2.1) * 0.3 + Math.sin(t * 23.7 + s * 3.7) * 0.2;
}

export class Fire {
  // size — масштаб: 1 соответствует костру
  constructor(size = 1, seed = Math.random()) {
    this.size = size;
    this.seed = seed * 100;
    this.group = new THREE.Group();
    // пламя: внешнее широкое и внутреннее яркое, чуть смещённые для объёма
    this.flames = [];
    for (const [w, h, power, dx] of [[26, 42, 1.0, 0], [17, 30, 1.25, 2.5], [14, 24, 1.1, -3]]) {
      const m = new THREE.Mesh(flameGeo, flameMaterial(this.seed + dx));
      m.scale.set(w * size, h * size, 1);
      m.position.set(dx * size, 1.5 * size, 0);
      m.material.uniforms.uPower.value = power;
      m.renderOrder = 3;
      m.frustumCulled = false;
      this.group.add(m);
      this.flames.push(m);
    }
    // угли
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + seed;
      const c = new THREE.Mesh(G.dodeca, coalMat);
      c.position.set(Math.cos(a) * 5 * size, 1.2 * size, Math.sin(a) * 5 * size);
      c.scale.setScalar((1.6 + ((i * 7) % 3) * 0.5) * size);
      c.rotation.set(i, i * 2, i * 3);
      this.group.add(c);
    }
    // свечение
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a32', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(80 * size);
    this.glow.position.y = 14 * size;
    this.group.add(this.glow);
    // искры
    this.sparks = [];
    const pos = new Float32Array(SPARKS * 3);
    const col = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) this.sparks.push(this.newSpark(true));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.sparkPoints = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 2.4 * size, map: glowTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.sparkPoints.frustumCulled = false;
    this.group.add(this.sparkPoints);
    // дым
    this.smoke = [];
    for (let i = 0; i < SMOKE; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture(), color: '#5c5650', transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.age = (i / SMOKE) * 3.2;
      sp.userData.drift = (Math.random() - 0.5) * 6;
      this.group.add(sp);
      this.smoke.push(sp);
    }
    this.light = 1;
  }

  newSpark(initial = false) {
    const s = this.size;
    const life = 0.9 + Math.random() * 1.1;
    return {
      x: (Math.random() - 0.5) * 10 * s, y: 4 * s, z: (Math.random() - 0.5) * 10 * s,
      vx: (Math.random() - 0.5) * 10 * s, vy: (30 + Math.random() * 35) * s, vz: (Math.random() - 0.5) * 10 * s,
      age: initial ? Math.random() * life : 0, life, phase: Math.random() * 6,
    };
  }

  // camPos — чтобы повернуть пламя к камере; night 0..1 — ночью свечение сильнее
  update(dt, t, camPos, night = 0) {
    const g = this.group;
    g.updateWorldMatrix(true, false);
    const wx = g.matrixWorld.elements[12];
    const wz = g.matrixWorld.elements[14];
    // пламя смотрит на камеру (поворот только вокруг вертикали)
    const yaw = Math.atan2(camPos.x - wx, camPos.z - wz);
    const fl = flicker(t, this.seed);
    this.light = 1 + fl * 0.18;
    for (let i = 0; i < this.flames.length; i++) {
      const m = this.flames[i];
      m.rotation.y = yaw - (g.parent ? g.parent.rotation.y : 0);
      m.material.uniforms.uTime.value = t * (1 + i * 0.13);
      // пламя чуть «дышит» по высоте
      const base = m.userData.h ?? (m.userData.h = m.scale.y);
      m.scale.y = base * (1 + flicker(t * 1.3, this.seed + i * 5) * 0.08);
    }
    coalMat.emissiveIntensity = 1.1 + flicker(t * 0.7, 3) * 0.35;
    this.glow.material.opacity = (0.3 + night * 0.6) * (0.9 + fl * 0.12);
    this.glow.scale.setScalar(80 * this.size * (1 + fl * 0.06));
    // искры: взлетают, виляют, остывают от жёлтого к красному и гаснут
    const pos = this.sparkPoints.geometry.attributes.position;
    const col = this.sparkPoints.geometry.attributes.color;
    for (let i = 0; i < this.sparks.length; i++) {
      let p = this.sparks[i];
      p.age += dt;
      if (p.age >= p.life) p = this.sparks[i] = this.newSpark();
      p.vy *= 1 - dt * 0.6;
      p.x += (p.vx + Math.sin(t * 6 + p.phase) * 8 * this.size) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + Math.cos(t * 5 + p.phase) * 8 * this.size) * dt;
      pos.array[i * 3] = p.x;
      pos.array[i * 3 + 1] = p.y;
      pos.array[i * 3 + 2] = p.z;
      const k = 1 - p.age / p.life;
      col.array[i * 3] = k;
      col.array[i * 3 + 1] = k * k * 0.75;
      col.array[i * 3 + 2] = k * k * k * 0.25;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    // дым: поднимается, расплывается и тает
    for (const sp of this.smoke) {
      const u = sp.userData;
      u.age += dt;
      if (u.age > 3.2) {
        u.age -= 3.2;
        u.drift = (Math.random() - 0.5) * 6;
      }
      const k = u.age / 3.2;
      sp.position.set(u.drift * k * this.size + Math.sin(t * 0.8 + u.drift) * 3, (30 + k * 70) * this.size, 0);
      sp.scale.setScalar((10 + k * 34) * this.size);
      sp.material.opacity = Math.sin(k * Math.PI) * 0.28;
    }
  }

  dispose() {
    for (const m of this.flames) m.material.dispose();
    this.glow.material.dispose();
    this.sparkPoints.geometry.dispose();
    this.sparkPoints.material.dispose();
    for (const sp of this.smoke) sp.material.dispose();
  }
}
