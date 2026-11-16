/**
 * Сворачиваемые секции правой панели — как докеры CorelDRAW.
 *
 * Заголовок каждого блока становится кнопкой: клик сворачивает/разворачивает,
 * Alt+клик оставляет открытым только этот блок (аккордеон), состояние
 * запоминается в localStorage и восстанавливается при следующем запуске.
 * Кнопки в шапке панели разворачивают или сворачивают всё сразу.
 */

const STORAGE_KEY = 'lasercut.panels.v1';

let panelEl: HTMLElement | null = null;
const collapsedKeys = new Set<string>();

/** localStorage браузера (в сборке и в jsdom он висит на window, а не на globalThis). */
function storage(): Storage | null {
  try {
    const g = globalThis as unknown as { window?: { localStorage?: Storage }; localStorage?: Storage };
    return g.window?.localStorage ?? g.localStorage ?? null;
  } catch {
    // Safari в приватном режиме бросает исключение уже при обращении
    return null;
  }
}

function readState(): Set<string> {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    // localStorage может быть недоступен (песочница, приватный режим) — просто не помним
    return new Set();
  }
}

function writeState(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify([...collapsedKeys]));
  } catch {
    /* не критично */
  }
}

const blocks = (): HTMLElement[] =>
  panelEl ? [...panelEl.querySelectorAll<HTMLElement>('.pblock')] : [];

/** Ключ блока: data-panel в разметке, иначе — заголовок. */
function keyOf(block: HTMLElement): string {
  if (block.dataset.panel) return block.dataset.panel;
  const title = block.querySelector('h2')?.textContent?.trim() ?? '';
  const key = title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '');
  block.dataset.panel = key || `block${[...blocks()].indexOf(block)}`;
  return block.dataset.panel;
}

function apply(block: HTMLElement, collapsed: boolean): void {
  const key = keyOf(block);
  block.classList.toggle('is-collapsed', collapsed);
  const head = block.querySelector<HTMLElement>('h2');
  if (head) {
    head.setAttribute('aria-expanded', String(!collapsed));
    head.title = collapsed ? 'Развернуть' : 'Свернуть';
  }
  if (collapsed) collapsedKeys.add(key);
  else collapsedKeys.delete(key);
}

function setCollapsed(block: HTMLElement, collapsed: boolean): void {
  apply(block, collapsed);
  writeState();
}

export function collapseAll(collapsed: boolean): void {
  for (const block of blocks()) apply(block, collapsed);
  writeState();
}

/** Состояние секции по ключу (для тестов и панели). */
export const isCollapsed = (key: string): boolean => collapsedKeys.has(key);

export function initPanelCollapse(): void {
  panelEl = document.querySelector<HTMLElement>('aside.panel');
  if (!panelEl) return;

  const saved = readState();
  collapsedKeys.clear();

  for (const block of blocks()) {
    const key = keyOf(block);
    const head = block.querySelector<HTMLElement>('h2');
    if (!head) continue;

    // стрелка-шеврон слева от заголовка
    if (!head.querySelector('.pchev')) {
      const chev = document.createElement('span');
      chev.className = 'pchev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '▸';
      head.prepend(chev);
    }
    head.classList.add('phead');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;

    const toggle = (ev?: Event): void => {
      const collapsed = !block.classList.contains('is-collapsed');
      if (ev && (ev as MouseEvent).altKey) {
        // Alt+клик — аккордеон: открыт только этот блок
        for (const other of blocks()) if (other !== block) apply(other, true);
        apply(block, false);
        writeState();
        return;
      }
      setCollapsed(block, collapsed);
    };

    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      toggle(ev);
    });

    apply(block, saved.has(key));
  }
  collapsedKeys.clear();
  for (const block of blocks()) if (block.classList.contains('is-collapsed')) collapsedKeys.add(keyOf(block));

  const expandBtn = document.getElementById('panels-expand');
  const collapseBtn = document.getElementById('panels-collapse');
  expandBtn?.addEventListener('click', () => collapseAll(false));
  collapseBtn?.addEventListener('click', () => collapseAll(true));
}
