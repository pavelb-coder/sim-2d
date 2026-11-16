import type { Box, Doc, Id, Sheet } from '../core/types';
import { bboxOfSubPaths, boxUnion, worldBBox } from '../core/geom/path';
import type { SnapResult } from '../core/snap';
import type { AlignLine } from '../core/smart';
import { theme } from './theme';
import { HANDLE_SIZE, handlePoints } from './handles';
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
  align: AlignLine[];
  drawExtra: ((ctx: CanvasRenderingContext2D, view: View, dpr: number) => void) | null;
}

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
    if (box) drawBBox(ctx, box, view, dpr);
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

  // линии умного выравнивания
  if (input.align.length) drawAlign(ctx, input.align, view, dpr);

  // точка привязки
  if (input.snap) drawSnap(ctx, input.snap, view, dpr);

  if (input.drawExtra) input.drawExtra(ctx, view, dpr);
}

function drawBBox(ctx: CanvasRenderingContext2D, box: Box, view: View, dpr: number): void {
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

  // Все ручки живые: 8 по рамке (масштаб) и одна над верхней гранью (поворот).
  const points = handlePoints(box, view);
  const rot = points.find((p) => p.id === 'rotate');
  if (rot) {
    ctx.strokeStyle = theme.accentLine;
    ctx.beginPath();
    ctx.moveTo(points.find((p) => p.id === 'n')?.screen.x ?? x + w / 2, y);
    ctx.lineTo(rot.screen.x, rot.screen.y + HANDLE_SIZE / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rot.screen.x, rot.screen.y, HANDLE_SIZE / 2 + 0.5, 0, Math.PI * 2);
    ctx.fillStyle = theme.handleFill;
    ctx.fill();
    ctx.strokeStyle = theme.handleStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ctx.fillStyle = theme.handleFill;
  ctx.strokeStyle = theme.handleStroke;
  ctx.lineWidth = 1.4;
  for (const p of points) {
    if (p.id === 'rotate') continue;
    const hx = p.screen.x - HANDLE_SIZE / 2, hy = p.screen.y - HANDLE_SIZE / 2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(hx, hy, HANDLE_SIZE, HANDLE_SIZE, 1.5);
    else ctx.rect(hx, hy, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  }
}

function drawAlign(ctx: CanvasRenderingContext2D, lines: AlignLine[], view: View, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1;
  for (const line of lines) {
    const gap = line.kind === 'gap';
    ctx.strokeStyle = gap ? theme.spacing : theme.align;
    ctx.setLineDash(gap ? [] : [5, 4]);
    ctx.beginPath();
    if (line.axis === 'x') {
      const a = view.toScreen({ x: line.at, y: line.from });
      const b = view.toScreen({ x: line.at, y: line.to });
      ctx.moveTo(Math.round(a.x) + 0.5, a.y);
      ctx.lineTo(Math.round(b.x) + 0.5, b.y);
    } else {
      const a = view.toScreen({ x: line.from, y: line.at });
      const b = view.toScreen({ x: line.to, y: line.at });
      ctx.moveTo(a.x, Math.round(a.y) + 0.5);
      ctx.lineTo(b.x, Math.round(b.y) + 0.5);
    }
    ctx.stroke();
    // засечки на концах «интервала» — видно, между чем измерено расстояние
    if (gap) {
      const tick = 6;
      const a = line.axis === 'x'
        ? view.toScreen({ x: line.at, y: line.from })
        : view.toScreen({ x: line.from, y: line.at });
      const b = line.axis === 'x'
        ? view.toScreen({ x: line.at, y: line.to })
        : view.toScreen({ x: line.to, y: line.at });
      ctx.beginPath();
      if (line.axis === 'x') {
        ctx.moveTo(a.x - tick / 2, a.y); ctx.lineTo(a.x + tick / 2, a.y);
        ctx.moveTo(b.x - tick / 2, b.y); ctx.lineTo(b.x + tick / 2, b.y);
      } else {
        ctx.moveTo(a.x, a.y - tick / 2); ctx.lineTo(a.x, a.y + tick / 2);
        ctx.moveTo(b.x, b.y - tick / 2); ctx.lineTo(b.x, b.y + tick / 2);
      }
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
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
