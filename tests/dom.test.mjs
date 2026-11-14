/**
 * Интеграционный smoke-тест: приложение целиком в эмуляции DOM.
 * Цель — поймать ошибки рантайма (canvas/DPR/события/панели), не открывая браузер.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

/* ---------- заглушки браузерных API, которых нет в jsdom ---------- */
const ctxMock = () =>
  new Proxy(
    { canvas: null },
    {
      get(target, key) {
        if (key in target) return target[key];
        return () => undefined;
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );

window.HTMLCanvasElement.prototype.getContext = function getContext() {
  return ctxMock();
};
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0, toJSON() {} };
};
window.Element.prototype.setPointerCapture = () => undefined;
window.Element.prototype.releasePointerCapture = () => undefined;
window.devicePixelRatio = 2;
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.Path2D = class Path2D {
  moveTo() {} lineTo() {} bezierCurveTo() {} arc() {} closePath() {} rect() {} roundRect() {}
};

const g = globalThis;
g.window = window;
g.document = window.document;
for (const key of ['Path2D', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLElement', 'HTMLCanvasElement', 'Node']) {
  try {
    Object.defineProperty(g, key, { value: window[key], configurable: true, writable: true });
  } catch {
    /* игнорируем read-only свойства */
  }
}
try {
  Object.defineProperty(g, 'navigator', { value: window.navigator, configurable: true });
} catch {
  /* не критично */
}

/* ---------- запуск приложения ---------- */
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
process.on('uncaughtException', (e) => errors.push(String(e)));

await import('./_main.mjs');

const $ = (sel) => window.document.querySelector(sel);
const text = (sel) => $(sel)?.textContent ?? '';
const count = () => text('#st-count');
const ok = (cond, msg) => {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`  ✓ ${msg}`);
};

const pointer = (type, x, y, extra = {}) => {
  const ev = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...extra });
  $('#overlay').dispatchEvent(ev);
};
const key = (k, extra = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

console.log('dom / boot');

ok(window.document.querySelectorAll('.tool-btn').length === 6, 'панель инструментов: 6 кнопок');
const N0 = Number(count().replace(/\D+/g, ''));
ok(N0 >= 5, `демо-документ загружен (${count()})`);
ok(text('#st-sheet').includes('300'), `лист в мм: ${text('#st-sheet')}`);
ok($('#btn-undo').disabled === true, 'undo изначально недоступен (история пуста)');

console.log('draw');

$('.tool-btn[data-tool="rect"]').click();
ok($('.tool-btn[data-tool="rect"]').classList.contains('is-active'), 'инструмент «прямоугольник» активен');

pointer('pointerdown', 400, 300);
pointer('pointermove', 520, 400);
pointer('pointerup', 520, 400);
ok(count().includes(String(N0 + 1)), `прямоугольник создан (${count()})`);
ok(!$('#btn-undo').disabled, 'undo стал доступен после создания');

const propW = $('#prop-w');
ok($('#props-body').hidden === false, 'панель свойств показывает новый объект');
ok(Number(propW.value) > 0, `ширина нового объекта = ${propW.value} мм`);

console.log('undo / redo');
key('z', { ctrlKey: true });
ok(count().includes(String(N0)), `undo убрал объект (${count()})`);
key('z', { ctrlKey: true, shiftKey: true });
ok(count().includes(String(N0 + 1)), `redo вернул объект (${count()})`);

console.log('selection / delete');
key('a', { ctrlKey: true });
ok($('#props-body').hidden === false, 'Ctrl+A выделил объекты');
const before = Number(count().replace(/\D+/g, ''));
$('#btn-delete').click();
ok(count().includes('0'), `удаление выделенного (${before} → ${count()})`);
key('z', { ctrlKey: true });
ok(!count().includes('0'), `undo вернул удалённое (${count()})`);

console.log('nudge / geometry panel');
key('a', { ctrlKey: true });
const x0 = Number($('#prop-x').value);
key('ArrowRight', {});
ok(Math.abs(Number($('#prop-x').value) - (x0 + 1)) < 0.01, `стрелка сдвигает на 1 мм (${x0} → ${$('#prop-x').value})`);

console.log('line tool + snap');
$('.tool-btn[data-tool="line"]').click();
pointer('pointerdown', 200, 600);
pointer('pointermove', 320, 600);
pointer('pointerup', 320, 600);
ok($('#row-length').hidden === false, `инструмент «линия» показал длину: ${text('#prop-len')}`);

console.log('sheet / zoom');
const preset = $('#sheet-preset');
preset.value = '420x297';
preset.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(text('#st-sheet').includes('420'), `формат листа применён: ${text('#st-sheet')}`);
$('#btn-zoom-in').click();
ok(text('#zoom-val').endsWith('%'), `зум: ${text('#zoom-val')}`);

if (errors.length) {
  console.error('\nошибки рантайма:', errors);
  process.exitCode = 1;
} else {
  console.log('\nошибок рантайма нет');
}
