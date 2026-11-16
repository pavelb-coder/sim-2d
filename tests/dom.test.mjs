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

/** записи вызовов clearRect — проверяем, что чистится весь буфер (HiDPI) */
const clearCalls = [];
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const canvas = this;
  const m = ctxMock();
  m.canvas = canvas;
  m.clearRect = (...args) => { clearCalls.push({ canvas, args }); };
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

ok(window.document.querySelectorAll('.tool-btn').length === 8, 'панель инструментов: 8 кнопок (включая многоугольник и звезду)');
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
