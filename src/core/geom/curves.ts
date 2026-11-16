import type { Obj, SubPath } from '../types';
import { arcToCubics } from './arc';
import { transformSubPaths } from './path';
import { IDENT } from './transform';

/**
 * «В кривые» (Convert to Curves, как `Ctrl+Q` в CorelDRAW).
 *
 * У нас объект всегда хранит контуры плюс матрицу (масштаб/поворот/зеркало),
 * поэтому «в кривые» — это два шага:
 *  1) запечь матрицу в геометрию: координаты становятся мировыми, матрица — единичной;
 *  2) дуги превратить в кубические Безье (эллипс становится четырьмя кривыми,
 *     как и в Corel), чтобы любой сегмент правился инструментом «Узлы».
 *
 * Геометрия при этом не меняется: узлы остаются на своих местах, габарит и длина
 * сохраняются. Меняется только представление — объект перестаёт «растягиваться»
 * матрицей и становится обычной кривой.
 */

/** Дуги → кубические Безье; отрезки и кривые остаются как есть. */
export function arcsToCubics(path: SubPath[]): SubPath[] {
  return path.map((sp) => ({
    closed: sp.closed,
    start: sp.start,
    segs: sp.segs.flatMap((s) => (s.t === 'a' ? arcToCubics(s.center, s.r, s.a0, s.sweep) : [s])),
  }));
}

/** Матрица не делает ничего (нет масштаба, поворота, отражения и сдвига)? */
export function isIdentityMatrix(m: { a: number; b: number; c: number; d: number; e: number; f: number }): boolean {
  const eps = 1e-9;
  return Math.abs(m.a - 1) < eps && Math.abs(m.b) < eps && Math.abs(m.c) < eps
    && Math.abs(m.d - 1) < eps && Math.abs(m.e) < eps && Math.abs(m.f) < eps;
}

/** Есть ли в контурах дуги (то есть объект ещё «не совсем» кривая). */
export const hasArcs = (path: SubPath[]): boolean => path.some((sp) => sp.segs.some((s) => s.t === 'a'));

/** Объект уже кривая: единичная матрица и нет дуг. */
export const isCurve = (obj: Obj): boolean => isIdentityMatrix(obj.transform) && !hasArcs(obj.path);

/**
 * Объект «в кривые»: матрица запечена, дуги заменены на кривые.
 * PowerClip-исходник (`obj.clip`) запекается тем же способом, чтобы
 * «Извлечь содержимое» вернуло контуры в тех же координатах.
 */
export function toCurves(obj: Obj): Obj {
  const next: Obj = {
    ...obj,
    path: arcsToCubics(transformSubPaths(obj.path, obj.transform)),
    transform: { ...IDENT },
  };
  if (obj.clip) {
    next.clip = {
      ...obj.clip,
      path: arcsToCubics(transformSubPaths(obj.clip.path, obj.clip.transform)),
      transform: { ...IDENT },
    };
  }
  return next;
}
