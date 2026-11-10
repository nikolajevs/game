// Видения — только у того, кто съел гриб, кактус или жабу (сервер знает лишь, сколько трипу осталось).
// Шейдер поверх кадра рисует четыре разных трипа, и они складываются:
//   сияющие поганки — мир плывёт и переливается, в небе открываются огромные глаза;
//   мухомор — всё светится изнутри, радуга, северное сияние и искры;
//   пейотль — плывут стены и горизонт, закатные краски пустыни;
//   сияющая жаба — калейдоскоп и неоновые фракталы.
// Вокруг бродят призрачные существа и кружат радужные огоньки.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PARTS, PART_KEYS } from '/shared/config.js';
import { Creature3D } from './creature3d.js';
import { glowTexture } from './util.js';

const TripShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uStrength: { value: 0 }, uA: { value: 0 }, uP: { value: 0 }, uT: { value: 0 }, uAspect: { value: 1.6 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength; // сияющие поганки: общий «плывущий» трип
    uniform float uA; // мухомор: сияние, радуга, северное сияние, искры
    uniform float uP; // пейотль: плывут стены и горизонт, закатные краски
    uniform float uT; // жаба: калейдоскоп и фракталы
    uniform float uAspect;
    varying vec2 vUv;
    // поворот цвета вокруг серой оси — плавная смена оттенков
    vec3 hueShift(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }
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
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }
    mat2 rot2(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
    void main() {
      float s = uStrength;
      vec2 c = vUv - 0.5;
      float r = length(c);
      // общий трип: «дыхание» и закручивание к центру
      float ang = s * 0.32 * sin(uTime * 0.55) * (1.0 - r);
      vec2 q = rot2(ang) * c * (1.0 + 0.045 * s * sin(uTime * 1.25));
      vec2 uv = q + 0.5;
      uv.x += s * 0.011 * sin(uv.y * 17.0 + uTime * 2.1);
      uv.y += s * 0.011 * sin(uv.x * 13.0 + uTime * 1.7);

      // ---- пейотль: стены гнутся, горизонт дышит, верх кадра оплывает вниз ----
      if (uP > 0.001) {
        uv.x += uP * 0.06 * sin(uv.y * 5.0 + uTime * 0.9) + uP * 0.018 * sin(uv.y * 23.0 - uTime * 2.3);
        uv.y += uP * 0.045 * sin(uv.x * 4.0 + uTime * 0.7);
        float drip = fbm(vec2(uv.x * 7.0, uTime * 0.15));
        uv.y += uP * 0.09 * drip * smoothstep(0.15, 1.0, uv.y) * (0.6 + 0.4 * sin(uTime * 0.8 + uv.x * 9.0));
        uv += uP * 0.006 * vec2(noise(uv * 40.0 + uTime * 3.0) - 0.5, noise(uv * 40.0 - uTime * 3.0) - 0.5); // марево
      }
      // ---- жаба: мир складывается в калейдоскоп (середина остаётся читаемой) ----
      if (uT > 0.001) {
        vec2 k = uv - 0.5;
        float rad = length(k);
        float seg = 6.2831 / 8.0;
        float a2 = abs(mod(atan(k.y, k.x) + uTime * 0.1, seg) - seg * 0.5);
        vec2 kuv = 0.5 + rad * vec2(cos(a2), sin(a2)) * (1.0 + 0.08 * sin(uTime * 1.3));
        uv = mix(uv, kuv, uT * 0.72 * smoothstep(0.1, 0.45, rad));
      }
      // ---- мухомор: мир мягко дышит и покачивается ----
      if (uA > 0.001) {
        vec2 k = (uv - 0.5) * (1.0 + 0.035 * uA * sin(uTime * 1.1));
        k = rot2(uA * 0.22 * sin(uTime * 0.4) * (0.6 - length(k))) * k;
        uv = k + 0.5;
        uv += uA * 0.006 * vec2(sin(uv.y * 14.0 + uTime * 1.6), cos(uv.x * 12.0 + uTime * 1.3));
      }
      uv = clamp(uv, 0.002, 0.998);

      // цветные края (хроматическая аберрация)
      vec2 off = c * (0.016 * s * (1.0 + 0.6 * sin(uTime * 2.3)) + 0.012 * uA + 0.008 * uT);
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
      vec3 tint = 0.5 + 0.5 * cos(uTime * 0.9 + vec3(0.0, 2.1, 4.2));
      col += tint * smoothstep(0.32, 0.85, r) * s * 0.4;

      // ---- мухомор: всё светится изнутри, каждый предмет — своим цветом ----
      if (uA > 0.001) {
        vec3 gl = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7854 + uTime * 0.2;
          gl += texture2D(tDiffuse, uv + vec2(cos(a), sin(a) * uAspect) * 0.016).rgb;
        }
        gl /= 8.0;
        col = mix(col, max(col, gl * 1.35), 0.7 * uA); // мягкий ореол
        float la = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 rb = pal(la * 1.3 + r * 0.8 - uTime * 0.12); // радуга по яркости и удалению от центра
        col = mix(col, col * (0.3 + 2.0 * rb), 0.8 * uA);
        col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.0 + 1.3 * uA);
        // северное сияние в верхней части кадра
        float au = fbm(vec2(vUv.x * 3.0 + uTime * 0.1, vUv.y * 1.5 - uTime * 0.05));
        float band = smoothstep(0.38, 0.7, au) * smoothstep(0.25, 0.95, vUv.y);
        col += pal(vUv.x * 0.6 + uTime * 0.05 + au) * band * 0.95 * uA;
        // мерцающие искры
        vec2 g = vUv * vec2(34.0 * uAspect, 34.0);
        vec2 gi = floor(g);
        float h = hash(gi);
        float tw = pow(max(0.0, sin(uTime * (2.0 + h * 4.0) + h * 40.0)), 12.0);
        float d = length(fract(g) - 0.5 - 0.3 * (vec2(hash(gi + 1.3), hash(gi + 2.7)) - 0.5));
        col += pal(h + uTime * 0.1) * tw * smoothstep(0.2, 0.0, d) * step(0.55, h) * uA * 2.2;
        // радужные лепестки по краям
        float pa = atan(c.y, c.x);
        col += pal(uTime * 0.07 + pa / 6.2831 * 3.0) * smoothstep(0.3, 0.75, r) * 0.45 * uA * (0.6 + 0.4 * sin(pa * 8.0 + uTime));
      }
      // ---- пейотль: закат пустыни — бирюзовые тени, оранжево-розовый свет, бегущие узоры ----
      if (uP > 0.001) {
        float lp = dot(col, vec3(0.299, 0.587, 0.114));
        // три ступени: бирюзовые тени → малиновые полутона → золотой свет (без серой середины)
        float w = clamp(lp * 1.25 - 0.08 + 0.22 * sin(uTime * 0.5 + vUv.y * 5.0 + vUv.x * 3.0), 0.0, 1.0);
        vec3 des = w < 0.5 ? mix(vec3(0.0, 0.45, 0.6), vec3(0.95, 0.15, 0.55), w * 2.0) : mix(vec3(0.95, 0.15, 0.55), vec3(1.0, 0.8, 0.2), w * 2.0 - 1.0);
        col = mix(col, des * (0.25 + lp * 1.7), 0.8 * uP);
        float st = sin((uv.y + 0.08 * sin(uv.x * 6.0 + uTime)) * 70.0 - uTime * 2.0);
        col += vec3(1.0, 0.75, 0.35) * smoothstep(0.75, 1.0, st) * 0.3 * uP;
        float zz = abs(fract((uv.x + uv.y * 0.5) * 9.0 + uTime * 0.12) - 0.5); // зубчатый орнамент
        col += vec3(0.2, 0.9, 0.85) * smoothstep(0.03, 0.0, abs(zz - 0.25)) * 0.35 * uP * smoothstep(0.15, 0.6, r);
      }
      // ---- жаба: неоновый фрактал проступает на предметах и свободно растёт по краям ----
      if (uT > 0.001) {
        vec2 z = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.2 * (1.0 + 0.25 * sin(uTime * 0.3));
        z = rot2(uTime * 0.07) * z;
        vec2 cc = vec2(0.72 + 0.06 * sin(uTime * 0.23), 0.55 + 0.06 * cos(uTime * 0.31));
        float acc = 0.0;
        float pl = 0.0;
        for (int i = 0; i < 9; i++) {
          z = abs(z) / max(dot(z, z), 0.0005) - cc;
          float m = length(z);
          acc += exp(-2.6 * abs(m - pl));
          pl = m;
        }
        acc /= 9.0;
        vec3 fr = pal(acc * 3.0 + uTime * 0.1 + r) * smoothstep(0.2, 0.8, acc) * 1.6 * vec3(0.7, 1.2, 1.05);
        col = mix(col, (col + 0.12) * (0.45 + fr * 2.0), 0.75 * uT);
        col += fr * 0.7 * uT * smoothstep(0.1, 0.55, r);
        col = mix(col, col * vec3(0.78, 1.15, 0.96), 0.4 * uT);
      }
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
    this.s = 0; // текущая (сглаженная) сила общего трипа
    this.k = { a: 0, p: 0, t: 0 }; // сглаженная сила трипов: мухомор, пейотль, жаба
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
  // trip — [мухомор, пейотль, жаба]: сколько секунд осталось каждому трипу (или null)
  update(dt, strength, left, target, trip = null) {
    const ease = (cur, goal) => {
      const v = cur + (goal - cur) * (1 - Math.exp(-dt * (goal > cur ? 0.8 : 1.5)));
      return v < 0.003 && goal === 0 ? 0 : v;
    };
    this.s = ease(this.s, left > 0 ? strength * Math.min(1, left / 6) : 0);
    const many = trip ? trip.filter((v) => v > 0).length : 0;
    ['a', 'p', 't'].forEach((key, i) => {
      const sec = trip ? trip[i] : 0;
      // несколько трипов сразу (испытание духа) — каждый чуть слабее, иначе мир не разобрать
      this.k[key] = ease(this.k[key], sec > 0 ? Math.min(1, sec / 6) * (many > 1 ? 0.72 : 1) : 0);
    });
    this.t += dt;
    const { a, p, t } = this.k;
    this.updateMotes(dt, Math.max(this.s, a, t * 0.5), target);
    this.updatePhantoms(dt, Math.max(this.s, a * 0.8, p * 0.4, t * 0.4), target);
    this.updateEyes(dt, this.s, target);
  }

  get active() {
    return this.s > 0.01 || this.k.a > 0.01 || this.k.p > 0.01 || this.k.t > 0.01;
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
    this.trip.uniforms.uA.value = this.k.a;
    this.trip.uniforms.uP.value = this.k.p;
    this.trip.uniforms.uT.value = this.k.t;
    this.trip.uniforms.uAspect.value = size.x / Math.max(1, size.y);
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
