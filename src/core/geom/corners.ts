import type { Seg, SubPath, Vec2 } from '../types';
import { flattenSubPaths } from './path';
import { add, dist, len, mul, sub } from './vec';

export type CornerMode = 'fillet' | 'chamfer';

/** Слишком острые углы (почти «иглы») скруглять бессмысленно — их пропускаем. */
const MIN_TURN = 0.02;

interface Vertex { p: Vec2; in: Vec2; out: Vec2; arc: Segment | null }
type Segment = { center: Vec2; r: number; a0: number; sweep: number };

/**
 * Скругление (fillet) или фаска (chamfer) всех углов контуров.
 *
 * Работает по сглаженной копии контура: углы заменяются дугой или отрезком,
 * поэтому исходные Безье в результате теряются (как и в булевых операциях).
 * Начальная и конечная точки незамкнутого контура не трогаются.
 *
 * @param paths контуры
 * @param size радиус скругления / величина фаски, мм
 * @param mode 'fillet' — дуга, 'chamfer' — срез
 * @returns новые контуры (полилинии + дуги)
 */
export function roundCorners(paths: SubPath[], size: number, mode: CornerMode): SubPath[] {
  if (!(size > 0)) return paths;
  const polys = flattenSubPaths(paths, 0.05);
  const out: SubPath[] = [];

  for (let i = 0; i < polys.length; i++) {
    const closed = paths[i]?.closed ?? false;
    // Замкнутый контур во flattenSubPaths приходит с повторённой первой точкой.
    const ring = polys[i].slice();
    if (closed && ring.length > 1 && dist(ring[0], ring[ring.length - 1]) < 1e-9) ring.pop();
    if (ring.length < 3) {
      out.push(paths[i]);
      continue;
    }

    const n = ring.length;
    const verts: Vertex[] = [];
    for (let k = 0; k < n; k++) {
      const isCorner = closed || (k > 0 && k < n - 1);
      const p = ring[k];
      if (!isCorner) {
        verts.push({ p, in: p, out: p, arc: null });
        continue;
      }
      const prev = ring[(k - 1 + n) % n];
      const next = ring[(k + 1) % n];
      const u = norm(sub(prev, p)); // направление на предыдущую точку
      const v = norm(sub(next, p)); // направление на следующую
      if (!u || !v) {
        verts.push({ p, in: p, out: p, arc: null });
        continue;
      }
      if (!u || !v) {
        verts.push({ p, in: p, out: p, arc: null });
        continue;
      }
      const cross = Math.abs(u.x * v.y - u.y * v.x);
      if (cross < MIN_TURN) {
        verts.push({ p, in: p, out: p, arc: null }); // угол почти развёрнутый
        continue;
      }
      const maxT = Math.min(dist(p, prev), dist(p, next)) * 0.5;
      if (maxT < 1e-4) {
        verts.push({ p, in: p, out: p, arc: null });
        continue;
      }
      const sinHalf = Math.sqrt(Math.max(0, (1 - dot(u, v)) / 2)); // sin(θ/2)
      const tanHalf = sinHalf / Math.sqrt(Math.max(1e-12, 1 - sinHalf * sinHalf)); // tan(θ/2)

      if (mode === 'chamfer') {
        const d = Math.min(size, maxT);
        verts.push({ p, in: add(p, mul(u, d)), out: add(p, mul(v, d)), arc: null });
        continue;
      }

      // fillet: касательные точки на расстоянии t = r / tan(θ/2)
      let r = size;
      let t = r / Math.max(tanHalf, 1e-9);
      if (t > maxT) {
        t = maxT;
        r = t * tanHalf;
      }
      if (r < 1e-4) {
        verts.push({ p, in: p, out: p, arc: null });
        continue;
      }
      const pIn = add(p, mul(u, t));
      const pOut = add(p, mul(v, t));
      const bis = norm(add(u, v)) ?? { x: 0, y: 0 };
      const center = add(p, mul(bis, r / Math.max(sinHalf, 1e-9)));
      const a0 = Math.atan2(pIn.y - center.y, pIn.x - center.x);
      const a1 = Math.atan2(pOut.y - center.y, pOut.x - center.x);
      const ccw = (pIn.x - center.x) * (pOut.y - center.y) - (pIn.y - center.y) * (pOut.x - center.x) > 0;
      let delta = a1 - a0;
      if (ccw && delta < 0) delta += Math.PI * 2;
      if (!ccw && delta > 0) delta -= Math.PI * 2;
      verts.push({ p, in: pIn, out: pOut, arc: { center, r, a0, sweep: delta } });
    }

    out.push(rebuild(verts, closed));
  }

  return out;
}

/** Собирает контур обратно из обработанных вершин: прямая до угла + дуга угла. */
function rebuild(verts: Vertex[], closed: boolean): SubPath {
  const segs: Seg[] = [];
  let prevOut = closed ? verts[verts.length - 1].out : verts[0].out;
  const start = prevOut;
  const from = closed ? 0 : 1;
  const to = closed ? verts.length : verts.length - 1;

  for (let k = from; k < to; k++) {
    const vtx = verts[k];
    if (dist(prevOut, vtx.in) > 1e-9) segs.push({ t: 'l', a: prevOut, b: vtx.in });
    if (vtx.arc) {
      segs.push({ t: 'a', a: vtx.in, b: vtx.out, center: vtx.arc.center, r: vtx.arc.r, a0: vtx.arc.a0, sweep: vtx.arc.sweep });
    } else if (dist(vtx.in, vtx.out) > 1e-9) {
      // фаска: срез между касательными точками
      segs.push({ t: 'l', a: vtx.in, b: vtx.out });
    }
    prevOut = vtx.out;
  }

  if (closed) {
    if (dist(prevOut, start) > 1e-9) segs.push({ t: 'l', a: prevOut, b: start });
    return { closed: true, start, segs };
  }
  const last = verts[verts.length - 1];
  if (dist(prevOut, last.p) > 1e-9) segs.push({ t: 'l', a: prevOut, b: last.p });
  return { closed: false, start, segs };
}

const norm = (a: Vec2): Vec2 | null => {
  const l = len(a);
  return l < 1e-9 ? null : { x: a.x / l, y: a.y / l };
};

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
