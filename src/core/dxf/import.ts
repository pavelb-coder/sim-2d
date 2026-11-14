import type { Box, Id, Mat2x3, Obj, SubPath, Vec2 } from '../types';
import { num, nums, parseDxfText, str, type RawEntity } from './tokenize';
import { arcFromBulge, circleAsArcs } from '../geom/arc';
import { bboxOfSubPaths, boxUnion, transformSubPaths } from '../geom/path';
import { makeObj } from '../shape';
import type { Style } from '../types';
import { compose, IDENT, rotate, scaleM, translate } from '../geom/transform';

export interface DxfImportOptions {
  sheetId: Id;
  cutLayerId: Id;
  engraveLayerId: Id;
  cutColor: string;
  engraveColor: string;
  /** Шейпер для TEXT/MTEXT: возвращает контуры или null, если шрифта нет. */
  textToPaths?: (text: string, heightMm: number) => SubPath[] | null;
}

export interface DxfImportResult {
  objects: Obj[];
  warnings: string[];
  bbox: Box | null;
  unitScale: number;
}

/** $INSUNITS → множитель к миллиметрам. */
export function unitScaleFromHeader(header: Record<string, string[]>): { scale: number; label: string } {
  const raw = header['$INSUNITS']?.[0];
  const code = raw === undefined ? 0 : Number.parseInt(raw, 10);
  switch (code) {
    case 1: return { scale: 25.4, label: 'дюймы' };
    case 2: return { scale: 304.8, label: 'футы' };
    case 4: return { scale: 1, label: 'миллиметры' };
    case 5: return { scale: 10, label: 'сантиметры' };
    case 6: return { scale: 1000, label: 'метры' };
    case 9: return { scale: 0.0254, label: 'микроны' };
    default: return { scale: 1, label: 'не указаны (считаем мм)' };
  }
}

const isEngraveLayer = (name: string, color: number): boolean =>
  /engrav|гравир|scan|etch|mark/i.test(name) || Math.abs(color) === 5;

function polylineFromVertices(points: { p: Vec2; bulge: number }[], closed: boolean): SubPath {
  const segs: SubPath['segs'] = [];
  const n = points.length;
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (Math.abs(a.bulge) > 1e-9) {
      const arc = arcFromBulge(a.p, b.p, a.bulge);
      if (arc) {
        segs.push({ t: 'a', a: a.p, b: b.p, center: arc.center, r: arc.r, a0: arc.a0, sweep: arc.sweep });
        continue;
      }
    }
    segs.push({ t: 'l', a: a.p, b: b.p });
  }
  return { closed, start: points[0].p, segs };
}

/** Сплайн: сэмплирование через алгоритм де Бура (линии — достаточно для резки). */
function sampleSpline(ctrl: Vec2[], knots: number[], degree: number, samples: number): Vec2[] {
  if (ctrl.length < 2) return [];
  const deg = Math.min(Math.max(degree, 1), ctrl.length - 1);
  const t0 = knots[deg] ?? 0;
  const t1 = knots[ctrl.length] ?? 1;
  if (!(t1 > t0)) return ctrl.slice();
  const pts: Vec2[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = t0 + ((t1 - t0) * s) / samples;
    let span = deg;
    for (let i = deg; i < ctrl.length; i++) {
      if (t >= (knots[i] ?? 0) && t <= (knots[i + 1] ?? 1)) { span = i; break; }
    }
    const d: Vec2[] = [];
    for (let j = 0; j <= deg; j++) d[j] = { ...ctrl[span - deg + j] };
    for (let r = 1; r <= deg; r++) {
      for (let j = deg; j >= r; j--) {
        const i = span - deg + j;
        const denom = (knots[i + deg - r + 1] ?? 1) - (knots[i] ?? 0);
        const alpha = denom === 0 ? 0 : (t - (knots[i] ?? 0)) / denom;
        d[j] = {
          x: d[j - 1].x * (1 - alpha) + d[j].x * alpha,
          y: d[j - 1].y * (1 - alpha) + d[j].y * alpha,
        };
      }
    }
    pts.push(d[deg]);
  }
  return pts;
}

function pointsToPath(pts: Vec2[], closed: boolean): SubPath | null {
  if (pts.length < 2) return null;
  const segs: SubPath['segs'] = [];
  for (let i = 1; i < pts.length; i++) segs.push({ t: 'l', a: pts[i - 1], b: pts[i] });
  if (closed) {
    const first = pts[0], last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) segs.push({ t: 'l', a: last, b: first });
  }
  return { closed, start: pts[0], segs };
}

const toVec = (e: RawEntity, xc: number, yc: number): Vec2 => ({ x: num(e, xc), y: num(e, yc) });

interface Ctx {
  opts: DxfImportOptions;
  blocks: Record<string, { base: Vec2; entities: RawEntity[] }>;
  warnings: Set<string>;
  depth: number;
}

