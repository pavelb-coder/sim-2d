import type { Doc, Id, Obj, Sheet, SubPath, Vec2 } from './types';
import { bboxOfSubPaths, flattenSubPaths, pathLength, transformSubPaths } from './geom/path';
import { distToSeg } from './geom/vec';

export type IssueCode =
  | 'open-contour'
  | 'zero-length'
  | 'outside-sheet'
  | 'duplicate'
  | 'self-intersect'
  | 'no-geometry';

export type Severity = 'error' | 'warning';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  objectIds: Id[];
  message: string;
  at?: Vec2;
}

const EPS = 1e-6;

function segsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

function selfIntersects(subs: SubPath[]): Vec2 | null {
  const polys = flattenSubPaths(subs, 0.2);
  let budget = 4000;
  for (const poly of polys) {
    const n = poly.length;
    if (n < 5 || n > 400) continue;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 2; j < n - 1; j++) {
        if (i === 1 && j === n - 2) continue;
        if (--budget < 0) return null;
        if (segsCross(poly[i - 1], poly[i], poly[j], poly[j + 1])) return poly[i];
      }
    }
  }
  return null;
}

/** Проверка «готово к резке». */
export function validateDoc(doc: Doc, sheet: Sheet): Issue[] {
  const issues: Issue[] = [];
  const objs: Obj[] = doc.order
    .map((id) => doc.objects[id])
    .filter((o): o is Obj => !!o && o.sheetId === sheet.id && !o.hidden);

  const layerOp = new Map(doc.layers.map((l) => [l.id, l.op]));
  const seen: { id: Id; length: number; box: { x: number; y: number; w: number; h: number } }[] = [];

  for (const obj of objs) {
    const world = transformSubPaths(obj.path, obj.transform);
    const len = pathLength(world);
    const box = bboxOfSubPaths(world);

    if (!world.length || len < 0.05) {
      issues.push({
        code: 'zero-length', severity: 'warning', objectIds: [obj.id],
        message: `«${obj.name ?? 'Объект'}»: нулевая длина — на резку не попадёт`,
        at: { x: box.x, y: box.y },
      });
      continue;
    }

    const op = layerOp.get(obj.layerId) ?? 'cut';
    if (op === 'cut') {
      const open = world.filter((sp) => !sp.closed);
      if (open.length) {
        issues.push({
          code: 'open-contour', severity: 'error', objectIds: [obj.id],
          message: `«${obj.name ?? 'Объект'}»: ${open.length} незамкнут${open.length === 1 ? 'ый контур' : 'ых контуров'} — деталь выпадет`,
          at: open[0].start,
        });
      }
    }

    const outside =
      box.x < -1e-6 || box.y < -1e-6 ||
      box.x + box.w > sheet.width + 1e-6 || box.y + box.h > sheet.height + 1e-6;
    if (outside) {
      issues.push({
        code: 'outside-sheet', severity: 'warning', objectIds: [obj.id],
        message: `«${obj.name ?? 'Объект'}» выходит за лист`,
        at: { x: box.x, y: box.y },
      });
    }

    const dup = seen.find((s) => Math.abs(s.length - len) < 0.02 && Math.abs(s.box.x - box.x) < 0.02 && Math.abs(s.box.y - box.y) < 0.02 && Math.abs(s.box.w - box.w) < 0.02 && Math.abs(s.box.h - box.h) < 0.02);
    if (dup) {
      issues.push({
        code: 'duplicate', severity: 'warning', objectIds: [dup.id, obj.id],
        message: 'Два одинаковых объекта в одной точке — станок прорежет дважды',
        at: { x: box.x, y: box.y },
      });
    } else {
      seen.push({ id: obj.id, length: len, box });
    }

    const cross = selfIntersects(world);
    if (cross) {
      issues.push({
        code: 'self-intersect', severity: 'warning', objectIds: [obj.id],
        message: `«${obj.name ?? 'Объект'}»: контур самопересекается`,
        at: cross,
      });
    }
  }

  return issues;
}

export const issueSummary = (issues: Issue[]): string => {
  if (!issues.length) return 'Готово к резке — замечаний нет';
  const errors = issues.filter((i) => i.severity === 'error').length;
  return errors
    ? `${errors} критичных, ${issues.length - errors} предупреждений`
    : `${issues.length} предупреждени${issues.length === 1 ? 'е' : 'й'}`;
};

export const sameLength = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
export const nearPoint = (p: Vec2, q: Vec2, tol = 0.01): boolean => distToSeg(p, q, q) <= tol;
