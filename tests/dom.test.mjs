/**
 * Интеграционный smoke-тест: приложение целиком в эмуляции DOM.
 * Цель — поймать ошибки рантайма (canvas/DPR/события/панели), не открывая браузер.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
// url нужен, чтобы работал localStorage (на about:blank он запрещён как opaque origin)
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', url: 'http://localhost/' });
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

/** записи вызовов clearRect — проверяем, что чистится весь буфер (HiDPI) */
const clearCalls = [];
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const canvas = this;
  const m = ctxMock();
  m.canvas = canvas;
  m.clearRect = (...args) => { clearCalls.push({ canvas, args }); };
  const gradientStub = () => ({ addColorStop() {} });
  m.createLinearGradient = gradientStub;
  m.createRadialGradient = gradientStub;
  return m;
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

/* ---------- шрифт для инструмента «Текст» (в сборке он инлайнится в HTML) ---------- */
try {
  const ttf = readFileSync(new URL('../assets/fonts/DejaVuSans-subset.ttf', import.meta.url));
  window.__LASERCUT_FONT__ = ttf.toString('base64');
  globalThis.__LASERCUT_FONT__ = window.__LASERCUT_FONT__;
} catch {
  console.warn('шрифт не найден — тест инструмента «Текст» будет пропущен');
}

/* ---------- запуск приложения ---------- */
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
process.on('uncaughtException', (e) => {
  // не глотаем фатальные ошибки молча: без этого падение при старте выглядело как «пустой» тест
  console.error('  ! uncaught:', String(e));
  if (e && e.stack) console.error(String(e.stack).split('\n').slice(0, 8).join('\n'));
  errors.push(String(e));
});

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

ok(window.document.querySelectorAll('.tool-btn').length === 9, 'панель инструментов: 9 кнопок (включая многоугольник, звезду и паз)');
const N0 = Number(count().replace(/\D+/g, ''));
ok(N0 >= 5, `демо-документ загружен (${count()})`);
ok(text('#st-sheet').includes('300'), `лист в мм: ${text('#st-sheet')}`);
ok($('#btn-undo').disabled === true, 'undo изначально недоступен (история пуста)');

console.log('сборка одного файла');

// Сборка вставляет бандл в HTML через String.replace. Один раз `$&` внутри
// минифицированного кода раскрылся в строку-заглушку тега script — файл перестал
// исполняться, а тесты этого не видели (они импортируют JS отдельно).
const inlineScripts = [...window.document.querySelectorAll('script:not([src])')]
  .map((el) => el.textContent ?? '')
  .filter((t) => t.includes('use strict'));
ok(inlineScripts.length === 1, `в сборке ровно один инлайн-скрипт приложения (${inlineScripts.length})`);
let bundleParses = true;
try {
  new Function(inlineScripts[0]);
} catch (e) {
  bundleParses = false;
  console.error(`    синтаксис бандла: ${e.message}`);
}
ok(bundleParses, 'инлайн-бандл парсится как JavaScript');
ok(!html.includes('<script type="module" src='), 'в сборке нет заглушки dev-режима script src');

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


console.log('перерисовка: очистка всего буфера (нет следов при панораме)');
$('#btn-zoom-in').click();
await new Promise((r) => setTimeout(r, 80));
const sceneCanvas = window.document.getElementById('scene');
const overlayCanvas = window.document.getElementById('overlay');
for (const [name, canvas] of [['сцена', sceneCanvas], ['оверлей', overlayCanvas]]) {
  const rec = clearCalls.filter((c) => c.canvas === canvas).pop();
  ok(!!rec, `${name} перерисовалась`);
  ok(rec.args[2] === canvas.width && rec.args[3] === canvas.height,
    `${name}: очистка на весь буфер ${rec.args[2]}×${rec.args[3]} при буфере ${canvas.width}×${canvas.height}`);
}

console.log('панели: статистика и слои');
ok(window.document.querySelectorAll('#stats .stat-line').length >= 2, `статистика по слоям: ${window.document.querySelectorAll('#stats .stat-line').length} строки`);
ok(text('#stats').includes('Рез'), 'в статистике есть строка «Рез»');
ok($('#layer-seg').querySelectorAll('.seg-btn').length === 2, 'переключатель слоёв: рез / гравировка');

console.log('булевы операции');
const store = window.lcx.store;
const num = () => Number(count().replace(/\D+/g, ''));
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 300, 300);
pointer('pointermove', 400, 400);
pointer('pointerup', 400, 400);
const idA = store.state.selection[0];
pointer('pointerdown', 350, 350);
pointer('pointermove', 450, 450);
pointer('pointerup', 450, 450);
const idB = store.state.selection[0];
ok(idA !== idB, 'созданы два пересекающихся прямоугольника');
const beforeUnion = num();
store.select([idA, idB]);
$('#op-union').click();
ok(num() === beforeUnion - 1, `сварка: ${beforeUnion} → ${num()} объектов`);
key('z', { ctrlKey: true });
ok(num() === beforeUnion, `undo вернул оба прямоугольника (${num()})`);

console.log('поворот и зеркало');
store.select([idA]);
const w0 = Number($('#prop-w').value);
const h0 = Number($('#prop-h').value);
$('#tr-rot90').click();
ok(Math.abs(Number($('#prop-w').value) - h0) < 0.01 && Math.abs(Number($('#prop-h').value) - w0) < 0.01,
  `поворот 90°: ${w0}×${h0} → ${$('#prop-w').value}×${$('#prop-h').value}`);
$('#tr-mirror-h').click();
ok(true, 'зеркало по горизонтали применилось без ошибок');
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });

console.log('раскладка на листе');
$('#nest-all').click();
ok(text('#toast').includes('Разложено') || text('#toast').includes('не помещаются'), `раскладка: ${text('#toast')}`);

console.log('проверка перед резкой');
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 1100, 700);
pointer('pointermove', 1180, 780);
pointer('pointerup', 1180, 780);
$('#btn-check-run').click();
ok(window.document.querySelectorAll('#issues li').length > 0 || text('#check-summary') !== '', `отчёт проверки: ${text('#check-summary')}`);
$('.tool-btn[data-tool="select"]').click();

