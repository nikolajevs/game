// Клиент игры: вход, сеть, интерполяция, управление, стройка, интерфейс.
import {
  TILE, MAP_W, MAP_H, STRUCTURES, STRUCT_ORDER, RESOURCES, PLAYER, PLAYER_COLORS, VIEW_MULT, isWater, ITEM_KEYS,
} from '/shared/config.js';
import { computeStats, decodeGenome, defaultGenome, encodeGenome } from '/shared/creature.js';
import { Net } from './net.js';
import { AudioManager } from './audio.js';
import { WorldView } from './world3d.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Editor } from './editor.js';
import { CreaturePreview } from './creature-preview.js';

const $ = (id) => document.getElementById(id);
const INTERP = 100; // мс задержки отрисовки чужих существ для плавности
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

const net = new Net();
const audio = new AudioManager();
const world = new WorldView($('game'), $('labels'), $('floaters'), audio);
const input = new Input($('game'));
const hud = new Hud((m) => net.send(m));
const editor = new Editor((m) => net.send(m));

const S = {
  myId: null, uid: null, tiles: null, you: null, stats: computeStats(defaultGenome()), look: '',
  phase: 0.1, meteor: null, snaps: [], offset: null,
  me: { x: 0, y: 0, face: 0, init: false }, srv: null, srvPrev: null,
  buildKind: null, lastBuildKind: 'wall_wood', ghost: null,
  structAt: new Map(), dead: false, chatOpen: false,
  lastInput: '', lastInputAt: 0, spitUntil: 0, lastMini: 0,
  aim: { x: 0, y: 0, sky: true }, // точка на земле под курсором
};
const cursorEl = $('cursor');

// ================= экран входа =================
let color = store.get('mutagen.color') || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
const nameInput = $('nameInput');
nameInput.value = store.get('mutagen.name') || '';
const joinPreview = new CreaturePreview($('joinPreview'));
joinPreview.set(encodeGenome(defaultGenome()), color);
joinPreview.start();
const colorsEl = $('colors');
for (const c of PLAYER_COLORS) {
  const b = document.createElement('button');
  b.style.background = c;
  b.className = c === color ? 'on' : '';
  b.title = c;
  b.addEventListener('click', () => {
    color = c;
    for (const o of colorsEl.children) o.classList.toggle('on', o === b);
    joinPreview.set(encodeGenome(defaultGenome()), color);
  });
  colorsEl.appendChild(b);
}
setTimeout(() => nameInput.focus(), 50);

async function join() {
  const btn = $('playBtn');
  btn.disabled = true;
  $('joinErr').textContent = '';
  const name = nameInput.value.trim() || 'Безымянный';
  store.set('mutagen.name', name);
  store.set('mutagen.color', color);
  try {
    await net.connect();
  } catch (e) {
    $('joinErr').textContent = e.message;
    btn.disabled = false;
    return;
  }
  net.send({ t: 'join', name, color, token: store.get('mutagen.token') });
}
$('playBtn').addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

// ================= сообщения сервера =================
net.on('welcome', (m) => {
  store.set('mutagen.token', m.token);
  S.myId = m.id;
  S.uid = m.uid;
  const bin = atob(m.tiles);
  const tiles = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) tiles[i] = bin.charCodeAt(i);
  S.tiles = tiles;
  S.zones = m.zones || [];
  world.init(tiles, m.seed, m.uid, S.zones);
  applyStatics(m.statics, null);
  hud.setMap(tiles, S.zones);
  $('join').classList.add('hidden');
  joinPreview.dispose();
  hud.show();
  input.enabled = true;
  hud.toast('Добро пожаловать на остров! Курсор — прицел, щелчок ЛКМ — удар, потянуть мышью — вращать камеру.');
  requestAnimationFrame(frame);
});

