import type { AppState, Store, ToolId } from '../state/store';
import { TOOL_DEFS } from '../tools';
import { initPalette } from './palette';
import { SHEET_PRESETS } from '../core/doc';
import { setBBox, rotateTo } from '../state/edits';
import { updateCmd } from '../state/history';
import { pathLength, transformSubPaths, worldBBox } from '../core/geom/path';
import { decompose } from '../core/geom/transform';
import type { Issue } from '../core/validate';
import type { Material, Obj, Op } from '../core/types';
import { MATERIAL_PRESETS, materialOf, presetById } from '../core/geom/kerf';

export type ExportKind = 'dxf' | 'dxf12' | 'dxf-settings' | 'dxf-all' | 'svg' | 'png' | 'project';
export type NodeOp = 'curve' | 'line' | 'close' | 'break' | 'delete' | 'smooth' | 'symmetric' | 'corner' | 'align-x' | 'align-y' | 'join' | 'reverse';

export interface UIActions {
  undo(): void;
  redo(): void;
  zoom(factor: number): void;
  fit(): void;
  demo(): void;
  clearSheet(): void;
  duplicate(): void;
  deleteSelection(): void;
  setTool(id: ToolId): void;
  openFile(): void;
  exportAs(kind: ExportKind): void;
  runCheck(): void;
  focusIssue(issue: Issue): void;
  align(mode: 'left' | 'hcenter' | 'right' | 'bottom' | 'vcenter' | 'top'): void;
  distribute(axis: 'x' | 'y'): void;
  booleanOp(op: 'union' | 'diff' | 'intersect' | 'xor'): void;
  offset(delta: number): void;
  duplicatePattern(mode: 'row' | 'circle'): void;
  group(): void;
  ungroup(): void;
  reorder(dir: 'front' | 'back'): void;
  nodeOp(op: NodeOp): void;
  /** точные координаты активного узла (мировые мм) */
  setNodePos(x: number, y: number): void;
  /** PowerClip: обрезать выделенное по контуру верхнего объекта */
  powerClip(): void;
  /** вернуть содержимое PowerClip и убрать контейнер */
  releasePowerClip(): void;
  /** материал и компенсация реза (параметры документа) */
  setMaterial(patch: Partial<Material>): void;
  /** учесть рез в геометрии контуров слоя реза */
  applyKerf(): void;
  /** «В кривые»: запечь матрицу и заменить дуги кривыми (Ctrl+Q) */
  toCurves(): void;
  /** настройки соединения «паз — шип» */
  setJointSettings(patch: Partial<{ mode: 'slot' | 'dovetail' | 'tab'; clearance: number; depth: number }>): void;
  /** текст по контуру выделенного объекта */
  textOnPath(text: string, height: number, offset: number, align: 'start' | 'center' | 'end'): void;
  setTextHeight(mm: number): void;
  transform(kind: 'rot90' | 'rot-90' | 'mirrorH' | 'mirrorV'): void;
  nest(all: boolean, opts: { gap: number; margin: number; allowRotate: boolean }): void;
  corners(mode: 'fillet' | 'chamfer', size: number): void;
  setSmartGuides(on: boolean): void;
  setShapeParams(p: { polySides?: number; starPoints?: number; starInner?: number }): void;
  setObjectFlag(id: string, flag: 'hidden' | 'locked', value: boolean): void;
  reorderOne(id: string, dir: 'up' | 'down'): void;
  toast(text: string): void;
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
  /* ---------- инструменты ---------- */
  const toolbar = $('toolbar');
  for (const def of TOOL_DEFS) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.tool = def.id;
    btn.title = `${def.label} (${def.key})`;
    btn.setAttribute('aria-label', def.label);
    btn.innerHTML = `<svg viewBox="0 0 21 21" aria-hidden="true">${def.icon}</svg><span class="key">${def.key}</span>`;
    btn.addEventListener('click', () => actions.setTool(def.id));
    toolbar.appendChild(btn);
  }

  /* ---------- шапка ---------- */
  $('btn-undo').addEventListener('click', actions.undo);
  $('btn-redo').addEventListener('click', actions.redo);
  $('btn-zoom-in').addEventListener('click', () => actions.zoom(1.25));
  $('btn-zoom-out').addEventListener('click', () => actions.zoom(1 / 1.25));
  $('btn-fit').addEventListener('click', actions.fit);
  $('zoom-val').addEventListener('click', actions.fit);
  $('btn-open').addEventListener('click', actions.openFile);
  $('btn-check').addEventListener('click', actions.runCheck);
  $('btn-check-run').addEventListener('click', actions.runCheck);
  $('btn-demo').addEventListener('click', actions.demo);
  $('btn-clear').addEventListener('click', actions.clearSheet);

  const saveBtn = $('btn-save');
  const saveMenu = $('menu-save');
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    saveMenu.hidden = !saveMenu.hidden;
    saveBtn.setAttribute('aria-expanded', String(!saveMenu.hidden));
  });
  saveMenu.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-export]');
    if (!btn) return;
    saveMenu.hidden = true;
    actions.exportAs(btn.dataset.export as ExportKind);
  });
  document.addEventListener('click', () => { saveMenu.hidden = true; });

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
    if (w && h) { store.updateSheet({ width: w, height: h }); actions.fit(); }
  });
  $('sheet-w').addEventListener('change', () => store.updateSheet({ width: Math.max(10, val('sheet-w')) }));
  $('sheet-h').addEventListener('change', () => store.updateSheet({ height: Math.max(10, val('sheet-h')) }));
  $<HTMLSelectElement>('grid-step').addEventListener('change', (e) => store.updateSheet({ gridStep: Number((e.target as HTMLSelectElement).value) }));
  $<HTMLInputElement>('chk-grid').addEventListener('change', (e) => store.updateSheet({ showGrid: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('chk-snap-grid').addEventListener('change', (e) => store.updateSheet({ snapGrid: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('chk-snap-obj').addEventListener('change', (e) => store.updateSheet({ snapObjects: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('chk-smart').addEventListener('change', (e) => actions.setSmartGuides((e.target as HTMLInputElement).checked));

  /* ---------- фигуры: многоугольник и звезда ---------- */
  $<HTMLInputElement>('poly-sides').addEventListener('input', () => actions.setShapeParams({ polySides: val('poly-sides') }));
  $<HTMLInputElement>('star-points').addEventListener('input', () => actions.setShapeParams({ starPoints: val('star-points') }));
  $<HTMLInputElement>('star-inner').addEventListener('input', () => actions.setShapeParams({ starInner: val('star-inner') / 100 }));

  /* ---------- свойства ---------- */
  const applyGeometry = (): void => {
    const objs = store.selected();
    if (objs.length !== 1) return;
    const pairs = [{ before: objs[0], after: setBBox(objs[0], { x: val('prop-x'), y: val('prop-y'), w: val('prop-w'), h: val('prop-h') }) }];
    store.commit(updateCmd('Размер и положение', pairs));
  };
  for (const id of ['prop-x', 'prop-y', 'prop-w', 'prop-h']) $(id).addEventListener('change', applyGeometry);
  $('prop-rot').addEventListener('change', () => {
    const objs = store.selected();
    if (objs.length !== 1) return;
    store.commit(updateCmd('Поворот', [{ before: objs[0], after: rotateTo(objs[0], val('prop-rot')) }]));
  });

  /* ---------- операции ---------- */
  const bind = (id: string, fn: () => void): void => $(id).addEventListener('click', () => { fn(); actions.runCheck(); });
  bind('op-union', () => actions.booleanOp('union'));
  bind('op-diff', () => actions.booleanOp('diff'));
  bind('op-intersect', () => actions.booleanOp('intersect'));
  bind('op-xor', () => actions.booleanOp('xor'));
  bind('op-offset-out', () => actions.offset(Math.abs(val('offset-mm'))));
  bind('op-offset-in', () => actions.offset(-Math.abs(val('offset-mm'))));
  bind('corner-fillet', () => actions.corners('fillet', Math.abs(val('corner-mm'))));
  bind('corner-chamfer', () => actions.corners('chamfer', Math.abs(val('corner-mm'))));
  bind('dup-row', () => actions.duplicatePattern('row'));
  bind('dup-circle', () => actions.duplicatePattern('circle'));
  bind('grp-group', () => actions.group());
  bind('grp-ungroup', () => actions.ungroup());
  bind('z-front', () => actions.reorder('front'));
  bind('z-back', () => actions.reorder('back'));
  $('btn-duplicate').addEventListener('click', actions.duplicate);
  $('btn-delete').addEventListener('click', actions.deleteSelection);

  $('align-grid').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-align]');
    if (!btn) return;
    const mode = btn.dataset.align as 'left' | 'hcenter' | 'right' | 'bottom' | 'vcenter' | 'top';
    store.state.alignRef = ($<HTMLSelectElement>('align-ref').value as 'sheet' | 'selection');
    actions.align(mode);
  });

  $('dist-x').addEventListener('click', () => actions.distribute('x'));
  $('dist-y').addEventListener('click', () => actions.distribute('y'));

  /* ---------- узлы ---------- */
  bind('node-curve', () => actions.nodeOp('curve'));
  bind('node-line', () => actions.nodeOp('line'));
  bind('node-close', () => actions.nodeOp('close'));
  bind('node-break', () => actions.nodeOp('break'));
  bind('node-delete', () => actions.nodeOp('delete'));
  bind('pc-place', () => actions.powerClip());
  bind('pc-release', () => actions.releasePowerClip());
  bind('node-smooth', () => actions.nodeOp('smooth'));
  bind('node-symmetric', () => actions.nodeOp('symmetric'));
  bind('node-corner', () => actions.nodeOp('corner'));
  bind('node-align-x', () => actions.nodeOp('align-x'));
  bind('node-align-y', () => actions.nodeOp('align-y'));
  bind('node-join', () => actions.nodeOp('join'));
  bind('node-reverse', () => actions.nodeOp('reverse'));

  /* ---------- поворот и зеркало ---------- */
  $('tr-rot90').addEventListener('click', () => actions.transform('rot90'));
  $('tr-rot-90').addEventListener('click', () => actions.transform('rot-90'));
  $('tr-mirror-h').addEventListener('click', () => actions.transform('mirrorH'));
  $('tr-mirror-v').addEventListener('click', () => actions.transform('mirrorV'));

  /* ---------- раскладка ---------- */
  const nestOpts = () => ({
    gap: Math.max(0, val('nest-gap')),
    margin: Math.max(0, val('nest-margin')),
    allowRotate: $<HTMLInputElement>('nest-rotate').checked,
  });
  $('nest-selected').addEventListener('click', () => actions.nest(false, nestOpts()));
  $('nest-all').addEventListener('click', () => actions.nest(true, nestOpts()));

  /* ---------- слой и стиль ---------- */
  $('layer-seg').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.seg-btn');
    if (!btn) return;
    const op = btn.dataset.layerOp as Op;
    const layer = store.state.doc.layers.find((l) => l.op === op);
    if (layer) store.moveSelectionToLayer(layer.id);
  });

  const applyStyle = (patch: Partial<Obj['style']>): void => {
    const objs = store.selected();
    if (!objs.length) return;
    store.commit(updateCmd('Стиль', objs.map((o) => ({ before: o, after: { ...o, style: { ...o.style, ...patch } } }))));
  };
  $('stroke-color').addEventListener('input', (e) => applyStyle({ stroke: (e.target as HTMLInputElement).value }));
  $('stroke-width').addEventListener('change', () => applyStyle({ strokeWidth: Math.max(0, val('stroke-width')) }));
  const syncFillRows = (): void => {
    const on = $<HTMLInputElement>('chk-fill').checked;
    const type = $<HTMLSelectElement>('fill-type').value;
    $('row-fill').hidden = !on;
    $('row-fill-angle').hidden = !on || type !== 'linear';
  };
  $<HTMLInputElement>('chk-fill').addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const type = $<HTMLSelectElement>('fill-type').value as 'solid' | 'linear' | 'radial';
    applyStyle({ fill: on ? $<HTMLInputElement>('fill-color').value : null, fillType: type });
    syncFillRows();
  });
  $<HTMLSelectElement>('fill-type').addEventListener('change', (e) => {
    const type = (e.target as HTMLSelectElement).value as 'solid' | 'linear' | 'radial';
    if ($<HTMLInputElement>('chk-fill').checked) applyStyle({ fillType: type });
    syncFillRows();
  });
  $('fill-color').addEventListener('input', (e) => {
    if ($<HTMLInputElement>('chk-fill').checked) applyStyle({ fill: (e.target as HTMLInputElement).value });
  });
  $('fill-color-2').addEventListener('input', (e) => {
    if ($<HTMLInputElement>('chk-fill').checked) applyStyle({ fill2: (e.target as HTMLInputElement).value });
  });
  $('fill-angle').addEventListener('change', () => applyStyle({ fillAngle: val('fill-angle') }));
  syncFillRows();

  /* ---------- блок «Цвет»: палитра и смеситель ---------- */
  const palette = initPalette({
    apply: (color, target) => {
      if (target === 'stroke') {
        applyStyle({ stroke: color ?? '#000000' });
        return;
      }
      // палитра даёт сплошную заливку: градиент сбрасывается осознанно
      applyStyle(color ? { fill: color, fillType: 'solid' } : { fill: null });
    },
    current: () => {
      const objs = store.selected();
      if (!objs.length) return null;
      return { fill: objs[0].style.fill, stroke: objs[0].style.stroke };
    },
  });

  bind('obj-curves', () => actions.toCurves());

  /* ---------- блок «Соединения» ---------- */
  $<HTMLSelectElement>('joint-mode').addEventListener('change', (e) => {
    actions.setJointSettings({ mode: (e.target as HTMLSelectElement).value as 'slot' | 'dovetail' | 'tab' });
  });
  $('joint-clearance').addEventListener('change', () => actions.setJointSettings({ clearance: val('joint-clearance') }));
  $('joint-depth').addEventListener('change', () => actions.setJointSettings({ depth: val('joint-depth') }));

  /* ---------- блок «Материал и рез» ---------- */
  const matSel = $<HTMLSelectElement>('mat-preset');
  for (const p of MATERIAL_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} · рез ${p.kerf} мм`;
    matSel.appendChild(opt);
  }
  matSel.addEventListener('change', () => {
    const p = presetById(matSel.value);
    if (!p) return;
    actions.setMaterial({ presetId: p.id, name: p.name, thickness: p.thickness, kerf: p.kerf });
  });
  const applyMatField = (field: 'thickness' | 'kerf'): void => {
    const v = val(`mat-${field}`);
    if (!Number.isFinite(v)) return;
    // ручная правка толщины/реза — уже «свой материал»
    actions.setMaterial({ [field]: v, presetId: 'custom', name: 'Свой материал' } as Partial<Material>);
  };
  $('mat-thickness').addEventListener('change', () => applyMatField('thickness'));
  $('mat-kerf').addEventListener('change', () => applyMatField('kerf'));
  $<HTMLInputElement>('mat-compensate').addEventListener('change', (e) => {
    actions.setMaterial({ compensate: (e.target as HTMLInputElement).checked });
  });
  bind('mat-apply', () => actions.applyKerf());

  const applyNodePos = (): void => {
    if (!Number.isFinite(val('node-x')) || !Number.isFinite(val('node-y'))) return;
    actions.setNodePos(val('node-x'), val('node-y'));
  };
  $('node-x').addEventListener('change', applyNodePos);
  $('node-y').addEventListener('change', applyNodePos);

  $('text-height').addEventListener('change', () => actions.setTextHeight(val('text-height')));
  bind('btn-text-path', () => actions.textOnPath(
    $<HTMLInputElement>('top-text').value,
    val('text-height'),
    val('top-offset'),
    $<HTMLSelectElement>('top-align').value as 'start' | 'center' | 'end',
  ));

  /* ---------- синхронизация ---------- */
  function sync(state: AppState): void {
    for (const btn of toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn')) {
      btn.classList.toggle('is-active', btn.dataset.tool === state.tool);
    }
    $<HTMLButtonElement>('btn-undo').disabled = !store.history.canUndo;
    $<HTMLButtonElement>('btn-redo').disabled = !store.history.canRedo;

    const joint = state.joint;
    $<HTMLSelectElement>('joint-mode').value = joint.mode;
    setVal('joint-clearance', joint.clearance);
    setVal('joint-depth', joint.depth);
    const jointMat = materialOf(state.doc);
    const jointWidth = Math.max(0.1, jointMat.thickness - joint.clearance);
    const jointDepth = joint.depth > 0 ? joint.depth : jointMat.thickness;
    const jointName = joint.mode === 'tab' ? 'шип' : joint.mode === 'dovetail' ? 'паз «ласточкин хвост»' : 'паз';
    $('joint-hint').textContent = `Инструмент «Паз» (J): клик по ребру детали — ${jointName} `
      + `${+jointWidth.toFixed(2)} × ${+jointDepth.toFixed(2)} мм в материале ${jointMat.name.toLowerCase()}. `
      + 'Глубина 0 — на всю толщину; зазор оставляет люфт, чтобы шип вошёл после реза.';

    const mat = materialOf(state.doc);
    matSel.value = presetById(mat.presetId) ? mat.presetId : 'custom';
    setVal('mat-thickness', mat.thickness);
    setVal('mat-kerf', mat.kerf);
    $<HTMLInputElement>('mat-compensate').checked = mat.compensate;
    const hint = $('mat-hint');
    hint.textContent = mat.kerf > 0
      ? `${mat.name}, ${+mat.thickness.toFixed(2)} мм · рез ${+mat.kerf.toFixed(2)} мм · компенсация по ${+(mat.kerf / 2).toFixed(3)} мм на контур`
      : `${mat.name}, ${+mat.thickness.toFixed(2)} мм · компенсация выключена (рез 0)`;

    const sheet = state.sheet;
    setVal('sheet-w', sheet.width);
    setVal('sheet-h', sheet.height);
    $<HTMLSelectElement>('grid-step').value = String(sheet.gridStep);
    $<HTMLInputElement>('chk-grid').checked = sheet.showGrid;
    $<HTMLInputElement>('chk-snap-grid').checked = sheet.snapGrid;
    $<HTMLInputElement>('chk-snap-obj').checked = sheet.snapObjects;
    $<HTMLInputElement>('chk-smart').checked = state.smartGuides;
    presetSel.value = `${sheet.width}x${sheet.height}`;

    const objs = store.selected();
    const body = $('props-body');
    const empty = $('props-empty');
    const note = $('group-note');
    if (!objs.length) {
      body.hidden = true; empty.hidden = false; note.hidden = true;
    } else {
      body.hidden = false; empty.hidden = true;
      const single = objs.length === 1;
      note.hidden = single;
      const box = single ? worldBBox(objs[0].path, objs[0].transform) : unionBox(objs);
      setVal('prop-x', box.x); setVal('prop-y', box.y);
      setVal('prop-w', box.w); setVal('prop-h', box.h);
      setVal('prop-rot', Math.round((decompose(objs[0].transform).rotation * 180) / Math.PI * 100) / 100);
      const isLine = single && objs[0].path.length === 1 && objs[0].path[0].segs.length === 1 && objs[0].path[0].segs[0].t === 'l';
      $('row-length').hidden = !isLine;
      if (isLine) $('prop-len').textContent = `${pathLength(transformSubPaths(objs[0].path, objs[0].transform)).toFixed(2)} мм`;
      for (const id of ['prop-x', 'prop-y', 'prop-w', 'prop-h', 'prop-rot']) $<HTMLInputElement>(id).disabled = !single;
    }

    $('block-nodes').hidden = state.tool !== 'node';

    const activeOp = store.activeLayer().op;
    for (const btn of $('layer-seg').querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      btn.classList.toggle('is-active', btn.dataset.layerOp === activeOp);
    }
    const srgb = $<HTMLInputElement>('stroke-color');
    const sw = $<HTMLInputElement>('stroke-width');
    const fill = $<HTMLInputElement>('chk-fill');
    const fcol = $<HTMLInputElement>('fill-color');
    palette.refresh();
    if (objs.length) {
      if (document.activeElement !== srgb) srgb.value = toHex(objs[0].style.stroke);
      if (document.activeElement !== sw) sw.value = String(objs[0].style.strokeWidth);
      fill.checked = !!objs[0].style.fill;
      $('row-fill').hidden = !objs[0].style.fill;
      if (objs[0].style.fill && document.activeElement !== fcol) fcol.value = toHex(objs[0].style.fill);
    } else {
      if (document.activeElement !== srgb) srgb.value = toHex(store.activeLayer().color);
      fill.checked = false;
      $('row-fill').hidden = true;
    }
    $<HTMLButtonElement>('btn-delete').disabled = !objs.length;
    $<HTMLButtonElement>('btn-duplicate').disabled = !objs.length;

    renderObjectList(state);
  }

  /* ---------- список объектов (как Object manager) ---------- */
  const objList = $('obj-list');
  let builtKey = '';

  function renderObjectList(state: AppState): void {
    const ids = state.doc.order.filter((id) => state.doc.objects[id]?.sheetId === state.sheet.id);
    const key = ids.join(',');
    if (key !== builtKey) {
      builtKey = key;
      objList.innerHTML = '';
      if (!ids.length) {
        const empty = document.createElement('p');
        empty.className = 'pempty';
        empty.textContent = 'На листе пока нет объектов';
        objList.appendChild(empty);
      }
      // сверху — верхний объект по Z-порядку, как в CorelDRAW
      for (const id of [...ids].reverse()) {
        const obj = state.doc.objects[id];
        if (!obj) continue;
        const row = document.createElement('div');
        row.className = 'objrow';
        row.dataset.id = id;
        row.setAttribute('role', 'listitem');

        const eye = document.createElement('button');
        eye.dataset.objAct = 'eye';
        const lock = document.createElement('button');
        lock.dataset.objAct = 'lock';
        const name = document.createElement('button');
        name.className = 'objname';
        name.dataset.objAct = 'select';
        const up = document.createElement('button');
        up.dataset.objAct = 'up';
        up.title = 'Выше';
        up.textContent = '↑';
        const down = document.createElement('button');
        down.dataset.objAct = 'down';
        down.title = 'Ниже';
        down.textContent = '↓';

        row.append(eye, lock, name, up, down);
        objList.appendChild(row);
      }
    }

    // Состояние строк правим без пересборки — иначе клик по кнопке попадает
    // в уже удалённый узел (список перерисовывается на каждое изменение выделения).
    const selection = new Set(state.selection);
    for (const row of objList.querySelectorAll<HTMLElement>('.objrow')) {
      const obj = state.doc.objects[row.dataset.id ?? ''];
      if (!obj) continue;
      row.classList.toggle('is-hidden', !!obj.hidden);
      row.classList.toggle('is-locked', !!obj.locked);
      row.classList.toggle('is-selected', selection.has(obj.id));
      row.classList.toggle('is-clipped', !!obj.clip);
      const eye = row.querySelector<HTMLButtonElement>('[data-obj-act="eye"]');
      const lock = row.querySelector<HTMLButtonElement>('[data-obj-act="lock"]');
      const name = row.querySelector<HTMLButtonElement>('[data-obj-act="select"]');
      if (eye) {
        eye.textContent = obj.hidden ? '○' : '◉';
        eye.title = obj.hidden ? 'Показать' : 'Скрыть';
      }
      if (lock) {
        lock.textContent = obj.locked ? '🔒' : '🔓';
        lock.title = obj.locked ? 'Разблокировать' : 'Заблокировать';
      }
      if (name) {
        const layer = state.doc.layers.find((l) => l.id === obj.layerId);
        name.textContent = obj.name || (obj.path.length > 1 ? `Контур ×${obj.path.length}` : 'Контур');
        name.title = `${layer ? layer.name : ''} · ${obj.path.length} контур(ов)`;
      }
    }
  }

  objList.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-obj-act]');
    const row = (e.target as HTMLElement).closest<HTMLElement>('.objrow');
    if (!target || !row?.dataset.id) return;
    const id = row.dataset.id;
    const obj = store.state.doc.objects[id];
    if (!obj) return;
    const act = target.dataset.objAct;
    if (act === 'eye') actions.setObjectFlag(id, 'hidden', !obj.hidden);
    else if (act === 'lock') actions.setObjectFlag(id, 'locked', !obj.locked);
    else if (act === 'up') actions.reorderOne(id, 'up');
    else if (act === 'down') actions.reorderOne(id, 'down');
    else if (act === 'select') {
      if (obj.hidden) actions.setObjectFlag(id, 'hidden', false);
      store.select(e.shiftKey ? [...new Set([...store.state.selection, id])] : [id]);
    }
  });

  store.subscribe(() => sync(store.state));
  sync(store.state);
}

export function setIssues(issues: Issue[]): void {
  const list = $('issues');
  list.innerHTML = '';
  for (const issue of issues) {
    const li = document.createElement('li');
    li.className = issue.severity;
    li.textContent = issue.message;
    li.title = 'Показать объект';
    li.addEventListener('click', () => {
      const ev = new CustomEvent('lcx:focus-issue', { detail: issue });
      window.dispatchEvent(ev);
    });
    list.appendChild(li);
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  const badge = $('check-badge');
  const summary = $('check-summary');
  badge.textContent = String(issues.length);
  badge.className = `pill ${errors ? 'is-error' : issues.length ? 'is-warn' : 'is-ok'}`;
  summary.textContent = issues.length ? `${issues.length}` : 'чисто';
  const st = document.getElementById('st-check');
  if (st) st.textContent = issues.length ? `проверка: ${errors ? `${errors} ошибок` : `${issues.length} замечаний`}` : 'проверка: чисто';
}

export function setStats(rows: { label: string; value: string }[]): void {
  const box = document.getElementById('stats');
  if (!box) return;
  box.innerHTML = '';
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'stat-line';
    const l = document.createElement('span');
    l.textContent = row.label;
    const v = document.createElement('b');
    v.textContent = row.value;
    line.append(l, v);
    box.appendChild(line);
  }
}

export function setAutosaveStatus(text: string): void {
  const el = document.getElementById('autosave-status');
  if (el) el.textContent = `Автосохранение: ${text}`;
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
