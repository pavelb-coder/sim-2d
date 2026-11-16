import type { Material, Mm, SubPath } from '../types';
import { offsetPaths, unionPaths } from './boolean';

/**
 * Компенсация реза (kerf).
 *
 * Лазер вырезает канавку шириной kerf: деталь получается меньше на kerf/2
 * с каждого края, а отверстия — больше на kerf/2. Чтобы после резки деталь
 * совпала с чертежом, внешний контур расширяют на kerf/2, а внутренние
 * (отверстия) сжимают на ту же величину — то есть смещают *область* детали
 * наружу на kerf/2. Ровно это и делает Clipper, если передать ему контуры
 * с согласованным направлением обхода, поэтому сначала выполняется union.
 */

/** Пресет материала: имя, толщина и типичный рез для школьного лазера. */
export interface MaterialPreset {
  id: string;
  name: string;
  thickness: Mm;
  kerf: Mm;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'plywood-3', name: 'Фанера 3 мм', thickness: 3, kerf: 0.12 },
  { id: 'plywood-4', name: 'Фанера 4 мм', thickness: 4, kerf: 0.15 },
  { id: 'plywood-6', name: 'Фанера 6 мм', thickness: 6, kerf: 0.18 },
  { id: 'plywood-9', name: 'Фанера 9 мм', thickness: 9, kerf: 0.2 },
  { id: 'mdf-3', name: 'МДФ 3 мм', thickness: 3, kerf: 0.1 },
  { id: 'mdf-6', name: 'МДФ 6 мм', thickness: 6, kerf: 0.15 },
  { id: 'acrylic-3', name: 'Акрил 3 мм', thickness: 3, kerf: 0.1 },
  { id: 'acrylic-5', name: 'Акрил 5 мм', thickness: 5, kerf: 0.15 },
  { id: 'petg-2', name: 'ПЭТ 2 мм', thickness: 2, kerf: 0.08 },
  { id: 'custom', name: 'Свой материал', thickness: 3, kerf: 0.15 },
];

export const DEFAULT_MATERIAL_ID = 'plywood-3';

export const presetById = (id: string): MaterialPreset | undefined => MATERIAL_PRESETS.find((p) => p.id === id);

export function defaultMaterial(): Material {
  const p = presetById(DEFAULT_MATERIAL_ID) ?? MATERIAL_PRESETS[0];
  return { presetId: p.id, name: p.name, thickness: p.thickness, kerf: p.kerf, compensate: false };
}

/** Материал документа с подстановкой значений по умолчанию (старые .lcx). */
export function materialOf(doc: { material?: Material }): Material {
  const m = doc.material;
  if (!m) return defaultMaterial();
  return {
    presetId: m.presetId || 'custom',
    name: m.name || presetById(m.presetId)?.name || 'Материал',
    thickness: Number.isFinite(m.thickness) ? m.thickness : 3,
    kerf: Number.isFinite(m.kerf) ? Math.max(0, m.kerf) : 0,
    compensate: !!m.compensate,
  };
}

/** Половина реза — на сколько двигать каждый контур, мм. */
export const kerfOffset = (kerf: Mm): Mm => Math.max(0, kerf) / 2;

/**
 * Компенсированный контур: внешние границы расширяются, отверстия сжимаются.
 * Результат — полилинии (кривые сглаживаются с точностью Clipper), поэтому
 * операция необратима без undo — это осознанно, как «Контур наружу/внутрь».
 */
export function compensateKerf(path: SubPath[], kerf: Mm): SubPath[] {
  const d = kerfOffset(kerf);
  if (d <= 0) return path;
  const closed = path.filter((sp) => sp.closed);
  if (!closed.length) return path;
  const region = unionPaths(closed);
  if (!region.length) return path;
  const out = offsetPaths(region, d, 'miter');
  if (!out.length) return path;
  // разомкнутые контуры (гравировка, разметка) рез не расширяет — вернуть как есть
  const open = path.filter((sp) => !sp.closed);
  return open.length ? [...out, ...open] : out;
}