console.log('текст в кривых (диалог вместо prompt)');
$('.tool-btn[data-tool="text"]').click();
pointer('pointerdown', 300, 500);
await new Promise((r) => setTimeout(r, 400));
const modalInput = window.document.querySelector('#modal-input');
ok(!!modalInput, 'диалог ввода текста открылся');
modalInput.value = 'Рез 42';
window.document.querySelector('#modal-ok').click();
await new Promise((r) => setTimeout(r, 400));
ok(!window.document.querySelector('#modal-input'), 'диалог закрылся после «Готово»');
ok(num() > beforeUnion, `объект-текст добавлен (${count()})`);
ok(!$('#row-length').hidden || $('#props-body').hidden === false, 'текст выделен как обычный объект');

console.log('drag&drop: подсказка не залипает');
const dropZone = window.document.getElementById('drop-zone');
const dndEvent = (type, extra = {}) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: '', ...extra } });
  return ev;
};
window.dispatchEvent(dndEvent('dragenter'));
ok(dropZone.hidden === false, 'подсказка появилась при перетаскивании файла');
window.dispatchEvent(dndEvent('dragover'));
ok(dropZone.hidden === false, 'подсказка держится при движении над окном');
const leaveOut = new window.Event('dragleave', { bubbles: true });
Object.defineProperty(leaveOut, 'relatedTarget', { value: null });
window.dispatchEvent(leaveOut);
ok(dropZone.hidden === true, 'файл увели за пределы окна — подсказка скрылась');
window.dispatchEvent(dndEvent('dragenter'));
$('#overlay').dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 500, clientY: 400, bubbles: true, button: 0 }));
pointer('pointerup', 500, 400);
ok(dropZone.hidden === true, 'клик по листу снимает зависшую подсказку');

const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm"><rect x="1" y="1" width="38" height="28"/></svg>';
const droppedFile = { name: 'dropped.svg', text: async () => svgText };
const beforeDrop = num();
const dropEv = dndEvent('drop', { files: [droppedFile] });
window.dispatchEvent(dropEv);
await new Promise((r) => setTimeout(r, 60));
ok(dropZone.hidden === true, 'после drop подсказка скрыта');

// Регрессия «синий экран не уходит»: браузерное [hidden]{display:none} проигрывает
// авторскому .drop-zone{display:grid}, поэтому в CSS обязано быть правило с !important,
// иначе подсказка висит поверх листа постоянно, хотя атрибут hidden выставлен.
const cssText = [...window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(cssText), 'CSS: [hidden] перекрывает display классов');
ok(!/\.drop-zone\s*\{[^}]*\}/.test(cssText) || /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(cssText),
  'подсказка не может остаться видимой из-за display: grid');

window.dispatchEvent(dndEvent('dragenter'));
ok(dropZone.hidden === false, 'перед проверкой Esc подсказка снова показана');
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
ok(dropZone.hidden === true, 'Esc закрывает подсказку перетаскивания');
ok(num() === beforeDrop + 1, `файл из drop загружен (${beforeDrop} → ${num()})`);

console.log('как в CorelDRAW: углы, список объектов, умные направляющие');

// скругление углов выделенного прямоугольника
key('a', { ctrlKey: true });
const hasArcBefore = JSON.stringify(store.state.doc.objects).includes('"t":"a"');
$('#corner-mm').value = '4';
$('#corner-fillet').click();
const selAfterFillet = store.selected()[0];
const arcsAfter = selAfterFillet ? selAfterFillet.path.flatMap((sp) => sp.segs).filter((sg) => sg.t === 'a').length : 0;
ok(arcsAfter > 0, `скругление углов добавило дуги (${arcsAfter} шт., до операции дуги были: ${hasArcBefore})`);

// фаска
$('#corner-chamfer').click();
const selAfterChamfer = store.selected()[0];
const linesAfter = selAfterChamfer ? selAfterChamfer.path.flatMap((sp) => sp.segs).filter((sg) => sg.t === 'l').length : 0;
ok(linesAfter >= 8, `фаска дала срезы (${linesAfter} отрезков)`);
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });

// список объектов
const rows = window.document.querySelectorAll('#obj-list .objrow');
ok(rows.length === store.state.doc.order.filter((id) => store.state.doc.objects[id].sheetId === store.state.sheet.id).length,
  `список объектов совпадает с порядком (${rows.length} строк)`);
const firstRow = rows[0];
const firstId = firstRow.dataset.id;
firstRow.querySelector('[data-obj-act="select"]').click();
ok(store.state.selection.length === 1 && store.state.selection[0] === firstId, 'клик по имени выделяет объект');
firstRow.querySelector('[data-obj-act="eye"]').click();
ok(store.state.doc.objects[firstId].hidden === true, 'глаз скрывает объект');
firstRow.querySelector('[data-obj-act="eye"]').click();
ok(store.state.doc.objects[firstId].hidden === false, 'повторный клик показывает объект');
firstRow.querySelector('[data-obj-act="lock"]').click();
ok(store.state.doc.objects[firstId].locked === true, 'замок блокирует объект');
firstRow.querySelector('[data-obj-act="lock"]').click();
// первая строка — самый верхний объект: «↑» ему недоступен, двигаем «↓»
const orderBefore = store.state.doc.order.join(',');
firstRow.querySelector('[data-obj-act="down"]').click();
ok(store.state.doc.order.join(',') !== orderBefore, 'стрелка «↓» меняет порядок наложения');
const rowsNow = window.document.querySelectorAll('#obj-list .objrow');
rowsNow[rowsNow.length - 1].querySelector('[data-obj-act="up"]').click();
ok(window.document.querySelector('#obj-list .objrow').dataset.id === store.state.doc.order[store.state.doc.order.length - 1],
  'список перестроился по новому порядку');
key('z', { ctrlKey: true });

// умные направляющие
ok(store.state.smartGuides === true, 'умные направляющие включены по умолчанию');
const smartChk = window.document.getElementById('chk-smart');
smartChk.checked = false;
smartChk.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(store.state.smartGuides === false, 'тумблер отключает умные направляющие');
smartChk.checked = true;
smartChk.dispatchEvent(new window.Event('change', { bubbles: true }));

console.log('интерактивные ручки, многоугольник и звезда');

const view = window.lcx.view;
const scr = (p) => view.toScreen(p);

