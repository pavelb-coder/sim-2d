/**
 * Цвет: перевод HSL (крутилки в палитре) в HEX и обратно.
 * Палитра и смеситель работают в HSL — так понятнее человеку, а документ
 * и SVG хранят привычный `#rrggbb`.
 */

export interface Hsl { h: number; s: number; l: number }

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** '#abc', 'abc', '#AABBCC' → '#aabbcc'; мусор → null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(raw)) return null;
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return `#${full.toLowerCase()}`;
}

const hex2 = (n: number): string => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

/** HSL → '#rrggbb'. h — градусы 0…360, s и l — проценты 0…100. */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `#${hex2((r + m) * 255)}${hex2((g + m) * 255)}${hex2((b + m) * 255)}`;
}

/** '#rrggbb' → HSL с полной точностью (для ползунков округляйте на месте). Некорректный цвет даёт {0,0,0}. */
export function hexToHsl(hex: string): Hsl {
  const norm = normalizeHex(hex);
  if (!norm) return { h: 0, s: 0, l: 0 };
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  // значения не округляем: иначе обратный перевод «съезжает» на пару единиц канала
  if (d < 1e-9) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: ((h % 360) + 360) % 360, s: s * 100, l: l * 100 };
}
