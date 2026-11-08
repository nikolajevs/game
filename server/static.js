// Раздача статики: страница игры, общие модули и Three.js из node_modules.
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createStaticHandler(root) {
  const routes = [
    ['/vendor/three/', path.join(root, 'node_modules', 'three', 'build')],
    ['/shared/', path.join(root, 'shared')],
    ['/', path.join(root, 'public')],
  ];
  return function handle(req, res) {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (p === '/') p = '/index.html';
    for (const [prefix, dir] of routes) {
      if (!p.startsWith(prefix)) continue;
      const file = path.join(dir, p.slice(prefix.length));
      // защита от выхода за пределы папки (../)
      if (file !== dir && !file.startsWith(dir + path.sep)) break;
      return fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Не найдено');
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
      });
    }
    res.writeHead(404);
    res.end();
  };
}
