import type { Box, Id, Obj, Vec2 } from '../core/types';
import { normBox, boxesIntersect, worldBBox, boxUnion, boxCenter } from '../core/geom/path';
import { compose, rotate, scaleM, translate } from '../core/geom/transform';
import { pickObject } from '../core/geom/hit';
import { updateCmd, type Patch } from '../state/history';
import { smartAlign, smartSpacing, type AlignLine } from '../core/smart';
import { anchorFor, handleAxes, handleCursor, hitHandle, type HandleId } from '../render/handles';
import type { Tool, ToolCtx, ToolOverlay } from './tool';

type Mode = 'idle' | 'move' | 'marquee' | 'scale' | 'rotate';

/** Минимальный масштаб, чтобы объект не «схлопнулся» в точку. */
const MIN_SCALE = 0.01;
const ROTATE_STEP = Math.PI / 12; // 15°, как шаг поворота в CorelDRAW

const boxOf = (objs: Obj[]): Box | null => {
  let box: Box | null = null;
  for (const obj of objs) box = boxUnion(box, worldBBox(obj.path, obj.transform));
  return box;
};

/** Матрица масштаба вокруг точки (мм). */
const scaleAbout = (a: Vec2, sx: number, sy: number) =>
  compose(translate(a.x, a.y), compose(scaleM(sx, sy), translate(-a.x, -a.y)));

/** Матрица поворота вокруг точки (мм). */
const rotateAbout = (c: Vec2, ang: number) =>
  compose(translate(c.x, c.y), compose(rotate(ang), translate(-c.x, -c.y)));

