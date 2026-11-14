import type { Box, Mat2x3, Vec2 } from '../core/types';
import { clamp } from '../core/geom/vec';

/**
 * Преобразование «миллиметры → экранные пиксели» с инверсией оси Y.
 * screen.x = mm.x * scale + tx
 * screen.y = -mm.y * scale + ty
 */
export class View {
  scale = 1;
  tx = 0;
  ty = 0;
  width = 0;
  height = 0;

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }

  toScreen(p: Vec2): Vec2 {
    return { x: p.x * this.scale + this.tx, y: -p.y * this.scale + this.ty };
  }

  toMm(p: Vec2): Vec2 {
    return { x: (p.x - this.tx) / this.scale, y: (this.ty - p.y) / this.scale };
  }

  /** Матрица вида для Canvas (в CSS-пикселях). */
  matrix(): Mat2x3 {
    return { a: this.scale, b: 0, c: 0, d: -this.scale, e: this.tx, f: this.ty };
  }

  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toMm(screen);
    const next = clamp(this.scale * factor, 0.02, 600);
    if (next === this.scale) return;
    this.scale = next;
    this.tx = screen.x - before.x * this.scale;
    this.ty = screen.y + before.y * this.scale;
  }

  zoomCenter(factor: number): void {
    this.zoomAt({ x: this.width / 2, y: this.height / 2 }, factor);
  }

  panBy(dxPx: number, dyPx: number): void {
    this.tx += dxPx;
    this.ty += dyPx;
  }

  /** Вписать прямоугольник в экран. */
  fit(box: Box, paddingPx = 48): void {
    const w = Math.max(box.w, 1e-6);
    const h = Math.max(box.h, 1e-6);
    const availW = Math.max(this.width - paddingPx * 2, 40);
    const availH = Math.max(this.height - paddingPx * 2, 40);
    this.scale = clamp(Math.min(availW / w, availH / h), 0.02, 600);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    this.tx = this.width / 2 - cx * this.scale;
    this.ty = this.height / 2 + cy * this.scale;
  }

  /** Видимая область в миллиметрах. */
  visibleBox(): Box {
    const a = this.toMm({ x: 0, y: 0 });
    const b = this.toMm({ x: this.width, y: this.height });
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  /** Перевод экранного допуска (px) в миллиметры. */
  px(tolerancePx: number): number {
    return tolerancePx / this.scale;
  }
}
