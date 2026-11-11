// Геном существа: кодирование, проверка, стоимость эволюции и итоговые характеристики.
import {
  PARTS, PART_KEYS, MOUTHS, LEVEL_COST, MOUTH_CHANGE_COST, MUT_SCHOOLS, SCHOOL_KEYS, APEX_LEVEL, OFFPATH_MAX,
} from './config.js';

const MOUTH_LETTER = { herb: 'h', carn: 'c', omni: 'o' };
const LETTER_MOUTH = { h: 'herb', c: 'carn', o: 'omni' };

export function defaultGenome() {
  const parts = {};
  for (const k of PART_KEYS) parts[k] = 0;
  return { mouth: 'omni', parts };
}

export function cloneGenome(g) {
  return { mouth: g.mouth, parts: { ...g.parts } };
}

// Компактная строка для сети: буква рта + цифра на каждую часть
export function encodeGenome(g) {
  return MOUTH_LETTER[g.mouth] + PART_KEYS.map((k) => g.parts[k] || 0).join('');
}

export function decodeGenome(s) {
  const g = defaultGenome();
  if (typeof s !== 'string' || !s.length) return g;
  g.mouth = LETTER_MOUTH[s[0]] || 'omni';
  PART_KEYS.forEach((k, i) => {
    const v = parseInt(s[i + 1], 10);
    g.parts[k] = Number.isFinite(v) ? Math.max(0, Math.min(PARTS[k].max, v)) : 0;
  });
  return g;
}

export function sanitizeGenome(raw) {
  const g = defaultGenome();
  if (!raw || typeof raw !== 'object') return g;
  if (MOUTHS[raw.mouth]) g.mouth = raw.mouth;
  if (raw.parts && typeof raw.parts === 'object') {
    for (const k of PART_KEYS) {
      const v = Math.floor(Number(raw.parts[k]) || 0);
      g.parts[k] = Math.max(0, Math.min(PARTS[k].max, v));
    }
  }
  return g;
}

export function complexity(g) {
  return PART_KEYS.reduce((s, k) => s + (g.parts[k] || 0), 0);
}

// сколько уровней набрано в каждой школе мутаций
export function schoolLevels(g) {
  const out = {};
  for (const id of SCHOOL_KEYS) out[id] = 0;
  for (const k of PART_KEYS) out[PARTS[k].school] += g.parts[k] || 0;
  return out;
}

// Ступень резонанса школы: 0 — нет, 1 и 2 — по порогам MUT_SCHOOLS[...].res
export function resonance(g, school) {
  const n = schoolLevels(g)[school];
  return MUT_SCHOOLS[school].res.filter((r) => n >= r.need).length;
}

// До какого уровня игрок с таким путём может довести мутацию:
// третий уровень («предел») — только школе своего пути
export function levelLimit(k, path) {
  const def = PARTS[k];
  return Math.min(def.max, MUT_SCHOOLS[def.school].path === path ? APEX_LEVEL : OFFPATH_MAX);
}

// Какие мутации черновика выше дозволенного (уже набранные раньше уровни не отнимаются)
export function overLimit(from, to, path) {
  return PART_KEYS.filter((k) => (to.parts[k] || 0) > Math.max(levelLimit(k, path), from.parts[k] || 0));
}

// Новые уровни стоят мутаген и материалы своей школы, удалённые возвращают половину мутагена
export function evolveCost(from, to) {
  let dna = 0;
  let refund = 0;
  const items = {};
  for (const k of PART_KEYS) {
    const a = from.parts[k] || 0;
    const b = to.parts[k] || 0;
    const extra = MUT_SCHOOLS[PARTS[k].school].item;
    for (let l = a + 1; l <= b; l++) {
      dna += LEVEL_COST[l];
      for (const [r, v] of Object.entries(extra[l] || {})) items[r] = (items[r] || 0) + v;
    }
    for (let l = b + 1; l <= a; l++) refund += Math.floor(LEVEL_COST[l] / 2);
  }
  if (from.mouth !== to.mouth) dna += MOUTH_CHANGE_COST;
  return { dna, items, refund, net: dna - refund };
}

