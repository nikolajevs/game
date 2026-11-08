// Общие константы и баланс. Используются и сервером, и браузером.

export const TICK_RATE = 30;
export const TILE = 40;
export const MAP_W = 240;
export const MAP_H = 240;
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

// Всё, что можно носить: ресурсы, боеприпасы, расходники и оружие.
// kind: res — ресурс, ammo — боеприпас, use — расходник, weapon — оружие
export const ITEMS = {
  wood: { name: 'Древесина', icon: '🪵', kind: 'res' },
  stone: { name: 'Камень', icon: '🪨', kind: 'res' },
  berries: { name: 'Ягоды', icon: '🫐', kind: 'res' },
  meat: { name: 'Мясо', icon: '🥩', kind: 'res' },
  bone: { name: 'Кости', icon: '🦴', kind: 'res' },
  scrap: { name: 'Металлолом', icon: '⚙️', kind: 'res' },
  sulfur: { name: 'Сера', icon: '🟡', kind: 'res' },
  crystal: { name: 'Мутаген', icon: '💎', kind: 'res' },
  arrows: { name: 'Стрелы', icon: '➶', kind: 'ammo' },
  bullets: { name: 'Патроны', icon: '🔸', kind: 'ammo' },
  antirad: { name: 'Антирад', icon: '💊', kind: 'use' },
  club: { name: 'Дубина', icon: '🏏', kind: 'weapon' },
  spear: { name: 'Копьё', icon: '🔱', kind: 'weapon' },
  axe: { name: 'Каменный топор', icon: '🪓', kind: 'weapon' },
  sling: { name: 'Праща', icon: '🪢', kind: 'weapon' },
  blade: { name: 'Костяной клинок', icon: '🗡️', kind: 'weapon' },
  pickaxe: { name: 'Кирка', icon: '⛏️', kind: 'weapon' },
  bow: { name: 'Лук', icon: '🏹', kind: 'weapon' },
  crossbow: { name: 'Арбалет', icon: '🎯', kind: 'weapon' },
  pistol: { name: 'Самопал', icon: '🔫', kind: 'weapon' },
  shotgun: { name: 'Дробовик', icon: '💥', kind: 'weapon' },
  bomb: { name: 'Взрывпакет', icon: '🧨', kind: 'weapon' },
};
export const ITEM_KEYS = Object.keys(ITEMS);
export const RES_KEYS = ITEM_KEYS.filter((k) => ITEMS[k].kind === 'res');

// ---- Оружие ----
// melee: добавка к урону тела, дальность и скорость удара; gather — множитель добычи
// ranged: снаряды и боеприпас; throw — расходуется само оружие
export const WEAPONS = {
  club: { type: 'melee', tier: 1, dmg: 7, reach: 8, cd: 0.6, struct: 1.4, desc: 'Тяжёлый удар, хорошо ломает постройки' },
  spear: { type: 'melee', tier: 1, dmg: 10, reach: 28, cd: 0.75, desc: 'Бьёт издалека' },
  axe: { type: 'melee', tier: 1, dmg: 6, reach: 6, cd: 0.6, gather: { wood: 2.2 }, struct: 1.2, desc: 'Рубит деревья вдвое быстрее' },
  sling: { type: 'ranged', tier: 1, ammo: 'stone', proj: 'stone', dmg: 12, speed: 560, life: 0.8, cd: 0.85, desc: 'Метает камни' },
  blade: { type: 'melee', tier: 2, dmg: 15, reach: 10, cd: 0.42, desc: 'Быстрые сильные удары' },
  pickaxe: { type: 'melee', tier: 2, dmg: 6, reach: 8, cd: 0.65, gather: { stone: 2.2, sulfur: 2.2, scrap: 1.6 }, struct: 1.5, desc: 'Добывает камень, серу и металл вдвое быстрее' },
  bow: { type: 'ranged', tier: 2, ammo: 'arrows', proj: 'arrow', dmg: 24, speed: 720, life: 1.0, cd: 0.9, desc: 'Тихий и точный' },
  crossbow: { type: 'ranged', tier: 2, ammo: 'arrows', proj: 'arrow', dmg: 42, speed: 900, life: 1.0, cd: 1.7, desc: 'Мощный, но долго перезаряжается' },
  pistol: { type: 'ranged', tier: 3, ammo: 'bullets', proj: 'bullet', dmg: 30, speed: 1300, life: 0.75, cd: 0.4, spread: 0.04, desc: 'Быстрая стрельба' },
  shotgun: { type: 'ranged', tier: 3, ammo: 'bullets', proj: 'bullet', dmg: 10, pellets: 7, speed: 1100, life: 0.4, cd: 1.15, spread: 0.3, desc: 'Сокрушителен вблизи' },
  bomb: { type: 'throw', tier: 3, proj: 'bomb', dmg: 70, structDmg: 450, radius: 100, speed: 420, life: 1.3, cd: 1.0, desc: 'Бросок, взрыв рушит стены' },
};
export const WEAPON_ORDER = ['club', 'spear', 'axe', 'sling', 'blade', 'pickaxe', 'bow', 'crossbow', 'pistol', 'shotgun', 'bomb'];
// урон снарядов по постройкам (доля урона по материалу)
export const PROJ_STRUCT = {
  acid: { wood: 0.6, stone: 0.3 },
  stone: { wood: 0.15, stone: 0.05 },
  arrow: { wood: 0.2, stone: 0.05 },
  bullet: { wood: 0.15, stone: 0.05 },
};
export const BOMB_STRUCT = { wood: 1, stone: 0.7 };

