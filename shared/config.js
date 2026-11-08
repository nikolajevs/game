// Общие константы и баланс. Используются и сервером, и браузером.

export const TICK_RATE = 30;
export const TILE = 40;
export const MAP_W = 120;
export const MAP_H = 120;
export const WORLD_W = TILE * MAP_W;
export const WORLD_H = TILE * MAP_H;

// Типы клеток карты
export const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, ROCK: 5 };
export const TERRAIN_NAMES = ['Глубина', 'Мелководье', 'Песок', 'Луг', 'Лес', 'Скалы'];
export const TERRAIN_SPEED = [0.45, 0.7, 0.95, 1, 0.92, 0.95];
export const isWater = (t) => t === T.DEEP || t === T.SHALLOW;

// Смена дня и ночи. phase: 0..1
export const DAY_LENGTH = 420; // секунд на полный цикл
export function lightAt(phase) {
  if (phase < 0.55) return 1;
  if (phase < 0.65) return 1 - ((phase - 0.55) / 0.1) * 0.88;
  if (phase < 0.92) return 0.12;
  return 0.12 + ((phase - 0.92) / 0.08) * 0.88;
}
export const isNight = (phase) => lightAt(phase) < 0.5;

export const ITEMS = {
  wood: { name: 'Древесина', icon: '🪵' },
  stone: { name: 'Камень', icon: '🪨' },
  berries: { name: 'Ягоды', icon: '🫐' },
  meat: { name: 'Мясо', icon: '🥩' },
  crystal: { name: 'Мутаген', icon: '💎' },
};
export const ITEM_KEYS = Object.keys(ITEMS);

// r — радиус для ударов, cr — радиус столкновения (0 = проходимо)
// Добыча за удар: доля от нанесённого урона (rate) или фиксированно (fixed)
export const RESOURCES = {
  tree: { name: 'Дерево', r: 30, cr: 14, hp: 120, give: 'wood', rate: 0.25, respawn: 100 },
  rock: { name: 'Валун', r: 24, cr: 22, hp: 160, give: 'stone', rate: 0.15, respawn: 140 },
  bush: { name: 'Ягодный куст', r: 18, cr: 0, hp: 40, give: 'berries', rate: 0.15, respawn: 70 },
  crystal: { name: 'Кристалл мутагена', r: 16, cr: 12, hp: 45, give: 'crystal', fixed: 15, dna: 6, respawn: 0 },
};

// Пища: сколько насыщает и множитель по типу рта
export const FOOD = {
  berries: { food: 8, water: 4, dna: 1, mult: { herb: 2, carn: 0.4, omni: 1 } },
  meat: { food: 18, water: 0, dna: 2, mult: { herb: 0.35, carn: 1.6, omni: 1 } },
};

// Постройки занимают одну клетку TILE x TILE
// solid: true — блокирует всех, 'owner' — пропускает только владельца
export const STRUCTURES = {
  wall_wood: { name: 'Стена из ветвей', cost: { wood: 20 }, hp: 300, solid: true, mat: 'wood', desc: 'Дешёвая, но слабая' },
  wall_stone: { name: 'Каменная стена', cost: { stone: 25, wood: 5 }, hp: 900, solid: true, mat: 'stone', desc: 'Крепкая защита базы' },
  door: { name: 'Дверь', cost: { wood: 30 }, hp: 350, solid: 'owner', mat: 'wood', desc: 'Проходима только для вас' },
  storage: { name: 'Хранилище', cost: { wood: 30, stone: 10 }, hp: 400, solid: true, mat: 'wood', storage: true, desc: 'Хранит ресурсы. Открыть — E' },
  campfire: { name: 'Костёр', cost: { wood: 15, stone: 5 }, hp: 200, solid: false, mat: 'stone', desc: 'Свет ночью и лечение рядом' },
  spikes: { name: 'Колья', cost: { wood: 25, stone: 5 }, hp: 250, solid: false, mat: 'wood', touchDmg: 12, desc: 'Ранят чужаков' },
  nest: { name: 'Гнездо', cost: { wood: 40, berries: 10 }, hp: 400, solid: false, mat: 'wood', desc: 'Точка возрождения (одно на игрока)' },
};
export const STRUCT_ORDER = ['wall_wood', 'wall_stone', 'door', 'storage', 'campfire', 'spikes', 'nest'];
export const STORAGE_CAP = 1500;
// Множители урона по постройкам в зависимости от типа атаки и материала
export const STRUCT_DMG = {
  melee: { wood: 0.5, stone: 0.25 },
  acid: { wood: 0.6, stone: 0.3 },
  charge: { wood: 1.6, stone: 0.9 },
};

