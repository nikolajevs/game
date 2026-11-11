// Вода без лишних проходов отрисовки: рябь из двух бегущих карт нормалей, отражение неба по углу
// взгляда (Френель), блики солнца, цвет по глубине (бирюза у берега, синева в глубине), пена у кромки
// и мягкие волны рядом с игроком. Глубину берём из карты клеток острова — без буфера глубины.
import * as THREE from 'three';
import { MAP_W, MAP_H, WORLD_W, WORLD_H, T } from '/shared/config.js';
import { CLOUDS_GLSL } from './sky.js';

const vertex = () => /* glsl */ `
  uniform float uTime;
  uniform vec2 uWorld;
  uniform sampler2D uDepth;
  varying vec3 vWorld;
  varying float vWave;
  varying vec2 vSlope; // наклон волн — для освещения
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // волны: несколько гребней в разные стороны; у берега и вдали от камеры стихают
    float bed = texture2D(uDepth, wp.xz / uWorld).r * ${H_RANGE.toFixed(1)} + ${H_MIN.toFixed(1)};
    float depth = clamp(-bed / 46.0, 0.0, 1.0);
    float dist = length(wp.xz - cameraPosition.xz);
    float amp = smoothstep(0.08, 0.6, depth) * (1.0 - smoothstep(900.0, 1800.0, dist));
    // три гребня разной длины (≈180, 120 и 75 ед.) — высота и наклон (для бликов и отражений)
    vec2 k1 = vec2(0.030, 0.018); vec2 k2 = vec2(-0.022, 0.044); vec2 k3 = vec2(0.068, -0.045);
    float p1 = dot(wp.xz, k1) + uTime * 1.2;
    float p2 = dot(wp.xz, k2) + uTime * 0.95;
    float p3 = dot(wp.xz, k3) + uTime * 1.8;
    float w = sin(p1) * 1.8 + sin(p2) * 1.2 + sin(p3) * 0.6;
    vec2 slope = k1 * cos(p1) * 1.8 + k2 * cos(p2) * 1.2 + k3 * cos(p3) * 0.6;
    wp.y += w * amp;
    vWave = w * amp;
    vSlope = slope * amp;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = () => /* glsl */ `
  uniform float uTime;
  uniform vec2 uWorld;
  uniform sampler2D uDepth;
  uniform sampler2D uNormal;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHor;
  uniform float uLight; // 0 ночь .. 1 день
  uniform float uCloudTime;
  uniform float uCover;
  varying vec3 vWorld;
  varying float vWave;
  varying vec2 vSlope;
  #include <common>
  ${CLOUDS_GLSL}
  #include <fog_pars_fragment>

  vec3 sampleN(vec2 uv) {
    vec3 n = texture2D(uNormal, uv).xyz * 2.0 - 1.0;
    return vec3(n.x, n.z, n.y); // карта: z вверх -> мир: y вверх
  }

  void main() {
    vec2 p = vWorld.xz;
    float bed = texture2D(uDepth, p / uWorld).r * ${H_RANGE.toFixed(1)} + ${H_MIN.toFixed(1)}; // высота дна
    float depth = clamp(-bed / 46.0, 0.0, 1.0); // 0 у кромки .. 1 в глубине
    float dist = length(cameraPosition - vWorld);

    // рябь: две карты нормалей бегут навстречу друг другу; вдали сглаживается (без мерцания)
    vec3 n1 = sampleN(p / 260.0 + uTime * vec2(0.011, 0.007));
    vec3 n2 = sampleN(p / 97.0 + uTime * vec2(-0.009, 0.014));
    vec3 n = normalize(vec3(n1.x + n2.x, n1.y * n2.y, n1.z + n2.z));
    float calm = smoothstep(700.0, 3500.0, dist);
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), calm * 0.7));
    // крупные волны наклоняют поверхность: гребни ловят небо и солнце
    n = normalize(vec3(n.x - vSlope.x * 1.6, n.y, n.z - vSlope.y * 1.6));

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 R = reflect(-V, n);
    // Френель: под острым углом вода — зеркало неба, сверху видно толщу
    float F = 0.05 + 0.95 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
    vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6));
    // в воде отражаются те же облака, что на небе
    sky = mix(sky, cloudColor(R, uSunDir, uSunColor, uSkyHor, uLight), cloudDensity(R, uCloudTime, uCover) * 0.85);

    // цвет толщи: бирюза на мелководье -> глубокая синева
    vec3 shallow = vec3(0.10, 0.62, 0.60);
    vec3 deep = vec3(0.012, 0.13, 0.24);
    vec3 body = mix(shallow, deep, smoothstep(0.08, 0.75, depth));
    body *= 0.35 + 0.65 * uLight;
    // гребни волн чуть светлее
    body += vec3(0.04, 0.08, 0.08) * clamp(vWave * 0.35, 0.0, 1.0) * (0.3 + 0.7 * uLight);

    vec3 col = mix(body, sky, F);

    // солнце: широкое сияние и острые искры на ряби
    float sd = max(dot(R, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 1200.0) * 3.0 + pow(sd, 120.0) * 0.3) * smoothstep(-0.05, 0.1, uSunDir.y);

    // пена: полоса у кромки + набегающие на берег линии, рваные по карте ряби
    // кромка — плотная белая полоса; набегающие валики — на бирюзовой воде, движутся к берегу
    // дно у берега уходит вниз круто (~4 ед. высоты на 10 ед. пути) — пена задана шире, чтобы была видна
    float edge = 1.0 - smoothstep(2.0, 10.0, -bed);
    float lines = smoothstep(0.55, 1.0, sin(-bed * 1.0 + uTime * 1.3)) * smoothstep(3.0, 5.0, -bed) * (1.0 - smoothstep(10.0, 14.0, -bed));
    // пена рваная: у самой кромки плотная, дальше — клочьями по узору ряби
    float tex = smoothstep(-0.25, 0.45, n1.x + n2.z + sin(p.x * 0.05 + uTime * 0.7) * 0.15);
    float breakup = mix(tex, 1.0, smoothstep(5.0, 2.5, -bed) * 0.7);
    float foam = clamp((edge * 0.95 + lines * 0.75) * breakup, 0.0, 1.0);
    col = mix(col, vec3(1.0) * (0.45 + 0.55 * uLight), foam);

    // на мелководье сквозь воду видно дно
    float alpha = mix(0.45, 0.93, smoothstep(0.02, 0.5, depth));
    alpha = clamp(alpha + F * 0.35 + foam * 0.9, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// Сетка воды: кольца, густые у центра (там волны) и редкие к горизонту. Центр едет за камерой.
function ringGeometry() {
  const radii = [0];
  for (let r = 8; r < 140000; r *= 1.11) radii.push(r);
  const seg = 96;
  const pos = [];
  const idx = [];
  for (let i = 0; i < radii.length; i++) {
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  for (let i = 0; i < radii.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * seg + k;
      const b = i * seg + ((k + 1) % seg);
      const c = (i + 1) * seg + k;
      const d = (i + 1) * seg + ((k + 1) % seg);
      idx.push(a, b, c, b, d, c); // лицом вверх (иначе сверху треугольники отсекаются)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Высота дна по клеткам — те же базовые высоты, что у рельефа (глубина −46, мелководье −13, песок 4…),
// с той же билинейной выборкой: линия «высота = 0» совпадает с кромкой воды на берегу.
const BASE_H = [-46, -13, 4, 12, 16, 26, 13, 13, 13, 17, 2.2];
const H_MIN = -46;
const H_RANGE = 72;
function depthTexture(tiles) {
  const data = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < tiles.length; i++) data[i] = Math.round(((BASE_H[tiles[i]] - H_MIN) / H_RANGE) * 255);
  const t = new THREE.DataTexture(data, MAP_W, MAP_H, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export class Water {
  constructor(tiles) {
    const normal = new THREE.TextureLoader().load('/assets/textures/water_normal.webp');
    normal.wrapS = THREE.RepeatWrapping;
    normal.wrapT = THREE.RepeatWrapping;
    normal.anisotropy = 8;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uWorld: { value: new THREE.Vector2(WORLD_W, WORLD_H) },
        uDepth: { value: null },
        uNormal: { value: null },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
        uSunColor: { value: new THREE.Color('#fff4e0') },
        uSkyTop: { value: new THREE.Color('#6fa8dc') },
        uSkyHor: { value: new THREE.Color('#cfe6f2') },
        uLight: { value: 1 },
        uCloudTime: { value: 0 },
        uCover: { value: 0.55 },
      }]),
      vertexShader: vertex(),
      fragmentShader: fragment(),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    // текстуры — после merge (UniformsUtils клонирует значения)
    this.material.uniforms.uDepth.value = depthTexture(tiles);
    this.material.uniforms.uNormal.value = normal;
    this.mesh = new THREE.Mesh(ringGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  // sky — Sky: цвета неба и направление солнца; light — 0 ночь .. 1 день
  update(t, target, sky = null, light = 1) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    if (target) this.mesh.position.set(Math.round(target.x / 16) * 16, 0, Math.round(target.z / 16) * 16);
    if (sky) {
      u.uSkyTop.value.copy(sky.top);
      u.uSkyHor.value.copy(sky.hor);
      u.uSunDir.value.copy(sky.sun.position).sub(sky.sun.target.position).normalize();
      u.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.min(1.4, sky.sun.intensity * 0.5));
      u.uCloudTime.value = sky.cloudTime ?? 0;
      u.uCover.value = sky.cover ?? 0.55;
    }
    u.uLight.value = light;
  }
}