// ---- Крафт ----
// bench: нужен верстак рядом
export const RECIPES = {
  club: { cost: { wood: 15 } },
  spear: { cost: { wood: 25 } },
  axe: { cost: { wood: 15, stone: 10 } },
  sling: { cost: { wood: 10 } },
  blade: { cost: { bone: 12, wood: 5 } },
  pickaxe: { cost: { wood: 20, stone: 15, bone: 5 } },
  bow: { cost: { wood: 30, bone: 6 } },
  crossbow: { cost: { wood: 35, bone: 10, scrap: 8 } },
  arrows: { cost: { wood: 4, stone: 2 }, out: 5 },
  antirad: { cost: { berries: 4, bone: 2 }, out: 1 },
  bullets: { cost: { scrap: 1, sulfur: 3 }, out: 4, bench: true },
  pistol: { cost: { scrap: 25, wood: 10 }, bench: true },
  shotgun: { cost: { scrap: 45, wood: 15 }, bench: true },
  bomb: { cost: { sulfur: 20, scrap: 6, wood: 5 }, bench: true },
};
export const RECIPE_GROUPS = [
  ['Ближний бой', ['club', 'spear', 'axe', 'blade', 'pickaxe']],
  ['Дальний бой', ['sling', 'bow', 'crossbow']],
  ['Боеприпасы и расходники', ['arrows', 'antirad', 'bullets']],
  ['Огнестрел и взрывчатка', ['pistol', 'shotgun', 'bomb']],
];
export const BENCH_RANGE = 130;

// r — радиус для ударов, cr — радиус столкновения (0 = проходимо)
// Добыча за удар: доля от нанесённого урона (rate) или фиксированно (fixed)
export const RESOURCES = {
  tree: { name: 'Дерево', r: 30, cr: 14, hp: 120, give: 'wood', rate: 0.25, respawn: 100 },
  rock: { name: 'Валун', r: 24, cr: 22, hp: 160, give: 'stone', rate: 0.15, respawn: 140 },
  sulfur: { name: 'Сернистая руда', r: 24, cr: 22, hp: 160, give: 'sulfur', rate: 0.12, respawn: 160 },
  bush: { name: 'Ягодный куст', r: 18, cr: 0, hp: 40, give: 'berries', rate: 0.15, respawn: 70 },
  scrap: { name: 'Груда металлолома', r: 22, cr: 18, hp: 140, give: 'scrap', rate: 0.12, respawn: 120 },
  crystal: { name: 'Кристалл мутагена', r: 16, cr: 12, hp: 45, give: 'crystal', fixed: 15, dna: 4, respawn: 0 },
};

