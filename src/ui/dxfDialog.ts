import type { DxfVersion } from '../core/dxf/export';

/**
 * Диалог экспорта DXF — как окно «Export» в CorelDRAW: версия формата,
 * что выгружать, единицы и точность спрямления кривых.
 * Никаких `prompt()`: разметка своя, поэтому работает и в песочнице, и в jsdom.
 */

export type DxfScope = 'sheet' | 'selection' | 'all-sheets';

export interface DxfDialogResult {
  version: DxfVersion;
  scope: DxfScope;
  units: 'mm' | 'inch';
  tolerance: number;
  /** компенсировать рез материала (kerf/2 к габариту детали) */
  compensate: boolean;
}

export interface DxfDialogInfo {
  /** сколько контуров уйдёт в файл (весь лист) */
  entities: number;
  /** сколько контуров в выделении */
  selectedEntities: number;
  /** сколько листов в документе */
  sheets: number;
  /** материал документа: подпись и ширина реза */
  material?: { name: string; thickness: number; kerf: number };
  defaults?: Partial<DxfDialogResult>;
}

export function askDxfOptions(info: DxfDialogInfo): Promise<DxfDialogResult | null> {
  return new Promise((resolve) => {
    const d = info.defaults ?? {};
    const back = document.createElement('div');
    back.className = 'modal-back';

    const box = document.createElement('div');
    box.className = 'modal modal-wide';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Экспорт DXF');

    const h = document.createElement('h3');
    h.textContent = 'Экспорт DXF';

    /* версия */
    const versionRow = document.createElement('label');
    versionRow.className = 'modal-label';
    versionRow.textContent = 'Версия формата';
    const version = document.createElement('select');
    version.id = 'dxf-version';
    version.className = 'modal-input';
    for (const [value, label] of [
      ['R2000', 'R2000 — LWPOLYLINE, дуги bulge (рекомендуется)'],
      ['R12', 'R12 — POLYLINE + VERTEX, максимальная совместимость'],
    ] as [string, string][]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      version.appendChild(opt);
    }
    version.value = d.version ?? 'R2000';
    versionRow.appendChild(version);

    /* что экспортировать */
    const scopeRow = document.createElement('label');
    scopeRow.className = 'modal-label';
    scopeRow.textContent = 'Что выгружать';
    const scope = document.createElement('select');
    scope.id = 'dxf-scope';
    scope.className = 'modal-input';
    const scopeOptions: [DxfScope, string][] = [
      ['sheet', `Текущий лист — ${info.entities} контур(ов)`],
      ['selection', `Только выделенное — ${info.selectedEntities} контур(ов)`],
      ['all-sheets', `Все листы — ${info.sheets} файл(ов)`],
    ];
    for (const [value, label] of scopeOptions) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      scope.appendChild(opt);
    }
    scope.value = d.scope ?? (info.selectedEntities > 0 ? 'selection' : 'sheet');
    // нет выделения — вариант недоступен
    if (!info.selectedEntities) {
      const opt = [...scope.options].find((o) => o.value === 'selection');
      if (opt) opt.disabled = true;
    }
    scopeRow.appendChild(scope);

    /* единицы */
    const unitsRow = document.createElement('label');
    unitsRow.className = 'modal-label';
    unitsRow.textContent = 'Единицы в файле';
    const units = document.createElement('select');
    units.id = 'dxf-units';
    units.className = 'modal-input';
    for (const [value, label] of [
      ['mm', 'Миллиметры — INSUNITS = 4'],
      ['inch', 'Дюймы — INSUNITS = 1, координаты пересчитываются'],
    ] as [string, string][]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      units.appendChild(opt);
    }
    units.value = d.units ?? 'mm';
    unitsRow.appendChild(units);

    /* точность спрямления */
    const tolRow = document.createElement('label');
    tolRow.className = 'modal-label';
    tolRow.textContent = 'Точность кривых, мм (меньше — глаже и тяжелее)';
    const tol = document.createElement('input');
    tol.id = 'dxf-tolerance';
    tol.className = 'modal-input';
    tol.type = 'number';
    tol.min = '0.001';
    tol.max = '0.5';
    tol.step = '0.005';
    tol.value = String(d.tolerance ?? 0.01);
    tolRow.appendChild(tol);

    /* материал и компенсация реза */
    const mat = info.material;
    const matRow = document.createElement('label');
    matRow.className = 'check modal-check';
    const kerfChk = document.createElement('input');
    kerfChk.type = 'checkbox';
    kerfChk.id = 'dxf-kerf';
    kerfChk.checked = d.compensate ?? false;
    kerfChk.disabled = !mat || !(mat.kerf > 0);
    matRow.append(kerfChk, document.createTextNode(
      mat && mat.kerf > 0
        ? ` Учесть рез ${mat.kerf.toFixed(2)} мм (${mat.name}) — контуры CUT раздуваются на ${(mat.kerf / 2).toFixed(2)} мм`
        : ' Учесть рез — задайте ширину реза в блоке «Материал»',
    ));

    const hint = document.createElement('p');
    hint.className = 'modal-hint';
    hint.id = 'dxf-hint';
    hint.textContent = 'Слои CUT / ENGRAVE / SCORE сохраняются, окружности уходят как CIRCLE.';

    const row = document.createElement('div');
    row.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'ghost-btn';
    cancel.id = 'dxf-cancel';
    cancel.textContent = 'Отмена';
    const ok = document.createElement('button');
    ok.className = 'primary-btn';
    ok.id = 'dxf-ok';
    ok.textContent = 'Скачать DXF';

    row.append(cancel, ok);
    box.append(h, versionRow, scopeRow, unitsRow, tolRow, matRow, hint, row);
    back.appendChild(box);
    document.body.appendChild(back);

    const finish = (value: DxfDialogResult | null): void => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };

    const read = (): DxfDialogResult => ({
      version: version.value === 'R12' ? 'R12' : 'R2000',
      scope: (scope.value as DxfScope) ?? 'sheet',
      units: units.value === 'inch' ? 'inch' : 'mm',
      tolerance: Math.min(0.5, Math.max(0.001, Number(tol.value) || 0.01)),
      compensate: kerfChk.checked && !!mat && mat.kerf > 0,
    });

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(read()); }
    };

    cancel.addEventListener('click', () => finish(null));
    ok.addEventListener('click', () => finish(read()));
    back.addEventListener('click', (e) => { if (e.target === back) finish(null); });
    document.addEventListener('keydown', onKey, true);

    ok.focus();
  });
}
