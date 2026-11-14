import type { Doc, Id, Mat2x3, Sheet, SubPath, Vec2 } from '../types';
import { flattenSubPaths } from './path';
import { apply } from './transform';
import { distToSeg, pointInPoly } from './vec';

export interface HitResult { hit: boolean; filled: boolean }

/**
 * Попадание курсора в объект.
 * @param tolMm допуск в миллиметрах (обычно 6 px / scale)
 */
export function hitPaths(path: SubPath[], m: Mat2x3, p: Vec2, tolMm: number, filled: boolean): HitResult {
  const polys = flattenSubPaths(path, Math.max(tolMm / 4, 0.02)).map((poly) => poly.map((q) => apply(m, q)));
  for (const poly of polys) {
    for (let i = 1; i < poly.length; i++) {
      if (distToSeg(p, poly[i - 1], poly[i]) <= tolMm) return { hit: true, filled: false };
    }
  }
  if (filled && polys.length) {
    let inside = false;
    for (const poly of polys) if (poly.length > 2 && pointInPoly(p, poly)) inside = !inside;
    if (inside) return { hit: true, filled: true };
  }
  return { hit: false, filled: false };
}

/** Верхний объект под курсором (с учётом видимости слоёв). */
export function pickObject(doc: Doc, sheet: Sheet, p: Vec2, tolMm: number): Id | null {
  const layerVisible = new Map(doc.layers.map((l) => [l.id, l.visible]));
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const id = doc.order[i];
    const obj = doc.objects[id];
    if (!obj || obj.sheetId !== sheet.id || obj.hidden || obj.locked) continue;
    if (layerVisible.get(obj.layerId) === false) continue;
    if (hitPaths(obj.path, obj.transform, p, tolMm, !!obj.style.fill).hit) return id;
  }
  return null;
}
