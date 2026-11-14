import type { Seg, SubPath, Vec2 } from '../types';
import { arcToCubics } from './arc';
import { dist } from './vec';

export interface NodeRef { sub: number; index: number }
export interface PathNode { ref: NodeRef; p: Vec2; closed: boolean; subStart: boolean }

/** Все узлы: точка старта подпути + концы сегментов. */
export function pathNodes(path: SubPath[]): PathNode[] {
  const out: PathNode[] = [];
  path.forEach((sp, sub) => {
    out.push({ ref: { sub, index: 0 }, p: sp.start, closed: sp.closed, subStart: true });
    sp.segs.forEach((s, i) => {
      const isLast = i === sp.segs.length - 1;
      if (sp.closed && isLast) return; // последняя точка замкнутого = старт
      out.push({ ref: { sub, index: i + 1 }, p: s.b, closed: sp.closed, subStart: false });
    });
  });
  return out;
}

const cloneSeg = (s: Seg): Seg =>
  s.t === 'l' ? { ...s } : s.t === 'c' ? { ...s } : { ...s };

/** Разложить дуги в кубические — чтобы узел можно было двигать. */
function cubicize(sp: SubPath): SubPath {
  const segs: Seg[] = [];
  for (const s of sp.segs) {
    if (s.t === 'a') segs.push(...arcToCubics(s.center, s.r, s.a0, s.sweep));
    else segs.push(cloneSeg(s));
  }
  return { ...sp, segs };
}

function pointAt(sp: SubPath, index: number): Vec2 {
  if (index <= 0) return sp.start;
  const s = sp.segs[index - 1];
  return s ? s.b : sp.start;
}

/** Переместить узел: концы соседних сегментов двигаются, контрольные точки — на ту же дельту. */
export function moveNode(path: SubPath[], ref: NodeRef, to: Vec2): SubPath[] {
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  if (!sp) return path;

  const count = sp.segs.length;
  const index = ref.index;
  const prevPoint = index === 0 ? (sp.closed ? sp.segs[count - 1]?.b ?? sp.start : sp.start) : pointAt(sp, index);
  const from = index === 0 ? sp.start : pointAt(sp, index);
  const dx = to.x - (from ?? prevPoint).x;
  const dy = to.y - (from ?? prevPoint).y;
  void prevPoint;

  // предыдущий сегмент
  const prevIdx = index === 0 ? (sp.closed ? count - 1 : -1) : index - 1;
  if (prevIdx >= 0) {
    const s = sp.segs[prevIdx];
    if (s.t === 'l') s.b = { ...to };
    else if (s.t === 'c') {
      s.b = { ...to };
      s.c2 = { x: s.c2.x + dx, y: s.c2.y + dy };
    }
  }
  // следующий сегмент
  const nextIdx = index < count ? index : -1;
  if (nextIdx >= 0 && nextIdx < count) {
    const s = sp.segs[nextIdx];
    if (s.t === 'l') s.a = { ...to };
    else if (s.t === 'c') {
      s.a = { ...to };
      s.c1 = { x: s.c1.x + dx, y: s.c1.y + dy };
    }
  }
  if (index === 0) {
    sp.start = { ...to };
    // старт замкнутого подпути — это же конец последнего сегмента
    if (sp.closed) {
      const last = sp.segs[count - 1];
      if (last && last.t === 'l') last.b = { ...to };
      else if (last && last.t === 'c') last.b = { ...to };
    }
  }
  return out;
}

function lineSeg(a: Vec2, b: Vec2): Seg { return { t: 'l', a: { ...a }, b: { ...b } }; }

/** Удалить узел: соседние сегменты склеиваются прямой. */
export function deleteNode(path: SubPath[], ref: NodeRef): SubPath[] {
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  if (!sp) return path;
  const count = sp.segs.length;

  if (!sp.closed && ref.index === 0) {
    if (count <= 1) { out.splice(ref.sub, 1); return out; }
    sp.start = sp.segs[0].b;
    sp.segs.shift();
    return out;
  }
  if (!sp.closed && ref.index >= count) {
    sp.segs.pop();
    if (!sp.segs.length) out.splice(ref.sub, 1);
    return out;
  }
  if (sp.segs.length <= 2) { out.splice(ref.sub, 1); return out; }

  const prevIdx = ref.index === 0 ? count - 1 : ref.index - 1;
  const nextIdx = ref.index === 0 ? 0 : ref.index;
  const a = sp.segs[prevIdx].a;
  const b = sp.segs[nextIdx].b;
  const merged: Seg = lineSeg(a, b);

  const keep: Seg[] = [];
  for (let i = 0; i < count; i++) {
    if (i === prevIdx) keep.push(merged);
    else if (i === nextIdx) continue;
    else keep.push(sp.segs[i]);
  }
  sp.segs = keep;
  if (ref.index === 0 && sp.closed) {
    sp.start = merged.b;
  }
  return out;
}