/** Сущность → подпути (в DXF-координатах, до масштаба единиц). */
function entityToPaths(e: RawEntity, ctx: Ctx, m = IDENT): SubPath[][] {
  const out: SubPath[][] = [];
  const apply = (paths: SubPath[]): SubPath[] => transformPaths(paths, m);

  switch (e.type) {
    case 'LINE': {
      const a = toVec(e, 10, 20), b = toVec(e, 11, 21);
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) {
        out.push(apply([{ closed: false, start: a, segs: [{ t: 'l', a, b }] }]));
      } else {
        ctx.warnings.add('Пропущен отрезок нулевой длины');
      }
      break;
    }
    case 'LWPOLYLINE': {
      // Код 42 (bulge) необязателен и относится к предыдущей вершине,
      // поэтому идём по парам в исходном порядке, а не по массивам кодов.
      const pts: { p: Vec2; bulge: number }[] = [];
      if (e.pairs?.length) {
        for (const { code, value } of e.pairs) {
          if (code === 10) pts.push({ p: { x: Number.parseFloat(value) || 0, y: 0 }, bulge: 0 });
          else if (code === 20 && pts.length) pts[pts.length - 1].p.y = Number.parseFloat(value) || 0;
          else if (code === 42 && pts.length) pts[pts.length - 1].bulge = Number.parseFloat(value) || 0;
        }
      } else {
        const xs = nums(e, 10), ys = nums(e, 20), bulges = nums(e, 42);
        const count = Math.min(xs.length, ys.length);
        for (let i = 0; i < count; i++) pts.push({ p: { x: xs[i], y: ys[i] }, bulge: bulges[i] ?? 0 });
      }
      if (pts.length >= 2) {
        const closed = (num(e, 70) & 1) === 1;
        out.push(apply([polylineFromVertices(pts, closed)]));
      }
      break;
    }
    case 'POLYLINE': {
      const verts = e.vertices ?? [];
      const pts = verts.map((v) => ({ p: toVec(v, 10, 20), bulge: num(v, 42) }));
      if (pts.length >= 2) {
        const closed = (num(e, 70) & 1) === 1;
        out.push(apply([polylineFromVertices(pts, closed)]));
      }
      break;
    }
    case 'CIRCLE': {
      const c = toVec(e, 10, 20), r = num(e, 40);
      if (r > 0) out.push(apply([{ closed: true, start: circleAsArcs(c, r)[0].a, segs: circleAsArcs(c, r) }]));
      break;
    }
    case 'ARC': {
      const c = toVec(e, 10, 20), r = num(e, 40);
      const a0 = (num(e, 50) * Math.PI) / 180;
      let a1 = (num(e, 51) * Math.PI) / 180;
      while (a1 <= a0) a1 += Math.PI * 2;
      if (r > 0 && a1 > a0) {
        const start = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
        const end = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
        out.push(apply([{ closed: false, start, segs: [{ t: 'a', a: start, b: end, center: c, r, a0, sweep: a1 - a0 }] }]));
      }
      break;
    }
    case 'ELLIPSE': {
      const c = toVec(e, 10, 20);
      const major = { x: num(e, 11) - c.x, y: num(e, 21) - c.y };
      const ratio = num(e, 40, 1);
      const minor = { x: -major.y * ratio, y: major.x * ratio };
      const t0 = num(e, 41, 0);
      let t1 = num(e, 42, Math.PI * 2);
      while (t1 <= t0) t1 += Math.PI * 2;
      const steps = Math.max(2, Math.ceil((t1 - t0) / (Math.PI / 2)));
      const segs: SubPath['segs'] = [];
      const P = (t: number): Vec2 => ({
        x: c.x + major.x * Math.cos(t) + minor.x * Math.sin(t),
        y: c.y + major.y * Math.cos(t) + minor.y * Math.sin(t),
      });
      const D = (t: number): Vec2 => ({
        x: -major.x * Math.sin(t) + minor.x * Math.cos(t),
        y: -major.y * Math.sin(t) + minor.y * Math.cos(t),
      });
      const dt = (t1 - t0) / steps;
      const alpha = (4 / 3) * Math.tan(dt / 4);
      for (let i = 0; i < steps; i++) {
        const ta = t0 + dt * i, tb = ta + dt;
        const p0 = P(ta), p1 = P(tb), d0 = D(ta), d1 = D(tb);
        segs.push({
          t: 'c', a: p0,
          c1: { x: p0.x + alpha * d0.x, y: p0.y + alpha * d0.y },
          c2: { x: p1.x - alpha * d1.x, y: p1.y - alpha * d1.y },
          b: p1,
        });
      }
      const closed = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
      out.push(apply([{ closed, start: segs[0].a, segs }]));
      break;
    }
    case 'SPLINE': {
      const degree = num(e, 71, 3);
      const xs = nums(e, 10), ys = nums(e, 20);
      const ctrl: Vec2[] = [];
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) ctrl.push({ x: xs[i], y: ys[i] });
      const knots = nums(e, 40);
      const closed = (num(e, 70) & 1) === 1;
      const pts = knots.length >= ctrl.length + degree + 1
        ? sampleSpline(ctrl, knots, degree, Math.max(24, ctrl.length * 8))
        : ctrl;
      const path = pointsToPath(pts, closed);
      if (path) out.push(apply([path]));
      else ctx.warnings.add('SPLINE без контрольных точек пропущен');
      break;
    }
    case 'TEXT':
    case 'MTEXT': {
      const raw = str(e, 1) || str(e, 3);
      const height = num(e, 40, 3.5);
      const clean = raw
        .replace(/\\[A-Za-z][^;]*;/g, '')
        .replace(/\\P/g, ' ')
        .replace(/[{}]/g, '')
        .trim();
      if (!clean) break;
      const paths = ctx.opts.textToPaths?.(clean, height);
      if (!paths) {
        ctx.warnings.add(`Текст «${clean.slice(0, 20)}» не переведён в кривые (нет шрифта)`);
        break;
      }
      const at = toVec(e, 10, 20);
      const rot = (num(e, 50) * Math.PI) / 180;
      const local = compose(translate(at.x, at.y), rotate(rot));
      out.push(transformPaths(paths, compose(m, local)));
      break;
    }
    case 'INSERT': {
      const name = str(e, 2);
      const block = ctx.blocks[name];
      if (!block) { ctx.warnings.add(`Блок «${name}» не найден`); break; }
      if (ctx.depth > 8) { ctx.warnings.add('Слишком глубокая вложенность блоков'); break; }
      const at = toVec(e, 10, 20);
      const rot = (num(e, 50) * Math.PI) / 180;
      const sx = num(e, 41, 1) || 1;
      const sy = num(e, 42, 1) || 1;
      const local = compose(
        translate(at.x, at.y),
        compose(rotate(rot), compose(scaleM(sx, sy), translate(-block.base.x, -block.base.y))),
      );
      const inner = compose(m, local);
      ctx.depth += 1;
      for (const child of block.entities) {
        if (child.type === 'ATTDEF') continue;
        out.push(...entityToPaths(child, ctx, inner));
      }
      ctx.depth -= 1;
      break;
    }
    default:
      break;
  }
  return out;
}