net.on('s', (m) => {
  const now = performance.now();
  const o = m.st - now;
  if (S.offset === null || Math.abs(o - S.offset) > 1000) S.offset = o;
  else S.offset += (o - S.offset) * 0.05;
  const ents = new Map();
  for (const e of m.e) ents.set(e.i, e);
  S.snaps.push({ st: m.st, ents });
  if (S.snaps.length > 40) S.snaps.shift();
  if (m.sa || m.sd) applyStatics(m.sa, m.sd);

  const prev = S.you;
  // сервер шлёт только ненулевые предметы — дополняем нулями
  const inv = {};
  for (const k of ITEM_KEYS) inv[k] = m.you.inv[k] || 0;
  m.you.inv = inv;
  S.you = m.you;
  S.phase = m.ph;
  S.meteor = m.m;
  world.setMeteor(m.m);
  if (m.you.g !== S.look) {
    S.look = m.you.g;
    S.stats = computeStats(decodeGenome(S.look));
  }
  const mine = ents.get(S.myId);
  if (mine) {
    S.srvPrev = S.srv;
    S.srv = { x: mine.x, y: mine.y, t: now };
    const respawned = prev && prev.dead && !m.you.dead;
    // после возрождения сразу ставим в новую точку, без «пробежки» от места гибели
    if (!S.me.init || respawned || Math.hypot(mine.x - S.me.x, mine.y - S.me.y) > 250) {
      S.me.x = mine.x;
      S.me.y = mine.y;
      S.me.face = mine.a;
      S.me.init = true;
      S.srvPrev = null;
    }
  }
  // звук ориентируем по камере: что слева на экране — слышно слева
  if (m.fx) world.handleFx(m.fx, S.me.x, S.me.y, input.cam.yaw);
  if (prev && m.you.hp < prev.hp - 1 && !m.you.dead) world.damageFeedback(prev.hp - m.you.hp);
  if (!m.you.dead && S.dead) hideDeath();
  if (m.you.dead && !S.dead && $('death').classList.contains('hidden')) showDeath({ by: 'неизвестно', nest: !!m.you.nest });
  if (hud.cont && prev && invSig(prev) !== invSig(m.you)) hud.renderContainer(m.you);
  editor.refresh(m.you);
});

net.on('toast', (m) => hud.toast(m.text, m.big));
net.on('chat', (m) => hud.chat(m));
net.on('pl', (m) => hud.setPlayers(m.list));
net.on('dead', (m) => showDeath(m));
net.on('evolved', () => editor.close());
net.on('cont', (m) => {
  if (!hud.cont) audio.play('uiOpen', { volume: 0.3 });
  hud.openContainer(m, S.you);
});
net.on('contClose', () => {
  hud.closeContainer();
  audio.play('uiClose', { volume: 0.28 });
});
net.on('close', () => {
  $('disconnected').classList.remove('hidden');
  input.enabled = false;
});

const invSig = (y) => `${y.dna}|${Object.values(y.inv).join(',')}`;

// ================= статичные объекты (зеркало для проверок на клиенте) =================
function applyStatics(sa, sd) {
  if (sd) {
    for (const id of sd) {
      const o = world.statics.objs.get(id);
      if (o && S.structAt.get(`${o.s.x},${o.s.y}`) === o.s) S.structAt.delete(`${o.s.x},${o.s.y}`);
    }
  }
  if (sa) for (const s of sa) if (STRUCTURES[s.k]) S.structAt.set(`${s.x},${s.y}`, s);
  world.applyStatics(sa, sd);
}

// ================= смерть =================
function showDeath(m) {
  S.dead = true;
  $('deathBy').textContent = `Причина: ${m.by}${m.lost ? ` · ${m.lost} 🧬 остались в останках` : ''}`;
  $('respNest').disabled = !m.nest;
  $('death').classList.remove('hidden');
  input.enabled = false;
  input.suppressHeld();
  editor.close();
  hud.closeContainer();
  setBuild(null);
}
function hideDeath() {
  S.dead = false;
  $('death').classList.add('hidden');
  // клавиши, зажатые на экране смерти, тоже не должны сразу двигать существо
  input.suppressHeld();
  // кнопка «Возродиться» не должна оставаться в фокусе (Пробел/Enter нажимали бы её снова)
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  input.enabled = !anyModal();
}
$('respNest').addEventListener('click', () => net.send({ t: 'respawn', nest: true }));
$('respRandom').addEventListener('click', () => net.send({ t: 'respawn', nest: false }));

const anyModal = () => editor.isOpen || S.dead || S.chatOpen;

// ================= чат =================
function openChat() {
  S.chatOpen = true;
  input.enabled = false;
  input.clear();
  hud.openChat();
}
function closeChat() {
  S.chatOpen = false;
  hud.closeChat();
  input.enabled = !anyModal();
}
hud.chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = hud.chatInput.value.trim();
    if (text) net.send({ t: 'chat', text });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
});

// ================= редактор =================
function toggleEditor() {
  if (editor.isOpen) {
    editor.close();
    audio.play('uiClose', { volume: 0.28 });
    return;
  }
  if (!S.you || S.you.dead) return;
  setBuild(null);
  input.enabled = false;
  input.clear();
  editor.open(S.you);
  audio.play('uiOpen', { volume: 0.3 });
}
editor.onClose = () => {
  input.enabled = !anyModal();
};
$('btnEvolve').addEventListener('click', toggleEditor);

