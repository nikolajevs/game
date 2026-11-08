// Состояние мира и вся игровая логика. Сервер — единственный источник правды.
import crypto from 'node:crypto';
import {
  TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T, TERRAIN_SPEED, isWater, DAY_LENGTH, isNight,
  ITEMS, ITEM_KEYS, RESOURCES, FOOD, STRUCTURES, STORAGE_CAP, STRUCT_DMG, NPCS, NPC_TARGET,
  NIGHT_EXTRA_STALKERS, PLAYER, COMPLEXITY_CAP, VIEW_MULT, WEAPONS, RECIPES, PROJ_STRUCT, BOMB_STRUCT,
  RAD, CRATE, CRATE_LOOT, BENCH_RANGE, MUTANTS_PER_ZONE,
} from '../shared/config.js';
import {
  computeStats, decodeGenome, encodeGenome, evolveCost, sanitizeGenome, defaultGenome, complexity, cloneGenome,
} from '../shared/creature.js';
import { generateMap, generateResources, generateZones, zoneStrength, zoneAt, Grid } from './world.js';
import { updateNpc } from './ai.js';

// снаряды: радиус попадания
const PROJ_R = { acid: 7, stone: 5, arrow: 4, bullet: 3, bomb: 8 };

const HS = TILE / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const emptyInv = () => Object.fromEntries(ITEM_KEYS.map((k) => [k, 0]));
const round1 = (v) => Math.round(v * 10) / 10;
const idleInput = () => ({ mx: 0, my: 0, sprint: false, attack: false, spit: false });