/** bbox объекта в мировых мм: точки контура, прогнанные через его матрицу. */
const worldBoxOf = (obj) => {
  const pts = [];
  for (const sp of obj.path) {
    pts.push(sp.start);
    for (const sg of sp.segs) {
      pts.push(sg.b);
      if (sg.t === 'c') pts.push(sg.c1, sg.c2);
    }
  }
  const m = obj.transform;
  const xs = pts.map((p) => m.a * p.x + m.c * p.y + m.e);
  const ys = pts.map((p) => m.b * p.x + m.d * p.y + m.f);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

// прямоугольник протяжкой
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 300, 250);
pointer('pointermove', 420, 330);
pointer('pointerup', 420, 330);
const handleId = store.state.selection[0];
$('.tool-btn[data-tool="select"]').click();
store.select([handleId]);
const hb = worldBoxOf(store.state.doc.objects[handleId]);
ok(hb.w > 1 && hb.h > 1, `прямоугольник для ручек: ${hb.w.toFixed(1)}×${hb.h.toFixed(1)} мм`);

// масштаб за правый нижний угол: тянем на габарит наружу → размеры удваиваются
const se = scr({ x: hb.x + hb.w, y: hb.y });
pointer('pointerdown', se.x, se.y);
pointer('pointermove', se.x + hb.w * view.scale, se.y + hb.h * view.scale);
pointer('pointerup', se.x + hb.w * view.scale, se.y + hb.h * view.scale);
const scaled = worldBoxOf(store.state.doc.objects[handleId]);
ok(Math.abs(scaled.w - hb.w * 2) < hb.w * 0.02 && Math.abs(scaled.h - hb.h * 2) < hb.h * 0.02,
  `ручка масштаба удвоила габарит: ${scaled.w.toFixed(1)}×${scaled.h.toFixed(1)} мм`);
key('z', { ctrlKey: true });
ok(Math.abs(worldBoxOf(store.state.doc.objects[handleId]).w - hb.w) < 0.01, 'undo вернул исходный размер');

// поворот за ручку над верхней гранью: 90°
const center = scr({ x: hb.x + hb.w / 2, y: hb.y + hb.h / 2 });
const top = scr({ x: hb.x + hb.w / 2, y: hb.y + hb.h });
pointer('pointerdown', top.x, top.y - 20);
pointer('pointermove', center.x + 80, center.y);
pointer('pointerup', center.x + 80, center.y);
const rotated = worldBoxOf(store.state.doc.objects[handleId]);
ok(Math.abs(rotated.w - hb.h) < hb.h * 0.03 && Math.abs(rotated.h - hb.w) < hb.w * 0.03,
  `ручка поворота повернула на 90°: ${rotated.w.toFixed(1)}×${rotated.h.toFixed(1)} мм`);
key('z', { ctrlKey: true });
ok(Math.abs(worldBoxOf(store.state.doc.objects[handleId]).w - hb.w) < 0.01, 'undo вернул исходную ориентацию');

// многоугольник и звезда
const beforePoly = num();
$('.tool-btn[data-tool="polygon"]').click();
$('#poly-sides').value = '7';
$('#poly-sides').dispatchEvent(new window.Event('input', { bubbles: true }));
pointer('pointerdown', 600, 200);
pointer('pointermove', 680, 280);
pointer('pointerup', 680, 280);
const polyObj = store.state.doc.objects[store.state.selection[0]];
ok(num() === beforePoly + 1, `многоугольник создан (${num()} объектов)`);
ok(polyObj.path[0].segs.length === 7, `у многоугольника 7 сторон (${polyObj.path[0].segs.length})`);

$('.tool-btn[data-tool="star"]').click();
$('#star-points').value = '6';
$('#star-points').dispatchEvent(new window.Event('input', { bubbles: true }));
pointer('pointerdown', 600, 400);
pointer('pointermove', 680, 480);
pointer('pointerup', 680, 480);
const starObj = store.state.doc.objects[store.state.selection[0]];
ok(starObj.path[0].segs.length === 12, `у звезды 6 лучей = 12 вершин (${starObj.path[0].segs.length})`);
const radii = starObj.path[0].segs.map((sg) => Math.hypot(sg.a.x, sg.a.y));
const rOuter = Math.max(...radii), rInner = Math.min(...radii);
ok(Math.abs(rInner / rOuter - 0.45) < 0.02, `глубина звезды 45% выдержана (${(100 * rInner / rOuter).toFixed(0)}%)`);
ok(worldBoxOf(starObj).w > 10 && worldBoxOf(starObj).h > 10, `звезда получила габарит ${worldBoxOf(starObj).w.toFixed(1)}×${worldBoxOf(starObj).h.toFixed(1)} мм`);
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });

console.log('редактор узлов 2.0');

$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 250, 500);
pointer('pointermove', 330, 560);
pointer('pointerup', 330, 560);
const nodeObjId = store.state.selection[0];
$('.tool-btn[data-tool="node"]').click();
const nodeObj = store.state.doc.objects[nodeObjId];
const beforeCubics = nodeObj.path[0].segs.filter((sg) => sg.t === 'c').length;
const l0 = nodeObj.path[0].start;
const m0 = nodeObj.transform;
const nodePt = { x: m0.a * l0.x + m0.c * l0.y + m0.e, y: m0.b * l0.x + m0.d * l0.y + m0.f };
// клик по узлу, затем «Гладкий»
const nScreen = view.toScreen(nodePt);
pointer('pointerdown', nScreen.x, nScreen.y);
pointer('pointerup', nScreen.x, nScreen.y);
$('#node-smooth').click();
const smoothObj = store.state.doc.objects[nodeObjId];
const afterCubics = smoothObj.path[0].segs.filter((sg) => sg.t === 'c').length;
ok(afterCubics > beforeCubics, `«Гладкий» превратил соседние отрезки в кривые (${beforeCubics} → ${afterCubics})`);
ok(window.lcx.store.state.tool === 'node', 'инструмент «Узлы» активен');
$('#node-corner').click();
key('z', { ctrlKey: true });
ok(store.state.doc.objects[nodeObjId].path[0].segs.filter((sg) => sg.t === 'c').length === beforeCubics,
  'undo вернул прямые отрезки');
$('.tool-btn[data-tool="select"]').click();

console.log('заливка, градиент и текст по контуру');

$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 700, 500);
pointer('pointermove', 800, 560);
pointer('pointerup', 800, 560);
const fillId = store.state.selection[0];
const styleOf = (id) => store.state.doc.objects[id].style;

const chkFill = window.document.getElementById('chk-fill');
chkFill.checked = true;
chkFill.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(!!styleOf(fillId).fill, `заливка включена (${styleOf(fillId).fill})`);

const fillType = window.document.getElementById('fill-type');
fillType.value = 'linear';
fillType.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(styleOf(fillId).fillType === 'linear', 'тип заливки — линейный градиент');
ok(window.document.getElementById('row-fill-angle').hidden === false, 'поле угла показано для линейного градиента');