// ================= стройка =================
function setBuild(kind) {
  S.buildKind = kind;
  if (kind) S.lastBuildKind = kind;
  if (!kind) world.setGhost(null);
}
hud.onPickBuild = (k) => setBuild(k);
hud.onEquip = (item) => net.send({ t: 'equip', item });
hud.onCloseCont = () => {
  net.send({ t: 'close' });
  hud.closeContainer();
};

function buildCheck(kind, x, y) {
  const def = STRUCTURES[kind];
  const you = S.you;
  if (Math.hypot(x - S.me.x, y - S.me.y) > PLAYER.buildRange + TILE / 2) return 'Слишком далеко';
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  if (isWater(S.tiles[ty * MAP_W + tx])) return 'Нельзя строить на воде';
  if (S.structAt.has(`${x},${y}`)) return 'Место занято';
  for (const [r, v] of Object.entries(def.cost)) if (you.inv[r] < v) return 'Не хватает ресурсов';
  if (def.solid === true) {
    for (const v of world.ents.values()) {
      const px = clamp(v.x, x - TILE / 2, x + TILE / 2);
      const py = clamp(v.y, y - TILE / 2, y + TILE / 2);
      if (Math.hypot(v.x - px, v.y - py) < v.creature.R) return v.isMe ? 'Мешаете вы сами — отойдите' : 'Мешает существо';
    }
  }
  for (const o of world.statics.objs.values()) {
    const s = o.s;
    const rd = RESOURCES[s.k];
    if (!rd || Math.abs(s.x - x) > 60 || Math.abs(s.y - y) > 60) continue;
    const px = clamp(s.x, x - TILE / 2, x + TILE / 2);
    const py = clamp(s.y, y - TILE / 2, y + TILE / 2);
    if (Math.hypot(s.x - px, s.y - py) < Math.max(rd.cr, rd.r * 0.5)) return `Мешает: ${rd.name.toLowerCase()}`;
  }
  return '';
}

// Призрак постройки идёт за курсором; если курсор дальше радиуса стройки — прижимается к краю круга
function updateBuild() {
  const active = !!(S.buildKind && S.you && !S.you.dead);
  world.setBuildRange(S.me.x, S.me.y, active);
  if (!active) {
    world.setGhost(null);
    S.ghost = null;
    return;
  }
  let ax = S.aim.x;
  let ay = S.aim.y;
  const d = Math.hypot(ax - S.me.x, ay - S.me.y);
  const R = PLAYER.buildRange;
  if (d > R) {
    ax = S.me.x + ((ax - S.me.x) / d) * R;
    ay = S.me.y + ((ay - S.me.y) / d) * R;
  }
  const x = Math.floor(ax / TILE) * TILE + TILE / 2;
  const y = Math.floor(ay / TILE) * TILE + TILE / 2;
  const reason = buildCheck(S.buildKind, x, y);
  S.ghost = { x, y, reason };
  world.setGhost(S.buildKind, x, y, !reason);
}

input.onLeftDown = () => {
  if (!S.buildKind) return false;
  if (S.ghost) {
    if (S.ghost.reason) hud.toast(S.ghost.reason);
    else net.send({ t: 'build', kind: S.buildKind, x: S.ghost.x, y: S.ghost.y });
  }
  return true;
};

// щелчок ПКМ: в стройке — отмена, иначе плевок кислотой
input.onRightClick = () => {
  if (S.buildKind) setBuild(null);
  else S.spitUntil = performance.now() + 90;
};

// постройка под курсором
function targetStructure() {
  if (S.aim.sky) return null;
  const x = Math.floor(S.aim.x / TILE) * TILE + TILE / 2;
  const y = Math.floor(S.aim.y / TILE) * TILE + TILE / 2;
  const s = S.structAt.get(`${x},${y}`);
  if (!s || Math.hypot(s.x - S.me.x, s.y - S.me.y) > PLAYER.buildRange + TILE * 2) return null;
  return world.statics.objs.get(s.i)?.s || s;
}

// угол от своего существа к точке прицела
function aimAngle() {
  const dx = S.aim.x - S.me.x;
  const dy = S.aim.y - S.me.y;
  return Math.hypot(dx, dy) > 8 ? Math.atan2(dy, dx) : S.me.face;
}

