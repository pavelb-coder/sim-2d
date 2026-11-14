/** Пара «групп-код — значение» из DXF-файла. */
export interface Pair { code: number; value: string }

/** DXF — это поток пар строк: код (число) и значение. */
export function tokenize(text: string): Pair[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

export interface RawEntity {
  type: string;
  codes: Record<number, string[]>;
  /** Пары «код-значение» в исходном порядке — нужны там, где важен порядок (LWPOLYLINE, bulge). */
  pairs?: Pair[];
  /** вершины POLYLINE (старый формат R12) */
  vertices?: RawEntity[];
}

export interface ParsedDxf {
  header: Record<string, string[]>;
  layers: { name: string; color: number; flags: number }[];
  blocks: Record<string, { base: { x: number; y: number }; entities: RawEntity[] }>;
  entities: RawEntity[];
}

const ENTITY_TYPES = new Set([
  'LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE',
  'TEXT', 'MTEXT', 'INSERT', 'POINT', 'HATCH', 'DIMENSION', 'LEADER', 'SOLID',
  '3DFACE', 'XLINE', 'RAY', 'MULTILEADER', 'WIPEOUT', 'IMAGE',
]);

/** Разбор DXF в дерево: заголовок (переменные), слои, блоки, сущности. */
export function parseDxfText(text: string): ParsedDxf {
  const pairs = tokenize(text);
  const out: ParsedDxf = { header: {}, layers: [], blocks: {}, entities: [] };

  let section = '';
  let expectSectionName = false;
  let inBlock = false;
  let blockName: string | null = null;
  let current: RawEntity | null = null;
  let polyline: RawEntity | null = null;
  let lastVar: string | null = null;
  let currentIsVertex = false;

  const flush = (): void => {
    if (!current) return;
    if (!currentIsVertex) {
      if (inBlock && blockName && out.blocks[blockName]) out.blocks[blockName].entities.push(current);
      else if (section === 'ENTITIES') out.entities.push(current);
    }
    current = null;
    currentIsVertex = false;
  };

  for (const { code, value } of pairs) {
    const v = value.trim();

    if (code === 0) {
      flush();
      const kw = v.toUpperCase();
      if (kw === 'SECTION') { section = ''; expectSectionName = true; continue; }
      if (kw === 'ENDSEC') { section = ''; inBlock = false; blockName = null; polyline = null; continue; }
      if (kw === 'EOF') break;
      if (kw === 'TABLE' || kw === 'ENDTAB') continue;
      if (kw === 'LAYER') continue; // слои собираем отдельным проходом
      if (kw === 'BLOCK') { inBlock = true; blockName = null; continue; }
      if (kw === 'ENDBLK') { inBlock = false; blockName = null; continue; }
      if (kw === 'SEQEND') { polyline = null; continue; }
      if (ENTITY_TYPES.has(kw)) {
        const ent: RawEntity = { type: kw, codes: {}, pairs: [] };
        if (kw === 'VERTEX' && polyline) {
          (polyline.vertices ||= []).push(ent);
          current = ent;
          currentIsVertex = true;
        } else {
          current = ent;
          if (kw === 'POLYLINE') polyline = ent;
        }
        continue;
      }
      continue;
    }

    if (expectSectionName && code === 2) { section = v.toUpperCase(); expectSectionName = false; continue; }
    if (inBlock && blockName === null && code === 2) {
      blockName = v;
      out.blocks[blockName] = { base: { x: 0, y: 0 }, entities: [] };
      continue;
    }
    if (code === 9) { lastVar = v; out.header[lastVar] = []; continue; }
    if (section === 'HEADER' && lastVar && !current) { out.header[lastVar].push(v); continue; }
    if (!current) continue;
    (current.codes[code] ||= []).push(value);
    (current.pairs ||= []).push({ code, value });
  }
  flush();

  // Слои: всё между «0 LAYER» и следующим кодом 0
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value.trim().toUpperCase() === 'LAYER') {
      const codes: Record<number, string[]> = {};
      for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) {
        (codes[pairs[j].code] ||= []).push(pairs[j].value);
      }
      const name = (codes[2]?.[0] ?? '').trim();
      if (name && !out.layers.some((l) => l.name === name)) {
        out.layers.push({
          name,
          color: Number.parseInt(codes[62]?.[0] ?? '7', 10) || 7,
          flags: Number.parseInt(codes[70]?.[0] ?? '0', 10) || 0,
        });
      }
    }
  }
  return out;
}

export const num = (e: RawEntity, code: number, fallback = 0, index = 0): number => {
  const raw = e.codes[code]?.[index];
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const str = (e: RawEntity, code: number, fallback = '', index = 0): string =>
  (e.codes[code]?.[index] ?? fallback).trim();

export const nums = (e: RawEntity, code: number): number[] =>
  (e.codes[code] ?? []).map((x) => Number.parseFloat(x)).filter((n) => Number.isFinite(n));

/** ACI → hex (для популярных цветов; остальные — по палитре индексов). */
export function aciToHex(aci: number): string {
  const known: Record<number, string> = {
    1: '#e0413c', 2: '#d4a72c', 3: '#16a34a', 4: '#0e9aa7', 5: '#2f6df6', 6: '#c026d3',
    7: '#111827', 8: '#6b7280', 9: '#9ca3af', 30: '#f97316', 40: '#eab308', 140: '#2563eb',
  };
  return known[Math.abs(aci)] ?? '#e0413c';
}
