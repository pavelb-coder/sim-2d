import type { Id, Obj, SubPath } from '../core/types';
import { sheetObjects } from '../core/doc';
import { nestObjects, type NestOptions } from '../core/nest';
import { rotateBy, mirror } from './edits';
import { booleanPaths, offsetPaths, pathsArea, unionPaths, type BoolOp } from '../core/geom/boolean';
import { bboxOfSubPaths, boxUnion, transformSubPaths, worldBBox } from '../core/geom/path';
import { IDENT } from '../core/geom/transform';
import { makeObj, uid } from '../core/shape';
import { roundCorners, type CornerMode } from '../core/geom/corners';
import { textOnPath, type TextAlign } from '../core/textPath';
import { addCmd, removeCmd, updateCmd, type Patch } from './history';
import { compensateKerf, materialOf } from '../core/geom/kerf';
import type { Store } from './store';

const worldOf = (obj: Obj): SubPath[] => transformSubPaths(obj.path, obj.transform);

function resultObject(store: Store, source: Obj, path: SubPath[], name: string): Obj {
  return makeObj({
    sheetId: source.sheetId,
    layerId: source.layerId,
    path,
    transform: { ...IDENT },
    style: { ...source.style },
    name,
  });
}

const OP_LABEL: Record<BoolOp, string> = {
  union: 'Сварить',
  diff: 'Вычесть',
  intersect: 'Пересечь',
  xor: 'Исключить',
};

/** Булева операция над выделением. Возвращает текст ошибки или null. */
export function applyBoolean(store: Store, op: BoolOp): string | null {
  const objs = store.selected();
  if (objs.length < 2) return 'Нужно выделить минимум два объекта';
  const result = op === 'union'
    ? unionPaths(objs.flatMap(worldOf))
    : booleanPaths(worldOf(objs[0]), objs.slice(1).flatMap(worldOf), op);
  if (!result.length) return 'Операция не дала ни одного контура';

  const created = resultObject(store, objs[0], result, OP_LABEL[op]);
  const patches: Patch[] = [
    ...objs.map((obj) => ({ kind: 'remove' as const, obj })),
    { kind: 'add', obj: created },
  ];
  store.commit({ label: OP_LABEL[op], patches });
  store.select([created.id]);
  return null;
}

/** Контур наружу (>0) или внутрь (<0). */
export function applyOffset(store: Store, deltaMm: number): string | null {
  const objs = store.selected();
  if (!objs.length) return 'Ничего не выбрано';
  if (Math.abs(deltaMm) < 1e-4) return 'Задайте величину контура';
  const pairs: { before: Obj; after: Obj }[] = [];
  let skipped = 0;
  for (const obj of objs) {
    const result = offsetPaths(worldOf(obj), deltaMm);
    if (!result.length) { skipped += 1; continue; }
    pairs.push({ before: obj, after: resultObject(store, obj, result, obj.name ?? 'Контур') });
  }
  if (!pairs.length) return 'Не удалось построить контур (проверьте замкнутость)';
  // заменяем объекты новыми: удалить + добавить, сохранив порядок
  const patches: Patch[] = [];
  for (const { before, after } of pairs) {
    patches.push({ kind: 'remove', obj: before }, { kind: 'add', obj: { ...after, id: before.id } });
  }
  store.commit({ label: deltaMm > 0 ? 'Контур наружу' : 'Контур внутрь', patches });
  void skipped;
  return null;
}

/**
 * Учесть рез в геометрии: расширить контуры слоёв «рез» на kerf/2.
 *
 * Деталь после лазера выходит меньше чертежа на половину реза с каждого края,
 * поэтому контур заранее раздувают. Работает по выделению, а если ничего не
 * выделено — по всем контурам реза на листе. Гравировка и разметка не трогаются.
 * Результат — полилинии (как «Контур наружу»), откатывается одним undo.
 */
export function applyKerf(store: Store): string | null {
  const doc = store.state.doc;
  const mat = materialOf(doc);
  if (mat.kerf <= 0) return 'Задайте ширину реза в блоке «Материал»';

  const cutLayers = new Set(doc.layers.filter((l) => l.op === 'cut').map((l) => l.id));
  const all = sheetObjects(doc, store.state.sheet.id).filter((o) => cutLayers.has(o.layerId) && !o.locked);
  const picked = store.selected();
  const targets = picked.length ? all.filter((o) => picked.some((p) => p.id === o.id)) : all;
  if (!targets.length) return picked.length
    ? 'Выделенные объекты не на слое реза — компенсация нужна только контурам реза'
    : 'На листе нет контуров реза';

  const patches: Patch[] = [];
  for (const obj of targets) {
    const result = compensateKerf(worldOf(obj), mat.kerf);
    if (!result.length) continue;
    const after = { ...resultObject(store, obj, result, obj.name ?? 'Деталь'), id: obj.id, name: obj.name };
    patches.push({ kind: 'update', before: obj, after });
  }
  if (!patches.length) return 'Не удалось построить компенсированные контуры';
  store.commit({ label: `Учесть рез ${mat.kerf} мм`, patches });
  return null;
}

