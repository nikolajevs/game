// Точка входа: HTTP-сервер со страницей игры + WebSocket для игроков.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_RATE, MAP_W, MAP_H, T } from '../shared/config.js';
import { generateMap } from '../shared/worldgen.js';
import { Game } from './game.js';
import { createStaticHandler } from './static.js';
import { loadWorld, saveWorld } from './persist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const SAVE_FILE = path.join(ROOT, 'data', 'world.json');

// Новый мир: подбираем зерно, при котором остров не слишком мал и не слишком велик
function pickSeed() {
  if (process.env.SEED) return Number(process.env.SEED) || 1337;
  for (let i = 0; i < 20; i++) {
    const seed = Math.floor(Math.random() * 1e9);
    const tiles = generateMap(seed);
    let land = 0;
    let rock = 0;
    for (const t of tiles) {
      if (t >= T.SAND) land++;
      if (t === T.ROCK) rock++;
    }
    const frac = land / (MAP_W * MAP_H);
    if (frac > 0.38 && frac < 0.56 && rock / land < 0.25) return seed;
  }
  return 1337;
}

let saved = process.env.FRESH ? null : loadWorld(SAVE_FILE);
let note = '';
// Сохранение со старым размером карты: остров другой, поэтому постройки не переносим,
// а геномы и вещи игроков оставляем (они появятся заново на новом острове)
if (saved && saved.mapW !== MAP_W) {
  const profiles = (saved.profiles || []).map(([token, prof]) => [token, { ...prof, alive: false }]);
  saved = { profiles };
  note = ' — карта сменилась, постройки сброшены, игроки сохранены';
}
const seed = saved?.seed ?? pickSeed();
const game = new Game(seed, saved);
console.log(saved?.seed ? `Загружен сохранённый мир (зерно ${seed})` : `Создан новый мир (зерно ${seed})${note}`);

const server = http.createServer(createStaticHandler(ROOT));
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const client = game.addClient(ws);
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    try {
      game.handle(client, msg);
    } catch (e) {
      console.error('Ошибка обработки сообщения:', e);
    }
  });
  ws.on('close', () => game.removeClient(client));
  ws.on('error', () => {});
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    game.tick(dt);
  } catch (e) {
    console.error('Ошибка такта симуляции:', e);
  }
}, 1000 / TICK_RATE);

function save() {
  try {
    saveWorld(SAVE_FILE, game.serialize());
  } catch (e) {
    console.error('Не удалось сохранить мир:', e);
  }
}
setInterval(save, 30_000);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    save();
    console.log('Мир сохранён. Пока!');
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`Мутаген запущен: http://localhost:${PORT}`);
});
