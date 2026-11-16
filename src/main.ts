import type { Doc, Obj, Vec2 } from './core/types';
import type { ToolId } from './state/store';
import type { ExportKind, NodeOp } from './ui/panels';

import { emptyStyle } from './core/doc';
import { makeObj, uid } from './core/shape';
import { IDENT } from './core/geom/transform';
import { bboxOfSubPaths, boxUnion, pathLength, transformSubPaths } from './core/geom/path';
import { pathNodes } from './core/geom/nodeEdit';
import { pickObject } from './core/geom/hit';
import { findSnap, type SnapResult } from './core/snap';
import { validateDoc, type Issue } from './core/validate';
import { ensureFont, textToPaths } from './core/text';
import { importDxf } from './core/dxf/import';
import { exportDxf, exportDxfSheets, slug } from './core/dxf/export';
import { parseSvg } from './core/svg/parse';
import { exportSvg } from './core/svg/write';

import { Store } from './state/store';
import { updateCmd } from './state/history';
import { duplicate, nudge } from './state/edits';
import { alignSelection, applyBoolean, applyOffset, distributeSelection, duplicatePattern, groupSelection, nestSelection, reorderSelection, transformSelection, ungroupSelection } from './state/ops';

import { View } from './render/view';
import { renderScene } from './render/scene';
import { renderOverlay } from './render/overlay';
import { theme } from './render/theme';

import { createTools } from './tools';
import { emptyOverlay, type ToolCtx } from './tools/tool';
import { nodeToolState, nodeOpBreak, nodeOpClose, nodeOpCurve, nodeOpDelete, nodeOpLine } from './tools/node';
import { setTextHeight } from './tools/text';

import { initUI, setAutosaveStatus, setIssues, setStats } from './ui/panels';
import { demoDoc } from './core/demo';

/* ------------------------------------------------------------------ setup */
const stage = document.getElementById('stage') as HTMLDivElement;
const sceneCanvas = document.getElementById('scene') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const sceneCtx = sceneCanvas.getContext('2d') as CanvasRenderingContext2D;
const overlayCtx = overlayCanvas.getContext('2d') as CanvasRenderingContext2D;

const view = new View();
const store = new Store(view);
const tools = createTools();

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let dirtyScene = true;
let dirtyOverlay = true;
let rafId = 0;
let issues: Issue[] = [];

function requestRender(kind: 'scene' | 'overlay' | 'both' = 'both'): void {
  if (kind !== 'overlay') dirtyScene = true;
  if (kind !== 'scene') dirtyOverlay = true;
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function frame(): void {
  rafId = 0;
  const { doc, sheet, hover } = store.state;
  if (dirtyScene) {
    renderScene(sceneCtx, doc, sheet, view, dpr, hover, null);
    dirtyScene = false;
  }
  if (dirtyOverlay) {
    const tool = tools[store.state.tool];
    const ov = tool ? tool.overlay() : emptyOverlay();
    renderOverlay(overlayCtx, {
      doc, sheet, view, dpr,
      selection: store.state.selection,
      marquee: ov.marquee,
      snap: ov.snap,
      drawExtra: (ctx) => {
        ov.draw?.(ctx, view, dpr);
        if (store.state.tool === 'node') drawNodes(ctx);
      },
    });
    dirtyOverlay = false;
  }
}

function drawNodes(ctx: CanvasRenderingContext2D): void {
  const objs = store.selected();
  if (!objs.length) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const obj of objs) {
    for (const node of pathNodes(obj.path)) {
      const world = { x: obj.transform.a * node.p.x + obj.transform.c * node.p.y + obj.transform.e, y: obj.transform.b * node.p.x + obj.transform.d * node.p.y + obj.transform.f };
      const s = view.toScreen(world);
      const active = nodeToolState.active && nodeToolState.active.sub === node.ref.sub && nodeToolState.active.index === node.ref.index && nodeToolState.objectId === obj.id;
      const size = active ? 8 : 6;
      ctx.beginPath();
      ctx.rect(s.x - size / 2, s.y - size / 2, size, size);
      ctx.fillStyle = active ? theme.accent : '#ffffff';
      ctx.strokeStyle = theme.handleStroke;
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
    }
  }
}

