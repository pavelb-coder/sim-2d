import type { Doc, Id, Layer, Obj, Op, Sheet, Style } from './types';
import { uid } from './shape';
import { IDENT } from './geom/transform';
import { defaultMaterial } from './geom/kerf';

export const SHEET_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'A4', w: 297, h: 210 },
  { label: 'A3', w: 420, h: 297 },
  { label: '300×200', w: 300, h: 200 },
  { label: '400×300', w: 400, h: 300 },
  { label: '600×400', w: 600, h: 400 },
];

export function makeLayer(name: string, op: Op, color: string, order: number): Layer {
  return { id: uid('l'), name, op, color, visible: true, locked: false, order };
}

export function createDoc(): Doc {
  const sheet: Sheet = {
    id: uid('s'),
    name: 'Лист 1',
    width: 300,
    height: 200,
    showGrid: true,
    gridStep: 10,
    snapGrid: true,
    snapObjects: true,
    guides: [],
  };
  const cut = makeLayer('Рез', 'cut', '#e0413c', 0);
  const engrave = makeLayer('Гравировка', 'engrave', '#2f6df6', 1);
  return {
    schemaVersion: 1,
    units: 'mm',
    sheets: [sheet],
    activeSheetId: sheet.id,
    layers: [cut, engrave],
    objects: {},
    order: [],
    material: defaultMaterial(),
    meta: { name: 'Без имени', createdAt: new Date().toISOString(), app: 'lasercut-studio' },
  };
}

export const activeSheet = (doc: Doc): Sheet => doc.sheets.find((s) => s.id === doc.activeSheetId) ?? doc.sheets[0];

export const layerById = (doc: Doc, id: Id): Layer | undefined => doc.layers.find((l) => l.id === id);
export const layerFor = (doc: Doc, op: Op): Layer => doc.layers.find((l) => l.op === op) ?? doc.layers[0];

export function addObjToDoc(doc: Doc, obj: Obj): Doc {
  return { ...doc, objects: { ...doc.objects, [obj.id]: obj }, order: [...doc.order, obj.id] };
}

export function removeObjFromDoc(doc: Doc, id: Id): Doc {
  const objects = { ...doc.objects };
  delete objects[id];
  return { ...doc, objects, order: doc.order.filter((x) => x !== id) };
}

export function updateObjInDoc(doc: Doc, obj: Obj): Doc {
  return { ...doc, objects: { ...doc.objects, [obj.id]: obj } };
}

export function sheetObjects(doc: Doc, sheetId: Id = doc.activeSheetId): Obj[] {
  return doc.order.map((id) => doc.objects[id]).filter((o): o is Obj => !!o && o.sheetId === sheetId);
}

export function emptyStyle(layer: Layer): Style {
  const stroke = layer.op === 'cut' ? '#e0413c' : layer.op === 'engrave' ? '#2f6df6' : '#16a34a';
  return { fill: null, stroke, strokeWidth: 0.1, opacity: 1 };
}

export const identity = IDENT;
