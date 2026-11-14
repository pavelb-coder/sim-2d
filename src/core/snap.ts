import type { Doc, Obj, Sheet, Vec2 } from './types';
import { flattenSubPaths, worldBBox } from './geom/path';
import { apply } from './geom/transform';
import { boxCenter } from './geom/path';
import { dist } from './geom/vec';

export type SnapKind = 'grid' | 'endpoint' | 'center' | 'sheet';

export interface SnapResult { point: Vec2; kind: SnapKind; label: string }

interface SnapCache { token: number; points: { p: Vec2; kind: SnapKind; label: string }[] }

let cache: SnapCache = { token: -1, points: [] };

/** Точки привязки из объектов: концы сегментов + центры bbox. */
export function collectSnapPoints(doc: Doc, sheet: Sheet, token: number, exclude: Set<string> = new Set()): SnapCache {
  if (cache.token === token) return cache;
  const points: SnapCache['points'] = [];
  for (const id of doc.order) {
    const obj: Obj | undefined = doc.objects[id];
    if (!obj || obj.sheetId !== sheet.id || obj.hidden) continue;
    if (exclude.has(id)) continue;
    const polys = flattenSubPaths(obj.path, 0.2);
    for (const poly of polys) {
      if (poly.length > 200) continue; // не засоряем привязки гигантскими контурами
      for (const p of poly) points.push({ p: apply(obj.transform, p), kind: 'endpoint', label: 'конец' });
    }
    const c = boxCenter(worldBBox(obj.path, obj.transform));
    points.push({ p: c, kind: 'center', label: 'центр' });
  }
  cache = { token, points };
  return cache;
}

export interface SnapOptions {
  gridStep: number;
  snapGrid: boolean;
  snapObjects: boolean;
  tolMm: number;
  exclude?: Set<string>;
}

/** Поиск привязки. Порядок: конец → центр → лист → сетка. */
export function findSnap(p: Vec2, doc: Doc, sheet: Sheet, token: number, opts: SnapOptions): SnapResult | null {
  if (opts.snapObjects) {
    const { points } = collectSnapPoints(doc, sheet, token, opts.exclude);
    let best: { p: Vec2; kind: SnapKind; label: string } | null = null;
    let bestD = opts.tolMm;
    for (const q of points) {
      const d = dist(p, q.p);
      if (d <= bestD) { bestD = d; best = q; }
    }
    if (best) return { point: best.p, kind: best.kind, label: best.label };

    const sheetPts: Vec2[] = [
      { x: 0, y: 0 }, { x: sheet.width, y: 0 }, { x: 0, y: sheet.height }, { x: sheet.width, y: sheet.height },
      { x: sheet.width / 2, y: sheet.height / 2 },
    ];
    for (const sp of sheetPts) {
      if (dist(p, sp) <= opts.tolMm) return { point: sp, kind: 'sheet', label: 'лист' };
    }
  }
  if (opts.snapGrid && opts.gridStep > 0) {
    const step = opts.gridStep;
    const g = { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
    // привязка к сетке не должна «дёргать» курсор далеко
    if (dist(p, g) <= Math.max(opts.tolMm, step * 0.35)) return { point: g, kind: 'grid', label: 'сетка' };
  }
  return null;
}

export const invalidateSnapCache = (): void => { cache = { token: -1, points: [] }; };