// ================= клавиши =================
input.onPress = (code) => {
  if (!S.you) return;
  if (code === 'Escape') {
    if (editor.isOpen) editor.close();
    else if (hud.cont) hud.onCloseCont();
    else if (S.buildKind) setBuild(null);
    return;
  }
  if (S.dead) return;
  if (code === 'KeyM') return hud.toast(audio.toggleMute() ? 'Звук выключен' : 'Звук включён');
  if (code === 'KeyG') return toggleEditor();
  if (editor.isOpen) return;
  if (code === 'Enter') return openChat();
  if (code === 'Tab') return hud.togglePlayers(true);
  if (code === 'KeyH') return $('helpBox').classList.toggle('hidden');
  if (code === 'KeyE') {
    if (hud.cont) hud.onCloseCont();
    else net.send({ t: 'interact' });
    return;
  }
  if (code === 'KeyF') return net.send({ t: 'eat' });
  if (code === 'KeyR') return net.send({ t: 'use', item: 'antirad' });
  if (code === 'KeyC') return hud.toggleCraft();
  if (code === 'KeyB') return setBuild(S.buildKind ? null : S.lastBuildKind);
  if (code.startsWith('Digit')) {
    const n = Number(code.slice(5));
    if (S.buildKind) {
      // в режиме стройки цифры выбирают постройку
      const k = STRUCT_ORDER[n - 1];
      if (k) setBuild(k);
    } else {
      // иначе — оружие из пояса; повторное нажатие убирает его
      const k = hud.belt[n - 1];
      if (k) net.send({ t: 'equip', item: S.you.wp === k ? null : k });
    }
    return;
  }
  if (code === 'KeyX') {
    const s = targetStructure();
    if (s && s.o === S.uid) net.send({ t: 'demolish', id: s.i });
    else if (s) hud.toast('Сносить можно только свои постройки');
    return;
  }
  if (code === 'Space' && S.stats.charge && input.enabled) {
    S.me.face = aimAngle();
    net.send({ t: 'charge', ang: Math.round(S.me.face * 100) / 100 });
  }
};
input.onRelease = (code) => {
  if (code === 'Tab') hud.togglePlayers(false);
};

// ================= интерполяция =================
function interpolate(now) {
  const snaps = S.snaps;
  if (!snaps.length) return [];
  const rt = now + S.offset - INTERP;
  let i = snaps.length - 1;
  while (i > 0 && snaps[i].st > rt) i--;
  const s0 = snaps[i];
  const s1 = snaps[Math.min(i + 1, snaps.length - 1)];
  const span = s1.st - s0.st;
  const t = span > 0 ? clamp((rt - s0.st) / span, 0, 1) : 1;
  const out = [];
  for (const e of s1.ents.values()) {
    const p = s0.ents.get(e.i);
    if (!p || t >= 1) {
      out.push(e);
      continue;
    }
    out.push({ ...e, x: lerp(p.x, e.x, t), y: lerp(p.y, e.y, t), a: e.a !== undefined ? angleLerp(p.a, e.a, t) : e.a });
  }
  return out;
}

