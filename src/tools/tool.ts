import type { Box, Vec2 } from '../core/types';
import type { SnapResult } from '../core/snap';
import type { AlignLine } from '../core/smart';
import type { Store, ToolId } from '../state/store';
import type { View } from '../render/view';

export interface ToolCtx {
  store: Store;
  view: View;
  /** Поиск привязки в точке (мм). */
  snapAt(p: Vec2, exclude?: Set<string>): SnapResult | null;
  /** Перерисовать (по умолчанию — слой оверлея). */
  render(kind?: 'scene' | 'overlay' | 'both'): void;
  setCursor(cursor: string): void;
  /** Показать координаты/подсказку в статус-баре. */
  setStatus(text: string | null): void;
}

export interface ToolOverlay {
  marquee: Box | null;
  snap: SnapResult | null;
  /** линии умного выравнивания (как Dynamic guides в CorelDRAW) */
  align: AlignLine[];
  draw: ((ctx: CanvasRenderingContext2D, view: View, dpr: number) => void) | null;
}

export interface Tool {
  id: ToolId;
  cursor: string;
  down(p: Vec2, ev: PointerEvent, c: ToolCtx): void;
  move(p: Vec2, ev: PointerEvent, c: ToolCtx): void;
  up(p: Vec2, ev: PointerEvent, c: ToolCtx): void;
  cancel(c: ToolCtx): void;
  overlay(): ToolOverlay;
}

export const emptyOverlay = (): ToolOverlay => ({ marquee: null, snap: null, align: [], draw: null });
