// Текстуры песка и скалы (свои, процедурные, бесшовные: public/assets/textures).
// В RGB — детальный цвет (около 0,9; оттенок даёт цвет вершин), в A — высота для рельефа.
// Скала накладывается «трипланарно»: на крутых склонах проецируется сбоку и не растягивается полосами.
import * as THREE from 'three';

let tex = null;
export function surfaceTextures() {
  if (tex) return tex;
  const load = (name) => {
    const t = new THREE.TextureLoader().load(`/assets/textures/${name}.webp`);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  tex = { sand: load('sand'), rock: load('rock') };
  return tex;
}

// GLSL: веса трипланарной проекции по мировой нормали (плоская заливка — нормаль из производных)
export const TRIPLANAR_GLSL = /* glsl */ `
  vec3 triWeights(vec3 wp) {
    vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));
    vec3 w = pow(abs(n), vec3(4.0));
    return w / (w.x + w.y + w.z);
  }
  vec4 triSample(sampler2D t, vec3 wp, float scale, vec3 w) {
    return texture2D(t, wp.zy / scale) * w.x + texture2D(t, wp.xz / scale) * w.y + texture2D(t, wp.xy / scale) * w.z;
  }
`;

// Валуны (InstancedMesh): текстура скалы в мировых координатах, чтобы соседние камни не повторялись
export function applyRockSurface(material, scale = 70) {
  const { rock } = surfaceTextures();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRockTex = { value: rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWP;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 rwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          rwp = instanceMatrix * rwp;
        #endif
        vRockWP = (modelMatrix * rwp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uRockTex;\nvarying vec3 vRockWP;\n${TRIPLANAR_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= triSample(uRockTex, vRockWP, ${scale.toFixed(1)}, triWeights(vRockWP)).rgb * 1.12;`);
  };
  material.customProgramCacheKey = () => `rock-surface-${scale}`;
}
