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
import { AuthError, AuthStore } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const SAVE_FILE = path.join(ROOT, 'data', 'world.json');
const AUTH_FILE = path.join(ROOT, 'data', 'accounts.json');
const auth = new AuthStore(AUTH_FILE);

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
const game = new Game(seed, saved, auth);
console.log(saved?.seed ? `Загружен сохранённый мир (зерно ${seed})` : `Создан новый мир (зерно ${seed})${note}`);

const serveStatic = createStaticHandler(ROOT);

function respondJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new AuthError('Слишком большой запрос.', 413);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new AuthError('Некорректный запрос.');
  }
}

async function handleAuth(req, res, pathname) {
  if (req.method !== 'POST') return respondJson(res, 405, { error: 'Метод не поддерживается.' });
  try {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AuthError('Некорректный запрос.');
    }
    if (pathname === '/api/auth/register') {
      const account = await auth.register(body.username, body.password);
      if (typeof body.legacyToken === 'string') game.linkProfile(body.legacyToken, account.token);
      return respondJson(res, 201, account);
    }
    if (pathname === '/api/auth/login') {
      return respondJson(res, 200, await auth.login(body.username, body.password));
    }
    if (pathname === '/api/auth/session') {
      const account = auth.session(body.token);
      if (!account) return respondJson(res, 401, { error: 'Сессия не найдена.' });
      return respondJson(res, 200, account);
    }
    return respondJson(res, 404, { error: 'Маршрут не найден.' });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    if (status === 500) console.error('Ошибка учётной записи:', error);
    return respondJson(res, status, { error: status === 500 ? 'Не удалось сохранить учётную запись.' : error.message });
  }
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (pathname.startsWith('/api/auth/')) return handleAuth(req, res, pathname);
  serveStatic(req, res);
});
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
