import type { Vec2 } from './core/types';
import { pathLength, transformSubPaths } from './core/geom/path';
import { findSnap, type SnapResult } from './core/snap';
import { Store, type ToolId } from './state/store';
import { updateCmd } from './state/history';
import { duplicate, nudge } from './state/edits';
import { uid } from './core/shape';
import { View } from './render/view';
import { renderScene } from './render/scene';
import { renderOverlay, selectionBBox } from './render/overlay';
import { pickObject } from './core/geom/hit';
import { demoDoc } from './core/demo';
import { createTools } from './tools';
import { emptyOverlay, type ToolCtx } from './tools/tool';
import { initUI } from './ui/panels';

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
      drawExtra: ov.draw,
    });
    dirtyOverlay = false;
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

/* ------------------------------------------------------------------ helpers */
function fitSheet(): void {
  const s = store.state.sheet;
  view.fit({ x: -6, y: -6, w: s.width + 12, h: s.height + 12 }, 40);
  requestRender('both');
}

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
  setCursor(cursor: string) {
    overlayCanvas.style.cursor = cursor;
  },
  setStatus(text: string | null) {
    statusHint = text;
    updateStatus();
  },
};

function updateStatus(): void {
  const el = document.getElementById('st-hint');
  if (el) el.textContent = statusHint ?? '';
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
  const sheetEl = document.getElementById('st-sheet');
  if (sheetEl) sheetEl.textContent = `Лист ${sheet.width} × ${sheet.height} мм`;

  void selectionBBox;
}

store.subscribe((_state, kind) => {
  if (kind === 'doc' || kind === 'tool') updateStaticStatus();
  requestRender(kind === 'doc' ? 'both' : 'overlay');
});

/* ------------------------------------------------------------------ pointer */
let panning = false;
let spaceDown = false;
let panLast: Vec2 | null = null;
let dragging = false;

function localPoint(e: PointerEvent | WheelEvent | MouseEvent): Vec2 {
  const rect = overlayCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

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
  const mm = view.toMm(sp);
  const tool = tools[store.state.tool];
  tool?.down(mm, e, toolCtx);
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
  const tool = tools[store.state.tool];
  tool?.move(mm, e, toolCtx);

  if (store.state.tool === 'select' && !dragging) store.setHover(pickHover(mm));
});

overlayCanvas.addEventListener('pointerup', (e) => {
  const sp = localPoint(e);
  const mm = view.toMm(sp);
  if (panning) {
    panning = false;
    panLast = null;
    dragging = false;
    overlayCanvas.style.cursor = spaceDown ? 'grab' : 'default';
    return;
  }
  const tool = tools[store.state.tool];
  tool?.up(mm, e, toolCtx);
  dragging = false;
  if (store.state.tool === 'select') store.setHover(pickHover(mm));
});

overlayCanvas.addEventListener('pointercancel', () => {
  panning = false;
  dragging = false;
  tools[store.state.tool]?.cancel(toolCtx);
});

function pickHover(p: Vec2): string | null {
  return pickObject(store.state.doc, store.state.sheet, p, view.px(6));
}

overlayCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const sp = localPoint(e);
  const factor = Math.exp(-e.deltaY * 0.0016);
  view.zoomAt(sp, factor);
  updateZoomLabel();
  requestRender('both');
}, { passive: false });

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
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (e.code === 'Space') { spaceDown = true; overlayCanvas.style.cursor = 'grab'; e.preventDefault(); return; }

  if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (mod && key === 'y') { e.preventDefault(); store.redo(); return; }
  if (mod && key === 'd') { e.preventDefault(); actions.duplicate(); return; }
  if (mod && key === 'a') {
    e.preventDefault();
    store.select(store.state.doc.order.filter((id) => store.state.doc.objects[id]?.sheetId === store.state.sheet.id));
    return;
  }
  if (mod && key === '0') { e.preventDefault(); fitSheet(); return; }
  if (mod) return;

  switch (key) {
    case 'v': setTool('select'); return;
    case 'l': setTool('line'); return;
    case 'r': setTool('rect'); return;
    case 'e': setTool('ellipse'); return;
    case 'delete':
    case 'backspace': e.preventDefault(); actions.deleteSelection(); return;
    case 'escape':
      tools[store.state.tool]?.cancel(toolCtx);
      store.select([]);
      setTool('select');
      return;
    case '+':
    case '=': view.zoomCenter(1.25); updateZoomLabel(); requestRender('both'); return;
    case '-': view.zoomCenter(1 / 1.25); updateZoomLabel(); requestRender('both'); return;
    case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown': {
      e.preventDefault();
      const step = e.ctrlKey ? 0.1 : e.shiftKey ? 10 : 1;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? step : key === 'arrowdown' ? -step : 0;
      const objs = store.selected();
      if (objs.length) {
        store.commit(updateCmd('Сдвиг', objs.map((o) => ({ before: o, after: nudge(o, dx, dy) }))));
      } else {
        view.panBy(-dx * view.scale * 4, dy * view.scale * 4);
        requestRender('both');
      }
      return;
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceDown = false;
    overlayCanvas.style.cursor = 'default';
  }
});

function updateZoomLabel(): void {
  const el = document.getElementById('zoom-val');
  if (el) el.textContent = `${Math.round(view.scale * 100)}%`;
  const st = document.getElementById('st-zoom');
  if (st) st.textContent = `${Math.round(view.scale * 100)}%`;
}

function setTool(id: ToolId): void {
  const prev = tools[store.state.tool];
  prev?.cancel(toolCtx);
  store.setTool(id);
  overlayCanvas.style.cursor = tools[id]?.cursor ?? 'default';
  requestRender('overlay');
}

/* ------------------------------------------------------------------ actions */
const actions = {
  undo(): void { store.undo(); requestRender('both'); },
  redo(): void { store.redo(); requestRender('both'); },
  zoom(factor: number): void { view.zoomCenter(factor); updateZoomLabel(); requestRender('both'); },
  fit(): void { fitSheet(); updateZoomLabel(); },
  demo(): void { store.loadDoc(demoDoc()); fitSheet(); updateZoomLabel(); updateStaticStatus(); },
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
  setTool,
  refresh(): void { requestRender('both'); updateStaticStatus(); },
};

initUI(store, actions);

/* ------------------------------------------------------------------ boot */
resize();
store.loadDoc(demoDoc());
fitSheet();
updateZoomLabel();
updateStaticStatus();
requestRender('both');

// тёплый старт: первый кадр после отрисовки шрифтов/лейаута
requestAnimationFrame(() => {
  fitSheet();
  updateZoomLabel();
  requestRender('both');
});