function resize(): void {
  const rect = stage.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const cv of [sceneCanvas, overlayCanvas]) {
    cv.width = Math.max(1, Math.round(rect.width * dpr));
    cv.height = Math.max(1, Math.round(rect.height * dpr));
  }
  view.resize(rect.width, rect.height);
  requestRender('both');
}
new ResizeObserver(resize).observe(stage);
// прокрутка панели/страницы и смена масштаба окна не должны оставлять следов кадра
window.addEventListener('scroll', () => requestRender('both'), { passive: true });
window.addEventListener('resize', () => resize());

/* ------------------------------------------------------------------ helpers */
let statusHint: string | null = null;

const toolCtx: ToolCtx = {
  store,
  view,
  snapAt(p: Vec2, exclude?: Set<string>): SnapResult | null {
    const { doc, sheet, token } = store.state;
    return findSnap(p, doc, sheet, token, {
      gridStep: sheet.gridStep,
      snapGrid: sheet.snapGrid,
      snapObjects: sheet.snapObjects,
      tolMm: view.px(9),
      exclude,
    });
  },
  render: requestRender,
  setCursor(cursor: string) { overlayCanvas.style.cursor = cursor; },
  setStatus(text: string | null) { statusHint = text; updateStatus(); },
};

function updateStatus(): void {
  const el = document.getElementById('st-hint');
  if (el) el.textContent = statusHint ?? '';
}

function fitSheet(): void {
  const s = store.state.sheet;
  view.fit({ x: -6, y: -6, w: s.width + 12, h: s.height + 12 }, 40);
  updateZoomLabel();
  requestRender('both');
}

function updateZoomLabel(): void {
  const label = `${Math.round(view.scale * 100)}%`;
  const el = document.getElementById('zoom-val');
  if (el) el.textContent = label;
  const st = document.getElementById('st-zoom');
  if (st) st.textContent = label;
}

function updateStaticStatus(): void {
  const { doc, sheet } = store.state;
  let count = 0;
  let length = 0;
  for (const id of doc.order) {
    const obj = doc.objects[id];
    if (!obj || obj.sheetId !== sheet.id || obj.hidden) continue;
    count += 1;
    length += pathLength(transformSubPaths(obj.path, obj.transform));
  }
  const countEl = document.getElementById('st-count');
  if (countEl) countEl.textContent = `объектов ${count}`;
  const lenEl = document.getElementById('st-length');
  if (lenEl) lenEl.textContent = `длина ${length.toFixed(0)} мм`;
  const rows = store.state.doc.layers.map((layer) => {
    let count = 0;
    let len = 0;
    for (const id of doc.order) {
      const obj = doc.objects[id];
      if (!obj || obj.sheetId !== sheet.id || obj.layerId !== layer.id || obj.hidden) continue;
      count += 1;
      len += pathLength(transformSubPaths(obj.path, obj.transform));
    }
    const name = layer.op === 'cut' ? 'Рез' : layer.op === 'engrave' ? 'Гравировка' : 'Биговка';
    return { label: `${name}: ${count} об.`, value: `${(len / 1000).toFixed(2)} м` };
  });
  rows.push({ label: 'Всего путей', value: `${(length / 1000).toFixed(2)} м` });
  rows.push({ label: 'Площадь выделения', value: objsAreaText() });
  setStats(rows);

  const sheetEl = document.getElementById('st-sheet');
  if (sheetEl) sheetEl.textContent = `Лист ${sheet.width} × ${sheet.height} мм`;
}

function objsAreaText(): string {
  const objs = store.selected();
  if (!objs.length) return '—';
  const area = objs.reduce((sum, o) => sum + bboxOfSubPaths(transformSubPaths(o.path, o.transform)).w * bboxOfSubPaths(transformSubPaths(o.path, o.transform)).h, 0);
  return `${(area / 100).toFixed(1)} см²`;
}

