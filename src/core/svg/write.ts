import type { Doc, Id, SubPath, Vec2 } from '../types';
import { activeSheet } from '../doc';
import { transformSubPaths } from '../geom/path';

export interface SvgExportOptions {
  sheetId?: Id;
  /** рисовать лист (рамку) в файле */
  includeSheet?: boolean;
  tolerance?: number;
}

const f = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : String(+n.toFixed(4)));

function subPathToD(sp: SubPath): string {
  if (!sp.segs.length) return '';
  const parts: string[] = [`M ${f(sp.start.x)} ${f(sp.start.y)}`];
  for (const s of sp.segs) {
    if (s.t === 'l') parts.push(`L ${f(s.b.x)} ${f(s.b.y)}`);
    else if (s.t === 'c') parts.push(`C ${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.b.x)} ${f(s.b.y)}`);
    else {
      const large = Math.abs(s.sweep) > Math.PI ? 1 : 0;
      const sweep = s.sweep > 0 ? 1 : 0;
      parts.push(`A ${f(s.r)} ${f(s.r)} 0 ${large} ${sweep} ${f(s.b.x)} ${f(s.b.y)}`);
    }
  }
  if (sp.closed) parts.push('Z');
  return parts.join(' ');
}

/** Документ → SVG в миллиметрах (ось Y переворачивается группой, геометрия остаётся «как в CAD»). */
export function exportSvg(doc: Doc, opts: SvgExportOptions = {}): string {
  const sheetId = opts.sheetId ?? doc.activeSheetId;
  const sheet = activeSheet(doc);
  const layerColor = new Map(doc.layers.map((l) => [l.id, l]));

  const body: string[] = [];
  for (const id of doc.order) {
    const obj = doc.objects[id];
    if (!obj || obj.sheetId !== sheetId || obj.hidden) continue;
    const layer = layerColor.get(obj.layerId);
    if (layer && !layer.visible) continue;
    const stroke = layer ? layer.color : '#000000';
    const world: SubPath[] = transformSubPaths(obj.path, obj.transform);
    const d = world.map(subPathToD).filter(Boolean).join(' ');
    if (!d) continue;
    const fill = obj.style.fill ?? 'none';
    body.push(`  <path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="0.1" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  const frame = opts.includeSheet
    ? `  <rect x="0" y="0" width="${f(sheet.width)}" height="${f(sheet.height)}" fill="none" stroke="#c2ccdb" stroke-width="0.1"/>\n`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(sheet.width)}mm" height="${f(sheet.height)}mm" viewBox="0 0 ${f(sheet.width)} ${f(sheet.height)}">`,
    `  <g transform="translate(0 ${f(sheet.height)}) scale(1 -1)">`,
    frame + body.join('\n'),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

export function svgPointsToPath(pts: Vec2[], closed: boolean): SubPath | null {
  if (pts.length < 2) return null;
  const segs = pts.slice(1).map((p, i) => ({ t: 'l' as const, a: pts[i], b: p }));
  if (closed) segs.push({ t: 'l', a: pts[pts.length - 1], b: pts[0] });
  return { closed, start: pts[0], segs };
}
