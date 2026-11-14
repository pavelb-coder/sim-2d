import type { Box, Id, Obj, Vec2 } from '../core/types';
import { normBox, boxesIntersect, worldBBox } from '../core/geom/path';
import { pickObject } from '../core/geom/hit';
import { updateCmd, type Patch } from '../state/history';
import type { Tool, ToolCtx, ToolOverlay } from './tool';

type Mode = 'idle' | 'move' | 'marquee';

export function createSelectTool(): Tool {
  let mode: Mode = 'idle';
  let start: Vec2 = { x: 0, y: 0 };
  let before: Obj[] = [];
  let moved = false;
  let marquee: Box | null = null;
  let snap: ToolOverlay['snap'] = null;
  let baseSelection: Id[] = [];

  const pick = (p: Vec2, c: ToolCtx): Id | null =>
    pickObject(c.store.state.doc, c.store.state.sheet, p, c.view.px(6));

  return {
    id: 'select',
    cursor: 'default',

    down(p, ev, c) {
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
      c.setCursor('default');
      c.render('both');
    },

    cancel(c) {
      if (mode === 'move' && moved && before.length) {
        const patches: Patch[] = before.map((b) => ({ kind: 'update', before: c.store.state.doc.objects[b.id] ?? b, after: b }));
        c.store.preview(patches);
      }
      mode = 'idle';
      marquee = null;
      snap = null;
      before = [];
      c.setCursor('default');
      c.render('both');
    },

    overlay() {
      return { marquee, snap, draw: null };
    },
  };
}
