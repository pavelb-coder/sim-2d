#!/usr/bin/env node
/**
 * Статическая проверка плагина Moodle без установленного Moodle.
 *
 * Что проверяется:
 *  1. синтаксис всех PHP-файлов (нужен php в PATH, иначе шаг пропускается);
 *  2. корректность XML (install.xml, SVG-иконки);
 *  3. version.php: компонент совпадает с путём, версия целая, есть requires/release;
 *  4. все get_string('...', 'mod_lasercutstudio') есть в lang/en и lang/ru;
 *  5. наборы строк en и ru совпадают;
 *  6. все используемые возможности (mod/lasercutstudio:xxx) объявлены в db/access.php;
 *  7. все таблицы из $DB-запросов объявлены в db/install.xml;
 *  8. сборка редактора editor/index.html на месте и совпадает с site/index.html по sha256;
 *  9. в «библиотечных» файлах есть защита defined('MOODLE_INTERNAL') || die();
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const plugin = 'moodle/mod/lasercutstudio';
const errors = [];
const warnings = [];
const ok = [];

const walk = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
};

const files = await walk(plugin);
const phpFiles = files.filter((f) => f.endsWith('.php'));
const read = (f) => readFile(f, 'utf8');

/* ---------- 1. PHP-синтаксис ---------- */
const phpAvailable = spawnSync('php', ['-v'], { encoding: 'utf8' }).status === 0;
if (!phpAvailable) {
  warnings.push('php не найден в PATH — проверка синтаксиса пропущена (поставьте php-cli)');
} else {
  for (const file of phpFiles) {
    const res = spawnSync('php', ['-l', file], { encoding: 'utf8' });
    if (res.status !== 0) errors.push(`PHP-синтаксис: ${file}\n${res.stdout || res.stderr}`);
  }
  ok.push(`php -l: ${phpFiles.length} файл(ов) без ошибок`);
}

/* ---------- 2. XML ---------- */
const xmlFiles = files.filter((f) => f.endsWith('.xml') || f.endsWith('.svg'));
const xmlCheck = spawnSync('python3', ['-c', `
import sys, xml.dom.minidom
bad = 0
for p in sys.argv[1:]:
    try:
        xml.dom.minidom.parse(p)
    except Exception as exc:
        print(f'{p}: {exc}')
        bad = 1
sys.exit(bad)
`, ...xmlFiles], { encoding: 'utf8' });
if (xmlCheck.status !== 0) errors.push(`XML: ${xmlCheck.stdout.trim()}`);
else ok.push(`XML/SVG: ${xmlFiles.length} файл(ов) корректны`);

/* ---------- 3. version.php ---------- */
const version = await read(`${plugin}/version.php`);
const component = version.match(/\$plugin->component\s*=\s*'([^']+)'/)?.[1];
const expectedComponent = 'mod_' + path.basename(plugin);
if (component !== expectedComponent) {
  errors.push(`version.php: component '${component}' ≠ ожидаемого '${expectedComponent}'`);
} else ok.push(`component: ${component}`);
if (!/\$plugin->version\s*=\s*\d+;/.test(version)) errors.push('version.php: $plugin->version должен быть целым числом');
if (!/\$plugin->requires\s*=\s*\d+;/.test(version)) errors.push('version.php: не задан $plugin->requires');
if (!/\$plugin->release\s*=\s*'[^']+'/.test(version)) errors.push('version.php: не задан $plugin->release');

