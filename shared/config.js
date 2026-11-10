// Общие константы и баланс. Используются и сервером, и браузером.

export const TICK_RATE = 30;
export const TILE = 40;
export const MAP_W = 1200; // остров ~48000×48000 единиц (человек — 44 единицы, ~2×2 км)
export const MAP_H = 1200;
export const WORLD_W = TILE * MAP_W;
export const WORLD_H = TILE * MAP_H;
// во сколько раз площадь больше исходного острова 240×240 — по ней считаются места и звери
export const AREA_SCALE = (MAP_W * MAP_H) / (240 * 240);
const SITE_DENSITY = AREA_SCALE * 0.5; // мест на единицу площади — вдвое реже, чем на малом острове
const WILD_DENSITY = AREA_SCALE * 0.12; // зверей немного: остров большой, а встречи редкие
// Мир вокруг игрока: ресурсы приходят участками, дальние звери «спят»
export const RES_CHUNK = 1200; // сторона участка ресурсов
export const RES_LOAD_R = 2600; // участки ближе этого присылаются клиенту
export const RES_DROP_R = 3400; // дальше этого — забываются
export const NPC_WAKE_R = 2600; // звери дальше от всех игроков не думают и не двигаются

// Типы клеток карты
// CITY — асфальт и бетон мёртвого города, WALL — уцелевшие стены его домов (сквозь них не пройти)
export const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, ROCK: 5, CITY: 6, WALL: 7 };
export const TERRAIN_NAMES = ['Глубина', 'Мелководье', 'Песок', 'Луг', 'Лес', 'Скалы', 'Мёртвый город', 'Руины домов'];
export const TERRAIN_SPEED = [0.45, 0.7, 0.95, 1, 0.92, 0.95, 1, 1];
// Мёртвый город: один на острове, с воронкой ядерного взрыва в центре. Размеры — в клетках.
export const CITY = { r: 62, crater: 9, block: 14, street: 3 };
export const isWater = (t) => t === T.DEEP || t === T.SHALLOW;

// Смена дня и ночи. phase: 0..1
export const DAY_LENGTH = 1800; // секунд на полный цикл: ~19 минут дня и ~11 минут ночи
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
  mushroom: { name: 'Боровики', icon: '🟤', kind: 'res' },
  amanita: { name: 'Мухоморы', icon: '🍄', kind: 'res' },
  glowcap: { name: 'Сияющие поганки', icon: '💠', kind: 'res' },
  peyote: { name: 'Пейотль', icon: '🌵', kind: 'res' }, // кактус с пляжей и скал: второе дыхание
  toad: { name: 'Сияющая жаба', icon: '🐸', kind: 'res' }, // ловится у воды: онемение
  bone: { name: 'Кости', icon: '🦴', kind: 'res' },
  scrap: { name: 'Металлолом', icon: '⚙️', kind: 'res' },
  electronics: { name: 'Электроника', icon: '🔌', kind: 'res' }, // платы и провода из мёртвого города и роботов
  // три части верстака для испытания пути разума: лежат в ящиках рудников, города и руин
  vise: { name: 'Тиски', icon: '🗜️', kind: 'res' },
  toolkit: { name: 'Набор инструментов', icon: '🧰', kind: 'res' },
  drive: { name: 'Приводной механизм', icon: '🔩', kind: 'res' },
  sulfur: { name: 'Сера', icon: '🟡', kind: 'res' },
  crystal: { name: 'Мутаген', icon: '💎', kind: 'res' },
  data: { name: 'Носитель данных', icon: '💾', kind: 'res' }, // знания для пути разума (лаборатория)
  artifact: { name: 'Древний артефакт', icon: '🔮', kind: 'res' }, // сила духа для пути духа
  arrows: { name: 'Стрелы', icon: '➶', kind: 'ammo' },
  bullets: { name: 'Патроны', icon: '🔸', kind: 'ammo' },
  cell: { name: 'Энергоячейка', icon: '🔋', kind: 'ammo' },
  antirad: { name: 'Антирад', icon: '💊', kind: 'use' },
  elixir: { name: 'Эликсир духа', icon: '⚗️', kind: 'use' }, // ритуал пути духа: мана и немного здоровья
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
  laser: { name: 'Лазерная винтовка', icon: '🔦', kind: 'weapon' },
  dagger: { name: 'Ритуальный кинжал', icon: '🔪', kind: 'weapon' },
  staff: { name: 'Посох духа', icon: '🪄', kind: 'weapon' },
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
  // оружие пути духа: кинжал лечит владельца, посох стреляет за ману (mana) без боеприпасов
  dagger: { type: 'melee', tier: 2, dmg: 13, reach: 6, cd: 0.36, leech: 0.3, desc: 'Быстрый; каждый удар возвращает 30% урона здоровьем' },
  staff: { type: 'ranged', tier: 3, mana: 7, proj: 'force', dmg: 22, speed: 900, life: 0.6, cd: 0.6, kb: 120, desc: 'Сгустки силы за ману, боеприпасы не нужны' },
  laser: { type: 'ranged', tier: 4, ammo: 'cell', proj: 'laser', dmg: 34, speed: 2400, life: 0.42, cd: 0.38, desc: 'Луч: быстрый, точный и мощный' },
};
export const WEAPON_ORDER = ['club', 'spear', 'axe', 'sling', 'blade', 'pickaxe', 'bow', 'crossbow', 'pistol', 'shotgun', 'bomb', 'laser', 'dagger', 'staff'];
// урон снарядов по постройкам (доля урона по материалу)
export const PROJ_STRUCT = {
  acid: { wood: 0.6, stone: 0.3 },
  stone: { wood: 0.15, stone: 0.05 },
  arrow: { wood: 0.2, stone: 0.05 },
  bullet: { wood: 0.15, stone: 0.05 },
  laser: { wood: 0.35, stone: 0.12 },
  force: { wood: 0.2, stone: 0.05 },
  drain: { wood: 0.1, stone: 0.05 },
  hex: { wood: 0.1, stone: 0.05 },
};
export const BOMB_STRUCT = { wood: 1, stone: 0.7 };

