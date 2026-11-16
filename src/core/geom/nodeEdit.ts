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

/* ---------- редактор узлов 2.0: ручки Безье, типы узлов, группа узлов ---------- */

export type NodeType = 'corner' | 'smooth' | 'symmetric';

export interface NodeHandle {
  side: 'in' | 'out';
  /** индекс сегмента, которому принадлежит контрольная точка */
  seg: number;
  /** c1 — контрольная точка у начала сегмента, c2 — у конца */
  ctrl: 'c1' | 'c2';
  /** положение контрольной точки в локальных координатах объекта */
  p: Vec2;
}

/** Точка узла в локальных координатах (для открытого и замкнутого подпути). */
export function nodePoint(path: SubPath[], ref: NodeRef): Vec2 | null {
  const sp = path[ref.sub];
  if (!sp) return null;
  if (ref.index <= 0) return sp.start;
  return sp.segs[ref.index - 1]?.b ?? sp.start;
}

const sum = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const unit = (a: Vec2): Vec2 | null => {
  const l = len(a);
  return l < 1e-12 ? null : { x: a.x / l, y: a.y / l };
};

/** Индексы входящего и исходящего сегментов узла (-1, если сегмента нет). */
function adjacent(sp: SubPath, index: number): { in: number; out: number } {
  const count = sp.segs.length;
  const inIdx = index === 0 ? (sp.closed && count > 0 ? count - 1 : -1) : index - 1;
  const outIdx = sp.closed && index >= count ? 0 : index < count ? index : -1;
  return { in: inIdx, out: outIdx };
}

/** Кубические ручки узла — только у кривых сегментов (у отрезков ручек нет). */
export function nodeHandles(path: SubPath[], ref: NodeRef): NodeHandle[] {
  const sp = path[ref.sub];
  if (!sp) return [];
  const { in: inIdx, out: outIdx } = adjacent(sp, ref.index);
  const out: NodeHandle[] = [];
  const inSeg = inIdx >= 0 ? sp.segs[inIdx] : null;
  if (inSeg && inSeg.t === 'c') out.push({ side: 'in', seg: inIdx, ctrl: 'c2', p: inSeg.c2 });
  const outSeg = outIdx >= 0 ? sp.segs[outIdx] : null;
  if (outSeg && outSeg.t === 'c') out.push({ side: 'out', seg: outIdx, ctrl: 'c1', p: outSeg.c1 });
  return out;
}

/**
 * Потянуть ручку узла. При типе 'smooth' противоположная ручка разворачивается
 * по биссектрисе, сохраняя свою длину, при 'symmetric' — ещё и становится равной.
 */
export function moveNodeHandle(path: SubPath[], ref: NodeRef, side: 'in' | 'out', to: Vec2, type: NodeType = 'corner'): SubPath[] {
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  const node = nodePoint(out, ref);
  if (!sp || !node) return path;
  const handles = nodeHandles(out, ref);
  const hit = handles.find((h) => h.side === side);
  if (!hit) return path;
  const seg = sp.segs[hit.seg];
  if (seg.t !== 'c') return path;
  seg[hit.ctrl] = { ...to };

  const other = handles.find((h) => h.side !== side);
  const otherSeg = other ? sp.segs[other.seg] : null;
  if (other && otherSeg && otherSeg.t === 'c' && type !== 'corner') {
    const opposite = unit({ x: node.x - to.x, y: node.y - to.y });
    if (opposite) {
      const keep = type === 'symmetric' ? len({ x: to.x - node.x, y: to.y - node.y }) : len({ x: otherSeg[other.ctrl].x - node.x, y: otherSeg[other.ctrl].y - node.y });
      otherSeg[other.ctrl] = sum(node, mul(opposite, keep));
    }
  }
  return out;
}

/**
 * Тип узла: 'smooth' ставит ручки по биссектрисе (плавный излом отсутствует),
 * 'symmetric' делает их равной длины, 'corner' оставляет как есть.
 */
export function setNodeType(path: SubPath[], ref: NodeRef, type: NodeType): SubPath[] {
  if (type === 'corner') return path;
  const out = path.map((sp, i) => (i === ref.sub ? cubicize(sp) : sp));
  const sp = out[ref.sub];
  const node = nodePoint(out, ref);
  if (!sp || !node) return path;
  const { in: inIdx, out: outIdx } = adjacent(sp, ref.index);
  // отрезки, касающиеся узла, переводим в кривые — иначе ручек у них нет
  for (const idx of [inIdx, outIdx]) {
    const seg = idx >= 0 ? sp.segs[idx] : null;
    if (seg && seg.t === 'l') {
      sp.segs[idx] = {
        t: 'c', a: seg.a,
        c1: { x: seg.a.x + (seg.b.x - seg.a.x) / 3, y: seg.a.y + (seg.b.y - seg.a.y) / 3 },
        c2: { x: seg.a.x + ((seg.b.x - seg.a.x) * 2) / 3, y: seg.a.y + ((seg.b.y - seg.a.y) * 2) / 3 },
        b: seg.b,
      };
    }
  }
  const inSeg = inIdx >= 0 ? sp.segs[inIdx] : null;
  const outSeg = outIdx >= 0 ? sp.segs[outIdx] : null;
  const dirIn = inSeg ? unit({ x: node.x - inSeg.a.x, y: node.y - inSeg.a.y }) : null;
  const dirOut = outSeg ? unit({ x: outSeg.b.x - node.x, y: outSeg.b.y - node.y }) : null;
  if (!dirIn && !dirOut) return path;

  // биссектриса: сумма направлений «внутрь узла» и «из узла»
  let bis = dirIn && dirOut ? unit({ x: dirIn.x + dirOut.x, y: dirIn.y + dirOut.y }) : null;
  // разворот на 180° — биссектрисы нет, берём направление имеющегося сегмента
  if (!bis) bis = dirIn ?? dirOut;
  if (!bis) return path;

  const inLen = inSeg ? dist(inSeg.a, node) / 3 : 0;
  const outLen = outSeg ? dist(outSeg.b, node) / 3 : 0;
  const li = type === 'symmetric' ? Math.min(inLen || outLen, outLen || inLen) : inLen;
  const lo = type === 'symmetric' ? li : outLen;

  if (inSeg && inSeg.t === 'c' && li > 0) inSeg.c2 = { x: node.x - bis.x * li, y: node.y - bis.y * li };
  if (outSeg && outSeg.t === 'c' && lo > 0) outSeg.c1 = { x: node.x + bis.x * lo, y: node.y + bis.y * lo };
  return out;
}

/** Переместить сразу группу узлов на одну дельту. */
export function moveNodes(path: SubPath[], refs: NodeRef[], delta: Vec2): SubPath[] {
  let out = path;
  for (const ref of refs) {
    const from = nodePoint(out, ref);
    if (!from) continue;
    out = moveNode(out, ref, sum(from, delta));
  }
  return out;
}

/** Узлы внутри рамки (локальные координаты объекта). */
export function nodesInBox(path: SubPath[], box: { x: number; y: number; w: number; h: number }): NodeRef[] {
  return pathNodes(path)
    .filter((n) => n.p.x >= box.x && n.p.x <= box.x + box.w && n.p.y >= box.y && n.p.y <= box.y + box.h)
    .map((n) => n.ref);
}
