// Превью мира: тот же остров, что строит сервер, плюс демонстрационная база и существа.
// Без сети — всё локально, чтобы посмотреть, как выглядит игра в 3D.
import * as THREE from 'three';
import { TILE, MAP_W, MAP_H, T, NPCS, STRUCTURES, RESOURCES, VIEW_MULT, TERRAIN_SPEED, isWater } from '/shared/config.js';
import { generateMap, generateResources } from '/shared/worldgen.js';
import { computeStats, decodeGenome } from '/shared/creature.js';
import { AudioManager } from './audio.js';
import { Terrain } from './gfx/terrain.js';
import { Sky } from './gfx/sky.js';
import { StaticsView } from './gfx/statics3d.js';
import { Creature3D } from './gfx/creature3d.js';
import { Decor } from './gfx/decor.js';

const SEED = 1337;
const audio = new AudioManager();
const canvas = document.getElementById('c');
const labelsEl = document.getElementById('labels');
const perfEl = document.getElementById('perf');
const measurePerf = new URLSearchParams(location.search).get('perf') === '1';
perfEl.hidden = !measurePerf;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 2, 14000);

const tiles = generateMap(SEED);
const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? T.DEEP : tiles[ty * MAP_W + tx]);
const terrain = new Terrain(tiles, SEED);
scene.add(terrain.group);
scene.add(new Decor(terrain, tiles, SEED).group);
const sky = new Sky(scene);
const statics = new StaticsView(scene, terrain);
statics.myUid = 'me';

// ---------- выбор места для базы: луг рядом с лесом, скалами и водой ----------
function findBaseSpot() {
  let best = { tx: 60, ty: 60 };
  let bestScore = -Infinity;
  for (let ty = 12; ty < MAP_H - 20; ty += 1) {
    for (let tx = 12; tx < MAP_W - 20; tx += 1) {
      let ok = true;
      for (let dy = 0; dy <= 8 && ok; dy++) {
        for (let dx = -2; dx <= 8 && ok; dx++) {
          const t = tileAt(tx + dx, ty + dy);
          if (t !== T.GRASS && t !== T.SAND) ok = false;
        }
      }
      if (!ok) continue;
      let forest = 0;
      let rock = 0;
      let water = 0;
      for (let dy = -12; dy <= 18; dy++) {
        for (let dx = -14; dx <= 20; dx++) {
          const t = tileAt(tx + dx, ty + dy);
          if (t === T.FOREST) forest++;
          else if (t === T.ROCK) rock++;
          else if (isWater(t)) water++;
        }
      }
      const score = Math.min(forest, 140) + Math.min(rock, 70) * 1.3 + Math.min(water, 50);
      if (score > bestScore) {
        bestScore = score;
        best = { tx, ty };
      }
    }
  }
  return best;
}
const { tx: bx, ty: by } = findBaseSpot();
const W = (tx) => (bx + tx) * TILE + TILE / 2;
const H = (ty) => (by + ty) * TILE + TILE / 2;

// место падения метеорита: суша в 12–18 клетках от базы
function findCrater() {
  for (let r = 13; r < 30; r++) {
    for (let a = 0; a < 32; a++) {
      const ang = -0.6 + (a / 32) * Math.PI * 2;
      const tx = Math.round(bx + 3 + Math.cos(ang) * r);
      const ty = Math.round(by + 3 + Math.sin(ang) * r);
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) if (isWater(tileAt(tx + dx, ty + dy))) ok = false;
      if (ok) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
    }
  }
  return { x: W(16), y: H(-8) };
}
const crater = findCrater();

// ---------- статичные объекты ----------
let nid = 1;
const add = (s) => {
  s.i = nid++;
  statics.upsert(s);
  return s;
};
const clearZones = [
  [W(-4) - 20, H(-2) - 20, W(9) + 20, H(9) + 20],
  [crater.x - 140, crater.y - 140, crater.x + 140, crater.y + 140],
];
for (const r of generateResources(tiles, SEED)) {
  if (clearZones.some(([x0, y0, x1, y1]) => r.x > x0 && r.x < x1 && r.y > y0 && r.y < y1)) continue;
  const hp = RESOURCES[r.kind].hp;
  add({ k: r.kind, x: r.x, y: r.y, h: hp, m: hp, v: r.v });
}