// ---- Крафт ----
// Без поля path рецепт базовый — доступен всем. path: 'mind' — технологии пути разума,
// path: 'spirit' — ритуалы пути духа: чужие и ещё не выбранные пути в меню крафта даже не видны.
// bench — нужен верстак рядом, lab — лаборатория, fire — костёр; ability — изученное умение.
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
  // технологии пути разума
  bullets: { cost: { scrap: 1, sulfur: 3 }, out: 4, bench: true, path: 'mind' },
  // trial — этим рецептом у алтаря выбора проходят испытание разума: его видно и без пути
  pistol: { cost: { scrap: 25, wood: 10 }, bench: true, path: 'mind', trial: true },
  shotgun: { cost: { scrap: 45, wood: 15 }, bench: true, path: 'mind' },
  bomb: { cost: { sulfur: 20, scrap: 6, wood: 5 }, bench: true, path: 'mind' },
  laser: { cost: { scrap: 40, sulfur: 10, crystal: 3, electronics: 12 }, lab: true, ability: 'laser', path: 'mind' },
  cell: { cost: { scrap: 3, sulfur: 2, electronics: 1 }, out: 6, lab: true, ability: 'laser', path: 'mind' },
  // ритуалы пути духа
  elixir: { cost: { amanita: 1, berries: 4 }, out: 1, fire: true, path: 'spirit' },
  dagger: { cost: { bone: 14, crystal: 1 }, path: 'spirit' },
  staff: { cost: { wood: 30, bone: 8, crystal: 2 }, fire: true, path: 'spirit' },
};
// Вкладки меню крафта. Вкладка с path видна только тем, кто выбрал этот путь.
export const CRAFT_TABS = [
  { id: 'weapons', name: 'Оружие', icon: '⚔️', items: ['club', 'spear', 'axe', 'blade', 'pickaxe', 'sling', 'bow', 'crossbow'] },
  { id: 'supplies', name: 'Припасы', icon: '🎒', items: ['arrows', 'antirad'] },
  { id: 'trial', trial: true, name: 'Испытание разума', icon: '⚖️', items: ['pistol'] }, // только без пути и у алтаря выбора
  { id: 'tech', path: 'mind', name: 'Технологии', icon: '⚙️', items: ['bullets', 'pistol', 'shotgun', 'bomb', 'cell', 'laser'] },
  { id: 'ritual', path: 'spirit', name: 'Ритуалы', icon: '🔮', items: ['elixir', 'dagger', 'staff'] },
];
export const CRAFT_MAX = 10; // столько раз подряд можно создать одним нажатием
// Расходники: что даёт применение (antirad — клавиша R, elixir — T)
export const USES = {
  antirad: { key: 'R' },
  elixir: { key: 'T', mana: 50, hp: 20 },
};
export const BENCH_RANGE = 130;

