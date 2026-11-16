import type { Obj, Vec2 } from '../core/types';
import { ellipsePath, linePath, makeObj, polygonPath, rectPath, starPath } from '../core/shape';
import { rotate, translate, compose, IDENT } from '../core/geom/transform';
import { addCmd } from '../state/history';
import { dist } from '../core/geom/vec';
import type { Tool, ToolCtx, ToolOverlay } from './tool';
import { drawObject } from '../render/scene';

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'polygon' | 'star';

const MIN_SIZE = 0.2;

export function createShapeTool(kind: ShapeKind): Tool {
  let active = false;
  let start: Vec2 = { x: 0, y: 0 };
  let cur: Vec2 = { x: 0, y: 0 };
  let snap: ToolOverlay['snap'] = null;
  let preview: Obj | null = null;

  function build(c: ToolCtx): Obj | null {
    const dx = cur.x - start.x;
    const dy = cur.y - start.y;
    const layer = c.store.activeLayer();
    if (kind === 'line') {
      const len = dist(start, cur);
      if (len < MIN_SIZE) return null;
      const mid = { x: (start.x + cur.x) / 2, y: (start.y + cur.y) / 2 };
      const angle = Math.atan2(dy, dx);
      return makeObj({
        sheetId: c.store.state.sheet.id,
        layerId: layer.id,
        path: linePath(len),
        transform: compose(translate(mid.x, mid.y), rotate(angle)),
        style: c.store.styleFor(layer),
        name: 'Линия',
      });
    }
    const w = Math.abs(dx), h = Math.abs(dy);
    if (w < MIN_SIZE || h < MIN_SIZE) return null;
    const cx = start.x + dx / 2, cy = start.y + dy / 2;
    if (kind === 'polygon' || kind === 'star') {
      // единичная фигура + неоднородный масштаб — прямоугольник протяжки задаёт габарит,
      // как при протяжке инструментом Polygon в CorelDRAW
      const st = c.store.state;
      const path = kind === 'polygon'
        ? polygonPath(1, st.polySides)
        : starPath(1, st.starPoints, st.starInner);
      return makeObj({
        sheetId: st.sheet.id,
        layerId: layer.id,
        path,
        transform: { a: w / 2, b: 0, c: 0, d: h / 2, e: cx, f: cy },
        style: c.store.styleFor(layer),
        name: kind === 'polygon' ? `Многоугольник ${Math.round(st.polySides)}` : `Звезда ${Math.round(st.starPoints)}`,
      });
    }
    return makeObj({
      sheetId: c.store.state.sheet.id,
      layerId: layer.id,
      path: kind === 'rect' ? rectPath(w, h) : ellipsePath(w, h),
      transform: { ...IDENT, e: cx, f: cy },
      style: c.store.styleFor(layer),
      name: kind === 'rect' ? 'Прямоугольник' : 'Эллипс',
    });
  }

  function constrain(p: Vec2, shift: boolean): Vec2 {
    if (!shift) return p;
    const dx = p.x - start.x, dy = p.y - start.y;
    if (kind === 'line') {
      const ang = Math.atan2(dy, dx);
      const step = Math.PI / 4;
      const snapped = Math.round(ang / step) * step;
      const len = Math.hypot(dx, dy);
      return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
    }
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + Math.sign(dx || 1) * size, y: start.y + Math.sign(dy || 1) * size };
  }

  return {
    id: kind,
    cursor: 'crosshair',

    down(p, ev, c) {
      const s = c.snapAt(p);
      snap = s;
      start = s ? s.point : p;
      cur = start;
      active = true;
      preview = null;
      c.setCursor('crosshair');
      void ev;
      c.render('overlay');
    },

    move(p, ev, c) {
      if (!active) {
        const s = c.snapAt(p);
        if (s) { snap = s; c.render('overlay'); }
        else if (snap) { snap = null; c.render('overlay'); }
        return;
      }
      const s = c.snapAt(p);
      snap = s;
      cur = constrain(s ? s.point : p, ev.shiftKey);
      preview = build(c);
      c.setStatus(`${cur.x.toFixed(2)} × ${cur.y.toFixed(2)} мм`);
      c.render('overlay');
    },

    up(_p, _ev, c) {
      if (!active) return;
      active = false;
      const obj = build(c);
      snap = null;
      preview = null;
      if (obj) {
        c.store.commit(addCmd(obj));
        c.store.select([obj.id]);
      }
      c.setStatus(null);
      c.render('both');
    },

    cancel(c) {
      active = false;
      preview = null;
      snap = null;
      c.setStatus(null);
      c.render('both');
    },

    overlay() {
      return {
        marquee: null,
        snap,
        align: [],
        draw: preview
          ? (ctx, view, dpr) => drawObject(ctx, preview as Obj, view, dpr, { color: 'rgba(14,165,233,0.9)', widthPx: 1.6, dash: [6, 4] })
          : null,
      };
    },
  };
}
