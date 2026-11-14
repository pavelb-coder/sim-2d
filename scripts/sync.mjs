/**
 * Синхронизация с GitHub: git add → commit → push с токеном из .env.local
 *
 *   npm run sync                     # авто-сообщение коммита
 *   npm run sync -- "текст коммита"  # своё сообщение
 *
 * Токен берётся из .env.local (в .gitignore) или из переменной окружения GITHUB_TOKEN.
 * В git-историю и в логи токен не попадает.
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const run = (args, opts = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();

async function loadEnv() {
  const env = { ...process.env };
  const file = resolve(root, '.env.local');
  if (existsSync(file)) {
    const text = await readFile(file, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const mask = (s) => s.replace(/gh[pousr]_[A-Za-z0-9]+/g, '***');

try {
  const env = await loadEnv();
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO || 'pavelb-coder/sim-2d';
  const branch = env.GIT_BRANCH || 'main';

  if (!token) {
    console.error('Нет GITHUB_TOKEN: положите его в .env.local или в переменную окружения.');
    process.exit(1);
  }

  // чистый origin (без токена в .git/config)
  const cleanUrl = `https://github.com/${repo}.git`;
  try { run(['remote', 'set-url', 'origin', cleanUrl]); } catch { run(['remote', 'add', 'origin', cleanUrl]); }

  run(['add', '-A']);
  const staged = run(['diff', '--cached', '--name-only']);
  if (!staged) {
    const ahead = Number(run(['rev-list', '--count', `origin/${branch}..HEAD`]) || 0);
    if (ahead === 0) {
      console.log('Нечего синхронизировать: рабочее дерево чистое, локальных коммитов нет.');
      process.exit(0);
    }
    console.log(`Незапушенных коммитов: ${ahead} — отправляю.`);
  } else {
    const files = staged.split('\n').length;
    const msg = process.argv.slice(2).join(' ') || `sync: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    run(['commit', '-m', msg]);
    console.log(`Коммит: ${msg}  (${files} файл(ов))`);
  }

  const pushUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
  run(['push', pushUrl, `HEAD:${branch}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const sha = run(['rev-parse', '--short', 'HEAD']);
  console.log(`Отправлено в ${repo} → ${branch}: ${sha}`);
} catch (err) {
  const text = `${err?.stderr ?? ''}${err?.message ?? err}`;
  console.error('Ошибка синхронизации:', mask(text));
  process.exit(1);
}
