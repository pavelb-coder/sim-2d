import type { Id, Obj, SubPath, Vec2 } from '../core/types';
import { apply, invert } from '../core/geom/transform';
import { pathNodes, moveNode, deleteNode, splitSegment, toCurve, toLine, toggleClosed, breakAt, type NodeRef } from '../core/geom/nodeEdit';
import { nearestOnPath } from '../core/geom/path';
import { updateCmd } from '../state/history';
import type { Tool, ToolCtx, ToolOverlay } from './tool';

export interface NodeToolState {
  objectId: Id | null;
  active: NodeRef | null;
  hover: NodeRef | null;
}

export const nodeToolState: NodeToolState = { objectId: null, active: null, hover: null };

let dragging = false;
let beforeObj: Obj | null = null;

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

function commitPath(c: ToolCtx, obj: Obj, path: SubPath[]): void {
  const after: Obj = { ...obj, path };
  c.store.commit(updateCmd('Правка узлов', [{ before: obj, after }]));
  nodeToolState.objectId = after.id;
}

export const nodeTool: Tool = {
  id: 'node',
  cursor: 'default',

  down(p, ev, c) {
    const obj = targetObject(c);
    if (!obj) { c.setStatus('Выберите объект, чтобы править узлы'); return; }
    const tol = c.view.px(8);
    const hit = pickNode(obj, p, tol);
    nodeToolState.objectId = obj.id;
    nodeToolState.active = hit;
    if (hit) {
      dragging = true;
      beforeObj = obj;
      nodeToolState.hover = hit;
      c.setCursor('grabbing');
      c.render('overlay');
      return;
    }
    // двойной клик по сегменту — добавить узел
    if (ev.detail >= 2) {
      const local = apply(invert(obj.transform), p);
      const near = nearestOnPath(obj.path, local, tol);
      if (near) {
        const res = splitSegment(obj.path, { sub: near.sub, index: near.seg }, 5e-1);
        if (res) {
          commitPath(c, obj, res.path);
          nodeToolState.active = res.ref;
          c.render('both');
          return;
        }
      }
    }
    c.render('overlay');
  },

  move(p, ev, c) {
    const obj = targetObject(c);
    if (!obj) return;
    if (dragging && beforeObj && nodeToolState.active) {
      const local = apply(invert(beforeObj.transform), p);
      const path = moveNode(beforeObj.path, nodeToolState.active, local);
      const after: Obj = { ...beforeObj, path };
      c.store.preview([{ kind: 'update', before: obj, after }]);
      c.render('both');
      return;
    }
    const hit = pickNode(obj, p, c.view.px(8));
    if ((hit?.sub ?? -1) !== (nodeToolState.hover?.sub ?? -1) || (hit?.index ?? -1) !== (nodeToolState.hover?.index ?? -1)) {
      nodeToolState.hover = hit;
      c.setCursor(hit ? 'pointer' : 'default');
      c.render('overlay');
    }
    void ev;
  },

  up(_p, _ev, c) {
    if (dragging && beforeObj) {
      const current = c.store.state.doc.objects[beforeObj.id];
      if (current && current !== beforeObj) {
        c.store.commit(updateCmd('Правка узлов', [{ before: beforeObj, after: current }]));
      }
    }
    dragging = false;
    beforeObj = null;
    c.setCursor('default');
    c.render('both');
  },

  cancel(c) {
    dragging = false;
    beforeObj = null;
    nodeToolState.active = null;
    nodeToolState.hover = null;
    c.render('overlay');
  },

  overlay(): ToolOverlay {
    return { marquee: null, snap: null, draw: null };
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
  nodeToolState.active = null;
}

function activeRef(): NodeRef {
  return nodeToolState.active ?? { sub: 0, index: 0 };
}

function applyNodeOp(c: ToolCtx, fn: (obj: Obj) => SubPath[]): void {
  const obj = targetObject(c);
  if (!obj) return;
  const path = fn(obj);
  commitPath(c, obj, path);
  c.render('both');
}
