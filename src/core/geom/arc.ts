import type { Box, Seg, Vec2 } from '../types';
import { dist } from './vec';

export const TAU = Math.PI * 2;

/** Точка на дуге, t ∈ [0,1]. */
export function arcPoint(center: Vec2, r: number, a0: number, sweep: number, t: number): Vec2 {
  const a = a0 + sweep * t;
  return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
}

/** Длина дуги. */
export const arcLength = (r: number, sweep: number): number => Math.abs(r * sweep);

/** Лежит ли угол ang внутри дуги от a0 со знаком sweep. */
export function angleInSweep(ang: number, a0: number, sweep: number): boolean {
  const mod = (x: number, m: number) => ((x % m) + m) % m;
  return sweep >= 0
    ? mod(ang - a0, TAU) <= sweep + 1e-12
    : mod(a0 - ang, TAU) <= -sweep + 1e-12;
}

/** Точный bbox дуги: концы + проходящие оси координат. */
export function arcBBox(center: Vec2, r: number, a0: number, sweep: number): Box {
  const pts: Vec2[] = [arcPoint(center, r, a0, sweep, 0), arcPoint(center, r, a0, sweep, 1)];
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    if (angleInSweep(ang, a0, sweep)) {
      pts.push({ x: center.x + r * Math.cos(ang), y: center.y + r * Math.sin(ang) });
    }
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Дуга → кубические Безье (куски ≤ 90°). Точность ~1e-6 для r=1000 мм. */
export function arcToCubics(center: Vec2, r: number, a0: number, sweep: number): Seg[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + step * i, b = a + step;
    const p0 = { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) };
    const p3 = { x: center.x + r * Math.cos(b), y: center.y + r * Math.sin(b) };
    const c1 = { x: p0.x - k * r * Math.sin(a), y: p0.y + k * r * Math.cos(a) };
    const c2 = { x: p3.x + k * r * Math.sin(b), y: p3.y - k * r * Math.cos(b) };
    segs.push({ t: 'c', a: p0, c1, c2, b: p3 });
  }
  return segs;
}

/**
 * Bulge (DXF, код 42) → параметры дуги.
 * bulge = tan(Δ/4); положительный — против часовой стрелки.
 */
export function arcFromBulge(a: Vec2, b: Vec2, bulge: number): { center: Vec2; r: number; a0: number; sweep: number } | null {
  if (Math.abs(bulge) < 1e-12) return null;
  const chord = dist(a, b);
  if (chord < 1e-12) return null;
  const sweep = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  // центр: посередине хорды, сдвиг по нормали
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) * (chord / 2)));
  const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
  const sgn = sweep > 0 ? 1 : -1;
  const nx = -uy * sgn, ny = ux * sgn;
  const center = { x: mx + nx * h * (Math.abs(sweep) > Math.PI ? -1 : 1), y: my + ny * h * (Math.abs(sweep) > Math.PI ? -1 : 1) };
  const a0 = Math.atan2(a.y - center.y, a.x - center.x);
  return { center, r, a0, sweep };
}

/** Дуга → bulge (для экспорта в DXF). */
export const bulgeFromSweep = (sweep: number): number => Math.tan(sweep / 4);

/** Круг как 2 дуги по 180° (так делают станки: разрыв на старте). */
export function circleAsArcs(center: Vec2, r: number): Seg[] {
  const p1 = arcPoint(center, r, 0, TAU, 0);
  const p2 = arcPoint(center, r, 0, TAU, 0.5);
  return [
    { t: 'a', a: p1, b: p2, center, r, a0: 0, sweep: Math.PI },
    { t: 'a', a: p2, b: p1, center, r, a0: Math.PI, sweep: Math.PI },
  ];
}