/**
 * PowerClip — поместить выделенные объекты внутрь контейнера.
 *
 * Контейнер — самый нижний объект выделения (рама рисуется первой, содержимое
 * кладётся поверх), остальные обрезаются по его контуру. Обрезка деструктивная (Clipper, кривые становятся
 * полилинией), поэтому исходная геометрия каждого объекта запоминается в `clip`:
 * «Извлечь содержимое» вернёт контуры в точности как были и уберёт контейнер.
 *
 * @returns текст ошибки или null
 */
export function applyPowerClip(store: Store): string | null {
  const objs = store.selected();
  if (objs.length < 2) return 'Выделите контейнер и содержимое: контейнер — нижний объект в стопке';

  // контейнер — самый нижний по Z-порядку среди выделенных (рамка под содержимым)
  const order = store.state.doc.order;
  const sorted = [...objs].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const container = sorted[0];
  const content = sorted.slice(1);
  const frame = worldOf(container);
  if (!frame.length) return 'У контейнера нет контуров';

  const gid = container.groupId ?? uid('g');
  const patches: Patch[] = [];
  if (!container.groupId) {
    patches.push({ kind: 'update', before: container, after: { ...container, groupId: gid } });
  }

  let kept = 0;
  let lost = 0;
  for (const obj of content) {
    const cut = booleanPaths(worldOf(obj), frame, 'intersect');
    if (!cut.length) {
      // объект целиком вне контейнера — прячем его внутрь как пустое содержимое
      patches.push({ kind: 'remove', obj });
      lost += 1;
      continue;
    }
    const after: Obj = {
      ...obj,
      path: cut,
      transform: { ...IDENT },
      groupId: gid,
      name: obj.name ?? 'Содержимое',
      clip: obj.clip ?? { path: obj.path, transform: obj.transform, containerId: container.id },
    };
    patches.push({ kind: 'update', before: obj, after });
    kept += 1;
  }
  if (!kept && !lost) return 'Нечего помещать внутрь';
  store.commit({ label: 'Поместить внутрь', patches });
  store.select([container.id, ...content.filter((o) => store.state.doc.objects[o.id]).map((o) => o.id)]);
  if (lost && !kept) return 'Объекты целиком вне контейнера — спрятаны';
  return null;
}

/**
 * Извлечь содержимое PowerClip: восстановить исходную геометрию и убрать контейнер.
 * Работает и когда выделено содержимое, и когда выделен сам контейнер.
 *
 * @returns текст ошибки или null
 */
