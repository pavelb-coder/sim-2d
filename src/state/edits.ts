import type { Obj } from '../core/types';
import { bboxOfSubPaths, boxCenter, transformSubPaths, worldBBox } from '../core/geom/path';
import { compose, decompose, rotate, scaleM, translate } from '../core/geom/transform';

/**
 * Изменить геометрию объекта по мировому bbox: X/Y — левый нижний угол, W/H — размеры.
 * Работает и для повёрнутых объектов: масштаб применяется в локальных осях.
 */
export function setBBox(obj: Obj, target: { x?: number; y?: number; w?: number; h?: number }): Obj {
  const local = bboxOfSubPaths(obj.path);
  const cur = worldBBox(obj.path, obj.transform);
  const d = decompose(obj.transform);

  const w = target.w !== undefined ? Math.max(target.w, 0.01) : cur.w;
  const h = target.h !== undefined ? Math.max(target.h, 0.01) : cur.h;
  const sx = local.w > 1e-9 ? w / local.w : 1;
  const sy = local.h > 1e-9 ? h / local.h : 1;

  const linear = compose(rotate(d.rotation), scaleM(sx, sy));
  const probe = bboxOfSubPaths(transformSubPaths(obj.path, linear));
  const x = target.x !== undefined ? target.x : cur.x;
  const y = target.y !== undefined ? target.y : cur.y;

  return { ...obj, transform: { ...linear, e: x - probe.x, f: y - probe.y } };
}

/** Поворот вокруг центра bbox. */
export function rotateTo(obj: Obj, deg: number): Obj {
  const d = decompose(obj.transform);
  const local = bboxOfSubPaths(obj.path);
  const lc = boxCenter(local);
  const c = boxCenter(worldBBox(obj.path, obj.transform));
  const m = compose(
    translate(c.x, c.y),
    compose(rotate((deg * Math.PI) / 180), compose(scaleM(d.scaleX, d.scaleY), translate(-lc.x, -lc.y))),
  );
  return { ...obj, transform: m };
}

/** Сдвиг объекта в мировых координатах. */
export function nudge(obj: Obj, dx: number, dy: number): Obj {
  return { ...obj, transform: { ...obj.transform, e: obj.transform.e + dx, f: obj.transform.f + dy } };
}

/** Копия объекта со смещением (для «Дублировать»). */
export function duplicate(obj: Obj, newId: string, dx = 5, dy = 5): Obj {
  return { ...obj, id: newId, transform: { ...obj.transform, e: obj.transform.e + dx, f: obj.transform.f + dy } };
}

/** Поворот на заданный угол относительно центра bbox. */
export function rotateBy(obj: Obj, deg: number): Obj {
  const current = (decompose(obj.transform).rotation * 180) / Math.PI;
  return rotateTo(obj, current + deg);
}

/** Зеркальное отражение: 'h' — слева-направо, 'v' — сверху-вниз. */
export function mirror(obj: Obj, axis: 'h' | 'v'): Obj {
  const c = boxCenter(worldBBox(obj.path, obj.transform));
  const s = axis === 'h' ? scaleM(-1, 1) : scaleM(1, -1);
  const m = compose(translate(c.x, c.y), compose(s, compose(translate(-c.x, -c.y), obj.transform)));
  return { ...obj, transform: m };
}