const fillAngle = window.document.getElementById('fill-angle');
fillAngle.value = '45';
fillAngle.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(styleOf(fillId).fillAngle === 45, 'угол градиента применён');

const fill2 = window.document.getElementById('fill-color-2');
fill2.value = '#00ff00';
fill2.dispatchEvent(new window.Event('input', { bubbles: true }));
ok(styleOf(fillId).fill2 === '#00ff00', 'второй цвет градиента применён');

const svgOut = window.lcx.exportSvg(store.state.doc);
ok(svgOut.includes('<linearGradient'), 'в SVG появился linearGradient');
ok(svgOut.includes('url(#grad'), 'заливка в SVG ссылается на градиент');

// текст по контуру
store.select([fillId]);
const objCountBefore = num();
window.document.getElementById('top-text').value = 'ОСЬ';
window.document.getElementById('btn-text-path').click();
await new Promise((r) => setTimeout(r, 150));
ok(num() === objCountBefore + 1, `текст по контуру добавил объект (${objCountBefore} → ${num()})`);
const textObjId = store.state.selection[0];
ok(textObjId !== fillId, 'новый объект выделен');
ok(store.state.doc.objects[textObjId].path.length >= 2, `в объекте ${store.state.doc.objects[textObjId].path.length} контуров букв`);
key('z', { ctrlKey: true });
ok(num() === objCountBefore, 'undo убрал текст по контуру');

console.log('сворачиваемые панели (докеры)');

const blocks = [...window.document.querySelectorAll('aside.panel .pblock')];
ok(blocks.length >= 15, `в панели ${blocks.length} блоков`);
ok(blocks.every((b) => b.querySelector('h2.phead[role="button"]')), 'у каждого блока заголовок-кнопка');
ok(blocks.every((b) => !!b.dataset.panel), 'у каждого блока есть стабильный ключ data-panel');
ok(blocks.every((b) => !b.classList.contains('is-collapsed')), 'по умолчанию все блоки развёрнуты');

const first = blocks[0];
const firstHead = first.querySelector('h2.phead');
firstHead.click();
ok(first.classList.contains('is-collapsed'), 'клик по заголовку сворачивает блок');
ok(firstHead.getAttribute('aria-expanded') === 'false', 'aria-expanded стал false');
ok(JSON.parse(window.localStorage.getItem('lasercut.panels.v1') ?? '[]').includes(first.dataset.panel),
  'состояние сохранилось в localStorage');
firstHead.click();
ok(!first.classList.contains('is-collapsed'), 'повторный клик разворачивает блок');

// Alt+клик — аккордеон: открыт только один блок
const second = blocks[1];
second.querySelector('h2.phead').dispatchEvent(new window.MouseEvent('click', { bubbles: true, altKey: true }));
ok(!second.classList.contains('is-collapsed'), 'Alt+клик оставил открытым свой блок');
ok(blocks.filter((b) => !b.classList.contains('is-collapsed')).length === 1, 'остальные блоки свёрнуты');

// кнопки «свернуть/развернуть всё»
window.document.getElementById('panels-collapse').click();
ok(blocks.every((b) => b.classList.contains('is-collapsed')), 'кнопка «свернуть всё» свернула все блоки');
window.document.getElementById('panels-expand').click();
ok(blocks.every((b) => !b.classList.contains('is-collapsed')), 'кнопка «развернуть всё» вернула все блоки');
ok(JSON.parse(window.localStorage.getItem('lasercut.panels.v1')).length === 0, 'в памяти пусто после разворота');

// восстановление состояния: пишем в память и инициализируем панели заново
window.localStorage.setItem('lasercut.panels.v1', JSON.stringify(['ops', 'check']));
window.lcx.panels.init();
ok(window.lcx.panels.isCollapsed('ops') && window.lcx.panels.isCollapsed('check'), 'свёрнутые блоки восстановлены из памяти');
ok(!window.lcx.panels.isCollapsed('sheet'), 'остальные блоки остались развёрнутыми');
window.document.getElementById('panels-expand').click();
window.lcx.panels.init();

// клавиатура: Enter на заголовке тоже переключает
firstHead.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
ok(first.classList.contains('is-collapsed'), 'Enter на заголовке сворачивает блок');
firstHead.click();

console.log('блок «Цвет»: палитра и смеситель');

const swatches = [...window.document.querySelectorAll('#palette .sw')];
ok(swatches.length === 36, `в палитре ${swatches.length} образцов (35 цветов + «нет цвета»)`);
ok(swatches[0].classList.contains('sw-none'), 'первый образец — «нет цвета»');

$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 900, 200);
pointer('pointermove', 980, 260);
pointer('pointerup', 980, 260);
const colorId = store.state.selection[0];
const styleNow = () => store.state.doc.objects[colorId].style;

// левый клик — заливка
const red = swatches.find((b) => b.dataset.color === '#e53935');
red.click();
ok(styleNow().fill === '#e53935', `клик по образцу дал заливку ${styleNow().fill}`);
ok(styleNow().fillType === 'solid', 'палитра ставит сплошную заливку');
ok(red.classList.contains('is-active'), 'выбранный образец подсвечен');
ok(window.document.getElementById('cc-fill').style.background.includes('rgb(229, 57, 53)')
  || window.document.getElementById('cc-fill').style.background === '#e53935', 'индикатор заливки обновился');

// правый клик — обводка (как в CorelDRAW)
const blue = swatches.find((b) => b.dataset.color === '#1e88e5');
blue.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
ok(styleNow().stroke === '#1e88e5', `правый клик задал обводку ${styleNow().stroke}`);

// Shift+клик — тоже обводка
const green = swatches.find((b) => b.dataset.color === '#43a047');
green.dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
ok(styleNow().stroke === '#43a047', 'Shift+клик задаёт цвет обводки');
ok(styleNow().fill === '#e53935', 'заливка при этом не изменилась');

// «нет цвета» убирает заливку
swatches[0].click();
ok(styleNow().fill === null, 'крестик убрал заливку');

// смеситель: HEX-поле и ползунки
const hexField = window.document.getElementById('mix-hex');
hexField.value = '#ff8800';
hexField.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(styleNow().fill === '#ff8800', `HEX-поле применило цвет ${styleNow().fill}`);
ok(window.document.getElementById('mix-h').value === '32', `оттенок подхватился из цвета (${window.document.getElementById('mix-h').value}°)`);