/* ---------- 4-5. строки ---------- */
const langOf = async (lang) => {
  const src = await read(`${plugin}/lang/${lang}/lasercutstudio.php`);
  return new Set([...src.matchAll(/\$string\['([^']+)'\]/g)].map((m) => m[1]));
};
const en = await langOf('en');
const ru = await langOf('ru');
const missingRu = [...en].filter((k) => !ru.has(k));
const extraRu = [...ru].filter((k) => !en.has(k));
if (missingRu.length) errors.push(`lang/ru: нет строк ${missingRu.join(', ')}`);
if (extraRu.length) warnings.push(`lang/ru: лишние строки ${extraRu.join(', ')}`);

const used = new Set();
for (const file of phpFiles) {
  const src = await read(file);
  for (const m of src.matchAll(/get_string\(\s*'([^']+)'\s*,\s*'mod_lasercutstudio'/g)) used.add(m[1]);
  for (const m of src.matchAll(/string_exists\(\s*'([^']+)'\s*,\s*'mod_lasercutstudio'/g)) used.add(m[1]);
}
const missingStrings = [...used].filter((k) => !en.has(k));
if (missingStrings.length) errors.push(`get_string без языковой строки: ${missingStrings.join(', ')}`);
else ok.push(`get_string: ${used.size} ключей найдены в lang/en`);

/* ---------- 6. возможности ---------- */
const access = await read(`${plugin}/db/access.php`);
const declared = new Set([...access.matchAll(/'(mod\/lasercutstudio:[a-z]+)'\s*=>/g)].map((m) => m[1]));
const usedCaps = new Set();
for (const file of phpFiles) {
  if (file.endsWith('db/access.php')) continue; // объявления, а не использование
  const src = await read(file);
  for (const m of src.matchAll(/'(mod\/lasercutstudio:[a-z]+)'/g)) usedCaps.add(m[1]);
}
const unknownCaps = [...usedCaps].filter((c) => !declared.has(c));
if (unknownCaps.length) errors.push(`неизвестные возможности: ${unknownCaps.join(', ')}`);
const unusedCaps = [...declared].filter((c) => !usedCaps.has(c) && c !== 'mod/lasercutstudio:addinstance');
if (unusedCaps.length) warnings.push(`объявлены, но не используются в коде: ${unusedCaps.join(', ')}`);
if (!unknownCaps.length) ok.push(`capabilities: ${declared.size} объявлено, ${usedCaps.size} используется`);

/* ---------- 7. таблицы ---------- */
const install = await read(`${plugin}/db/install.xml`);
const tables = new Set([...install.matchAll(/<TABLE NAME="([^"]+)"/g)].map((m) => m[1]));
const usedTables = new Set();
for (const file of phpFiles) {
  if (file.endsWith('db/install.xml')) continue;
  const src = await read(file);
  for (const m of src.matchAll(/\$DB->[a-z_]+\(\s*'(lasercutstudio[a-z_]*)'/g)) usedTables.add(m[1]);
  for (const m of src.matchAll(/\{\s*(lasercutstudio[a-z_]*)\s*\}/g)) usedTables.add(m[1]);
}
const unknownTables = [...usedTables].filter((t) => !tables.has(t));
if (unknownTables.length) errors.push(`таблицы не объявлены в install.xml: ${unknownTables.join(', ')}`);
else ok.push(`таблицы: ${[...tables].join(', ')}`);

/* ---------- 8. сборка редактора ---------- */
const editorPath = `${plugin}/editor/index.html`;
try {
  const editor = await readFile(editorPath);
  const site = await readFile('site/index.html');
  const same = createHash('sha256').update(editor).digest('hex') === createHash('sha256').update(site).digest('hex');
  if (!same) warnings.push('editor/index.html отличается от site/index.html — пересоберите: npm run moodle:editor');
  ok.push(`editor/index.html: ${(editor.length / 1024).toFixed(1)} КБ`);
} catch {
  errors.push('нет editor/index.html — выполните npm run build && npm run moodle:editor');
}
try {
  await stat(`${plugin}/js/parent.js`);
  await stat(`${plugin}/editor/bridge.js`);
} catch {
  errors.push('нет js/parent.js или editor/bridge.js');
}

/* ---------- 9. защита MOODLE_INTERNAL ---------- */
const needsGuard = phpFiles.filter((f) =>
  /\/(classes|db|backup|lang)\//.test(f) || /(lib|mod_form)\.php$/.test(f));
for (const file of needsGuard) {
  const src = await read(file);
  if (!src.includes("defined('MOODLE_INTERNAL') || die();")) {
    errors.push(`${file}: нет defined('MOODLE_INTERNAL') || die();`);
  }
}
ok.push(`защита MOODLE_INTERNAL: проверено ${needsGuard.length} файл(ов)`);

/* ---------- отчёт ---------- */
console.log('Проверка плагина mod_lasercutstudio\n');
for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ! ${line}`);
for (const line of errors) console.log(`  ✗ ${line}`);

if (errors.length) {
  console.error(`\n${errors.length} ошибк(и) — плагин не готов к установке`);
  process.exit(1);
}
console.log(`\nОшибок нет${warnings.length ? `, предупреждений: ${warnings.length}` : ''}. Плагин готов.`);
