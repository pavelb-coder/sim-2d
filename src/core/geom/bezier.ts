import type { Box, Vec2 } from '../types';
import { dist } from './vec';

export function cubicPoint(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

/** Разбиение кубической Безье в t (де Кастельжо). */
export function cubicSplit(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t = 0.5) {
  const l = (a: Vec2, b: Vec2) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = l(p0, c1), p12 = l(c1, c2), p23 = l(c2, p3);
  const p012 = l(p01, p12), p123 = l(p12, p23);
  const mid = l(p012, p123);
  return {
    left: [p0, p01, p012, mid] as const,
    right: [mid, p123, p23, p3] as const,
  };
}

function quadRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    return [-c / b];
  }
  const d = b * b - 4 * a * c;
  if (d < 0) return [];
  const s = Math.sqrt(d);
  return [(-b + s) / (2 * a), (-b - s) / (2 * a)];
}

/** Параметры экстремумов кубической Безье по одной оси. */
function cubicExtremaT(p0: number, c1: number, c2: number, p3: number): number[] {
  const A = c1 - p0, B = c2 - c1, C = p3 - c2;
  const qa = A - 2 * B + C, qb = 2 * (B - A), qc = A;
  return quadRoots(qa, qb, qc).filter((t) => t > 1e-9 && t < 1 - 1e-9);
}

/** Точный bbox кубической Безье (по экстремумам, а не по контрольным точкам). */
export function cubicBBox(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2): Box {
  let minX = Math.min(p0.x, p3.x), maxX = Math.max(p0.x, p3.x);
  let minY = Math.min(p0.y, p3.y), maxY = Math.max(p0.y, p3.y);
  for (const t of cubicExtremaT(p0.x, c1.x, c2.x, p3.x)) {
    const x = cubicPoint(p0, c1, c2, p3, t).x;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  for (const t of cubicExtremaT(p0.y, c1.y, c2.y, p3.y)) {
    const y = cubicPoint(p0, c1, c2, p3, t).y;
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Насколько «плоская» кривая: максимальное отклонение контрольных точек от хорды. */
function flatness(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2): number {
  const ux = 3 * c1.x - 2 * p0.x - p3.x, uy = 3 * c1.y - 2 * p0.y - p3.y;
  const vx = 3 * c2.x - p0.x - 2 * p3.x, vy = 3 * c2.y - p0.y - 2 * p3.y;
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
}

/** Адаптивный флаттенинг: возвращает точки БЕЗ начальной, С конечной. */
export function cubicFlatten(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, tol: number, out: Vec2[] = [], depth = 0): Vec2[] {
  if (depth < 24 && flatness(p0, c1, c2, p3) > 16 * tol * tol) {
    const { left, right } = cubicSplit(p0, c1, c2, p3, 0.5);
    cubicFlatten(left[0], left[1], left[2], left[3], tol, out, depth + 1);
    cubicFlatten(right[0], right[1], right[2], right[3], tol, out, depth + 1);
  } else {
    out.push(p3);
  }
  return out;
}

/** Длина кубической Безье (приближение по флаттенингу). */
export function cubicLength(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, tol = 0.01): number {
  const pts = [p0, ...cubicFlatten(p0, c1, c2, p3, tol)];
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Начальный/конечный наклон — нужен для «гладких» узлов при правке. */
export function cubicTangent(p0: Vec2, c1: Vec2, c2: Vec2, p3: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  const x = 3 * (mt * mt * (c1.x - p0.x) + 2 * mt * t * (c2.x - c1.x) + t * t * (p3.x - c2.x));
  const y = 3 * (mt * mt * (c1.y - p0.y) + 2 * mt * t * (c2.y - c1.y) + t * t * (p3.y - c2.y));
  return { x, y };
}
