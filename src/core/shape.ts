import type { Id, Obj, Style, SubPath, Vec2 } from './types';
import { circleAsArcs } from './geom/arc';
import { TAU } from './geom/arc';

let counter = 0;
export function uid(prefix = 'o'): Id {
  counter += 1;
  return `${prefix}${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Прямоугольник с центром в (0,0). */
export function rectPath(w: number, h: number): SubPath[] {
  const x = w / 2, y = h / 2;
  const p0 = { x: -x, y: -y }, p1 = { x, y: -y }, p2 = { x, y }, p3 = { x: -x, y };
  return [{
    closed: true,
    start: p0,
    segs: [
      { t: 'l', a: p0, b: p1 },
      { t: 'l', a: p1, b: p2 },
      { t: 'l', a: p2, b: p3 },
      { t: 'l', a: p3, b: p0 },
    ],
  }];
}

const K = 0.5522847498307936;

/** Эллипс с центром в (0,0): 4 кубические Безье (для круга — 2 дуги, как любят станки). */
export function ellipsePath(w: number, h: number): SubPath[] {
  const rx = w / 2, ry = h / 2;
  if (Math.abs(w - h) < 1e-9) {
    const segs = circleAsArcs({ x: 0, y: 0 }, rx);
    return [{ closed: true, start: segs[0].a, segs }];
  }
  const p = (x: number, y: number): Vec2 => ({ x, y });
  const right = p(rx, 0), top = p(0, ry), left = p(-rx, 0), bottom = p(0, -ry);
  return [{
    closed: true,
    start: right,
    segs: [
      { t: 'c', a: right, c1: p(rx, ry * K), c2: p(rx * K, ry), b: top },
      { t: 'c', a: top, c1: p(-rx * K, ry), c2: p(-rx, ry * K), b: left },
      { t: 'c', a: left, c1: p(-rx, -ry * K), c2: p(-rx * K, -ry), b: bottom },
      { t: 'c', a: bottom, c1: p(rx * K, -ry), c2: p(rx, -ry * K), b: right },
    ],
  }];
}

/** Отрезок длиной len по оси X, центр в (0,0). */
export function linePath(len: number): SubPath[] {
  const a = { x: -len / 2, y: 0 }, b = { x: len / 2, y: 0 };
  return [{ closed: false, start: a, segs: [{ t: 'l', a, b }] }];
}

/** Правильный многоугольник: вписан в окружность радиуса r, центр (0,0), вершина — сверху. */
export function polygonPath(r: number, sides: number): SubPath[] {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const ang = Math.PI / 2 + (i * TAU) / n;
    pts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
  }
  return [{
    closed: true,
    start: pts[0],
    segs: pts.map((a, i) => ({ t: 'l' as const, a, b: pts[(i + 1) % n] })),
  }];
}

/**
 * Звезда: 2n вершин через одну — внешний радиус r и внутренний r*inner.
 * inner — доля внутреннего радиуса (0,05…0,95).
 */
export function starPath(r: number, points: number, inner = 0.45): SubPath[] {
  const n = Math.max(3, Math.min(32, Math.round(points)));
  const k = Math.min(0.95, Math.max(0.05, inner));
  const pts: Vec2[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const ang = Math.PI / 2 + (i * TAU) / (n * 2);
    const rad = i % 2 === 0 ? r : r * k;
    pts.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
  }
  return [{
    closed: true,
    start: pts[0],
    segs: pts.map((a, i) => ({ t: 'l' as const, a, b: pts[(i + 1) % pts.length] })),
  }];
}

export function defaultStyle(op: 'cut' | 'engrave' | 'score'): Style {
  const stroke = op === 'cut' ? '#e0413c' : op === 'engrave' ? '#2f6df6' : '#16a34a';
  return { fill: null, stroke, strokeWidth: 0.1, opacity: 1 };
}

export function makeObj(partial: {
  sheetId: Id;
  layerId: Id;
  path: SubPath[];
  transform: Obj['transform'];
  style: Style;
  name?: string;
}): Obj {
  return { id: uid(), kind: 'path', ...partial };
}