$('#mix-to-stroke').click();
ok(window.document.getElementById('mix-to-stroke').classList.contains('is-active'), 'переключатель «В обводку» активен');
const hueSlider = window.document.getElementById('mix-h');
hueSlider.value = '120';
hueSlider.dispatchEvent(new window.Event('input', { bubbles: true }));
ok(styleNow().stroke !== '#ff8800' && styleNow().stroke.startsWith('#'), `ползунок оттенка сменил обводку (${styleNow().stroke})`);
ok(styleNow().fill === '#ff8800', 'заливка не тронута — цель была обводка');
$('#mix-to-fill').click();
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });

console.log('редактор узлов 3.0: сегменты, координаты, выравнивание');

$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 700, 650);
pointer('pointermove', 820, 730);
pointer('pointerup', 820, 730);
const segObjId = store.state.selection[0];
$('.tool-btn[data-tool="node"]').click();
ok(window.lcx.node !== undefined, 'состояние редактора узлов доступно для проверки');

const segObj = store.state.doc.objects[segObjId];
const mm = (local) => {
  const m = segObj.transform;
  return { x: m.a * local.x + m.c * local.y + m.e, y: m.b * local.x + m.d * local.y + m.f };
};
// середина нижней стороны прямоугольника
const s0 = segObj.path[0].segs[0];
const midLocal = { x: (s0.a.x + s0.b.x) / 2, y: (s0.a.y + s0.b.y) / 2 };
const midScreen = view.toScreen(mm(midLocal));
pointer('pointerdown', midScreen.x, midScreen.y);
ok(window.lcx.node.segment !== null, 'клик по кривой выделил сегмент');
pointer('pointermove', midScreen.x, midScreen.y - 20);
pointer('pointerup', midScreen.x, midScreen.y - 20);
const segAfter = store.state.doc.objects[segObjId];
ok(JSON.stringify(segAfter.path) !== JSON.stringify(segObj.path), 'перетаскивание сегмента изменило контур');
key('z', { ctrlKey: true });
ok(JSON.stringify(store.state.doc.objects[segObjId].path) === JSON.stringify(segObj.path), 'undo вернул контур');

// точные координаты узла
const firstNodeLocal = store.state.doc.objects[segObjId].path[0].start;
const firstNodeWorld = mm(firstNodeLocal);
const fnScreen = view.toScreen(firstNodeWorld);
pointer('pointerdown', fnScreen.x, fnScreen.y);
pointer('pointerup', fnScreen.x, fnScreen.y);
ok(window.lcx.node.active !== null, 'узел выбран кликом');
const nodeX = window.document.getElementById('node-x');
const nodeY = window.document.getElementById('node-y');
nodeX.value = String(Math.round((firstNodeWorld.x + 5) * 10) / 10);
nodeY.value = String(Math.round((firstNodeWorld.y + 4) * 10) / 10);
nodeX.dispatchEvent(new window.Event('change', { bubbles: true }));
const movedTo = mm(store.state.doc.objects[segObjId].path[0].start);
ok(Math.abs(movedTo.x - (firstNodeWorld.x + 5)) < 0.11 && Math.abs(movedTo.y - (firstNodeWorld.y + 4)) < 0.11,
  `узел встал по координатам (${movedTo.x.toFixed(1)}, ${movedTo.y.toFixed(1)})`);
key('z', { ctrlKey: true });

// выравнивание узлов по X: два узла → одинаковая X
const objNow = store.state.doc.objects[segObjId];
window.lcx.node.selected = [{ sub: 0, index: 0 }, { sub: 0, index: 1 }];
window.lcx.node.active = { sub: 0, index: 0 };
$('#node-align-x').click();
const al = store.state.doc.objects[segObjId].path[0];
ok(Math.abs(al.start.x - al.segs[0].b.x) < 1e-6, 'узлы выровнены по X');
key('z', { ctrlKey: true });

// реверс направления подпути: у замкнутого контура стартовая точка та же,
// а первый отрезок идёт к другому соседу — направление обхода сменилось
const dirBefore = store.state.doc.objects[segObjId].path[0].segs[0].b;
window.lcx.node.active = { sub: 0, index: 0 };
$('#node-reverse').click();
const dirAfter = store.state.doc.objects[segObjId].path[0].segs[0].b;
ok(JSON.stringify(dirAfter) !== JSON.stringify(dirBefore), 'реверс сменил направление обхода контура');
key('z', { ctrlKey: true });
void objNow;

// стрелки сдвигают узел, а не объект
const beforeNudgeObj = JSON.parse(JSON.stringify(store.state.doc.objects[segObjId]));
window.lcx.node.selected = [{ sub: 0, index: 0 }];
window.lcx.node.active = { sub: 0, index: 0 };
key('arrowright');
const afterNudgeObj = store.state.doc.objects[segObjId];
ok(JSON.stringify(afterNudgeObj.path) !== JSON.stringify(beforeNudgeObj.path), 'стрелка сдвинула узел');
ok(JSON.stringify(afterNudgeObj.transform) === JSON.stringify(beforeNudgeObj.transform), 'объект при этом не сдвинулся');
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });
$('.tool-btn[data-tool="select"]').click();

console.log('соединение «паз — шип» (инструмент «Паз», J)');