function circleBox(cx, cy, r, bx, by) {
  const px = clamp(cx, bx - HS, bx + HS);
  const py = clamp(cy, by - HS, by + HS);
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

function cleanInv(raw) {
  const inv = emptyInv();
  if (raw && typeof raw === 'object') {
    for (const k of ITEM_KEYS) inv[k] = Math.max(0, Math.floor(Number(raw[k]) || 0));
  }
  return inv;
}

export class Game {
  constructor(seed, saved) {
    this.seed = seed;
    this.tiles = generateMap(seed);
    this.tilesB64 = Buffer.from(this.tiles).toString('base64');
    this.grid = new Grid(80);
    this.statics = new Map();
    this.nests = new Map(); // uid -> постройка-гнездо
    this.players = new Map();
    this.npcs = new Map();
    this.projectiles = new Map();
    this.clients = new Set();
    this.profiles = new Map(); // секретный токен -> профиль
    this.nextId = 1;
    this.time = Number(saved?.time) || 0;
    this.sAdd = new Map();
    this.sDel = new Set();
    this.fx = [];
    this.respawnQueue = [];
    this.meteor = { state: 'idle', next: this.time + 150, x: 0, y: 0, impactAt: 0, until: 0 };
    this.timers = { npc: 0, second: 0, list: 0 };

    this.zones = generateZones(this.tiles, seed);
    for (const r of generateResources(this.tiles, seed, this.zones)) this.addResource(r.kind, r.x, r.y, r.v);
    for (const z of this.zones) {
      for (let i = 0; i < CRATE.perZone; i++) this.spawnCrate(z);
    }
    if (saved) this.loadSaved(saved);
    for (const kind of Object.keys(NPC_TARGET)) {
      for (let i = 0; i < NPC_TARGET[kind]; i++) this.spawnNpc(kind, true);
    }
    for (const z of this.zones) {
      for (let i = 0; i < MUTANTS_PER_ZONE; i++) this.spawnMutantInZone(z);
    }
    this.sAdd.clear();
    this.sDel.clear();
  }

  // сила радиации в точке: постоянные зоны + воронка свежего метеорита
  radAt(x, y) {
    let s = zoneStrength(this.zones, x, y);
    const m = this.meteor;
    if (m.state === 'landed') {
      const d = Math.hypot(x - m.x, y - m.y);
      if (d < RAD.meteorZone.r) s = Math.max(s, RAD.meteorZone.lvl * Math.min(1, (RAD.meteorZone.r - d) / (RAD.meteorZone.r * 0.4)));
    }
    return s;
  }

  // ---------- ящики с добычей в радиационных зонах ----------
  rollLoot() {
    const inv = emptyInv();
    const total = CRATE_LOOT.reduce((a, l) => a + l[3], 0);
    for (let i = 0; i < CRATE.rolls; i++) {
      let r = Math.random() * total;
      for (const [item, min, max, w] of CRATE_LOOT) {
        r -= w;
        if (r <= 0) {
          inv[item] += min + Math.floor(Math.random() * (max - min + 1));
          break;
        }
      }
    }
    return inv;
  }

  spawnCrate(z) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * z.r * 0.8;
      const x = z.x + Math.cos(a) * d;
      const y = z.y + Math.sin(a) * d;
      if (isWater(this.tileAt(x, y))) continue;
      if (this.grid.query(x, y, 40).some((s) => Math.hypot(s.x - x, s.y - y) < (s.r || 20) + 18)) continue;
      const s = { id: this.nextId++, cat: 'crate', kind: 'crate', x, y, r: 18, inv: this.rollLoot(), dna: 0, zone: z.id };
      this.statics.set(s.id, s);
      this.grid.insert(s);
      this.sAdd.set(s.id, s);
      return s;
    }
    return null;
  }

  phase() {
    return ((this.time + DAY_LENGTH * 0.08) % DAY_LENGTH) / DAY_LENGTH;
  }

  tileAt(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.DEEP;
    return this.tiles[ty * MAP_W + tx];
  }

  // ================= статичные объекты =================
  addResource(kind, x, y, v = Math.random()) {
    const def = RESOURCES[kind];
    const s = { id: this.nextId++, cat: 'res', kind, x, y, r: def.r, cr: def.cr, hp: def.hp, maxHp: def.hp, v: Math.round(v * 1000) / 1000 };
    this.statics.set(s.id, s);
    this.grid.insert(s);
    this.sAdd.set(s.id, s);
    return s;
  }

  addStructure(kind, x, y, owner, ownerName, ownerColor, hp, inv) {
    const def = STRUCTURES[kind];
    const s = {
      id: this.nextId++, cat: 'struct', kind, x, y, r: HS,
      hp: hp ?? def.hp, maxHp: def.hp, owner, ownerName, ownerColor,
      inv: def.storage ? cleanInv(inv) : null,
    };
    this.statics.set(s.id, s);
    this.grid.insert(s);
    this.sAdd.set(s.id, s);
    if (kind === 'nest') this.nests.set(owner, s);
    return s;
  }

  addRemains(x, y, inv, dna, name) {
    const s = {
      id: this.nextId++, cat: 'remains', kind: 'remains', x, y, r: 16,
      inv: { ...inv }, dna, ownerName: name, expires: this.time + PLAYER.remainsLife,
    };
    this.statics.set(s.id, s);
    this.grid.insert(s);
    this.sAdd.set(s.id, s);
    return s;
  }

  touch(s) {
    this.sAdd.set(s.id, s);
  }

  removeStatic(s) {
    if (!this.statics.has(s.id)) return;
    this.statics.delete(s.id);
    this.grid.remove(s);
    this.sAdd.delete(s.id);
    this.sDel.add(s.id);
    if (s.kind === 'nest' && this.nests.get(s.owner) === s) this.nests.delete(s.owner);
    for (const p of this.players.values()) {
      if (p.openCont === s.id) {
        p.openCont = null;
        this.send(p.client, { t: 'contClose' });
      }
    }
  }

  serStatic(s) {
    const base = { i: s.id, k: s.kind, x: Math.round(s.x), y: Math.round(s.y) };
    if (s.cat === 'res') return { ...base, h: Math.ceil(s.hp), m: s.maxHp, v: s.v };
    if (s.cat === 'struct') return { ...base, h: Math.ceil(s.hp), m: s.maxHp, o: s.owner, on: s.ownerName, c: s.ownerColor };
    if (s.cat === 'crate') return base;
    return { ...base, on: s.ownerName };
  }

  // контейнер, из которого можно только забирать (останки и ящики)
  isLootBox(s) {
    return s.cat === 'remains' || s.cat === 'crate';
  }

  // ================= клиенты =================
  addClient(ws) {
    const c = { ws, player: null };
    this.clients.add(c);
    return c;
  }

  removeClient(c) {
    this.clients.delete(c);
    const p = c.player;
    if (!p) return;
    this.saveProfile(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'chat', sys: true, text: `${p.name} покинул остров` });
  }

  send(c, msg) {
    if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients) if (c.player && c.ws.readyState === 1) c.ws.send(s);
  }

  toast(p, text) {
    this.send(p.client, { t: 'toast', text });
  }

  handle(client, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'join') return this.onJoin(client, msg);
    const p = client.player;
    if (!p) return;
    switch (msg.t) {
      case 'in': return this.onInput(p, msg);
      case 'charge': return this.tryCharge(p, msg);
      case 'build': return this.onBuild(p, msg);
      case 'demolish': return this.onDemolish(p, msg);
      case 'evolve': return this.onEvolve(p, msg);
      case 'eat': return this.onEat(p, msg);
      case 'interact': return this.onInteract(p);
      case 'cont': return this.onCont(p, msg);
      case 'close': p.openCont = null; return undefined;
      case 'respawn': return this.onRespawn(p, msg);
      case 'chat': return this.onChat(p, msg);
      case 'equip': return this.onEquip(p, msg);
      case 'craft': return this.onCraft(p, msg);
      case 'use': return this.onUse(p, msg);
      default: return undefined;
    }
  }

  // ---------- оружие и крафт ----------
  onEquip(p, m) {
    if (p.dead) return;
    const item = m.item;
    if (!item) {
      p.weapon = null;
      return;
    }
    if (!WEAPONS[item] || !(p.inv[item] > 0)) return;
    if (!p.stats.canHold) return this.toast(p, 'Чтобы держать оружие, нужны когти (геном — G)');
    p.weapon = item;
  }

  nearBench(p) {
    for (const s of this.grid.query(p.x, p.y, BENCH_RANGE + TILE)) {
      if (s.kind === 'workbench' && Math.hypot(s.x - p.x, s.y - p.y) <= BENCH_RANGE) return true;
    }
    return false;
  }

  onCraft(p, m) {
    if (p.dead) return;
    const rec = RECIPES[m.item];
    if (!rec) return;
    if (rec.bench && !this.nearBench(p)) return this.toast(p, 'Нужен верстак рядом');
    for (const k in rec.cost) if ((p.inv[k] || 0) < rec.cost[k]) return this.toast(p, 'Не хватает ресурсов');
    for (const k in rec.cost) p.inv[k] -= rec.cost[k];
    const out = rec.out || 1;
    p.inv[m.item] += out;
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${out} ${ITEMS[m.item].icon} ${ITEMS[m.item].name}` });
    // новое оружие сразу в лапы, если они свободны
    if (WEAPONS[m.item] && !p.weapon && p.stats.canHold) p.weapon = m.item;
  }

  onUse(p, m) {
    if (p.dead || m.item !== 'antirad') return;
    if (!(p.inv.antirad > 0)) return this.toast(p, 'Нет антирада — создайте его в меню крафта (C)');
    p.inv.antirad--;
    p.rad = Math.max(0, p.rad - RAD.antirad);
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `−${RAD.antirad} ☢` });
  }

  onJoin(client, msg) {
    if (client.player) return;
    const name = String(msg.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Безымянный';
    const color = /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#6fbf73';
    let token = typeof msg.token === 'string' && /^[a-f0-9]{32}$/.test(msg.token) ? msg.token : null;
    // тот же токен уже в игре (вторая вкладка) — заводим новое существо
    if (token && [...this.players.values()].some((p) => p.token === token)) token = null;
    let prof = token ? this.profiles.get(token) : null;
    if (!prof) {
      token = crypto.randomBytes(16).toString('hex');
      prof = { uid: crypto.randomBytes(6).toString('hex'), genome: defaultGenome(), dna: PLAYER.startDna, inv: emptyInv(), alive: false, kills: 0 };
      this.profiles.set(token, prof);
    }
    prof.name = name;
    prof.color = color;
    const p = this.createPlayer(client, token, prof);
    client.player = p;
    this.send(client, {
      t: 'welcome', id: p.id, uid: prof.uid, token, seed: this.seed, tiles: this.tilesB64, zones: this.zones,
      statics: [...this.statics.values()].map((s) => this.serStatic(s)),
    });
    this.broadcast({ t: 'chat', sys: true, text: `${name} появился на острове` });
    this.broadcastPlayerList();
  }

  createPlayer(client, token, prof) {
    const p = {
      id: this.nextId++, type: 'player', client, token, uid: prof.uid, prof,
      name: prof.name, color: prof.color, genome: sanitizeGenome(prof.genome), look: '', stats: null,
      x: 0, y: 0, kbx: 0, kby: 0, angle: 0,
      hp: 100, food: 80, water: 80, stamina: 100, dna: Math.max(0, Math.floor(prof.dna || 0)), inv: cleanInv(prof.inv),
      input: idleInput(),
      cd: { melee: 0, spit: 0, charge: 0 },
      combatT: 0, atkT: 0, hitT: 0, slowT: 0, spikeT: 0, drinkT: 0, eatT: 0, lastChat: -10,
      charging: 0, chargeDir: 0, chargeHit: null,
      spawnProtect: PLAYER.spawnProtect, dead: false, openCont: null, nearFire: false,
      kills: prof.kills || 0, pfx: [], weapon: null, rad: clamp(Number(prof.rad) || 0, 0, 100), radHere: 0, warnT: 0,
    };
    this.applyGenome(p);
    if (prof.alive && Number.isFinite(prof.x)) {
      p.x = clamp(prof.x, 30, WORLD_W - 30);
      p.y = clamp(prof.y, 30, WORLD_H - 30);
      p.hp = clamp(prof.hp || p.stats.maxHp, 1, p.stats.maxHp);
      p.food = clamp(prof.food ?? 80, 0, 100);
      p.water = clamp(prof.water ?? 80, 0, 100);
    } else {
      const nest = this.nests.get(p.uid);
      const pos = nest ? { x: nest.x, y: nest.y } : this.findSpawn();
      p.x = pos.x;
      p.y = pos.y;
      p.hp = p.stats.maxHp;
    }
    this.players.set(p.id, p);
    return p;
  }

  applyGenome(p) {
    const oldMax = p.stats ? p.stats.maxHp : 0;
    p.stats = computeStats(p.genome);
    p.look = encodeGenome(p.genome);
    if (oldMax) p.hp = clamp((p.hp / oldMax) * p.stats.maxHp, 1, p.stats.maxHp);
  }

  saveProfile(p) {
    const prof = p.prof;
    prof.genome = cloneGenome(p.genome);
    prof.dna = p.dna;
    prof.inv = { ...p.inv };
    prof.alive = !p.dead;
    prof.x = p.x;
    prof.y = p.y;
    prof.hp = p.hp;
    prof.food = p.food;
    prof.water = p.water;
    prof.kills = p.kills;
    prof.rad = p.rad;
  }

  // ================= действия игрока =================
  onInput(p, m) {
    let mx = Number(m.mx) || 0;
    let my = Number(m.my) || 0;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    p.input.mx = mx;
    p.input.my = my;
    p.input.sprint = !!m.s;
    p.input.attack = !!m.a;
    p.input.spit = !!m.b;
    if (Number.isFinite(m.ang) && p.charging <= 0) p.angle = m.ang;
  }

  tryCharge(p, m) {
    if (p.dead || !p.stats.charge || p.cd.charge > 0 || p.charging > 0) return;
    if (Number.isFinite(m.ang)) p.angle = m.ang;
    p.cd.charge = p.stats.charge.cd;
    p.charging = 0.32;
    p.chargeDir = p.angle;
    p.chargeHit = new Set();
  }

  onBuild(p, m) {
    if (p.dead) return;
    const def = STRUCTURES[m.kind];
    if (!def) return;
    const tx = Math.floor(Number(m.x) / TILE);
    const ty = Math.floor(Number(m.y) / TILE);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return;
    const x = tx * TILE + HS;
    const y = ty * TILE + HS;
    if (Math.hypot(x - p.x, y - p.y) > PLAYER.buildRange + HS) return this.toast(p, 'Слишком далеко для стройки');
    if (isWater(this.tiles[ty * MAP_W + tx])) return this.toast(p, 'Нельзя строить на воде');
    for (const k in def.cost) if ((p.inv[k] || 0) < def.cost[k]) return this.toast(p, 'Не хватает ресурсов');
    let count = 0;
    for (const s of this.statics.values()) if (s.cat === 'struct' && s.owner === p.uid) count++;
    if (count >= PLAYER.maxStructures) return this.toast(p, 'Достигнут лимит построек');
    for (const s of this.grid.query(x, y, TILE)) {
      if (s.cat === 'struct' && s.x === x && s.y === y) return this.toast(p, 'Место занято');
      if (s.cat === 'res' && circleBox(s.x, s.y, Math.max(s.cr, s.r * 0.5), x, y)) {
        return this.toast(p, `Мешает: ${RESOURCES[s.kind].name.toLowerCase()}`);
      }
    }
    if (def.solid === true) {
      for (const c of this.creaturesNear(x, y, TILE * 2)) {
        if (circleBox(c.x, c.y, c.stats.radius, x, y)) return this.toast(p, 'Мешает существо');
      }
    }
    for (const k in def.cost) p.inv[k] -= def.cost[k];
    if (m.kind === 'nest') {
      const old = this.nests.get(p.uid);
      if (old) this.removeStatic(old);
    }
    this.addStructure(m.kind, x, y, p.uid, p.name, p.color);
  }

  onDemolish(p, m) {
    const s = this.statics.get(Number(m.id));
    if (!s || s.cat !== 'struct' || s.owner !== p.uid || p.dead) return;
    if (Math.hypot(s.x - p.x, s.y - p.y) > PLAYER.buildRange + TILE) return this.toast(p, 'Слишком далеко');
    const def = STRUCTURES[s.kind];
    const frac = 0.5 * (s.hp / s.maxHp);
    for (const k in def.cost) p.inv[k] += Math.floor(def.cost[k] * frac);
    if (s.inv) this.dropContainer(s);
    this.removeStatic(s);
    this.fx.push({ k: 'break', x: s.x, y: s.y, m: def.mat });
  }

  onEvolve(p, m) {
    if (p.dead) return;
    if (p.combatT > 0) return this.toast(p, 'Нельзя эволюционировать в бою');
    const g = sanitizeGenome(m.genome);
    if (complexity(g) > COMPLEXITY_CAP) return this.toast(p, 'Слишком сложное существо');
    const c = evolveCost(p.genome, g);
    if (c.net > p.dna) return this.toast(p, 'Не хватает ДНК');
    if (c.crystals > p.inv.crystal) return this.toast(p, 'Не хватает кристаллов мутагена');
    p.dna -= c.net;
    p.inv.crystal -= c.crystals;
    p.genome = g;
    this.applyGenome(p);
    if (!p.stats.canHold) p.weapon = null;
    this.fx.push({ k: 'evolve', x: p.x, y: p.y, c: p.color });
    this.send(p.client, { t: 'evolved' });
    this.toast(p, 'Эволюция завершена!');
  }

  onEat(p, m) {
    if (p.dead || p.eatT > 0) return;
    const diet = p.stats.diet;
    let item = FOOD[m.item] && p.inv[m.item] > 0 ? m.item : null;
    if (!item) {
      const opts = Object.keys(FOOD).filter((k) => p.inv[k] > 0).sort((a, b) => FOOD[b].mult[diet] - FOOD[a].mult[diet]);
      item = opts[0];
    }
    if (!item) return this.toast(p, 'Нечего есть — соберите ягоды или добудьте мясо');
    const f = FOOD[item];
    p.inv[item]--;
    p.eatT = 0.25;
    const food = f.food * f.mult[diet];
    p.food = Math.min(100, p.food + food);
    p.water = Math.min(100, p.water + f.water);
    p.hp = Math.min(p.stats.maxHp, p.hp + 3);
    p.dna += f.dna;
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${Math.round(food)} 🍖  +${f.dna} 🧬` });
  }

  onInteract(p) {
    if (p.dead) return;
    let best = null;
    let bd = Infinity;
    const range = p.stats.radius + PLAYER.interactRange;
    for (const s of this.grid.query(p.x, p.y, range + TILE)) {
      if (!this.isLootBox(s) && !(s.cat === 'struct' && STRUCTURES[s.kind].storage)) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y) - s.r;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best && bd <= range) {
      p.openCont = best.id;
      this.sendCont(p, best);
      return;
    }
    if (this.nearWater(p)) {
      if (p.drinkT > 0) return;
      p.drinkT = 0.4;
      p.water = Math.min(100, p.water + 20);
      p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: '+20 💧' });
    }
  }

  sendCont(p, s) {
    let title;
    if (s.cat === 'remains') title = `Останки: ${s.ownerName}`;
    else if (s.cat === 'crate') title = CRATE.name;
    else title = `${STRUCTURES[s.kind].name}${s.ownerName ? ` (${s.ownerName})` : ''}`;
    this.send(p.client, { t: 'cont', id: s.id, title, inv: s.inv, dna: s.dna || 0, remains: this.isLootBox(s), cap: STORAGE_CAP });
  }

  onCont(p, m) {
    const s = this.statics.get(p.openCont);
    if (!s || s.id !== m.id || p.dead) return;
    if (Math.hypot(s.x - p.x, s.y - p.y) > 140) return;
    const res = m.res;
    const isDna = res === 'dna';
    if (!isDna && !ITEMS[res]) return;
    const n = m.n === 'all' ? Infinity : Math.floor(Number(m.n));
    if (!(n > 0)) return;
    if (m.op === 'take') {
      if (isDna) {
        if (s.cat !== 'remains') return;
        const take = Math.min(n, s.dna || 0);
        s.dna -= take;
        p.dna += take;
      } else {
        const take = Math.min(n, s.inv[res] || 0);
        s.inv[res] -= take;
        p.inv[res] += take;
      }
    } else if (m.op === 'put') {
      if (s.cat !== 'struct' || isDna) return;
      const total = ITEM_KEYS.reduce((a, k) => a + s.inv[k], 0);
      const put = Math.min(n, p.inv[res], STORAGE_CAP - total);
      if (put <= 0) return this.toast(p, 'Хранилище заполнено');
      p.inv[res] -= put;
      s.inv[res] += put;
    } else return;
    if (this.isLootBox(s) && !(s.dna > 0) && ITEM_KEYS.every((k) => !s.inv[k])) {
      this.removeStatic(s);
      // пустой ящик через время появится снова где-то в той же зоне
      if (s.cat === 'crate') this.respawnQueue.push({ crate: s.zone, at: this.time + CRATE.respawn * (0.8 + Math.random() * 0.4) });
      return;
    }
    for (const q of this.players.values()) if (q.openCont === s.id) this.sendCont(q, s);
  }

  onRespawn(p, m) {
    if (!p.dead) return;
    const nest = m.nest ? this.nests.get(p.uid) : null;
    const pos = nest ? { x: nest.x, y: nest.y } : this.findSpawn();
    Object.assign(p, {
      x: pos.x, y: pos.y, dead: false, hp: p.stats.maxHp, food: 75, water: 75, stamina: 100,
      spawnProtect: PLAYER.spawnProtect, kbx: 0, kby: 0, charging: 0, combatT: 0, slowT: 0,
      input: idleInput(), // не продолжаем движение, начатое до смерти
    });
    p.cd.melee = 0;
    p.cd.spit = 0;
    p.cd.charge = 0;
  }

  onChat(p, m) {
    const text = String(m.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
    if (!text || this.time - p.lastChat < 0.6) return;
    p.lastChat = this.time;
    this.broadcast({ t: 'chat', n: p.name, c: p.color, text });
  }

  // ================= такт симуляции =================
  tick(dt) {
    this.time += dt;
    const phase = this.phase();
    const night = isNight(phase);
    for (const p of this.players.values()) this.updatePlayer(p, dt);
    for (const n of this.npcs.values()) {
      updateNpc(this, n, dt, night);
      if (this.npcs.has(n.id)) this.envEffects(n, dt);
    }
    this.separate();
    this.updateProjectiles(dt);
    if ((this.timers.npc -= dt) <= 0) {
      this.timers.npc = 2;
      this.maintainNpcs(night);
    }
    if ((this.timers.second -= dt) <= 0) {
      this.timers.second = 1;
      this.processRespawns();
      this.expireRemains();
    }
    if ((this.timers.list -= dt) <= 0) {
      this.timers.list = 3;
      this.broadcastPlayerList();
    }
    this.updateMeteor();
    this.sendSnapshots(phase);
  }

  updatePlayer(p, dt) {
    if (p.dead) return;
    const st = p.stats;
    p.cd.melee = Math.max(0, p.cd.melee - dt);
    p.cd.spit = Math.max(0, p.cd.spit - dt);
    p.cd.charge = Math.max(0, p.cd.charge - dt);
    p.combatT = Math.max(0, p.combatT - dt);
    p.atkT = Math.max(0, p.atkT - dt);
    p.hitT = Math.max(0, p.hitT - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    p.drinkT = Math.max(0, p.drinkT - dt);
    p.eatT = Math.max(0, p.eatT - dt);
    p.warnT = Math.max(0, p.warnT - dt);
    p.spawnProtect = Math.max(0, p.spawnProtect - dt);
    if (p.weapon && !(p.inv[p.weapon] > 0)) p.weapon = null; // оружие выложили или потратили

    const moving = p.input.mx !== 0 || p.input.my !== 0;
    const sprinting = p.input.sprint && moving && p.stamina > 1 && p.charging <= 0;

    // радиация: копится в зонах, снаружи спадает
    p.radHere = this.radAt(p.x, p.y);
    if (p.radHere > 0) p.rad = Math.min(100, p.rad + RAD.ratePerLevel * p.radHere * (1 - st.radResist) * dt);
    else p.rad = Math.max(0, p.rad - RAD.decay * dt);
    if (p.rad > RAD.dmgStart) this.damageCreature(p, (p.rad - RAD.dmgStart) * RAD.dmgPerPoint * dt, null, 'rad');
    if (p.dead) return;

    // голод, жажда, регенерация
    p.food = Math.max(0, p.food - PLAYER.hungerRate * st.metabolism * (sprinting ? 1.6 : 1) * dt);
    p.water = Math.max(0, p.water - PLAYER.thirstRate * st.metabolism * dt);
    p.nearFire = this.nearKind(p.x, p.y, 'campfire', 140);
    if (p.food <= 0 || p.water <= 0) this.damageCreature(p, PLAYER.starveDmg * dt, null, 'starve');
    else if (p.food > 35 && p.water > 35 && p.rad < RAD.regenBlock && p.hp < st.maxHp) {
      p.hp = Math.min(st.maxHp, p.hp + (PLAYER.regen + (p.nearFire ? PLAYER.fireRegen : 0)) * dt);
    }
    if (p.dead) return;

    let speed = st.speed;
    let mx = p.input.mx;
    let my = p.input.my;
    if (sprinting) {
      speed *= PLAYER.sprintMul;
      p.stamina = Math.max(0, p.stamina - PLAYER.staminaUse * dt);
    } else {
      p.stamina = Math.min(100, p.stamina + PLAYER.staminaRegen * dt);
    }
    if (p.slowT > 0) speed *= 0.6;
    const charging = p.charging > 0 && st.charge;
    if (charging) {
      mx = Math.cos(p.chargeDir);
      my = Math.sin(p.chargeDir);
      speed = st.charge.speed;
      p.charging -= dt;
    } else p.charging = 0;
    const hit = this.moveCreature(p, mx, my, speed, dt);
    if (charging) this.chargeStep(p, hit);
    this.envEffects(p, dt);
    if (p.dead) return;

    if (p.input.attack && p.cd.melee <= 0 && p.charging <= 0) this.attack(p);
    if (p.input.spit && st.spit && p.cd.spit <= 0) {
      p.cd.spit = st.spit.cd;
      this.spit(p);
    }
    if (p.openCont) {
      const s = this.statics.get(p.openCont);
      if (!s || Math.hypot(s.x - p.x, s.y - p.y) > 140) {
        p.openCont = null;
        this.send(p.client, { t: 'contClose' });
      }
    }
  }

  // колья ранят чужаков
  envEffects(e, dt) {
    e.spikeT = Math.max(0, (e.spikeT || 0) - dt);
    if (e.spikeT > 0) return;
    const r = e.stats.radius;
    for (const s of this.grid.query(e.x, e.y, r + TILE)) {
      if (s.kind !== 'spikes' || (e.uid && e.uid === s.owner)) continue;
      if (!circleBox(e.x, e.y, r, s.x, s.y)) continue;
      e.spikeT = 0.6;
      this.damageCreature(e, STRUCTURES.spikes.touchDmg, null, 'spikes');
      this.damageStructure(s, 4, null);
      break;
    }
  }

  moveCreature(e, mx, my, speed, dt) {
    const tile = this.tileAt(e.x, e.y);
    let tm = TERRAIN_SPEED[tile];
    if (isWater(tile) && e.stats.swim) tm = 0.95 + e.stats.swim * 0.2;
    e.x += (mx * speed * tm + e.kbx) * dt;
    e.y += (my * speed * tm + e.kby) * dt;
    const decay = Math.pow(0.004, dt);
    e.kbx *= decay;
    e.kby *= decay;
    if (Math.abs(e.kbx) < 1) e.kbx = 0;
    if (Math.abs(e.kby) < 1) e.kby = 0;
    return this.collide(e);
  }

  blocks(s, e) {
    const solid = STRUCTURES[s.kind].solid;
    if (solid === true) return true;
    if (solid === 'owner') return !e.uid || e.uid !== s.owner;
    return false;
  }

  // Выталкивает существо из стен и твёрдых ресурсов. Возвращает первое препятствие.
  collide(e) {
    const r = e.stats.radius;
    let hit = null;
    e.x = clamp(e.x, r, WORLD_W - r);
    e.y = clamp(e.y, r, WORLD_H - r);
    for (const s of this.grid.query(e.x, e.y, r + TILE)) {
      if (s.cat === 'struct') {
        if (!this.blocks(s, e)) continue;
        const cx = clamp(e.x, s.x - HS, s.x + HS);
        const cy = clamp(e.y, s.y - HS, s.y + HS);
        const dx = e.x - cx;
        const dy = e.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        hit = hit || s;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          e.x += (dx / d) * (r - d);
          e.y += (dy / d) * (r - d);
        } else {
          const ox = e.x - s.x;
          const oy = e.y - s.y;
          if (Math.abs(ox) > Math.abs(oy)) e.x = s.x + Math.sign(ox || 1) * (HS + r);
          else e.y = s.y + Math.sign(oy || 1) * (HS + r);
        }
      } else if (s.cat === 'res' && s.cr > 0) {
        const rr = r + s.cr;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        e.x = s.x + (dx / d) * rr;
        e.y = s.y + (dy / d) * rr;
        hit = hit || s;
      }
    }
    return hit;
  }

  // мягкое расталкивание существ
  separate() {
    const arr = [];
    for (const p of this.players.values()) if (!p.dead) arr.push(p);
    for (const n of this.npcs.values()) arr.push(n);
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        const rr = a.stats.radius + b.stats.radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (rr - d) * 0.5;
        const ux = dx / d;
        const uy = dy / d;
        const wa = b.stats.radius / rr;
        const wb = a.stats.radius / rr;
        a.x -= ux * push * wa;
        a.y -= uy * push * wa;
        b.x += ux * push * wb;
        b.y += uy * push * wb;
      }
    }
  }

  // ================= поиск =================
  creaturesNear(x, y, r) {
    const out = [];
    const r2 = r * r;
    for (const p of this.players.values()) {
      if (!p.dead && (p.x - x) ** 2 + (p.y - y) ** 2 <= r2) out.push(p);
    }
    for (const n of this.npcs.values()) {
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r2) out.push(n);
    }
    return out;
  }

  getCreature(id) {
    if (id == null) return null;
    return this.players.get(id) || this.npcs.get(id) || null;
  }

  nearestPlayer(x, y, r, skipProtected) {
    let best = null;
    let bd = r * r;
    for (const p of this.players.values()) {
      if (p.dead || (skipProtected && p.spawnProtect > 0)) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  nearKind(x, y, kind, r) {
    for (const s of this.grid.query(x, y, r)) {
      if (s.kind === kind && Math.hypot(s.x - x, s.y - y) < r) return true;
    }
    return false;
  }

  nearWater(p) {
    const r = p.stats.radius + 26;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (isWater(this.tileAt(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r))) return true;
    }
    return isWater(this.tileAt(p.x, p.y));
  }

  // ================= бой и добыча =================
  // Атака игрока: удар голыми лапами/оружием ближнего боя, выстрел или бросок
  attack(p) {
    const st = p.stats;
    const w = p.weapon ? WEAPONS[p.weapon] : null;
    if (!w || w.type === 'melee') {
      p.cd.melee = w ? w.cd : st.attackCd;
      p.atkT = 0.25;
      this.melee(p, st.meleeDmg + (w ? w.dmg : 0), w);
      return;
    }
    if (w.type === 'ranged' && !(p.inv[w.ammo] > 0)) {
      p.cd.melee = 0.4;
      if (p.warnT <= 0) {
        p.warnT = 2;
        this.toast(p, `Нет боеприпасов: ${ITEMS[w.ammo].name.toLowerCase()}`);
      }
      return;
    }
    if (w.type === 'ranged') p.inv[w.ammo]--;
    else p.inv[p.weapon]--; // бросок расходует само оружие
    p.cd.melee = w.cd;
    p.atkT = 0.2;
    this.fireWeapon(p, w);
  }

  fireWeapon(p, w) {
    const n = w.pellets || 1;
    const r0 = p.stats.radius + 8;
    for (let i = 0; i < n; i++) {
      const ang = p.angle + (Math.random() - 0.5) * 2 * (w.spread || 0);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const sp = w.speed * (n > 1 ? 0.85 + Math.random() * 0.3 : 1);
      this.addProjectile(p, w.proj, p.x + ca * r0, p.y + sa * r0, ca * sp, sa * sp, w.dmg, w.life * (n > 1 ? 0.8 + Math.random() * 0.4 : 1), w);
    }
    this.fx.push({ k: 'shot', x: p.x + Math.cos(p.angle) * r0, y: p.y + Math.sin(p.angle) * r0, m: w.proj });
  }

  addProjectile(owner, kind, x, y, vx, vy, dmg, life, w = null) {
    const j = { id: this.nextId++, owner: owner.id, kind, x, y, vx, vy, dmg, life, a: Math.atan2(vy, vx) };
    if (kind === 'bomb') {
      j.radius = w.radius;
      j.structDmg = w.structDmg;
    }
    this.projectiles.set(j.id, j);
    return j;
  }

  melee(a, dmg, w = null) {
    const st = a.stats;
    const reach = st.radius + st.reach + (w ? w.reach : 0);
    const ca = Math.cos(a.angle);
    const sa = Math.sin(a.angle);
    let hitCreature = false;
    for (const t of this.creaturesNear(a.x, a.y, reach + 90)) {
      if (t === a) continue;
      if (a.type === 'npc' && t.type === 'npc') continue;
      const dx = t.x - a.x;
      const dy = t.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d - t.stats.radius > reach) continue;
      if (d > st.radius + t.stats.radius * 0.5 && (dx * ca + dy * sa) / d < 0.4) continue;
      this.damageCreature(t, dmg, a, 'melee');
      t.kbx += (dx / d) * 140;
      t.kby += (dy / d) * 140;
      hitCreature = true;
    }
    if (hitCreature || a.type === 'npc') return;

    // если существ рядом нет — бьём ближайший ресурс или постройку перед собой
    let best = null;
    let bestD = Infinity;
    for (const s of this.grid.query(a.x + ca * reach * 0.5, a.y + sa * reach * 0.5, reach + TILE)) {
      if (this.isLootBox(s)) continue;
      let d;
      if (s.cat === 'struct') {
        const cx = clamp(a.x, s.x - HS, s.x + HS);
        const cy = clamp(a.y, s.y - HS, s.y + HS);
        d = Math.hypot(cx - a.x, cy - a.y);
      } else {
        d = Math.hypot(s.x - a.x, s.y - a.y) - s.r * 0.7;
      }
      if (d > reach) continue;
      const dx = s.x - a.x;
      const dy = s.y - a.y;
      const dl = Math.hypot(dx, dy) || 0.01;
      const dot = (dx * ca + dy * sa) / dl;
      if (d > st.radius * 0.5 && dot < 0.3) continue;
      // важнее то, куда смотрим, чем то, что чуть ближе сбоку
      const score = d * 0.5 + (1 - dot) * 70;
      if (score < bestD) {
        bestD = score;
        best = s;
      }
    }
    if (!best) return;
    if (best.cat === 'res') this.gather(a, best, dmg, w);
    else if (best.cat === 'struct') this.damageStructure(best, dmg * STRUCT_DMG.melee[STRUCTURES[best.kind].mat] * (w?.struct || 1), a);
  }

  gather(p, s, dmg, w = null) {
    const def = RESOURCES[s.kind];
    let rate = def.rate || 0;
    if (s.kind === 'bush' && p.stats.diet === 'herb') rate *= 2;
    if (w && w.gather && w.gather[def.give]) rate *= w.gather[def.give];
    const before = s.hp;
    s.hp = Math.max(0, s.hp - (def.fixed ?? dmg));
    const amount = def.fixed ? 1 : Math.floor((s.maxHp - s.hp) * rate) - Math.floor((s.maxHp - before) * rate);
    let text = '';
    if (amount > 0) {
      p.inv[def.give] += amount;
      text = `+${amount} ${ITEMS[def.give].icon}`;
    }
    if (def.dna) {
      p.dna += def.dna;
      text += `  +${def.dna} 🧬`;
    }
    if (text) p.pfx.push({ k: 'gain', x: s.x, y: s.y, text });
    this.fx.push({ k: 'hit', x: s.x, y: s.y, m: s.kind, id: s.id });
    if (s.hp <= 0) {
      this.removeStatic(s);
      if (def.respawn) this.respawnQueue.push({ kind: s.kind, x: s.x, y: s.y, v: s.v, at: this.time + def.respawn * (0.8 + Math.random() * 0.4) });
    } else this.touch(s);
  }

  damageCreature(t, amount, src, kind) {
    if (t.dead || amount <= 0) return 0;
    const silent = kind === 'starve' || kind === 'rad'; // урон «изнутри»: без цифр и защиты
    if (t.type === 'player' && t.spawnProtect > 0 && !silent) return 0;
    if (!silent) amount *= 1 - t.stats.defense;
    t.hp -= amount;
    if (!silent) {
      t.hitT = 0.15;
      t.combatT = 6;
      this.fx.push({ k: 'dmg', x: t.x, y: t.y, n: Math.max(1, Math.round(amount)), c: t.type === 'player' ? '#ff6b6b' : '#ffd166' });
    }
    if (src && src !== t) {
      if (src.type === 'player') src.combatT = 6;
      if (t.type === 'npc') {
        t.target = src.id;
        t.alertT = 6;
      }
      if (kind === 'melee' && t.stats.thorns > 0 && !src.dead) this.damageCreature(src, amount * t.stats.thorns + 2, t, 'thorns');
    }
    if (t.hp <= 0) this.killCreature(t, src, kind);
    return amount;
  }

  killCreature(t, src, kind) {
    const killerIsPlayer = src && src.type === 'player' && !src.dead;
    if (t.type === 'npc') {
      if (!this.npcs.has(t.id)) return;
      this.npcs.delete(t.id);
      this.fx.push({ k: 'die', x: t.x, y: t.y, c: t.color, r: t.stats.radius });
      const def = NPCS[t.kind];
      if (killerIsPlayer) {
        src.dna += def.dna;
        src.inv.meat += def.meat;
        src.inv.bone += def.bone || 0;
        if (def.crystal) src.inv.crystal += def.crystal;
        src.pfx.push({ k: 'gain', x: t.x, y: t.y, text: `+${def.dna} 🧬  +${def.meat} 🥩  +${def.bone || 0} 🦴${def.crystal ? `  +${def.crystal} 💎` : ''}` });
      }
      return;
    }
    // игрок погиб: всё, что нёс, остаётся в останках
    t.dead = true;
    t.hp = 0;
    t.charging = 0;
    t.openCont = null;
    t.input = idleInput();
    t.weapon = null;
    t.rad = 0;
    const dnaDrop = Math.floor(t.dna * PLAYER.remainsDnaShare);
    t.dna -= dnaDrop;
    if (dnaDrop > 0 || ITEM_KEYS.some((k) => t.inv[k] > 0)) this.addRemains(t.x, t.y, t.inv, dnaDrop, t.name);
    t.inv = emptyInv();
    this.fx.push({ k: 'die', x: t.x, y: t.y, c: t.color, r: t.stats.radius });
    const reasons = { starve: 'голод и жажда', spikes: 'колья', meteor: 'метеорит', rad: 'радиация' };
    const killer = src ? (src.type === 'player' ? src.name : NPCS[src.kind].name) : reasons[kind] || 'неизвестность';
    if (killerIsPlayer) {
      src.kills++;
      src.prof.kills = src.kills;
    }
    this.broadcast({ t: 'chat', sys: true, text: `☠ ${t.name} — погиб: ${killer}` });
    this.send(t.client, { t: 'dead', by: killer, lost: dnaDrop, nest: this.nests.has(t.uid) });
    this.saveProfile(t);
  }

  damageStructure(s, amount, src) {
    if (s.cat !== 'struct' || amount <= 0 || !this.statics.has(s.id)) return;
    s.hp -= amount;
    if (src) this.fx.push({ k: 'hit', x: s.x, y: s.y, m: STRUCTURES[s.kind].mat, id: s.id });
    if (s.hp <= 0) {
      if (s.inv) this.dropContainer(s);
      this.removeStatic(s);
      this.fx.push({ k: 'break', x: s.x, y: s.y, m: STRUCTURES[s.kind].mat });
    } else this.touch(s);
  }

  // содержимое разрушенного хранилища высыпается в мешок
  dropContainer(s) {
    if (ITEM_KEYS.some((k) => s.inv[k] > 0)) this.addRemains(s.x, s.y, s.inv, 0, s.ownerName || 'хранилище');
  }

  spit(a) {
    const sp = a.stats.spit;
    const ca = Math.cos(a.angle);
    const sa = Math.sin(a.angle);
    const r0 = a.stats.radius + 8;
    const j = this.addProjectile(a, 'acid', a.x + ca * r0, a.y + sa * r0, ca * sp.speed, sa * sp.speed, sp.dmg, 0.9);
    this.fx.push({ k: 'spit', x: j.x, y: j.y });
  }

  // Снаряды летят мелкими шагами, чтобы быстрые пули не пролетали сквозь цели
  updateProjectiles(dt) {
    for (const j of this.projectiles.values()) {
      j.life -= dt;
      const owner = this.getCreature(j.owner);
      const steps = Math.max(1, Math.ceil((Math.hypot(j.vx, j.vy) * dt) / 14));
      let hit = null;
      for (let k = 0; k < steps && !hit; k++) {
        j.x += (j.vx * dt) / steps;
        j.y += (j.vy * dt) / steps;
        hit = this.projectileHit(j, owner);
      }
      const expired = j.life <= 0 || j.x < 0 || j.y < 0 || j.x > WORLD_W || j.y > WORLD_H;
      if (!hit && !expired) continue;
      this.projectiles.delete(j.id);
      if (j.kind === 'bomb') {
        this.explode(j, owner);
        continue;
      }
      if (!hit) continue;
      if (hit.type) {
        this.damageCreature(hit, j.dmg, owner, j.kind === 'acid' ? 'acid' : 'ranged');
        if (j.kind === 'acid') hit.slowT = 1.5;
        else {
          const d = Math.hypot(j.vx, j.vy) || 1;
          hit.kbx += (j.vx / d) * 60;
          hit.kby += (j.vy / d) * 60;
        }
      } else if (hit.cat === 'struct') {
        const mult = PROJ_STRUCT[j.kind] || PROJ_STRUCT.stone;
        this.damageStructure(hit, j.dmg * mult[STRUCTURES[hit.kind].mat], owner);
      }
      this.fx.push({ k: j.kind === 'acid' ? 'splash' : 'impact', x: j.x, y: j.y, m: j.kind });
    }
  }

  // во что попал снаряд: существо, твёрдая постройка или ресурс
  projectileHit(j, owner) {
    const pr = PROJ_R[j.kind] || 5;
    for (const t of this.creaturesNear(j.x, j.y, 70)) {
      if (t.id === j.owner) continue;
      if (owner && owner.type === 'npc' && t.type === 'npc') continue;
      if (Math.hypot(t.x - j.x, t.y - j.y) <= t.stats.radius + pr) return t;
    }
    for (const s of this.grid.query(j.x, j.y, 30)) {
      if (s.cat === 'struct' && STRUCTURES[s.kind].solid && circleBox(j.x, j.y, pr, s.x, s.y)) {
        if (STRUCTURES[s.kind].solid === 'owner' && owner && owner.uid === s.owner) continue;
        return s;
      }
      if (s.cat === 'res' && s.cr > 0 && Math.hypot(s.x - j.x, s.y - j.y) < s.cr + pr) return s;
    }
    return null;
  }

  // взрыв бомбы: урон существам вокруг и сильный урон постройкам
  explode(j, owner) {
    const R = j.radius || 100;
    this.fx.push({ k: 'boom', x: j.x, y: j.y });
    for (const t of this.creaturesNear(j.x, j.y, R + 40)) {
      const d = Math.hypot(t.x - j.x, t.y - j.y) - t.stats.radius;
      if (d > R) continue;
      const k = 1 - Math.max(0, d) / R;
      this.damageCreature(t, j.dmg * (0.4 + 0.6 * k), owner, 'bomb');
      const dd = Math.hypot(t.x - j.x, t.y - j.y) || 1;
      t.kbx += ((t.x - j.x) / dd) * 420 * k;
      t.kby += ((t.y - j.y) / dd) * 420 * k;
    }
    for (const s of this.grid.query(j.x, j.y, R + TILE)) {
      if (s.cat !== 'struct') continue;
      const cx = clamp(j.x, s.x - HS, s.x + HS);
      const cy = clamp(j.y, s.y - HS, s.y + HS);
      const d = Math.hypot(cx - j.x, cy - j.y);
      if (d > R) continue;
      const k = 1 - d / R;
      this.damageStructure(s, j.structDmg * (0.35 + 0.65 * k) * BOMB_STRUCT[STRUCTURES[s.kind].mat], owner);
    }
  }

  chargeStep(p, hit) {
    const ch = p.stats.charge;
    const ca = Math.cos(p.chargeDir);
    const sa = Math.sin(p.chargeDir);
    for (const t of this.creaturesNear(p.x, p.y, p.stats.radius + 70)) {
      if (t === p || p.chargeHit.has(t.id)) continue;
      if (Math.hypot(t.x - p.x, t.y - p.y) > p.stats.radius + t.stats.radius + 8) continue;
      p.chargeHit.add(t.id);
      this.damageCreature(t, ch.dmg, p, 'charge');
      t.kbx += ca * 520;
      t.kby += sa * 520;
    }
    if (hit) {
      if (hit.cat === 'struct') this.damageStructure(hit, ch.dmg * STRUCT_DMG.charge[STRUCTURES[hit.kind].mat], p);
      p.charging = 0;
      p.kbx -= ca * 180;
      p.kby -= sa * 180;
      this.fx.push({ k: 'thud', x: p.x + ca * p.stats.radius, y: p.y + sa * p.stats.radius });
    }
  }

  // ================= мир: появление существ, метеориты =================
  findSpawn() {
    for (let i = 0; i < 300; i++) {
      const tx = 3 + Math.floor(Math.random() * (MAP_W - 6));
      const ty = 3 + Math.floor(Math.random() * (MAP_H - 6));
      const t = this.tiles[ty * MAP_W + tx];
      if (t !== T.SAND && t !== T.GRASS) continue;
      const x = tx * TILE + HS;
      const y = ty * TILE + HS;
      let bad = false;
      for (const s of this.grid.query(x, y, 260)) {
        if (s.cat === 'struct' && Math.hypot(s.x - x, s.y - y) < 260) bad = true;
        else if (s.cat === 'res' && s.cr > 0 && Math.hypot(s.x - x, s.y - y) < s.cr + 26) bad = true;
        if (bad) break;
      }
      if (bad) continue;
      if (i < 200) {
        let hostile = false;
        for (const n of this.npcs.values()) {
          if (NPCS[n.kind].behavior !== 'passive' && Math.hypot(n.x - x, n.y - y) < 380) {
            hostile = true;
            break;
          }
        }
        if (hostile) continue;
      }
      return { x, y };
    }
    return { x: WORLD_W / 2, y: WORLD_H / 2 };
  }

  spawnNpc(kind, initial = false, at = null) {
    const def = NPCS[kind];
    let pos = at;
    for (let i = 0; !pos && i < 80; i++) {
      const tx = 3 + Math.floor(Math.random() * (MAP_W - 6));
      const ty = 3 + Math.floor(Math.random() * (MAP_H - 6));
      if (!def.biomes.includes(this.tiles[ty * MAP_W + tx])) continue;
      const x = tx * TILE + HS;
      const y = ty * TILE + HS;
      if (!initial && this.nearestPlayer(x, y, 700, false)) continue;
      if (zoneAt(this.zones, x, y)) continue; // в радиационных зонах живут только мутанты
      const near = this.grid.query(x, y, 200);
      if (near.some((s) => s.cat === 'struct')) continue;
      if (near.some((s) => s.cat === 'res' && s.cr > 0 && Math.hypot(s.x - x, s.y - y) < s.cr + 32)) continue;
      pos = { x, y };
    }
    if (!pos) return null;
    const stats = computeStats(decodeGenome(def.genome));
    stats.maxHp = def.hp;
    stats.meleeDmg = def.dmg;
    stats.speed = def.speed;
    stats.attackCd = def.attackCd || 0.9;
    const n = {
      id: this.nextId++, type: 'npc', kind, look: def.genome, stats, color: def.color,
      x: pos.x, y: pos.y, homeX: pos.x, homeY: pos.y, kbx: 0, kby: 0, angle: Math.random() * Math.PI * 2,
      hp: def.hp, cd: { melee: 0, spit: 0 }, atkT: 0, hitT: 0, slowT: 0, alertT: 0, combatT: 0, windupT: 0,
      target: null, wanderT: 0, wx: 0, wy: 0, spikeT: 0,
    };
    this.npcs.set(n.id, n);
    return n;
  }

  spawnMutantInZone(z, initial = true) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * z.r * 0.7;
      const x = z.x + Math.cos(a) * d;
      const y = z.y + Math.sin(a) * d;
      if (isWater(this.tileAt(x, y))) continue;
      if (!initial && this.nearestPlayer(x, y, 500, false)) continue;
      const n = this.spawnNpc('mutant', true, { x, y });
      if (n) n.zone = z.id;
      return n;
    }
    return null;
  }

  maintainNpcs(night) {
    const counts = { grazer: 0, stalker: 0, colossus: 0, mutant: 0 };
    const perZone = new Map();
    for (const n of this.npcs.values()) {
      counts[n.kind]++;
      if (n.zone !== undefined) perZone.set(n.zone, (perZone.get(n.zone) || 0) + 1);
    }
    for (const z of this.zones) {
      if ((perZone.get(z.id) || 0) < MUTANTS_PER_ZONE) this.spawnMutantInZone(z, false);
    }
    for (const kind of Object.keys(NPC_TARGET)) {
      const target = NPC_TARGET[kind] + (kind === 'stalker' && night ? NIGHT_EXTRA_STALKERS : 0);
      if (counts[kind] < target) this.spawnNpc(kind);
      if (counts[kind] < target - 4) this.spawnNpc(kind);
    }
    // днём лишние ночные хищники уходят (если их никто не видит)
    if (!night && counts.stalker > NPC_TARGET.stalker) {
      for (const n of this.npcs.values()) {
        if (n.kind === 'stalker' && !n.target && !this.nearestPlayer(n.x, n.y, 900, false)) {
          this.npcs.delete(n.id);
          break;
        }
      }
    }
  }

  updateMeteor() {
    const m = this.meteor;
    if (m.state === 'idle' && this.time >= m.next) {
      for (let i = 0; i < 200; i++) {
        const tx = 8 + Math.floor(Math.random() * (MAP_W - 16));
        const ty = 8 + Math.floor(Math.random() * (MAP_H - 16));
        const t = this.tiles[ty * MAP_W + tx];
        if (t !== T.GRASS && t !== T.FOREST && t !== T.SAND) continue;
        m.x = tx * TILE + HS;
        m.y = ty * TILE + HS;
        m.state = 'incoming';
        m.impactAt = this.time + 25;
        this.broadcast({ t: 'toast', big: true, text: '☄️ Метеорит с мутагеном падает на остров! Место отмечено на карте.' });
        return;
      }
      m.next = this.time + 30;
    } else if (m.state === 'incoming' && this.time >= m.impactAt) {
      m.state = 'landed';
      m.until = this.time + 240;
      this.fx.push({ k: 'meteor', x: m.x, y: m.y, g: 1 });
      for (const c of this.creaturesNear(m.x, m.y, 150)) this.damageCreature(c, 70, null, 'meteor');
      for (const s of this.grid.query(m.x, m.y, 90)) {
        if (s.cat === 'res' && Math.hypot(s.x - m.x, s.y - m.y) < 90) this.removeStatic(s);
        if (s.cat === 'struct') this.damageStructure(s, 400, null);
      }
      const n = 6 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const d = 55 + Math.random() * 110;
        const x = m.x + Math.cos(a) * d;
        const y = m.y + Math.sin(a) * d;
        if (isWater(this.tileAt(x, y))) continue;
        const blocked = this.grid.query(x, y, 40).some((s) => (s.cat === 'res' && Math.hypot(s.x - x, s.y - y) < s.r + 18) || (s.cat === 'struct' && circleBox(x, y, 18, s.x, s.y)));
        if (blocked) continue;
        this.addResource('crystal', x, y);
      }
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const x = m.x + Math.cos(a) * 240;
        const y = m.y + Math.sin(a) * 240;
        if (!isWater(this.tileAt(x, y))) this.spawnNpc('mutant', true, { x, y });
      }
    } else if (m.state === 'landed') {
      let left = 0;
      for (const s of this.grid.query(m.x, m.y, 260)) if (s.kind === 'crystal') left++;
      if (left === 0 || this.time > m.until) {
        for (const s of this.grid.query(m.x, m.y, 260)) if (s.kind === 'crystal') this.removeStatic(s);
        m.state = 'idle';
        m.next = this.time + 200 + Math.random() * 140;
      }
    }
  }

  processRespawns() {
    const keep = [];
    for (const r of this.respawnQueue) {
      if (this.time < r.at) {
        keep.push(r);
        continue;
      }
      if (r.crate !== undefined) {
        const z = this.zones[r.crate];
        if (z && !this.spawnCrate(z)) {
          r.at = this.time + 20;
          keep.push(r);
        }
        continue;
      }
      const def = RESOURCES[r.kind];
      const blocked = this.grid.query(r.x, r.y, TILE).some((s) => (s.cat === 'struct' && circleBox(r.x, r.y, Math.max(def.cr, def.r * 0.5), s.x, s.y)) || (s.cat === 'res' && Math.hypot(s.x - r.x, s.y - r.y) < (s.r + def.r) * 0.6))
        || this.creaturesNear(r.x, r.y, def.r + 40).length > 0;
      if (blocked) {
        r.at = this.time + 20;
        keep.push(r);
      } else this.addResource(r.kind, r.x, r.y, r.v);
    }
    this.respawnQueue = keep;
  }

  expireRemains() {
    for (const s of this.statics.values()) {
      if (s.cat === 'remains' && this.time > s.expires) this.removeStatic(s);
    }
  }

  // ================= сеть: снимки состояния =================
  serPlayer(p) {
    return {
      i: p.id, k: 'p', x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.angle * 100) / 100,
      h: Math.ceil(p.hp), mh: p.stats.maxHp, n: p.name, c: p.color, g: p.look,
      at: p.atkT > 0 ? 1 : 0, hf: p.hitT > 0 ? 1 : 0, ch: p.charging > 0 ? 1 : 0, sp: p.spawnProtect > 0 ? 1 : 0,
      w: p.weapon || undefined,
    };
  }

  serNpc(n) {
    return {
      i: n.id, k: 'n', t: n.kind, x: Math.round(n.x), y: Math.round(n.y), a: Math.round(n.angle * 100) / 100,
      h: Math.ceil(n.hp), mh: n.stats.maxHp, c: n.color, g: n.look, at: n.atkT > 0 ? 1 : 0, hf: n.hitT > 0 ? 1 : 0, wu: n.windupT > 0 ? 1 : 0,
    };
  }

  serYou(p) {
    const nest = this.nests.get(p.uid);
    // инвентарь — только ненулевые предметы, чтобы не гонять лишнее по сети
    const inv = {};
    for (const k of ITEM_KEYS) if (p.inv[k]) inv[k] = p.inv[k];
    return {
      id: p.id, hp: Math.ceil(p.hp), mh: p.stats.maxHp, f: round1(p.food), w: round1(p.water), sta: Math.round(p.stamina),
      dna: p.dna, inv, g: p.look, c: p.color,
      cd: { m: round1(p.cd.melee), s: round1(p.cd.spit), c: round1(p.cd.charge) },
      cb: p.combatT > 0 ? 1 : 0, dead: p.dead ? 1 : 0, sp: p.spawnProtect > 0 ? 1 : 0, fire: p.nearFire ? 1 : 0,
      nest: nest ? [nest.x, nest.y] : null, k: p.kills,
      wp: p.weapon, rad: round1(p.rad), rz: round1(p.radHere), bench: this.nearBench(p) ? 1 : 0,
    };
  }

  sendSnapshots(phase) {
    const sa = [...this.sAdd.values()].map((s) => this.serStatic(s));
    const sd = [...this.sDel];
    this.sAdd.clear();
    this.sDel.clear();
    const dyn = [];
    for (const p of this.players.values()) if (!p.dead) dyn.push(this.serPlayer(p));
    for (const n of this.npcs.values()) dyn.push(this.serNpc(n));
    for (const j of this.projectiles.values()) dyn.push({ i: j.id, k: 'j', t: j.kind, x: Math.round(j.x), y: Math.round(j.y), a: Math.round(j.a * 100) / 100 });
    const fx = this.fx;
    this.fx = [];
    const m = this.meteor;
    const meteor = m.state === 'idle' ? null : { x: m.x, y: m.y, s: m.state === 'incoming' ? round1(m.impactAt - this.time) : -1 };
    const st = Date.now();
    const ph = Math.round(phase * 10000) / 10000;
    for (const c of this.clients) {
      const p = c.player;
      if (!p || c.ws.readyState !== 1) continue;
      if (c.ws.bufferedAmount > 1_000_000) continue; // клиент не успевает — пропускаем кадр
      const vr = (p.dead ? 900 : p.stats.vision * VIEW_MULT) + 80;
      const vr2 = vr * vr;
      const e = [];
      for (const d of dyn) if ((d.x - p.x) ** 2 + (d.y - p.y) ** 2 <= vr2) e.push(d);
      const fr2 = (vr + 200) ** 2;
      const myFx = fx.filter((f) => f.g || (f.x - p.x) ** 2 + (f.y - p.y) ** 2 < fr2);
      if (p.pfx.length) {
        myFx.push(...p.pfx);
        p.pfx = [];
      }
      const msg = { t: 's', st, ph, you: this.serYou(p), e, m: meteor };
      if (sa.length) msg.sa = sa;
      if (sd.length) msg.sd = sd;
      if (myFx.length) msg.fx = myFx;
      c.ws.send(JSON.stringify(msg));
    }
  }

  broadcastPlayerList() {
    const list = [...this.players.values()].map((p) => ({ n: p.name, c: p.color, k: p.kills, cx: complexity(p.genome) }));
    list.sort((a, b) => b.k - a.k);
    this.broadcast({ t: 'pl', list });
  }

  // ================= сохранение =================
  serialize() {
    for (const p of this.players.values()) this.saveProfile(p);
    const structures = [];
    for (const s of this.statics.values()) {
      if (s.cat !== 'struct') continue;
      structures.push({ k: s.kind, x: s.x, y: s.y, hp: s.hp, o: s.owner, on: s.ownerName, oc: s.ownerColor, inv: s.inv });
    }
    const profiles = [...this.profiles.entries()].map(([token, prof]) => [token, prof]);
    return { v: 2, mapW: MAP_W, seed: this.seed, time: this.time, structures, profiles };
  }

  loadSaved(data) {
    if (Array.isArray(data.profiles)) {
      for (const [token, prof] of data.profiles) {
        if (typeof token !== 'string' || !prof || typeof prof.uid !== 'string') continue;
        prof.genome = sanitizeGenome(prof.genome);
        prof.inv = cleanInv(prof.inv);
        this.profiles.set(token, prof);
      }
    }
    if (Array.isArray(data.structures)) {
      for (const st of data.structures) {
        if (!STRUCTURES[st.k] || !Number.isFinite(st.x) || !Number.isFinite(st.y)) continue;
        for (const s of this.grid.query(st.x, st.y, TILE)) {
          if (s.cat === 'res' && circleBox(s.x, s.y, Math.max(s.cr, s.r * 0.5), st.x, st.y)) this.removeStatic(s);
        }
        this.addStructure(st.k, st.x, st.y, st.o, st.on, st.oc, clamp(Number(st.hp) || 1, 1, STRUCTURES[st.k].hp), st.inv);
      }
    }
  }
}