// Пища: сколько насыщает и множитель по типу рта
export const FOOD = {
  berries: { food: 8, water: 4, mult: { herb: 2, carn: 0.4, omni: 1 } },
  meat: { food: 18, water: 0, mult: { herb: 0.35, carn: 1.6, omni: 1 } },
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
  workbench: { name: 'Верстак', cost: { wood: 50, stone: 30, scrap: 15 }, hp: 500, solid: true, mat: 'wood', desc: 'Нужен для огнестрела, патронов и взрывчатки' },
};
export const STRUCT_ORDER = ['wall_wood', 'wall_stone', 'door', 'storage', 'campfire', 'spikes', 'nest', 'workbench'];
export const STORAGE_CAP = 1500;
// Множители урона по постройкам в зависимости от типа атаки и материала
export const STRUCT_DMG = {
  melee: { wood: 0.5, stone: 0.25 },
  charge: { wood: 1.6, stone: 0.9 },
};

// ---- Радиация ----
// В зонах облучение растёт (быстрее у центра), снаружи медленно спадает.
// Выше regenBlock — не лечимся, выше dmgStart — теряем здоровье.
export const RAD = {
  ratePerLevel: 3.2, // ед/с на уровень зоны
  decay: 1.2,
  regenBlock: 25,
  dmgStart: 50,
  dmgPerPoint: 0.07, // урон/с за каждую единицу выше dmgStart
  antirad: 45,
  zones: 6, // сколько зон на острове
  meteorZone: { lvl: 1, r: 230 }, // воронка упавшего метеорита фонит, пока там кристаллы
  mutagen: 0.5, // мутагена в секунду на уровень зоны — облучение меняет тело
};
export const CRATE = { name: 'Ящик с добычей', respawn: 200, rolls: 3, mutagen: [2, 6] }; // мутаген × уровень зоны

// ---- Особые места острова ----
// ruins — радиоактивные руины (их число — RAD.zones), mine — старые рудники, lair — логова колоссов.
// lvl — сила радиации в центре, crates — ящики с добычей, guards — кто охраняет (возрождаются, когда рядом нет игроков).
export const SITES = {
  ruins: {
    name: 'Радиоактивные руины', icon: '☢', crates: 4, guards: { mutant: 3 },
    enter: 'Радиоактивные руины: ящики с добычей и металлолом. Здесь бродят мутанты, облучение копит мутаген.',
  },
  mine: {
    name: 'Старый рудник', icon: '⛏', count: 3, r: 220, lvl: 1, crates: 3, guards: { mutant: 4 },
    enter: 'Старый рудник: богатая руда, сера и металлолом. Слабая радиация, охрана — мутанты.',
  },
  lair: {
    name: 'Логово колосса', icon: '🦴', count: 4, r: 180, lvl: 0, crates: 2, guards: { colossus: 1, stalker: 3 },
    enter: 'Логово колосса: тайник с добычей, мясо и кости. Хозяин и его стая где-то рядом!',
  },
};
// [предмет, мин, макс, вес]
export const CRATE_LOOT = [
  ['scrap', 4, 12, 10], ['sulfur', 5, 15, 6], ['bullets', 3, 8, 4], ['arrows', 4, 10, 5],
  ['antirad', 1, 2, 5], ['bone', 3, 8, 4], ['crystal', 1, 2, 2],
  ['crossbow', 1, 1, 1], ['pistol', 1, 1, 0.6], ['shotgun', 1, 1, 0.35], ['bomb', 1, 1, 0.5],
];

