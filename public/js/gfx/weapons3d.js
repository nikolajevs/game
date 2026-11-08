// Модели оружия. Рукоять в начале координат, оружие направлено вперёд (+X).
// Размеры подобраны для существа радиуса ~18, на крупных масштабируются.
import * as THREE from 'three';
import { G, M, mergeParts } from './util.js';

const cache = new Map();
const X = -Math.PI / 2; // поворот цилиндра/конуса (ось Y) вдоль оси X

const WOOD = '#8b5a2b';
const DARK = '#5a3a1c';
const STONE = '#8a8a85';
const BONE = '#efe6cf';
const METAL = '#7d7f86';
const BLACK = '#2b2b2e';

// цилиндр вдоль X от x0 до x1
const rod = (p, x0, x1, r, color, y = 0, z = 0) => p.push({ geom: G.cyl6, matrix: M((x0 + x1) / 2, y, z, 0, 0, X, r, x1 - x0, r), color });

export function weaponGeometry(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const p = [];
  switch (kind) {
    case 'club':
      rod(p, -4, 14, 1.3, WOOD);
      p.push({ geom: G.ico, matrix: M(16, 0, 0, 0.3, 0.2, 0, 5, 4, 4), color: DARK });
      break;
    case 'spear':
      rod(p, -12, 32, 0.9, WOOD);
      rod(p, 30, 33, 1.3, '#c9b48a');
      p.push({ geom: G.cone5, matrix: M(36, 0, 0, 0, 0, X, 2.2, 8, 2.2), color: STONE });
      break;
    case 'axe':
      rod(p, -3, 16, 1.1, WOOD);
      p.push({ geom: G.box, matrix: M(15, 3.5, 0, 0, 0, 0.15, 4, 8, 1.6), color: STONE });
      rod(p, 13, 17, 1.6, '#c9b48a');
      break;
    case 'sling':
      p.push({ geom: G.box, matrix: M(5, -1, 0, 0, 0, -0.3, 11, 0.5, 1.2), color: DARK });
      p.push({ geom: G.ico, matrix: M(11, -3.5, 0, 0, 0, 0, 2.6, 2, 2.6), color: '#7a5a34' });
      p.push({ geom: G.dodeca, matrix: M(11, -2.5, 0, 0, 0, 0, 1.6), color: STONE });
      break;
    case 'blade':
      rod(p, -3, 3, 1.2, DARK);
      p.push({ geom: G.box, matrix: M(3.5, 0, 0, 0, 0, 0, 1.2, 1.2, 6), color: '#c9b48a' });
      p.push({ geom: G.box, matrix: M(12, 0, 0, 0, 0, 0, 16, 3, 0.8), color: BONE });
      p.push({ geom: G.cone5, matrix: M(21.5, 0, 0, 0, 0, X, 1.6, 4, 0.5), color: BONE });
      break;
    case 'pickaxe':
      rod(p, -3, 16, 1.1, WOOD);
      p.push({ geom: G.cone5, matrix: M(15, 5, 0, 0, 0, 0.25, 1.6, 9, 1.6), color: METAL });
      p.push({ geom: G.cone5, matrix: M(15, -4, 0, 0, 0, Math.PI - 0.25, 1.4, 7, 1.4), color: METAL });
      break;
    case 'bow': {
      p.push({ geom: G.box, matrix: M(1, 0, 0, 0, 0, 0, 2, 4, 2), color: DARK });
      const top = new THREE.Vector3(-3, 14, 0);
      const bot = new THREE.Vector3(-3, -14, 0);
      p.push({ geom: G.cyl6, matrix: M(0, 7, 0, 0, 0, 0.2, 1, 14.5, 1), color: WOOD });
      p.push({ geom: G.cyl6, matrix: M(0, -7, 0, 0, 0, -0.2, 1, 14.5, 1), color: WOOD });
      p.push({ geom: G.cyl6, matrix: M(-3, 0, 0, 0, 0, 0, 0.25, top.distanceTo(bot), 0.25), color: '#e8e0c8' });
      rod(p, -3, 14, 0.4, '#c9b48a', 0, 0); // стрела на тетиве
      break;
    }
    case 'crossbow':
      p.push({ geom: G.box, matrix: M(4, 0, 0, 0, 0, 0, 20, 2.6, 2.2), color: WOOD });
      p.push({ geom: G.box, matrix: M(13, 0.5, 0, 0, 0, 0, 1.6, 1.2, 22), color: DARK });
      p.push({ geom: G.box, matrix: M(9, 0.6, 0, 0, 0, 0, 0.3, 0.3, 20), color: '#e8e0c8' });
      p.push({ geom: G.box, matrix: M(-2, -2.5, 0, 0, 0, 0.3, 2, 4, 1.6), color: DARK });
      break;
    case 'pistol':
      p.push({ geom: G.box, matrix: M(-1, -3, 0, 0, 0, 0.25, 2.4, 6, 2), color: DARK });
      rod(p, 0, 13, 1.4, METAL, 0.5, 0);
      p.push({ geom: G.box, matrix: M(2, 0.5, 0, 0, 0, 0, 5, 3, 2.6), color: '#5e5e64' });
      p.push({ geom: G.box, matrix: M(1, 2.3, 0, 0, 0, 0, 2, 1, 1), color: BLACK });
      break;
    case 'shotgun':
      p.push({ geom: G.box, matrix: M(-6, -0.5, 0, 0, 0, 0.12, 9, 3.2, 2.2), color: WOOD });
      p.push({ geom: G.box, matrix: M(2, 0, 0, 0, 0, 0, 7, 3, 2.6), color: '#5e5e64' });
      rod(p, 4, 24, 1.1, METAL, 0.6, 0.9);
      rod(p, 4, 24, 1.1, METAL, 0.6, -0.9);
      p.push({ geom: G.box, matrix: M(12, -1.4, 0, 0, 0, 0, 10, 1.6, 2.2), color: WOOD });
      break;
    case 'bomb':
      p.push({ geom: G.sphere, matrix: M(5, 0, 0, 0, 0, 0, 4.5), color: BLACK });
      p.push({ geom: G.box, matrix: M(5, 0, 0, 0, 0, 0, 9.4, 2, 2), color: '#c9a227' });
      p.push({ geom: G.cyl6, matrix: M(5, 5.5, 0, 0, 0, 0.3, 0.4, 4, 0.4), color: '#d8c8a0' });
      break;
    default:
      return null;
  }
  const geo = mergeParts(p);
  cache.set(kind, geo);
  return geo;
}

export const weaponMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.15 });
