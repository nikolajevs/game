// Состояние мира и вся игровая логика. Сервер — единственный источник правды.
import crypto from 'node:crypto';
import {
  TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T, TERRAIN_SPEED, isWater, isCold, COLD, DAY_LENGTH, isNight,
  ITEMS, ITEM_KEYS, RESOURCES, FOOD, STRUCTURES, STORAGE_CAP, STRUCT_DMG, CRAFT_MAX, USES, TRIALS, TRIPS, TRIP_MAX, buildCost, demolishRefund, repairCost, NPCS, NPC_TARGET, NIGHT_HUNTER, METEOR_GUARD, GUARDIAN_ALERT_R, EMP_TECH_MULT,
  NIGHT_STALKERS_PER_PLAYER, PLAYER, COMPLEXITY_CAP, VIEW_MULT, WEAPONS, RECIPES, PROJ_STRUCT, BOMB_STRUCT,
  RAD, CRATE, CRATE_LOOT, BENCH_RANGE, SITES, RES_CHUNK, RES_LOAD_R, RES_DROP_R, NPC_WAKE_R,
  ABILITIES, PATHS, TIER_NEED, MANA, SPIRIT_GAIN, KNOW_GAIN, LAB_RANGE, SITE_LOOT, TURRET,
  PARTS, MUT_SCHOOLS, DASH, VOICE, FRIENDS_MAX, INVITE_LIFE,
} from '../shared/config.js';
import {
  computeStats, encodeGenome, evolveCostWith, sanitizeGenome, defaultGenome, complexity, cloneGenome, overLimit,
} from '../shared/creature.js';
import { generateMap, generateResources, generateZones, zoneStrength, zoneAt, tilesHash, Grid } from './world.js';
import { updateNpc } from './ai.js';

// снаряды: радиус попадания
const PROJ_R = { acid: 7, stone: 5, arrow: 4, bullet: 3, bomb: 8, laser: 3, force: 11, fireball: 9, drain: 8, hex: 8 };

