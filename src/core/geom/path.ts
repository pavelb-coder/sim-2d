import type { Box, Mat2x3, Seg, SubPath, Vec2 } from '../types';
import { arcBBox, arcLength, arcPoint, arcToCubics, TAU } from './arc';
import { cubicBBox, cubicFlatten, cubicLength, cubicPoint } from './bezier';
import { apply } from './transform';
import { add, dist, distToSeg, sub } from './vec';

export const emptyBox = (): Box => ({ x: 0, y: 0, w: 0, h: 0 });

export function boxUnion(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w), maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export const boxCenter = (b: Box): Vec2 => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const boxContains = (b: Box, p: Vec2): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
export const boxesIntersect = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const boxExpand = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
export const normBox = (a: Vec2, b: Vec2): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

export function segBBox(s: Seg): Box {
  switch (s.t) {
    case 'l': {
      const x = Math.min(s.a.x, s.b.x), y = Math.min(s.a.y, s.b.y);
      return { x, y, w: Math.abs(s.b.x - s.a.x), h: Math.abs(s.b.y - s.a.y) };
    }
    case 'c':
      return cubicBBox(s.a, s.c1, s.c2, s.b);
    case 'a':
      return arcBBox(s.center, s.r, s.a0, s.sweep);
  }
}

export function bboxOfSubPaths(path: SubPath[]): Box {
  let box: Box | null = null;
  for (const sp of path) {
    for (const s of sp.segs) box = boxUnion(box, segBBox(s));
  }
  return box ?? emptyBox();
}

/** Преобразование одного сегмента. Дуга может распасться на несколько кубических. */
export function transformSeg(s: Seg, m: Mat2x3): Seg[] {
  const a = apply(m, s.a), b = apply(m, s.b);
  if (s.t === 'l') return [{ t: 'l', a, b }];
  if (s.t === 'c') return [{ t: 'c', a, c1: apply(m, s.c1), c2: apply(m, s.c2), b }];
  // дуга: точное преобразование только для подобия без отражения
  const scale = Math.hypot(m.a, m.b);
  const scale2 = Math.hypot(m.c, m.d);
  const orthogonal = Math.abs(m.a * m.c + m.b * m.d) < 1e-9;
  const positive = m.a * m.d - m.b * m.c > 0;
  if (orthogonal && Math.abs(scale - scale2) < 1e-9 && positive) {
    const rotation = Math.atan2(m.b, m.a);
    return [{ t: 'a', a, b, center: apply(m, s.center), r: s.r * scale, a0: s.a0 + rotation, sweep: s.sweep }];
  }
  // иначе — через Безье: геометрически верно, но «дуговость» теряется
  return arcToCubics(s.center, s.r, s.a0, s.sweep).map((c) =>
    c.t === 'c' ? { t: 'c' as const, a: apply(m, c.a), c1: apply(m, c.c1), c2: apply(m, c.c2), b: apply(m, c.b) } : c,
  );
}

export function transformSubPaths(path: SubPath[], m: Mat2x3): SubPath[] {
  return path.map((sp) => ({
    closed: sp.closed,
    start: apply(m, sp.start),
    segs: sp.segs.flatMap((s) => transformSeg(s, m)),
  }));
}

/** Приблизительная длина всех сегментов (мм). */
export function pathLength(path: SubPath[], tol = 0.01): number {
  let L = 0;
  for (const sp of path) {
    for (const s of sp.segs) {
      if (s.t === 'l') L += dist(s.a, s.b);
      else if (s.t === 'c') L += cubicLength(s.a, s.c1, s.c2, s.b, tol);
      else L += arcLength(s.r, s.sweep);
    }
  }
  return L;
}

/** Полилинии для hit-test / булевых / экспорта. Каждый подпуть — замкнутый набор точек. */
export function flattenSubPaths(path: SubPath[], tol = 0.02): Vec2[][] {
  const out: Vec2[][] = [];
  for (const sp of path) {
    const pts: Vec2[] = [sp.start];
    for (const s of sp.segs) {
      if (s.t === 'l') pts.push(s.b);
      else if (s.t === 'c') cubicFlatten(s.a, s.c1, s.c2, s.b, tol, pts);
      else {
        const n = Math.max(2, Math.ceil((Math.abs(s.sweep) * s.r) / Math.max(tol * 8, 0.05)));
        for (let i = 1; i <= n; i++) pts.push(arcPoint(s.center, s.r, s.a0, s.sweep, i / n));
      }
    }
    if (sp.closed && pts.length > 1) {
      const first = pts[0], last = pts[pts.length - 1];
      if (dist(first, last) > 1e-9) pts.push({ ...first });
    }
    out.push(pts);
  }
  return out;
}

export interface NearestHit { point: Vec2; dist: number; sub: number; seg: number; t: number }

/** Ближайшая точка на пути (в тех же координатах, что и path). */
export function nearestOnPath(path: SubPath[], p: Vec2, tol = 0.05): NearestHit | null {
  const polys = flattenSubPaths(path, Math.max(tol / 4, 0.01));
  let best: NearestHit | null = null;
  for (let si = 0; si < polys.length; si++) {
    const poly = polys[si];
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const d = distToSeg(p, a, b);
      if (!best || d < best.dist) best = { point: a, dist: d, sub: si, seg: i - 1, t: 0 };
    }
  }
  return best && best.dist <= tol ? best : best;
}

/** Точка на сегменте по параметру t (для правки узлов и превью). */
export function segPoint(s: Seg, t: number): Vec2 {
  if (s.t === 'l') return add(s.a, { x: (s.b.x - s.a.x) * t, y: (s.b.y - s.a.y) * t });
  if (s.t === 'c') return cubicPoint(s.a, s.c1, s.c2, s.b, t);
  return arcPoint(s.center, s.r, s.a0, s.sweep, t);
}

/** Длина сегмента. */
export function segLength(s: Seg, tol = 0.01): number {
  if (s.t === 'l') return dist(s.a, s.b);
  if (s.t === 'c') return cubicLength(s.a, s.c1, s.c2, s.b, tol);
  return arcLength(s.r, s.sweep);
}

/** Сдвиг подпути. */
export function translateSubPaths(path: SubPath[], d: Vec2): SubPath[] {
  const shift = (p: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });
  return path.map((sp) => ({
    closed: sp.closed,
    start: shift(sp.start),
    segs: sp.segs.map((s) => {
      if (s.t === 'l') return { t: 'l' as const, a: shift(s.a), b: shift(s.b) };
      if (s.t === 'c') return { t: 'c' as const, a: shift(s.a), c1: shift(s.c1), c2: shift(s.c2), b: shift(s.b) };
      return { t: 'a' as const, a: shift(s.a), b: shift(s.b), center: shift(s.center), r: s.r, a0: s.a0, sweep: s.sweep };
    }),
  }));
}

/** Границы повёрнутого/масштабированного объекта в координатах листа. */
export function worldBBox(path: SubPath[], m: Mat2x3): Box {
  return bboxOfSubPaths(transformSubPaths(path, m));
}

export const TAU2 = TAU;
export { sub };