// r — радиус для ударов, cr — радиус столкновения (0 = проходимо)
// Добыча за удар: доля от нанесённого урона (rate), фиксированно по 1 за удар (fixed)
// или запас на узел (total): сколько бы ни было ударов, всего выдаст не больше total.
export const RESOURCES = {
  tree: { name: 'Дерево', r: 30, cr: 14, hp: 120, give: 'wood', rate: 0.25, respawn: 100 },
  rock: { name: 'Валун', r: 24, cr: 22, hp: 160, give: 'stone', rate: 0.15, respawn: 140 },
  sulfur: { name: 'Сернистая руда', r: 24, cr: 22, hp: 160, give: 'sulfur', rate: 0.12, respawn: 160 },
  bush: { name: 'Ягодный куст', r: 18, cr: 0, hp: 40, give: 'berries', total: 3, respawn: 70 }, // на кусте ровно 3 ягоды
  scrap: { name: 'Груда металлолома', r: 22, cr: 18, hp: 140, give: 'scrap', rate: 0.12, respawn: 120 },
  // мёртвый город: остовы машин — металл, серверные шкафы — электроника
  car: { name: 'Остов машины', r: 34, cr: 26, hp: 220, give: 'scrap', rate: 0.14, respawn: 300 },
  terminal: { name: 'Серверный шкаф', r: 20, cr: 16, hp: 120, give: 'electronics', rate: 0.1, respawn: 240 },
  crystal: { name: 'Кристалл мутагена', r: 16, cr: 12, hp: 45, give: 'crystal', fixed: 15, dna: 4, respawn: 0 },
  // боровики срываются за 2 удара (по грибу за удар), сквозь грибы можно пройти;
  // психоделики (мухомор, поганка, пейотль, жаба) — один удар и ровно 1 штука с узла
  mush_brown: { name: 'Боровики', r: 11, cr: 0, hp: 30, give: 'mushroom', fixed: 15, respawn: 140 },
  mush_red: { name: 'Мухоморы', r: 11, cr: 0, hp: 15, give: 'amanita', fixed: 15, respawn: 180 },
  mush_glow: { name: 'Сияющие поганки', r: 11, cr: 0, hp: 15, give: 'glowcap', fixed: 15, respawn: 240 },
  // для испытания пути духа: кактус растёт на песке, жаба сидит на берегу у самой воды
  cactus: { name: 'Пейотль', r: 12, cr: 0, hp: 15, give: 'peyote', fixed: 15, respawn: 220 },
  frog: { name: 'Сияющая жаба', r: 11, cr: 0, hp: 15, give: 'toad', fixed: 15, respawn: 240 },
};

