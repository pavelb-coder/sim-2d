import type { Box, Vec2 } from '../core/types';
import { boxCenter } from '../core/geom/path';
import type { View } from './view';

/**
 * Ручки трансформации выделения (как в CorelDRAW): 8 ручек масштаба по рамке
 * и одна ручка поворота над верхней гранью.
 *
 * Координаты ручек считаются в экранных пикселях: рамка в мире может быть
 * перевёрнутой (ось Y документа направлена вверх), а ручки на экране — всегда
 * слева/справа/сверху/снизу. Один и тот же модуль используют и оверлей (рисует),
 * и инструмент выбора (попадает мышью), поэтому разъехаться они не могут.
 */

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

export const HANDLE_SIZE = 7;
/** насколько ручка поворота выше верхней грани, px */
export const ROTATE_OFFSET = 20;

const SCALE_IDS: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface HandlePoint { id: HandleId; screen: Vec2 }

/** Экранные координаты всех ручек для рамки в мировых мм. */
export function handlePoints(box: Box, view: View): HandlePoint[] {
  const a = view.toScreen({ x: box.x, y: box.y });
  const b = view.toScreen({ x: box.x + box.w, y: box.y + box.h });
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  const pos: Record<HandleId, Vec2> = {
    nw: { x: x0, y: y0 }, n: { x: xm, y: y0 }, ne: { x: x1, y: y0 },
    e: { x: x1, y: ym }, se: { x: x1, y: y1 }, s: { x: xm, y: y1 },
    sw: { x: x0, y: y1 }, w: { x: x0, y: ym },
    rotate: { x: xm, y: y0 - ROTATE_OFFSET },
  };
  return (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'] as HandleId[]).map((id) => ({ id, screen: pos[id] }));
}

/** Ручка под курсором (мировые мм → экран внутри). */
export function hitHandle(box: Box, view: View, world: Vec2, extraPx = 3): HandleId | null {
  const p = view.toScreen(world);
  const r = HANDLE_SIZE / 2 + extraPx;
  const points = handlePoints(box, view);
  // ручку поворота проверяем первой: она вне рамки и не перекрывает масштаб
  for (const id of ['rotate', ...SCALE_IDS] as HandleId[]) {
    const h = points.find((hp) => hp.id === id);
    if (!h) continue;
    if (Math.abs(p.x - h.screen.x) <= r && Math.abs(p.y - h.screen.y) <= r) return id;
  }
  return null;
}

export const isScaleHandle = (id: HandleId): boolean => id !== 'rotate';

/**
 * Неподвижная точка масштабирования — противоположный угол/середина грани.
 * Возвращается в мировых мм; null для ручки поворота.
 */
export function anchorFor(id: HandleId, box: Box): Vec2 | null {
  const center = boxCenter(box);
  const left = box.x, right = box.x + box.w, bottom = box.y, top = box.y + box.h;
  switch (id) {
    case 'nw': return { x: right, y: bottom };
    case 'ne': return { x: left, y: bottom };
    case 'se': return { x: left, y: top };
    case 'sw': return { x: right, y: top };
    case 'n': return { x: center.x, y: bottom };
    case 's': return { x: center.x, y: top };
    case 'w': return { x: right, y: center.y };
    case 'e': return { x: left, y: center.y };
    default: return null;
  }
}

/** Тянет ли ручка ось X / ось Y. */
export const handleAxes = (id: HandleId): { x: boolean; y: boolean } => ({
  x: id === 'e' || id === 'w' || id.includes('e') || id.includes('w'),
  y: id === 'n' || id === 's' || id.startsWith('n') || id.startsWith('s'),
});

/** Курсор под ручку — как в CorelDRAW, с диагональными стрелками. */
export function handleCursor(id: HandleId): string {
  switch (id) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    default: return 'grab';
  }
}
