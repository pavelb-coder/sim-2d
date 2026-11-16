import type { Box, Doc, Id, Sheet } from './types';
import { worldBBox } from './geom/path';

/** Линия выравнивания, которую рисуем на оверлее (как Dynamic guides в CorelDRAW). */
export interface AlignLine {
  axis: 'x' | 'y';
  /** координата линии, мм */
  at: number;
  /** протяжённость линии по другой оси, мм */
  from: number;
  to: number;
}

export interface SmartResult {
  /** на сколько подвинуть объект, чтобы выровнять (0 — выравнивания нет) */
  dx: number;
  dy: number;
  lines: AlignLine[];
}

const XS = (b: Box): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
const YS = (b: Box): number[] => [b.y, b.y + b.h / 2, b.y + b.h];

interface Cand { at: number; from: number; to: number }

/**
 * «Умное» выравнивание при перетаскивании: смотрим, не совпадает ли край/центр
 * перемещаемой рамки с краем или центром другого объекта либо листа, и подтягиваем
 * по каждой оси отдельно. Возвращает смещение и линии для отрисовки.
 */
export function smartAlign(box: Box, doc: Doc, sheet: Sheet, tol: number, exclude: Set<Id> = new Set()): SmartResult {
  if (tol <= 0) return { dx: 0, dy: 0, lines: [] };

  const cx: Cand[] = [];
  const cy: Cand[] = [];

  for (const id of doc.order) {
    const obj = doc.objects[id];
    if (!obj || obj.sheetId !== sheet.id || obj.hidden || exclude.has(id)) continue;
    const b = worldBBox(obj.path, obj.transform);
    for (const x of XS(b)) cx.push({ at: x, from: b.y, to: b.y + b.h });
    for (const y of YS(b)) cy.push({ at: y, from: b.x, to: b.x + b.w });
  }
  // Края и центр листа — тоже полноценные линии выравнивания.
  for (const x of [0, sheet.width / 2, sheet.width]) cx.push({ at: x, from: 0, to: sheet.height });
  for (const y of [0, sheet.height / 2, sheet.height]) cy.push({ at: y, from: 0, to: sheet.width });

  const best = (cands: Cand[], targets: number[]): { delta: number; cand: Cand } | null => {
    let bestDelta = tol;
    let hit: { delta: number; cand: Cand } | null = null;
    for (const cand of cands) {
      for (const t of targets) {
        const delta = cand.at - t;
        // строгое сравнение: при равном расстоянии выигрывает первая линия
        // (край раньше центра) — поведение должно быть предсказуемым
        if (Math.abs(delta) < bestDelta || (Math.abs(delta) === bestDelta && hit === null)) {
          bestDelta = Math.abs(delta);
          hit = { delta, cand };
        }
      }
    }
    return hit;
  };

  const hitX = best(cx, XS(box));
  const hitY = best(cy, YS(box));

  const lines: AlignLine[] = [];
  const moved: Box = {
    x: box.x + (hitX ? hitX.delta : 0),
    y: box.y + (hitY ? hitY.delta : 0),
    w: box.w,
    h: box.h,
  };
  if (hitX) {
    lines.push({
      axis: 'x',
      at: hitX.cand.at,
      from: Math.min(hitX.cand.from, moved.y),
      to: Math.max(hitX.cand.to, moved.y + moved.h),
    });
  }
  if (hitY) {
    lines.push({
      axis: 'y',
      at: hitY.cand.at,
      from: Math.min(hitY.cand.from, moved.x),
      to: Math.max(hitY.cand.to, moved.x + moved.w),
    });
  }

  return { dx: hitX ? hitX.delta : 0, dy: hitY ? hitY.delta : 0, lines };
}
