// Клиент игры: вход, сеть, интерполяция, управление, стройка, интерфейс.
import {
  TILE, MAP_W, MAP_H, STRUCTURES, STRUCT_ORDER, BUILD_CATS, BUILD_PAINT, buildCost, ITEMS, RESOURCES, PLAYER, PLAYER_COLORS, VIEW_MULT, isWater, ITEM_KEYS, SITES, ABILITIES,
} from '/shared/config.js';
import { zoneAt, generateMap, tilesHash } from '/shared/worldgen.js';
import { computeStats, decodeGenome, defaultGenome, encodeGenome } from '/shared/creature.js';
import { Net } from './net.js';
import { AudioManager } from './audio.js';
import { WorldView } from './world3d.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Editor } from './editor.js';
import { CreaturePreview } from './creature-preview.js';
import { PathsWindow } from './paths.js';
import { HAIR_COLORS, parseLook } from './gfx/human3d.js';

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
const paths = new PathsWindow((m) => net.send(m));

const S = {
  myId: null, uid: null, tiles: null, you: null, stats: computeStats(defaultGenome()), look: '',
  phase: 0.1, meteor: null, snaps: [], offset: null,
  me: { x: 0, y: 0, face: 0, init: false }, srv: null, srvPrev: null,
  ghost: null,
  structAt: new Map(), dead: false, chatOpen: false,
  lastInput: '', lastInputAt: 0, spitUntil: 0, lastMini: 0,
  aim: { x: 0, y: 0, sky: true }, // точка на земле под курсором
  ready: false, pendingRes: [],
  siteId: -1, siteToast: {}, // текущее особое место и когда о нём последний раз подсказывали
};
const cursorEl = $('cursor');

// ================= экран входа =================
let color = store.get('mutagen.color') || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
let authMode = 'login';
let activeAccount = null;
let legacyToken = store.get('mutagen.token');
const authUsername = $('authUsername');
const authPassword = $('authPassword');
const authSubmit = $('authSubmit');
const nameInput = $('nameInput');
nameInput.value = store.get('mutagen.name') || '';
// внешность: пол.кожа.причёска.цвет волос.борода
const look = parseLook(store.get('mutagen.ap') || `${Math.random() < 0.5 ? 'm' : 'f'}.0.1.0.0`);
const lookStr = () => `${look.sex}.${look.skin}.${look.hair}.${look.hairColor}.${look.sex === 'm' && look.beard ? 1 : 0}`;
const HAIR_NAMES = { m: ['Лысый', 'Ёжик', 'Пробор'], f: ['Длинные', 'Пучки', 'Короткая'] };
const joinPreview = new CreaturePreview($('joinPreview'));
const updatePreview = () => joinPreview.set(encodeGenome(defaultGenome()), color, lookStr());
// ряд кнопок-переключателей
function segment(el, options, get, set) {
  el.innerHTML = '';
  options.forEach(([value, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = get() === value ? 'on' : '';
    b.addEventListener('click', () => {
      set(value);
      renderLook();
    });
    el.appendChild(b);
  });
}
function renderLook() {
  segment($('lookSex'), [['m', 'Мужчина'], ['f', 'Женщина']], () => look.sex, (v) => {
    if (look.sex !== v) look.hair = v === 'm' ? 1 : 0;
    look.sex = v;
  });
  segment($('lookSkin'), [[0, 'Смуглая'], [1, 'Светлая']], () => look.skin, (v) => { look.skin = v; });
  segment($('lookHair'), HAIR_NAMES[look.sex].map((n, i) => [i, n]), () => look.hair, (v) => { look.hair = v; });
  const male = look.sex === 'm';
  $('lookBeardLabel').style.visibility = male ? '' : 'hidden';
  $('lookBeard').style.visibility = male ? '' : 'hidden';
  segment($('lookBeard'), [[false, 'Нет'], [true, 'Есть']], () => look.beard, (v) => { look.beard = v; });
  const sw = $('lookHairColor');
  sw.innerHTML = '';
  HAIR_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = c;
    b.className = look.hairColor === i ? 'on' : '';
    b.addEventListener('click', () => {
      look.hairColor = i;
      renderLook();
    });
    sw.appendChild(b);
  });
  updatePreview();
}
const colorsEl = $('colors');
for (const c of PLAYER_COLORS) {
  const b = document.createElement('button');
  b.style.background = c;
  b.className = c === color ? 'on' : '';
  b.title = 'Цвет метки на карте';
  b.addEventListener('click', () => {
    color = c;
    for (const o of colorsEl.children) o.classList.toggle('on', o === b);
    updatePreview();
  });
  colorsEl.appendChild(b);
}
renderLook();
joinPreview.start();

