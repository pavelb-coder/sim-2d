export interface AskTextOptions {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  okText?: string;
  multiline?: boolean;
}

/**
 * Встроенный диалог ввода — работает и в песочнице предпросмотра,
 * где `prompt()` заблокирован, и в jsdom-тестах.
 */
export function askText(opts: AskTextOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const h = document.createElement('h3');
    h.textContent = opts.title;

    const label = document.createElement('label');
    label.className = 'modal-label';
    label.textContent = opts.label ?? 'Значение';

    const field = document.createElement(opts.multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
    field.className = 'modal-input';
    field.id = 'modal-input';
    if (field.tagName === 'INPUT') (field as HTMLInputElement).type = 'text';
    else (field as HTMLTextAreaElement).rows = 3;
    field.value = opts.value ?? '';
    field.placeholder = opts.placeholder ?? '';

    const row = document.createElement('div');
    row.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'ghost-btn';
    cancel.textContent = 'Отмена';
    cancel.id = 'modal-cancel';
    const ok = document.createElement('button');
    ok.className = 'primary-btn';
    ok.textContent = opts.okText ?? 'Готово';
    ok.id = 'modal-ok';

    row.append(cancel, ok);
    label.appendChild(field);
    box.append(h, label, row);
    back.appendChild(box);
    document.body.appendChild(back);

    const finish = (value: string | null): void => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      if (e.key === 'Enter' && (field.tagName !== 'TEXTAREA' || e.ctrlKey)) {
        e.preventDefault(); e.stopPropagation(); finish(field.value);
      }
    };

    cancel.addEventListener('click', () => finish(null));
    ok.addEventListener('click', () => finish(field.value));
    back.addEventListener('click', (e) => { if (e.target === back) finish(null); });
    document.addEventListener('keydown', onKey, true);

    field.focus();
    if (field.tagName === 'INPUT') (field as HTMLInputElement).select();
  });
}