// квадрат 60×60 в фанере 3 мм: паз должен быть 2,9 × 3 мм
store.updateMaterial({ thickness: 3, kerf: 0.12, presetId: 'plywood-3', name: 'Фанера 3 мм' });
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 700, 300);
pointer('pointermove', 800, 400);
pointer('pointerup', 800, 400);
const jointId = store.state.selection[0];
const jObj = store.state.doc.objects[jointId];
const jBox = (() => {
  const xs = [], ys = [];
  for (const sp of jObj.path) {
    for (const p of [sp.start, ...sp.segs.map((sg) => sg.b)]) {
      xs.push(jObj.transform.a * p.x + jObj.transform.c * p.y + jObj.transform.e);
      ys.push(jObj.transform.b * p.x + jObj.transform.d * p.y + jObj.transform.f);
    }
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
})();
const jAreaOf = (id) => {
  const ob = window.lcx.store.state.doc.objects[id];
  const scale = Math.abs(ob.transform.a * ob.transform.d - ob.transform.b * ob.transform.c) || 1;
  let area = 0;
  for (const sp of ob.path) {
    const pts = [sp.start, ...sp.segs.map((sg) => sg.b)];
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
    area += Math.abs(a / 2);
  }
  return area * scale;
};

// инструмент «Паз» включается клавишей J
key('j');
ok(store.state.tool === 'joint', 'клавиша J включает инструмент «Паз»');

const jBefore = { count: Number(count().replace(/\D+/g, '')), path: JSON.stringify(store.state.doc.objects[jointId].path), area: jAreaOf(jointId) };
// клик по середине верхнего ребра
const jTopMid = view.toScreen({ x: (jBox.x0 + jBox.x1) / 2, y: jBox.y1 });
pointer('pointermove', jTopMid.x, jTopMid.y - 2);
ok(window.lcx.joint.hover !== null, 'превью нашло ребро под курсором');
pointer('pointerdown', jTopMid.x, jTopMid.y - 2);
pointer('pointerup', jTopMid.x, jTopMid.y - 2);
const jAfter = store.state.doc.objects[jointId];
ok(JSON.stringify(jAfter.path) !== jBefore.path, 'паз вырезан в контуре');
ok(Math.abs(jAfter.transform.a - 1) < 1e-9 && Math.abs(jAfter.transform.b) < 1e-9, 'геометрия запечена (матрица единичная)');
ok(Number(count().replace(/\D+/g, '')) === jBefore.count, 'число объектов не изменилось — паз часть детали');

// площадь уменьшилась ровно на ширину × глубину (2,9 × 3 = 8,7 мм²)
const pts2 = jAfter.path[0].segs.length;
ok(pts2 > 4, `у контура появились точки паза (${pts2} сегментов)`);
// ровно «толщина − зазор» на глубину: (3 − 0,1) × 3 = 8,7 мм²
const jCut = jBefore.area - jAreaOf(jointId);
ok(Math.abs(jCut - 8.7) < 0.05, `паз вырезал ${jCut.toFixed(2)} мм² (ожидалось 8,7)`);

// повторный клик рядом вырезает второй паз
const jLeftMid = view.toScreen({ x: jBox.x0, y: (jBox.y0 + jBox.y1) / 2 });
pointer('pointerdown', jLeftMid.x + 2, jLeftMid.y);
pointer('pointerup', jLeftMid.x + 2, jLeftMid.y);
ok(JSON.stringify(store.state.doc.objects[jointId].path) !== JSON.stringify(jAfter.path), 'второй паз вырезан по другому ребру');

// undo отменяет ровно один паз
key('z', { ctrlKey: true });
ok(JSON.stringify(store.state.doc.objects[jointId].path) === JSON.stringify(jAfter.path), 'undo отменил только последний паз');
key('z', { ctrlKey: true });
ok(JSON.stringify(store.state.doc.objects[jointId].path) === jBefore.path, 'второй undo вернул деталь без пазов');

// режим «Ласточкин хвост» и «Шип» из панели
const jSelMode = $('#joint-mode');
jSelMode.value = 'dovetail';
jSelMode.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(store.state.joint.mode === 'dovetail', 'панель переключает тип соединения');
const jHint = $('#joint-hint').textContent;
ok(jHint.includes('ласточкин хвост'), 'подсказка описывает выбранный тип');

const jClearInput = $('#joint-clearance');
jClearInput.value = '0.2';
jClearInput.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(Math.abs(store.state.joint.clearance - 0.2) < 1e-9, 'зазор из панели применился');

// шип — добавка материала наружу
jSelMode.value = 'tab';
jSelMode.dispatchEvent(new window.Event('change', { bubbles: true }));
const tabAreaBefore = jAreaOf(jointId);
pointer('pointerdown', jTopMid.x, jTopMid.y - 2);
pointer('pointerup', jTopMid.x, jTopMid.y - 2);
const tabAreaAfter = jAreaOf(jointId);
ok(tabAreaAfter > tabAreaBefore, `шип добавил материал наружу (${tabAreaBefore.toFixed(1)} → ${tabAreaAfter.toFixed(1)} мм²)`);
key('z', { ctrlKey: true });
ok(Math.abs(jAreaOf(jointId) - tabAreaBefore) < 0.01, 'undo убрал шип');

jSelMode.value = 'slot';
jSelMode.dispatchEvent(new window.Event('change', { bubbles: true }));
$('.tool-btn[data-tool="select"]').click();

console.log('в кривые (Ctrl+Q)');

// прямоугольник, повёрнутый на 90°: матрица «держит» поворот
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 300, 620);
pointer('pointermove', 420, 700);
pointer('pointerup', 420, 700);
const cvObjId = store.state.selection[0];
$('#tr-rot90').click();
const cvRotated = store.state.doc.objects[cvObjId];
// точки сегмента, включая крайние точки дуги (иначе у круга из дуг высота выйдет нулевой)
const cvSegPts = (sg) => {
  if ('c1' in sg) return [sg.a, sg.c1, sg.c2, sg.b];
  if (sg.t === 'a') {
    const out = [sg.a, sg.b];
    const norm = (v) => { let x = v; while (x > Math.PI) x -= 2 * Math.PI; while (x <= -Math.PI) x += 2 * Math.PI; return x; };
    for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const d = norm(ang - sg.a0);
      const inside = sg.sweep >= 0 ? d >= 0 && d <= sg.sweep : d <= 0 && d >= sg.sweep;
      if (inside) out.push({ x: sg.center.x + sg.r * Math.cos(ang), y: sg.center.y + sg.r * Math.sin(ang) });
    }
    return out;
  }
  return [sg.a, sg.b];
};
const cvWorldBox = (o) => {
  const xs = [], ys = [];
  for (const sp of o.path) {
    const pts = [sp.start, ...sp.segs.flatMap(cvSegPts)];
    for (const p of pts) {
      xs.push(o.transform.a * p.x + o.transform.c * p.y + o.transform.e);
      ys.push(o.transform.b * p.x + o.transform.d * p.y + o.transform.f);
    }
  }
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const cvBoxBefore = cvWorldBox(cvRotated);
ok(Math.abs(cvRotated.transform.a) < 1e-9 || Math.abs(cvRotated.transform.b) > 1e-9, 'после поворота матрица не единичная');

$('#obj-curves').click();
const cvObj = store.state.doc.objects[cvObjId];
ok(Math.abs(cvObj.transform.a - 1) < 1e-9 && Math.abs(cvObj.transform.b) < 1e-9 && Math.abs(cvObj.transform.c) < 1e-9 && Math.abs(cvObj.transform.d - 1) < 1e-9,
  'матрица запечена: объект стал единичной кривой');
const cvBoxAfter = cvWorldBox(cvObj);
ok(Math.abs(cvBoxAfter.w - cvBoxBefore.w) < 1e-6 && Math.abs(cvBoxAfter.h - cvBoxBefore.h) < 1e-6 && Math.abs(cvBoxAfter.x - cvBoxBefore.x) < 1e-6,
  'габарит и положение не изменились');
ok(store.state.selection[0] === cvObjId, 'объект остался выделен');

// повторное нажатие ничего не делает и не пишет в историю
const cvUndoBefore = store.history.canUndo;
$('#obj-curves').click();
ok(store.history.canUndo === cvUndoBefore, 'повторное «в кривые» не создаёт шага истории');
key('z', { ctrlKey: true });
ok(Math.abs(store.state.doc.objects[cvObjId].transform.a - cvRotated.transform.a) < 1e-9, 'undo вернул исходную матрицу');

// круг построен дугами: Ctrl+Q делает из него 4 кривые.
// привязки на время рисования выключаем — иначе прилипание к сетке сделает из круга эллипс
const snapGridChk = $('#chk-snap-grid');
const snapObjChk = $('#chk-snap-obj');
const wasGrid = snapGridChk.checked, wasObj = snapObjChk.checked;
snapGridChk.checked = false; snapGridChk.dispatchEvent(new window.Event('change', { bubbles: true }));
snapObjChk.checked = false; snapObjChk.dispatchEvent(new window.Event('change', { bubbles: true }));
$('.tool-btn[data-tool="ellipse"]').click();
pointer('pointerdown', 900, 300);
pointer('pointermove', 980, 380);
pointer('pointerup', 980, 380);
snapGridChk.checked = wasGrid; snapGridChk.dispatchEvent(new window.Event('change', { bubbles: true }));
snapObjChk.checked = wasObj; snapObjChk.dispatchEvent(new window.Event('change', { bubbles: true }));
const ellId = store.state.selection[0];
ok(store.state.doc.objects[ellId].path[0].segs.some((s) => s.t === 'a'), 'эллипс построен из дуг');
const ellBefore = cvWorldBox(store.state.doc.objects[ellId]);
key('q', { ctrlKey: true });
const ell = store.state.doc.objects[ellId];
ok(!ell.path[0].segs.some((s) => s.t === 'a'), 'Ctrl+Q превратил дуги в кривые');
ok(ell.path[0].segs.length === 4, 'круг — четыре кривые Безье, как в Corel');
const ellAfter = cvWorldBox(ell);
ok(Math.abs(ellAfter.w - ellBefore.w) < 1e-3 && Math.abs(ellAfter.h - ellBefore.h) < 1e-3,
  `эллипс не деформировался (${ellBefore.w.toFixed(6)}×${ellBefore.h.toFixed(6)} → ${ellAfter.w.toFixed(6)}×${ellAfter.h.toFixed(6)})`);
key('z', { ctrlKey: true });

$('.tool-btn[data-tool="select"]').click();

console.log('материал и компенсация реза');

// пресет материала задаёт толщину и рез
const matSel = $('#mat-preset');
ok(matSel.options.length >= 8, `в списке материалов ${matSel.options.length} пресетов`);
matSel.value = 'plywood-6';
matSel.dispatchEvent(new window.Event('change', { bubbles: true }));
const mat6 = store.state.doc.material;
ok(mat6.thickness === 6 && Math.abs(mat6.kerf - 0.18) < 1e-9,
  `«Фанера 6 мм» подставила толщину ${mat6.thickness} и рез ${mat6.kerf}`);

// ручной ввод реза переводит материал в «свой»
const kerfInput = $('#mat-kerf');
kerfInput.value = '0.3';
kerfInput.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(store.state.doc.material.kerf === 0.3 && store.state.doc.material.presetId === 'custom',
  'ручной рез 0,3 мм делает материал своим');
ok($('#mat-hint').textContent.includes('0.3'), 'подсказка показывает текущий рез');

// чекбокс компенсации при экспорте живёт в документе
const chkKerf = $('#mat-compensate');
chkKerf.checked = true;
chkKerf.dispatchEvent(new window.Event('change', { bubbles: true }));
ok(store.state.doc.material.compensate === true, 'галочка «учитывать рез в DXF» сохранена в документе');

// «Учесть рез в контурах»: деталь 120×80 вырастает на 0.3 мм
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 300, 620);
pointer('pointermove', 460, 720);
pointer('pointerup', 460, 720);
const kerfObjId = store.state.selection[0];
const sizeOf = (id) => {
  const o = store.state.doc.objects[id];
  const xs = [], ys = [];
  for (const sp of o.path) {
    const pts = [sp.start, ...sp.segs.flatMap((sg) => ('c1' in sg ? [sg.c1, sg.c2, sg.b] : [sg.b]))];
    for (const p of pts) {
      xs.push(o.transform.a * p.x + o.transform.c * p.y + o.transform.e);
      ys.push(o.transform.b * p.x + o.transform.d * p.y + o.transform.f);
    }
  }
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const beforeKerf = sizeOf(kerfObjId);
$('#mat-apply').click();
const afterKerf = sizeOf(kerfObjId);
ok(Math.abs(afterKerf.w - (beforeKerf.w + 0.3)) < 0.02 && Math.abs(afterKerf.h - (beforeKerf.h + 0.3)) < 0.02,
  `контур вырос на рез: ${beforeKerf.w.toFixed(1)}×${beforeKerf.h.toFixed(1)} → ${afterKerf.w.toFixed(1)}×${afterKerf.h.toFixed(1)}`);
key('z', { ctrlKey: true });
ok(Math.abs(sizeOf(kerfObjId).w - beforeKerf.w) < 1e-6, 'undo вернул исходный контур');

// гравировочный объект рез не трогает
const engraveLayer = store.state.doc.layers.find((l) => l.op === 'engrave');
ok(!!engraveLayer, 'в документе есть слой гравировки');
store.select([kerfObjId]);
store.state.doc.objects[kerfObjId].layerId = engraveLayer.id;
$('#mat-apply').click();
ok(Math.abs(sizeOf(kerfObjId).w - beforeKerf.w) < 1e-6, 'объект на слое гравировки не компенсируется');
key('z', { ctrlKey: true });

// документ переживает сохранение/загрузку .lcx вместе с материалом
const saved = JSON.parse(JSON.stringify(store.state.doc));
ok(saved.material && saved.material.kerf === 0.3, 'материал уходит в проект .lcx');
$('.tool-btn[data-tool="select"]').click();

console.log('PowerClip: поместить внутрь и извлечь');

// контейнер 60×40 и «содержимое», которое торчит за его край
$('.tool-btn[data-tool="rect"]').click();
pointer('pointerdown', 200, 600);
pointer('pointermove', 340, 690);
pointer('pointerup', 340, 690);
const containerId = store.state.selection[0];

$('.tool-btn[data-tool="ellipse"]').click();
pointer('pointerdown', 300, 640);
pointer('pointermove', 440, 740);
pointer('pointerup', 440, 740);
const contentId = store.state.selection[0];

const contentBefore = JSON.parse(JSON.stringify(store.state.doc.objects[contentId].path));
const objectsBefore = num();
store.select([containerId, contentId]);
$('#pc-place').click();

const afterPlace = store.state.doc.objects[contentId];
ok(!!afterPlace && !!afterPlace.clip, 'у содержимого появилась пометка PowerClip');
ok(afterPlace.clip.containerId === containerId, 'контейнер записан в объекте');
ok(JSON.stringify(afterPlace.clip.path) === JSON.stringify(contentBefore), 'исходная геометрия сохранена для «Извлечь»');
ok(num() === objectsBefore, `объекты не пропали (${num()})`);

const bboxOf = (obj) => {
  const pts = [];
  for (const sp of obj.path) {
    pts.push(sp.start);
    for (const sg of sp.segs) {
      pts.push(sg.a, sg.b);
      if (sg.t === 'c') pts.push(sg.c1, sg.c2);
    }
  }
  const m = obj.transform;
  const xs = pts.map((p) => m.a * p.x + m.c * p.y + m.e);
  const ys = pts.map((p) => m.b * p.x + m.d * p.y + m.f);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const cb = bboxOf(store.state.doc.objects[containerId]);
const kb = bboxOf(afterPlace);
ok(kb.x >= cb.x - 0.01 && kb.y >= cb.y - 0.01
  && kb.x + kb.w <= cb.x + cb.w + 0.01 && kb.y + kb.h <= cb.y + cb.h + 0.01,
  `содержимое теперь внутри контейнера (${kb.w.toFixed(1)}×${kb.h.toFixed(1)} из ${cb.w.toFixed(1)}×${cb.h.toFixed(1)})`);
ok(window.document.querySelector('#obj-list .objrow.is-clipped') !== null, 'в списке объектов видна пометка контейнера');

$('#pc-release').click();
ok(!store.state.doc.objects[contentId].clip, 'пометка PowerClip снята');
ok(JSON.stringify(store.state.doc.objects[contentId].path) === JSON.stringify(contentBefore), 'контуры вернулись как были');
ok(num() === objectsBefore - 1, `контейнер удалён (${num()})`);

key('z', { ctrlKey: true });
ok(num() === objectsBefore && !!store.state.doc.objects[contentId].clip, 'undo вернул состояние «внутри контейнера»');
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });
key('z', { ctrlKey: true });

