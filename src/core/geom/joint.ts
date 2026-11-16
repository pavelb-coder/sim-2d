import type { Mm, SubPath, Vec2 } from '../types';
import { booleanPaths } from './boolean';
import { flattenSubPaths } from './path';
import { pointInPoly } from './vec';

/**
 * Соединение «паз — шип» под толщину материала.
 *
 * Школьная задача: две детали из фанеры 3 мм должны соединиться внахлёст.
 * В одной детали нужно вырезать паз шириной «толщина − зазор», в другую —
 * ничего (её край и есть шип) или, если деталь вставляется в торец,
 * добавить выступ. Ручками это рисуют по 10 минут на каждую деталь.
 *
 * Здесь всё считается от точки клика по ребру: находим ребро, направление
 * вдоль него и нормаль внутрь материала, строим полигон паза и выполняем
 * булеву операцию. Результат — полилинии (как и все булевы операции).
 */

export type JointMode = 'slot' | 'dovetail' | 'tab';

export interface JointOptions {
  /** толщина материала, мм */
  thickness: Mm;
  /** зазор на свободный вход, мм (обычно 0,1–0,2) */
  clearance: Mm;
  /** глубина паза, мм; 0 — равна толщине материала */
  depth: Mm;
  mode: JointMode;
}

export const defaultJointOptions = (thickness = 3): JointOptions => ({
  thickness,
  clearance: 0.1,
  depth: 0,
  mode: 'slot',
});

/** Ребро под курсором: точка на ребре, направление вдоль и нормаль внутрь материала. */
export interface EdgeHit {
  /** проекция клика на ребро */
  point: Vec2;
  /** единичное направление вдоль ребра */
  dir: Vec2;
  /** единичная нормаль, направленная внутрь материала */
  normal: Vec2;
  /** расстояние от клика до ребра, мм */
  dist: number;
}

/** Половина ширины паза: ширина = толщина − зазор, но не меньше 0,1 мм. */
export function slotHalfWidth(opts: JointOptions): Mm {
  return Math.max(0.05, (opts.thickness - opts.clearance) / 2);
}

/** Глубина паза: 0 в настройках значит «на всю толщину». */
export function slotDepth(opts: JointOptions): Mm {
  return opts.depth > 0 ? opts.depth : Math.max(0.2, opts.thickness);
}

/**
 * Ближайшее ребро контура к точке `p` (в тех же координатах, что и path).
 * Возвращает нормаль, направленную внутрь материала: проверяем точку,
 * сдвинутую от ребра на 0,5 мм в каждую сторону.
 */
export function nearestEdge(path: SubPath[], p: Vec2): EdgeHit | null {
  const polys = flattenSubPaths(path, 0.05).filter((poly) => poly.length > 1);
  if (!polys.length) return null;
  let best: { a: Vec2; b: Vec2; q: Vec2; d: number } | null = null;
  for (const poly of polys) {
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1], b = poly[i];
      const q = projectOnSeg(p, a, b);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (!best || d < best.d) best = { a, b, q, d };
    }
  }
  if (!best) return null;
  const len = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
  if (len < 1e-9) return null;
  const dir = { x: (best.b.x - best.a.x) / len, y: (best.b.y - best.a.y) / len };
  let normal = { x: -dir.y, y: dir.x };
  const probe = 0.5;
  const sideA = { x: best.q.x + normal.x * probe, y: best.q.y + normal.y * probe };
  const sideB = { x: best.q.x - normal.x * probe, y: best.q.y - normal.y * probe };
  const insideCount = (pt: Vec2): number => {
    let n = 0;
    for (const poly of polys) if (poly.length > 2 && pointInPoly(pt, poly)) n += 1;
    return n;
  };
  if (insideCount(sideB) > insideCount(sideA)) normal = { x: -normal.x, y: -normal.y };
  return { point: best.q, dir, normal, dist: best.d };
}

function projectOnSeg(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Полигон соединения в мировых координатах (замкнутый прямоугольник или трапеция). */
export function jointPolygon(hit: EdgeHit, opts: JointOptions): SubPath {
  const half = slotHalfWidth(opts);
  const depth = slotDepth(opts);
  // заходим за ребро наружу, чтобы булева операция чисто открыла контур
  const over = Math.max(0.2, Math.min(1, opts.thickness));
  // ласточкин хвост: устье шире дна на 20 % толщины (но не больше половины ширины)
  const flare = opts.mode === 'dovetail' ? Math.min(half * 0.6, Math.max(0.2, opts.thickness * 0.2)) : 0;
  const outward = opts.mode === 'tab';

  const at = (u: Mm, v: Mm): Vec2 => ({
    x: hit.point.x + hit.dir.x * u + hit.normal.x * v,
    y: hit.point.y + hit.dir.y * u + hit.normal.y * v,
  });

  // v = 0 — ребро детали, v > 0 — внутрь материала.
  // паз: от «чуть наружу» до глубины внутрь. шип: от глубины наружу до «чуть внутрь».
  const vMouth = outward ? -depth : -over;
  const vRoot = outward ? over : depth;
  const halfMouth = half + flare;
  const halfRoot = Math.max(0.05, half - flare);

  const pts: Vec2[] = [
    at(-halfMouth, vMouth),
    at(halfMouth, vMouth),
    at(halfRoot, vRoot),
    at(-halfRoot, vRoot),
  ];
  const segs = pts.slice(1).map((p, i) => ({ t: 'l' as const, a: pts[i], b: p }));
  segs.push({ t: 'l', a: pts[pts.length - 1], b: pts[0] });
  return { closed: true, start: pts[0], segs };
}

/** Вырезать паз (или добавить шип) в контуре. Возвращает новый контур. */
export function makeJoint(path: SubPath[], hit: EdgeHit, opts: JointOptions): SubPath[] {
  const poly = jointPolygon(hit, opts);
  // шип приваривается к детали: здесь нужен ненулевой критерий заполнения,
  // иначе чётный (even-odd) вычтет зону нахлёста и шип получится «надкусанным»
  const out = opts.mode === 'tab'
    ? booleanPaths(path, [poly], 'union', 'nonzero')
    : booleanPaths(path, [poly], 'diff');
  return out.length ? out : path;
}
