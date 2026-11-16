import { hexToHsl, hslToHex, normalizeHex, type Hsl } from '../core/color';

/**
 * Блок «Цвет» как палитра CorelDRAW: образцы в сетке, клик — заливка,
 * правый клик или Shift+клик — обводка, крестик — убрать заливку.
 * Ниже — смеситель HSL с полем HEX: удобно подобрать свой цвет.
 */

export interface PaletteColor { color: string; name: string }

const HUES: [string, string][] = [
  ['#e53935', 'Красный'], ['#fb8c00', 'Оранжевый'], ['#fdd835', 'Жёлтый'], ['#c0ca33', 'Салатовый'],
  ['#43a047', 'Зелёный'], ['#00897b', 'Бирюзовый'], ['#00acc1', 'Голубой'], ['#1e88e5', 'Синий'],
  ['#8e24aa', 'Фиолетовый'], ['#d81b60', 'Розовый'],
];

const DARK: string[] = [
  '#b71c1c', '#e65100', '#f9a825', '#9e9d24', '#2e7d32',
  '#00695c', '#00838f', '#1565c0', '#6a1b9a', '#ad1457',
];

const LIGHT: string[] = [
  '#ef9a9a', '#ffcc80', '#fff59d', '#e6ee9c', '#a5d6a7',
  '#80cbc4', '#80deea', '#90caf9', '#ce93d8', '#f48fb1',
];

const GRAYS: [string, string][] = [
  ['#000000', 'Чёрный'], ['#404040', 'Тёмно-серый'], ['#808080', 'Серый'],
  ['#bfbfbf', 'Светло-серый'], ['#ffffff', 'Белый'],
];

/** Палитра: 5 серых + 10 основных + 10 тёмных + 10 светлых = 35 образцов (+ «нет цвета»). */
export const PALETTE: PaletteColor[] = [
  ...GRAYS.map(([color, name]) => ({ color, name })),
  ...HUES.map(([color, name]) => ({ color, name })),
  ...DARK.map((color, i) => ({ color, name: `${HUES[i][1]} тёмный` })),
  ...LIGHT.map((color, i) => ({ color, name: `${HUES[i][1]} светлый` })),
];

export type ColorTarget = 'fill' | 'stroke';

export interface PaletteHost {
  /** применить цвет к выделению ('fill' | 'stroke'); null — убрать заливку */
  apply(color: string | null, target: ColorTarget): void;
  /** текущие цвета выделения (null — ничего не выделено) */
  current(): { fill: string | null; stroke: string } | null;
}

export interface PaletteHandle {
  /** подсветить текущие цвета и подставить их в смеситель */
  refresh(): void;
}

export function initPalette(host: PaletteHost): PaletteHandle {
  const grid = document.getElementById('palette');
  const ccFill = document.getElementById('cc-fill');
  const ccStroke = document.getElementById('cc-stroke');
  const hue = document.getElementById('mix-h') as HTMLInputElement | null;
  const sat = document.getElementById('mix-s') as HTMLInputElement | null;
  const lig = document.getElementById('mix-l') as HTMLInputElement | null;
  const preview = document.getElementById('mix-preview');
  const hexInput = document.getElementById('mix-hex') as HTMLInputElement | null;

  let mix: Hsl = { h: 210, s: 70, l: 60 };
  let mixTarget: ColorTarget = 'fill';

  const applyMix = (): void => {
    const hex = hslToHex(mix.h, mix.s, mix.l);
    if (preview) preview.style.background = hex;
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;
  };

  /** Ползунки показывают целые значения, внутри точность сохраняется. */
  const showMix = (): void => {
    if (hue) hue.value = String(Math.round(mix.h));
    if (sat) sat.value = String(Math.round(mix.s));
    if (lig) lig.value = String(Math.round(mix.l));
  };

  const pushMix = (): void => {
    applyMix();
    host.apply(hslToHex(mix.h, mix.s, mix.l), mixTarget);
    markActive(hslToHex(mix.h, mix.s, mix.l));
  };

  if (grid) {
    grid.innerHTML = '';
    // «нет цвета» — как крестик в палитре CorelDRAW
    const none = document.createElement('button');
    none.className = 'sw sw-none';
    none.dataset.color = '';
    none.title = 'Без заливки';
    none.setAttribute('aria-label', 'Без заливки');
    grid.appendChild(none);

    for (const { color, name } of PALETTE) {
      const btn = document.createElement('button');
      btn.className = 'sw';
      btn.dataset.color = color;
      btn.style.background = color;
      btn.title = `${name} · ${color.toUpperCase()}`;
      btn.setAttribute('aria-label', `${name} ${color}`);
      grid.appendChild(btn);
    }

    grid.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sw');
      if (!btn) return;
      const color = btn.dataset.color || null;
      const target: ColorTarget = (e as MouseEvent).shiftKey ? 'stroke' : 'fill';
      host.apply(target === 'stroke' ? color ?? '#000000' : color, target);
      if (color) {
        mix = hexToHsl(color);
        showMix();
        applyMix();
      }
      markActive(color);
    });

    // правый клик — цвет обводки, как в CorelDRAW
    grid.addEventListener('contextmenu', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.sw');
      if (!btn) return;
      e.preventDefault();
      const color = btn.dataset.color || '#000000';
      host.apply(color, 'stroke');
      markActive(color);
    });
  }

  /** подсветка выбранного образца рамкой */
  function markActive(color: string | null): void {
    if (!grid) return;
    for (const btn of grid.querySelectorAll<HTMLButtonElement>('.sw')) {
      btn.classList.toggle('is-active', (btn.dataset.color || null) === color);
    }
  }

  const onSlider = (): void => {
    mix = {
      h: Number(hue?.value ?? 210),
      s: Number(sat?.value ?? 70),
      l: Number(lig?.value ?? 60),
    };
    pushMix();
  };
  for (const el of [hue, sat, lig]) el?.addEventListener('input', onSlider);

  hexInput?.addEventListener('change', () => {
    const norm = normalizeHex(hexInput.value);
    if (!norm) {
      hexInput.value = hslToHex(mix.h, mix.s, mix.l);
      return;
    }
    mix = hexToHsl(norm);
    showMix();
    applyMix();
    host.apply(norm, mixTarget);
    markActive(norm);
  });

  const targetButtons: [string, ColorTarget][] = [['mix-to-fill', 'fill'], ['mix-to-stroke', 'stroke']];
  for (const [id, target] of targetButtons) {
    document.getElementById(id)?.addEventListener('click', () => {
      mixTarget = target;
      for (const [otherId, otherTarget] of targetButtons) {
        document.getElementById(otherId)?.classList.toggle('is-active', otherTarget === target);
      }
      host.apply(hslToHex(mix.h, mix.s, mix.l), target);
      markActive(hslToHex(mix.h, mix.s, mix.l));
    });
  }
  document.getElementById('mix-to-fill')?.classList.add('is-active');

  function refresh(): void {
    const cur = host.current();
    if (ccFill) ccFill.style.background = cur?.fill ?? 'transparent';
    if (ccStroke) ccStroke.style.background = cur?.stroke ?? 'transparent';
    markActive(cur?.fill ?? null);
    if (cur?.fill) {
      mix = hexToHsl(cur.fill);
      showMix();
      applyMix();
    }
  }

  applyMix();
  refresh();
  return { refresh };
}