console.log('экспорт DXF: диалог с настройками');

// перехватываем файлы, которые приложение отдаёт в download()
const blobs = [];
URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:test'; };
URL.revokeObjectURL = () => undefined;
const tick = () => new Promise((r) => setTimeout(r, 30));

store.select([store.state.doc.order[0]]);
void window.lcx.exportDxfWithOptions();
await tick();
ok(!!window.document.getElementById('dxf-ok'), 'открылся диалог экспорта DXF');
ok((window.document.getElementById('dxf-scope').textContent ?? '').includes('контур'),
  'в диалоге видно количество контуров');
window.document.getElementById('dxf-cancel').click();
ok(!window.document.getElementById('dxf-ok'), '«Отмена» закрывает диалог без файла');
ok(blobs.length === 0, 'после отмены ничего не скачано');

// весь лист, R2000, мм
void window.lcx.exportDxfWithOptions();
await tick();
window.document.getElementById('dxf-scope').value = 'sheet';
window.document.getElementById('dxf-ok').click();
await tick();
ok(blobs.length === 1, 'файл всего листа сформирован');
const sheetDxf = await blobs[0].text();
ok(sheetDxf.includes('AC1015'), 'R2000 в заголовке (AC1015)');
ok(sheetDxf.includes('LWPOLYLINE'), 'полилинии LWPOLYLINE');
const sheetParts = (sheetDxf.match(/LWPOLYLINE|CIRCLE/g) ?? []).length;
ok(sheetParts > 1, `в файле ${sheetParts} сущностей`);