// С «Генной инженерией» (путь разума) мутации дешевле и требуют только мутаген
export function evolveCostWith(from, to, genetics) {
  const c = evolveCost(from, to);
  if (!genetics) return c;
  const dna = Math.ceil(c.dna * 0.7);
  return { dna, items: {}, refund: c.refund, net: dna - c.refund };
}

export function computeStats(g) {
  const L = (k) => g.parts[k] || 0;
  const size = L('size');
  const armor = L('armor');
  const mouthDmg = g.mouth === 'carn' ? 5 : g.mouth === 'omni' ? 2 : 0;
  // резонанс школ: импланты усиливают оружие, дары плоти — когти, кислоту и таран
  const tech = resonance(g, 'tech');
  const spirit = resonance(g, 'spirit');
  const natMul = 1 + spirit * 0.15;
  const cdMul = 1 - L('reflex') * 0.08 - (L('reflex') >= 3 ? 0.06 : 0);
  return {
    radius: 16 + size * 5,
    maxHp: 100 + size * 45 + armor * 35 + (spirit >= 2 ? 25 : 0),
    defense: armor * 0.1,
    rangedDef: armor >= 3 ? 0.2 : 0, // предел брони: пули и стрелы слабее
    speed: 150 + L('legs') * 24 - size * 9 - armor * 6,
    sprintCost: L('legs') >= 3 ? 0.5 : 1,
    swim: L('fins'),
    meleeDmg: Math.round((8 + L('claws') * 5 + size * 3 + mouthDmg) * natMul),
    bleed: L('claws') >= 3 ? { dps: 4, time: 4 } : null,
    reach: 30 + size * 3,
    attackCd: Math.round(0.55 * cdMul * 100) / 100,
    cdMul, // множитель перезарядки оружия (нейроускоритель)
    wpnMul: 1 + tech * 0.1, // урон оружия (резонанс имплантов)
    armMul: 1 + L('arm') * 0.1, // урон оружия ближнего боя (гидравлика)
    structMul: 1 + L('arm') * 0.25, // урон по постройкам в ближнем бою
    kbMul: L('arm') >= 3 ? 2 : 1,
    kbResist: size >= 3 ? 0.5 : 1,
    aimMul: L('eyes') >= 3 ? 1.15 : 1, // урон стрелкового оружия
    vision: 420 + L('eyes') * 120,
    thorns: L('spikes') * 0.18,
    thornSlow: L('spikes') >= 3,
    spit: L('acid') ? { dmg: Math.round((9 + L('acid') * 6) * natMul), cd: 1.7 - L('acid') * 0.25, speed: 560, corrode: L('acid') >= 3 } : null,
    charge: L('horns') ? { dmg: Math.round((16 + L('horns') * 12) * natMul), cd: 6.5 - L('horns'), speed: 760, stun: L('horns') >= 3 ? 1 : 0 } : null,
    dash: L('jets') ? { dist: 200 + L('jets') * 70, cd: 9 - L('jets') * 1.5, blast: L('jets') >= 3 ? 24 : 0 } : null,
    shock: L('shock') ? { dmg: 4 + L('shock') * 4, every: L('shock') >= 3 ? 3 : 4, stun: 0.5 + L('shock') * 0.15 } : null,
    glow: L('glow') ? 260 : 0,
    manaMax: L('glow') * 10,
    manaRegen: 1 + L('glow') * 0.25,
    metabolism: 1 - L('stomach') * 0.25,
    meatHeal: L('stomach') >= 2 ? 8 : 0,
    regen: 1 + L('regen') * 0.6,
    regenAlways: L('regen') >= 3,
    staRegen: 1 + L('battery') * 0.3,
    abilCd: (L('battery') >= 3 ? 0.8 : 1) * (tech >= 2 ? 0.85 : 1), // перезарядка умений пути
    radResist: L('radres') * 0.3,
    radClean: L('radres') >= 3,
    canHold: true, // выживший держит оружие руками
    diet: g.mouth,
  };
}