// ---- Мутации ----
// Тело выжившего меняется под действием мутагена (копится в радиации, есть в кристаллах и ящиках).
// Рты остались от диких существ: у людей всегда «всеядный».
export const MOUTHS = {
  herb: { name: 'Клюв травоеда', icon: '🌿', desc: 'Ягоды насыщают вдвое и собираются вдвое быстрее. Мясо почти не насыщает.' },
  omni: { name: 'Всеядная пасть', icon: '🍽️', desc: '+2 к урону. Любая пища усваивается нормально.' },
  carn: { name: 'Челюсти хищника', icon: '🦷', desc: '+5 к урону. Мясо насыщает сильнее, ягоды — слабо.' },
};
export const PARTS = {
  legs: { name: 'Жилистые ноги', icon: '🦵', max: 3, desc: 'Скорость передвижения' },
  claws: { name: 'Когти', icon: '🐾', max: 3, desc: 'Урон кулаком и быстрая добыча' },
  armor: { name: 'Костяные пластины', icon: '🛡️', max: 3, desc: 'Здоровье и снижение урона, но медленнее' },
  spikes: { name: 'Шипы', icon: '🌵', max: 3, desc: 'Отражают часть урона тем, кто бьёт вплотную' },
  eyes: { name: 'Лишние глаза', icon: '👁️', max: 3, desc: 'Дальность обзора (и ночного зрения)' },
  horns: { name: 'Рога', icon: '🦏', max: 3, desc: 'Таран [Пробел]: рывок с уроном, ломает постройки' },
  acid: { name: 'Кислотная железа', icon: '🧪', max: 3, desc: 'Плевок кислотой [Q], замедляет цель' },
  fins: { name: 'Жабры и перепонки', icon: '🐟', max: 2, desc: 'Быстрое плавание' },
  glow: { name: 'Свечение', icon: '✨', max: 1, desc: 'Кожа светится в темноте (вас тоже видно!)' },
  stomach: { name: 'Желудок мутанта', icon: '🫙', max: 2, desc: 'Голод и жажда растут медленнее' },
  size: { name: 'Гигантизм', icon: '🦍', max: 3, desc: 'Больше здоровья и урона, но крупнее и медленнее' },
  radres: { name: 'Радиорезистентность', icon: '☢️', max: 3, desc: 'Радиация копится медленнее (−30% за уровень)' },
};
export const PART_KEYS = Object.keys(PARTS);
export const LEVEL_COST = [0, 10, 25, 50]; // мутаген за каждый уровень мутации
export const LEVEL3_CRYSTALS = 3; // 3-й уровень требует кристаллы мутагена
export const COMPLEXITY_CAP = 12; // максимум суммарных уровней мутаций
export const MOUTH_CHANGE_COST = 10;

// ---- Дикие существа ----
// genome: буква рта + уровни частей в порядке PART_KEYS (недостающие = 0)
export const NPCS = {
  grazer: { name: 'Травник', genome: 'h20001000000', color: '#c8a46a', hp: 50, speed: 115, dmg: 0, behavior: 'passive', flee: 230, dna: 0, meat: 3, bone: 2, biomes: [T.GRASS] }, // пасутся на лугах
  stalker: { name: 'Клыкач', genome: 'c22102000001', color: '#8a3344', hp: 85, speed: 148, dmg: 9, behavior: 'aggressive', aggro: 230, nightAggro: 380, dna: 0, meat: 4, bone: 3, biomes: [T.FOREST, T.ROCK] }, // охотятся в лесах и скалах
  colossus: { name: 'Колосс', genome: 'o30300200003', color: '#5b7a3d', hp: 650, speed: 78, dmg: 28, behavior: 'territorial', aggro: 170, dna: 20, meat: 14, bone: 12, crystal: 3, attackCd: 1.3, biomes: [] }, // только в логовах
  mutant: { name: 'Мутант', genome: 'c22011010100', color: '#9b4be0', hp: 120, speed: 160, dmg: 12, behavior: 'aggressive', aggro: 420, nightAggro: 420, dna: 12, meat: 2, bone: 3, crystal: 1, biomes: [] },
};
// сколько бродит по острову вне особых мест (охрана мест — в SITES)
export const NPC_TARGET = { grazer: 150, stalker: 45 };
export const NIGHT_EXTRA_STALKERS = 36;

export const PLAYER = {
  startDna: 0, // мутаген на старте: мутации начинаются с облучения
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

export const PLAYER_COLORS = ['#6fbf73', '#4fa3e0', '#e0a34f', '#d9534f', '#b574e0', '#e0d24f', '#4fe0c8', '#e07bb5'];
