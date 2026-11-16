import type { Box, Doc, Id, Obj, Op, SubPath, Vec2 } from '../types';
import { activeSheet } from '../doc';
import { bboxOfSubPaths, boxUnion, flattenSubPaths, transformSubPaths } from '../geom/path';
import { bulgeFromSweep } from '../geom/arc';

export type DxfVersion = 'R2000' | 'R12';

export interface DxfExportOptions {
  version?: DxfVersion;
  sheetId?: Id;
  /** допуск сглаживания Безье, мм */
  tolerance?: number;
  /** выгрузить только эти объекты (например, выделение) */
  onlyIds?: Id[];
  /**
   * Единицы файла: миллиметры (INSUNITS=4) или дюймы (INSUNITS=1).
   * Во втором случае координаты пересчитываются в дюймы — так файл открывается
   * в американских Cam/CAD без ручной правки масштаба.
   */
  units?: 'mm' | 'inch';
}

/** Во сколько раз масштабировать координаты при выгрузке. */
export const unitScale = (units: 'mm' | 'inch' = 'mm'): number => (units === 'inch' ? 1 / 25.4 : 1);

const LAYER_OF_OP: Record<Op, { name: string; aci: number }> = {
  cut: { name: 'CUT', aci: 1 },
  engrave: { name: 'ENGRAVE', aci: 5 },
  score: { name: 'SCORE', aci: 3 },
};

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return '0.0';
  const v = Math.abs(n) < 1e-12 ? 0 : n;
  const s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
  return s === '-0.0' ? '0.0' : s;
};

class Writer {
  private out: string[] = [];
  private handle = 0x100;
  constructor(readonly r2000: boolean) {}

  add(code: number, value: string | number): void {
    this.out.push(String(code), String(value));
  }

  nextHandle(): string {
    this.handle += 1;
    return this.handle.toString(16).toUpperCase();
  }

  /** Общие поля сущности. */
  entityHead(type: string, layer: string, subclass: string): void {
    this.add(0, type);
    if (this.r2000) {
      this.add(5, this.nextHandle());
      this.add(100, 'AcDbEntity');
    }
    this.add(8, layer);
    if (this.r2000) this.add(100, subclass);
  }

  point(code: number, p: Vec2, z = 0): void {
    this.add(code, fmt(p.x));
    this.add(code + 10, fmt(p.y));
    if (this.r2000 && code < 30) this.add(code + 20, fmt(z));
  }

  toString(): string {
    return this.out.join('\n') + '\n';
  }
}

interface PolyVertex { p: Vec2; bulge: number }

/**
 * Подпуть → вершины полилинии с bulge.
 * Важно: в DXF код 42 стоит у ВЕРШИНЫ, ИЗ которой выходит дуга (bulge относится
 * к следующему сегменту), поэтому записываем его в предыдущую точку.
 * Безье сглаживается в ломаную с допуском tol.
 */
function subPathToVertices(sp: SubPath, tol: number): PolyVertex[] {
  const verts: PolyVertex[] = [];
  const push = (p: Vec2): PolyVertex => {
    const last = verts[verts.length - 1];
    if (last && Math.hypot(last.p.x - p.x, last.p.y - p.y) < 1e-9) return last;
    const v: PolyVertex = { p, bulge: 0 };
    verts.push(v);
    return v;
  };

  push(sp.start);
  for (const s of sp.segs) {
    const from = verts[verts.length - 1];
    if (s.t === 'a') {
      // дуга: bulge принадлежит вершине, из которой она начинается
      if (from && Math.hypot(from.p.x - s.a.x, from.p.y - s.a.y) < 1e-9) {
        from.bulge = bulgeFromSweep(s.sweep);
      }
      push(s.b);
    } else if (s.t === 'l') {
      push(s.b);
    } else {
      const pts = flattenSubPaths([{ closed: false, start: s.a, segs: [s] }], Math.max(tol, 0.002))[0];
      for (let i = 1; i < pts.length; i++) push(pts[i]);
    }
  }
  if (sp.closed && verts.length > 1) {
    const first = verts[0].p;
    const last = verts[verts.length - 1];
    if (Math.hypot(last.p.x - first.x, last.p.y - first.y) < 1e-9) verts.pop();
  }
  return verts;
}

