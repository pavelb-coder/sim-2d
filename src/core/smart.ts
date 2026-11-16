import type { Box, Doc, Id, Sheet } from './types';
import { worldBBox } from './geom/path';

/** Линия выравнивания, которую рисуем на оверлее (как Dynamic guides в CorelDRAW). */
export interface AlignLine {
  axis: 'x' | 'y';
  /** 'align' — совпадение краёв/центров, 'gap' — равные интервалы между объектами */
  kind?: 'align' | 'gap';
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

/**
 * «Равные интервалы» (как smart spacing в CorelDRAW): при перетаскивании смотрим,
 * не встаёт ли объект ровно посередине между двумя соседями или на таком же
 * расстоянии от соседа, как уже стоят другие объекты на листе.
 * Возвращает то же смещение и линии, что и smartAlign, — их рисует один оверлей.
 */
export function smartSpacing(box: Box, doc: Doc, sheet: Sheet, tol: number, exclude: Set<Id> = new Set()): SmartResult {
  if (tol <= 0) return { dx: 0, dy: 0, lines: [] };

  interface Span { lo: number; hi: number; from: number; to: number }
  const spansX: Span[] = [];
  const spansY: Span[] = [];
  for (const id of doc.order) {
    const obj = doc.objects[id];
    if (!obj || obj.sheetId !== sheet.id || obj.hidden || exclude.has(id)) continue;
    const b = worldBBox(obj.path, obj.transform);
    spansX.push({ lo: b.x, hi: b.x + b.w, from: b.y, to: b.y + b.h });
    spansY.push({ lo: b.y, hi: b.y + b.h, from: b.x, to: b.x + b.w });
  }
  spansX.push({ lo: 0, hi: 0, from: 0, to: sheet.height }, { lo: sheet.width, hi: sheet.width, from: 0, to: sheet.height });
  spansY.push({ lo: 0, hi: 0, from: 0, to: sheet.width }, { lo: sheet.height, hi: sheet.height, from: 0, to: sheet.width });

  /** Все существующие зазоры между соседями по оси (для «такого же расстояния»). */
  const gapsOf = (spans: Span[]): number[] => {
    const sorted = [...spans].sort((a, b) => a.lo - b.lo);
    const out: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].lo - sorted[i - 1].hi;
      if (gap > 0.01) out.push(gap);
    }
    return out;
  };

  /**
   * Одна ось: lo0/hi0 — текущее положение рамки,
   * перебираем варианты сдвига и берём наименьший в пределах допуска.
   */
  const solve = (spans: Span[], lo: number, hi: number, cross: [number, number]): { delta: number; from: number; to: number } | null => {
    // соседи, перекрывающиеся с рамкой по другой оси (только «в ряд»)
    const near = spans.filter((s) => s.to > cross[0] && s.from < cross[1]);
    const left = near.filter((s) => s.hi <= lo + 0.01).sort((a, b) => b.hi - a.hi)[0] ?? null;
    const right = near.filter((s) => s.lo >= hi - 0.01).sort((a, b) => a.lo - b.lo)[0] ?? null;
    const width = hi - lo;
    const cands: { delta: number; from: number; to: number }[] = [];
    const gaps = gapsOf(near);

    if (left && right) {
      // ровно посередине между двумя соседями
      const total = right.lo - left.hi;
      if (total > width + 0.01) {
        const target = left.hi + (total - width) / 2;
        cands.push({ delta: target - lo, from: left.hi, to: right.lo });
      }
    }
    if (left) {
      for (const g of gaps) cands.push({ delta: left.hi + g - lo, from: left.hi, to: right ? right.lo : left.hi + g + width });
    }
    if (right) {
      for (const g of gaps) cands.push({ delta: right.lo - g - width - lo, from: left ? left.hi : right.lo - g - width, to: right.lo });
    }

    let best: { delta: number; from: number; to: number } | null = null;
    for (const c of cands) {
      if (Math.abs(c.delta) > tol) continue;
      if (!best || Math.abs(c.delta) < Math.abs(best.delta)) best = c;
    }
    return best;
  };

  const hitX = solve(spansX, box.x, box.x + box.w, [box.y, box.y + box.h]);
  const hitY = solve(spansY, box.y, box.y + box.h, [box.x, box.x + box.w]);

  const lines: AlignLine[] = [];
  if (hitX) {
    lines.push({ axis: 'y', kind: 'gap', at: box.y + box.h / 2, from: hitX.from, to: hitX.to });
  }
  if (hitY) {
    lines.push({ axis: 'x', kind: 'gap', at: box.x + box.w / 2, from: hitY.from, to: hitY.to });
  }
  return { dx: hitX ? hitX.delta : 0, dy: hitY ? hitY.delta : 0, lines };
}