const blocked = new Set();
const S = (k, dx, dy, hpFrac = 1) => {
  const hp = STRUCTURES[k].hp;
  if (STRUCTURES[k].solid === true) blocked.add(`${bx + dx},${by + dy}`);
  return add({ k, x: W(dx), y: H(dy), h: Math.round(hp * hpFrac), m: hp, o: 'me', on: 'Вы', c: '#4fa3e0' });
};
// каменная коробка 6x5 с дверью снизу
for (let dx = 0; dx <= 5; dx++) S('wall_stone', dx, 0);
for (let dx = 0; dx <= 5; dx++) if (dx !== 2) S('wall_stone', dx, 4);
for (let dy = 1; dy <= 3; dy++) {
  S('wall_stone', 0, dy);
  S('wall_stone', 5, dy, dy === 3 ? 0.4 : 1);
}
// пристройка из частокола
S('wall_wood', -1, 0);
S('wall_wood', -2, 0);
S('wall_wood', -2, 1);
S('wall_wood', -2, 2);
S('door', 2, 4);
S('storage', 1, 1);
S('storage', 2, 1);
S('campfire', 3, 2);
S('nest', 4, 1);
S('spikes', -1, 3);
S('spikes', 6, 1);
S('campfire', -1, 6);
add({ k: 'remains', x: W(8), y: H(6) });
const damagedWall = [...statics.objs.values()].find((o) => o.s.k === 'wall_stone' && o.s.h < o.s.m);

// воронка метеорита и кристаллы
{
  const gy = terrain.heightAt(crater.x, crater.y);
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(80, 24),
    new THREE.MeshStandardMaterial({ color: '#1d1820', roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(crater.x, gy + 1.5, crater.y);
  scene.add(scorch);
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(16, 0),
    new THREE.MeshStandardMaterial({ color: '#2a2230', emissive: '#6a1fc0', emissiveIntensity: 0.55, flatShading: true }),
  );
  rock.position.set(crater.x, gy + 6, crater.y);
  rock.castShadow = true;
  scene.add(rock);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const d = 55 + (i % 3) * 22;
    add({ k: 'crystal', x: crater.x + Math.cos(a) * d, y: crater.y + Math.sin(a) * d, h: 45, m: 45, v: (i * 0.137) % 1 });
  }
}