const HS = TILE / 2;
const GUARDED = new Set(['tree', 'mush_brown', 'mush_red', 'mush_glow']); // что стерегут лесные духи
const WALL_HIT = { cat: 'wall' }; // «препятствие» для стен мёртвого города
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const emptyInv = () => Object.fromEntries(ITEM_KEYS.map((k) => [k, 0]));
const round1 = (v) => Math.round(v * 10) / 10;
// участок ресурсов, в котором лежит точка (клиент считает так же)
const resChunkKey = (x, y) => Math.floor(x / RES_CHUNK) * 4096 + Math.floor(y / RES_CHUNK);
const NPC_CELL = 400; // ячейка сетки зверей для поиска соседей
// внешность игрока: пол.кожа.причёска.цвет волос.борода
const AP_RE = /^[mf]\.[01]\.[0-2]\.[0-4]\.[01]$/;
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
  constructor(seed, saved, authStore) {
    this.authStore = authStore;
    this.seed = seed;
    this.tiles = generateMap(seed);
    this.tilesHash = tilesHash(this.tiles); // карту клиент строит сам по зерну и сверяет
    this.tilesB64 = null; // запасной вариант — отправить карту целиком
    this.resChunks = new Map(); // участок -> ресурсы в нём
    this.npcGrid = new Map(); // ячейка -> звери (пересобирается каждый такт)
    this.turrets = new Set(); // автотурели игроков
    this.grid = new Grid(80);
    this.statics = new Map();
    this.nests = new Map(); // uid -> палатка (точка возрождения)
    this.players = new Map();
    this.npcs = new Map();
    this.projectiles = new Map();
    this.clients = new Set();
    this.profiles = new Map(); // секретный токен -> профиль
    this.byUid = new Map(); // uid -> профиль
    this.fr = new Map(); // uid -> множество uid друзей (дружба взаимная)
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
      for (let i = 0; i < SITES[z.kind].crates; i++) this.spawnCrate(z);
    }
    if (saved) this.loadSaved(saved);
    for (const kind of Object.keys(NPC_TARGET)) {
      for (let i = 0; i < NPC_TARGET[kind]; i++) this.spawnNpc(kind, true);
    }
    // охрана особых мест: машины в городе, руинах и рудниках, утробник со стаей в логове
    for (const z of this.zones) {
      for (const [kind, n] of Object.entries(SITES[z.kind].guards)) {
        for (let i = 0; i < n; i++) this.spawnGuard(z, kind);
      }
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
  rollLoot(z = null) {
    const inv = emptyInv();
    const table = [...CRATE_LOOT, ...(SITE_LOOT[z?.kind] || [])];
    const total = table.reduce((a, l) => a + l[3], 0);
    for (let i = 0; i < CRATE.rolls; i++) {
      let r = Math.random() * total;
      for (const [item, min, max, w] of table) {
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
      const tile = this.tileAt(x, y);
      if (isWater(tile) || tile === T.WALL) continue;
      if (z.kind === 'city' && Math.hypot(x - z.x, y - z.y) < this.zones[0].r) continue; // воронка — отдельное место
      if (this.grid.query(x, y, 40).some((s) => Math.hypot(s.x - x, s.y - y) < (s.r || 20) + 18)) continue;
      const [mn, mx] = CRATE.mutagen;
      const dna = (mn + Math.floor(Math.random() * (mx - mn + 1))) * (z.lvl || 1);
      const s = { id: this.nextId++, cat: 'crate', kind: 'crate', x, y, r: 18, inv: this.rollLoot(z), dna, zone: z.id };
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
    s.chunk = resChunkKey(x, y);
    this.statics.set(s.id, s);
    this.grid.insert(s);
    let set = this.resChunks.get(s.chunk);
    if (!set) this.resChunks.set(s.chunk, (set = new Set()));
    set.add(s);
    this.sAdd.set(s.id, s);
    return s;
  }

  // Какие участки ресурсов должны быть у игрока: ближние догружаем, дальние забываем.
  // Возвращает новые ресурсы (для приветствия) или сам отправляет их сообщением 'res'.
  syncResChunks(p, initial = false) {
    const cx = Math.floor(p.x / RES_CHUNK);
    const cy = Math.floor(p.y / RES_CHUNK);
    if (!initial && cx === p.rcx && cy === p.rcy) return null;
    p.rcx = cx;
    p.rcy = cy;
    const half = RES_CHUNK / 2;
    const add = [];
    const drop = [];
    const span = Math.ceil(RES_LOAD_R / RES_CHUNK) + 1;
    for (let j = cy - span; j <= cy + span; j++) {
      for (let i = cx - span; i <= cx + span; i++) {
        if (i < 0 || j < 0) continue;
        const key = i * 4096 + j;
        if (p.resLoaded.has(key)) continue;
        if (Math.hypot((i * RES_CHUNK + half) - p.x, (j * RES_CHUNK + half) - p.y) > RES_LOAD_R + half) continue;
        p.resLoaded.add(key);
        const set = this.resChunks.get(key);
        if (set) for (const s of set) add.push(this.serStatic(s));
      }
    }
    for (const key of p.resLoaded) {
      const i = Math.floor(key / 4096);
      const j = key % 4096;
      if (Math.hypot((i * RES_CHUNK + half) - p.x, (j * RES_CHUNK + half) - p.y) > RES_DROP_R + half) {
        p.resLoaded.delete(key);
        drop.push(key);
      }
    }
    if (initial) return add;
    if (add.length || drop.length) this.send(p.client, { t: 'res', add, drop });
    return null;
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
    if (kind === 'turret') {
      s.cd = 0;
      this.turrets.add(s);
    }
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
    if (s.cat === 'res') this.resChunks.get(s.chunk)?.delete(s);
    if (s.kind === 'turret') this.turrets.delete(s);
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
    this.endTrial(p);
    this.saveProfile(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'chat', sys: true, text: `${p.name} покинул остров` });
    for (const q of this.players.values()) if (this.isFriend(q.uid, p.uid)) this.sendFriends(q);
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
    if (msg.t === 'tiles') {
      if (!this.tilesB64) this.tilesB64 = Buffer.from(this.tiles).toString('base64');
      return this.send(client, { t: 'tiles', tiles: this.tilesB64 });
    }
    const p = client.player;
    if (!p) return;
    switch (msg.t) {
      case 'in': return this.onInput(p, msg);
      case 'charge': return this.tryCharge(p, msg);
      case 'build': return this.onBuild(p, msg);
      case 'demolish': return this.onDemolish(p, msg);
      case 'repair': return this.onRepair(p, msg);
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
      case 'learn': return this.onLearn(p, msg);
      case 'resetPath': return this.onResetPath(p);
      case 'research': return this.onResearch(p, msg);
      case 'absorb': return this.onAbsorb(p);
      case 'trial': return this.onTrial(p);
      case 'cast': return this.onCast(p, msg);
      case 'dash': return this.tryDash(p, msg);
      case 'friend': return this.onFriend(p, msg);
      case 'voice': return this.onVoice(p, msg);
      case 'talk': p.talk = p.voice && !!msg.on; return undefined;
      case 'rtc': return this.onRtc(p, msg);
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
    const ab = ABILITIES[item];
    if (ab) {
      if (ab.kind === 'spell' && p.abil.has(item)) p.weapon = item; // заклинание «в руке», ЛКМ — применить
      return;
    }
    if (!WEAPONS[item] || !(p.inv[item] > 0)) return;
    p.weapon = item;
  }

  nearLab(p) {
    for (const s of this.grid.query(p.x, p.y, LAB_RANGE + TILE)) {
      if (s.kind === 'lab' && Math.hypot(s.x - p.x, s.y - p.y) <= LAB_RANGE) return true;
    }
    return false;
  }

  // сколько очков вложено в путь
  spentOn(p, path) {
    let n = 0;
    for (const id of p.abil) if (ABILITIES[id].path === path) n += ABILITIES[id].cost;
    return n;
  }

  // ================= пути развития =================
  onLearn(p, m) {
    if (p.dead) return;
    const ab = ABILITIES[m.id];
    if (!ab || p.abil.has(m.id)) return;
    const path = PATHS[ab.path];
    if (!p.path) return this.toast(p, 'Сначала пройдите испытание пути у алтаря выбора');
    if (p.path !== ab.path) return this.toast(p, `Этот путь закрыт: вы выбрали ${PATHS[p.path].name.toLowerCase()}`);
    if (this.spentOn(p, ab.path) < TIER_NEED[ab.tier]) return this.toast(p, `Сначала вложите ${TIER_NEED[ab.tier]} очков в нижние ступени`);
    if (p[path.pt] < ab.cost) return this.toast(p, `Не хватает: ${path.ptName.toLowerCase()} (${p[path.pt]}/${ab.cost})`);
    p[path.pt] -= ab.cost;
    p.abil.add(m.id);
    this.applyGenome(p);
    if (ab.path === 'spirit') p.mana = Math.min(p.maxMana, p.mana + 30);
    this.fx.push({ k: 'learn', x: p.x, y: p.y, c: path.color });
    this.toast(p, `${ab.icon} Изучено: ${ab.name}`);
  }

  // ---------- испытания пути (у алтаря выбора) ----------
  atShrine(p) {
    const z = zoneAt(this.zones, p.x, p.y);
    return z && z.kind === 'shrine' ? z : null;
  }

  // испытание пройдено: путь выбран навсегда
  setPath(p, id) {
    const path = PATHS[id];
    p.path = id;
    this.applyGenome(p);
    if (id === 'spirit') p.mana = p.maxMana;
    this.fx.push({ k: 'learn', x: p.x, y: p.y, c: path.color });
    this.send(p.client, { t: 'toast', big: true, text: `${path.icon} Испытание пройдено: вы ступили на ${path.name.toLowerCase()}. Это навсегда.` });
    this.broadcast({ t: 'chat', sys: true, text: `${p.name} выбирает ${path.name.toLowerCase()}` });
    this.saveProfile(p);
  }

  // Испытание духа: гриб, кактус и жаба съедаются разом — начинается трип,
  // и в нём вокруг алтаря появляются проводники в мир духов. Их видит и может убить только сам игрок.
  onTrial(p) {
    if (p.dead) return;
    if (p.path) return this.toast(p, `Вы уже выбрали ${PATHS[p.path].name.toLowerCase()}`);
    if (p.trial) return this.toast(p, 'Трип уже идёт — ищите проводников');
    const z = this.atShrine(p);
    if (!z) return this.toast(p, 'Ритуал проводят у алтаря выбора');
    const T_ = TRIALS.spirit;
    const miss = T_.items.filter((k) => !(p.inv[k] > 0));
    if (miss.length) return this.toast(p, `Не хватает: ${miss.map((k) => ITEMS[k].name.toLowerCase()).join(', ')}`);
    for (const k of T_.items) p.inv[k]--;
    for (const k in p.trip) p.trip[k] = T_.time; // все три трипа разом — со всеми их бонусами
    const ids = [];
    for (let i = 0; i < T_.guides; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const a = Math.random() * Math.PI * 2;
        const d = T_.spread[0] + Math.random() * (T_.spread[1] - T_.spread[0]);
        const x = z.x + Math.cos(a) * d;
        const y = z.y + Math.sin(a) * d;
        if (isWater(this.tileAt(x, y))) continue;
        const n = this.spawnNpc('guide', true, { x, y });
        n.owner = p.id;
        n.leash = 230;
        ids.push(n.id);
        break;
      }
    }
    p.trial = { until: this.time + T_.time, guides: ids, left: ids.length };
    this.fx.push({ k: 'learn', x: p.x, y: p.y, c: PATHS.spirit.color });
    this.send(p.client, { t: 'toast', big: true, text: `🔮 Гриб, кактус и жаба съедены. Мир рвётся по швам: где-то рядом ${ids.length} проводника в мир духов — найдите и убейте их, пока длится трип!` });
  }

  endTrial(p, text) {
    if (!p.trial) return;
    for (const id of p.trial.guides) this.npcs.delete(id);
    p.trial = null;
    if (text) this.send(p.client, { t: 'toast', big: true, text });
  }

  onResetPath(p) {
    if (p.dead || !p.path) return;
    const name = PATHS[p.path].name;
    p.path = null;
    p.abil.clear();
    if (ABILITIES[p.weapon]) p.weapon = null;
    this.applyGenome(p);
    p.mana = 0;
    this.send(p.client, { t: 'toast', big: true, text: `${name} оставлен: умения и вложенные очки потеряны` });
  }

  onResearch(p, m) {
    if (p.dead) return;
    if (!this.nearLab(p)) return this.toast(p, 'Нужна лаборатория рядом (постройка B)');
    if (p.path === 'spirit') return this.toast(p, 'Путь духа закрыл для вас науку');
    if (m.kind === 'data') {
      const n = p.inv.data || 0;
      if (!n) return this.toast(p, 'Нет носителей данных — ищите их в ящиках руин и рудников');
      p.inv.data = 0;
      p.know += n * KNOW_GAIN.data;
      p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${n * KNOW_GAIN.data} 📘 знаний` });
    } else if (m.kind === 'experiment') {
      const ex = KNOW_GAIN.experiment;
      for (const k in ex.cost) if ((p.inv[k] || 0) < ex.cost[k]) return this.toast(p, 'Не хватает ресурсов для опыта');
      for (const k in ex.cost) p.inv[k] -= ex.cost[k];
      p.know += ex.gain;
      p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${ex.gain} 📘 знаний` });
    }
  }

  onAbsorb(p) {
    if (p.dead) return;
    if (p.path === 'mind') return this.toast(p, 'Путь разума закрыл для вас силу духа');
    const n = p.inv.artifact || 0;
    if (!n) return this.toast(p, 'Нет артефактов — их находят в тайниках логов утробников');
    p.inv.artifact = 0;
    p.spirit += n * SPIRIT_GAIN.artifact;
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${n * SPIRIT_GAIN.artifact} ✨ силы духа` });
    this.fx.push({ k: 'learn', x: p.x, y: p.y, c: PATHS.spirit.color });
  }

  // мгновенные умения: щит духа и ЭМИ-импульс
  onCast(p, m) {
    const ab = ABILITIES[m.id];
    if (p.dead || !ab || ab.kind !== 'instant' || !p.abil.has(m.id) || p.stunT > 0) return;
    if ((p.abcd[m.id] || 0) > 0) return;
    if (ab.mana && p.mana < ab.mana) return this.toast(p, 'Не хватает маны');
    if (ab.mana) p.mana -= ab.mana;
    p.abcd[m.id] = ab.cd * p.stats.abilCd;
    p.atkT = 0.25;
    if (m.id === 'shield') {
      p.shieldHp = ab.absorb;
      p.shieldT = ab.time;
      this.fx.push({ k: 'shield', x: p.x, y: p.y });
    } else if (m.id === 'emp') {
      this.fx.push({ k: 'emp', x: p.x, y: p.y, r: ab.r });
      for (const c of this.creaturesNear(p.x, p.y, ab.r + 40)) {
        if (c === p || c.dead || Math.hypot(c.x - p.x, c.y - p.y) > ab.r + c.stats.radius) continue;
        const tech = c.type === 'npc' && NPCS[c.kind].faction === 'tech' ? EMP_TECH_MULT : 1; // машины выжигает сильнее
        if (this.damageCreature(c, ab.dmg * tech, p, 'emp') > 0) c.stunT = ab.stun * (tech > 1 ? 1.6 : 1);
      }
    }
  }

  // заклинание «в руке»: ЛКМ — применить в сторону курсора
  castSpell(p, id) {
    const ab = ABILITIES[id];
    if (p.stunT > 0) return;
    if ((p.abcd[id] || 0) > 0) {
      p.cd.melee = 0.1;
      return;
    }
    if (p.mana < ab.mana) {
      p.cd.melee = 0.3;
      if (p.warnT <= 0) {
        p.warnT = 2;
        this.toast(p, 'Не хватает маны');
      }
      return;
    }
    p.mana -= ab.mana;
    p.abcd[id] = ab.cd * p.stats.abilCd;
    p.cd.melee = Math.min(ab.cd, 0.45);
    p.atkT = 0.25;
    if (id === 'blink') {
      if (!this.blink(p, ab)) {
        p.mana += ab.mana;
        p.abcd[id] = 0.3;
      }
      return;
    }
    const ca = Math.cos(p.angle);
    const sa = Math.sin(p.angle);
    const r0 = p.stats.radius + 10;
    this.addProjectile(p, ab.proj, p.x + ca * r0, p.y + sa * r0, ca * ab.speed, sa * ab.speed, ab.dmg, ab.life, ab);
    this.fx.push({ k: 'cast', x: p.x + ca * r0, y: p.y + sa * r0, m: id });
  }

  // телепорт к курсору: сквозь чужие стены не пускает — встаёт перед ними
  blink(p, ab) {
    const dist = Math.min(ab.range, Math.max(40, p.aimD || ab.range));
    const ca = Math.cos(p.angle);
    const sa = Math.sin(p.angle);
    const r = p.stats.radius;
    const free = (x, y) => {
      for (const s of this.grid.query(x, y, TILE + r)) {
        if (s.cat === 'struct' && this.blocks(s, p) && circleBox(x, y, r, s.x, s.y)) return false;
        if (s.cat === 'res' && s.cr > 0 && Math.hypot(s.x - x, s.y - y) < s.cr + r) return false;
      }
      if (this.wallNear(x, y, r)) return false;
      return x > 30 && y > 30 && x < WORLD_W - 30 && y < WORLD_H - 30;
    };
    let bx = null;
    let by = null;
    for (let k = 15; k <= dist; k += 15) {
      const x = p.x + ca * k;
      const y = p.y + sa * k;
      // постройка на пути — дальше нельзя
      if (this.grid.query(x, y, TILE).some((s) => s.cat === 'struct' && this.blocks(s, p) && circleBox(x, y, 6, s.x, s.y))) break;
      if (this.tileAt(x, y) === T.WALL) break; // и сквозь стены города тоже
      if (free(x, y)) {
        bx = x;
        by = y;
      }
    }
    if (bx === null) {
      this.toast(p, 'Некуда перенестись');
      return false;
    }
    this.fx.push({ k: 'blink', x: p.x, y: p.y });
    p.x = bx;
    p.y = by;
    p.kbx = 0;
    p.kby = 0;
    this.fx.push({ k: 'blink', x: bx, y: by, to: 1 });
    return true;
  }

  // щит, оглушение, проклятие — общие для игроков и зверей
  statusTick(e, dt) {
    if (e.shieldT > 0) {
      e.shieldT -= dt;
      if (e.shieldT <= 0) e.shieldHp = 0;
    }
    if (e.stunT > 0) e.stunT = Math.max(0, e.stunT - dt);
    if (e.hexT > 0) {
      e.hexT -= dt;
      e.slowT = Math.max(e.slowT, 0.2);
      e.hexTick = (e.hexTick || 0) + dt;
      if (e.hexTick >= 1) {
        e.hexTick -= 1;
        this.damageCreature(e, e.hexDps || 6, this.getCreature(e.hexSrc), 'hex');
      }
    }
    if (e.corrT > 0) e.corrT -= dt; // кислота разъела защиту
    // кровотечение от когтей зверя
    if (e.bleedT > 0 && !e.dead) {
      e.bleedT -= dt;
      e.bleedTick = (e.bleedTick || 0) + dt;
      if (e.bleedTick >= 1) {
        e.bleedTick -= 1;
        this.damageCreature(e, e.bleedDps || 4, this.getCreature(e.bleedSrc), 'bleed');
      }
    }
  }

  // автотурели: стреляют по враждебным зверям и чужим игрокам
  updateTurrets(dt) {
    for (const s of this.turrets) {
      s.cd -= dt;
      if (s.cd > 0) continue;
      let best = null;
      let bd = TURRET.range;
      for (const c of this.creaturesNear(s.x, s.y, TURRET.range)) {
        if (c.dead) continue;
        if (c.type === 'npc' && (NPCS[c.kind].behavior === 'passive' || c.owner)) continue;
        if (c.type === 'player' && (c.uid === s.owner || c.spawnProtect > 0 || this.isFriend(s.owner, c.uid))) continue; // своих и друзей не трогает
        const d = Math.hypot(c.x - s.x, c.y - s.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (!best) {
        s.cd = 0.3;
        continue;
      }
      s.cd = TURRET.cd;
      let owner = null;
      for (const p of this.players.values()) if (p.uid === s.owner) owner = p;
      const a = Math.atan2(best.y - s.y, best.x - s.x);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = s.x + ca * 34;
      const y = s.y + sa * 34;
      this.addProjectile(owner || { id: -s.id, uid: s.owner }, 'bullet', x, y, ca * TURRET.speed, sa * TURRET.speed, TURRET.dmg, TURRET.range / TURRET.speed + 0.05);
      this.fx.push({ k: 'shot', x, y, m: 'bullet' });
    }
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
    // технологии и ритуалы — только своему пути
    // исключение — испытание разума: без пути, у алтаря выбора, на собранном там верстаке
    const trial = !!rec.trial && !p.path && !!this.atShrine(p);
    if (rec.path && p.path !== rec.path && !trial) {
      return this.toast(p, rec.trial && !p.path ? 'Испытание разума проходят у алтаря выбора: соберите там верстак' : `Это умеет только ${PATHS[rec.path].name.toLowerCase()}`);
    }
    if (rec.bench && !this.nearBench(p)) return this.toast(p, 'Нужен верстак рядом');
    if (rec.ability && !p.abil.has(rec.ability)) return this.toast(p, `Нужно умение «${ABILITIES[rec.ability].name}» (путь разума)`);
    if (rec.lab && !this.nearLab(p)) return this.toast(p, 'Нужна лаборатория рядом');
    if (rec.fire && !p.nearFire) return this.toast(p, 'Ритуал проводят у костра');
    // сколько раз подряд: не больше, чем хватает ресурсов
    let times = clamp(Math.floor(Number(m.n) || 1), 1, CRAFT_MAX);
    for (const k in rec.cost) times = Math.min(times, Math.floor((p.inv[k] || 0) / rec.cost[k]));
    if (times < 1) return this.toast(p, 'Не хватает ресурсов');
    for (const k in rec.cost) p.inv[k] -= rec.cost[k] * times;
    const out = (rec.out || 1) * times;
    p.inv[m.item] += out;
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${out} ${ITEMS[m.item].icon} ${ITEMS[m.item].name}` });
    // новое оружие сразу в лапы, если они свободны
    if (WEAPONS[m.item] && !p.weapon && p.stats.canHold) p.weapon = m.item;
    if (trial) this.setPath(p, 'mind'); // оружие создано своими руками — испытание разума пройдено
  }

  onUse(p, m) {
    if (p.dead) return;
    if (m.item === 'elixir') {
      if (!(p.inv.elixir > 0)) return this.toast(p, 'Нет эликсира духа — его варят у костра на пути духа (C)');
      p.inv.elixir--;
      p.mana = Math.min(p.maxMana, p.mana + USES.elixir.mana);
      p.hp = Math.min(p.stats.maxHp, p.hp + USES.elixir.hp);
      p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${USES.elixir.mana} ✦  +${USES.elixir.hp} ❤` });
      return;
    }
    if (m.item !== 'antirad') return;
    if (!(p.inv.antirad > 0)) return this.toast(p, 'Нет антирада — создайте его в меню крафта (C)');
    p.inv.antirad--;
    p.rad = Math.max(0, p.rad - RAD.antirad);
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `−${RAD.antirad} ☢` });
  }

  onJoin(client, msg) {
    if (client.player) return;
    const token = typeof msg.token === 'string' && /^[a-f0-9]{32}$/.test(msg.token) ? msg.token : null;
    const account = token ? this.authStore.session(token) : null;
    if (!account) {
      this.send(client, { t: 'authError', text: 'Войдите в аккаунт или зарегистрируйтесь.' });
      return;
    }
    if ([...this.players.values()].some((p) => p.token === token)) {
      this.send(client, { t: 'authError', text: 'Этот аккаунт уже находится в игре.' });
      return;
    }
    const name = String(msg.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Безымянный';
    const color = /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : '#6fbf73';
    let prof = this.profiles.get(token);
    if (!prof) {
      prof = { uid: crypto.randomBytes(6).toString('hex'), genome: defaultGenome(), dna: PLAYER.startDna, inv: emptyInv(), alive: false, kills: 0 };
      this.profiles.set(token, prof);
      this.byUid.set(prof.uid, prof);
    }
    prof.name = name;
    prof.color = color;
    // внешность: пол.кожа.причёска.цвет волос.борода
    if (typeof msg.ap === 'string' && AP_RE.test(msg.ap)) prof.ap = msg.ap;
    if (!prof.ap) prof.ap = 'm.0.1.0.0';
    const p = this.createPlayer(client, token, prof);
    client.player = p;
    // постройки, ящики и останки — все сразу (их немного), ресурсы — только ближние участки
    const statics = [];
    for (const s of this.statics.values()) if (s.cat !== 'res') statics.push(this.serStatic(s));
    statics.push(...this.syncResChunks(p, true));
    this.send(client, {
      t: 'welcome', id: p.id, uid: prof.uid, token, seed: this.seed, th: this.tilesHash, zones: this.zones, statics,
    });
    this.broadcast({ t: 'chat', sys: true, text: `${name} появился на острове` });
    this.broadcastPlayerList();
    this.sendFriends(p);
    for (const q of this.players.values()) if (q !== p && this.isFriend(q.uid, p.uid)) this.sendFriends(q);
  }

  linkProfile(fromToken, toToken) {
    if (typeof fromToken !== 'string' || !/^[a-f0-9]{32}$/.test(fromToken) || fromToken === toToken ||
        this.authStore.hasToken(fromToken) || this.profiles.has(toToken)) return false;
    const prof = this.profiles.get(fromToken);
    if (!prof) return false;
    this.profiles.delete(fromToken);
    this.profiles.set(toToken, prof);
    return true;
  }

  createPlayer(client, token, prof) {
    const p = {
      id: this.nextId++, type: 'player', client, token, uid: prof.uid, prof,
      name: prof.name, color: prof.color, ap: prof.ap, genome: sanitizeGenome(prof.genome), look: '', stats: null, mutAcc: 0,
      x: 0, y: 0, kbx: 0, kby: 0, angle: 0,
      hp: 100, food: 80, water: 80, stamina: 100, dna: Math.max(0, Math.floor(prof.dna || 0)), inv: cleanInv(prof.inv),
      input: idleInput(),
      cd: { melee: 0, spit: 0, charge: 0, dash: 0 },
      dashT: 0, dashDir: 0, shockN: 0, bleedT: 0, corrT: 0,
      invites: new Map(), lastInvite: -10, voice: false, talk: false, // приглашения в друзья: uid -> { name, until }
      combatT: 0, atkT: 0, hitT: 0, slowT: 0, spikeT: 0, drinkT: 0, eatT: 0, lastChat: -10,
      charging: 0, chargeDir: 0, chargeHit: null,
      spawnProtect: PLAYER.spawnProtect, dead: false, openCont: null, nearFire: false,
      resLoaded: new Set(), rcx: null, rcy: null,
      // путь развития: очки, умения, мана и состояния
      path: PATHS[prof.path] ? prof.path : null, know: Math.max(0, prof.know | 0), spirit: Math.max(0, prof.spirit | 0),
      abil: new Set((prof.abil || []).filter((id) => ABILITIES[id] && ABILITIES[id].path === prof.path)),
      mana: 0, maxMana: MANA.base, abcd: {}, aimD: 300,
      shieldHp: 0, shieldT: 0, hexT: 0, hexSrc: null, stunT: 0, altars: new Map(), medT: 0, meditating: false, medWarnT: 0,
      halT: 0, halS: 0, // галлюцинации от грибов
      trip: { a: 0, p: 0, t: 0 }, // трипы от мухомора, пейотля и жабы: сколько секунд осталось
      kills: prof.kills || 0, pfx: [], weapon: null, rad: clamp(Number(prof.rad) || 0, 0, 100), radHere: 0, cold: 0, inCold: false, warnT: 0,
    };
    this.applyGenome(p);
    p.mana = p.maxMana;
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
    p.genome.mouth = 'omni'; // человек всеяден
    p.stats = computeStats(p.genome);
    p.look = encodeGenome(p.genome);
    // умения пути: экзоскелет и запас маны
    if (p.abil?.has('exo')) {
      p.stats.speed *= ABILITIES.exo.speed;
      p.stats.defense = Math.min(0.8, p.stats.defense + ABILITIES.exo.def);
    }
    if (p.abil) {
      let spells = 0;
      for (const id of p.abil) if (ABILITIES[id].path === 'spirit') spells++;
      p.maxMana = MANA.base + spells * MANA.perAbility + p.stats.manaMax; // «блуждающий огонь» расширяет запас маны
      p.mana = Math.min(p.mana || 0, p.maxMana);
    }
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
    prof.path = p.path;
    prof.know = p.know;
    prof.spirit = p.spirit;
    prof.abil = [...p.abil];
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
    if (Number.isFinite(m.ad)) p.aimD = clamp(m.ad, 0, 2000);
  }

  tryCharge(p, m) {
    if (p.dead || !p.stats.charge || p.cd.charge > 0 || p.charging > 0) return;
    if (Number.isFinite(m.ang)) p.angle = m.ang;
    p.cd.charge = p.stats.charge.cd;
    p.charging = 0.32;
    p.chargeDir = p.angle;
    p.chargeHit = new Set();
  }

  // рывок на реактивных ускорителях (мутация jets): в сторону курсора, не дальше него
  tryDash(p, m) {
    const d = p.stats.dash;
    if (p.dead || !d || p.cd.dash > 0 || p.dashT > 0 || p.charging > 0 || p.stunT > 0) return;
    if (Number.isFinite(m.ang)) p.angle = m.ang;
    p.cd.dash = d.cd;
    p.dashDir = p.angle;
    p.dashT = clamp(Math.min(d.dist, p.aimD || d.dist), 60, d.dist) / DASH.speed;
    this.fx.push({ k: 'dash', x: p.x, y: p.y });
  }

  dashEnd(p) {
    p.dashT = 0;
    const blast = p.stats.dash?.blast;
    if (!blast) return;
    this.fx.push({ k: 'emp', x: p.x, y: p.y, r: DASH.blastR });
    for (const c of this.creaturesNear(p.x, p.y, DASH.blastR + 40)) {
      if (c === p || c.dead || this.isFriend(p.uid, c.uid)) continue;
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > DASH.blastR + c.stats.radius) continue;
      this.damageCreature(c, blast, p, 'dash');
      c.kbx += (dx / d) * 320 * (c.stats.kbResist || 1);
      c.kby += (dy / d) * 320 * (c.stats.kbResist || 1);
    }
  }

  // ================= друзья =================
  // Дружба взаимная: приглашение → согласие. Друзьям нельзя нанести урон, они проходят в ваши двери,
  // их не трогают ваши колья и турели, они могут чинить ваши постройки.
  isFriend(a, b) {
    if (!a || !b || a === b) return false;
    const set = this.fr.get(a);
    return !!set && set.has(b);
  }

  playerByUid(uid) {
    for (const p of this.players.values()) if (p.uid === uid) return p;
    return null;
  }

  setFriends(a, b, on) {
    for (const [x, y] of [[a, b], [b, a]]) {
      let set = this.fr.get(x);
      if (!set) this.fr.set(x, (set = new Set()));
      if (on) set.add(y);
      else set.delete(y);
      const prof = this.byUid.get(x);
      if (prof) prof.friends = [...set];
    }
  }

  sendFriends(p) {
    const list = [];
    for (const uid of this.fr.get(p.uid) || []) {
      const q = this.playerByUid(uid);
      const prof = this.byUid.get(uid);
      list.push(q ? { u: uid, n: q.name, c: q.color, on: 1, i: q.id, x: Math.round(q.x), y: Math.round(q.y), vc: q.voice ? 1 : 0, dd: q.dead ? 1 : 0 }
        : { u: uid, n: prof?.name || '?', c: prof?.color || '#888888', on: 0 });
    }
    const inv = [];
    for (const [uid, v] of p.invites) {
      if (v.until < this.time) p.invites.delete(uid);
      else inv.push({ u: uid, n: v.name });
    }
    this.send(p.client, { t: 'friends', list, inv, max: FRIENDS_MAX });
  }

  onFriend(p, m) {
    const uid = typeof m.uid === 'string' ? m.uid : '';
    const mine = this.fr.get(p.uid);
    const full = (u) => (this.fr.get(u)?.size || 0) >= FRIENDS_MAX;
    const link = (q, name) => {
      this.setFriends(p.uid, uid, true);
      p.invites.delete(uid);
      q?.invites.delete(p.uid);
      this.toast(p, `🤝 ${name} теперь ваш друг: ваши двери открыты друг другу, а урон не проходит`);
      if (q) {
        this.toast(q, `🤝 ${p.name} теперь ваш друг: ваши двери открыты друг другу, а урон не проходит`);
        this.sendFriends(q);
      }
    };
    if (m.op === 'invite') {
      const q = this.playerByUid(uid);
      if (!q || q === p) return this.toast(p, 'Этот игрок не в сети');
      if (mine?.has(uid)) return this.toast(p, `${q.name} уже ваш друг`);
      if (full(p.uid)) return this.toast(p, `Друзей не больше ${FRIENDS_MAX}`);
      if (full(uid)) return this.toast(p, `У ${q.name} уже слишком много друзей`);
      const back = p.invites.get(uid);
      if (back && back.until >= this.time) link(q, q.name); // он уже звал вас — сразу дружба
      else {
        if (this.time - p.lastInvite < 1.5) return;
        p.lastInvite = this.time;
        q.invites.set(p.uid, { name: p.name, until: this.time + INVITE_LIFE });
        this.toast(p, `Приглашение отправлено: ${q.name}`);
        this.send(q.client, { t: 'toast', big: true, text: `🤝 ${p.name} зовёт вас в друзья — откройте окно друзей (O), чтобы ответить` });
        this.sendFriends(q);
      }
    } else if (m.op === 'accept') {
      const inv = p.invites.get(uid);
      if (!inv || inv.until < this.time) {
        p.invites.delete(uid);
        this.toast(p, 'Приглашение устарело');
      } else if (full(p.uid) || full(uid)) this.toast(p, `Друзей не больше ${FRIENDS_MAX}`);
      else link(this.playerByUid(uid), inv.name);
    } else if (m.op === 'decline') {
      p.invites.delete(uid);
    } else if (m.op === 'remove') {
      if (!mine?.has(uid)) return;
      this.setFriends(p.uid, uid, false);
      const q = this.playerByUid(uid);
      this.toast(p, `${q?.name || this.byUid.get(uid)?.name || 'Игрок'} больше не ваш друг`);
      if (q) {
        this.toast(q, `${p.name} больше не ваш друг: двери закрыты, урон снова проходит`);
        this.sendFriends(q);
      }
    } else return;
    this.sendFriends(p);
  }

  // ================= голос =================
  // Сам звук идёт между браузерами напрямую (WebRTC); сервер только знакомит их друг с другом.
  onVoice(p, m) {
    p.voice = !!m.on;
    if (!p.voice) p.talk = false;
    for (const q of this.players.values()) if (this.isFriend(q.uid, p.uid)) this.sendFriends(q);
  }

  onRtc(p, m) {
    const q = this.players.get(Number(m.to));
    if (!q || q === p || !p.voice || !q.voice || !m.d || typeof m.d !== 'object') return;
    // знакомим только тех, кто рядом, и друзей (они слышат друг друга по «рации» где угодно)
    if (!this.isFriend(p.uid, q.uid) && Math.hypot(q.x - p.x, q.y - p.y) > VOICE.range * 1.6) return;
    this.send(q.client, { t: 'rtc', from: p.id, d: m.d });
  }

  onBuild(p, m) {
    if (p.dead) return;
    const def = STRUCTURES[m.kind];
    if (!def) return;
    if (def.ability && !p.abil.has(def.ability)) return this.toast(p, `Нужно умение «${ABILITIES[def.ability].name}» (путь разума)`);
    const tx = Math.floor(Number(m.x) / TILE);
    const ty = Math.floor(Number(m.y) / TILE);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return;
    const x = tx * TILE + HS;
    const y = ty * TILE + HS;
    if (Math.hypot(x - p.x, y - p.y) > PLAYER.buildRange + HS) return this.toast(p, 'Слишком далеко для стройки');
    if (isWater(this.tiles[ty * MAP_W + tx])) return this.toast(p, 'Нельзя строить на воде');
    if (this.tiles[ty * MAP_W + tx] === T.WALL) return this.toast(p, 'Здесь стоит стена');
    const cost = buildCost(m.kind, p.path); // части верстака нужны всем, кроме пути разума
    for (const k in cost) if ((p.inv[k] || 0) < cost[k]) return this.toast(p, def.parts && !(k in def.cost) ? `Нужна часть верстака: ${ITEMS[k].name.toLowerCase()}` : 'Не хватает ресурсов');
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
    for (const k in cost) p.inv[k] -= cost[k];
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
    const back = demolishRefund(s.kind, s.hp, s.maxHp);
    for (const k in back) p.inv[k] += back[k];
    const text = Object.entries(back).map(([k, v]) => `+${v} ${ITEMS[k].icon}`).join('  ');
    if (text) p.pfx.push({ k: 'gain', x: s.x, y: s.y, text });
    if (s.inv) this.dropContainer(s);
    this.removeStatic(s);
    this.fx.push({ k: 'break', x: s.x, y: s.y, m: def.mat });
  }

  // ремонт своей постройки до полной прочности: цена — доля её стоимости по утраченному запасу
  onRepair(p, m) {
    const s = this.statics.get(Number(m.id));
    if (!s || s.cat !== 'struct' || p.dead) return;
    if (s.owner !== p.uid && !this.isFriend(s.owner, p.uid)) return; // чинить можно свои постройки и постройки друзей
    if (Math.hypot(s.x - p.x, s.y - p.y) > PLAYER.buildRange + TILE) return this.toast(p, 'Слишком далеко');
    if (p.combatT > 0) return this.toast(p, 'В бою чинить нельзя');
    const cost = repairCost(s.kind, s.hp, s.maxHp);
    if (!Object.keys(cost).length) return this.toast(p, 'Постройка цела');
    for (const k in cost) if ((p.inv[k] || 0) < cost[k]) return this.toast(p, 'Не хватает ресурсов на ремонт');
    for (const k in cost) p.inv[k] -= cost[k];
    s.hp = s.maxHp;
    this.touch(s);
    this.fx.push({ k: 'hit', x: s.x, y: s.y, m: STRUCTURES[s.kind].mat, id: s.id });
    p.pfx.push({ k: 'gain', x: s.x, y: s.y, text: '🔧 Починено' });
  }

  onEvolve(p, m) {
    if (p.dead) return;
    if (p.combatT > 0) return this.toast(p, 'Нельзя эволюционировать в бою');
    const g = sanitizeGenome(m.genome);
    g.mouth = 'omni';
    const genetics = p.abil.has('genetics');
    if (complexity(g) > COMPLEXITY_CAP + (genetics ? ABILITIES.genetics.cap : 0)) return this.toast(p, 'Тело не выдержит столько мутаций');
    // третий уровень («предел») — только мутациям школы своего пути
    const over = overLimit(p.genome, g, p.path);
    if (over.length) return this.toast(p, `«${PARTS[over[0]].name}»: этот уровень откроет ${PATHS[MUT_SCHOOLS[PARTS[over[0]].school].path].name.toLowerCase()}`);
    const c = evolveCostWith(p.genome, g, genetics);
    if (c.net > p.dna) return this.toast(p, 'Не хватает мутагена');
    for (const k in c.items) if ((p.inv[k] || 0) < c.items[k]) return this.toast(p, `Не хватает: ${ITEMS[k].name.toLowerCase()}`);
    p.dna -= c.net;
    for (const k in c.items) p.inv[k] -= c.items[k];
    p.genome = g;
    this.applyGenome(p);
    this.fx.push({ k: 'evolve', x: p.x, y: p.y, c: p.color });
    this.send(p.client, { t: 'evolved' });
    this.toast(p, 'Мутация прижилась!');
  }

  onEat(p, m) {
    if (p.dead || p.eatT > 0) return;
    const diet = p.stats.diet;
    let item = FOOD[m.item] && p.inv[m.item] > 0 ? m.item : null;
    if (!item) {
      // сам по себе (F) ест только обычную еду, грибы-галлюциногены — лишь по прямому выбору
      const opts = Object.keys(FOOD).filter((k) => p.inv[k] > 0 && !FOOD[k].hal && !FOOD[k].trip).sort((a, b) => FOOD[b].mult[diet] - FOOD[a].mult[diet]);
      item = opts[0];
    }
    if (!item) return this.toast(p, 'Нечего есть — соберите ягоды или добудьте мясо');
    const f = FOOD[item];
    p.inv[item]--;
    p.eatT = 0.25;
    const food = f.food * f.mult[diet];
    p.food = Math.min(100, p.food + food);
    p.water = Math.min(100, p.water + f.water);
    const heal = 3 + (item === 'meat' ? p.stats.meatHeal : 0); // «утроба»: мясо лечит
    p.hp = Math.min(p.stats.maxHp, p.hp + heal);
    let extra = heal > 3 ? `  +${heal} ❤` : '';
    if (f.trip) {
      // у мухомора, пейотля и жабы свои видения и свой бонус на время трипа
      const tr = TRIPS[f.trip];
      p.trip[f.trip] = Math.min(TRIP_MAX, Math.max(0, p.trip[f.trip]) + tr.time);
      if (f.spirit && p.path !== 'mind') {
        p.spirit += f.spirit;
        extra += `  +${f.spirit} ✨`;
      }
      this.toast(p, tr.start);
    }
    if (f.hal) {
      // галлюцинации: время складывается (до 3 минут), сила — по самому сильному грибу
      p.halT = Math.min(180, (p.halT > 0 ? p.halT : 0) + f.hal.t);
      p.halS = Math.max(p.halT > f.hal.t ? p.halS : 0, f.hal.s);
      if (f.spirit && p.path !== 'mind') {
        p.spirit += f.spirit;
        extra += `  +${f.spirit} ✨`;
      }
      if (f.mana && p.path === 'spirit') p.mana = Math.min(p.maxMana, p.mana + f.mana);
      if (f.rad) p.rad = Math.min(100, p.rad + f.rad);
      this.toast(p, f.hal.s >= 1 ? '💠 Реальность трескается и сияет…' : '🍄 Мир начинает плыть…');
    }
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${Math.round(food)} 🍖${f.water ? `  +${f.water} 💧` : ''}${extra}` });
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
    p.cd.dash = 0;
    p.mana = p.maxMana;
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
    for (const p of this.players.values()) {
      this.updatePlayer(p, dt);
      this.syncResChunks(p);
    }
    this.rebuildNpcGrid();
    for (const n of this.npcs.values()) {
      if (!n.awake) continue; // вдали от всех игроков зверь «спит»
      this.statusTick(n, dt);
      if (!this.npcs.has(n.id)) continue;
      updateNpc(this, n, dt, night);
      if (this.npcs.has(n.id)) this.envEffects(n, dt);
    }
    this.separate();
    this.updateTurrets(dt);
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
    p.cd.dash = Math.max(0, p.cd.dash - dt);
    p.combatT = Math.max(0, p.combatT - dt);
    p.atkT = Math.max(0, p.atkT - dt);
    p.hitT = Math.max(0, p.hitT - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    p.drinkT = Math.max(0, p.drinkT - dt);
    p.eatT = Math.max(0, p.eatT - dt);
    p.warnT = Math.max(0, p.warnT - dt);
    p.spawnProtect = Math.max(0, p.spawnProtect - dt);
    if (p.weapon && !ABILITIES[p.weapon] && !(p.inv[p.weapon] > 0)) p.weapon = null; // оружие выложили или потратили
    for (const id in p.abcd) if (p.abcd[id] > 0) p.abcd[id] = Math.max(0, p.abcd[id] - dt);
    p.medWarnT = Math.max(0, p.medWarnT - dt);
    for (const k in p.trip) if (p.trip[k] > 0) p.trip[k] = Math.max(0, p.trip[k] - dt);
    if (p.trial && this.time > p.trial.until) this.endTrial(p, '🔮 Трип кончился, проводники растаяли. Испытание духа не пройдено — соберите гриб, кактус и жабу заново.');
    if (p.halT > 0) {
      p.halT -= dt;
      if (p.halT <= 0) {
        p.halT = 0;
        p.halS = 0;
        this.toast(p, 'Мир снова стал обычным');
      }
    }
    this.statusTick(p, dt);
    if (p.dead) return;
    this.meditate(p, dt);
    if (p.path === 'spirit') p.mana = Math.min(p.maxMana, p.mana + (MANA.regen * p.stats.manaRegen + (p.meditating ? MANA.altarRegen : 0)) * dt);

    const moving = p.input.mx !== 0 || p.input.my !== 0;
    const sprinting = p.input.sprint && moving && p.stamina > 1 && p.charging <= 0;

    // радиация: копится в зонах, снаружи спадает
    p.radHere = this.radAt(p.x, p.y);
    if (p.radHere > 0) {
      p.rad = Math.min(100, p.rad + RAD.ratePerLevel * p.radHere * (1 - st.radResist) * dt);
      // облучение копит мутаген (не зависит от радиорезистентности)
      p.mutAcc += RAD.mutagen * p.radHere * dt;
      if (p.mutAcc >= 3) {
        const n = Math.floor(p.mutAcc);
        p.mutAcc -= n;
        p.dna += n;
        p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: `+${n} ☣ мутаген` });
      }
    } else p.rad = Math.max(0, p.rad - RAD.decay * (st.radClean ? 2 : 1) * dt); // предел фильтра: выводит вдвое быстрее
    if (p.rad > RAD.dmgStart) this.damageCreature(p, (p.rad - RAD.dmgStart) * RAD.dmgPerPoint * dt, null, 'rad');
    if (p.dead) return;

    // голод, жажда, регенерация
    p.food = Math.max(0, p.food - PLAYER.hungerRate * st.metabolism * (sprinting ? 1.6 : 1) * dt);
    p.water = Math.max(0, p.water - PLAYER.thirstRate * st.metabolism * dt);
    p.nearFire = this.nearKind(p.x, p.y, 'campfire', 140);
    // холод зимнего биома: копится в снегах (ночью быстрее), у костра и в тепле спадает; куртка почти снимает его
    p.inCold = isCold(this.tileAt(p.x, p.y));
    if (p.nearFire) p.cold = Math.max(0, p.cold - COLD.warm * dt);
    else if (p.inCold) p.cold = Math.min(100, p.cold + COLD.rate * (isNight(this.phase()) ? COLD.night : 1) * (p.inv.coat > 0 ? COLD.coat : 1) * dt);
    else p.cold = Math.max(0, p.cold - COLD.decay * dt);
    if (p.cold >= 100) this.damageCreature(p, COLD.dmg * dt, null, 'cold');
    if (p.food <= 0 || p.water <= 0) this.damageCreature(p, PLAYER.starveDmg * dt, null, 'starve');
    else {
      // наниты: втрое быстрее и даже при облучении до 50
      const nan = p.abil.has('nanites') ? ABILITIES.nanites : null;
      // «живая плоть» ускоряет лечение, на пределе — лечит и под облучением; предел фильтра радиации — до 50
      const radOk = st.regenAlways || p.rad < (nan || st.radClean ? ABILITIES.nanites.radRegen : RAD.regenBlock);
      if (p.food > 35 && p.water > 35 && radOk && p.cold < COLD.slowAt && p.hp < st.maxHp) {
        p.hp = Math.min(st.maxHp, p.hp + (PLAYER.regen * st.regen * (nan ? nan.regenMul : 1) + (p.nearFire ? PLAYER.fireRegen : 0)) * dt);
      }
    }
    if (p.dead) return;

    let speed = st.speed;
    let mx = p.input.mx;
    let my = p.input.my;
    const stunned = p.stunT > 0;
    if (stunned) {
      mx = 0;
      my = 0;
    }
    if (sprinting) {
      speed *= PLAYER.sprintMul;
      if (!(p.trip.p > 0)) p.stamina = Math.max(0, p.stamina - PLAYER.staminaUse * st.sprintCost * dt); // пейотль: бег даром
    } else {
      p.stamina = Math.min(100, p.stamina + PLAYER.staminaRegen * st.staRegen * dt);
    }
    if (p.slowT > 0) speed *= 0.6;
    const charging = p.charging > 0 && st.charge;
    if (charging) {
      mx = Math.cos(p.chargeDir);
      my = Math.sin(p.chargeDir);
      speed = st.charge.speed;
      p.charging -= dt;
    } else p.charging = 0;
    // рывок на реактивных ускорителях: летим к точке, в конце на пределе — ударная волна
    const dashing = p.dashT > 0 && st.dash && !charging;
    if (dashing) {
      mx = Math.cos(p.dashDir);
      my = Math.sin(p.dashDir);
      speed = DASH.speed;
      p.dashT -= dt;
    } else p.dashT = 0;
    const hit = this.moveCreature(p, mx, my, speed, dt);
    if (charging) this.chargeStep(p, hit);
    if (dashing && (p.dashT <= 0 || hit)) this.dashEnd(p);
    this.envEffects(p, dt);
    if (p.dead) return;

    if (p.input.attack && p.cd.melee <= 0 && p.charging <= 0 && p.dashT <= 0 && !stunned) this.attack(p);
    if (p.input.spit && st.spit && p.cd.spit <= 0 && !stunned) {
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

  // Медитация: стоять неподвижно в круге древнего алтаря. Каждый алтарь даёт ограниченный запас
  // силы духа, который восстанавливается со временем.
  meditate(p, dt) {
    const z = zoneAt(this.zones, p.x, p.y);
    const still = !p.input.mx && !p.input.my && !p.input.attack;
    p.meditating = !!(z && z.kind === 'altar' && still && Math.hypot(p.x - z.x, p.y - z.y) < z.r * 0.75);
    if (!p.meditating) {
      p.medT = 0;
      return;
    }
    p.medT += dt;
    if (p.medT < SPIRIT_GAIN.every) return;
    p.medT -= SPIRIT_GAIN.every;
    if (p.path === 'mind') {
      if (p.medWarnT <= 0) {
        p.medWarnT = 30;
        this.toast(p, 'Путь разума закрыл для вас силу духа');
      }
      return;
    }
    const max = SPIRIT_GAIN.altarCharge;
    const a = p.altars.get(z.id) || { charge: max, t: this.time };
    a.charge = Math.min(max, a.charge + ((this.time - a.t) * max) / SPIRIT_GAIN.altarRefill);
    a.t = this.time;
    p.altars.set(z.id, a);
    if (a.charge < 1) {
      if (p.medWarnT <= 0) {
        p.medWarnT = 20;
        this.toast(p, 'Алтарь истощён — его сила вернётся через несколько минут');
      }
      return;
    }
    a.charge -= 1;
    p.spirit += 1;
    p.pfx.push({ k: 'gain', x: p.x, y: p.y, text: '+1 ✨' });
  }

  // колья ранят чужаков
  envEffects(e, dt) {
    e.spikeT = Math.max(0, (e.spikeT || 0) - dt);
    if (e.spikeT > 0) return;
    const r = e.stats.radius;
    for (const s of this.grid.query(e.x, e.y, r + TILE)) {
      if (s.kind !== 'spikes' || (e.uid && (e.uid === s.owner || this.isFriend(s.owner, e.uid)))) continue; // свои и друзья проходят
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
    if (e.fly) tm = 1;
    if (e.cold >= COLD.slowAt) tm *= COLD.slow; // окоченевший идёт медленнее
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
    if (solid === 'owner') return !e.uid || (e.uid !== s.owner && !this.isFriend(s.owner, e.uid)); // дверь открыта хозяину и его друзьям
    return false;
  }

  // Выталкивает существо из стен и твёрдых ресурсов. Возвращает первое препятствие.
  collide(e) {
    const r = e.stats.radius;
    let hit = null;
    e.x = clamp(e.x, r, WORLD_W - r);
    e.y = clamp(e.y, r, WORLD_H - r);
    // стены мёртвого города (парящие существа проходят поверх)
    if (!e.fly) {
      const tx0 = Math.floor((e.x - r) / TILE);
      const tx1 = Math.floor((e.x + r) / TILE);
      const ty0 = Math.floor((e.y - r) / TILE);
      const ty1 = Math.floor((e.y + r) / TILE);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || this.tiles[ty * MAP_W + tx] !== T.WALL) continue;
          const bx = tx * TILE + HS;
          const by = ty * TILE + HS;
          const cx = clamp(e.x, bx - HS, bx + HS);
          const cy = clamp(e.y, by - HS, by + HS);
          const dx = e.x - cx;
          const dy = e.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          hit = hit || WALL_HIT;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            e.x += (dx / d) * (r - d);
            e.y += (dy / d) * (r - d);
          } else {
            const ox = e.x - bx;
            const oy = e.y - by;
            if (Math.abs(ox) > Math.abs(oy)) e.x = bx + Math.sign(ox || 1) * (HS + r);
            else e.y = by + Math.sign(oy || 1) * (HS + r);
          }
        }
      }
    }
    for (const s of this.grid.query(e.x, e.y, r + TILE)) {
      if (e.fly && s.cat === 'res') continue;
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

  // стена мёртвого города ближе r к точке?
  wallNear(x, y, r) {
    for (let ty = Math.floor((y - r) / TILE); ty <= Math.floor((y + r) / TILE); ty++) {
      for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) {
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || this.tiles[ty * MAP_W + tx] !== T.WALL) continue;
        if (circleBox(x, y, r, tx * TILE + HS, ty * TILE + HS)) return true;
      }
    }
    return false;
  }

  // мягкое расталкивание существ
  // Сетка зверей для поиска соседей + кто из них бодрствует (рядом есть живой игрок)
  rebuildNpcGrid() {
    this.npcGrid.clear();
    const alive = [];
    for (const p of this.players.values()) if (!p.dead) alive.push(p);
    const w2 = NPC_WAKE_R * NPC_WAKE_R;
    for (const n of this.npcs.values()) {
      const key = Math.floor(n.x / NPC_CELL) * 4096 + Math.floor(n.y / NPC_CELL);
      let arr = this.npcGrid.get(key);
      if (!arr) this.npcGrid.set(key, (arr = []));
      arr.push(n);
      n.awake = alive.some((p) => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 < w2);
    }
  }

  // звери в радиусе r (по сетке; ячейки берём с запасом на движение за такт)
  npcsNear(x, y, r) {
    const out = [];
    const r2 = r * r;
    const x0 = Math.floor((x - r - 20) / NPC_CELL);
    const x1 = Math.floor((x + r + 20) / NPC_CELL);
    const y0 = Math.floor((y - r - 20) / NPC_CELL);
    const y1 = Math.floor((y + r + 20) / NPC_CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        const arr = this.npcGrid.get(i * 4096 + j);
        if (!arr) continue;
        for (const n of arr) if (this.npcs.has(n.id) && (n.x - x) ** 2 + (n.y - y) ** 2 <= r2) out.push(n);
      }
    }
    return out;
  }

  separate() {
    // только те, кто рядом с игроками: спящие звери стоят на месте
    const cells = new Map();
    const add = (c) => {
      const key = Math.floor(c.x / 100) * 4096 + Math.floor(c.y / 100);
      let arr = cells.get(key);
      if (!arr) cells.set(key, (arr = []));
      arr.push(c);
    };
    for (const p of this.players.values()) if (!p.dead) add(p);
    for (const n of this.npcs.values()) if (n.awake) add(n);
    for (const [key, list] of cells) {
      const ci = Math.floor(key / 4096);
      const cj = key % 4096;
      // соседние ячейки: своя и «вперёд», чтобы каждая пара проверялась один раз
      const arr = [...list];
      for (const [di, dj] of [[1, -1], [1, 0], [1, 1], [0, 1]]) {
        const other = cells.get((ci + di) * 4096 + cj + dj);
        if (other) arr.push(...other);
      }
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
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
  }

  // ================= поиск =================
  creaturesNear(x, y, r) {
    const out = [];
    const r2 = r * r;
    for (const p of this.players.values()) {
      if (!p.dead && (p.x - x) ** 2 + (p.y - y) ** 2 <= r2) out.push(p);
    }
    out.push(...this.npcsNear(x, y, r));
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
    if (ABILITIES[p.weapon]) return this.castSpell(p, p.weapon);
    const w = p.weapon ? WEAPONS[p.weapon] : null;
    if (!w || w.type === 'melee') {
      p.cd.melee = w ? w.cd * st.cdMul : st.attackCd;
      p.atkT = 0.25;
      // тело (когти) + оружие, усиленное гидравликой рук и резонансом имплантов
      this.melee(p, (st.meleeDmg + (w ? w.dmg * st.armMul * st.wpnMul : 0)) * (p.trip.a > 0 ? TRIPS.a.might : 1), w); // мухомор даёт силу
      return;
    }
    if (w.mana) {
      // посох духа: вместо боеприпасов — мана
      if (p.mana < w.mana) {
        p.cd.melee = 0.4;
        if (p.warnT <= 0) {
          p.warnT = 2;
          this.toast(p, 'Не хватает маны');
        }
        return;
      }
      p.mana -= w.mana;
      p.cd.melee = w.cd * st.cdMul;
      p.atkT = 0.2;
      this.fireWeapon(p, w);
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
    p.cd.melee = w.cd * st.cdMul;
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
      const dmg = w.dmg * p.stats.wpnMul * (w.type === 'ranged' ? p.stats.aimMul : 1); // импланты: резонанс и целеуказатель
      this.addProjectile(p, w.proj, p.x + ca * r0, p.y + sa * r0, ca * sp, sa * sp, dmg, w.life * (n > 1 ? 0.8 + Math.random() * 0.4 : 1), w);
    }
    this.fx.push({ k: 'shot', x: p.x + Math.cos(p.angle) * r0, y: p.y + Math.sin(p.angle) * r0, m: w.proj });
  }

  addProjectile(owner, kind, x, y, vx, vy, dmg, life, w = null) {
    const j = { id: this.nextId++, owner: owner.id, uid: owner.uid || null, kind, x, y, vx, vy, dmg, life, a: Math.atan2(vy, vx) };
    if (w?.radius) {
      j.radius = w.radius;
      j.structDmg = w.structDmg;
    }
    if (w?.kb) j.kb = w.kb;
    if (kind === 'hex') {
      j.hexTime = w.time;
      j.hexDps = w.dps;
      j.hexVuln = w.vuln;
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
    let shockHit = null;
    for (const t of this.creaturesNear(a.x, a.y, reach + 90)) {
      if (t === a) continue;
      if (a.type === 'npc' && t.type === 'npc') continue;
      if (this.isFriend(a.uid, t.uid)) continue; // друзей удар не задевает
      const dx = t.x - a.x;
      const dy = t.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d - t.stats.radius > reach) continue;
      if (d > st.radius + t.stats.radius * 0.5 && (dx * ca + dy * sa) / d < 0.4) continue;
      const dealt = this.damageCreature(t, dmg, a, 'melee');
      if (w && w.leech && dealt > 0 && !a.dead) a.hp = Math.min(a.stats.maxHp, a.hp + dealt * w.leech); // ритуальный кинжал пьёт жизнь
      const kb = 140 * (st.kbMul || 1) * (t.stats.kbResist || 1);
      t.kbx += (dx / d) * kb;
      t.kby += (dy / d) * kb;
      hitCreature = true;
      if (dealt > 0 && !t.dead && st.bleed) {
        // предел когтей: рана кровоточит
        t.bleedT = st.bleed.time;
        t.bleedDps = st.bleed.dps;
        t.bleedSrc = a.id;
        t.bleedTick = 0;
      }
      shockHit = shockHit || (dealt > 0 && !t.dead ? t : null);
    }
    // разрядник: каждый N-й удар, попавший в цель, бьёт током и оглушает
    if (shockHit && st.shock) {
      a.shockN = (a.shockN || 0) + 1;
      if (a.shockN >= st.shock.every) {
        a.shockN = 0;
        this.fx.push({ k: 'zap', x: shockHit.x, y: shockHit.y });
        if (this.damageCreature(shockHit, st.shock.dmg, a, 'shock') > 0 && !shockHit.dead) shockHit.stunT = Math.max(shockHit.stunT || 0, st.shock.stun);
      }
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
    else if (best.cat === 'struct') this.damageStructure(best, dmg * STRUCT_DMG.melee[STRUCTURES[best.kind].mat] * (w?.struct || 1) * (st.structMul || 1), a);
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
      text += `  +${def.dna} ☣`;
    }
    if (text) p.pfx.push({ k: 'gain', x: s.x, y: s.y, text });
    this.fx.push({ k: 'hit', x: s.x, y: s.y, m: s.kind, id: s.id });
    // духи леса слышат, что рубят их деревья и рвут грибы
    if (GUARDED.has(s.kind) && this.tileAt(s.x, s.y) === T.FOREST) {
      for (const n of this.npcsNear(s.x, s.y, GUARDIAN_ALERT_R)) {
        if (NPCS[n.kind].behavior !== 'guardian' || n.target) continue;
        n.target = p.id;
        n.alertT = 8;
      }
    }
    if (s.hp <= 0) {
      this.removeStatic(s);
      if (def.respawn) this.respawnQueue.push({ kind: s.kind, x: s.x, y: s.y, v: s.v, at: this.time + def.respawn * (0.8 + Math.random() * 0.4) });
    } else this.touch(s);
  }

  damageCreature(t, amount, src, kind) {
    if (t.dead || amount <= 0) return 0;
    const silent = kind === 'starve' || kind === 'rad' || kind === 'cold'; // урон «изнутри»: без цифр и защиты
    if (t.type === 'player' && t.spawnProtect > 0 && !silent) return 0;
    if (t.owner && (!src || src.id !== t.owner)) return 0; // проводника ранит только тот, чьё это испытание
    if (src && src !== t && this.isFriend(src.uid, t.uid)) return 0; // друзьям нельзя нанести урон
    if (!silent) amount *= 1 - t.stats.defense;
    if (kind === 'ranged' && t.stats.rangedDef) amount *= 1 - t.stats.rangedDef; // предел бронепластин
    if (!silent && t.corrT > 0) amount *= 1.2; // разъеден кислотой
    if (!silent && t.trip && t.trip.t > 0) amount *= TRIPS.t.numb; // онемение от жабы
    if (!silent && t.hexT > 0) amount *= t.hexVuln || 1.25;
    // щит духа поглощает урон первым
    if (!silent && t.shieldT > 0 && t.shieldHp > 0) {
      const a = Math.min(t.shieldHp, amount);
      t.shieldHp -= a;
      amount -= a;
      if (t.shieldHp <= 0) t.shieldT = 0;
      if (amount <= 0.01) {
        this.fx.push({ k: 'absorb', x: t.x, y: t.y });
        return 0;
      }
    }
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
      if (kind === 'melee' && t.stats.thorns > 0 && !src.dead) {
        this.damageCreature(src, amount * t.stats.thorns + 2, t, 'thorns');
        if (t.stats.thornSlow) src.slowT = Math.max(src.slowT || 0, 1.2); // предел шипов
      }
    }
    if (t.hp <= 0) this.killCreature(t, src, kind);
    return amount;
  }

  killCreature(t, src, kind) {
    const killerIsPlayer = src && src.type === 'player' && !src.dead;
    if (t.type === 'npc') {
      if (!this.npcs.has(t.id)) return;
      this.npcs.delete(t.id);
      const def = NPCS[t.kind];
      this.fx.push({ k: 'die', x: t.x, y: t.y, c: t.color, r: t.stats.radius, id: t.id, f: def.faction });
      if (t.owner) {
        // проводник в мир духов: когда убиты все — испытание духа пройдено
        const o = this.players.get(t.owner);
        if (o && o.trial) {
          o.trial.left--;
          if (o.trial.left <= 0) {
            o.trial = null;
            for (const k in o.trip) o.trip[k] = Math.min(o.trip[k], 12); // трип быстро отпускает
            if (!o.path) this.setPath(o, 'spirit');
          } else this.toast(o, `🔮 Проводник повержен. Осталось: ${o.trial.left}`);
        }
      }
      if (killerIsPlayer) {
        src.dna += def.dna;
        const parts = [];
        if (def.dna) parts.push(`+${def.dna} ☣`);
        for (const [item, n] of Object.entries(def.loot || {})) {
          // целое — столько штук, дробь — шанс одной
          const got = n >= 1 ? n : Math.random() < n ? 1 : 0;
          if (!got) continue;
          src.inv[item] += got;
          parts.push(`+${got} ${ITEMS[item].icon}`);
        }
        // победа над духом или мутантом леса укрепляет дух (если путь разума не выбран)
        const sp = src.path !== 'mind' ? def.spirit || 0 : 0;
        src.spirit += sp;
        if (sp) parts.push(`+${sp} ✨`);
        if (parts.length) src.pfx.push({ k: 'gain', x: t.x, y: t.y, text: parts.join('  ') });
      }
      return;
    }
    // игрок погиб: всё, что нёс, остаётся в останках
    t.dead = true;
    t.hp = 0;
    t.charging = 0;
    t.shieldT = 0;
    t.shieldHp = 0;
    t.hexT = 0;
    t.stunT = 0;
    t.bleedT = 0;
    t.corrT = 0;
    t.dashT = 0;
    if (t.type === 'player') {
      this.endTrial(t, '🔮 Вы погибли в трипе — испытание духа не пройдено.');
      t.trip = { a: 0, p: 0, t: 0 };
      t.halT = 0;
      t.halS = 0;
    }
    t.openCont = null;
    t.input = idleInput();
    t.weapon = null;
    t.rad = 0;
    const dnaDrop = Math.floor(t.dna * PLAYER.remainsDnaShare);
    t.dna -= dnaDrop;
    if (dnaDrop > 0 || ITEM_KEYS.some((k) => t.inv[k] > 0)) this.addRemains(t.x, t.y, t.inv, dnaDrop, t.name);
    t.inv = emptyInv();
    this.fx.push({ k: 'die', x: t.x, y: t.y, c: t.color, r: t.stats.radius });
    const reasons = { starve: 'голод и жажда', spikes: 'колья', meteor: 'метеорит', rad: 'радиация', cold: 'холод', bleed: 'потеря крови', hex: 'проклятие' };
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
    if (src && this.isFriend(s.owner, src.uid)) return; // друг не сломает ваш дом по неосторожности
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
    j.corrode = !!sp.corrode;
    this.fx.push({ k: 'spit', x: j.x, y: j.y });
  }

  // выстрел машины или духа в цель
  npcShoot(n, t) {
    const sh = NPCS[n.kind].shoot;
    const a = Math.atan2(t.y - n.y, t.x - n.x) + (Math.random() - 0.5) * 0.09;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const r0 = n.stats.radius + 8;
    const x = n.x + ca * r0;
    const y = n.y + sa * r0;
    this.addProjectile(n, sh.proj, x, y, ca * sh.speed, sa * sh.speed, sh.dmg, sh.life);
    n.angle = a;
    n.atkT = 0.22;
    n.atkR = true;
    this.fx.push({ k: 'shot', x, y, m: sh.proj });
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
      if (j.radius) {
        this.explode(j, owner);
        continue;
      }
      if (!hit) continue;
      if (hit.type) {
        const dealt = this.damageCreature(hit, j.dmg, owner, j.kind === 'acid' ? 'acid' : 'ranged');
        if (j.kind === 'acid') {
          hit.slowT = 1.5;
          if (j.corrode && dealt > 0) hit.corrT = 4; // предел железы: кислота разъедает защиту
        } else {
          const d = Math.hypot(j.vx, j.vy) || 1;
          const kb = (j.kb || 60) * (hit.stats.kbResist || 1);
          hit.kbx += (j.vx / d) * kb;
          hit.kby += (j.vy / d) * kb;
        }
        if (j.kind === 'drain' && owner && !owner.dead && dealt > 0) {
          owner.hp = Math.min(owner.stats.maxHp, owner.hp + dealt);
          this.fx.push({ k: 'drain', x: hit.x, y: hit.y, x2: owner.x, y2: owner.y });
        }
        if (j.kind === 'hex' && !hit.dead) {
          hit.hexT = j.hexTime;
          hit.hexDps = j.hexDps;
          hit.hexVuln = j.hexVuln;
          hit.hexSrc = j.owner;
          hit.hexTick = 0;
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
      if (j.uid && (t.uid === j.uid || this.isFriend(j.uid, t.uid))) continue; // сквозь друзей снаряд пролетает
      if (Math.hypot(t.x - j.x, t.y - j.y) <= t.stats.radius + pr) return t;
    }
    if (this.tileAt(j.x, j.y) === T.WALL && !(owner && owner.fly)) return WALL_HIT; // дроны и духи стреляют поверх стен
    for (const s of this.grid.query(j.x, j.y, 30)) {
      if (s.cat === 'struct' && STRUCTURES[s.kind].solid && circleBox(j.x, j.y, pr, s.x, s.y)) {
        if (STRUCTURES[s.kind].solid === 'owner' && j.uid && (j.uid === s.owner || this.isFriend(s.owner, j.uid))) continue;
        return s;
      }
      if (s.cat === 'res' && s.cr > 0 && Math.hypot(s.x - j.x, s.y - j.y) < s.cr + pr) return s;
    }
    return null;
  }

  // взрыв бомбы: урон существам вокруг и сильный урон постройкам
  explode(j, owner) {
    const R = j.radius || 100;
    this.fx.push({ k: 'boom', x: j.x, y: j.y, m: j.kind });
    for (const t of this.creaturesNear(j.x, j.y, R + 40)) {
      const d = Math.hypot(t.x - j.x, t.y - j.y) - t.stats.radius;
      if (d > R) continue;
      const k = 1 - Math.max(0, d) / R;
      if (j.uid && t.uid !== j.uid && this.isFriend(j.uid, t.uid)) continue; // друзей взрыв не трогает
      this.damageCreature(t, j.dmg * (0.4 + 0.6 * k), owner, 'bomb');
      const dd = Math.hypot(t.x - j.x, t.y - j.y) || 1;
      t.kbx += ((t.x - j.x) / dd) * 420 * k * (t.stats.kbResist || 1);
      t.kby += ((t.y - j.y) / dd) * 420 * k * (t.stats.kbResist || 1);
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
      if (t === p || p.chargeHit.has(t.id) || this.isFriend(p.uid, t.uid)) continue;
      if (Math.hypot(t.x - p.x, t.y - p.y) > p.stats.radius + t.stats.radius + 8) continue;
      p.chargeHit.add(t.id);
      const dealt = this.damageCreature(t, ch.dmg, p, 'charge');
      t.kbx += ca * 520 * (t.stats.kbResist || 1);
      t.kby += sa * 520 * (t.stats.kbResist || 1);
      if (ch.stun && dealt > 0 && !t.dead) t.stunT = Math.max(t.stunT || 0, ch.stun); // предел рогов
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
        for (const n of this.npcsNear(x, y, 380)) {
          if (NPCS[n.kind].behavior !== 'passive') {
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
      if (zoneAt(this.zones, x, y)) continue; // в особых местах живёт только их охрана
      const near = this.grid.query(x, y, 200);
      if (near.some((s) => s.cat === 'struct')) continue;
      if (near.some((s) => s.cat === 'res' && s.cr > 0 && Math.hypot(s.x - x, s.y - y) < s.cr + 32)) continue;
      pos = { x, y };
    }
    if (!pos) return null;
    const stats = {
      radius: def.r, maxHp: def.hp, defense: def.def || 0, speed: def.speed, swim: 0, meleeDmg: def.dmg, reach: def.reach || 0,
      attackCd: def.attackCd || 0.9, thorns: 0, spit: null,
    };
    const n = {
      id: this.nextId++, type: 'npc', kind, stats, color: def.color, fly: !!def.fly,
      x: pos.x, y: pos.y, homeX: pos.x, homeY: pos.y, kbx: 0, kby: 0, angle: Math.random() * Math.PI * 2,
      hp: def.hp, cd: { melee: 0, spit: Math.random() * 2 }, atkT: 0, hitT: 0, slowT: 0, alertT: 0, combatT: 0, windupT: 0,
      target: null, wanderT: 0, wx: 0, wy: 0, spikeT: 0,
    };
    this.npcs.set(n.id, n);
    // стайные звери (волки) появляются сразу группой
    if (def.pack && !at) {
      for (let i = 1; i < def.pack; i++) {
        const a = Math.random() * Math.PI * 2;
        const x = pos.x + Math.cos(a) * 70;
        const y = pos.y + Math.sin(a) * 70;
        if (def.biomes.includes(this.tileAt(x, y))) this.spawnNpc(kind, true, { x, y });
      }
    }
    return n;
  }

  // страж места: появляется внутри него и далеко не уходит (хозяин держится у его центра)
  spawnGuard(z, kind, initial = true) {
    const boss = NPCS[kind].behavior === 'territorial'; // хозяин места держится у его центра
    const spread = boss ? 0.25 : z.kind === 'city' ? 0.85 : 0.7;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * z.r * spread;
      const x = z.x + Math.cos(a) * d;
      const y = z.y + Math.sin(a) * d;
      const tile = this.tileAt(x, y);
      if (isWater(tile) || tile === T.WALL) continue;
      if (!initial && this.nearestPlayer(x, y, 500, false)) return null;
      const n = this.spawnNpc(kind, true, { x, y });
      if (!n) return null;
      n.zone = z.id;
      if (z.kind === 'city') {
        // патруль: у каждого свой квартал, а не весь город
        n.leash = 420;
      } else {
        n.homeX = z.x;
        n.homeY = z.y;
        n.leash = z.r * 0.8;
      }
      return n;
    }
    return null;
  }

  maintainNpcs(night) {
    const counts = Object.fromEntries(Object.keys(NPCS).map((k) => [k, 0]));
    const guards = new Map(); // "место:вид" -> сколько живо
    const hunters = []; // ночные охотники, вышедшие к игрокам
    for (const n of this.npcs.values()) {
      if (n.zone !== undefined) {
        const key = `${n.zone}:${n.kind}`;
        guards.set(key, (guards.get(key) || 0) + 1);
      } else if (n.hunter) hunters.push(n);
      else if (!n.meteor) counts[n.kind]++;
    }
    for (const z of this.zones) {
      for (const [kind, want] of Object.entries(SITES[z.kind].guards)) {
        if ((guards.get(`${z.id}:${kind}`) || 0) < want) this.spawnGuard(z, kind, false);
      }
    }
    // звери вне особых мест: недостачу добираем понемногу
    for (const kind of Object.keys(NPC_TARGET)) {
      const deficit = NPC_TARGET[kind] - counts[kind] / (NPCS[kind].pack || 1); // стайных считаем стаями
      for (let i = 0; i < Math.min(10, Math.ceil(deficit / 10)); i++) this.spawnNpc(kind);
    }
    if (night) {
      // ночью горбуны выходят на охоту вокруг каждого игрока
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const near = hunters.filter((n) => Math.hypot(n.x - p.x, n.y - p.y) < 2200).length;
        if (near < NIGHT_STALKERS_PER_PLAYER) this.spawnHunter(p);
      }
    } else {
      // днём охотники уходят, если их никто не видит
      for (const n of hunters) {
        if (!n.target && !this.nearestPlayer(n.x, n.y, 900, false)) this.npcs.delete(n.id);
      }
    }
  }

  // ночной охотник появляется в 900–1500 единицах от игрока, вне воды и особых мест
  spawnHunter(p) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 900 + Math.random() * 600;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      const t = this.tileAt(x, y);
      if (t !== T.FOREST && t !== T.ROCK && t !== T.GRASS) continue;
      if (zoneAt(this.zones, x, y)) continue;
      if (this.grid.query(x, y, 200).some((s) => s.cat === 'struct')) continue;
      const n = this.spawnNpc(NIGHT_HUNTER, true, { x, y });
      if (n) n.hunter = true;
      return n;
    }
    return null;
  }


  updateMeteor() {
    const m = this.meteor;
    if (m.state === 'idle' && this.time >= m.next) {
      // на огромном острове метеорит падает в 1,5–4,5 тыс. единиц от случайного игрока
      const alive = [...this.players.values()].filter((p) => !p.dead);
      for (let i = 0; i < 200; i++) {
        let tx = 8 + Math.floor(Math.random() * (MAP_W - 16));
        let ty = 8 + Math.floor(Math.random() * (MAP_H - 16));
        if (alive.length && i < 150) {
          const p = alive[Math.floor(Math.random() * alive.length)];
          const a = Math.random() * Math.PI * 2;
          const d = 1500 + Math.random() * 3000;
          tx = Math.floor((p.x + Math.cos(a) * d) / TILE);
          ty = Math.floor((p.y + Math.sin(a) * d) / TILE);
          if (tx < 8 || ty < 8 || tx >= MAP_W - 8 || ty >= MAP_H - 8) continue;
        }
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
        if (isWater(this.tileAt(x, y))) continue;
        const n = this.spawnNpc(METEOR_GUARD, true, { x, y });
        if (n) n.meteor = true;
      }
    } else if (m.state === 'landed') {
      let left = 0;
      for (const s of this.grid.query(m.x, m.y, 260)) if (s.kind === 'crystal') left++;
      if (left === 0 || this.time > m.until) {
        for (const s of this.grid.query(m.x, m.y, 260)) if (s.kind === 'crystal') this.removeStatic(s);
        // когтни метеорита уходят вместе с ним (если не дерутся)
        for (const n of this.npcs.values()) if (n.meteor && !n.target) this.npcs.delete(n.id);
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
      h: Math.ceil(p.hp), mh: p.stats.maxHp, n: p.name, c: p.color, g: p.look, ap: p.ap, dd: p.dead ? 1 : undefined,
      at: p.atkT > 0 ? 1 : 0, hf: p.hitT > 0 ? 1 : 0, ch: p.charging > 0 ? 1 : 0, sp: p.spawnProtect > 0 ? 1 : 0,
      w: p.weapon || undefined,
      sh: p.shieldT > 0 ? 1 : undefined, hx: p.hexT > 0 ? 1 : undefined, st: p.stunT > 0 ? 1 : undefined,
      pa: p.path || undefined, u: p.uid, vc: p.voice ? 1 : undefined, tk: p.talk ? 1 : undefined,
    };
  }

  serNpc(n) {
    return {
      i: n.id, k: 'n', t: n.kind, x: Math.round(n.x), y: Math.round(n.y), a: Math.round(n.angle * 100) / 100,
      h: Math.ceil(n.hp), mh: n.stats.maxHp, at: n.atkT > 0 ? (n.atkR ? 2 : 1) : 0, hf: n.hitT > 0 ? 1 : 0, wu: n.windupT > 0 ? 1 : 0,
      hx: n.hexT > 0 ? 1 : undefined, st: n.stunT > 0 ? 1 : undefined,
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
      cd: { m: round1(p.cd.melee), s: round1(p.cd.spit), c: round1(p.cd.charge), d: round1(p.cd.dash) },
      cb: p.combatT > 0 ? 1 : 0, dead: p.dead ? 1 : 0, sp: p.spawnProtect > 0 ? 1 : 0, fire: p.nearFire ? 1 : 0,
      nest: nest ? [nest.x, nest.y] : null, k: p.kills,
      cold: Math.round(p.cold), ic: p.inCold ? 1 : 0,
      wp: p.weapon, rad: round1(p.rad), rz: round1(p.radHere), bench: this.nearBench(p) ? 1 : 0,
      pa: p.path, kn: p.know, spi: p.spirit, ab: [...p.abil], mn: Math.round(p.mana), mm: p.maxMana,
      acd: Object.fromEntries(Object.entries(p.abcd).filter(([, v]) => v > 0).map(([k, v]) => [k, round1(v)])),
      lab: this.nearLab(p) ? 1 : 0, med: p.meditating ? 1 : 0, sh: p.shieldT > 0 ? Math.ceil(p.shieldHp) : 0,
      hal: p.halT > 0 ? round1(p.halT) : 0, hs: p.halS,
      tp: p.trip.a > 0 || p.trip.p > 0 || p.trip.t > 0 ? [round1(p.trip.a), round1(p.trip.p), round1(p.trip.t)] : null,
      tr: p.trial ? [p.trial.left, Math.ceil(p.trial.until - this.time)] : null,
    };
  }

  sendSnapshots(phase) {
    const sa = [];
    const saChunk = [];
    for (const s of this.sAdd.values()) {
      sa.push(this.serStatic(s));
      saChunk.push(s.cat === 'res' ? s.chunk : null);
    }
    const sd = [...this.sDel];
    this.sAdd.clear();
    this.sDel.clear();
    const dyn = [];
    for (const p of this.players.values()) dyn.push(this.serPlayer(p)); // погибшие тоже — лежат до возрождения
    const npcSer = new Map(); // звери сериализуются один раз за такт и только если кому-то видны
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
      for (const n of this.npcsNear(p.x, p.y, vr)) {
        if (n.owner && n.owner !== p.id) continue; // проводников видит только тот, кто в трипе
        let d = npcSer.get(n.id);
        if (!d) npcSer.set(n.id, (d = this.serNpc(n)));
        e.push(d);
      }
      const fr2 = (vr + 200) ** 2;
      const myFx = fx.filter((f) => f.g || (f.x - p.x) ** 2 + (f.y - p.y) ** 2 < fr2);
      if (p.pfx.length) {
        myFx.push(...p.pfx);
        p.pfx = [];
      }
      const msg = { t: 's', st, ph, you: this.serYou(p), e, m: meteor };
      // изменения ресурсов — только тем, у кого загружен их участок
      const mySa = sa.filter((x, i) => saChunk[i] === null || p.resLoaded.has(saChunk[i]));
      if (mySa.length) msg.sa = mySa;
      if (sd.length) msg.sd = sd;
      if (myFx.length) msg.fx = myFx;
      c.ws.send(JSON.stringify(msg));
    }
  }

  broadcastPlayerList() {
    const list = [...this.players.values()].map((p) => ({ n: p.name, c: p.color, k: p.kills, cx: complexity(p.genome), u: p.uid }));
    list.sort((a, b) => b.k - a.k);
    this.broadcast({ t: 'pl', list });
    // друзьям — где они сейчас (для карты и «рации»)
    for (const p of this.players.values()) if (this.fr.get(p.uid)?.size || p.invites.size) this.sendFriends(p);
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
        this.byUid.set(prof.uid, prof);
      }
      // дружба взаимная: оставляем только пары, записанные у обоих
      for (const prof of this.byUid.values()) {
        const list = Array.isArray(prof.friends) ? prof.friends : [];
        const set = new Set(list.filter((u) => u !== prof.uid && Array.isArray(this.byUid.get(u)?.friends) && this.byUid.get(u).friends.includes(prof.uid)));
        if (set.size) this.fr.set(prof.uid, set);
        prof.friends = [...set];
      }
    }
    if (Array.isArray(data.structures)) {
      for (const st of data.structures) {
        if (!STRUCTURES[st.k] || !Number.isFinite(st.x) || !Number.isFinite(st.y)) continue;
        if (this.tileAt(st.x, st.y) === T.WALL) continue; // на этом месте теперь стена мёртвого города
        for (const s of this.grid.query(st.x, st.y, TILE)) {
          if (s.cat === 'res' && circleBox(s.x, s.y, Math.max(s.cr, s.r * 0.5), st.x, st.y)) this.removeStatic(s);
        }
        this.addStructure(st.k, st.x, st.y, st.o, st.on, st.oc, clamp(Number(st.hp) || 1, 1, STRUCTURES[st.k].hp), st.inv);
      }
    }
  }
}
