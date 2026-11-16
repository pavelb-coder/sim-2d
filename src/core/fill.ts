import type { Box, Style } from './types';
import { boxCenter } from './geom/path';

/**
 * Заливка объекта в стиле CorelDRAW: сплошная, линейный и радиальный градиент.
 * Цвета — только для экрана и SVG: на резку заливка не влияет (DXF её не знает),
 * поэтому градиент никогда не попадает в контур.
 */

export type FillType = 'solid' | 'linear' | 'radial';

export const FILL_TYPES: FillType[] = ['solid', 'linear', 'radial'];

/** Тип заливки объекта; null — заливки нет. */
export function fillTypeOf(style: Style): FillType | null {
  if (!style.fill) return null;
  return style.fillType ?? 'solid';
}

/** Второй цвет градиента (по умолчанию — белый). */
export const secondColorOf = (style: Style): string => style.fill2 ?? '#ffffff';

/** Угол градиента в градусах, 0 — слева направо. */
export const angleOf = (style: Style): number => style.fillAngle ?? 0;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Осевая линия линейного градиента, вписанная в габарит объекта.
 * Угол отсчитывается от оси X против часовой стрелки (ось Y документа — вверх).
 */
export function gradientLine(box: Box, angleDeg: number): { x0: number; y0: number; x1: number; y1: number } {
  const c = boxCenter(box);
  const a = rad(angleDeg);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // половина проекции прямоугольника на направление градиента
  const half = (Math.abs(dx) * box.w + Math.abs(dy) * box.h) / 2;
  return { x0: c.x - dx * half, y0: c.y - dy * half, x1: c.x + dx * half, y1: c.y + dy * half };
}

/** Радиус радиального градиента — половина диагонали габарита. */
export function gradientRadius(box: Box): number {
  return Math.hypot(box.w, box.h) / 2;
}

/** Центр радиального градиента. */
export const gradientCenter = (box: Box): { x: number; y: number } => boxCenter(box);
