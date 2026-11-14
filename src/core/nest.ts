import type { Id } from './types';

export interface NestItem {
  id: Id;
  w: number;
  h: number;
}

export interface NestOptions {
  /** Отступ от края листа, мм. */
  margin: number;
  /** Зазор между деталями, мм. */
  gap: number;
  /** Разрешить поворот детали на 90°, если так она влезает плотнее. */
  allowRotate: boolean;
}

export interface NestPlacement {
  id: Id;
  /** Левый верхний угол нового положения, мм. */
  x: number;
  y: number;
  rotated: boolean;
}

export interface NestResult {
  placements: NestPlacement[];
  unplaced: Id[];
  /** Заполнение полезной площади, 0…1. */
  fill: number;
}

/**
 * Полочная (shelf) раскладка: детали сортируются по высоте и укладываются
 * рядами слева направо. Быстро, предсказуемо и достаточно плотно для
 * раскроя фанеры, где детали обычно прямоугольные по габариту.
 */
export function nestObjects(items: NestItem[], sheetW: number, sheetH: number, opts: NestOptions): NestResult {
  const margin = Math.max(0, opts.margin);
  const gap = Math.max(0, opts.gap);
  const usableW = sheetW - margin * 2;
  const usableH = sheetH - margin * 2;
  const placements: NestPlacement[] = [];
  const unplaced: Id[] = [];
  let usedArea = 0;

  const queue = [...items].sort((a, b) => b.h - a.h || b.w - a.w);

  let rowY = 0;
  let rowH = 0;
  let cursorX = 0;

  for (const item of queue) {
    const fitsW = item.w <= usableW;
    const fitsH = item.h <= usableH;
    if (!fitsW && !fitsH && !(opts.allowRotate && item.h <= usableW && item.w <= usableH)) {
      unplaced.push(item.id);
      continue;
    }

    // ориентация: по умолчанию как есть, при allowRotate — та, что ниже
    const canRotate = opts.allowRotate && item.h <= usableW && item.w <= usableH;
    let w = item.w;
    let h = item.h;
    let rotated = false;
    if (canRotate && item.h > item.w) {
      w = item.h; h = item.w; rotated = true;
    }

    const needNewRow = cursorX > 0 && cursorX + w > usableW;
    if (needNewRow) {
      rowY += rowH + gap;
      rowH = 0;
      cursorX = 0;
    }
    // если деталь выше оставшегося места — пробуем другую ориентацию
    if (rowY + h > usableH && canRotate) {
      const altW = h, altH = w;
      if (rowY + altH <= usableH && (cursorX === 0 || cursorX + altW > usableW ? altW <= usableW : true)) {
        w = altW; h = altH; rotated = !rotated;
        if (cursorX > 0 && cursorX + w > usableW) {
          rowY += rowH + gap;
          rowH = 0;
          cursorX = 0;
        }
      }
    }
    if (rowY + h > usableH || w > usableW) {
      unplaced.push(item.id);
      continue;
    }
    if (cursorX > 0 && cursorX + w > usableW) {
      rowY += rowH + gap;
      rowH = 0;
      cursorX = 0;
      if (rowY + h > usableH) { unplaced.push(item.id); continue; }
    }

    placements.push({ id: item.id, x: margin + cursorX, y: margin + rowY, rotated });
    usedArea += item.w * item.h;
    cursorX += w + gap;
    rowH = Math.max(rowH, h);
  }

  const total = Math.max(1, usableW * usableH);
  return { placements, unplaced, fill: Math.min(1, usedArea / total) };
}