// Три трипа: у каждого свои видения (их рисует клиент) и свой бонус, пока трип длится.
// a — мухомор: сияющий радужный мир и сила; p — пейотль: плывущие стены и второе дыхание;
// t — сияющая жаба: фракталы и онемение.
export const TRIPS = {
  a: { name: 'Мухоморный трип', icon: '🍄', time: 60, might: 1.4, bonus: 'сила: урон в ближнем бою +40%', start: '🍄 Мир вспыхивает красками, в руках просыпается сила…' },
  p: { name: 'Пейотлевый трип', icon: '🌵', time: 60, wind: true, bonus: 'второе дыхание: бег не отнимает сил', start: '🌵 Стены и горизонт поплыли, а ноги не знают усталости…' },
  t: { name: 'Жабий трип', icon: '🐸', time: 60, numb: 0.6, bonus: 'онемение: урон по вам меньше на 40%', start: '🐸 Всё рассыпается на узоры, тело немеет и не чувствует ударов…' },
};
export const TRIP_MAX = 180; // трип от нескольких порций складывается до этого предела
// Пища: сколько насыщает и множитель по типу рта
export const FOOD = {
  berries: { food: 8, water: 4, mult: { herb: 2, carn: 0.4, omni: 1 } },
  meat: { food: 18, water: 0, mult: { herb: 0.35, carn: 1.6, omni: 1 } },
  mushroom: { food: 10, water: 2, mult: { herb: 1, carn: 1, omni: 1 } },
  // галлюциногены: F их не ест — только щелчком по ним в инвентаре.
  // hal — сколько секунд и насколько сильно «плывёт» мир; spirit — сила духа (кроме пути разума)
  amanita: { food: 4, water: 0, mult: { herb: 1, carn: 1, omni: 1 }, trip: 'a', spirit: 2 },
  glowcap: { food: 3, water: 2, mult: { herb: 1, carn: 1, omni: 1 }, hal: { t: 60, s: 1 }, spirit: 3, mana: 40, rad: 8 },
  peyote: { food: 3, water: 8, mult: { herb: 1, carn: 1, omni: 1 }, trip: 'p', spirit: 1 },
  toad: { food: 2, water: 0, mult: { herb: 1, carn: 1, omni: 1 }, trip: 't', spirit: 1 },
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
  nest: { name: 'Палатка', cost: { wood: 35, bone: 3 }, hp: 400, solid: false, mat: 'wood', desc: 'Точка возрождения (одна на игрока)' }, // ключ nest — ради старых сохранений
  workbench: { name: 'Верстак', cost: { wood: 50, stone: 30, scrap: 15 }, parts: { vise: 1, toolkit: 1, drive: 1 }, hp: 500, solid: true, mat: 'wood', desc: 'Огнестрел, патроны и взрывчатка. Тем, кто не на пути разума, нужны три части верстака' },
  lab: { name: 'Лаборатория', cost: { wood: 60, stone: 40, scrap: 30 }, hp: 550, solid: true, mat: 'stone', desc: 'Данные → знания, опыты; лазеры и энергоячейки' },
  turret: { name: 'Автотурель', cost: { scrap: 40, sulfur: 20, stone: 30, electronics: 15 }, hp: 450, solid: true, mat: 'stone', ability: 'turret', desc: 'Сама стреляет по зверям и чужакам (путь разума)' },
};
export const STRUCT_ORDER = ['wall_wood', 'wall_stone', 'door', 'storage', 'campfire', 'spikes', 'nest', 'workbench', 'lab', 'turret'];
// Меню стройки: разделы и что в них лежит (цифры 1–9 выбирают постройку внутри раздела)
export const BUILD_CATS = [
  { id: 'walls', name: 'Стены', icon: '🧱', items: ['wall_wood', 'wall_stone', 'door'] },
  { id: 'base', name: 'Лагерь', icon: '🏕', items: ['nest', 'campfire', 'storage'] },
  { id: 'craft', name: 'Мастерские', icon: '🛠', items: ['workbench', 'lab'] },
  { id: 'defense', name: 'Оборона', icon: '🛡', items: ['spikes', 'turret'] },
];
export const BUILD_PAINT = new Set(['wall_wood', 'wall_stone', 'spikes']); // ставятся рядом, если вести мышь с зажатой ЛКМ
export const DEMOLISH_REFUND = 0.5; // доля ресурсов, которая возвращается за целую постройку
export const REPAIR_SHARE = 0.5; // полный ремонт разрушенной почти до конца постройки стоит эту долю её цены
// что вернётся за снос постройки с таким запасом прочности
export function demolishRefund(kind, hp, maxHp) {
  const out = {};
  for (const [k, v] of Object.entries(STRUCTURES[kind].cost)) {
    const n = Math.floor(v * DEMOLISH_REFUND * (hp / maxHp));
    if (n > 0) out[k] = n;
  }
  return out;
}
// сколько стоит починить постройку до конца (пусто — она цела)
export function repairCost(kind, hp, maxHp) {
  const out = {};
  const miss = 1 - hp / maxHp;
  if (miss <= 0.001) return out;
  for (const [k, v] of Object.entries(STRUCTURES[kind].cost)) out[k] = Math.max(1, Math.ceil(v * REPAIR_SHARE * miss));
  return out;
}
export const TURRET = { range: 360, cd: 0.7, dmg: 11, speed: 1300 };
export const STORAGE_CAP = 1500;
// Цена постройки для игрока с таким путём: части верстака (parts) нужны всем, кроме пути разума
export function buildCost(kind, path) {
  const d = STRUCTURES[kind];
  return d.parts && path !== 'mind' ? { ...d.cost, ...d.parts } : d.cost;
}
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
  zones: Math.round(6 * SITE_DENSITY), // сколько радиоактивных руин на острове
  meteorZone: { lvl: 1, r: 230 }, // воронка упавшего метеорита фонит, пока там кристаллы
  mutagen: 0.5, // мутагена в секунду на уровень зоны — облучение меняет тело
};
export const CRATE = { name: 'Ящик с добычей', respawn: 200, rolls: 3, mutagen: [2, 6] }; // мутаген × уровень зоны