// только выделенное, R12, дюймы, своя точность
void window.lcx.exportDxfWithOptions();
await tick();
window.document.getElementById('dxf-version').value = 'R12';
window.document.getElementById('dxf-scope').value = 'selection';
window.document.getElementById('dxf-units').value = 'inch';
window.document.getElementById('dxf-tolerance').value = '0.05';
window.document.getElementById('dxf-ok').click();
await tick();
ok(blobs.length === 2, 'файл выделения сформирован');
const selDxf = await blobs[1].text();
ok(selDxf.includes('AC1009'), 'R12 в заголовке (AC1009)');
ok(selDxf.includes('POLYLINE') && !selDxf.includes('LWPOLYLINE'), 'в R12 только POLYLINE + VERTEX');
ok(/\$INSUNITS\s*\n\s*70\s*\n\s*1\b/.test(selDxf), 'единицы — дюймы (INSUNITS=1)');
const selParts = (selDxf.match(/POLYLINE|CIRCLE/g) ?? []).length;
ok(selParts < sheetParts, `выделение меньше листа (${selParts} < ${sheetParts})`);
ok(text('#toast').includes('дюймы'), `тост сообщает единицы: «${text('#toast')}»`);
key('z', { ctrlKey: true });

console.log('экспорт (без скачивания)');
const dxf = window.lcx.exportDxf(store.state.doc);
ok(typeof dxf === 'string' && dxf.includes('AC1015') && dxf.includes('ENTITIES'), 'DXF собирается');
ok(dxf.includes('CUT') && dxf.includes('ENGRAVE'), 'DXF содержит слои реза и гравировки');
const svg = window.lcx.exportSvg(store.state.doc);
ok(svg.startsWith('<?xml') || svg.includes('<svg'), 'SVG собирается');
const issuesNow = window.lcx.validateDoc(store.state.doc, store.state.sheet);
ok(Array.isArray(issuesNow), `валидатор вернул ${issuesNow.length} замечаний`);

if (errors.length) {
  console.error('\nошибки рантайма:', errors);
  process.exitCode = 1;
} else {
  console.log('\nошибок рантайма нет');
}
