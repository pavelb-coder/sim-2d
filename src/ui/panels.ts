import type { AppState, Store, ToolId } from '../state/store';
import { TOOL_DEFS } from '../tools';
import { SHEET_PRESETS } from '../core/doc';
import { setBBox, rotateTo } from '../state/edits';
import { updateCmd } from '../state/history';
import { pathLength, transformSubPaths, worldBBox } from '../core/geom/path';
import { decompose } from '../core/geom/transform';
import type { Obj, Op } from '../core/types';
import { uid } from '../core/shape';
import { duplicate } from '../state/edits';

export interface UIActions {
  undo(): void;
  redo(): void;
  zoom(factor: number): void;
  fit(): void;
  demo(): void;
  duplicate(): void;
  deleteSelection(): void;
  setTool(id: ToolId): void;
  refresh(): void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const val = (id: string): number => {
  const el = $<HTMLInputElement>(id);
  const n = parseFloat(el.value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const setVal = (id: string, v: number): void => {
  const el = $<HTMLInputElement>(id);
  if (document.activeElement === el) return;
  el.value = String(+v.toFixed(3));
};

export function initUI(store: Store, actions: UIActions): void {
  /* ---------- панель инструментов ---------- */
  const toolbar = $('toolbar');
  for (const def of TOOL_DEFS) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.tool = def.id;
    btn.title = def.available ? `${def.label} (${def.key})` : `${def.label} — следующий шаг`;
    btn.disabled = !def.available;
    btn.innerHTML = `<svg viewBox="0 0 21 21" aria-hidden="true">${def.icon}</svg><span class="key">${def.key}</span>`;
    btn.addEventListener('click', () => actions.setTool(def.id));
    toolbar.appendChild(btn);
  }
  const sep = document.createElement('div');
  sep.className = 'toolbar-sep';
  toolbar.appendChild(sep);

  /* ---------- шапка ---------- */
  $('btn-undo').addEventListener('click', actions.undo);
  $('btn-redo').addEventListener('click', actions.redo);
  $('btn-zoom-in').addEventListener('click', () => actions.zoom(1.25));
  $('btn-zoom-out').addEventListener('click', () => actions.zoom(1 / 1.25));
  $('btn-fit').addEventListener('click', actions.fit);
  $('zoom-val').addEventListener('click', actions.fit);
  $('btn-demo').addEventListener('click', actions.demo);
  $('btn-duplicate').addEventListener('click', actions.duplicate);
  $('btn-delete').addEventListener('click', actions.deleteSelection);

  /* ---------- лист ---------- */
  const presetSel = $<HTMLSelectElement>('sheet-preset');
  for (const p of SHEET_PRESETS) {
    const opt = document.createElement('option');
    opt.value = `${p.w}x${p.h}`;
    opt.textContent = `${p.label} (${p.w}×${p.h})`;
    presetSel.appendChild(opt);
  }
  presetSel.addEventListener('change', () => {
    const [w, h] = presetSel.value.split('x').map(Number);
    if (w && h) { store.updateSheet({ width: w, height: h }); actions.refresh(); }
  });
  $('sheet-w').addEventListener('change', () => store.updateSheet({ width: Math.max(10, val('sheet-w')) }));
  $('sheet-h').addEventListener('change', () => store.updateSheet({ height: Math.max(10, val('sheet-h')) }));
  $<HTMLSelectElement>('grid-step').addEventListener('change', (e) => {
    store.updateSheet({ gridStep: Number((e.target as HTMLSelectElement).value) });
  });
  $<HTMLInputElement>('chk-grid').addEventListener('change', (e) => store.updateSheet({ showGrid: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('chk-snap-grid').addEventListener('change', (e) => store.updateSheet({ snapGrid: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('chk-snap-obj').addEventListener('change', (e) => store.updateSheet({ snapObjects: (e.target as HTMLInputElement).checked }));

  /* ---------- свойства объекта ---------- */
  const applyGeometry = (): void => {
    const objs = store.selected();
    if (objs.length !== 1) return; // для группы правим только перемещением/удалением
    const pairs = objs.map((o) => ({ before: o, after: setBBox(o, { x: val('prop-x'), y: val('prop-y'), w: val('prop-w'), h: val('prop-h') }) }));
    store.commit(updateCmd('Размер и положение', pairs));
  };
  for (const id of ['prop-x', 'prop-y', 'prop-w', 'prop-h']) {
    $(id).addEventListener('change', applyGeometry);
  }
  $('prop-rot').addEventListener('change', () => {
    const objs = store.selected();
    if (!objs.length) return;
    const deg = val('prop-rot');
    store.commit(updateCmd('Поворот', objs.map((o) => ({ before: o, after: rotateTo(o, deg) }))));
  });

  /* ---------- слой и стиль ---------- */
  const layerSeg = $('layer-seg');
  layerSeg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
    if (!btn) return;
    const op = btn.dataset.layerOp as Op;
    const layer = store.state.doc.layers.find((l) => l.op === op);
    if (layer) store.moveSelectionToLayer(layer.id);
    actions.refresh();
  });

  const applyStyle = (patch: Partial<Obj['style']>): void => {
    const objs = store.selected();
    if (!objs.length) return;
    store.commit(updateCmd('Стиль', objs.map((o) => ({ before: o, after: { ...o, style: { ...o.style, ...patch } } }))));
  };
  $('stroke-color').addEventListener('input', (e) => applyStyle({ stroke: (e.target as HTMLInputElement).value }));
  $('stroke-width').addEventListener('change', () => applyStyle({ strokeWidth: Math.max(0, val('stroke-width')) }));
  $<HTMLInputElement>('chk-fill').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    applyStyle({ fill: on ? $<HTMLInputElement>('fill-color').value : null });
    $('row-fill').hidden = !on;
  });
  $('fill-color').addEventListener('input', (e) => {
    if ($<HTMLInputElement>('chk-fill').checked) applyStyle({ fill: (e.target as HTMLInputElement).value });
  });

  /* ---------- синхронизация UI со состоянием ---------- */
  function sync(state: AppState): void {
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn')) {
      btn.classList.toggle('is-active', btn.dataset.tool === state.tool);
    }
    $<HTMLButtonElement>('btn-undo').disabled = !store.history.canUndo;
    $<HTMLButtonElement>('btn-redo').disabled = !store.history.canRedo;

    const sheet = state.sheet;
    setVal('sheet-w', sheet.width);
    setVal('sheet-h', sheet.height);
    $<HTMLSelectElement>('grid-step').value = String(sheet.gridStep);
    $<HTMLInputElement>('chk-grid').checked = sheet.showGrid;
    $<HTMLInputElement>('chk-snap-grid').checked = sheet.snapGrid;
    $<HTMLInputElement>('chk-snap-obj').checked = sheet.snapObjects;
    presetSel.value = `${sheet.width}x${sheet.height}`;

    const objs = store.selected();
    const body = $('props-body');
    const empty = $('props-empty');
    if (!objs.length) {
      $('group-note').hidden = true;
      body.hidden = true;
      empty.hidden = false;
    } else {
      body.hidden = false;
      empty.hidden = true;
      const single = objs.length === 1;
      const box = single
        ? worldBBox(objs[0].path, objs[0].transform)
        : unionBox(objs);
      setVal('prop-x', box.x);
      setVal('prop-y', box.y);
      setVal('prop-w', box.w);
      setVal('prop-h', box.h);
      const rot = (decompose(objs[0].transform).rotation * 180) / Math.PI;
      setVal('prop-rot', Math.round(rot * 100) / 100);
      const isLine = single && objs[0].path.length === 1 && objs[0].path[0].segs.length === 1 && objs[0].path[0].segs[0].t === 'l';
      $('row-length').hidden = !isLine;
      if (isLine) $('prop-len').textContent = `${pathLength(transformSubPaths(objs[0].path, objs[0].transform)).toFixed(2)} мм`;
      for (const id of ['prop-x', 'prop-y', 'prop-w', 'prop-h', 'prop-rot']) $<HTMLInputElement>(id).disabled = !single;
      $('props-empty').hidden = true;
      $('group-note').hidden = single;
    }

    const activeOp = store.activeLayer().op;
    for (const btn of layerSeg.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      btn.classList.toggle('is-active', btn.dataset.layerOp === activeOp);
    }
    const srgb = $<HTMLInputElement>('stroke-color');
    const sw = $<HTMLInputElement>('stroke-width');
    const fill = $<HTMLInputElement>('chk-fill');
    const fcol = $<HTMLInputElement>('fill-color');
    if (objs.length) {
      if (document.activeElement !== srgb) srgb.value = toHex(objs[0].style.stroke);
      if (document.activeElement !== sw) sw.value = String(objs[0].style.strokeWidth);
      fill.checked = !!objs[0].style.fill;
      $('row-fill').hidden = !objs[0].style.fill;
      if (objs[0].style.fill && document.activeElement !== fcol) fcol.value = toHex(objs[0].style.fill);
    } else {
      const layer = store.activeLayer();
      if (document.activeElement !== srgb) srgb.value = toHex(layer.color);
      fill.checked = false;
      $('row-fill').hidden = true;
    }
    $<HTMLButtonElement>('btn-delete').disabled = !objs.length;
    $<HTMLButtonElement>('btn-duplicate').disabled = !objs.length;
  }

  store.subscribe(() => sync(store.state));
  sync(store.state);
}

function unionBox(objs: Obj[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of objs) {
    const b = worldBBox(o.path, o.transform);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const m = color.match(/^#([0-9a-f]{3})$/i);
  if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  return '#e0413c';
}

export function makeDuplicateParams(objs: Obj[]): { before: Obj; after: Obj }[] {
  return objs.map((o) => ({ before: o, after: duplicate(o, uid()) }));
}
