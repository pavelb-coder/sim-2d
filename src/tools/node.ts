import type { Box, Id, Obj, SubPath, Vec2 } from '../core/types';
import { apply, invert } from '../core/geom/transform';
import {
  pathNodes, moveNodes, deleteNode, splitSegment, toCurve, toLine, toggleClosed, breakAt,
  nodeHandles, moveNodeHandle, setNodeType, nodesInBox, nodePoint,
  nodeTypeAt, moveSegment, joinNodes, reverseSubPath, alignNodes, nearestSegment, moveNode,
  type NodeRef, type NodeType, type SegRef,
} from '../core/geom/nodeEdit';
import { nearestOnPath, normBox } from '../core/geom/path';
import { updateCmd } from '../state/history';
import type { Tool, ToolCtx, ToolOverlay } from './tool';

export interface NodeToolState {
  objectId: Id | null;
  /** узел, к которому применяются операции панели */
  active: NodeRef | null;
  /** все выделенные узлы (мультивыделение, как в CorelDRAW) */
  selected: NodeRef[];
  hover: NodeRef | null;
  /** выделенный сегмент (как в CorelDRAW: клик по кривой выделяет сегмент) */
  segment: SegRef | null;
  /** рамка выделения узлов (в локальных координатах объекта) */
  marquee: Box | null;
  /** тип, в котором тянется ручка: corner — независимо, smooth/symmetric — с зеркалом */
  handleType: NodeType;
}

export const nodeToolState: NodeToolState = {
  objectId: null,
  active: null,
  selected: [],
  segment: null,
  hover: null,
  marquee: null,
  handleType: 'smooth',
};

type Mode = 'idle' | 'nodes' | 'handle' | 'marquee' | 'segment';

let mode: Mode = 'idle';
let beforeObj: Obj | null = null;
let dragStart: Vec2 = { x: 0, y: 0 };
let handleSide: 'in' | 'out' = 'out';

const sameRef = (a: NodeRef | null, b: NodeRef | null): boolean =>
  !!a && !!b && a.sub === b.sub && a.index === b.index;

function targetObject(c: ToolCtx): Obj | null {
  const selected = c.store.selected();
  if (!selected.length) return null;
  const byId = nodeToolState.objectId ? c.store.state.doc.objects[nodeToolState.objectId] : null;
  if (byId && selected.some((o) => o.id === byId.id)) return byId;
  return selected[0];
}

function nodesOfWorld(obj: Obj): { ref: NodeRef; world: Vec2; subStart: boolean }[] {
  return pathNodes(obj.path).map((n) => ({ ref: n.ref, world: apply(obj.transform, n.p), subStart: n.subStart }));
}

function pickNode(obj: Obj, world: Vec2, tolMm: number): NodeRef | null {
  let best: NodeRef | null = null;
  let bestD = tolMm;
  for (const n of nodesOfWorld(obj)) {
    const d = Math.hypot(n.world.x - world.x, n.world.y - world.y);
    if (d <= bestD) { bestD = d; best = n.ref; }
  }
  return best;
}

/** Ручка Безье под курсором — ищем среди ручек выделенных (и активного) узлов. */
function pickHandle(obj: Obj, world: Vec2, tolMm: number): { ref: NodeRef; side: 'in' | 'out' } | null {
  const refs = nodeToolState.selected.length ? nodeToolState.selected : nodeToolState.active ? [nodeToolState.active] : [];
  for (const ref of refs) {
    for (const h of nodeHandles(obj.path, ref)) {
      const w = apply(obj.transform, h.p);
      if (Math.hypot(w.x - world.x, w.y - world.y) <= tolMm) return { ref, side: h.side };
    }
  }
  return null;
}

function commitPath(c: ToolCtx, obj: Obj, path: SubPath[]): void {
  const after: Obj = { ...obj, path };
  c.store.commit(updateCmd('Правка узлов', [{ before: obj, after }]));
  nodeToolState.objectId = after.id;
}

const clearSelection = (): void => {
  nodeToolState.selected = [];
  nodeToolState.active = null;
};