store.subscribe((_state, kind) => {
  if (kind === 'doc' || kind === 'tool') updateStaticStatus();
  requestRender(kind === 'doc' ? 'both' : 'overlay');
  if (kind === 'doc') {
    scheduleAutosave();
    scheduleCheck();
  }
});

/* ------------------------------------------------------------------ toast */
let toastTimer: number | undefined;
function toast(text: string, ms = 3200): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, ms);
}

/* ------------------------------------------------------------------ check */
let checkTimer: number | undefined;
function scheduleCheck(): void {
  window.clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => runCheck(false), 350);
}
function runCheck(notify = true): void {
  issues = validateDoc(store.state.doc, store.state.sheet);
  setIssues(issues);
  if (notify) toast(issues.length ? issues[0].message : 'Проверка пройдена: замечаний нет');
}

/* ------------------------------------------------------------------ autosave */
const AUTOSAVE_KEY = 'lasercut.doc.v1';
let saveTimer: number | undefined;

function storage(): Storage | null {
  try {
    const t = '__lcx_test__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch {
    return null;
  }
}
const store_ = storage();

function scheduleAutosave(): void {
  window.clearTimeout(saveTimer);
  setAutosaveStatus('сохраняю…');
  saveTimer = window.setTimeout(() => {
    if (!store_) { setAutosaveStatus('недоступно в песочнице — скачайте проект'); return; }
    try {
      store_.setItem(AUTOSAVE_KEY, JSON.stringify(store.state.doc));
      setAutosaveStatus(`сохранено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
    } catch {
      setAutosaveStatus('не удалось сохранить (переполнение)');
    }
  }, 700);
}

function restoreAutosave(): Doc | null {
  if (!store_) return null;
  try {
    const raw = store_.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as Doc;
    if (doc?.schemaVersion !== 1 || !Array.isArray(doc.sheets) || !doc.objects) return null;
    return doc;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ files */
function download(name: string, data: string | Blob, mime = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: `${mime};charset=utf-8` }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const baseName = (): string => slug(store.state.doc.meta.name || 'lasercut');

function exportAs(kind: ExportKind): void {
  const doc = store.state.doc;
  const sheet = store.state.sheet;
  try {
    if (kind === 'dxf' || kind === 'dxf12') {
      const text = exportDxf(doc, { version: kind === 'dxf' ? 'R2000' : 'R12', sheetId: sheet.id });
      download(`${baseName()}.dxf`, text, 'application/dxf');
      toast(`DXF ${kind === 'dxf' ? 'R2000' : 'R12'} сохранён: слои CUT/ENGRAVE, миллиметры`);
      return;
    }
    if (kind === 'svg') {
      download(`${baseName()}.svg`, exportSvg(doc, { sheetId: sheet.id }), 'image/svg+xml');
      toast('SVG сохранён — открывается в LightBurn и Inkscape');
      return;
    }
    if (kind === 'png') {
      exportPng(sheet.width, sheet.height);
      return;
    }
    if (kind === 'project') {
      download(`${baseName()}.lcx`, JSON.stringify(doc, null, 1), 'application/json');
      toast('Проект сохранён — откройте его кнопкой «Открыть…»');
      return;
    }
    if (kind === ('dxf-all' as ExportKind)) {
      const files = exportDxfSheets(doc);
      for (const f of files) download(f.name, f.text, 'application/dxf');
      return;
    }
  } catch (err) {
    toast(`Ошибка экспорта: ${(err as Error).message}`);
  }
}

function exportPng(sheetW: number, sheetH: number): void {
  const pxPerMm = 4; // ~100 dpi
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sheetW * pxPerMm));
  canvas.height = Math.max(1, Math.round(sheetH * pxPerMm));
  const ctx = canvas.getContext('2d');
  if (!ctx) { toast('Браузер не дал canvas для PNG'); return; }
  const v = new View();
  v.resize(canvas.width, canvas.height);
  v.scale = pxPerMm;
  v.tx = 0;
  v.ty = canvas.height;
  const sheetCopy = { ...store.state.sheet, showGrid: false };
  renderScene(ctx, store.state.doc, sheetCopy, v, 1, null, null);
  canvas.toBlob((blob) => {
    if (!blob) { toast('Не удалось собрать PNG'); return; }
    download(`${baseName()}.png`, blob, 'image/png');
    toast('PNG сохранён (4 px/мм ≈ 100 dpi)');
  }, 'image/png');
}

function pickFile(): void {
  const input = document.getElementById('file-input') as HTMLInputElement;
  input.value = '';
  input.click();
}

async function handleFile(file: File): Promise<void> {
  const name = file.name.toLowerCase();
  try {
    const text = await file.text();
    if (name.endsWith('.dxf')) importDxfFile(text);
    else if (name.endsWith('.svg')) importSvgFile(text);
    else if (name.endsWith('.lcx') || name.endsWith('.json')) importProject(text);
    else toast('Поддерживаются DXF, SVG и проект .lcx');
  } catch (err) {
    toast(`Не удалось открыть файл: ${(err as Error).message}`);
  }
}

function importDxfFile(text: string): void {
  const { sheet, doc } = store.state;
  const cut = doc.layers[0];
  const engrave = doc.layers[1] ?? doc.layers[0];
  const result = importDxf(text, {
    sheetId: sheet.id,
    cutLayerId: cut.id,
    engraveLayerId: engrave.id,
    cutColor: cut.color,
    engraveColor: engrave.color,
    textToPaths: (t, h) => textToPaths(t, h)?.paths ?? null,
  });
  if (!result.objects.length) {
    toast(`В файле не нашлось геометрии. ${result.warnings[0] ?? ''}`);
    return;
  }
  const patches = result.objects.map((obj) => ({ kind: 'add' as const, obj }));
  store.commit({ label: 'Импорт DXF', patches });
  store.select(result.objects.map((o) => o.id));
  growSheetToFit(result.bbox);
  const warn = result.warnings.length ? ` · ${result.warnings.slice(0, 2).join('; ')}` : '';
  toast(`Загружено объектов: ${result.objects.length}${warn}`);
  fitSheet();
}

function importSvgFile(text: string): void {
  const parsed = parseSvg(text);
  if (!parsed.paths.length) {
    toast(`В SVG не нашлось контуров. ${parsed.warnings[0] ?? ''}`);
    return;
  }
  const layer = store.activeLayer();
  const obj = makeObj({
    sheetId: store.state.sheet.id,
    layerId: layer.id,
    path: parsed.paths,
    transform: IDENT,
    style: emptyStyle(layer),
    name: 'Из SVG',
  });
  store.commit({ label: 'Импорт SVG', patches: [{ kind: 'add', obj }] });
  store.select([obj.id]);
  growSheetToFit(bboxOfSubPaths(parsed.paths));
  toast(parsed.warnings.length ? `SVG загружен · ${parsed.warnings[0]}` : 'SVG загружен');
  fitSheet();
}

function importProject(text: string): void {
  const doc = JSON.parse(text) as Doc;
  if (doc.schemaVersion !== 1 || !doc.sheets?.length) throw new Error('это не проект LaserCut Studio');
  store.loadDoc(doc);
  fitSheet();
  toast('Проект открыт');
}

function growSheetToFit(box: { x: number; y: number; w: number; h: number } | null): void {
  if (!box) return;
  const sheet = store.state.sheet;
  const needW = Math.max(sheet.width, Math.ceil(box.x + box.w + 10));
  const needH = Math.max(sheet.height, Math.ceil(box.y + box.h + 10));
  if (needW > sheet.width || needH > sheet.height) {
    store.updateSheet({ width: Math.min(3000, needW), height: Math.min(3000, needH) });
  }
}

/* ------------------------------------------------------------------ pointer */
let panning = false;
let spaceDown = false;
let panLast: Vec2 | null = null;
let dragging = false;

const localPoint = (e: PointerEvent | WheelEvent | MouseEvent): Vec2 => {
  const rect = overlayCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

overlayCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

overlayCanvas.addEventListener('pointerdown', (e) => {
  overlayCanvas.setPointerCapture(e.pointerId);
  dragging = true;
  const sp = localPoint(e);
  if (spaceDown || e.button === 1) {
    panning = true;
    panLast = sp;
    overlayCanvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  tools[store.state.tool]?.down(view.toMm(sp), e, toolCtx);
});

overlayCanvas.addEventListener('pointermove', (e) => {
  const sp = localPoint(e);
  const mm = view.toMm(sp);
  const cursorEl = document.getElementById('st-cursor');
  if (cursorEl) cursorEl.textContent = `x ${mm.x.toFixed(2)} · y ${mm.y.toFixed(2)} мм`;

  if (panning && panLast) {
    view.panBy(sp.x - panLast.x, sp.y - panLast.y);
    panLast = sp;
    requestRender('both');
    return;
  }
  tools[store.state.tool]?.move(mm, e, toolCtx);
  if (store.state.tool === 'select' && !dragging) store.setHover(pickObject(store.state.doc, store.state.sheet, mm, view.px(6)));
});

overlayCanvas.addEventListener('pointerup', (e) => {
  const mm = view.toMm(localPoint(e));
  if (panning) {
    panning = false;
    panLast = null;
    dragging = false;
    overlayCanvas.style.cursor = spaceDown ? 'grab' : 'default';
    return;
  }
  tools[store.state.tool]?.up(mm, e, toolCtx);
  dragging = false;
});

overlayCanvas.addEventListener('dblclick', (e) => {
  const mm = view.toMm(localPoint(e));
  tools[store.state.tool]?.down(mm, new PointerEvent('pointerdown', { detail: 2, button: 0 }), toolCtx);
});

overlayCanvas.addEventListener('pointercancel', () => {
  panning = false;
  dragging = false;
  tools[store.state.tool]?.cancel(toolCtx);
});

overlayCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoomAt(localPoint(e), Math.exp(-e.deltaY * 0.0016));
  updateZoomLabel();
  requestRender('both');
}, { passive: false });

/* ------------------------------------------------------------------ drag&drop */
const dropZone = document.getElementById('drop-zone') as HTMLDivElement;

/** Показывать подсказку только для перетаскивания файлов, а не выделения текста. */
function isFileDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.prototype.indexOf.call(types, 'Files') !== -1;
}

let dropTimer: number | undefined;
/** Подсказка не должна «зависать» ни при каком сценарии: плюс автоскрытие через 8 с. */
function showDropZone(show: boolean): void {
  dropZone.hidden = !show;
  window.clearTimeout(dropTimer);
  if (show) {
    dropTimer = window.setTimeout(() => {
      dragDepth = 0;
      dropZone.hidden = true;
    }, 8000);
  }
}

// Счётчик входов/выходов: dragleave срабатывает и при переходе на дочерний
// элемент (canvas), из-за чего подсказка «мигала» и могла остаться навсегда,
// если файл уводили за пределы окна. Отслеживаем на уровне окна.
let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth += 1;
  showDropZone(true);
});

window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  showDropZone(true); // страховка: dragenter иногда теряется при быстром движении
});

window.addEventListener('dragleave', (e) => {
  // relatedTarget === null — курсор ушёл за пределы окна
  if (e.relatedTarget === null) {
    dragDepth = 0;
    showDropZone(false);
    return;
  }
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) showDropZone(false);
});

window.addEventListener('drop', (e) => {
  e.preventDefault(); // иначе браузер откроет файл вместо редактора
  dragDepth = 0;
  showDropZone(false);
  const file = e.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});

// Страховки: перетаскивание отменили (Esc), окно потеряло фокус, файл «завис»
window.addEventListener('dragend', () => { dragDepth = 0; showDropZone(false); });
window.addEventListener('blur', () => { dragDepth = 0; showDropZone(false); });
document.addEventListener('pointerdown', () => { if (!dropZone.hidden) { dragDepth = 0; showDropZone(false); } });

/* ------------------------------------------------------------------ keyboard */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  // Подсказка перетаскивания обещает «Esc — отмена»: закрываем её первой.
  if (e.key === 'Escape' && !dropZone.hidden) {
    dragDepth = 0;
    showDropZone(false);
    e.preventDefault();
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (e.code === 'Space') { spaceDown = true; overlayCanvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) actions.redo(); else actions.undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); actions.redo(); return; }
  if (mod && key === 'd') { e.preventDefault(); actions.duplicate(); return; }
  if (mod && key === 's') { e.preventDefault(); exportAs('project'); return; }
  if (mod && key === 'o') { e.preventDefault(); pickFile(); return; }
  if (mod && key === 'q') { e.preventDefault(); nodeToolOp('curve'); return; }
  if (mod && key === 'g') { e.preventDefault(); if (e.shiftKey) actions.ungroup(); else actions.group(); return; }
  if (mod && key === 'a') {
    e.preventDefault();
    store.select(store.state.doc.order.filter((id) => store.state.doc.objects[id]?.sheetId === store.state.sheet.id));
    return;
  }
  if (mod && key === '0') { e.preventDefault(); fitSheet(); return; }
  if (mod) return;

  switch (key) {
    case 'v': actions.setTool('select'); return;
    case 'n': actions.setTool('node'); return;
    case 'l': actions.setTool('line'); return;
    case 'r': actions.setTool('rect'); return;
    case 'e': actions.setTool('ellipse'); return;
    case 't': actions.setTool('text'); return;
    case 'delete':
    case 'backspace':
      e.preventDefault();
      if (store.state.tool === 'node' && nodeToolState.active) nodeToolOp('delete');
      else actions.deleteSelection();
      return;
    case 'escape':
      dragDepth = 0;
      showDropZone(false);
      tools[store.state.tool]?.cancel(toolCtx);
      store.select([]);
      actions.setTool('select');
      return;
    case '+':
    case '=': actions.zoom(1.25); return;
    case '-': actions.zoom(1 / 1.25); return;
    case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown': {
      e.preventDefault();
      const step = e.ctrlKey ? 0.1 : e.shiftKey ? 10 : 1;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? step : key === 'arrowdown' ? -step : 0;
      const objs = store.selected();
      if (objs.length) store.commit(updateCmd('Сдвиг', objs.map((o) => ({ before: o, after: nudge(o, dx, dy) }))));
      else { view.panBy(-dx * view.scale * 4, dy * view.scale * 4); requestRender('both'); }
      return;
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; overlayCanvas.style.cursor = 'default'; }
});

/* ------------------------------------------------------------------ actions */
function nodeToolOp(op: NodeOp): void {
  const map: Record<NodeOp, (c: ToolCtx) => void> = {
    curve: nodeOpCurve,
    line: nodeOpLine,
    close: nodeOpClose,
    break: nodeOpBreak,
    delete: nodeOpDelete,
  };
  map[op](toolCtx);
}

const actions = {
  undo(): void { store.undo(); requestRender('both'); },
  redo(): void { store.redo(); requestRender('both'); },
  zoom(factor: number): void { view.zoomCenter(factor); updateZoomLabel(); requestRender('both'); },
  fit(): void { fitSheet(); },
  demo(): void { store.loadDoc(demoDoc()); fitSheet(); toast('Демо-макет загружен'); },
  clearSheet(): void {
    const objs = store.state.doc.order.map((id) => store.state.doc.objects[id]).filter((o): o is Obj => !!o);
    if (!objs.length) return;
    store.commit({ label: 'Очистить лист', patches: objs.map((obj) => ({ kind: 'remove' as const, obj })) });
    store.select([]);
    toast('Лист очищен (Ctrl+Z вернёт)');
  },
  duplicate(): void {
    const objs = store.selected();
    if (!objs.length) return;
    const copies = objs.map((o) => duplicate(o, uid(), 5, 5));
    store.commit({ label: 'Дублировать', patches: copies.map((obj) => ({ kind: 'add' as const, obj })) });
    store.select(copies.map((c) => c.id));
  },
  deleteSelection(): void {
    const objs = store.selected();
    if (!objs.length) return;
    store.commit({ label: 'Удалить', patches: objs.map((obj) => ({ kind: 'remove' as const, obj })) });
    store.select([]);
  },
  setTool(id: ToolId): void {
    tools[store.state.tool]?.cancel(toolCtx);
    store.setTool(id);
    overlayCanvas.style.cursor = tools[id]?.cursor ?? 'default';
    requestRender('overlay');
  },
  openFile(): void { pickFile(); },
  exportAs,
  runCheck(): void { runCheck(true); },
  focusIssue(issue: Issue): void {
    store.select(issue.objectIds);
    if (issue.at) {
      view.tx = view.width / 2 - issue.at.x * view.scale;
      view.ty = view.height / 2 + issue.at.y * view.scale;
    }
    requestRender('both');
  },
  align(mode: 'left' | 'hcenter' | 'right' | 'bottom' | 'vcenter' | 'top'): void {
    alignSelection(store, mode, store.state.alignRef);
  },
  distribute(axis: 'x' | 'y'): void {
    const err = distributeSelection(store, axis);
    if (err) toast(err);
  },
  booleanOp(op: 'union' | 'diff' | 'intersect' | 'xor'): void {
    const err = applyBoolean(store, op);
    if (err) toast(err);
  },
  offset(delta: number): void {
    const err = applyOffset(store, delta);
    if (err) toast(err);
  },
  duplicatePattern(mode: 'row' | 'circle'): void {
    const count = Math.max(1, Math.round(Number((document.getElementById('dup-count') as HTMLInputElement).value) || 1));
    const step = Number((document.getElementById('dup-step') as HTMLInputElement).value) || 20;
    const err = duplicatePattern(store, mode, { countX: count, countY: 1, stepX: step, stepY: step, radius: step, rotate: mode === 'circle' });
    if (err) toast(err);
  },
  group(): void { const err = groupSelection(store); if (err) toast(err); else toast('Сгруппировано'); },
  ungroup(): void { const err = ungroupSelection(store); if (err) toast(err); },
  reorder(dir: 'front' | 'back'): void { reorderSelection(store, dir); },
  nodeOp: nodeToolOp,
  setTextHeight(mm: number): void { setTextHeight(mm); },
  transform(kind: 'rot90' | 'rot-90' | 'mirrorH' | 'mirrorV'): void {
    const err = transformSelection(store, kind);
    if (err) toast(err);
    requestRender('both');
  },
  nest(all: boolean, opts: { gap: number; margin: number; allowRotate: boolean }): void {
    const before = store.selected().map((o) => o.id);
    const msg = nestSelection(store, opts, all);
    if (!all) store.select(before);
    requestRender('both');
    toast(msg);
  },
  toast,
};

initUI(store, actions);

/* ------------------------------------------------------------------ focus issue event */
window.addEventListener('lcx:focus-issue', (e) => {
  const detail = (e as CustomEvent<Issue>).detail;
  if (detail) actions.focusIssue(detail);
});

/* ------------------------------------------------------------------ demo for tests / reset */
function newDemo(): Doc {
  return demoDoc();
}
void newDemo;

/* ------------------------------------------------------------------ boot */
resize();
const restored = restoreAutosave();
store.loadDoc(restored ?? demoDoc());
setTimeout(fitSheet, 0);
updateZoomLabel();
updateStaticStatus();
runCheck(false);
requestAnimationFrame(() => {
  fitSheet();
  requestRender('both');
  if (restored) toast('Восстановлен автосохранённый макет');
});

void ensureFont().then((ok) => {
  if (!ok) toast('Шрифт для текста не загрузился — инструмент «Текст» недоступен');
});

document.getElementById('file-input')?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void handleFile(file);
});

/* экспорт доступен и из консоли (удобно для проверок) */
(window as unknown as { lcx?: unknown }).lcx = { store, view, exportDxf, exportSvg, validateDoc, boxUnion };
