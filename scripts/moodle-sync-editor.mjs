#!/usr/bin/env node
/**
 * Копирует собранный редактор (site/index.html) в плагин Moodle.
 * Запуск: npm run moodle:editor  (перед этим при необходимости npm run build)
 */
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const src = 'site/index.html';
const dir = 'moodle/mod/lasercutstudio/editor';
const dst = `${dir}/index.html`;

try {
  await stat(src);
} catch {
  console.error(`Нет ${src} — сначала выполните: npm run build`);
  process.exit(1);
}

await mkdir(dir, { recursive: true });
await copyFile(src, dst);

const html = await readFile(dst);
const hash = createHash('sha256').update(html).digest('hex').slice(0, 12);
const kb = (html.length / 1024).toFixed(1);

const meta = {
  generated: true,
  source: src,
  bytes: html.length,
  sha256: hash,
  note: 'Файл собирается скриптом scripts/moodle-sync-editor.mjs и не редактируется вручную.',
};
await writeFile(`${dir}/index.json`, JSON.stringify(meta, null, 2) + '\n');

console.log(`editor/index.html: ${kb} КБ, sha256 ${hash}`);
console.log('Плагин готов: скопируйте moodle/mod/lasercutstudio в {moodle}/mod/lasercutstudio');
