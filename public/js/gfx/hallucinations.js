// Галлюцинации от грибов — только у того, кто их съел (сервер про видения не знает):
// мир плывёт и переливается (шейдер поверх кадра), вокруг бродят призрачные существа,
// кружат радужные огоньки, а от сильных грибов в небе открываются огромные глаза.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PARTS, PART_KEYS } from '/shared/config.js';
import { Creature3D } from './creature3d.js';
import { glowTexture } from './util.js';

const TripShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uStrength: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    varying vec2 vUv;
    // поворот цвета вокруг серой оси — плавная смена оттенков
    vec3 hueShift(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    void main() {
      float s = uStrength;
      vec2 c = vUv - 0.5;
      float r = length(c);
      // «дыхание» и закручивание к центру
      float ang = s * 0.32 * sin(uTime * 0.55) * (1.0 - r);
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      c = rot * c * (1.0 + 0.045 * s * sin(uTime * 1.25));
      vec2 uv = c + 0.5;
      // волны по экрану
      uv.x += s * 0.011 * sin(uv.y * 17.0 + uTime * 2.1);
      uv.y += s * 0.011 * sin(uv.x * 13.0 + uTime * 1.7);
      // цветные края (хроматическая аберрация)
      vec2 off = c * 0.016 * s * (1.0 + 0.6 * sin(uTime * 2.3));
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // двоение
      vec3 ghost = texture2D(tDiffuse, 0.5 + (uv - 0.5) * (0.965 + 0.01 * sin(uTime))).rgb;
      col = mix(col, max(col, ghost * 1.1), 0.3 * s);
      // переливы цвета и насыщенность
      col = mix(col, hueShift(col, uTime * 0.7 + r * 7.0 * s), 0.6 * s);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.0 + 0.7 * s);
      // пульсирующая радужная кайма
      vec3 tint = 0.5 + 0.5 * cos(uTime * 0.9 + vec3(0.0, 2.1, 4.2));
      col += tint * smoothstep(0.32, 0.85, r) * s * 0.4;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

const MOTES = 180;

// случайный геном — призраки похожи на диковинных существ
function randomLook() {
  const mouths = 'hco';
  let s = mouths[Math.floor(Math.random() * 3)];
  for (const k of PART_KEYS) s += Math.floor(Math.random() * (PARTS[k].max + 1));
  return s;
}

export class Hallucinations {
  constructor(renderer, scene, camera, ground) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ground = ground;
    this.s = 0; // текущая (сглаженная) сила
    this.t = 0;
    this.composer = null;
    this.phantoms = [];
    this.eyes = [];
    // радужные огоньки вокруг игрока
    const pos = new Float32Array(MOTES * 3);
    const col = new Float32Array(MOTES * 3);
    this.motesBase = [];
    for (let i = 0; i < MOTES; i++) {
      this.motesBase.push({ r: 30 + Math.random() * 320, a: Math.random() * Math.PI * 2, y: Math.random() * 140, sp: (Math.random() - 0.5) * 0.6, up: 6 + Math.random() * 14 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({
      size: 5, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    scene.add(this.motes);
  }

  // target — сила галлюцинаций с сервера (0..1), оставшееся время — для плавного угасания
  update(dt, strength, left, target) {
    const goal = left > 0 ? strength * Math.min(1, left / 6) : 0;
    this.s += (goal - this.s) * (1 - Math.exp(-dt * (goal > this.s ? 0.8 : 1.5)));
    if (this.s < 0.003 && goal === 0) this.s = 0;
    this.t += dt;
    const s = this.s;
    this.updateMotes(dt, s, target);
    this.updatePhantoms(dt, s, target);
    this.updateEyes(dt, s, target);
  }

  get active() {
    return this.s > 0.01;
  }

  // рисует кадр через шейдер галлюцинаций; false — если видений нет (рисуем как обычно)
  render() {
    if (!this.active) return false;
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.trip = new ShaderPass(TripShader);
      this.composer.addPass(this.trip);
      this.composer.addPass(new OutputPass());
    }
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    if (this.cw !== size.x || this.ch !== size.y || this.cpr !== pr) {
      this.cw = size.x;
      this.ch = size.y;
      this.cpr = pr;
      this.composer.setPixelRatio(pr);
      this.composer.setSize(size.x, size.y);
    }
    this.trip.uniforms.uTime.value = this.t;
    this.trip.uniforms.uStrength.value = this.s;
    this.composer.render();
    return true;
  }

  updateMotes(dt, s, target) {
    this.motes.visible = s > 0.01;
    if (!this.motes.visible) return;
    this.motes.material.opacity = Math.min(1, s * 1.4);
    const pos = this.motes.geometry.attributes.position;
    const col = this.motes.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < MOTES; i++) {
      const m = this.motesBase[i];
      m.a += m.sp * dt;
      m.y += m.up * dt;
      if (m.y > 160) m.y = 0;
      const x = target.x + Math.cos(m.a) * m.r;
      const z = target.z + Math.sin(m.a) * m.r;
      pos.array[i * 3] = x;
      pos.array[i * 3 + 1] = target.y - 30 + m.y + Math.sin(this.t * 2 + i) * 6;
      pos.array[i * 3 + 2] = z;
      c.setHSL((this.t * 0.15 + i / MOTES) % 1, 0.9, 0.6);
      col.array[i * 3] = c.r;
      col.array[i * 3 + 1] = c.g;
      col.array[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  spawnPhantom(target) {
    const c = new Creature3D(randomLook(), '#ffffff');
    c.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o === c.contactShadow) {
        o.visible = false;
        return;
      }
      o.castShadow = false;
      o.receiveShadow = false;
    });
    // полупрозрачное светящееся тело, цвет переливается. Общие материалы (кислота, свечение, оружие)
    // клонируем — иначе прозрачными стали бы и настоящие звери
    const mats = new Set();
    c.group.traverse((o) => {
      if (o.isSprite) o.visible = false;
      if (!o.isMesh || !o.material || !o.visible) return;
      if (o.material !== c.mat) o.material = o.material.clone();
      mats.add(o.material);
    });
    for (const m of mats) {
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = 0;
      if (m.emissive) m.emissiveIntensity = 1;
    }
    const a = Math.random() * Math.PI * 2;
    const d = 170 + Math.random() * 260;
    const ph = {
      c, mats: [...mats], x: target.x + Math.cos(a) * d, z: target.z + Math.sin(a) * d,
      ang: Math.random() * Math.PI * 2, speed: 25 + Math.random() * 55, scale: 0.8 + Math.random() * 2.2,
      fly: Math.random() < 0.4 ? 20 + Math.random() * 50 : 0, life: 7 + Math.random() * 9, fade: 0, hue: Math.random(), dying: false,
    };
    c.group.scale.setScalar(ph.scale);
    this.scene.add(c.group);
    this.phantoms.push(ph);
  }

  updatePhantoms(dt, s, target) {
    const want = s > 0.05 ? Math.round(2 + s * 5) : 0;
    if (this.phantoms.filter((p) => !p.dying).length < want && Math.random() < dt * 2) this.spawnPhantom(target);
    for (const p of this.phantoms) {
      p.life -= dt;
      const dist = Math.hypot(p.x - target.x, p.z - target.z);
      // исчезают, если подойти вплотную, уйти далеко или кончилось видение
      if (p.life <= 0 || dist < 70 || dist > 700 || want === 0) p.dying = true;
      p.fade = Math.max(0, Math.min(1, p.fade + (p.dying ? -dt * 1.5 : dt * 0.7)));
      p.ang += Math.sin(this.t * 0.7 + p.hue * 10) * dt * 0.6;
      p.x += Math.cos(p.ang) * p.speed * dt;
      p.z += Math.sin(p.ang) * p.speed * dt;
      const gy = Math.max(this.ground(p.x, p.z), 0);
      p.c.group.position.set(p.x, gy + p.fly + (p.fly ? Math.sin(this.t * 1.5 + p.hue * 6) * 8 : 0), p.z);
      p.c.group.rotation.y = -p.ang;
      p.c.update(dt, { speed: p.speed });
      const op = p.fade * (0.35 + 0.2 * Math.sin(this.t * 3 + p.hue * 9)) * Math.min(1, s * 1.5);
      const hue = (p.hue + this.t * 0.12) % 1;
      for (const m of p.mats) {
        m.opacity = op;
        if (m.emissive) m.emissive.setHSL(hue, 0.9, 0.35);
      }
    }
    for (const p of this.phantoms) {
      if (p.dying && p.fade <= 0) {
        this.scene.remove(p.c.group);
        p.c.dispose?.();
        for (const m of p.mats) m.dispose?.();
      }
    }
    this.phantoms = this.phantoms.filter((p) => !(p.dying && p.fade <= 0));
  }

  // огромные глаза в небе — только от сильных грибов
  makeEye() {
    const g = new THREE.Group();
    const white = new THREE.MeshBasicMaterial({ color: '#fff6e8', transparent: true, opacity: 0, depthWrite: false });
    const iris = new THREE.MeshBasicMaterial({ color: '#7a3cff', transparent: true, opacity: 0, depthWrite: false });
    const pupil = new THREE.MeshBasicMaterial({ color: '#05030a', transparent: true, opacity: 0, depthWrite: false });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), white);
    const ir = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), iris);
    ir.position.z = 0.97;
    const pu = new THREE.Mesh(new THREE.CircleGeometry(0.24, 18), pupil);
    pu.position.z = 0.985;
    g.add(ball, ir, pu);
    g.scale.setScalar(45);
    this.scene.add(g);
    return { g, mats: [white, iris, pupil], a: Math.random() * Math.PI * 2, fade: 0, blink: 0 };
  }

  updateEyes(dt, s, target) {
    const want = s > 0.85 ? 2 : 0;
    while (this.eyes.length < want) this.eyes.push(this.makeEye());
    for (const e of this.eyes) {
      e.fade = Math.max(0, Math.min(1, e.fade + (want ? dt * 0.4 : -dt)));
      e.a += dt * 0.05;
      e.g.position.set(target.x + Math.cos(e.a) * 520, target.y + 230 + Math.sin(this.t * 0.4 + e.a) * 30, target.z + Math.sin(e.a) * 520);
      e.g.lookAt(this.camera.position);
      // моргание
      e.blink -= dt;
      if (e.blink < -4 - Math.random() * 6) e.blink = 0.18;
      e.g.scale.set(45, e.blink > 0 ? 6 : 45, 45);
      e.mats[1].color.setHSL((this.t * 0.05) % 1, 0.8, 0.45);
      for (const m of e.mats) m.opacity = e.fade * 0.85;
    }
    if (!want) {
      for (const e of this.eyes.filter((x) => x.fade <= 0)) {
        this.scene.remove(e.g);
        e.g.traverse((o) => o.geometry?.dispose());
        for (const m of e.mats) m.dispose();
      }
      this.eyes = this.eyes.filter((x) => x.fade > 0);
    }
  }
}
