import type { Mat2x3, Vec2 } from '../types';

export const IDENT: Mat2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const mk = (a: number, b: number, c: number, d: number, e: number, f: number): Mat2x3 => ({ a, b, c, d, e, f });

export const translate = (tx: number, ty: number): Mat2x3 => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
export const scaleM = (sx: number, sy: number = sx): Mat2x3 => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export const rotate = (ang: number): Mat2x3 => ({
  a: Math.cos(ang), b: Math.sin(ang), c: -Math.sin(ang), d: Math.cos(ang), e: 0, f: 0,
});

/** Композиция: сначала m1, затем m2 (M = m2·m1). */
export function compose(m2: Mat2x3, m1: Mat2x3): Mat2x3 {
  return {
    a: m2.a * m1.a + m2.c * m1.b,
    b: m2.b * m1.a + m2.d * m1.b,
    c: m2.a * m1.c + m2.c * m1.d,
    d: m2.b * m1.c + m2.d * m1.d,
    e: m2.a * m1.e + m2.c * m1.f + m2.e,
    f: m2.b * m1.e + m2.d * m1.f + m2.f,
  };
}

export function apply(m: Mat2x3, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Только линейная часть (для векторов без переноса). */
export function applyVec(m: Mat2x3, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

export function det(m: Mat2x3): number {
  return m.a * m.d - m.b * m.c;
}

export function invert(m: Mat2x3): Mat2x3 {
  const d = det(m);
  if (Math.abs(d) < 1e-12) return IDENT;
  return {
    a: m.d / d,
    b: -m.b / d,
    c: -m.c / d,
    d: m.a / d,
    e: (m.c * m.f - m.d * m.e) / d,
    f: (m.b * m.e - m.a * m.f) / d,
  };
}

export interface Trs { x: number; y: number; rotation: number; scaleX: number; scaleY: number; uniform: boolean }

/** Разложение T·R·S (без сдвига). */
export function decompose(m: Mat2x3): Trs {
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  const rotation = Math.atan2(m.b, m.a);
  return { x: m.e, y: m.f, rotation, scaleX: sx, scaleY: sy, uniform: Math.abs(sx - sy) < 1e-9 };
}

export function fromTrs(t: Partial<Trs> & { x: number; y: number }): Mat2x3 {
  const rotation = t.rotation ?? 0;
  const sx = t.scaleX ?? 1;
  const sy = t.scaleY ?? 1;
  return compose(translate(t.x, t.y), compose(rotate(rotation), scaleM(sx, sy)));
}

export const isAxisAligned = (m: Mat2x3, eps = 1e-9): boolean => Math.abs(m.b) < eps && Math.abs(m.c) < eps;