/** Разбить сегмент в точке t — добавляет узел. */
export function splitSegment(path: SubPath[], ref: NodeRef, t: number): { path: SubPath[]; ref: NodeRef } | null {
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  const segIndex = ref.index;
  const s = sp?.segs[segIndex];
  if (!sp || !s) return null;

  if (s.t === 'l') {
    const mid = { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    sp.segs.splice(segIndex, 1, lineSeg(s.a, mid), lineSeg(mid, s.b));
  } else if (s.t === 'c') {
    const lerp = (p: Vec2, q: Vec2, k = t): Vec2 => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    const p01 = lerp(s.a, s.c1), p12 = lerp(s.c1, s.c2), p23 = lerp(s.c2, s.b);
    const p012 = lerp(p01, p12), p123 = lerp(p12, p23);
    const mid = lerp(p012, p123);
    sp.segs.splice(
      segIndex, 1,
      { t: 'c', a: s.a, c1: p01, c2: p012, b: mid },
      { t: 'c', a: mid, c1: p123, c2: p23, b: s.b },
    );
  } else {
    return null;
  }
  return { path: out, ref: { sub: ref.sub, index: segIndex + 1 } };
}

/** «В кривую»: сегмент становится кубическим с плавными ручками. */
export function toCurve(path: SubPath[], ref: NodeRef): SubPath[] {
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  if (!sp) return path;
  const idxs = [ref.index - 1, ref.index].filter((i) => i >= 0 && i < sp.segs.length);
  for (const i of idxs) {
    const s = sp.segs[i];
    if (s.t === 'l') {
      sp.segs[i] = {
        t: 'c', a: { ...s.a },
        c1: { x: s.a.x + (s.b.x - s.a.x) / 3, y: s.a.y + (s.b.y - s.a.y) / 3 },
        c2: { x: s.a.x + ((s.b.x - s.a.x) * 2) / 3, y: s.a.y + ((s.b.y - s.a.y) * 2) / 3 },
        b: { ...s.b },
      };
    }
  }
  return out;
}

/** «В прямую»: сегмент становится отрезком. */
export function toLine(path: SubPath[], ref: NodeRef): SubPath[] {
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  if (!sp) return path;
  for (const i of [ref.index - 1, ref.index]) {
    const s = sp.segs[i];
    if (s && s.t === 'c') sp.segs[i] = lineSeg(s.a, s.b);
  }
  return out;
}

/** Замкнуть/разомкнуть подпуть. */
export function toggleClosed(path: SubPath[], sub: number): SubPath[] {
  return path.map((sp, i) => {
    if (i !== sub) return sp;
    if (sp.closed) {
      const last = sp.segs[sp.segs.length - 1];
      if (last && dist(last.b, sp.start) < 1e-6) sp.segs.pop();
      return { ...sp, segs: [...sp.segs], closed: false };
    }
    const last = sp.segs[sp.segs.length - 1];
    const segs = [...sp.segs];
    if (last && dist(last.b, sp.start) > 1e-6) segs.push(lineSeg(last.b, sp.start));
    return { ...sp, segs, closed: true };
  });
}

/** Разорвать подпуть в узле на два. */
export function breakAt(path: SubPath[], ref: NodeRef): SubPath[] {
  const sp = path[ref.sub];
  if (!sp) return path;
  if (!sp.closed) return path;
  const src = cubicize(sp);
  const rot = [...src.segs.slice(ref.index), ...src.segs.slice(0, ref.index)];
  const first: SubPath = { closed: false, start: ref.index === 0 ? src.start : src.segs[ref.index - 1].b, segs: rot };
  return [...path.slice(0, ref.sub), first, ...path.slice(ref.sub + 1)];
}