// ================= игровой кадр =================
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
  if (!S.you) return;
  const you = S.you;
  input.update(dt);

  // своё существо: догоняем сервер с небольшим предсказанием по скорости
  if (S.srv) {
    let tx = S.srv.x;
    let ty = S.srv.y;
    if (S.srvPrev && S.srv.t > S.srvPrev.t) {
      const k = Math.min(0.08, (now - S.srv.t) / 1000) / ((S.srv.t - S.srvPrev.t) / 1000);
      tx += (S.srv.x - S.srvPrev.x) * k;
      ty += (S.srv.y - S.srvPrev.y) * k;
    }
    const f = 1 - Math.exp(-dt * 16);
    S.me.x += (tx - S.me.x) * f;
    S.me.y += (ty - S.me.y) * f;
  }

  // камера, затем точка прицела под курсором
  const myView = world.ents.get(S.myId);
  const hb = myView ? myView.creature.tpl.hb : 20;
  if (you.dead) input.cam.yaw += dt * 0.15;
  world.updateCamera(S.me.x, S.me.y, hb, input.cam, dt);
  const hit = world.pickAt(input.pos.x, input.pos.y);
  if (hit) S.aim = { x: hit.x, y: hit.y, sky: false };
  else {
    // курсор в небе — целимся по горизонтальному направлению луча
    const d = world.rayDir;
    const len = Math.hypot(d.x, d.z) || 1;
    S.aim = { x: S.me.x + (d.x / len) * 400, y: S.me.y + (d.z / len) * 400, sky: true };
  }

  // ввод: существо смотрит на курсор, когда бьёт, плюётся, строит или стоит на месте
  const mv = input.moveVector();
  const attacking = input.enabled && !S.buildKind && (input.mouse.l || now - (input.lastClick || 0) < 90);
  const spitting = input.enabled && !S.buildKind && (input.keys.KeyQ || now < S.spitUntil);
  if (!you.dead) {
    const aim = aimAngle();
    if (attacking || spitting || S.buildKind) S.me.face = aim;
    else if (mv.x || mv.y) S.me.face = angleLerp(S.me.face, Math.atan2(mv.y, mv.x), 1 - Math.exp(-dt * 12));
    else if (input.pos.inside && !input.rotating) S.me.face = angleLerp(S.me.face, aim, 1 - Math.exp(-dt * 6));
  }
  const msg = {
    t: 'in', mx: Math.round(mv.x * 100) / 100, my: Math.round(mv.y * 100) / 100,
    s: input.enabled && (input.keys.ShiftLeft || input.keys.ShiftRight) ? 1 : 0,
    a: attacking ? 1 : 0, b: spitting ? 1 : 0, ang: Math.round(S.me.face * 100) / 100,
  };
  const sig = `${msg.mx},${msg.my},${msg.s},${msg.a},${msg.b},${msg.ang}`;
  if ((sig !== S.lastInput && now - S.lastInputAt > 33) || now - S.lastInputAt > 250) {
    net.send(msg);
    S.lastInput = sig;
    S.lastInputAt = now;
  }

  const ents = interpolate(now);
  world.listenerYaw = input.cam.yaw;
  world.syncEntities(ents, dt, S.myId, S.me);
  updateBuild();
  updateHint();
  const showCursor = input.enabled && input.pos.inside && !you.dead;
  world.setAim(S.aim.sky ? null : S.aim, showCursor && !S.buildKind);
  cursorEl.style.display = showCursor ? '' : 'none';
  if (showCursor) cursorEl.style.transform = `translate(${input.pos.x}px, ${input.pos.y}px)`;
  world.render(dt, S.phase, you.dead ? 900 : S.stats.vision * VIEW_MULT);

  hud.update(you, S.stats, { buildKind: S.buildKind });
  hud.clock(S.phase);
  if (now - S.lastMini > 100) {
    S.lastMini = now;
    const mine = [];
    for (const s of S.structAt.values()) if (s.o === S.uid) mine.push(s);
    hud.drawMinimap(S.me, S.me.face, you.nest, S.meteor, mine, now / 1000);
  }
}

function nearWater(x, y, r) {
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const tx = Math.floor((x + Math.cos(ang) * r) / TILE);
    const ty = Math.floor((y + Math.sin(ang) * r) / TILE);
    if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && isWater(S.tiles[ty * MAP_W + tx])) return true;
  }
  return false;
}

function updateHint() {
  const you = S.you;
  if (you.dead || editor.isOpen) return hud.setHint('');
  if (S.buildKind) {
    const def = STRUCTURES[S.buildKind];
    const why = S.ghost?.reason ? `<br><span style="color:#ff8a80">${S.ghost.reason}</span>` : '';
    return hud.setHint(`🔨 ${def.name} — <b>ЛКМ</b> поставить, <b>ПКМ</b> или <b>B</b> отмена<br><span class="sub">${def.desc}</span>${why}`);
  }
  const lines = [];
  const R = S.stats.radius + PLAYER.interactRange;
  let cont = null;
  for (const o of world.statics.objs.values()) {
    const s = o.s;
    if (s.k !== 'storage' && s.k !== 'remains' && s.k !== 'crate') continue;
    if (Math.abs(s.x - S.me.x) > R + 30 || Math.abs(s.y - S.me.y) > R + 30) continue;
    if (Math.hypot(s.x - S.me.x, s.y - S.me.y) - (s.k === 'storage' ? 20 : 16) <= R) cont = s;
  }
  const contLabel = { remains: `обыскать останки (${cont?.on || '?'})`, crate: 'открыть ящик с добычей', storage: 'открыть хранилище' };
  if (hud.cont) lines.push('<b>E</b> — закрыть');
  else if (cont) lines.push(`<b>E</b> — ${contLabel[cont.k]}`);
  else if (nearWater(S.me.x, S.me.y, S.stats.radius + 26) && you.w < 99) lines.push('<b>E</b> — пить');
  const t = targetStructure();
  if (t) {
    const def = STRUCTURES[t.k];
    const mine = t.o === S.uid;
    lines.push(`<span class="sub">${def.name} · ${mine ? 'ваша' : t.on || '?'} · ${t.h}/${t.m}${mine ? ' · <b>X</b> снести' : ''}</span>`);
  }
  hud.setHint(lines.join('<br>'));
}

// для отладки из консоли браузера
window.mutagen = { S, input, world, net };