function setAuthMode(mode) {
  authMode = mode;
  for (const button of document.querySelectorAll('[data-auth-mode]')) {
    button.classList.toggle('on', button.dataset.authMode === mode);
  }
  authSubmit.textContent = mode === 'register' ? 'Создать аккаунт' : 'Войти';
  authPassword.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  $('authErr').textContent = '';
}

for (const button of document.querySelectorAll('[data-auth-mode]')) {
  button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
}

async function authRequest(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Не удалось войти.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function setAuthenticated(account) {
  activeAccount = account;
  store.set('mutagen.token', account.token);
  authUsername.value = account.username;
  $('accountName').textContent = account.username;
  $('authPanel').classList.add('hidden');
  $('characterSetup').classList.remove('hidden');
  nameInput.value = store.get('mutagen.name') || account.username;
  $('joinErr').textContent = '';
}

function logout() {
  activeAccount = null;
  store.set('mutagen.token', '');
  $('characterSetup').classList.add('hidden');
  $('authPanel').classList.remove('hidden');
  authPassword.value = '';
  $('joinErr').textContent = '';
  authUsername.focus();
}

$('logoutBtn').addEventListener('click', logout);

$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  authSubmit.disabled = true;
  $('authErr').textContent = '';
  try {
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const credentials = {
      username: authUsername.value,
      password: authPassword.value,
    };
    if (authMode === 'register' && legacyToken) credentials.legacyToken = legacyToken;
    const account = await authRequest(endpoint, credentials);
    if (authMode === 'register') legacyToken = null;
    authPassword.value = '';
    setAuthenticated(account);
  } catch (error) {
    $('authErr').textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

async function restoreSession() {
  const token = store.get('mutagen.token');
  if (!token) {
    setTimeout(() => authUsername.focus(), 50);
    return;
  }
  authSubmit.disabled = true;
  $('authErr').textContent = 'Проверяем сохранённый вход…';
  try {
    const account = await authRequest('/api/auth/session', { token });
    setAuthenticated(account);
  } catch (error) {
    if (error.status === 401) {
      store.set('mutagen.token', '');
      $('authErr').textContent = 'Войдите в аккаунт.';
    } else {
      $('authErr').textContent = 'Не удалось проверить вход. Проверьте соединение.';
    }
  } finally {
    authSubmit.disabled = false;
  }
}
restoreSession();

async function join() {
  const btn = $('playBtn');
  btn.disabled = true;
  $('joinErr').textContent = '';
  if (!activeAccount) {
    $('joinErr').textContent = 'Сначала войдите в аккаунт.';
    btn.disabled = false;
    return;
  }
  const name = nameInput.value.trim() || activeAccount.username;
  store.set('mutagen.name', name);
  store.set('mutagen.color', color);
  store.set('mutagen.ap', lookStr());
  try {
    await net.connect();
  } catch (e) {
    $('joinErr').textContent = e.message;
    btn.disabled = false;
    return;
  }
  net.send({ t: 'join', name, color, ap: lookStr(), token: activeAccount.token });
}
$('playBtn').addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

// ================= сообщения сервера =================
// Остров огромный, поэтому сервер присылает только зерно и контрольную сумму:
// браузер строит карту сам, а если сумма не сошлась — просит карту целиком.
let tilesWaiter = null;
net.on('tiles', (m) => {
  const bin = atob(m.tiles);
  const tiles = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) tiles[i] = bin.charCodeAt(i);
  tilesWaiter?.(tiles);
});
async function buildTiles(seed, hash) {
  const tiles = generateMap(seed);
  if (tilesHash(tiles) === hash) return tiles;
  console.warn('Карта не совпала с серверной — загружаем целиком');
  return new Promise((resolve) => {
    tilesWaiter = resolve;
    net.send({ t: 'tiles' });
  });
}

net.on('welcome', async (m) => {
  store.set('mutagen.token', m.token);
  S.myId = m.id;
  S.uid = m.uid;
  $('playBtn').textContent = 'Строим остров…';
  await new Promise((r) => setTimeout(r, 30)); // дать браузеру показать надпись
  const tiles = await buildTiles(m.seed, m.th);
  S.tiles = tiles;
  S.zones = m.zones || [];
  world.init(tiles, m.seed, m.uid, S.zones);
  applyStatics(m.statics, null);
  hud.setMap(tiles, S.zones);
  hud.setBuildIcons(world.structureIcons(STRUCT_ORDER));
  S.ready = true;
  for (const r of S.pendingRes.splice(0)) applyRes(r);
  try {
    const saved = JSON.parse(store.get('mutagen.marker') || 'null');
    if (saved && Number.isFinite(saved.x)) setMarker(saved, true);
  } catch { /* старая или битая метка — без неё */ }
  $('join').classList.add('hidden');
  joinPreview.dispose();
  editor.ap = lookStr();
  hud.show();
  input.enabled = true;
  hud.toast('Добро пожаловать на остров! Курсор — прицел, щелчок ЛКМ — удар, потянуть мышью — вращать камеру.');
  requestAnimationFrame(frame);
});

// ресурсы приходят участками вокруг игрока: ближние добавляем, дальние забываем
function applyRes(m) {
  if (m.drop?.length) world.dropResChunks(m.drop);
  if (m.add?.length) applyStatics(m.add, null);
}
net.on('res', (m) => {
  if (!S.ready) S.pendingRes.push(m);
  else applyRes(m);
});

net.on('s', (m) => {
  if (!S.ready) return; // остров ещё строится
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
    // t — когда пакет пришёл (по часам браузера), st — когда сервер его отправил
    S.srv = { x: mine.x, y: mine.y, t: now, st: m.st };
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
  paths.refresh(m.you);
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
  if (S.myId !== null) {
    $('disconnected').classList.remove('hidden');
    input.enabled = false;
    input.releaseLock();
  }
});
net.on('authError', (m) => {
  $('joinErr').textContent = m.text || 'Не удалось войти в игру.';
  $('playBtn').disabled = false;
  net.disconnect();
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
  $('deathBy').textContent = `Причина: ${m.by}${m.lost ? ` · ${m.lost} ☣ мутагена осталось в останках` : ''}`;
  $('respNest').disabled = !m.nest;
  $('death').classList.remove('hidden');
  input.enabled = false;
  input.suppressHeld();
  editor.close();
  hud.closeContainer();
  setBuildMode(null);
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

const anyModal = () => editor.isOpen || paths.isOpen || S.dead || S.chatOpen;

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
  setBuildMode(null);
  input.enabled = false;
  input.clear();
  editor.open(S.you);
  audio.play('uiOpen', { volume: 0.3 });
}
editor.onClose = () => {
  input.enabled = !anyModal();
};
$('btnEvolve').addEventListener('click', toggleEditor);

// ================= пути развития =================
function togglePaths() {
  if (paths.isOpen) {
    paths.close();
    audio.play('uiClose', { volume: 0.28 });
    return;
  }
  if (!S.you || S.you.dead) return;
  setBuildMode(null);
  if (editor.isOpen) editor.close();
  input.enabled = false;
  input.clear();
  paths.open(S.you);
  audio.play('uiOpen', { volume: 0.3 });
}
paths.onClose = () => {
  input.enabled = !anyModal();
};
$('btnPath').addEventListener('click', togglePaths);

// умение из пояса: заклинание берём «в руку», мгновенное применяем сразу
function useSkill(id) {
  const ab = ABILITIES[id];
  if (!ab || !S.you) return;
  if (ab.kind === 'instant') net.send({ t: 'cast', id });
  else net.send({ t: 'equip', item: S.you.wp === id ? null : id });
}
hud.onSkill = useSkill;

// ================= метка на карте =================
function setMarker(m, silent = false) {
  S.marker = m;
  store.set('mutagen.marker', m ? JSON.stringify(m) : '');
  hud.setMarker(m);
  world.setMarker(m);
  if (!silent) {
    audio.play(m ? 'uiSelect' : 'uiClose', { volume: 0.3 });
    hud.toast(m ? '📍 Метка поставлена — её видно на карте и столбом света в мире' : 'Метка убрана');
  }
}
hud.onMarker = (m) => setMarker(m);

// ================= стройка =================
// mode: null — стройка закрыта, 'place' — ставим постройку kind, 'repair' и 'demolish' — чиним и сносим свои.
// cat — открытый раздел меню, last — что было выбрано в каждом разделе, target — постройка под курсором.
const B = { mode: null, cat: 0, kind: 'wall_wood', last: {}, target: null, cell: '', placedAt: 0, count: 0, countAt: 0 };
function setBuildMode(mode) {
  B.mode = mode || null;
  B.cell = '';
  if (!B.mode) {
    world.setGhost(null);
    hud.setBuildTip(null);
  }
}
function pickBuild(kind) {
  if (!STRUCTURES[kind]) return;
  B.kind = kind;
  B.cat = Math.max(0, BUILD_CATS.findIndex((c) => c.items.includes(kind)));
  B.last[B.cat] = kind;
  setBuildMode('place');
}
function setBuildCat(i) {
  B.cat = (i + BUILD_CATS.length) % BUILD_CATS.length;
  pickBuild(B.last[B.cat] || BUILD_CATS[B.cat].items[0]);
}
hud.onPickBuild = pickBuild;
hud.onBuildCat = setBuildCat;
hud.onBuildTool = setBuildMode;
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
  if (S.tiles[ty * MAP_W + tx] === 7) return 'Здесь стоит стена';
  if (S.structAt.has(`${x},${y}`)) return 'Место занято';
  if (def.ability && !(you.ab || []).includes(def.ability)) return `Нужно умение «${ABILITIES[def.ability].name}» (путь разума, P)`;
  for (const [r, v] of Object.entries(buildCost(kind, you.pa))) {
    if ((you.inv[r] || 0) < v) return def.parts && !(r in def.cost) ? `Нужна часть верстака: ${ITEMS[r].name.toLowerCase()}` : 'Не хватает ресурсов';
  }
  if (def.solid === true) {
    for (const v of world.ents.values()) {
      if (v.dd) continue; // павшие не мешают
      const px = clamp(v.x, x - TILE / 2, x + TILE / 2);
      const py = clamp(v.y, y - TILE / 2, y + TILE / 2);
      if (Math.hypot(v.x - px, v.y - py) < v.creature.R) return v.isMe ? 'Мешаете вы сами — отойдите' : (v.e?.k === 'p' ? 'Мешает игрок' : 'Мешает существо');
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

// Призрак постройки идёт за курсором; если курсор дальше радиуса стройки — прижимается к краю круга.
// В режимах ремонта и сноса подсвечивается постройка под курсором.
function updateBuild() {
  const active = !!(B.mode && S.you && !S.you.dead);
  world.setBuildRange(S.me.x, S.me.y, active);
  B.target = null;
  if (!active) {
    world.setGhost(null);
    hud.setBuildTip(null);
    S.ghost = null;
    return;
  }
  const now = performance.now();
  if (now - B.countAt > 500) {
    B.countAt = now;
    B.count = 0;
    for (const o of world.statics.objs.values()) if (o.s.o === S.uid && STRUCTURES[o.s.k]) B.count++;
  }
  const tipAt = input.pos.inside && !input.rotating;
  if (B.mode !== 'place') {
    S.ghost = null;
    const t = targetStructure();
    B.target = t;
    if (!t) {
      world.setGhost(null);
      hud.setBuildTip(null);
      return;
    }
    const mine = t.o === S.uid;
    const repair = B.mode === 'repair';
    world.setGhost(t.k, t.x, t.y, !mine ? '#9aa3a0' : repair ? '#ffd166' : '#ff5d5d', { grid: false, solid: true });
    const what = !mine ? '<span class="bad">✖ Чужая постройка</span>'
      : repair ? (t.h >= t.m ? '<span class="good">✔ Цела</span>' : '🔧 <b>ЛКМ</b> — починить') : '🧨 <b>ЛКМ</b> — снести';
    hud.setBuildTip(tipAt ? `${STRUCTURES[t.k].name} · ${t.h}/${t.m}<br>${what}` : null, input.pos.x, input.pos.y);
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
  const reason = buildCheck(B.kind, x, y);
  S.ghost = { x, y, reason };
  world.setGhost(B.kind, x, y, reason ? '#ff5d5d' : '#6fff8a');
  hud.setBuildTip(reason && tipAt ? `<span class="bad">✖ ${reason}</span>` : null, input.pos.x, input.pos.y);
  // ЛКМ зажата: стены и колья ставятся в каждую новую клетку, по которой ведут курсор
  if (input.held && !reason && BUILD_PAINT.has(B.kind) && B.cell !== `${x},${y}` && now - B.placedAt > 70) placeGhost();
}

function placeGhost() {
  B.cell = `${S.ghost.x},${S.ghost.y}`;
  B.placedAt = performance.now();
  net.send({ t: 'build', kind: B.kind, x: S.ghost.x, y: S.ghost.y });
}

input.onLeftDown = () => {
  if (!B.mode) return false;
  if (B.mode === 'place') {
    if (S.ghost?.reason) hud.toast(S.ghost.reason);
    else if (S.ghost) placeGhost();
  } else if (B.target) {
    if (B.target.o !== S.uid) hud.toast('Это чужая постройка');
    else net.send({ t: B.mode, id: B.target.i });
  }
  return true;
};

// щелчок ПКМ: в стройке — назад (из ремонта и сноса к постройкам, оттуда — выход), иначе плевок кислотой
input.onRightClick = () => {
  if (B.mode && B.mode !== 'place') setBuildMode('place');
  else if (B.mode) setBuildMode(null);
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
    if (paths.isOpen) paths.close();
    else if (hud.bigOpen) hud.toggleBigMap(false);
    else if (editor.isOpen) editor.close();
    else if (hud.cont) hud.onCloseCont();
    else if (!hud.craftEl.classList.contains('hidden')) hud.toggleCraft(false);
    else if (B.mode) setBuildMode(null);
    return;
  }
  if (S.dead) return;
  if (code === 'KeyM') return hud.toast(audio.toggleMute() ? 'Звук выключен' : 'Звук включён');
  if (code === 'KeyN') return hud.toggleBigMap();
  if (code === 'KeyG') return toggleEditor();
  if (code === 'KeyP') return togglePaths();
  if (editor.isOpen || paths.isOpen) return;
  if (code === 'Enter') return openChat();
  if (code === 'Tab') return hud.togglePlayers(true);
  if (code === 'KeyH') return $('helpBox').classList.toggle('hidden');
  if (B.mode) {
    // в стройке: Q/E — разделы, R — ремонт, X — снос (повторное нажатие возвращает к постройкам)
    if (code === 'KeyQ') return setBuildCat(B.mode === 'place' ? B.cat - 1 : B.cat);
    if (code === 'KeyE') return setBuildCat(B.mode === 'place' ? B.cat + 1 : B.cat);
    if (code === 'KeyR') return setBuildMode(B.mode === 'repair' ? 'place' : 'repair');
    if (code === 'KeyX') return setBuildMode(B.mode === 'demolish' ? 'place' : 'demolish');
  }
  if (code === 'KeyE') {
    if (hud.cont) hud.onCloseCont();
    else net.send({ t: 'interact' });
    return;
  }
  if (code === 'KeyF') return net.send({ t: 'eat' });
  if (code === 'KeyR') return net.send({ t: 'use', item: 'antirad' });
  if (code === 'KeyT') return net.send({ t: 'use', item: 'elixir' });
  if (code === 'KeyC') return hud.toggleCraft();
  if (code === 'KeyB') return setBuildMode(B.mode ? null : 'place');
  if (code.startsWith('Digit')) {
    const n = Number(code.slice(5));
    if (B.mode) {
      // в режиме стройки цифры выбирают постройку открытого раздела
      const k = BUILD_CATS[B.cat].items[n - 1];
      if (k) pickBuild(k);
    } else {
      // иначе — оружие из пояса; повторное нажатие убирает его
      const k = hud.belt[n - 1];
      if (k && ABILITIES[k]) useSkill(k);
      else if (k) net.send({ t: 'equip', item: S.you.wp === k ? null : k });
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

  // своё существо: догоняем сервер с небольшим предсказанием по скорости.
  // Скорость считаем по времени сервера: пакеты часто приходят пачкой почти одновременно,
  // и деление на промежуток между их приходом давало огромную скорость и рывки картинки.
  if (S.srv) {
    let tx = S.srv.x;
    let ty = S.srv.y;
    const span = S.srvPrev ? (S.srv.st - S.srvPrev.st) / 1000 : 0;
    if (span > 0.015 && span < 0.25) {
      const ahead = Math.min(0.08, Math.max(0, (now - S.srv.t) / 1000));
      let ex = ((S.srv.x - S.srvPrev.x) / span) * ahead;
      let ey = ((S.srv.y - S.srvPrev.y) / span) * ahead;
      const len = Math.hypot(ex, ey);
      if (len > 24) {
        ex *= 24 / len;
        ey *= 24 / len;
      }
      tx += ex;
      ty += ey;
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
  const attacking = input.enabled && !B.mode && (input.mouse.l || now - (input.lastClick || 0) < 90);
  const spitting = input.enabled && !B.mode && (input.keys.KeyQ || now < S.spitUntil);
  if (!you.dead) {
    const aim = aimAngle();
    if (attacking || spitting || B.mode) S.me.face = aim;
    else if (mv.x || mv.y) S.me.face = angleLerp(S.me.face, Math.atan2(mv.y, mv.x), 1 - Math.exp(-dt * 12));
    else if (input.pos.inside && !input.rotating) S.me.face = angleLerp(S.me.face, aim, 1 - Math.exp(-dt * 6));
  }
  const msg = {
    t: 'in', mx: Math.round(mv.x * 100) / 100, my: Math.round(mv.y * 100) / 100,
    s: input.enabled && (input.keys.ShiftLeft || input.keys.ShiftRight) ? 1 : 0,
    a: attacking ? 1 : 0, b: spitting ? 1 : 0, ang: Math.round(S.me.face * 100) / 100,
    ad: Math.round(Math.hypot(S.aim.x - S.me.x, S.aim.y - S.me.y) / 10) * 10, // дальность до курсора — для телепорта
  };
  const sig = `${msg.mx},${msg.my},${msg.s},${msg.a},${msg.b},${msg.ang},${msg.ad}`;
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
  world.setAim(S.aim.sky ? null : S.aim, showCursor && !B.mode);
  cursorEl.style.display = showCursor ? '' : 'none';
  if (showCursor) cursorEl.style.transform = `translate(${input.pos.x}px, ${input.pos.y}px)`;
  world.myMed = !!you.med;
  world.hal.s = you.hs || 0;
  world.hal.t = you.hal || 0;
  world.hal.trip = you.tp || null; // трипы от мухомора, пейотля и жабы: сколько секунд осталось
  world.render(dt, S.phase, you.dead ? 900 : S.stats.vision * VIEW_MULT);

  // особое место под ногами: подсказка при входе и название в строке состояния
  const site = you.dead ? null : zoneAt(S.zones, S.me.x, S.me.y);
  if ((site?.id ?? -1) !== S.siteId) {
    S.siteId = site?.id ?? -1;
    if (site && performance.now() - (S.siteToast[site.id] || -1e9) > 60000) {
      S.siteToast[site.id] = performance.now();
      hud.toast(`${SITES[site.kind].icon} ${SITES[site.kind].enter}`);
    }
  }
  hud.siteName = site ? SITES[site.kind].name : '';
  hud.atShrine = site?.kind === 'shrine';
  paths.atShrine = hud.atShrine;
  // дошли до метки — она больше не нужна
  if (S.marker && !you.dead && Math.hypot(S.marker.x - S.me.x, S.marker.y - S.me.y) < 70) {
    setMarker(null, true);
    hud.toast('📍 Вы на месте — метка снята');
  }
  hud.update(you, S.stats, {
    build: B.mode && !you.dead ? { mode: B.mode, kind: B.kind, cat: B.cat, reason: S.ghost?.reason || '', target: B.target, count: B.count, max: PLAYER.maxStructures, uid: S.uid } : null,
  });
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
  if (B.mode) return hud.setHint(''); // в стройке всё показывает её меню
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
