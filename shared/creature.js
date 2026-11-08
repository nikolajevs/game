// Геном существа: кодирование, проверка, стоимость эволюции и итоговые характеристики.
import {
  PARTS, PART_KEYS, MOUTHS, LEVEL_COST, LEVEL3_CRYSTALS, MOUTH_CHANGE_COST,
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

// Новые уровни стоят ДНК (3-й ещё и кристаллы), удалённые возвращают половину ДНК
export function evolveCost(from, to) {
  let dna = 0;
  let crystals = 0;
  let refund = 0;
  for (const k of PART_KEYS) {
    const a = from.parts[k] || 0;
    const b = to.parts[k] || 0;
    for (let l = a + 1; l <= b; l++) {
      dna += LEVEL_COST[l];
      if (l >= 3) crystals += LEVEL3_CRYSTALS;
    }
    for (let l = b + 1; l <= a; l++) refund += Math.floor(LEVEL_COST[l] / 2);
  }
  if (from.mouth !== to.mouth) dna += MOUTH_CHANGE_COST;
  return { dna, crystals, refund, net: dna - refund };
}

export function computeStats(g) {
  const L = (k) => g.parts[k] || 0;
  const size = L('size');
  const armor = L('armor');
  const mouthDmg = g.mouth === 'carn' ? 5 : g.mouth === 'omni' ? 2 : 0;
  return {
    radius: 16 + size * 5,
    maxHp: 100 + size * 45 + armor * 35,
    defense: armor * 0.1,
    speed: 150 + L('legs') * 24 - size * 9 - armor * 6,
    swim: L('fins'),
    meleeDmg: 8 + L('claws') * 5 + size * 3 + mouthDmg,
    reach: 30 + size * 3,
    attackCd: 0.55,
    vision: 420 + L('eyes') * 120,
    thorns: L('spikes') * 0.18,
    spit: L('acid') ? { dmg: 9 + L('acid') * 6, cd: 1.7 - L('acid') * 0.25, speed: 560 } : null,
    charge: L('horns') ? { dmg: 16 + L('horns') * 12, cd: 6.5 - L('horns'), speed: 760 } : null,
    glow: L('glow') ? 260 : 0,
    metabolism: 1 - L('stomach') * 0.25,
    diet: g.mouth,
  };
}
