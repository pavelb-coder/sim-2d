import type { Box, Doc, Id, Sheet, Vec2 } from '../core/types';
import { bboxOfSubPaths, boxUnion, worldBBox } from '../core/geom/path';
import type { SnapResult } from '../core/snap';
import { theme } from './theme';
import { View } from './view';
import { drawObject } from './scene';

export interface OverlayInput {
  doc: Doc;
  sheet: Sheet;
  view: View;
  dpr: number;
  selection: Id[];
  marquee: Box | null;
  snap: SnapResult | null;
  drawExtra: ((ctx: CanvasRenderingContext2D, view: View, dpr: number) => void) | null;
}

const HANDLE = 7;

export function renderOverlay(ctx: CanvasRenderingContext2D, input: OverlayInput): void {
  const { doc, view, dpr, selection } = input;
  // очистка всего буфера в device-пикселях — иначе на HiDPI остаются следы
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // контуры выбранных объектов
  for (const id of selection) {
    const obj = doc.objects[id];
    if (!obj) continue;
    drawObject(ctx, obj, view, dpr, { color: theme.accentLine, widthPx: 1.6, dash: [5, 4] });
  }

  // общий bbox + ручки
  if (selection.length) {
    let box: Box | null = null;
    for (const id of selection) {
      const obj = doc.objects[id];
      if (!obj) continue;
      box = boxUnion(box, worldBBox(obj.path, obj.transform));
    }
    if (box) drawBBox(ctx, box, view, dpr, selection.length === 1);
  }

  // рамка выделения
  if (input.marquee) {
    const { marquee } = input;
    const a = view.toScreen({ x: marquee.x, y: marquee.y });
    const b = view.toScreen({ x: marquee.x + marquee.w, y: marquee.y + marquee.h });
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.accentSoft;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }

  // точка привязки
  if (input.snap) drawSnap(ctx, input.snap, view, dpr);

  if (input.drawExtra) input.drawExtra(ctx, view, dpr);
}

function drawBBox(ctx: CanvasRenderingContext2D, box: Box, view: View, dpr: number, withHandles: boolean): void {
  const a = view.toScreen({ x: box.x, y: box.y });
  const b = view.toScreen({ x: box.x + box.w, y: box.y + box.h });
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = theme.accentLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  ctx.setLineDash([]);

  if (!withHandles) return;
  const pts: Vec2[] = [
    { x, y }, { x: x + w / 2, y }, { x: x + w, y },
    { x, y: y + h / 2 }, { x: x + w, y: y + h / 2 },
    { x, y: y + h }, { x: x + w / 2, y: y + h }, { x: x + w, y: y + h },
  ];
  ctx.fillStyle = theme.handleFill;
  ctx.strokeStyle = theme.handleStroke;
  ctx.lineWidth = 1.4;
  for (const p of pts) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE, 1.5);
    else ctx.rect(p.x - HANDLE / 2, p.y - HANDLE / 2, HANDLE, HANDLE);
    ctx.fill();
    ctx.stroke();
  }
}

function drawSnap(ctx: CanvasRenderingContext2D, snap: SnapResult, view: View, dpr: number): void {
  const p = view.toScreen(snap.point);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = theme.snap;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (snap.kind === 'center') {
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  } else {
    ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y);
  ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8);
  ctx.stroke();
}

/** bbox для внешнего кода (панель свойств). */
export function selectionBBox(doc: Doc, selection: Id[]): Box | null {
  let box: Box | null = null;
  for (const id of selection) {
    const obj = doc.objects[id];
    if (!obj) continue;
    box = boxUnion(box, worldBBox(obj.path, obj.transform));
  }
  return box;
}

export const localBBox = bboxOfSubPaths;