export const nodeTool: Tool = {
  id: 'node',
  cursor: 'default',

  down(p, ev, c) {
    const obj = targetObject(c);
    if (!obj) { c.setStatus('Выберите объект, чтобы править узлы'); return; }
    const tol = c.view.px(8);
    nodeToolState.objectId = obj.id;
    beforeObj = obj;
    dragStart = apply(invert(obj.transform), p);

    // 1) ручка Безье — тянем кривизну
    const h = pickHandle(obj, p, c.view.px(7));
    if (h) {
      nodeToolState.active = h.ref;
      if (!nodeToolState.selected.some((r) => sameRef(r, h.ref))) nodeToolState.selected = [h.ref];
      handleSide = h.side;
      mode = 'handle';
      c.setCursor('grabbing');
      c.render('overlay');
      return;
    }

    const hit = pickNode(obj, p, tol);
    if (hit) {
      if (ev.shiftKey) {
        // Shift — добавить/убрать узел из группы
        const exists = nodeToolState.selected.some((r) => sameRef(r, hit));
        nodeToolState.selected = exists
          ? nodeToolState.selected.filter((r) => !sameRef(r, hit))
          : [...nodeToolState.selected, hit];
        nodeToolState.active = exists ? nodeToolState.selected[nodeToolState.selected.length - 1] ?? null : hit;
        mode = 'idle';
        c.render('overlay');
        return;
      }
      if (!nodeToolState.selected.some((r) => sameRef(r, hit))) nodeToolState.selected = [hit];
      nodeToolState.segment = null;
      nodeToolState.active = hit;
      nodeToolState.hover = hit;
      mode = 'nodes';
      c.setCursor('grabbing');
      c.render('overlay');
      return;
    }

    // 2) двойной клик по сегменту — добавить узел
    if (ev.detail >= 2) {
      const near = nearestOnPath(obj.path, dragStart, tol);
      if (near) {
        const res = splitSegment(obj.path, { sub: near.sub, index: near.seg }, 5e-1);
        if (res) {
          commitPath(c, obj, res.path);
          nodeToolState.active = res.ref;
          nodeToolState.selected = [res.ref];
          mode = 'idle';
          c.render('both');
          return;
        }
      }
    }

    // 3) клик по кривой — выделяем сегмент и можем его тянуть
    const segHit = nearestSegment(obj.path, dragStart, c.view.px(6));
    if (segHit) {
      nodeToolState.segment = segHit;
      if (!ev.shiftKey) clearSelection();
      mode = 'segment';
      c.setCursor('grabbing');
      c.render('overlay');
      return;
    }

    // 4) клик по пустому месту — рамка выделения узлов
    if (!ev.shiftKey) { clearSelection(); nodeToolState.segment = null; }
    mode = 'marquee';
    nodeToolState.marquee = normBox(dragStart, dragStart);
    c.render('overlay');
  },

  move(p, ev, c) {
    const obj = targetObject(c);
    if (!obj) return;
    const local = apply(invert(beforeObj && mode !== 'idle' ? beforeObj.transform : obj.transform), p);

    if (mode === 'segment' && beforeObj && nodeToolState.segment) {
      const delta = { x: local.x - dragStart.x, y: local.y - dragStart.y };
      const path = moveSegment(beforeObj.path, nodeToolState.segment, delta);
      c.store.preview([{ kind: 'update', before: obj, after: { ...beforeObj, path } }]);
      c.setStatus(`Сегмент → ${delta.x.toFixed(1)}, ${delta.y.toFixed(1)} мм`);
      c.render('both');
      return;
    }

    if (mode === 'nodes' && beforeObj && nodeToolState.selected.length) {
      const delta = { x: local.x - dragStart.x, y: local.y - dragStart.y };
      const path = moveNodes(beforeObj.path, nodeToolState.selected, delta);
      c.store.preview([{ kind: 'update', before: obj, after: { ...beforeObj, path } }]);
      c.setStatus(`${nodeToolState.selected.length} узл. → ${(delta.x).toFixed(1)}, ${(delta.y).toFixed(1)} мм`);
      c.render('both');
      return;
    }

    if (mode === 'handle' && beforeObj && nodeToolState.active) {
      const path = moveNodeHandle(beforeObj.path, nodeToolState.active, handleSide, local, nodeToolState.handleType);
      c.store.preview([{ kind: 'update', before: obj, after: { ...beforeObj, path } }]);
      c.render('both');
      return;
    }

    if (mode === 'marquee') {
      nodeToolState.marquee = normBox(dragStart, local);
      c.render('overlay');
      return;
    }

    const hit = pickNode(obj, p, c.view.px(8));
    const handle = hit ? null : pickHandle(obj, p, c.view.px(7));
    if (!sameRef(hit, nodeToolState.hover) || (handle && !hit)) {
      nodeToolState.hover = hit;
      c.setCursor(hit || handle ? 'pointer' : 'default');
      c.render('overlay');
    }
    void ev;
  },

  up(_p, _ev, c) {
    if (mode === 'marquee' && beforeObj && nodeToolState.marquee) {
      const box = nodeToolState.marquee;
      if (box.w > 1e-9 || box.h > 1e-9) {
        const found = nodesInBox(beforeObj.path, box);
        nodeToolState.selected = [...nodeToolState.selected, ...found.filter((r) => !nodeToolState.selected.some((s) => sameRef(s, r)))];
        nodeToolState.active = nodeToolState.selected[nodeToolState.selected.length - 1] ?? null;
      }
      nodeToolState.marquee = null;
    }
    if ((mode === 'nodes' || mode === 'handle' || mode === 'segment') && beforeObj) {
      const current = c.store.state.doc.objects[beforeObj.id];
      if (current && current !== beforeObj) {
        c.store.commit(updateCmd('Правка узлов', [{ before: beforeObj, after: current }]));
      }
    }
    mode = 'idle';
    beforeObj = null;
    c.setStatus(null);
    c.setCursor('default');
    c.render('both');
  },

  cancel(c) {
    mode = 'idle';
    beforeObj = null;
    clearSelection();
    nodeToolState.hover = null;
    nodeToolState.marquee = null;
    c.render('overlay');
  },

  overlay(): ToolOverlay {
    return { marquee: null, snap: null, align: [], draw: null };
  },
};