// ---- Особые места острова ----
// ruins — радиоактивные руины (их число — RAD.zones), mine — старые рудники, lair — логова утробников,
// city и crater — мёртвый город и воронка взрыва в его центре.
// lvl — сила радиации в центре, crates — ящики с добычей, guards — кто охраняет (возрождаются, когда рядом нет игроков).
export const SITES = {
  // мёртвый город и воронка в его центре — по одному на остров (см. CITY)
  crater: {
    name: 'Эпицентр взрыва', icon: '☢', count: 1, lvl: 3, crates: 5, guards: { mech: 1, reaper: 2 },
    enter: 'Эпицентр ядерного взрыва: оплавленная воронка, сильнейшая радиация и лучшая добыча города. Её стережёт Каратель.',
  },
  city: {
    name: 'Мёртвый город', icon: '🏙', count: 1, lvl: 0, crates: 16, guards: { spider: 12, drone: 7, reaper: 3 },
    enter: 'Мёртвый город: остовы машин, серверные шкафы с электроникой и ящики в развалинах. Улицы патрулируют машины-убийцы.',
  },
  ruins: {
    name: 'Радиоактивные руины', icon: '☢', crates: 4, guards: { spider: 2, drone: 1 },
    enter: 'Радиоактивные руины: ящики с добычей и металлолом. Здесь всё ещё несут службу роботы, облучение копит мутаген.',
  },
  mine: {
    name: 'Старый рудник', icon: '⛏', count: Math.round(3 * SITE_DENSITY), r: 220, lvl: 1, crates: 3, guards: { spider: 3, drone: 1 },
    enter: 'Старый рудник: богатая руда, сера и металлолом. Слабая радиация, охрана — горные роботы.',
  },
  lair: {
    name: 'Логово утробника', icon: '🦴', count: Math.round(4 * SITE_DENSITY), r: 180, lvl: 0, crates: 2, guards: { glutton: 1, claw: 3 },
    enter: 'Логово утробника: тайник с добычей (бывают древние артефакты), мясо и кости. Хозяин и его стая когтней где-то рядом!',
  },
  altar: {
    name: 'Древний алтарь', icon: '🕯', count: Math.round(1.5 * SITE_DENSITY), r: 130, lvl: 0, crates: 0, guards: {},
    enter: 'Древний алтарь: постойте неподвижно в круге камней — медитация копит силу духа.',
  },
  // здесь и только здесь выбирают путь: испытания — в TRIALS
  shrine: {
    name: 'Алтарь выбора', icon: '⚖️', count: 6, r: 190, lvl: 0, crates: 0, guards: {},
    enter: 'Алтарь выбора: здесь выбирают путь. Что нужно для испытаний разума и духа — в окне путей (P).',
  },
};
// особая добыча мест: [предмет, мин, макс, вес] добавляется к общему списку ящика
export const SITE_LOOT = {
  ruins: [['data', 1, 2, 7], ['electronics', 2, 5, 5], ['drive', 1, 1, 7]],
  mine: [['data', 1, 3, 9], ['vise', 1, 1, 8]],
  lair: [['artifact', 1, 1, 8]],
  city: [['electronics', 4, 10, 14], ['data', 1, 2, 7], ['cell', 4, 10, 4], ['toolkit', 1, 1, 9]],
  crater: [['electronics', 8, 16, 12], ['data', 2, 4, 10], ['cell', 8, 16, 6], ['crystal', 2, 4, 6]],
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

// ---- Чудовища острова ----
// Две силы. spirit — духи и органические мутанты: живут в лесах и логовах, стерегут деревья и грибы.
// tech — машины-убийцы погибшей цивилизации: мёртвый город, руины и рудники.
// model — готовая анимированная модель (public/assets/monsters), r — радиус тела, reach — дальность удара.
// loot — добыча: целое — штук, дробь — шанс одной штуки. fly — парит: не замечает воду, деревья и стены.
// shoot — дальняя атака: снаряд proj, пока цель между min и range.
export const NPCS = {
  stag: {
    name: 'Рогач', faction: 'spirit', model: 'stag', color: '#b08a5a', r: 20, hp: 60, speed: 120, dmg: 0, behavior: 'passive', flee: 240,
    dna: 0, loot: { meat: 4, bone: 2 }, biomes: [T.GRASS],
  }, // пасутся на лугах
  crooked: {
    name: 'Горбун', faction: 'spirit', model: 'crooked', color: '#8a5a44', r: 17, hp: 90, speed: 152, dmg: 10, reach: 30, behavior: 'aggressive',
    aggro: 240, nightAggro: 400, dna: 2, loot: { meat: 3, bone: 4 }, spirit: 1, biomes: [T.FOREST, T.ROCK],
  }, // охотятся в лесах и скалах, ночью выходят к людям
  claw: {
    name: 'Когтень', faction: 'spirit', model: 'claw', color: '#7a4a3a', r: 18, hp: 130, speed: 162, dmg: 14, reach: 34, behavior: 'aggressive',
    aggro: 380, nightAggro: 440, dna: 10, loot: { meat: 3, bone: 4, crystal: 1 }, spirit: 3, attackCd: 1.0, biomes: [T.FOREST],
  }, // стаи у логов, чащи и воронки метеоритов
  wraith: {
    name: 'Лесной дух', faction: 'spirit', model: 'wraith', color: '#9fe8c8', r: 18, hp: 110, speed: 118, dmg: 8, reach: 26, behavior: 'guardian',
    aggro: 150, dna: 6, loot: { artifact: 0.15, glowcap: 0.5, bone: 2 }, spirit: 4, fly: true, attackCd: 1.2,
    shoot: { proj: 'drain', dmg: 11, cd: 2.4, speed: 520, life: 0.9, min: 70, range: 400 }, biomes: [T.FOREST],
  }, // стережёт чащу: мстит тем, кто рубит деревья и рвёт грибы
  glutton: {
    name: 'Утробник', faction: 'spirit', model: 'glutton', color: '#7a1c1c', r: 34, hp: 700, speed: 80, dmg: 30, reach: 40, behavior: 'territorial',
    aggro: 180, dna: 20, loot: { meat: 14, bone: 12, crystal: 3 }, spirit: 8, attackCd: 1.3, windup: 0.56, def: 0.2, biomes: [],
  }, // только в логовах
  spider: {
    name: 'Паук-страж', faction: 'tech', model: 'spider', color: '#ffb000', r: 20, hp: 120, speed: 168, dmg: 12, reach: 28, behavior: 'aggressive',
    aggro: 400, nightAggro: 400, dna: 0, loot: { scrap: 6, electronics: 2, data: 0.08 }, def: 0.15, biomes: [],
  },
  drone: {
    name: 'Дрон-око', faction: 'tech', model: 'drone', color: '#ff3b30', r: 15, hp: 70, speed: 150, dmg: 0, reach: 0, behavior: 'aggressive',
    aggro: 460, nightAggro: 460, dna: 0, loot: { scrap: 3, electronics: 3, cell: 4, data: 0.12 }, fly: true,
    shoot: { proj: 'laser', dmg: 9, cd: 1.5, speed: 1500, life: 0.5, min: 0, range: 430, keep: 230 }, biomes: [],
  },
  reaper: {
    name: 'Жнец', faction: 'tech', model: 'reaper', color: '#ffb000', r: 30, hp: 420, speed: 96, dmg: 26, reach: 40, behavior: 'aggressive',
    aggro: 360, nightAggro: 360, dna: 0, loot: { scrap: 20, electronics: 8, cell: 6, data: 1 }, attackCd: 1.2, windup: 0.5, def: 0.3, biomes: [],
  },
  mech: {
    name: 'Каратель', faction: 'tech', model: 'mech', color: '#ff3b30', r: 36, hp: 1100, speed: 84, dmg: 36, reach: 44, behavior: 'territorial',
    aggro: 480, dna: 0, loot: { scrap: 45, electronics: 25, cell: 20, data: 4, crystal: 3 }, attackCd: 1.4, windup: 0.6, def: 0.35,
    shoot: { proj: 'bullet', dmg: 13, cd: 0.55, speed: 1200, life: 0.6, min: 150, range: 620 }, biomes: [],
  },
};
// Проводник в мир духов: появляется только в трипе испытания, виден и уязвим лишь для того, кто его проходит
NPCS.guide = {
  name: 'Проводник', faction: 'spirit', model: 'guide', color: '#ffe08a', r: 18, hp: 70, speed: 128, dmg: 0, reach: 0, behavior: 'guide', flee: 210,
  dna: 0, loot: {}, spirit: 5, fly: true, biomes: [],
};
// сколько бродит по острову вне особых мест (охрана мест — в SITES)
export const NPC_TARGET = {
  stag: Math.round(150 * WILD_DENSITY), crooked: Math.round(45 * WILD_DENSITY),
  claw: Math.round(14 * WILD_DENSITY), wraith: Math.round(30 * WILD_DENSITY),
};
export const NIGHT_HUNTER = 'crooked'; // кто ночью выходит на охоту вокруг игроков
export const METEOR_GUARD = 'claw'; // кого приманивает упавший метеорит
export const NIGHT_STALKERS_PER_PLAYER = 5;
export const GUARDIAN_ALERT_R = 560; // на таком расстоянии духи слышат, что рубят их лес
export const EMP_TECH_MULT = 2.5; // ЭМИ бьёт по машинам сильнее и глушит их дольше

export const PLAYER = {
  startDna: 0, // мутаген на старте: мутации начинаются с облучения
  hungerRate: 0.12, // сытость 100 → 0 примерно за 14 минут (бегом быстрее)
  thirstRate: 0.15, // вода 100 → 0 примерно за 11 минут
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

// Прыжок на пробел. Игровая логика плоская (x, y), поэтому прыжок чисто зрелищный: сервер лишь
// помнит, что игрок «в воздухе» (time секунд), и рассылает флаг — все видят подскок по дуге высотой height.
export const JUMP = { time: 0.62, height: 26 };

export const PLAYER_COLORS = ['#6fbf73', '#4fa3e0', '#e0a34f', '#d9534f', '#b574e0', '#e0d24f', '#4fe0c8', '#e07bb5'];

// ---- Пути развития ----
// Путь выбирается навсегда первым изученным умением; сменить можно только полным сбросом.
// У каждого пути свои очки: знания (путь разума) и сила духа (путь духа).
export const PATHS = {
  mind: {
    name: 'Путь разума', icon: '🧠', pt: 'know', ptName: 'Знания', ptIcon: '📘', color: '#5ec8ff',
    desc: 'Наука и технологии: огнестрел, наниты, экзоскелет, лазеры, ЭМИ и автотурели.',
    trial: 'Найдите три части верстака, соберите его у алтаря выбора и создайте на нём оружие.',
    how: 'Носители данных 💾 из ящиков города, руин и рудников и из разбитых роботов изучаются в лаборатории; там же можно ставить опыты.',
  },
  spirit: {
    name: 'Путь духа', icon: '🔮', pt: 'spirit', ptName: 'Сила духа', ptIcon: '✨', color: '#c77dff',
    desc: 'Магия и тёмные силы: телекинез, телепорт, огненный шар, щит, вампиризм и проклятие ведьмы.',
    trial: 'Найдите мухомор, пейотль и сияющую жабу, съешьте их разом у алтаря выбора — и убейте в трипе проводников в мир духов.',
    how: 'Медитация у древних алтарей 🕯, артефакты 🔮 из логов утробников и победы над духами и мутантами леса. Заклинания тратят ману.',
  },
};
// kind: passive — действует всегда; unlock — открывает рецепт или постройку;
// spell — выбирается в поясе и применяется ЛКМ в точку под курсором; instant — срабатывает сразу по цифре
export const ABILITIES = {
  nanites: { path: 'mind', tier: 1, cost: 15, kind: 'passive', name: 'Регенеративные наниты', icon: '🩹', desc: 'Здоровье восстанавливается втрое быстрее, даже при облучении до 50', regenMul: 3, radRegen: 50 },
  exo: { path: 'mind', tier: 1, cost: 15, kind: 'passive', name: 'Экзоскелет', icon: '🦾', desc: '+20% к скорости и +15% к защите', speed: 1.2, def: 0.15 },
  laser: { path: 'mind', tier: 2, cost: 30, kind: 'unlock', name: 'Лазерная винтовка', icon: '🔦', desc: 'Рецепты лазерной винтовки и энергоячеек (в лаборатории)' },
  emp: { short: 'ЭМИ', path: 'mind', tier: 2, cost: 30, kind: 'instant', name: 'ЭМИ-импульс', icon: '⚡', desc: 'Волна вокруг: 30 урона и оглушение на 2,5 с всем врагам в 230 ед.; по машинам — в 2,5 раза сильнее', cd: 18, r: 230, dmg: 30, stun: 2.5 },
  genetics: { path: 'mind', tier: 3, cost: 50, kind: 'passive', name: 'Генная инженерия', icon: '🧬', desc: 'Предел мутаций 12 → 20, мутации на 30% дешевле, 3-й уровень без кристаллов', cap: 8, priceMul: 0.7 },
  turret: { path: 'mind', tier: 3, cost: 50, kind: 'unlock', name: 'Автотурель', icon: '🗼', desc: 'Постройка (B): сама стреляет по зверям и чужакам в 360 ед.' },
  telekinesis: { short: 'Телекинез', path: 'spirit', tier: 1, cost: 15, kind: 'spell', name: 'Телекинез', icon: '🌀', desc: 'Удар силой мысли: отшвыривает врага далеко назад', mana: 12, cd: 0.7, proj: 'force', speed: 950, life: 0.42, dmg: 12, kb: 560 },
  shield: { short: 'Щит', path: 'spirit', tier: 1, cost: 15, kind: 'instant', name: 'Щит духа', icon: '🛡', desc: 'Сияющая сфера поглощает 60 урона за 8 с', mana: 35, cd: 20, absorb: 60, time: 8 },
  fireball: { short: 'Огнешар', path: 'spirit', tier: 2, cost: 30, kind: 'spell', name: 'Огненный шар', icon: '🔥', desc: 'Взрывается: 35 урона по площади, жжёт постройки', mana: 18, cd: 0.9, proj: 'fireball', speed: 650, life: 1.0, dmg: 35, radius: 75, structDmg: 90 },
  blink: { short: 'Телепорт', path: 'spirit', tier: 2, cost: 30, kind: 'spell', name: 'Телепорт', icon: '✴️', desc: 'Мгновенный перенос в точку под курсором (до 480 ед.)', mana: 30, cd: 5, range: 480 },
  drain: { short: 'Вампиризм', path: 'spirit', tier: 3, cost: 50, kind: 'spell', name: 'Тёмный вампиризм', icon: '🩸', desc: 'Сгусток тьмы высасывает 18 здоровья из врага и лечит вас', mana: 20, cd: 1.1, proj: 'drain', speed: 720, life: 0.8, dmg: 18 },
  hex: { short: 'Порча', path: 'spirit', tier: 3, cost: 50, kind: 'spell', name: 'Проклятие ведьмы', icon: '💀', desc: 'Порча: 6 урона в секунду 6 с, замедление, цель получает на 25% больше урона', mana: 25, cd: 2.5, proj: 'hex', speed: 620, life: 0.9, dmg: 4, time: 6, dps: 6, vuln: 1.25 },
};
// ---- Испытания пути ----
// Путь выбирают у алтаря выбора (место shrine).
// Дух: принести гриб, кактус и жабу, съесть их разом — и за время трипа убить проводников в мир духов.
// Разум: принести три части верстака, собрать его у алтаря и создать на нём оружие (рецепт с trial).
export const TRIALS = {
  spirit: { items: ['amanita', 'peyote', 'toad'], guides: 3, time: 150, spread: [220, 480] },
  mind: { items: ['vise', 'toolkit', 'drive'], weapon: 'pistol' },
};
export const ABILITY_ORDER = Object.keys(ABILITIES);
export const TIER_NEED = [0, 0, 15, 45]; // сколько очков пути нужно вложить, чтобы открыть ступень
export const MANA = { base: 100, perAbility: 15, regen: 4, altarRegen: 12 };
export const SPIRIT_GAIN = { every: 2, altarCharge: 20, altarRefill: 600, artifact: 12 }; // за победы над духами — NPCS[...].spirit
export const KNOW_GAIN = { data: 5, experiment: { cost: { scrap: 10, crystal: 1 }, gain: 4 } };
export const LAB_RANGE = 130;
