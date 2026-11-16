/**
 * Синхронизация с GitHub: git add → commit → push с токеном из .env.local
 *
 *   npm run sync                     # авто-сообщение коммита
 *   npm run sync -- "текст коммита"  # своё сообщение
 *
 * Порядок всегда один и тот же — СНАЧАЛА main, ПОТОМ ветка Moodle:
 *   • работаете в main   → 1) пуш main, 2) вливание main в зеркала и их пуш;
 *   • работаете в зеркале → 1) подтягиваем свежий main, 2) пуш зеркала.
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
  tryRun(['update-ref', tracking, 'HEAD']);
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

  // ---------------------------------------------------------------- коммит
  run(['add', '-A']);
  const staged = run(['diff', '--cached', '--name-only']);
  let committed = false;
  if (staged) {
    const files = staged.split('\n').length;
    const msg = process.argv.slice(2).join(' ') || `sync: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    run(['commit', '-m', msg]);
    console.log(`Коммит: ${msg}  (${files} файл(ов))`);
    committed = true;
  }

  /** Вливает ref в текущую ветку, если он ушёл вперёд. Возвращает число коммитов. */
  const mergeIfBehind = (ref, message) => {
    const behind = Number(tryRun(['rev-list', '--count', `HEAD..${ref}`]) || 0);
    if (behind === 0) return 0;
    try {
      run(['merge', '-q', '--no-edit', '-m', `chore(sync): ${message}`, ref]);
    } catch {
      tryRun(['merge', '--abort']);
      throw new Error(`конфликт при слиянии ${ref} — разрешите вручную, ничего не отправлено`);
    }
    return behind;
  };

  /** Обновляет локальную ссылку на ветку GitHub. */
  const fetchBranch = (name) =>
    attempt(['fetch', pushUrl, `+refs/heads/${name}:refs/remotes/origin/${name}`],
      { stdio: ['ignore', 'pipe', 'pipe'] });

  const pushBranch = (name) => {
    run(['push', pushUrl, `HEAD:${name}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    // свои же пуш идёт по URL, поэтому ссылка origin/* сама не обновится
    tryRun(['update-ref', `refs/remotes/origin/${name}`, 'HEAD']);
    return run(['rev-parse', '--short', 'HEAD']);
  };

  // ------------------------------------------- 1. СНАЧАЛА main, потом зеркала
  if (!isMirrorBranch) {
    const ahead = committed
      ? 1
      : Number(tryRun(['rev-list', '--count', `origin/${branch}..HEAD`]) || 0);
    if (ahead > 0) {
      console.log(`1) ${branch}: отправляю ${pushBranch(branch)}`);
    } else {
      console.log(`1) ${branch}: нечего отправлять, ветка актуальна`);
    }

    const mirrorReports = [];
    const mirrorErrors = [];
    for (const mirror of mirrors) {
      if (mirror === branch) continue;
      try {
        mirrorReports.push(`${mirror}: ${syncMirror(mirror, pushUrl, branch)}`);
      } catch (err) {
        mirrorErrors.push(`${mirror}: ${mask(`${err?.stderr ?? ''}${err?.message ?? err}`).trim()}`);
      } finally {
        if (run(['rev-parse', '--abbrev-ref', 'HEAD']) !== startBranch) {
          tryRun(['checkout', '-q', startBranch]);
        }
      }
    }
    for (const line of mirrorReports) {
      console.log(`2) зеркало ${line}`);
    }
    if (mirrorErrors.length) {
      for (const line of mirrorErrors) {
        console.error(`2) зеркало не обновлено — ${line}`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // Работаем в зеркальной ветке: тот же порядок — свежий main, затем своя ветка.
  fetchBranch(target);
  mergeIfBehind(`origin/${target}`, `подтягиваю ${target} с GitHub`);

  const mainFetched = fetchBranch(branch);
  const mainMerged = mainFetched ? mergeIfBehind(`origin/${branch}`, `${branch} → ${target}`) : 0;
  if (!mainFetched) {
    console.warn(`! ${branch} не удалось получить с GitHub — обновляю только ${target}`);
  } else if (mainMerged > 0) {
    console.log(`1) ${branch}: подтянут, влито ${mainMerged} коммит(ов)`);
  } else {
    console.log(`1) ${branch}: новых коммитов нет`);
  }

  const ahead = committed
    ? 1
    : Number(tryRun(['rev-list', '--count', `origin/${target}..HEAD`]) || 0);

  if (ahead > 0) {
    console.log(`2) ${target}: отправлено ${pushBranch(target)}`);
  } else {
    console.log(`2) ${target}: нечего отправлять, ветка актуальна`);
  }
  process.exit(0);
} catch (err) {
  const text = `${err?.stderr ?? ''}${err?.message ?? err}`;
  console.error('Ошибка синхронизации:', mask(text));
  process.exit(1);
}
