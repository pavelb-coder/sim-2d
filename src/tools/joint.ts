import type { Id, Obj, Vec2 } from '../core/types';
import { pickObject } from '../core/geom/hit';
import { jointPolygon, nearestEdge, type EdgeHit, type JointOptions } from '../core/geom/joint';
import { transformSubPaths } from '../core/geom/path';
import { materialOf } from '../core/geom/kerf';
import { applyJoint } from '../state/ops';
import type { Tool, ToolCtx, ToolOverlay } from './tool';

/**
 * Инструмент «Паз» (`J`).
 *
 * Клик по ребру детали вырезает паз шириной «толщина − зазор» и глубиной
 * в толщину материала; режимы «Ласточкин хвост» и «Шип» — те же настройки,
 * но другая форма. Пока курсор ведут над деталью, оверлей показывает будущий
 * паз полупрозрачным — видно, куда именно он встанет, ещё до клика.
 */

export interface JointToolState {
  /** деталь и ребро под курсором (для превью) */
  hover: { objectId: Id; hit: EdgeHit } | null;
  /** настройки на момент последнего движения: их рисует превью */
  options: JointOptions | null;
  /** последняя построенная операция: нужно тестам и статус-бару */
  last: { objectId: Id; mode: JointOptions['mode'] } | null;
}

export const jointToolState: JointToolState = { hover: null, options: null, last: null };

const worldOf = (obj: Obj) => transformSubPaths(obj.path, obj.transform);

/** Настройки инструмента: толщина берётся из блока «Материал». */
export function jointOptionsFor(c: ToolCtx): JointOptions {
  return { ...c.store.state.joint, thickness: materialOf(c.store.state.doc).thickness };
}

/** Деталь и её ближайшее ребро под точкой (в мировых мм). */
export function jointTargetAt(c: ToolCtx, p: Vec2): { objectId: Id; hit: EdgeHit } | null {
  const { doc, sheet } = c.store.state;
  const id = pickObject(doc, sheet, p, c.view.px(8));
  if (!id) return null;
  const obj = doc.objects[id];
  if (!obj) return null;
  const hit = nearestEdge(worldOf(obj), p);
  if (!hit) return null;
  return { objectId: id, hit };
}

export const jointTool: Tool = {
  id: 'joint',
  cursor: 'crosshair',

  down(p: Vec2, _ev: PointerEvent, c: ToolCtx): void {
    const target = jointTargetAt(c, p);
    if (!target) {
      c.setStatus('Кликните по контуру детали — паз встанет на ближайшее ребро');
      return;
    }
    const opts = jointOptionsFor(c);
    jointToolState.options = opts;
    const err = applyJoint(c.store, target.objectId, p, opts);
    if (err) {
      c.setStatus(err);
      return;
    }
    jointToolState.last = { objectId: target.objectId, mode: opts.mode };
    jointToolState.hover = null;
    c.setStatus(null);
    c.render('both');
  },

  move(p: Vec2, _ev: PointerEvent, c: ToolCtx): void {
    const next = jointTargetAt(c, p);
    const same = (a: JointToolState['hover'], b: JointToolState['hover']): boolean =>
      (!a && !b) || (!!a && !!b && a.objectId === b.objectId && a.hit.point.x === b.hit.point.x && a.hit.point.y === b.hit.point.y);
    const opts = jointOptionsFor(c);
    const optsSame = jointToolState.options
      && jointToolState.options.mode === opts.mode
      && jointToolState.options.clearance === opts.clearance
      && jointToolState.options.depth === opts.depth
      && jointToolState.options.thickness === opts.thickness;
    if (same(next, jointToolState.hover) && optsSame) return;
    jointToolState.hover = next;
    jointToolState.options = opts;
    if (next) c.setStatus(`${next.hit.point.x.toFixed(1)}, ${next.hit.point.y.toFixed(1)} мм — клик вырежет паз`);
    else c.setStatus('Кликните по контуру детали');
    c.render('overlay');
  },

  up(): void {},

  cancel(c: ToolCtx): void {
    jointToolState.hover = null;
    c.setStatus(null);
    c.render('overlay');
  },

  overlay(): ToolOverlay {
    return {
      marquee: null,
      snap: null,
      align: [],
      draw: (ctx, view) => {
        const hover = jointToolState.hover;
        const opts = jointToolState.options;
        if (!hover || !opts) return;
        const poly = jointPolygon(hover.hit, opts);
        const pts = [poly.start, ...poly.segs.map((s) => s.b)];
        ctx.save();
        ctx.beginPath();
        const first = view.toScreen(pts[0]);
        ctx.moveTo(first.x, first.y);
        for (const p of pts.slice(1)) {
          const q = view.toScreen(p);
          ctx.lineTo(q.x, q.y);
        }
        ctx.closePath();
        ctx.fillStyle = opts.mode === 'tab' ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.24)';
        ctx.strokeStyle = opts.mode === 'tab' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      },
    };
  },
};