const transformPaths = (paths: SubPath[], m: Mat2x3): SubPath[] => transformSubPaths(paths, m);

export function importDxf(text: string, opts: DxfImportOptions): DxfImportResult {
  const parsed = parseDxfText(text);
  const warnings = new Set<string>();
  const { scale, label } = unitScaleFromHeader(parsed.header);
  if (label.includes('не указаны')) warnings.add('В файле не указаны единицы — считаем миллиметры');

  const blocks: Ctx['blocks'] = {};
  for (const [name, b] of Object.entries(parsed.blocks)) {
    blocks[name] = { base: b.base, entities: b.entities };
  }

  const layerInfo = new Map(parsed.layers.map((l) => [l.name, l]));
  const ctx: Ctx = { opts, blocks, warnings, depth: 0 };
  const objects: Obj[] = [];
  let bbox: Box | null = null;

  for (const entity of parsed.entities) {
    const layerName = str(entity, 8, '0');
    const info = layerInfo.get(layerName);
    const engrave = isEngraveLayer(layerName, info?.color ?? 7);
    const groups = entityToPaths(entity, ctx);
    if (!groups.length) {
      if (!['POINT', 'HATCH', 'DIMENSION', 'SOLID', '3DFACE', 'XLINE', 'RAY', 'IMAGE', 'WIPEOUT', 'LEADER', 'MULTILEADER'].includes(entity.type)) {
        warnings.add(`Сущность ${entity.type} не импортирована`);
      } else if (entity.type !== 'POINT') {
        warnings.add(`${entity.type} не поддерживается и пропущена`);
      }
      continue;
    }
    for (const paths of groups) {
      if (!paths.length) continue;
      // единицы → мм
      const mm = scale === 1 ? paths : transformSubPaths(paths, scaleM(scale, scale));
      const style: Style = {
        fill: null,
        stroke: engrave ? opts.engraveColor : opts.cutColor,
        strokeWidth: 0.1,
        opacity: 1,
      };
      const obj = makeObj({
        sheetId: opts.sheetId,
        layerId: engrave ? opts.engraveLayerId : opts.cutLayerId,
        path: mm,
        transform: IDENT,
        style,
        name: layerName && layerName !== '0' ? layerName : undefined,
      });
      objects.push(obj);
      bbox = boxUnion(bbox, bboxOfSubPaths(mm));
    }
  }

  return { objects, warnings: [...warnings], bbox, unitScale: scale };
}
