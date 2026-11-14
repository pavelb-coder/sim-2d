import type { SubPath, Vec2 } from './types';

/**
 * Текст → кривые. Шрифт встраивается в сборку (base64 TTF, self-host),
 * поэтому офлайн и без внешних CDN. Для резки текст всегда переводим в контуры.
 */

interface FontLike {
  unitsPerEm: number;
  tables?: { os2?: { sCapHeight?: number } };
  getPath: (text: string, x: number, y: number, size: number) => { commands: Cmd[] };
  getAdvanceWidth: (text: string, size: number) => number;
}

interface Cmd { type: 'M' | 'L' | 'C' | 'Q' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

let fontData: string | null = null;
let font: FontLike | null = null;
let loading: Promise<boolean> | null = null;

/** Позволяет подсунуть шрифт вручную (тесты, свой TTF). */
export function setFontData(base64: string): void {
  fontData = base64;
  font = null;
  loading = null;
}

export function fontState(): 'ready' | 'loading' | 'missing' {
  if (font) return 'ready';
  if (loading) return 'loading';
  return (fontData ?? readGlobalFont()) ? 'missing' : 'missing';
}

function readGlobalFont(): string | null {
  const g = globalThis as unknown as { __LASERCUT_FONT__?: string };
  return typeof g.__LASERCUT_FONT__ === 'string' ? g.__LASERCUT_FONT__ : null;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
  const g = globalThis as unknown as { atob?: (s: string) => string; Buffer?: { from: (s: string, enc: string) => { buffer: ArrayBuffer; byteOffset: number; length: number } } };
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  if (g.Buffer) {
    const buf = g.Buffer.from(clean, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
  throw new Error('Нет декодера base64');
}

export async function ensureFont(): Promise<boolean> {
  if (font) return true;
  if (loading) return loading;
  const data = fontData ?? readGlobalFont();
  if (!data) return false;
  loading = (async () => {
    try {
      const mod = await import('opentype.js');
      const opentype = (mod as unknown as { default?: unknown }).default ?? mod;
      const parse = (opentype as { parse: (buf: ArrayBuffer) => FontLike }).parse;
      font = parse(base64ToArrayBuffer(data));
      return true;
    } catch {
      font = null;
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export interface TextResult {
  paths: SubPath[];
  width: number;
  height: number;
}

/** Высота заглавной буквы относительно кегля (обычно 0.7). */
function capRatio(f: FontLike): number {
  const cap = f.tables?.os2?.sCapHeight;
  if (cap && f.unitsPerEm) return cap / f.unitsPerEm;
  return 0.72;
}

/**
 * Текст → подпути в мм. `heightMm` — высота заглавных букв;
 * начало координат — левый нижний угол первой строки.
 */
export function textToPaths(text: string, heightMm: number, opts: { lineHeight?: number } = {}): TextResult | null {
  if (!font || !text.trim() || heightMm <= 0) return null;
  const size = heightMm / capRatio(font);
  const lineHeight = (opts.lineHeight ?? 1.25) * heightMm;
  const lines = text.split('\n');

  const paths: SubPath[] = [];
  let width = 0;

  lines.forEach((line, index) => {
    const baseline = -index * lineHeight;
    const path = font!.getPath(line, 0, baseline, size);
    let sub: SubPath | null = null;
    const flip = (x: number, y: number): Vec2 => ({ x, y: -y }); // opentype: Y вниз

    for (const c of path.commands) {
      if (c.type === 'M') {
        if (sub && sub.segs.length) paths.push(sub);
        sub = { closed: false, start: flip(c.x ?? 0, c.y ?? 0), segs: [] };
      } else if (!sub) {
        continue;
      } else if (c.type === 'L') {
        const p = flip(c.x ?? 0, c.y ?? 0);
        sub.segs.push({ t: 'l', a: lastPoint(sub), b: p });
      } else if (c.type === 'C') {
        const p = flip(c.x ?? 0, c.y ?? 0);
        sub.segs.push({
          t: 'c',
          a: lastPoint(sub),
          c1: flip(c.x1 ?? 0, c.y1 ?? 0),
          c2: flip(c.x2 ?? 0, c.y2 ?? 0),
          b: p,
        });
      } else if (c.type === 'Q') {
        const p = flip(c.x ?? 0, c.y ?? 0);
        const q = flip(c.x1 ?? 0, c.y1 ?? 0);
        const a = lastPoint(sub);
        sub.segs.push({
          t: 'c', a,
          c1: { x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) },
          c2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) },
          b: p,
        });
      } else if (c.type === 'Z') {
        sub.closed = true;
        if (sub.segs.length) paths.push(sub);
        sub = null;
      }
    }
    if (sub && sub.segs.length) paths.push(sub);
    width = Math.max(width, font!.getAdvanceWidth(line, size));
  });

  if (!paths.length) return null;
  return { paths: normalize(paths), width, height: heightMm + (lines.length - 1) * lineHeight };
}

function lastPoint(sub: SubPath): Vec2 {
  const last = sub.segs[sub.segs.length - 1];
  return last ? last.b : sub.start;
}

/** Сдвигаем так, чтобы левый нижний угол контуров был в (0,0). */
function normalize(paths: SubPath[]): SubPath[] {
  let minX = Infinity, minY = Infinity;
  for (const sp of paths) {
    minX = Math.min(minX, sp.start.x);
    minY = Math.min(minY, sp.start.y);
    for (const s of sp.segs) {
      const pts = s.t === 'l' ? [s.b] : s.t === 'c' ? [s.c1, s.c2, s.b] : [s.b];
      for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return paths;
  const dx = -minX, dy = -minY;
  const sh = (p: Vec2): Vec2 => ({ x: p.x + dx, y: p.y + dy });
  return paths.map((sp) => ({
    closed: sp.closed,
    start: sh(sp.start),
    segs: sp.segs.map((s) => (s.t === 'l'
      ? { t: 'l' as const, a: sh(s.a), b: sh(s.b) }
      : s.t === 'c'
        ? { t: 'c' as const, a: sh(s.a), c1: sh(s.c1), c2: sh(s.c2), b: sh(s.b) }
        : { t: 'a' as const, a: sh(s.a), b: sh(s.b), center: sh(s.center), r: s.r, a0: s.a0, sweep: s.sweep })),
  }));
}
