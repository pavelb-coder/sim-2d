import type { Doc, Id, Layer, Obj, Sheet, Style } from '../core/types';
import { activeSheet, createDoc, emptyStyle } from '../core/doc';
import { History, applyPatches, updateCmd, type Command, type Patch } from './history';
import { invalidateSnapCache } from '../core/snap';
import type { View } from '../render/view';

export type ToolId = 'select' | 'line' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'node' | 'text';
export type ChangeKind = 'doc' | 'selection' | 'view' | 'tool' | 'ui';

export interface AppState {
  doc: Doc;
  sheet: Sheet;
  selection: Id[];
  tool: ToolId;
  view: View;
  hover: Id | null;
  token: number;
  activeLayerId: Id;
  alignRef: 'sheet' | 'selection';
  /** умное выравнивание при перетаскивании (Dynamic guides) */
  smartGuides: boolean;
  /** параметры инструментов «многоугольник» и «звезда» */
  polySides: number;
  starPoints: number;
  /** доля внутреннего радиуса звезды (0,05…0,95) */
  starInner: number;
}

type Listener = (state: AppState, kind: ChangeKind) => void;

export class Store {
  state: AppState;
  history = new History(120);
  private subs = new Set<Listener>();

  constructor(view: View) {
    const doc = createDoc();
    this.state = {
      doc,
      sheet: activeSheet(doc),
      selection: [],
      tool: 'select',
      view,
      hover: null,
      token: 1,
      activeLayerId: doc.layers[0].id,
      alignRef: 'selection',
      smartGuides: true,
      polySides: 6,
      starPoints: 5,
      starInner: 0.45,
    };
  }

  subscribe(fn: Listener): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(kind: ChangeKind): void {
    for (const fn of this.subs) fn(this.state, kind);
  }

  private setDoc(doc: Doc): void {
    this.state = { ...this.state, doc, sheet: activeSheet(doc), token: this.state.token + 1 };
    invalidateSnapCache();
  }

  /** Применить команду и положить её в историю. */
  commit(cmd: Command): void {
    this.setDoc(applyPatches(this.state.doc, cmd.patches));
    this.history.push(cmd);
    this.pruneSelection();
    this.emit('doc');
  }

  /** Применить патчи без записи в историю (живое перетаскивание). */
  preview(patches: Patch[]): void {
    this.setDoc(applyPatches(this.state.doc, patches));
    this.emit('doc');
  }

  undo(): void {
    const cmd = this.history.undo();
    if (!cmd) return;
    this.setDoc(applyPatches(this.state.doc, cmd.patches));
    this.pruneSelection();
    this.emit('doc');
  }

  redo(): void {
    const cmd = this.history.redo();
    if (!cmd) return;
    this.setDoc(applyPatches(this.state.doc, cmd.patches));
    this.pruneSelection();
    this.emit('doc');
  }

  private pruneSelection(): void {
    const sel = this.state.selection.filter((id) => this.state.doc.objects[id]);
    if (sel.length !== this.state.selection.length) this.state = { ...this.state, selection: sel };
  }

  select(ids: Id[]): void {
    this.state = { ...this.state, selection: ids };
    this.emit('selection');
  }

  toggleSelect(id: Id): void {
    const has = this.state.selection.includes(id);
    this.select(has ? this.state.selection.filter((x) => x !== id) : [...this.state.selection, id]);
  }

  setTool(tool: ToolId): void {
    if (this.state.tool === tool) return;
    this.state = { ...this.state, tool };
    this.emit('tool');
  }

  setHover(id: Id | null): void {
    if (this.state.hover === id) return;
    this.state = { ...this.state, hover: id };
    this.emit('ui');
  }

  updateSheet(patch: Partial<Sheet>): void {
    const sheet = { ...this.state.sheet, ...patch };
    const doc: Doc = { ...this.state.doc, sheets: this.state.doc.sheets.map((s) => (s.id === sheet.id ? sheet : s)) };
    this.setDoc(doc);
    this.emit('doc');
  }

  /** Заменить документ (открытие файла, демо). */
  loadDoc(doc: Doc): void {
    this.setDoc(doc);
    this.history.clear();
    this.state = { ...this.state, selection: [] };
    this.emit('doc');
  }

  activeLayer(): Layer {
    const { doc } = this.state;
    return doc.layers.find((l) => l.id === this.state.activeLayerId) ?? doc.layers[0];
  }

  styleFor(layer: Layer): Style {
    return emptyStyle(layer);
  }

  /** Параметры правильных фигур (число сторон/лучей, глубина звезды). */
  setShapeParams(p: Partial<{ polySides: number; starPoints: number; starInner: number }>): void {
    const next: AppState = { ...this.state };
    if (p.polySides !== undefined) next.polySides = Math.max(3, Math.min(64, Math.round(p.polySides)));
    if (p.starPoints !== undefined) next.starPoints = Math.max(3, Math.min(32, Math.round(p.starPoints)));
    if (p.starInner !== undefined) next.starInner = Math.max(0.05, Math.min(0.95, p.starInner));
    this.state = next;
    this.emit('ui');
  }

  setSmartGuides(on: boolean): void {
    this.state = { ...this.state, smartGuides: on };
    this.emit('ui');
  }

  setActiveLayer(id: Id): void {
    this.state = { ...this.state, activeLayerId: id };
    this.emit('ui');
  }

  /** Перенести выбранные объекты на слой (цвет — по слою). */
  moveSelectionToLayer(layerId: Id): void {
    const { doc } = this.state;
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const objs = this.selected();
    if (!objs.length) { this.setActiveLayer(layerId); return; }
    const pairs = objs
      .filter((o) => o.layerId !== layerId)
      .map((o) => ({
        before: o,
        after: { ...o, layerId, style: { ...o.style, stroke: layer.color } },
      }));
    if (pairs.length) this.commit(updateCmd('Сменить слой', pairs));
    this.setActiveLayer(layerId);
  }

  selected(): Obj[] {
    return this.state.selection.map((id) => this.state.doc.objects[id]).filter((o): o is Obj => !!o);
  }
}
