import type { Doc, Id, Obj, Sheet } from '../core/types';
import { compose } from '../core/geom/transform';
import { theme } from './theme';
import { View } from './view';
import { setMatrix, toPath2D } from './path2d';

const SERIES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

export function pickGridStep(base: number, scale: number, minPx = 9): number {
  const candidates = SERIES.filter((s) => s >= base - 1e-9);
  for (const s of candidates) if (s * scale >= minPx) return s;
  return candidates[candidates.length - 1] ?? base;
}

function drawGrid(ctx: CanvasRenderingContext2D, sheet: Sheet, view: View, dpr: number): void {
  const step = pickGridStep(sheet.gridStep, view.scale);
  const vis = view.visibleBox();
  const x0 = Math.max(0, Math.floor(vis.x / step) * step);
  const x1 = Math.min(sheet.width, vis.x + vis.w);
  const y0 = Math.max(0, Math.floor(vis.y / step) * step);
  const y1 = Math.min(sheet.height, vis.y + vis.h);
  if (x1 <= x0 || y1 <= y0) return;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = view.matrix();
  setMatrix(ctx, m, dpr);
  ctx.lineWidth = 1 / view.scale;

  // мелкая сетка
  ctx.beginPath();
  ctx.strokeStyle = theme.gridMinor;
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    if (Math.abs(Math.round(x / step) % 5) === 0) continue;
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    if (Math.abs(Math.round(y / step) % 5) === 0) continue;
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
  }
  ctx.stroke();

  // крупная сетка
  ctx.beginPath();
  ctx.strokeStyle = theme.gridMajor;
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    if (Math.abs(Math.round(x / step) % 5) !== 0) continue;
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    if (Math.abs(Math.round(y / step) % 5) !== 0) continue;
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
  }
  ctx.stroke();

  // оси листа
  ctx.beginPath();
  ctx.strokeStyle = theme.axis;
  ctx.moveTo(0, 0); ctx.lineTo(0, sheet.height);
  ctx.moveTo(0, 0); ctx.lineTo(sheet.width, 0);
  ctx.stroke();
  ctx.restore();
}

export function drawSheet(ctx: CanvasRenderingContext2D, sheet: Sheet, view: View, dpr: number): void {
  const m = view.matrix();
  ctx.save();
  setMatrix(ctx, m, dpr);
  // тень
  ctx.fillStyle = theme.sheetShadow;
  ctx.fillRect(2 / view.scale, -2 / view.scale, sheet.width, sheet.height);
  ctx.fillStyle = theme.sheet;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeStyle = theme.sheetBorder;
  ctx.strokeRect(0, 0, sheet.width, sheet.height);
  ctx.restore();
}

export function drawObject(ctx: CanvasRenderingContext2D, obj: Obj, view: View, dpr: number, override?: { color?: string; widthPx?: number; dash?: number[] }): void {
  const m = compose(view.matrix(), obj.transform);
  ctx.save();
  setMatrix(ctx, m, dpr);
  const p = toPath2D(obj.path);
  if (obj.style.fill && !override) {
    ctx.globalAlpha = obj.style.opacity;
    ctx.fillStyle = obj.style.fill;
    ctx.fill(p);
    ctx.globalAlpha = 1;
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = override?.widthPx ? override.widthPx / view.scale : Math.max(obj.style.strokeWidth, 1.15 / view.scale);
  ctx.strokeStyle = override?.color ?? obj.style.stroke;
  if (override?.dash) ctx.setLineDash(override.dash.map((d) => d / view.scale));
  ctx.stroke(p);
  ctx.restore();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  sheet: Sheet,
  view: View,
  dpr: number,
  hoverId: Id | null,
  previewObj: Obj | null,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, view.width, view.height);

  drawSheet(ctx, sheet, view, dpr);
  if (sheet.showGrid) drawGrid(ctx, sheet, view, dpr);

  const layerOk = new Map(doc.layers.map((l) => [l.id, l.visible]));

  for (const id of doc.order) {
    const obj = doc.objects[id];
    if (!obj || obj.sheetId !== sheet.id || obj.hidden) continue;
    if (layerOk.get(obj.layerId) === false) continue;
    drawObject(ctx, obj, view, dpr);
  }

  if (hoverId && doc.objects[hoverId] && doc.objects[hoverId].sheetId === sheet.id) {
    drawObject(ctx, doc.objects[hoverId], view, dpr, { color: theme.hover, widthPx: 2 });
  }
  if (previewObj) drawObject(ctx, previewObj, view, dpr);
}