function asCircle(sp: SubPath): { center: Vec2; r: number } | null {
  if (!sp.closed || sp.segs.length < 2) return null;
  const arcs = sp.segs.filter((s) => s.t === 'a');
  if (arcs.length !== sp.segs.length) return null;
  const first = arcs[0] as Extract<SubPath['segs'][number], { t: 'a' }>;
  let sweep = 0;
  for (const s of arcs) {
    if (s.t !== 'a') return null;
    if (Math.hypot(s.center.x - first.center.x, s.center.y - first.center.y) > 1e-6) return null;
    if (Math.abs(s.r - first.r) > 1e-6) return null;
    sweep += Math.abs(s.sweep);
  }
  if (Math.abs(sweep - Math.PI * 2) > 1e-6) return null;
  return { center: first.center, r: first.r };
}

function writePolyline(w: Writer, layer: string, verts: PolyVertex[], closed: boolean): void {
  if (verts.length < 2) return;
  if (w.r2000) {
    w.entityHead('LWPOLYLINE', layer, 'AcDbPolyline');
    w.add(90, verts.length);
    w.add(70, closed ? 1 : 0);
    w.add(43, '0.0');
    for (const v of verts) {
      w.add(10, fmt(v.p.x));
      w.add(20, fmt(v.p.y));
      if (Math.abs(v.bulge) > 1e-12) w.add(42, fmt(v.bulge));
    }
    return;
  }
  // R12: POLYLINE + VERTEX + SEQEND
  w.add(0, 'POLYLINE');
  w.add(8, layer);
  w.add(66, 1);
  w.add(10, '0.0'); w.add(20, '0.0'); w.add(30, '0.0');
  w.add(70, closed ? 1 : 0);
  for (const v of verts) {
    w.add(0, 'VERTEX');
    w.add(8, layer);
    w.add(10, fmt(v.p.x)); w.add(20, fmt(v.p.y)); w.add(30, '0.0');
    if (Math.abs(v.bulge) > 1e-12) w.add(42, fmt(v.bulge));
  }
  w.add(0, 'SEQEND');
  w.add(8, layer);
}

function writeCircle(w: Writer, layer: string, c: Vec2, r: number): void {
  w.entityHead('CIRCLE', layer, 'AcDbCircle');
  w.add(10, fmt(c.x)); w.add(20, fmt(c.y));
  if (w.r2000) w.add(30, '0.0');
  w.add(40, fmt(r));
}