// ---------- существа ----------
const actors = [];
function addActor(o) {
  const c = new Creature3D(o.look, o.color);
  scene.add(c.group);
  const a = {
    roam: 0, speed: 40, angle: Math.random() * 6.28, wait: Math.random() * 3, atkT: 1 + Math.random() * 2, ...o,
    c, homeX: o.x, homeY: o.y, tx: o.x, ty: o.y, speedNow: 0, gy: 0,
  };
  if (o.name) {
    a.el = document.createElement('div');
    a.el.className = 'label';
    const nm = document.createElement('span');
    nm.textContent = o.name;
    nm.style.color = o.nameColor || '#fff';
    a.el.appendChild(nm);
    if (o.hp !== undefined) {
      const bar = document.createElement('div');
      bar.className = 'hp';
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(o.hp * 100)}%`;
      bar.appendChild(fill);
      a.el.appendChild(bar);
    }
    labelsEl.appendChild(a.el);
  }
  actors.push(a);
  return a;
}

// найти клетку нужного биома поближе к точке
function nearestTile(fromX, fromY, types, minDist = 0) {
  let best = null;
  let bd = Infinity;
  for (let ty = 3; ty < MAP_H - 3; ty++) {
    for (let tx = 3; tx < MAP_W - 3; tx++) {
      if (!types.includes(tileAt(tx, ty))) continue;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      const d = Math.hypot(x - fromX, y - fromY);
      if (d >= minDist && d < bd) {
        bd = d;
        best = { x, y };
      }
    }
  }
  return best || { x: fromX, y: fromY };
}

const MY_LOOK = 'c22111210001';
const myStats = computeStats(decodeGenome(MY_LOOK));
const me = addActor({ look: MY_LOOK, color: '#4fa3e0', name: 'Вы', nameColor: '#9cf0a4', x: W(2.5) - TILE / 2, y: H(7), angle: -Math.PI / 2, me: true });
addActor({ look: 'h30002002110', color: '#e07bb5', name: 'Мира (союзник)', nameColor: '#9cf0a4', x: W(3), y: H(2.5), roam: 30, speed: 35 });
const raider = addActor({ look: 'o12300300003', color: '#d9534f', name: 'Рейдер', nameColor: '#ff8a80', hp: 0.7, x: W(5) + TILE + 30, y: H(3), angle: Math.PI, mode: 'raid' });

const meadow = { x: W(11), y: H(9) };
for (let i = 0; i < 5; i++) {
  addActor({ look: NPCS.grazer.genome, color: NPCS.grazer.color, name: i === 0 ? 'Травник' : null, x: meadow.x + (Math.random() - 0.5) * 160, y: meadow.y + (Math.random() - 0.5) * 160, roam: 130, speed: 45 });
}
const forest = nearestTile(W(2), H(2), [T.FOREST], 260);
for (let i = 0; i < 2; i++) {
  addActor({ look: NPCS.stalker.genome, color: NPCS.stalker.color, name: 'Клыкач', nameColor: '#ffb4a8', hp: 1, x: forest.x + i * 50, y: forest.y + i * 30, roam: 110, speed: 70, fighter: true });
}
const rocks = nearestTile(W(2), H(2), [T.ROCK], 500);
addActor({ look: NPCS.colossus.genome, color: NPCS.colossus.color, name: 'Колосс', nameColor: '#ffb4a8', hp: 1, x: rocks.x, y: rocks.y, roam: 90, speed: 25, fighter: true });
for (let i = 0; i < 2; i++) {
  addActor({ look: NPCS.mutant.genome, color: NPCS.mutant.color, name: 'Мутант', nameColor: '#d6a8ff', hp: 1, x: crater.x + 110 * (i ? 1 : -1), y: crater.y + 60, roam: 90, speed: 60, fighter: true });
}

function walkable(x, y, a) {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (blocked.has(`${tx},${ty}`)) return false;
  if (!a.me && isWater(tileAt(tx, ty))) return false;
  return true;
}

// ---------- ввод и камера ----------
const keys = {};
const cam = { mode: 'third', yaw: -Math.PI / 2 + 0.35, pitch: 0.3, dist: 240, orbit: 0 };
let drag = null;
let attackQueued = false;
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyM' && !e.repeat) audio.toggleMute();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
window.addEventListener('mouseup', () => {
  if (drag && drag.moved < 5 && cam.mode === 'third') attackQueued = true;
  drag = null;
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (cam.mode === 'third') {
    cam.yaw += dx * 0.006;
    cam.pitch = Math.max(0.05, Math.min(1.35, cam.pitch + dy * 0.004));
  } else {
    cam.orbit += dx * 0.004;
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.max(55, Math.min(700, cam.dist * (1 + e.deltaY * 0.001)));
}, { passive: false });

let phase = 0.3;
let running = false;
const phaseInput = document.getElementById('phase');
const runBtn = document.getElementById('run');
phaseInput.addEventListener('input', () => { phase = +phaseInput.value; });
runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.classList.toggle('on', running);
  runBtn.textContent = running ? '⏸ Пауза' : '▶ Время идёт';
});
for (const b of document.querySelectorAll('[data-time]')) {
  b.addEventListener('click', () => { phase = +b.dataset.time; phaseInput.value = phase; });
}
for (const b of document.querySelectorAll('[data-cam]')) {
  b.addEventListener('click', () => {
    cam.mode = b.dataset.cam;
    for (const o of document.querySelectorAll('[data-cam]')) o.classList.toggle('on', o === b);
    document.getElementById('crosshair').style.display = cam.mode === 'third' ? '' : 'none';
  });
}

// ---------- мини-карта ----------
const mini = document.querySelector('#minimap canvas');
const mctx = mini.getContext('2d');
const miniBase = document.createElement('canvas');
miniBase.width = MAP_W;
miniBase.height = MAP_H;
{
  const g = miniBase.getContext('2d');
  const img = g.createImageData(MAP_W, MAP_H);
  const cols = [[27, 79, 99], [60, 138, 134], [227, 208, 154], [120, 177, 83], [63, 128, 64], [143, 142, 134]];
  for (let i = 0; i < tiles.length; i++) {
    const c = cols[tiles[i]];
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
function drawMinimap(t) {
  const s = mini.width / (MAP_W * TILE);
  mctx.imageSmoothingEnabled = false;
  mctx.drawImage(miniBase, 0, 0, mini.width, mini.height);
  // база
  mctx.fillStyle = '#ffffff';
  mctx.fillRect(W(0) * s - 2, H(0) * s - 2, 6 * TILE * s, 5 * TILE * s);
  // метеорит
  mctx.strokeStyle = '#c77dff';
  mctx.lineWidth = 2;
  mctx.beginPath();
  mctx.arc(crater.x * s, crater.y * s, 5 + Math.sin(t * 4) * 2, 0, Math.PI * 2);
  mctx.stroke();
  // игрок со стрелкой взгляда
  mctx.save();
  mctx.translate(me.x * s, me.y * s);
  mctx.rotate(me.angle);
  mctx.fillStyle = '#9cf0a4';
  mctx.beginPath();
  mctx.moveTo(7, 0);
  mctx.lineTo(-5, 4.5);
  mctx.lineTo(-5, -4.5);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
}

// ---------- обновление ----------
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateMe(a, dt) {
  let fx = 0;
  let fz = 0;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  if (keys.KeyW || keys.ArrowUp) { fx += cy; fz += sy; }
  if (keys.KeyS || keys.ArrowDown) { fx -= cy; fz -= sy; }
  if (keys.KeyD || keys.ArrowRight) { fx -= sy; fz += cy; }
  if (keys.KeyA || keys.ArrowLeft) { fx += sy; fz -= cy; }
  const len = Math.hypot(fx, fz);
  let speed = 0;
  if (len > 0 && cam.mode === 'third') {
    fx /= len;
    fz /= len;
    const terr = TERRAIN_SPEED[tileAt(Math.floor(a.x / TILE), Math.floor(a.y / TILE))];
    speed = myStats.speed * terr * (keys.ShiftLeft || keys.ShiftRight ? 1.55 : 1);
    const nx = a.x + fx * speed * dt;
    const ny = a.y + fz * speed * dt;
    if (walkable(nx, a.y, a)) a.x = nx;
    if (walkable(a.x, ny, a)) a.y = ny;
    a.angle = angleLerp(a.angle, Math.atan2(fz, fx), Math.min(1, dt * 12));
  }
  if (attackQueued) {
    attackQueued = false;
    a.angle = cam.yaw;
    a.c.attack();
    audio.playAt('swing', a.x, a.y, me.x, me.y, { volume: 0.38, range: 650, yaw: me.angle });
  }
  a.speedNow = speed;
}

function updateActor(a, dt) {
  if (a.me) return updateMe(a, dt);
  if (a.mode === 'raid') {
    a.speedNow = 0;
    if (a.windupT > 0) {
      a.windupT = Math.max(0, a.windupT - dt);
      if (a.windupT === 0) {
        a.atkT = 0.95;
        a.c.attack(true);
        audio.playAt('swing', a.x, a.y, me.x, me.y, { volume: 0.24, range: 650, yaw: me.angle });
        if (damagedWall) statics.hit(damagedWall.s.i);
      }
    } else if ((a.atkT -= dt) <= 0) {
      a.windupT = 0.36;
      audio.playAt('danger', a.x, a.y, me.x, me.y, { volume: 0.36, range: 700, yaw: me.angle, rate: 1.12 });
    }
    return;
  }
  if (a.wait > 0) {
    a.wait -= dt;
    a.speedNow = 0;
  } else {
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) {
      for (let k = 0; k < 6; k++) {
        const tx = a.homeX + (Math.random() - 0.5) * 2 * a.roam;
        const ty = a.homeY + (Math.random() - 0.5) * 2 * a.roam;
        if (walkable(tx, ty, a)) {
          a.tx = tx;
          a.ty = ty;
          break;
        }
      }
      a.wait = 1 + Math.random() * 3;
    } else {
      const nx = a.x + (dx / d) * a.speed * dt;
      const ny = a.y + (dy / d) * a.speed * dt;
      if (walkable(nx, ny, a)) {
        a.x = nx;
        a.y = ny;
        a.speedNow = a.speed;
      } else {
        a.tx = a.x;
        a.ty = a.y;
      }
      a.angle = angleLerp(a.angle, Math.atan2(dy, dx), Math.min(1, dt * 5));
    }
  }
  if (a.fighter) {
    if (a.windupT > 0) {
      a.windupT = Math.max(0, a.windupT - dt);
      if (a.windupT === 0) {
        a.atkT = 2 + Math.random() * 4;
        a.c.attack(true);
        audio.playAt('swing', a.x, a.y, me.x, me.y, { volume: 0.2, range: 650, yaw: me.angle });
      }
    } else if ((a.atkT -= dt) <= 0) {
      a.windupT = a.look === NPCS.colossus.genome ? 0.56 : 0.3;
      audio.playAt('danger', a.x, a.y, me.x, me.y, { volume: 0.3, range: 700, yaw: me.angle, rate: 1.18 });
    }
  }
}

const tmpV = new THREE.Vector3();
const target = new THREE.Vector3();
let last = performance.now();
let elapsed = 0;
let firstFrame = true;
let perfFrames = 0;
let perfMark = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  if (running) {
    phase = (phase + dt / 90) % 1;
    phaseInput.value = phase;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  for (const a of actors) {
    updateActor(a, dt);
    if (a.speedNow > 34) {
      a.stepTimer = (a.stepTimer ?? Math.random() * 0.25) - dt;
      if (a.stepTimer <= 0) {
        const tile = tileAt(Math.floor(a.x / TILE), Math.floor(a.y / TILE));
        const step = tile === T.ROCK ? 'stepRock' : tile === T.SAND ? 'stepSand' : 'stepGrass';
        audio.playAt(step, a.x, a.y, me.x, me.y, { volume: a.me ? 0.52 : 0.24, range: 520, yaw: me.angle, rate: a.speedNow > 135 ? 1.08 : 0.96 });
        a.stepTimer = Math.max(0.3, Math.min(0.54, 0.58 - a.speedNow * 0.00135));
      }
    } else {
      a.stepTimer = 0.1;
    }
    const ground = terrain.heightAt(a.x, a.y);
    a.gy = Math.max(ground, -a.c.tpl.hb * 0.75);
    a.c.group.position.set(a.x, a.gy, a.y);
    a.c.group.rotation.y = -a.angle;
  }

  // камера
  let view;
  if (cam.mode === 'third') {
    target.set(me.x, me.gy + me.c.tpl.hb + 16, me.y);
    const cp = Math.cos(cam.pitch);
    camera.position.set(
      target.x - Math.cos(cam.yaw) * cp * cam.dist,
      target.y + Math.sin(cam.pitch) * cam.dist,
      target.z - Math.sin(cam.yaw) * cp * cam.dist,
    );
    const minY = terrain.heightAt(camera.position.x, camera.position.z) + 8;
    if (camera.position.y < minY) camera.position.y = minY;
    camera.lookAt(target);
    view = myStats.vision * VIEW_MULT;
  } else {
    cam.orbit += dt * 0.05;
    target.set(MAP_W * TILE * 0.5, 0, MAP_H * TILE * 0.5);
    camera.position.set(target.x + Math.cos(cam.orbit) * 2900, 2300, target.z + Math.sin(cam.orbit) * 2900);
    camera.lookAt(target);
    view = 9000;
  }
  const shadowCenter = cam.mode === 'third' ? target : tmpV.set(W(3), 0, H(3));
  const env = sky.update(phase, shadowCenter, view);
  const night = 1 - env.k;
  terrain.update(elapsed);
  statics.update(dt, camera.position, night);
  for (const a of actors) a.c.update(dt, { speed: a.speedNow, warning: a.windupT > 0, night });

  renderer.render(scene, camera);
  if (measurePerf) {
    perfFrames++;
    if (now - perfMark >= 800) {
      const seconds = (now - perfMark) / 1000;
      const pools = statics.poolSets
        ? [...statics.poolSets.values()].flatMap((set) => Object.values(set))
        : Object.values(statics.pools);
      const instances = pools.reduce((sum, pool) => sum + pool.mesh.count, 0);
      const batches = pools.reduce((sum, pool) => sum + (pool.mesh.count ? 1 : 0), 0);
      const info = renderer.info.render;
      perfEl.textContent = `${(perfFrames / seconds).toFixed(0)} FPS · ${info.calls} draw calls · ${Math.round(info.triangles / 1000)}k tris · ${instances} instances · ${batches}/${pools.length} foliage batches · ${statics.objs.size} statics`;
      perfFrames = 0;
      perfMark = now;
    }
  }

  // подписи над существами
  for (const a of actors) {
    if (!a.el) continue;
    tmpV.set(a.x, a.gy + a.c.tpl.hb + a.c.R * 1.3 + 8, a.y);
    const dist = tmpV.distanceTo(camera.position);
    tmpV.project(camera);
    const vis = cam.mode === 'third' && tmpV.z < 1 && dist < scene.fog.far * 0.85;
    a.el.style.display = vis ? '' : 'none';
    if (vis) a.el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * w}px, ${(-tmpV.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }
  drawMinimap(elapsed);

  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loading').remove();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// для отладки и скриншотов
window.preview = { cam, setPhase: (p) => { phase = p; phaseInput.value = p; }, me, actors };
