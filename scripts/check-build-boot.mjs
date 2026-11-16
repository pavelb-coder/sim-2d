/**
 * Проверка собранного одного файла: `site/index.html` открывается как есть,
 * без сборщика и модулей. Ловит ровно тот класс ошибок, который не видят
 * остальные тесты (они импортируют JS отдельно): синтаксис бандла после
 * инлайна, падение при старте, неинициализированные панели.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

// можно передать путь (например, копию редактора внутри плагина)
const target = process.argv[2] ?? new URL('../site/index.html', import.meta.url);
const html = readFileSync(target, 'utf8');
const errors = [];
const logs = [];
const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  runScripts: 'dangerously',
  url: 'https://lasercut.test/',
  beforeParse(window) {
    const ctxMock = () => new Proxy({ canvas: null }, {
      get(t, k) { if (k in t) return t[k]; return () => undefined; },
      set(t, k, v) { t[k] = v; return true; },
    });
    window.HTMLCanvasElement.prototype.getContext = function () {
      const m = ctxMock();
      m.canvas = this;
      m.createLinearGradient = () => ({ addColorStop() {} });
      m.createRadialGradient = () => ({ addColorStop() {} });
      return m;
    };
    window.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0, toJSON() {} });
    window.Element.prototype.setPointerCapture = () => undefined;
    window.Element.prototype.releasePointerCapture = () => undefined;
    window.devicePixelRatio = 2;
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.Path2D = class Path2D { moveTo() {} lineTo() {} bezierCurveTo() {} arc() {} closePath() {} rect() {} roundRect() {} };
    window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
    const origError = window.console.error;
    window.console.error = (...a) => { logs.push(a.join(' ')); origError(...a); };
  },
});

await new Promise((r) => setTimeout(r, 800));
const w = dom.window;
const doc = w.document;
const checks = [];
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${msg}`);
  }
  checks.push(cond);
};

ok(errors.length === 0, `нет ошибок при загрузке${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
ok(typeof w.lcx === 'object', 'приложение инициализировалось (window.lcx на месте)');
ok(doc.querySelectorAll('.tool-btn').length === 8, `панель инструментов: ${doc.querySelectorAll('.tool-btn').length} кнопок`);
ok(doc.querySelectorAll('aside.panel .pblock').length === 14, 'все 14 блоков панели на месте');
ok(doc.querySelectorAll('h2.phead').length === 14, 'заголовки блоков стали кнопками (докеры работают)');
ok([...doc.querySelectorAll('.pblock')].every((b) => b.children.length > 1), 'содержимое блоков не потерялось');
ok(!!doc.getElementById('panels-expand') && !!doc.getElementById('panels-collapse'), 'кнопки «свернуть/развернуть всё» на месте');
ok((w.lcx?.store?.state?.doc?.order?.length ?? 0) > 0, 'демо-документ загружен');
ok(logs.length === 0, `console.error пуст${logs.length ? `: ${logs[0]}` : ''}`);

// собираем настоящий файл — синтаксис инлайн-скриптов обязан быть валидным
const scripts = [...doc.querySelectorAll('script:not([src])')].map((s) => s.textContent ?? '');
ok(scripts.length >= 2, `инлайн-скриптов в файле: ${scripts.length}`);
ok(!html.includes('<script type="module" src='), 'в файле не осталось заглушек dev-режима');

console.log(process.exitCode ? '\nсборка не загружается' : `\n${String(target).split('/').slice(-2).join('/')} загружается без ошибок`);
