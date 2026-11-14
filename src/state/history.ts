import type { Doc, Obj } from '../core/types';
import { addObjToDoc, removeObjFromDoc, updateObjInDoc } from '../core/doc';

export type Patch =
  | { kind: 'add'; obj: Obj }
  | { kind: 'remove'; obj: Obj }
  | { kind: 'update'; before: Obj; after: Obj };

export interface Command { label: string; patches: Patch[] }

export function applyPatches(doc: Doc, patches: Patch[]): Doc {
  let next = doc;
  for (const p of patches) {
    if (p.kind === 'add') next = addObjToDoc(next, p.obj);
    else if (p.kind === 'remove') next = removeObjFromDoc(next, p.obj.id);
    else next = updateObjInDoc(next, p.after);
  }
  return next;
}

export function invertPatches(patches: Patch[]): Patch[] {
  return [...patches].reverse().map<Patch>((p) => {
    if (p.kind === 'add') return { kind: 'remove', obj: p.obj };
    if (p.kind === 'remove') return { kind: 'add', obj: p.obj };
    return { kind: 'update', before: p.after, after: p.before };
  });
}

export const addCmd = (obj: Obj): Command => ({ label: 'Добавить объект', patches: [{ kind: 'add', obj }] });

export const removeCmd = (objs: Obj[]): Command => ({
  label: 'Удалить',
  patches: objs.map((obj) => ({ kind: 'remove' as const, obj })),
});

export const updateCmd = (label: string, pairs: { before: Obj; after: Obj }[]): Command => ({
  label,
  patches: pairs.map(({ before, after }) => ({ kind: 'update' as const, before, after })),
});

/** Стек команд: храним патчи, а не снапшоты документа. */
export class History {
  private stack: Command[] = [];
  private index = -1;
  readonly limit: number;

  constructor(limit = 100) { this.limit = limit; }

  push(cmd: Command): void {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(cmd);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  get canUndo(): boolean { return this.index >= 0; }
  get canRedo(): boolean { return this.index < this.stack.length - 1; }
  get lastLabel(): string { return this.index >= 0 ? this.stack[this.index].label : ''; }

  undo(): Command | null {
    if (!this.canUndo) return null;
    const cmd = this.stack[this.index];
    this.index -= 1;
    return { label: cmd.label, patches: invertPatches(cmd.patches) };
  }

  redo(): Command | null {
    if (!this.canRedo) return null;
    this.index += 1;
    return this.stack[this.index];
  }

  clear(): void { this.stack = []; this.index = -1; }
}