/** Документ → строка DXF. */
export function exportDxf(doc: Doc, opts: DxfExportOptions = {}): string {
  const version = opts.version ?? 'R2000';
  const sheetId = opts.sheetId ?? doc.activeSheetId;
  const tol = opts.tolerance ?? 0.01;
  const sheet = activeSheet(doc);
  const w = new Writer(version === 'R2000');
  const units = opts.units ?? 'mm';
  const k = unitScale(units);
  const only = opts.onlyIds ? new Set(opts.onlyIds) : null;

  const objs = doc.order
    .map((id) => doc.objects[id])
    .filter((o): o is Obj => !!o && o.sheetId === sheetId && !o.hidden && (!only || only.has(o.id)));

  // геометрия по слоям
  const layerOf = new Map<Id, string>();
  for (const l of doc.layers) layerOf.set(l.id, LAYER_OF_OP[l.op].name);

  let extent: Box | null = null;
  for (const obj of objs) {
    extent = boxUnion(extent, bboxOfSubPaths(transformSubPaths(obj.path, worldMatrix(obj, k))));
  }
  const raw = extent ?? { x: 0, y: 0, w: sheet.width, h: sheet.height };
  const ex = { x: raw.x * k, y: raw.y * k, w: raw.w * k, h: raw.h * k };

  // HEADER
  w.add(0, 'SECTION'); w.add(2, 'HEADER');
  w.add(9, '$ACADVER'); w.add(1, version === 'R2000' ? 'AC1015' : 'AC1009');
  w.add(9, '$INSUNITS'); w.add(70, units === 'inch' ? 1 : 4);
  w.add(9, '$MEASUREMENT'); w.add(70, 1);
  w.add(9, '$LUNITS'); w.add(70, 2);
  w.add(9, '$LUPREC'); w.add(70, 4);
  w.add(9, '$EXTMIN');
  w.add(10, fmt(ex.x)); w.add(20, fmt(ex.y)); w.add(30, '0.0');
  w.add(9, '$EXTMAX');
  w.add(10, fmt(ex.x + ex.w)); w.add(20, fmt(ex.y + ex.h)); w.add(30, '0.0');
  w.add(0, 'ENDSEC');

  // TABLES: слои
  const usedOps = new Set<Op>();
  for (const o of objs) {
    const layer = doc.layers.find((l) => l.id === o.layerId);
    if (layer) usedOps.add(layer.op);
  }
  if (!usedOps.size) usedOps.add('cut');

  w.add(0, 'SECTION'); w.add(2, 'TABLES');
  if (w.r2000) {
    w.add(0, 'TABLE'); w.add(2, 'LTYPE'); w.add(70, 1);
    w.add(0, 'LTYPE'); w.add(5, w.nextHandle()); w.add(100, 'AcDbSymbolTableRecord'); w.add(100, 'AcDbLinetypeTableRecord');
    w.add(2, 'CONTINUOUS'); w.add(70, 0); w.add(3, 'Solid line'); w.add(72, 65); w.add(73, 0); w.add(40, '0.0');
    w.add(0, 'ENDTAB');
  }
  w.add(0, 'TABLE'); w.add(2, 'LAYER'); w.add(70, usedOps.size);
  for (const op of usedOps) {
    const { name, aci } = LAYER_OF_OP[op];
    w.add(0, 'LAYER');
    if (w.r2000) {
      w.add(5, w.nextHandle());
      w.add(100, 'AcDbSymbolTableRecord');
      w.add(100, 'AcDbLayerTableRecord');
    }
    w.add(2, name);
    w.add(70, 0);
    w.add(62, aci);
    w.add(6, 'CONTINUOUS');
  }
  w.add(0, 'ENDTAB');
  w.add(0, 'ENDSEC');

  // ENTITIES
  w.add(0, 'SECTION'); w.add(2, 'ENTITIES');

  const draw = (obj: Obj): void => {
    const layer = layerOf.get(obj.layerId) ?? 'CUT';
    const world = transformSubPaths(obj.path, worldMatrix(obj, k));
    for (const sp of world) {
      const circle = asCircle(sp);
      if (circle) { writeCircle(w, layer, circle.center, circle.r); continue; }
      const verts = subPathToVertices(sp, tol);
      writePolyline(w, layer, verts, sp.closed);
    }
  };

  // порядок резки: сначала внутренние контуры (по площади), потом внешние
  const withArea = objs.map((o) => {
    const world = transformSubPaths(o.path, worldMatrix(o, k));
    const area = world.reduce((sum, sp) => sum + Math.abs(polyArea(flattenSubPaths([sp], 0.05)[0] ?? [])), 0);
    return { obj: o, area };
  });
  withArea.sort((a, b) => a.area - b.area || 0);

  for (const { obj } of withArea) draw(obj);

  w.add(0, 'ENDSEC');
  w.add(0, 'EOF');
  return w.toString();
}

/** Матрица объекта с пересчётом единиц (дюймы масштабируют мировые координаты). */
function worldMatrix(obj: Obj, k: number): import('../types').Mat2x3 {
  const t = obj.transform;
  if (k === 1) return t;
  return { a: t.a * k, b: t.b * k, c: t.c * k, d: t.d * k, e: t.e * k, f: t.f * k };
}

function polyArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return s / 2;
}

/** Статистика для UI: сколько сущностей уйдёт в файл. */
export function countDxfEntities(doc: Doc, sheetId: Id = doc.activeSheetId, onlyIds?: Id[]): number {
  const only = onlyIds ? new Set(onlyIds) : null;
  let n = 0;
  for (const id of doc.order) {
    const o = doc.objects[id];
    if (!o || o.sheetId !== sheetId || o.hidden) continue;
    if (only && !only.has(o.id)) continue;
    n += o.path.length;
  }
  return n;
}

/** Экспорт всех листов: возвращает массив [имя файла, содержимое]. */
export function exportDxfSheets(doc: Doc, opts: DxfExportOptions = {}): { name: string; text: string }[] {
  return doc.sheets.map((s, i) => ({
    name: `${slug(doc.meta.name || 'lasercut')}-${i + 1}-${slug(s.name)}.dxf`,
    text: exportDxf(doc, { ...opts, sheetId: s.id }),
  }));
}

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sheet';
