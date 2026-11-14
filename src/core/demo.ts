import type { Doc, Obj } from './types';
import { createDoc, emptyStyle } from './doc';
import { ellipsePath, linePath, makeObj, rectPath } from './shape';
import { IDENT, translate } from './geom/transform';

/** Демонстрационный макет: пластина с отверстиями, гравировка и разметка. */
export function demoDoc(): Doc {
  const doc = createDoc();
  const sheet = doc.sheets[0];
  const cut = doc.layers[0];
  const engrave = doc.layers[1];
  const add = (obj: Obj): void => {
    doc.objects[obj.id] = obj;
    doc.order.push(obj.id);
  };
  const at = (x: number, y: number) => ({ ...IDENT, ...translate(x, y) });

  add(makeObj({
    sheetId: sheet.id, layerId: cut.id, path: rectPath(140, 100), transform: at(78, 100),
    style: emptyStyle(cut), name: 'Пластина',
  }));
  for (const [x, y] of [[16, 138], [140, 138], [16, 62], [140, 62]] as const) {
    add(makeObj({
      sheetId: sheet.id, layerId: cut.id, path: ellipsePath(8, 8), transform: at(x, y),
      style: emptyStyle(cut), name: 'Отверстие',
    }));
  }
  add(makeObj({
    sheetId: sheet.id, layerId: engrave.id, path: ellipsePath(44, 44), transform: at(228, 100),
    style: emptyStyle(engrave), name: 'Гравировка',
  }));
  add(makeObj({
    sheetId: sheet.id, layerId: cut.id, path: ellipsePath(16, 16), transform: at(228, 100),
    style: emptyStyle(cut), name: 'Отверстие',
  }));
  add(makeObj({
    sheetId: sheet.id, layerId: engrave.id, path: linePath(60), transform: at(78, 30),
    style: emptyStyle(engrave), name: 'Разметка',
  }));
  return doc;
}
