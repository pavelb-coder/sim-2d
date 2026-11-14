import type { SubPath } from '../core/types';

const cache = new WeakMap<object, Path2D>();

/** Построение Path2D в локальных координатах объекта (мм). Кэш — по ссылке на массив подпутей. */
export function toPath2D(path: SubPath[]): Path2D {
  const cached = cache.get(path);
  if (cached) return cached;
  const p = new Path2D();
  for (const sp of path) {
    p.moveTo(sp.start.x, sp.start.y);
    for (const s of sp.segs) {
      if (s.t === 'l') p.lineTo(s.b.x, s.b.y);
      else if (s.t === 'c') p.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.b.x, s.b.y);
      else p.arc(s.center.x, s.center.y, s.r, s.a0, s.a0 + s.sweep, s.sweep < 0);
    }
    if (sp.closed) p.closePath();
  }
  cache.set(path, p);
  return p;
}

export function setMatrix(ctx: CanvasRenderingContext2D, m: { a: number; b: number; c: number; d: number; e: number; f: number }, dpr: number): void {
  ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
}
