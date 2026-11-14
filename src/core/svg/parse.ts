import type { Mat2x3, SubPath, Vec2 } from '../types';
import { compose, IDENT, mk, rotate, scaleM, translate } from '../geom/transform';
import { transformSubPaths } from '../geom/path';

interface Node { name: string; attrs: Record<string, string>; children: Node[] }

/** Минимальный XML-парсер: достаточно для SVG, работает и в браузере, и в node (тесты). */
export function parseXml(src: string): Node | null {
  const root: Node = { name: '#document', attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re = /<([a-zA-Z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\/([a-zA-Z_][\w:.-]*)\s*>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (!m[1]) continue; // комментарии, CDATA, прологи
    const node: Node = { name: m[1], attrs: parseAttrs(m[2] ?? ''), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[3]) stack.push(node);
  }
  const svg = root.children.find((c) => c.name.toLowerCase() === 'svg');
  return svg ?? null;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[3] ?? m[4] ?? '';
  return out;
}

export const numOr = (s: string | undefined, fallback = 0): number => {
  if (!s) return fallback;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

/** Единицы CSS → мм. */
export function lengthToMm(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const m = value.trim().match(/^(-?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)$/i);
  if (!m) return fallback;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return fallback;
  switch (m[2].toLowerCase()) {
    case 'mm': return n;
    case 'cm': return n * 10;
    case 'm': return n * 1000;
    case 'in': return n * 25.4;
    case 'pt': return (n * 25.4) / 72;
    case 'pc': return (n * 25.4) / 6;
    case 'px':
    case '':
      return (n * 25.4) / 96;
    default:
      return n;
  }
}

/** transform="..." → матрица. */
export function parseTransform(value: string | undefined): Mat2x3 {
  if (!value) return IDENT;
  let m: Mat2x3 = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(value))) {
    const args = hit[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat2x3 = IDENT;
    switch (hit[1]) {
      case 'matrix': t = mk(args[0], args[1], args[2], args[3], args[4], args[5]); break;
      case 'translate': t = translate(args[0] ?? 0, args[1] ?? 0); break;
      case 'scale': t = scaleM(args[0] ?? 1, args[1] ?? args[0] ?? 1); break;
      case 'rotate': {
        const ang = ((args[0] ?? 0) * Math.PI) / 180;
        if (args.length >= 3) {
          t = compose(translate(args[1], args[2]), compose(rotate(ang), translate(-args[1], -args[2])));
        } else t = rotate(ang);
        break;
      }
      case 'skewX': t = mk(1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0); break;
      case 'skewY': t = mk(1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0); break;
    }
    m = compose(m, t);
  }
  return m;
}

/** Парсер атрибута d: M/L/H/V/C/S/Q/T/A/Z, абсолютные и относительные. */
export function parsePathData(d: string): SubPath[] {
  const tokens = d.match(/[a-zA-Z]|-?[\d.]+(?:e[-+]?\d+)?/g) ?? [];
  const paths: SubPath[] = [];
  let i = 0;
  let cur: Vec2 = { x: 0, y: 0 };
  let startPt: Vec2 = { x: 0, y: 0 };
  let sub: SubPath | null = null;
  let cmd = '';
  let lastCtrl: Vec2 | null = null;
  let prevCmd = '';

  const nextNum = (): number => Number.parseFloat(tokens[i++] ?? '0') || 0;
  const isNum = (): boolean => {
    const t = tokens[i];
    return t !== undefined && !/[a-zA-Z]/.test(t);
  };
  const begin = (p: Vec2, closed = false): void => {
    if (sub && sub.segs.length) paths.push(sub);
    sub = { closed, start: { ...p }, segs: [] };
    startPt = { ...p };
  };
  const ensure = (): SubPath => {
    if (!sub) begin(cur);
    return sub as SubPath;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i += 1; } else if (!cmd) { i += 1; continue; }

    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ax = (x: number): number => (rel ? cur.x + x : x);
    const ay = (y: number): number => (rel ? cur.y + y : y);

    switch (C) {
      case 'M': {
        const p = { x: ax(nextNum()), y: ay(nextNum()) };
        cur = p;
        begin(p);
        prevCmd = 'M';
        // последующие пары — неявный L
        while (isNum()) {
          const q = { x: ax(nextNum()), y: ay(nextNum()) };
          ensure().segs.push({ t: 'l', a: { ...cur }, b: q });
          cur = q;
        }
        continue;
      }
      case 'L': {
        while (isNum()) {
          const q = { x: ax(nextNum()), y: ay(nextNum()) };
          ensure().segs.push({ t: 'l', a: { ...cur }, b: q });
          cur = q;
        }
        prevCmd = 'L';
        continue;
      }
      case 'H': {
        while (isNum()) {
          const q = { x: ax(nextNum()), y: cur.y };
          ensure().segs.push({ t: 'l', a: { ...cur }, b: q });
          cur = q;
        }
        prevCmd = 'H';
        continue;
      }
      case 'V': {
        while (isNum()) {
          const q = { x: cur.x, y: ay(nextNum()) };
          ensure().segs.push({ t: 'l', a: { ...cur }, b: q });
          cur = q;
        }
        prevCmd = 'V';
        continue;
      }
      case 'C': {
        while (isNum()) {
          const c1 = { x: ax(nextNum()), y: ay(nextNum()) };
          const c2 = { x: ax(nextNum()), y: ay(nextNum()) };
          const p = { x: ax(nextNum()), y: ay(nextNum()) };
          ensure().segs.push({ t: 'c', a: { ...cur }, c1, c2, b: p });
          cur = p; lastCtrl = c2;
        }
        prevCmd = 'C';
        continue;
      }
      case 'S': {
        while (isNum()) {
          const c1 = prevCmd === 'C' && lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
          const c2 = { x: ax(nextNum()), y: ay(nextNum()) };
          const p = { x: ax(nextNum()), y: ay(nextNum()) };
          ensure().segs.push({ t: 'c', a: { ...cur }, c1, c2, b: p });
          cur = p; lastCtrl = c2;
        }
        prevCmd = 'S';
        continue;
      }
      case 'Q': {
        while (isNum()) {
          const q = { x: ax(nextNum()), y: ay(nextNum()) };
          const p = { x: ax(nextNum()), y: ay(nextNum()) };
          const c1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
          const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
          ensure().segs.push({ t: 'c', a: { ...cur }, c1, c2, b: p });
          cur = p;
        }
        prevCmd = 'Q';
        continue;
      }
      case 'T': {
        while (isNum()) {
          const p = { x: ax(nextNum()), y: ay(nextNum()) };
          const q = prevCmd === 'Q' && lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
          const c1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
          const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
          ensure().segs.push({ t: 'c', a: { ...cur }, c1, c2, b: p });
          cur = p; lastCtrl = q;
        }
        prevCmd = 'T';
        continue;
      }
      case 'A': {
        while (isNum()) {
          const rx = Math.abs(nextNum());
          const ry = Math.abs(nextNum());
          const rot = (nextNum() * Math.PI) / 180;
          const largeArc = nextNum() !== 0;
          const sweepFlag = nextNum() !== 0;
          const p = { x: ax(nextNum()), y: ay(nextNum()) };
          const cubics = arcToCubicsSvg(cur, p, rx, ry, rot, largeArc, sweepFlag);
          const target = ensure();
          for (const c of cubics) target.segs.push(c);
          cur = p;
        }
        continue;
      }
      case 'Z': {
        const cur2 = sub as SubPath | null;
        if (cur2) {
          cur2.closed = true;
          const first = cur2.start;
          const lastSeg = cur2.segs[cur2.segs.length - 1];
          if (lastSeg && Math.hypot(lastSeg.b.x - first.x, lastSeg.b.y - first.y) > 1e-9) {
            cur2.segs.push({ t: 'l', a: { ...lastSeg.b }, b: { ...first } });
          }
          paths.push(cur2);
          sub = null;
        }
        cur = { ...startPt };
        prevCmd = 'Z';
        continue;
      }
      default:
        i += 1;
        continue;
    }
  }
  const tail = sub as SubPath | null;
  if (tail && tail.segs.length) paths.push(tail);
  return paths.filter((p) => p.segs.length > 0);
}

/** SVG-дуга (эллиптическая) → кубические Безье. */
function arcToCubicsSvg(p0: Vec2, p1: Vec2, rx0: number, ry0: number, phi: number, largeArc: boolean, sweep: boolean) {
  const out: SubPath['segs'] = [];
  let rx = Math.abs(rx0), ry = Math.abs(ry0);
  if (rx < 1e-12 || ry < 1e-12) {
    out.push({ t: 'l', a: p0, b: p1 });
    return out;
  }
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = largeArc === sweep ? -1 : 1;
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(den === 0 ? 0 : num / den);
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  const steps = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / steps;
  const k = (4 / 3) * Math.tan(delta / 4);

  const P = (t: number): Vec2 => {
    const x = rx * Math.cos(t), y = ry * Math.sin(t);
    return { x: cx + cos * x - sin * y, y: cy + sin * x + cos * y };
  };
  const D = (t: number): Vec2 => {
    const x = -rx * Math.sin(t), y = ry * Math.cos(t);
    return { x: cos * x - sin * y, y: sin * x + cos * y };
  };

  let a0 = theta1;
  let from = { ...p0 };
  for (let s = 0; s < steps; s++) {
    const a1 = a0 + delta;
    const to = s === steps - 1 ? { ...p1 } : P(a1);
    const d0 = D(a0), d1 = D(a1);
    out.push({
      t: 'c', a: from,
      c1: { x: from.x + k * d0.x, y: from.y + k * d0.y },
      c2: { x: to.x - k * d1.x, y: to.y - k * d1.y },
      b: to,
    });
    from = to;
    a0 = a1;
  }
  return out;
}

export interface SvgParseResult {
  paths: SubPath[];
  warnings: string[];
  /** размеры из viewBox/width/height в мм */
  size: { w: number; h: number } | null;
}

/** SVG → подпути в миллиметрах (с учётом viewBox и transform-ов). */
export function parseSvg(src: string): SvgParseResult {
  const root = parseXml(src);
  const warnings: string[] = [];
  if (!root) return { paths: [], warnings: ['Не найден корневой <svg>'], size: null };

  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  const vbW = vb.length === 4 ? vb[2] : 0;
  const vbH = vb.length === 4 ? vb[3] : 0;
  const wMm = lengthToMm(root.attrs.width, 0);
  const hMm = lengthToMm(root.attrs.height, 0);

  let base: Mat2x3 = IDENT;
  if (vbW > 0 && vbH > 0) {
    const scale = wMm > 0 ? wMm / vbW : hMm > 0 ? hMm / vbH : 25.4 / 96;
    base = compose(translate(-vb[0] * scale, -vb[1] * scale), scaleM(scale, scale));
  } else if (wMm > 0 && hMm > 0) {
    base = scaleM(25.4 / 96, 25.4 / 96);
  }

  const paths: SubPath[] = [];

  const walk = (node: Node, m: Mat2x3): void => {
    const local = compose(m, parseTransform(node.attrs.transform));
    const name = node.name.toLowerCase();
    switch (name) {
      case 'svg':
      case 'g':
      case 'a':
        for (const c of node.children) walk(c, local);
        return;
      case 'path': {
        const d = node.attrs.d;
        if (d) for (const sp of parsePathData(d)) paths.push(applyM(sp, local));
        return;
      }
      case 'rect': {
        const x = numOr(node.attrs.x), y = numOr(node.attrs.y);
        const w = numOr(node.attrs.width), h = numOr(node.attrs.height);
        if (w > 0 && h > 0) {
          const r = Math.min(numOr(node.attrs.rx, numOr(node.attrs.ry)), w / 2, h / 2);
          paths.push(applyM(rectSub(x, y, w, h, r), local));
        }
        return;
      }
      case 'circle': {
        const cx = numOr(node.attrs.cx), cy = numOr(node.attrs.cy), r = numOr(node.attrs.r);
        if (r > 0) paths.push(applyM(ellipseSub(cx, cy, r, r), local));
        return;
      }
      case 'ellipse': {
        const cx = numOr(node.attrs.cx), cy = numOr(node.attrs.cy);
        const rx = numOr(node.attrs.rx), ry = numOr(node.attrs.ry);
        if (rx > 0 && ry > 0) paths.push(applyM(ellipseSub(cx, cy, rx, ry), local));
        return;
      }
      case 'line': {
        const a = { x: numOr(node.attrs.x1), y: numOr(node.attrs.y1) };
        const b = { x: numOr(node.attrs.x2), y: numOr(node.attrs.y2) };
        paths.push(applyM({ closed: false, start: a, segs: [{ t: 'l', a, b }] }, local));
        return;
      }
      case 'polyline':
      case 'polygon': {
        const pts = (node.attrs.points ?? '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
        const vs: Vec2[] = [];
        for (let k = 0; k + 1 < pts.length; k += 2) vs.push({ x: pts[k], y: pts[k + 1] });
        if (vs.length >= 2) {
          const closed = name === 'polygon';
          const segs = vs.slice(1).map((p, k) => ({ t: 'l' as const, a: vs[k], b: p }));
          if (closed) segs.push({ t: 'l', a: vs[vs.length - 1], b: vs[0] });
          paths.push(applyM({ closed, start: vs[0], segs }, local));
        }
        return;
      }
      case 'text':
      case 'tspan':
        warnings.push('Текст внутри SVG не импортируется — переведите его в кривые');
        return;
      case 'use':
        warnings.push('<use> со ссылкой на символ не поддерживается');
        return;
      case 'defs':
      case 'symbol':
      case 'marker':
      case 'clipPath':
      case 'mask':
        return;
      default:
        for (const c of node.children) walk(c, local);
    }
  };

  walk(root, base);
  return {
    paths,
    warnings: [...new Set(warnings)],
    size: vbW > 0 && vbH > 0
      ? { w: (wMm || vbW * (25.4 / 96)), h: (hMm || vbH * (25.4 / 96)) }
      : wMm > 0 && hMm > 0 ? { w: wMm, h: hMm } : null,
  };
}

const applyM = (sp: SubPath, m: Mat2x3): SubPath => transformSubPaths([sp], m)[0];

function rectSub(x: number, y: number, w: number, h: number, r: number): SubPath {
  if (r <= 0) {
    const p0 = { x, y }, p1 = { x: x + w, y }, p2 = { x: x + w, y: y + h }, p3 = { x, y: y + h };
    return { closed: true, start: p0, segs: [
      { t: 'l', a: p0, b: p1 }, { t: 'l', a: p1, b: p2 }, { t: 'l', a: p2, b: p3 }, { t: 'l', a: p3, b: p0 },
    ] };
  }
  const arc = (cx: number, cy: number, from: number) => {
    const sweep = Math.PI / 2;
    const a0 = from;
    const start = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
    const end = { x: cx + r * Math.cos(a0 + sweep), y: cy + r * Math.sin(a0 + sweep) };
    return { t: 'a' as const, a: start, b: end, center: { x: cx, y: cy }, r, a0, sweep };
  };
  const s1 = arc(x + r, y + r, Math.PI);
  const s2 = arc(x + w - r, y + r, -Math.PI / 2);
  const s3 = arc(x + w - r, y + h - r, 0);
  const s4 = arc(x + r, y + h - r, Math.PI / 2);
  return { closed: true, start: s1.a, segs: [s1, { t: 'l', a: s1.b, b: s2.a }, s2, { t: 'l', a: s2.b, b: s3.a }, s3, { t: 'l', a: s3.b, b: s4.a }, s4, { t: 'l', a: s4.b, b: s1.a }] };
}

function ellipseSub(cx: number, cy: number, rx: number, ry: number): SubPath {
  const K = 0.5522847498307936;
  const p = (x: number, y: number): Vec2 => ({ x: cx + x, y: cy + y });
  const right = p(rx, 0), top = p(0, ry), left = p(-rx, 0), bottom = p(0, -ry);
  return {
    closed: true,
    start: right,
    segs: [
      { t: 'c', a: right, c1: p(rx, ry * K), c2: p(rx * K, ry), b: top },
      { t: 'c', a: top, c1: p(-rx * K, ry), c2: p(-rx, ry * K), b: left },
      { t: 'c', a: left, c1: p(-rx, -ry * K), c2: p(-rx * K, -ry), b: bottom },
      { t: 'c', a: bottom, c1: p(rx * K, -ry), c2: p(rx, -ry * K), b: right },
    ],
  };
}
