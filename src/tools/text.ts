import type { Vec2 } from '../core/types';
import { makeObj } from '../core/shape';
import { IDENT } from '../core/geom/transform';
import { ensureFont, textToPaths, fontState } from '../core/text';
import { addCmd } from '../state/history';
import { askText } from '../ui/dialog';
import type { Tool, ToolOverlay } from './tool';

let pendingPoint: Vec2 | null = null;
let heightMm = 10;

export function setTextHeight(mm: number): void {
  heightMm = Math.max(1, Math.min(200, mm));
}

export const textTool: Tool = {
  id: 'text',
  cursor: 'text',

  down(p, _ev, c) {
    pendingPoint = p;
    void (async () => {
      const ok = await ensureFont();
      if (!ok) {
        c.setStatus('Шрифт не загрузился — текст недоступен');
        pendingPoint = null;
        return;
      }
      const value = await askText({
        title: 'Текст для резки или гравировки',
        label: `Надпись (высота ${heightMm} мм)`,
        value: 'Текст',
        placeholder: 'Введите надпись',
      });
      if (!value || !value.trim() || !pendingPoint) return;
      const res = textToPaths(value, heightMm);
      if (!res) { c.setStatus('Не удалось перевести текст в кривые'); return; }
      const layer = c.store.activeLayer();
      const obj = makeObj({
        sheetId: c.store.state.sheet.id,
        layerId: layer.id,
        path: res.paths,
        transform: { ...IDENT, e: pendingPoint.x, f: pendingPoint.y },
        style: c.store.styleFor(layer),
        name: value.slice(0, 24),
      });
      c.store.commit(addCmd(obj));
      c.store.select([obj.id]);
      c.store.setTool('select');
      c.setStatus(null);
      c.render('both');
    })();
  },

  move(p, _ev, c) {
    void p;
    if (fontState() === 'missing') c.setStatus('Шрифт загружается…');
  },

  up() {},
  cancel(c) { pendingPoint = null; c.setStatus(null); },
  overlay(): ToolOverlay { return { marquee: null, snap: null, draw: null }; },
};