// ---- Эволюция ----
export const MOUTHS = {
  herb: { name: 'Клюв травоеда', icon: '🌿', desc: 'Ягоды насыщают вдвое и собираются вдвое быстрее. Мясо почти не насыщает.' },
  omni: { name: 'Всеядная пасть', icon: '🍽️', desc: '+2 к урону. Любая пища усваивается нормально.' },
  carn: { name: 'Челюсти хищника', icon: '🦷', desc: '+5 к урону. Мясо насыщает сильнее, ягоды — слабо.' },
};
export const PARTS = {
  legs: { name: 'Ноги', icon: '🦵', max: 3, desc: 'Скорость передвижения' },
  claws: { name: 'Когти', icon: '🐾', max: 3, desc: 'Урон в ближнем бою и добыча ресурсов' },
  armor: { name: 'Панцирь', icon: '🛡️', max: 3, desc: 'Здоровье и снижение урона, но медленнее' },
  spikes: { name: 'Шипы', icon: '🌵', max: 3, desc: 'Отражают часть урона тем, кто бьёт вплотную' },
  eyes: { name: 'Глаза', icon: '👁️', max: 3, desc: 'Дальность обзора (и ночного зрения)' },
  horns: { name: 'Рога', icon: '🦏', max: 3, desc: 'Таран [Пробел]: рывок с уроном, ломает постройки' },
  acid: { name: 'Кислотная железа', icon: '🧪', max: 3, desc: 'Плевок кислотой [ПКМ], замедляет цель' },
  fins: { name: 'Плавники', icon: '🐟', max: 2, desc: 'Быстрое плавание' },
  glow: { name: 'Биолюминесценция', icon: '✨', max: 1, desc: 'Светитесь в темноте (вас тоже видно!)' },
  stomach: { name: 'Желудок', icon: '🫙', max: 2, desc: 'Голод и жажда растут медленнее' },
  size: { name: 'Масса тела', icon: '🐘', max: 3, desc: 'Больше здоровья и урона, но крупнее и медленнее' },
};
export const PART_KEYS = Object.keys(PARTS);
export const LEVEL_COST = [0, 10, 25, 50]; // ДНК за каждый уровень части
export const LEVEL3_CRYSTALS = 3; // 3-й уровень требует кристаллы мутагена
export const COMPLEXITY_CAP = 12; // максимум суммарных уровней частей
export const MOUTH_CHANGE_COST = 10;

// ---- Дикие существа ----
// genome: буква рта + уровни частей в порядке PART_KEYS
export const NPCS = {
  grazer: { name: 'Травник', genome: 'h20001000000', color: '#c8a46a', hp: 50, speed: 115, dmg: 0, behavior: 'passive', flee: 230, dna: 5, meat: 3, biomes: [T.GRASS, T.FOREST] },
  stalker: { name: 'Клыкач', genome: 'c22102000001', color: '#8a3344', hp: 85, speed: 148, dmg: 9, behavior: 'aggressive', aggro: 230, nightAggro: 380, dna: 12, meat: 4, biomes: [T.FOREST, T.ROCK, T.GRASS] },
  colossus: { name: 'Колосс', genome: 'o30300200003', color: '#5b7a3d', hp: 650, speed: 78, dmg: 28, behavior: 'territorial', aggro: 170, dna: 60, meat: 14, crystal: 3, attackCd: 1.3, biomes: [T.ROCK, T.FOREST] },
  mutant: { name: 'Мутант', genome: 'c22011010100', color: '#9b4be0', hp: 120, speed: 160, dmg: 12, behavior: 'aggressive', aggro: 420, nightAggro: 420, dna: 22, meat: 2, crystal: 1, biomes: [] },
};
export const NPC_TARGET = { grazer: 45, stalker: 14, colossus: 2 };
export const NIGHT_EXTRA_STALKERS = 12;

export const PLAYER = {
  startDna: 15,
  hungerRate: 0.3,
  thirstRate: 0.38,
  starveDmg: 3,
  regen: 1.2,
  fireRegen: 4,
  sprintMul: 1.55,
  staminaUse: 28,
  staminaRegen: 16,
  buildRange: 170,
  interactRange: 60,
  spawnProtect: 4,
  maxStructures: 150,
  remainsDnaShare: 0.3,
  remainsLife: 300,
};

// Дальность прорисовки = обзор (глаза) * VIEW_MULT. Дальше сервер существ не присылает.
export const VIEW_MULT = 1.6;

export const PLAYER_COLORS =['#6fbf73', '#4fa3e0', '#e0a34f', '#d9534f', '#b574e0', '#e0d24f', '#4fe0c8', '#e07bb5'];