/* ---------- операции панели «Узлы» ---------- */

export function nodeOpLine(c: ToolCtx): void {
  applyNodeOp(c, (obj) => toLine(obj.path, activeRef()));
}

export function nodeOpCurve(c: ToolCtx): void {
  applyNodeOp(c, (obj) => toCurve(obj.path, activeRef()));
}

export function nodeOpClose(c: ToolCtx): void {
  applyNodeOp(c, (obj) => {
    const sub = nodeToolState.active?.sub ?? 0;
    return toggleClosed(obj.path, sub);
  });
}

export function nodeOpBreak(c: ToolCtx): void {
  applyNodeOp(c, (obj) => breakAt(obj.path, activeRef()));
}

export function nodeOpDelete(c: ToolCtx): void {
  applyNodeOp(c, (obj) => deleteNode(obj.path, activeRef()));
  clearSelection();
}

/** Выровнять выделенные узлы по X или по Y. */
export function nodeOpAlign(c: ToolCtx, axis: 'x' | 'y'): void {
  const refs = refsToEdit();
  if (refs.length < 2) { c.setStatus('Выделите минимум два узла (Shift+клик или рамка)'); return; }
  applyNodeOp(c, (obj) => alignNodes(obj.path, refs, axis));
}

/** Соединить два выделенных узла (концы открытых подпутей). */
export function nodeOpJoin(c: ToolCtx): void {
  const refs = refsToEdit();
  if (refs.length !== 2) { c.setStatus('Выделите ровно два узла и нажмите «Соединить»'); return; }
  applyNodeOp(c, (obj) => joinNodes(obj.path, refs[0], refs[1]) ?? obj.path);
}

/** Развернуть направление подпути. */
export function nodeOpReverse(c: ToolCtx): void {
  const sub = nodeToolState.active?.sub ?? nodeToolState.segment?.sub ?? 0;
  applyNodeOp(c, (obj) => reverseSubPath(obj.path, sub));
}

/** Точные координаты активного узла (мировые мм). */
export function nodeOpSetPos(c: ToolCtx, x: number, y: number): void {
  const obj = targetObject(c);
  const ref = nodeToolState.active;
  if (!obj || !ref) return;
  const local = apply(invert(obj.transform), { x, y });
  const path = moveNode(obj.path, ref, local);
  if (JSON.stringify(path) === JSON.stringify(obj.path)) return;
  commitPath(c, obj, path);
  c.render('both');
}

/** Сдвиг выделенных узлов стрелками. */
export function nodeNudge(c: ToolCtx, dx: number, dy: number): void {
  const refs = refsToEdit();
  if (!refs.length) return;
  applyNodeOp(c, (obj) => moveNodes(obj.path, refs, { x: dx, y: dy }));
}

/** Гладкий / симметричный / угловой узел — для всех выделенных узлов сразу. */
export function nodeOpType(c: ToolCtx, type: NodeType): void {
  const refs = refsToEdit();
  applyNodeOp(c, (obj) => refs.reduce((path, ref) => setNodeType(path, ref, type), obj.path));
}

function refsToEdit(): NodeRef[] {
  if (nodeToolState.selected.length) return nodeToolState.selected;
  return nodeToolState.active ? [nodeToolState.active] : [];
}

function activeRef(): NodeRef {
  return nodeToolState.active ?? { sub: 0, index: 0 };
}

function applyNodeOp(c: ToolCtx, fn: (obj: Obj) => SubPath[]): void {
  const obj = targetObject(c);
  if (!obj) return;
  const path = fn(obj);
  // ничего не поменялось — не пишем пустой шаг в историю (иначе undo «съедает» клик)
  if (JSON.stringify(path) === JSON.stringify(obj.path)) {
    c.setStatus('Узел не изменился');
    c.render('overlay');
    return;
  }
  commitPath(c, obj, path);
  c.render('both');
}

/** Экспорт для отрисовки: точка узла в локальных координатах. */
export const nodeLocalPoint = nodePoint;

/** Экспорт для отрисовки: тип узла и выделенный сегмент. */
export const nodeTypeOf = nodeTypeAt;
