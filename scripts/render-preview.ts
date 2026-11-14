/**
 * Рендер документа в SVG (без браузера) — для визуальной проверки геометрии.
 * Запуск: npx esbuild scripts/render-preview.ts --bundle --platform=node --format=esm --outfile=scripts/_preview.mjs && node scripts/_preview.mjs
 */
import { writeFileSync } from 'node:fs';
import { demoDoc } from '../src/core/demo';
import { flattenSubPaths, worldBBox, boxUnion } from '../src/core/geom/path';
import { apply } from '../src/core/geom/transform';
import { rectPath } from '../src/core/shape';
import { IDENT } from '../src/core/geom/transform';
import type { Box, Doc, Obj } from '../src/core/types';

const doc: Doc = demoDoc();
const sheet = doc.sheets[0];
const scale = 3; // px на мм
const pad = 24;

function polyToD(pts: { x: number; y: number }[], closed: boolean): string {
  if (!pts.length) return '';
  const f = (p: { x: number; y: number }) => `${(p.x * scale + pad).toFixed(2)},${((sheet.height - p.y) * scale + pad).toFixed(2)}`;
  return `M${f(pts[0])} ${pts.slice(1).map((p) => `L${f(p)}`).join(' ')}${closed ? ' Z' : ''}`;
}

function objD(obj: Obj): string {
  return flattenSubPaths(obj.path, 0.02)
    .map((poly) => polyToD(poly.map((p) => apply(obj.transform, p)), true))
    .join(' ');
}

const W = sheet.width * scale + pad * 2;
const H = sheet.height * scale + pad * 2;

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
parts.push(`<rect width="100%" height="100%" fill="#e9eef5"/>`);
parts.push(`<rect x="${pad}" y="${pad}" width="${sheet.width * scale}" height="${sheet.height * scale}" fill="#fff" stroke="#c2ccdb"/>`);

// сетка 10 мм
const grid: string[] = [];
for (let x = 0; x <= sheet.width; x += 10) grid.push(`M${x * scale + pad},${pad} V${sheet.height * scale + pad}`);
for (let y = 0; y <= sheet.height; y += 10) grid.push(`M${pad},${(sheet.height - y) * scale + pad} H${sheet.width * scale + pad}`);
parts.push(`<path d="${grid.join(' ')}" stroke="#e6ecf4" stroke-width="1" fill="none"/>`);

// объекты
for (const id of doc.order) {
  const obj = doc.objects[id];
  const color = obj.layerId === doc.layers[0].id ? '#e0413c' : '#2f6df6';
  parts.push(`<path d="${objD(obj)}" fill="none" stroke="${color}" stroke-width="${Math.max(1.6, obj.style.strokeWidth * scale)}"/>`);
}

// bbox каждого объекта (проверка точности границ)
let union: Box | null = null;
for (const id of doc.order) {
  const obj = doc.objects[id];
  const b = worldBBox(obj.path, obj.transform);
  union = boxUnion(union, b);
  parts.push(`<rect x="${b.x * scale + pad}" y="${(sheet.height - b.y - b.h) * scale + pad}" width="${b.w * scale}" height="${b.h * scale}" fill="none" stroke="#0ea5e9" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.75"/>`);
}
if (union) {
  parts.push(`<rect x="${union.x * scale + pad}" y="${(sheet.height - union.y - union.h) * scale + pad}" width="${union.w * scale}" height="${union.h * scale}" fill="none" stroke="#f59e0b" stroke-width="1.4"/>`);
}

// проверка: прямоугольник, повёрнутый на 30° — bbox должен быть косым, но точным
const rotated = { ...IDENT, a: Math.cos(Math.PI / 6), b: Math.sin(Math.PI / 6), c: -Math.sin(Math.PI / 6), d: Math.cos(Math.PI / 6), e: 78, f: 100 };
const rb = worldBBox(rectPath(60, 30), rotated);
parts.push(`<path d="${flattenSubPaths(rectPath(60, 30), 0.02).map((p) => polyToD(p.map((q) => apply(rotated, q)), true)).join(' ')}" fill="none" stroke="#16a34a" stroke-width="1.6" stroke-dasharray="6 3"/>`);
parts.push(`<rect x="${rb.x * scale + pad}" y="${(sheet.height - rb.y - rb.h) * scale + pad}" width="${rb.w * scale}" height="${rb.h * scale}" fill="none" stroke="#16a34a" stroke-width="0.8" opacity="0.6"/>`);

parts.push('</svg>');
writeFileSync('scripts/preview.svg', parts.join('\n'));
console.log('scripts/preview.svg', `${W.toFixed(0)}×${H.toFixed(0)}`, 'rotated bbox:', JSON.stringify(rb, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