export function createSelectTool(): Tool {
  let mode: Mode = 'idle';
  let start: Vec2 = { x: 0, y: 0 };
  let before: Obj[] = [];
  let moved = false;
  let marquee: Box | null = null;
  let snap: ToolOverlay['snap'] = null;
  let align: AlignLine[] = [];
  let baseSelection: Id[] = [];
  // ручки трансформации
  let handleId: HandleId | null = null;
  let startBox: Box | null = null;
  let anchor: Vec2 = { x: 0, y: 0 };
  let startAngle = 0;
  let center: Vec2 = { x: 0, y: 0 };

  const pick = (p: Vec2, c: ToolCtx): Id | null =>
    pickObject(c.store.state.doc, c.store.state.sheet, p, c.view.px(6));

  /** Рамка перетаскиваемых объектов (по их исходным положениям) + смещение. */
  const draggedBox = (dx: number, dy: number): Box | null => {
    const box = boxOf(before);
    return box ? { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h } : null;
  };

  /** Патчи для текущей операции: preview применяется на каждом кадре, commit — на отпускании. */
  const applyMatrix = (c: ToolCtx, m: (o: Obj) => Obj['transform']): void => {
    const patches: Patch[] = before.map((b) => ({ kind: 'update', before: b, after: { ...b, transform: m(b) } }));
    c.store.preview(patches);
  };

  return {
    id: 'select',
    cursor: 'default',

    down(p, ev, c) {
      // 1) ручка трансформации — приоритетнее выбора объекта под курсором
      const sel = c.store.selected();
      if (sel.length) {
        const box = boxOf(sel);
        const h = box ? hitHandle(box, c.view, p) : null;
        if (box && h) {
          before = sel;
          startBox = box;
          handleId = h;
          start = p;
          moved = false;
          align = [];
          snap = null;
          if (h === 'rotate') {
            mode = 'rotate';
            center = boxCenter(box);
            startAngle = Math.atan2(p.y - center.y, p.x - center.x);
            c.setCursor('grabbing');
          } else {
            mode = 'scale';
            anchor = anchorFor(h, box) ?? boxCenter(box);
            c.setCursor(handleCursor(h));
          }
          c.render('overlay');
          return;
        }
      }

      const hitId = pick(p, c);
      if (hitId) {
        if (ev.shiftKey) c.store.toggleSelect(hitId);
        else if (!c.store.state.selection.includes(hitId)) c.store.select([hitId]);
        before = c.store.selected();
        mode = 'move';
        moved = false;
        const s = c.snapAt(p, new Set(c.store.state.selection));
        start = s ? s.point : p;
        snap = s;
        c.setCursor('grabbing');
      } else {
        if (!ev.shiftKey) c.store.select([]);
        baseSelection = [...c.store.state.selection];
        mode = 'marquee';
        start = p;
        marquee = normBox(p, p);
      }
      c.render('overlay');
    },

    move(p, ev, c) {
      if (mode === 'idle') {
        // подсветка курсора над ручкой — видно, что рамка живая
        const sel = c.store.selected();
        const box = sel.length ? boxOf(sel) : null;
        const h = box ? hitHandle(box, c.view, p) : null;
        c.setCursor(h ? handleCursor(h) : 'default');
        return;
      }

      if (mode === 'scale') {
        const sb = startBox;
        if (!sb) return;
        const axes = handleAxes(handleId as HandleId);
        const hx = handleId?.includes('w') ? sb.x : sb.x + sb.w;
        const hy = handleId?.startsWith('s') ? sb.y : sb.y + sb.h;
        const a = ev.altKey ? boxCenter(sb) : anchor;
        let sx = 1;
        let sy = 1;
        if (axes.x) {
          const den = hx - a.x;
          if (Math.abs(den) > 1e-9) sx = (p.x - a.x) / den;
        }
        if (axes.y) {
          const den = hy - a.y;
          if (Math.abs(den) > 1e-9) sy = (p.y - a.y) / den;
        }
        if (ev.shiftKey) {
          // пропорционально: берём большую по модулю ось
          const k = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
          sx = axes.x ? k : 1;
          sy = axes.y ? k : 1;
        }
        if (Math.abs(sx) < MIN_SCALE) sx = Math.sign(sx || 1) * MIN_SCALE;
        if (Math.abs(sy) < MIN_SCALE) sy = Math.sign(sy || 1) * MIN_SCALE;
        applyMatrix(c, (b) => compose(scaleAbout(a, sx, sy), b.transform));
        c.setStatus(`${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%`);
        c.render('both');
        return;
      }

      if (mode === 'rotate') {
        let ang = Math.atan2(p.y - center.y, p.x - center.x) - startAngle;
        if (ev.shiftKey) ang = Math.round(ang / ROTATE_STEP) * ROTATE_STEP;
        applyMatrix(c, (b) => compose(rotateAbout(center, ang), b.transform));
        const deg = (ang * 180) / Math.PI;
        c.setStatus(`${deg >= 0 ? '' : '−'}${Math.abs(deg).toFixed(1)}°`);
        c.render('both');
        return;
      }

      if (mode === 'move') {
        const s = c.snapAt(p, new Set(c.store.state.selection));
        snap = s;
        const q = s ? s.point : p;
        let dx = q.x - start.x;
        let dy = q.y - start.y;
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        // Умное выравнивание: края/центры соседей и листа, затем равные интервалы.
        align = [];
        if (c.store.state.smartGuides && before.length) {
          const exclude = new Set(c.store.state.selection);
          const tol = c.view.px(6);
          const box = draggedBox(dx, dy);
          if (box) {
            const smart = smartAlign(box, c.store.state.doc, c.store.state.sheet, tol, exclude);
            dx += smart.dx;
            dy += smart.dy;
            align.push(...smart.lines);
            // интервалы ищем только по осям, где выравнивание не сработало
            const spaced = smartSpacing(
              { x: box.x + smart.dx, y: box.y + smart.dy, w: box.w, h: box.h },
              c.store.state.doc, c.store.state.sheet, tol, exclude,
            );
            if (!smart.dx && spaced.dx) {
              dx += spaced.dx;
              align.push(...spaced.lines.filter((l) => l.axis === 'y'));
            }
            if (!smart.dy && spaced.dy) {
              dy += spaced.dy;
              align.push(...spaced.lines.filter((l) => l.axis === 'x'));
            }
          }
        }
        moved = Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9;
        if (moved) {
          const patches: Patch[] = before.map((b) => ({
            kind: 'update',
            before: b,
            after: { ...b, transform: { ...b.transform, e: b.transform.e + dx, f: b.transform.f + dy } },
          }));
          c.store.preview(patches);
        }
        c.render('both');
      } else if (mode === 'marquee') {
        marquee = normBox(start, p);
        c.render('overlay');
      }
    },

    up(_p, _ev, c) {
      if (mode === 'scale' || mode === 'rotate') {
        const label = mode === 'scale' ? 'Масштаб' : 'Поворот';
        const pairs = before
          .map((b) => ({ before: b, after: c.store.state.doc.objects[b.id] }))
          .filter((pair): pair is { before: Obj; after: Obj } => !!pair.after);
        const changed = pairs.some((pr) => JSON.stringify(pr.before.transform) !== JSON.stringify(pr.after.transform));
        if (changed) c.store.commit(updateCmd(label, pairs));
        mode = 'idle';
        handleId = null;
        startBox = null;
        before = [];
        c.setStatus(null);
        c.setCursor('default');
        c.render('both');
        return;
      }

      if (mode === 'move') {
        if (moved) {
          const pairs = before
            .map((b) => ({ before: b, after: c.store.state.doc.objects[b.id] }))
            .filter((pair): pair is { before: Obj; after: Obj } => !!pair.after);
          if (pairs.length) c.store.commit(updateCmd('Перемещение', pairs));
        }
        snap = null;
      } else if (mode === 'marquee' && marquee) {
        if (marquee.w > 1e-6 || marquee.h > 1e-6) {
          const { doc, sheet } = c.store.state;
          const hits: Id[] = [];
          for (const id of doc.order) {
            const obj = doc.objects[id];
            if (!obj || obj.sheetId !== sheet.id || obj.hidden || obj.locked) continue;
            if (boxesIntersect(worldBBox(obj.path, obj.transform), marquee)) hits.push(id);
          }
          const sel = new Set([...baseSelection, ...hits]);
          c.store.select([...sel]);
        }
        marquee = null;
      }
      mode = 'idle';
      before = [];
      baseSelection = [];
      align = [];
      c.setCursor('default');
      c.render('both');
    },

    cancel(c) {
      if ((mode === 'move' || mode === 'scale' || mode === 'rotate') && before.length) {
        const patches: Patch[] = before.map((b) => ({ kind: 'update', before: c.store.state.doc.objects[b.id] ?? b, after: b }));
        c.store.preview(patches);
      }
      mode = 'idle';
      marquee = null;
      snap = null;
      align = [];
      before = [];
      handleId = null;
      startBox = null;
      c.setStatus(null);
      c.setCursor('default');
      c.render('both');
    },

    overlay() {
      return { marquee, snap, align, draw: null };
    },
  };
}
