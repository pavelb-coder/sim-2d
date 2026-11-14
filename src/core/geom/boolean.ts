import * as ClipperLib from 'clipper-lib';
import type { SubPath, Vec2 } from '../types';
import { flattenSubPaths } from './path';

/**
 * Булевы операции и offset на Clipper (целочисленные координаты).
 * Масштаб 1e4 → дискретность 0.1 мкм, координаты до 3000 мм влезают с запасом.
 */
const SCALE = 1e4;

export type BoolOp = 'union' | 'diff' | 'intersect' | 'xor';
export type JoinStyle = 'round' | 'miter';

type CPath = { X: number; Y: number }[];

function toClipper(paths: SubPath[]): CPath[] {
  const out: CPath[] = [];
  for (const poly of flattenSubPaths(paths, 0.01)) {
    if (poly.length < 3) continue;
    const closed = Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) < 1e-9;
    const pts = closed ? poly.slice(0, -1) : poly;
    if (pts.length < 3) continue;
    out.push(pts.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
  }
  return out;
}

function fromClipper(paths: CPath[]): SubPath[] {
  return paths
    .filter((p) => p.length >= 3)
    .map((poly) => {
      const pts: Vec2[] = poly.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
      const segs = pts.slice(1).map((p, i) => ({ t: 'l' as const, a: pts[i], b: p }));
      segs.push({ t: 'l', a: pts[pts.length - 1], b: pts[0] });
      return { closed: true, start: pts[0], segs } as SubPath;
    });
}

function execute(subject: SubPath[], clip: SubPath[], op: BoolOp, subjectFill: number, clipFill: number): SubPath[] {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toClipper(subject), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) clipper.AddPaths(toClipper(clip), ClipperLib.PolyType.ptClip, true);

  const ct =
    op === 'union' ? ClipperLib.ClipType.ctUnion
    : op === 'diff' ? ClipperLib.ClipType.ctDifference
    : op === 'intersect' ? ClipperLib.ClipType.ctIntersection
    : ClipperLib.ClipType.ctXor;

  const solution: CPath[] = [];
  clipper.Execute(ct, solution, subjectFill, clip.length ? clipFill : subjectFill);
  return fromClipper(solution);
}

const EVEN_ODD = 0; // pftEvenOdd
const NON_ZERO = 1; // pftNonZero

/** A op B. Даёт всегда замкнутые полилинии (кривые теряются — это ожидаемо). */
export function booleanPaths(a: SubPath[], b: SubPath[], op: BoolOp, fill: 'evenodd' | 'nonzero' = 'evenodd'): SubPath[] {
  const fillType = fill === 'nonzero' ? NON_ZERO : EVEN_ODD;
  return execute(a, b, op, fillType, fillType);
}

/** Слияние набора контуров в один (убирает самопересечения и дубли). */
export function unionPaths(paths: SubPath[]): SubPath[] {
  return execute(paths, [], 'union', EVEN_ODD, EVEN_ODD);
}

/** Контур наружу (delta > 0) или внутрь (delta < 0), мм. */
export function offsetPaths(paths: SubPath[], deltaMm: number, join: JoinStyle = 'round'): SubPath[] {
  const co = new ClipperLib.ClipperOffset(join === 'round' ? 2 : 4, 0.25 * SCALE);
  co.AddPaths(
    toClipper(paths),
    join === 'round' ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: CPath[] = [];
  co.Execute(solution, deltaMm * SCALE);
  return fromClipper(solution);
}

/**
 * Чистая площадь контуров в мм²: внешние контуры складываются, отверстия
 * вычитаются (Clipper выдаёт их с противоположным знаком — это и используем).
 */
export function pathsArea(paths: SubPath[]): number {
  return toClipper(paths).reduce((sum, poly) => {
    let s = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      s += (poly[j].X + poly[i].X) * (poly[j].Y - poly[i].Y);
    }
    // в системе «y вниз» внешние контуры дают отрицательную сумму — приводим к плюсу
    return sum - s / 2 / (SCALE * SCALE);
  }, 0);
}

/** Сумма площадей «как есть» (без учёта отверстий) — для отладки и тестов. */
export function pathsAbsArea(paths: SubPath[]): number {
  return toClipper(paths).reduce((sum, poly) => {
    let s = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      s += (poly[j].X + poly[i].X) * (poly[j].Y - poly[i].Y);
    }
    return sum + Math.abs(s / 2) / (SCALE * SCALE);
  }, 0);
}
