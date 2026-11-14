/**
 * Синхронизация с GitHub: git add → commit → push с токеном из .env.local
 *
 *   npm run sync                     # авто-сообщение коммита
 *   npm run sync -- "текст коммита"  # своё сообщение
 *
 * Пушится та ветка, в которой вы работаете:
 *   • в main   → после пуша обновляются зеркальные ветки (в них вливается main);
 *   • в зеркале → в него подтягивается свежий main, если он ушёл вперёд.
 * Список зеркал — GIT_MIRROR_BRANCHES в .env.local (по умолчанию "moodle-plugin"),
 * поэтому ветка с плагином Moodle никогда не отстаёт от main и наоборот.
 * Так правки плагина не «протекают» в main, а main остаётся чистым редактором.
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
const tryRun = (args, opts = {}) => {
  try {
    return run(args, opts);
  } catch {
    return null;
  }
};
/** true/false вместо результата: у fetch и push пустой stdout, поэтому tryRun тут не годится. */
const attempt = (args, opts = {}) => {
  try {
    run(args, opts);
    return true;
  } catch {
    return false;
  }
};

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

const mask = (s) => s.replace(/gh[pousr]_[A-Za-z0-9]+/g, '***').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');

/**
 * Вливает основную ветку в зеркальную и пушит её.
 * Возвращает короткий отчёт для лога.
 */
function syncMirror(mirror, pushUrl, mainBranch) {
  const tracking = `refs/remotes/origin/${mirror}`;
  const localExists = () => !!tryRun(['rev-parse', '--verify', '--quiet', `refs/heads/${mirror}`]);

  // Забираем ветку с GitHub. Если её там нет — fetch упадёт, и мы создадим её из main.
  const fetched = attempt(['fetch', pushUrl, `+refs/heads/${mirror}:${tracking}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!fetched) {
    run(['checkout', '-q', '-B', mirror, mainBranch]);
    run(['push', pushUrl, `${mirror}:${mirror}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    return `создана из ${mainBranch}`;
  }

  if (localExists()) {
    run(['checkout', '-q', mirror]);
    // подтягиваем то, что уже лежит на GitHub, сохраняя локальные коммиты ветки
    const diverged = Number(tryRun(['rev-list', '--count', `HEAD..${tracking}`]) || 0);
    if (diverged > 0) {
      run(['merge', '-q', '--no-edit', '-m', `chore(sync): подтягиваю ${mirror} с GitHub`, tracking]);
    }
  } else {
    run(['checkout', '-q', '-B', mirror, tracking]);
  }

  const behind = Number(tryRun(['rev-list', '--count', `${mirror}..${mainBranch}`]) || 0);
  if (behind === 0) {
    return `уже актуальна (в ${mirror} есть все коммиты ${mainBranch})`;
  }

  try {
    run(['merge', '-q', '--no-edit', '-m', `chore(sync): ${mainBranch} → ${mirror}`, mainBranch]);
  } catch {
    tryRun(['merge', '--abort']);
    throw new Error(`конфликт при слиянии ${mainBranch} в ${mirror}: разрешите вручную, ветка не обновлена`);
  }

  run(['push', pushUrl, `${mirror}:${mirror}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  return `обновлена: влито ${behind} коммит(ов) из ${mainBranch}, HEAD ${run(['rev-parse', '--short', 'HEAD'])}`;
}

try {
  const env = await loadEnv();
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO || 'pavelb-coder/sim-2d';
  const branch = env.GIT_BRANCH || 'main';
  const mirrors = (env.GIT_MIRROR_BRANCHES ?? 'moodle-plugin')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!token) {
    console.error('Нет GITHUB_TOKEN: положите его в .env.local или в переменную окружения.');
    process.exit(1);
  }

  // чистый origin (без токена в .git/config)
  const cleanUrl = `https://github.com/${repo}.git`;
  try {
    run(['remote', 'set-url', 'origin', cleanUrl]);
  } catch {
    run(['remote', 'add', 'origin', cleanUrl]);
  }
  const pushUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
  const startBranch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  // Пушим ту ветку, в которой работаем, а не всегда в main: иначе правки плагина
  // из ветки moodle-plugin уехали бы в main, а он должен оставаться чистым (редактор).
  const target = startBranch === 'HEAD' ? branch : startBranch;
  const isMirrorBranch = target !== branch && mirrors.includes(target);

  run(['add', '-A']);
  const staged = run(['diff', '--cached', '--name-only']);
  let pushed = false;
  if (staged) {
    const files = staged.split('\n').length;
    const msg = process.argv.slice(2).join(' ') || `sync: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    run(['commit', '-m', msg]);
    console.log(`Коммит: ${msg}  (${files} файл(ов))`);
    pushed = true;
  } else {
    const ahead = Number(tryRun(['rev-list', '--count', `origin/${target}..HEAD`]) || 0);
    if (ahead > 0) {
      console.log(`Незапушенных коммитов: ${ahead} — отправляю.`);
      pushed = true;
    }
  }

  if (pushed) {
    run(['push', pushUrl, `HEAD:${target}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`Отправлено в ${repo} → ${target}: ${run(['rev-parse', '--short', 'HEAD'])}`);
  } else if (!isMirrorBranch) {
    console.log('Нечего синхронизировать: рабочее дерево чистое, локальных коммитов нет.');
  }

  if (isMirrorBranch) {
    // Работаем в ветке-зеркале: подтягиваем в неё main, если он ушёл вперёд.
    const tracking = 'refs/remotes/origin/main';
    attempt(['fetch', pushUrl, `+refs/heads/${branch}:${tracking}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const behind = Number(tryRun(['rev-list', '--count', `HEAD..${tracking}`]) || 0);
    if (behind === 0) {
      console.log(`Ветка ${target}: main уже влит, всё актуально.`);
    } else {
      try {
        run(['merge', '-q', '--no-edit', '-m', `chore(sync): ${branch} → ${target}`, tracking]);
        run(['push', pushUrl, `HEAD:${target}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        console.log(`Ветка ${target}: влито ${behind} коммит(ов) из ${branch}, HEAD ${run(['rev-parse', '--short', 'HEAD'])}`);
      } catch (err) {
        tryRun(['merge', '--abort']);
        throw new Error(`конфликт при слиянии ${branch} в ${target}: разрешите вручную`);
      }
    }
    process.exit(0);
  }

  // 2. Зеркальные ветки: всегда подтягиваем к свежему main
  const mirrorReports = [];
  const mirrorErrors = [];
  for (const mirror of mirrors) {
    if (mirror === branch) continue;
    try {
      mirrorReports.push(`${mirror}: ${syncMirror(mirror, pushUrl, branch)}`);
    } catch (err) {
      mirrorErrors.push(`${mirror}: ${mask(`${err?.stderr ?? ''}${err?.message ?? err}`).trim()}`);
    } finally {
      // возвращаемся туда, где были: работа продолжается в основной ветке
      if (run(['rev-parse', '--abbrev-ref', 'HEAD']) !== startBranch) {
        tryRun(['checkout', '-q', startBranch]);
      }
    }
  }
  for (const line of mirrorReports) {
    console.log(`Зеркало ${line}`);
  }
  if (mirrorErrors.length) {
    for (const line of mirrorErrors) {
      console.error(`Зеркало не обновлено — ${line}`);
    }
    process.exit(1);
  }
} catch (err) {
  const text = `${err?.stderr ?? ''}${err?.message ?? err}`;
  console.error('Ошибка синхронизации:', mask(text));
  process.exit(1);
}