export function releasePowerClip(store: Store): string | null {
  const doc = store.state.doc;
  const sel = store.selected();
  if (!sel.length) return 'Выделите контейнер или его содержимое';

  const selIds = new Set(sel.map((o) => o.id));
  const victims = doc.order
    .map((id) => doc.objects[id])
    .filter((o): o is Obj => !!o && !!o.clip && (selIds.has(o.id) || selIds.has(o.clip.containerId)));
  if (!victims.length) return 'В выделении нет содержимого PowerClip';

  const patches: Patch[] = [];
  const containerIds = new Set<Id>();
  for (const obj of victims) {
    const clip = obj.clip;
    if (!clip) continue;
    containerIds.add(clip.containerId);
    const restored: Obj = { ...obj, path: clip.path, transform: clip.transform };
    delete restored.clip;
    patches.push({ kind: 'update', before: obj, after: restored });
  }
  for (const id of containerIds) {
    const container = doc.objects[id];
    if (container) patches.push({ kind: 'remove', obj: container });
  }
  store.commit({ label: 'Извлечь содержимое', patches });
  store.select(victims.map((o) => o.id));
  return null;
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'bottom' | 'vcenter' | 'top';

/** Выравнивание выделения относительно листа или общего bbox. */
export function alignSelection(store: Store, mode: AlignMode, relative: 'sheet' | 'selection'): void {
  const objs = store.selected();
  if (objs.length < 1) return;
  const sheet = store.state.sheet;
  let target = relative === 'sheet'
    ? { x: 0, y: 0, w: sheet.width, h: sheet.height }
    : boxUnion(null, null);
  if (relative === 'selection') {
    for (const obj of objs) target = boxUnion(target, bboxOfSubPaths(worldOf(obj))) ?? target;
  }
  const box = target as { x: number; y: number; w: number; h: number };

  const pairs = objs.map((obj) => {
    const b = bboxOfSubPaths(worldOf(obj));
    let dx = 0, dy = 0;
    switch (mode) {
      case 'left': dx = box.x - b.x; break;
      case 'hcenter': dx = box.x + box.w / 2 - (b.x + b.w / 2); break;
      case 'right': dx = box.x + box.w - (b.x + b.w); break;
      case 'bottom': dy = box.y - b.y; break;
      case 'vcenter': dy = box.y + box.h / 2 - (b.y + b.h / 2); break;
      case 'top': dy = box.y + box.h - (b.y + b.h); break;
    }
    return { before: obj, after: { ...obj, transform: { ...obj.transform, e: obj.transform.e + dx, f: obj.transform.f + dy } } };
  });
  store.commit(updateCmd('Выравнивание', pairs));
}

/**
 * Равномерное распределение: выравниваем промежутки между габаритами деталей
 * (крайние остаются на месте). Нужно ≥ 3 объектов.
 */
export function distributeSelection(store: Store, axis: 'x' | 'y'): string | null {
  const objs = store.selected();
  if (objs.length < 3) return 'Для распределения нужно минимум три объекта';
  const withBox = objs.map((obj) => ({ obj, box: worldBBox(obj.path, obj.transform) }));
  withBox.sort((a, b) => (axis === 'x' ? a.box.x - b.box.x : a.box.y - b.box.y));
  const first = withBox[0].box;
  const last = withBox[withBox.length - 1].box;
  const spanStart = axis === 'x' ? first.x : first.y;
  const spanEnd = axis === 'x' ? last.x + last.w : last.y + last.h;
  const totalSize = withBox.reduce((sum, item) => sum + (axis === 'x' ? item.box.w : item.box.h), 0);
  const gap = (spanEnd - spanStart - totalSize) / (withBox.length - 1);

  let cursor = spanStart;
  const pairs: { before: Obj; after: Obj }[] = [];
  for (const item of withBox) {
    const current = axis === 'x' ? item.box.x : item.box.y;
    const delta = cursor - current;
    if (Math.abs(delta) > 1e-9) {
      pairs.push({
        before: item.obj,
        after: {
          ...item.obj,
          transform: axis === 'x'
            ? { ...item.obj.transform, e: item.obj.transform.e + delta }
            : { ...item.obj.transform, f: item.obj.transform.f + delta },
        },
      });
    }
    cursor += (axis === 'x' ? item.box.w : item.box.h) + gap;
  }
  if (!pairs.length) return null;
  store.commit(updateCmd(axis === 'x' ? 'Распределить по X' : 'Распределить по Y', pairs));
  return null;
}

export type PatternMode = 'row' | 'circle';

/** Копии: рядом (столбцы × строки) или по кругу. */
export function duplicatePattern(
  store: Store,
  mode: PatternMode,
  opts: { countX: number; countY: number; stepX: number; stepY: number; radius: number; rotate: boolean },
): string | null {
  const objs = store.selected();
  if (!objs.length) return 'Ничего не выбрано';
  const created: Obj[] = [];

  if (mode === 'row') {
    for (let ix = 0; ix < Math.max(1, opts.countX); ix++) {
      for (let iy = 0; iy < Math.max(1, opts.countY); iy++) {
        if (ix === 0 && iy === 0) continue;
        for (const obj of objs) {
          created.push({
            ...obj,
            id: uid(),
            transform: { ...obj.transform, e: obj.transform.e + ix * opts.stepX, f: obj.transform.f + iy * opts.stepY },
          });
        }
      }
    }
  } else {
    const box = objs.reduce((acc, o) => boxUnion(acc, bboxOfSubPaths(worldOf(o))), null as ReturnType<typeof bboxOfSubPaths> | null);
    const center = box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : { x: 0, y: 0 };
    const count = Math.max(2, opts.countX);
    for (let i = 1; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      for (const obj of objs) {
        const dx = obj.transform.e - center.x;
        const dy = obj.transform.f - center.y;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const nx = center.x + dx * cos - dy * sin;
        const ny = center.y + dx * sin + dy * cos;
        const tr = opts.rotate
          ? {
              ...obj.transform,
              a: obj.transform.a * cos - obj.transform.b * sin,
              b: obj.transform.a * sin + obj.transform.b * cos,
              c: obj.transform.c * cos - obj.transform.d * sin,
              d: obj.transform.c * sin + obj.transform.d * cos,
              e: nx,
              f: ny,
            }
          : { ...obj.transform, e: nx, f: ny };
        created.push({ ...obj, id: uid(), transform: tr });
      }
    }
  }
  if (!created.length) return 'Нечего копировать';
  store.commit({ label: mode === 'row' ? 'Копии рядом' : 'Копии по кругу', patches: created.map((obj) => ({ kind: 'add' as const, obj })) });
  store.select(created.map((o) => o.id));
  return null;
}

export function groupSelection(store: Store): string | null {
  const objs = store.selected();
  if (objs.length < 2) return 'Нужно минимум два объекта';
  const groupId = uid('g');
  store.commit(updateCmd('Сгруппировать', objs.map((o) => ({ before: o, after: { ...o, groupId } }))));
  return null;
}

export function ungroupSelection(store: Store): string | null {
  const objs = store.selected().filter((o) => o.groupId);
  if (!objs.length) return 'В выделении нет групп';
  store.commit(updateCmd('Разгруппировать', objs.map((o) => ({ before: o, after: { ...o, groupId: null } }))));
  return null;
}

export type ZDir = 'front' | 'back' | 'up' | 'down';

export function reorderSelection(store: Store, dir: ZDir): void {
  const sel = new Set(store.state.selection);
  if (!sel.size) return;
  const order = [...store.state.doc.order];
  const ids = order.filter((id) => sel.has(id));
  if (dir === 'front') {
    const rest = order.filter((id) => !sel.has(id));
    store.commit({ label: 'На передний план', patches: [{ kind: 'order', before: order, after: [...rest, ...ids] }] });
    return;
  }
  if (dir === 'back') {
    const rest = order.filter((id) => !sel.has(id));
    store.commit({ label: 'На задний план', patches: [{ kind: 'order', before: order, after: [...ids, ...rest] }] });
    return;
  }
  const next = [...order];
  if (dir === 'up') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (sel.has(next[i]) && !sel.has(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (sel.has(next[i]) && !sel.has(next[i - 1])) [next[i], next[i - 1]] = [next[i - 1], next[i]];
    }
  }
  store.commit({ label: dir === 'up' ? 'Выше' : 'Ниже', patches: [{ kind: 'order', before: order, after: next }] });
}

export type TransformKind = 'rot90' | 'rot-90' | 'mirrorH' | 'mirrorV';

const TRANSFORM_LABEL: Record<TransformKind, string> = {
  rot90: 'Поворот на 90°',
  'rot-90': 'Поворот на −90°',
  mirrorH: 'Отразить по горизонтали',
  mirrorV: 'Отразить по вертикали',
};

/** Поворот/отражение выделения вокруг собственных центров. */
export function transformSelection(store: Store, kind: TransformKind): string | null {
  const objs = store.selected();
  if (!objs.length) return 'Ничего не выбрано';
  const map = (o: Obj): Obj => {
    if (kind === 'rot90') return rotateBy(o, 90);
    if (kind === 'rot-90') return rotateBy(o, -90);
    return mirror(o, kind === 'mirrorH' ? 'h' : 'v');
  };
  store.commit(updateCmd(TRANSFORM_LABEL[kind], objs.map((o) => ({ before: o, after: map(o) }))));
  return null;
}

/**
 * Раскладка деталей по листу. `all = true` — все объекты листа,
 * иначе только выделенные. Возвращает текст-итог для тоста.
 */
export function nestSelection(store: Store, opts: NestOptions, all: boolean): string {
  const { doc, sheet } = store.state;
  const objs = all
    ? doc.order.map((id) => doc.objects[id]).filter((o): o is Obj => !!o && o.sheetId === sheet.id && !o.hidden)
    : store.selected();
  if (!objs.length) return 'Нет деталей для раскладки';

  const items = objs.map((o) => {
    const b = worldBBox(o.path, o.transform);
    return { id: o.id, w: b.w, h: b.h };
  });
  const res = nestObjects(items, sheet.width, sheet.height, opts);
  if (!res.placements.length) return 'Детали не помещаются на лист — уменьшите зазор или возьмите лист больше';

  const pairs: { before: Obj; after: Obj }[] = [];
  for (const place of res.placements) {
    const before = doc.objects[place.id];
    if (!before) continue;
    const rotated = place.rotated ? rotateBy(before, 90) : before;
    const box = worldBBox(rotated.path, rotated.transform);
    const after: Obj = { ...rotated, transform: { ...rotated.transform, e: rotated.transform.e + (place.x - box.x), f: rotated.transform.f + (place.y - box.y) } };
    pairs.push({ before, after });
  }
  store.commit(updateCmd('Раскладка на листе', pairs));

  const fill = Math.round(res.fill * 100);
  const base = `Разложено ${res.placements.length} из ${items.length} · заполнение ${fill}%`;
  return res.unplaced.length ? `${base} · не влезло: ${res.unplaced.length}` : base;
}

/** Суммарная площадь (для сортировки и подсказок). */
export const objectsArea = (objs: Obj[]): number => objs.reduce((s, o) => s + pathsArea(worldOf(o)), 0);

export { addCmd, removeCmd };

export const selectedIds = (store: Store): Id[] => store.state.selection;

/**
 * Скругление (fillet) или фаска (chamfer) углов выделенных объектов.
 *
 * @param store хранилище
 * @param mode 'fillet' | 'chamfer'
 * @param size радиус/величина в мм
 * @returns текст ошибки или null
 */
export function applyCorners(store: Store, mode: CornerMode, size: number): string | null {
  const objs = store.selected();
  if (!objs.length) return 'Ничего не выбрано';
  if (!(size > 0)) return 'Задайте радиус или величину фаски';

  const pairs: { before: Obj; after: Obj }[] = [];
  for (const obj of objs) {
    const rounded = roundCorners(worldOf(obj), size, mode);
    if (!rounded.length) continue;
    const next = { ...obj, path: rounded, transform: { ...IDENT } };
    pairs.push({ before: obj, after: next });
  }
  if (!pairs.length) return 'Нечего обрабатывать';

  store.commit(updateCmd(mode === 'fillet' ? 'Скругление углов' : 'Фаска углов', pairs));
  return null;
}

/**
 * Скрыть/показать или заблокировать/разблокировать объект (Object manager).
 *
 * @param store хранилище
 * @param id объект
 * @param flag 'hidden' | 'locked'
 * @param value новое значение
 */
export function setObjectFlag(store: Store, id: Id, flag: 'hidden' | 'locked', value: boolean): void {
  const obj = store.state.doc.objects[id];
  if (!obj) return;
  const next = { ...obj, [flag]: value } as Obj;
  store.commit(updateCmd(value ? (flag === 'hidden' ? 'Скрыть' : 'Заблокировать') : (flag === 'hidden' ? 'Показать' : 'Разблокировать'), [
    { before: obj, after: next },
  ]));
  if (flag === 'hidden' && value) {
    store.select(store.state.selection.filter((sel) => sel !== id));
  }
}

/** Сдвиг объекта на один шаг по Z-порядку (кнопки в списке объектов). */
export function reorderOne(store: Store, id: Id, dir: 'up' | 'down'): void {
  const order = [...store.state.doc.order];
  const i = order.indexOf(id);
  const j = dir === 'up' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  store.commit({ label: dir === 'up' ? 'Выше' : 'Ниже', patches: [{ kind: 'order', before: store.state.doc.order, after: order }] });
}

/**
 * Текст по контуру: берём первый выделенный объект как базовую линию и
 * добавляем надпись отдельным объектом (контур остаётся на месте).
 *
 * @returns текст ошибки или null
 */
export function applyTextOnPath(
  store: Store,
  text: string,
  heightMm: number,
  offset: number,
  align: TextAlign = 'start',
): string | null {
  const objs = store.selected();
  const base = objs[0];
  if (!base) return 'Выделите контур, по которому пустить текст';
  if (!text.trim()) return 'Введите текст';

  const world = transformSubPaths(base.path, base.transform);
  const res = textOnPath(text, heightMm, world, { offset, align });
  if (!res) return 'Шрифт не загрузился или у контура нет длины';

  const obj = makeObj({
    sheetId: base.sheetId,
    layerId: base.layerId,
    path: res.paths,
    transform: { ...IDENT },
    style: { ...base.style, fill: base.style.fill, fillType: base.style.fillType },
    name: text.slice(0, 24),
  });
  store.commit(addCmd(obj));
  store.select([obj.id]);
  if (!res.fit) return 'Надпись длиннее контура — хвост вышел за его конец';
  return null;
}
