/**
 * Кроссплатформенный статический сервер для собранного приложения.
 * Без зависимостей — работает на Windows, Ubuntu и macOS.
 *
 *   node scripts/serve.mjs            # порт 8084
 *   PORT=9000 node scripts/serve.mjs  # свой порт
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const PORT = Number(process.env.PORT || 8084);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

try {
  await stat(resolve(ROOT, 'index.html'));
} catch {
  console.error('Нет сборки: site/index.html не найден.');
  console.error('Сначала выполните:  npm run build');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + sep) && file !== ROOT) {
    res.writeHead(403).end('403');
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(301, { Location: pathname + '/' }).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(
      '<!doctype html><meta charset="utf-8"><title>404</title><body style="font:16px system-ui;padding:40px">' +
        '<p>404 — не найдено</p><p><a href="/">Открыть редактор</a></p>',
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LaserCut Studio: http://localhost:${PORT}  (bind ${HOST}:${PORT})`);
  console.log('Остановить: Ctrl+C');
});
