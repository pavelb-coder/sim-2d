import type { Seg, SubPath, Vec2 } from './types';
import { flattenSubPaths } from './geom/path';
import { textToPaths } from './text';

/**
 * Текст по контуру (как «Text on path» в CorelDRAW).
 *
 * Путь разбивается на полилинию, для каждого символа берётся его контур
 * (opentype.js), поворачивается по касательной к пути и ставится в точку
 * с накопленной длиной. Итог — обычные подпути в мировых координатах:
 * их можно резать, двигать, применять булевы операции.
 */

export type TextAlign = 'start' | 'center' | 'end';

export interface TextOnPathOptions {
  /** сдвиг начала надписи вдоль контура, мм */
  offset?: number;
  align?: TextAlign;
  /** допуск спрямления контура, мм */
  tol?: number;
}

export interface TextOnPathResult {
  paths: SubPath[];
  /** длина базового контура, мм */
  lengthMm: number;
  /** ширина надписи, мм */
  textWidth: number;
  /** хватило ли места: если надпись длиннее контура — false */
  fit: boolean;
}

interface Walk {
  total: number;
  at: (s: number) => { p: Vec2; ang: number };
}

/** Накопительные длины по полилинии и поиск точки по расстоянию. */
function walker(pts: Vec2[]): Walk {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1] ?? 0;
  const at = (s: number): { p: Vec2; ang: number } => {
    const clamped = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < cum.length && cum[i] < clamped) i += 1;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(pts.length - 1, i);
    const a = pts[i0] ?? { x: 0, y: 0 };
    const b = pts[i1] ?? a;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const t = segLen < 1e-12 ? 0 : (clamped - cum[i0]) / segLen;
    return {
      p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };
  return { total, at };
}

/** Применить функцию к каждой точке контура. */
function mapPath(paths: SubPath[], fn: (p: Vec2) => Vec2, rotation: number): SubPath[] {
  const mapSeg = (s: Seg): Seg => {
    if (s.t === 'l') return { t: 'l', a: fn(s.a), b: fn(s.b) };
    if (s.t === 'c') return { t: 'c', a: fn(s.a), c1: fn(s.c1), c2: fn(s.c2), b: fn(s.b) };
    // дуги в контурах текста не встречаются; на всякий случай поворачиваем и угол
    return { t: 'a', a: fn(s.a), b: fn(s.b), center: fn(s.center), r: s.r, a0: s.a0 + rotation, sweep: s.sweep };
  };
  return paths.map((sp) => ({
    closed: sp.closed,
    start: fn(sp.start),
    segs: sp.segs.map(mapSeg),
  }));
}

/**
 * Разложить надпись вдоль контура `target` (мировые координаты).
 * Возвращает null, если шрифт не загружен или контура/текста нет.
 */
export function textOnPath(
  text: string,
  heightMm: number,
  target: SubPath[],
  opts: TextOnPathOptions = {},
): TextOnPathResult | null {
  if (!text || heightMm <= 0 || !target.length) return null;

  // базовый контур — самый длинный подпуть
  const parts = flattenSubPaths(target, opts.tol ?? 0.1).filter((pts) => pts.length >= 2);
  if (!parts.length) return null;
  let best = parts[0];
  let bestLen = 0;
  for (const pts of parts) {
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len > bestLen) { bestLen = len; best = pts; }
  }
  const line = walker(best);

  // по одному символу: нужна ширина каждого, чтобы расставить их по дуге
  const glyphs = [...text].map((ch) => ({ ch, res: textToPaths(ch, heightMm, { raw: true }) }));
  const widths = glyphs.map((g) => g.res?.width ?? 0);
  const textWidth = widths.reduce((sum, w) => sum + w, 0);
  if (textWidth <= 0) return null;

  const align = opts.align ?? 'start';
  let s = opts.offset ?? 0;
  if (align === 'center') s += (line.total - textWidth) / 2;
  else if (align === 'end') s += line.total - textWidth;

  const out: SubPath[] = [];
  glyphs.forEach((g, i) => {
    const res = g.res;
    if (!res) return;
    const w = widths[i];
    if (w <= 0) return;
    // ставим по центру глифа, чтобы буквы шли ровно по дуге
    const at = line.at(s + w / 2);
    const cos = Math.cos(at.ang);
    const sin = Math.sin(at.ang);
    const place = (p: Vec2): Vec2 => {
      const dx = p.x - w / 2;
      const dy = p.y;
      return { x: at.p.x + dx * cos - dy * sin, y: at.p.y + dx * sin + dy * cos };
    };
    out.push(...mapPath(res.paths, place, at.ang));
    s += w;
  });

  if (!out.length) return null;
  return { paths: out, lengthMm: line.total, textWidth, fit: textWidth <= line.total };
}
