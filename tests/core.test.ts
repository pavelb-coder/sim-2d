import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDxfText, tokenize } from '../src/core/dxf/tokenize';
import { importDxf, unitScaleFromHeader } from '../src/core/dxf/import';
import { exportDxf, slug, countDxfEntities, unitScale } from '../src/core/dxf/export';
import { parseSvg, parsePathData, parseTransform, lengthToMm } from '../src/core/svg/parse';
import { exportSvg } from '../src/core/svg/write';
import { booleanPaths, offsetPaths, pathsArea, unionPaths } from '../src/core/geom/boolean';
import { validateDoc } from '../src/core/validate';
import { pathNodes, moveNode, deleteNode, splitSegment, toggleClosed, toCurve } from '../src/core/geom/nodeEdit';
import { setFontData, ensureFont, textToPaths } from '../src/core/text';
import { textOnPath } from '../src/core/textPath';
import { angleOf, fillTypeOf, gradientLine, gradientRadius, secondColorOf } from '../src/core/fill';
import { hexToHsl, hslToHex, normalizeHex } from '../src/core/color';
import { nestObjects } from '../src/core/nest';
import { createDoc, emptyStyle } from '../src/core/doc';
import { ellipsePath, makeObj, rectPath } from '../src/core/shape';
import { IDENT, translate, compose, rotate, scaleM, mk } from '../src/core/geom/transform';
import { bboxOfSubPaths, pathLength, transformSubPaths } from '../src/core/geom/path';
import type { Doc, Obj } from '../src/core/types';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>): void {
  const run = (): void => { passed += 1; console.log(`  ✓ ${name}`); };
  try {
    const res = fn();
    if (res instanceof Promise) { throw new Error('асинхронный тест — используйте atest'); }
    run();
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}
const atests: [string, () => Promise<void>][] = [];
const atest = (name: string, fn: () => Promise<void>): void => { atests.push([name, fn]); };

const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

/* ------------------------------------------------------------------ DXF вход */
const R12_SAMPLE = `0
SECTION
2
HEADER
9
$ACADVER
1
AC1009
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
2
0
LAYER
2
CUT
70
0
62
1
6
CONTINUOUS
0
LAYER
2
ENGRAVE
70
0
62
5
6
CONTINUOUS
0
ENDTAB
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK
2
LOGO
10
0.0
20
0.0
0
CIRCLE
8
CUT
10
0.0
20
0.0
40
4.0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
CUT
10
0.0
20
0.0
11
100.0
21
0.0
0
POLYLINE
8
CUT
66
1
10
0.0
20
0.0
30
0.0
70
1
0
VERTEX
8
CUT
10
0.0
20
0.0
30
0.0
0
VERTEX
8
CUT
10
40.0
20
0.0
30
0.0
42
1.0
0
VERTEX
8
CUT
10
40.0
20
40.0
30
0.0
0
SEQEND
8
CUT
0
CIRCLE
8
CUT
10
80.0
20
20.0
40
10.0
0
ARC
8
ENGRAVE
10
0.0
20
50.0
40
15.0
50
0.0
51
180.0
0
INSERT
8
CUT
2
LOGO
10
120.0
20
20.0
41
2.0
42
2.0
50
0.0
0
ENDSEC
0
EOF
`;

const INCH_SAMPLE = `0
SECTION
2
HEADER
9
$INSUNITS
70
1
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
0
10
0.0
20
0.0
11
1.0
21
0.0
0
ENDSEC
0
EOF
`;

const opts = () => {
  const doc = createDoc();
  return {
    doc,
    opts: {
      sheetId: doc.sheets[0].id,
      cutLayerId: doc.layers[0].id,
      engraveLayerId: doc.layers[1].id,
      cutColor: doc.layers[0].color,
      engraveColor: doc.layers[1].color,
    },
  };
};

console.log('dxf: импорт');

test('токенизация: пары код/значение', () => {
  const pairs = tokenize('0\nSECTION\n2\nHEADER\n');
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].code, 0);
  assert.equal(pairs[0].value, 'SECTION');
  assert.equal(pairs[1].code, 2);
});

test('единицы $INSUNITS: дюймы/мм/см', () => {
  near(unitScaleFromHeader({ $INSUNITS: ['1'] }).scale, 25.4);
  near(unitScaleFromHeader({ $INSUNITS: ['4'] }).scale, 1);
  near(unitScaleFromHeader({ $INSUNITS: ['5'] }).scale, 10);
  near(unitScaleFromHeader({}).scale, 1);
});

test('R12: слои, блоки и все сущности разобраны', () => {
  const parsed = parseDxfText(R12_SAMPLE);
  assert.equal(parsed.layers.length, 2, 'два слоя');
  assert.deepEqual(parsed.layers.map((l) => l.name).sort(), ['CUT', 'ENGRAVE']);
  assert.ok(parsed.blocks.LOGO, 'блок LOGO найден');
  assert.equal(parsed.blocks.LOGO.entities.length, 1);
  const types = parsed.entities.map((e) => e.type);
  assert.deepEqual(types, ['LINE', 'POLYLINE', 'CIRCLE', 'ARC', 'INSERT']);
  assert.equal(parsed.entities[1].vertices?.length, 3, 'вершины POLYLINE');
});

test('импорт: объекты, слои и геометрия', () => {
  const { opts: o } = opts();
  const res = importDxf(R12_SAMPLE, o);
  assert.equal(res.objects.length, 5, `объектов: ${res.objects.length}`);
  const [line, poly, circle, arc, insert] = res.objects;
  assert.equal(line.path[0].segs.length, 1);
  near(pathLength(line.path), 100, 1e-6);
  // полилиния: 2 прямых + дуга с bulge=1 (четверть окружности R=40/√2)
  assert.equal(poly.path[0].segs.length, 3);
  assert.equal(poly.path[0].segs[1].t, 'a');
  assert.ok(poly.path[0].closed);
  near(pathLength(circle.path), 2 * Math.PI * 10, 1e-3);
  // ARC 0..180° R=15 → половина окружности
  near(pathLength(arc.path), Math.PI * 15, 1e-6);
  assert.equal(arc.layerId, o.engraveLayerId, 'синий слой → гравировка');
  // INSERT: блок-окружность R=4, масштаб 2 → R=8, центр (120,20)
  const bbox = bboxOfSubPaths(insert.path);
  near(bbox.x, 112, 1e-6); near(bbox.w, 16, 1e-6);
  near(bbox.y, 12, 1e-6); near(bbox.h, 16, 1e-6);
});

test('импорт: дюймы переводятся в мм', () => {
  const { opts: o } = opts();
  const res = importDxf(INCH_SAMPLE, o);
  near(pathLength(res.objects[0].path), 25.4, 1e-6);
  near(res.unitScale, 25.4);
});

test('импорт: мусор не роняет парсер', () => {
  const { opts: o } = opts();
  const res = importDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n', o);
  assert.equal(res.objects.length, 0);
  const broken = importDxf('это не dxf', o);
  assert.equal(broken.objects.length, 0);
});

console.log('dxf: экспорт');

function sampleDoc(): Doc {
  const doc = createDoc();
  const cut = doc.layers[0];
  const engrave = doc.layers[1];
  const add = (obj: Obj): void => { doc.objects[obj.id] = obj; doc.order.push(obj.id); };
  add(makeObj({ sheetId: doc.sheets[0].id, layerId: cut.id, path: rectPath(100, 60), transform: { ...IDENT, e: 60, f: 60 }, style: emptyStyle(cut), name: 'Пластина' }));
  add(makeObj({ sheetId: doc.sheets[0].id, layerId: cut.id, path: ellipsePath(20, 20), transform: { ...IDENT, e: 60, f: 60 }, style: emptyStyle(cut), name: 'Отверстие' }));
  add(makeObj({ sheetId: doc.sheets[0].id, layerId: engrave.id, path: rectPath(40, 10), transform: { ...IDENT, e: 60, f: 90 }, style: emptyStyle(engrave), name: 'Гравировка' }));
  return doc;
}

test('экспорт R2000: структура и содержимое', () => {
  const doc = sampleDoc();
  const text = exportDxf(doc);
  assert.ok(text.includes('AC1015'));
  assert.ok(text.includes('LWPOLYLINE'));
  assert.ok(text.includes('CIRCLE'), 'круг выгружается как CIRCLE');
  assert.ok(text.includes('CUT') && text.includes('ENGRAVE'));
  assert.ok(text.includes('$INSUNITS'));
  assert.equal(countDxfEntities(doc), 3);
  // каждый объект — отдельная сущность
  const entities = text.split('\n0\n').filter((chunk) => /^(LWPOLYLINE|CIRCLE|ARC|LINE)$/.test(chunk.split('\n')[0])).length;
  assert.equal(entities, 3, `сущностей: ${entities}`);
});

test('экспорт R12: POLYLINE/VERTEX/SEQEND вместо LWPOLYLINE', () => {
  const text = exportDxf(sampleDoc(), { version: 'R12' });
  assert.ok(text.includes('AC1009'));
  assert.ok(!text.includes('LWPOLYLINE'));
  assert.ok(text.includes('POLYLINE'));
  assert.ok(text.includes('VERTEX'));
  assert.ok(text.includes('SEQEND'));
});

test('round-trip R2000: геометрия и длина сохраняются', () => {
  const doc = sampleDoc();
  const text = exportDxf(doc, { version: 'R2000' });
  const { opts: o } = opts();
  const back = importDxf(text, o);
  assert.equal(back.objects.length, 3);

  const before = bboxOfSubPaths(doc.order.flatMap((id) => transformSubPaths(doc.objects[id].path, doc.objects[id].transform)));
  const after = back.bbox!;
  near(before.x, after.x, 1e-3); near(before.y, after.y, 1e-3);
  near(before.w, after.w, 1e-3); near(before.h, after.h, 1e-3);

  const lenBefore = doc.order.reduce((s, id) => s + pathLength(transformSubPaths(doc.objects[id].path, doc.objects[id].transform)), 0);
  const lenAfter = back.objects.reduce((s, obj) => s + pathLength(obj.path), 0);
  near(lenBefore, lenAfter, 0.05);
});

test('round-trip R12: геометрия сохраняется', () => {
  const doc = sampleDoc();
  const back = importDxf(exportDxf(doc, { version: 'R12' }), opts().opts);
  assert.equal(back.objects.length, 3);
  const before = bboxOfSubPaths(doc.order.flatMap((id) => transformSubPaths(doc.objects[id].path, doc.objects[id].transform)));
  near(before.w, back.bbox!.w, 1e-2);
  near(before.h, back.bbox!.h, 1e-2);
});

test('round-trip: повёрнутый объект не «съезжает»', () => {
  const doc = createDoc();
  const layer = doc.layers[0];
  const obj = makeObj({
    sheetId: doc.sheets[0].id, layerId: layer.id, path: rectPath(80, 40),
    transform: compose(translate(100, 80), rotate(Math.PI / 6)), style: emptyStyle(layer), name: 'Повёрнутый',
  });
  doc.objects[obj.id] = obj; doc.order.push(obj.id);
  const before = bboxOfSubPaths(transformSubPaths(obj.path, obj.transform));
  const back = importDxf(exportDxf(doc), opts().opts);
  near(before.x, back.bbox!.x, 1e-2);
  near(before.y, back.bbox!.y, 1e-2);
  near(before.w, back.bbox!.w, 1e-2);
  near(before.h, back.bbox!.h, 1e-2);
});

test('имя файла из названия документа', () => {
  assert.equal(slug('Мой макет 2026'), 'мой-макет-2026');
  assert.equal(slug('  '), 'sheet');
});

console.log('svg');

test('svg: базовые фигуры и viewBox в мм', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">
    <rect x="10" y="5" width="20" height="10"/>
    <circle cx="60" cy="25" r="5"/>
    <path d="M0 0 L30 0 L30 20 Z"/>
  </svg>`;
  const res = parseSvg(svg);
  assert.equal(res.paths.length, 3);
  const box = bboxOfSubPaths(res.paths);
  near(box.x, 0); near(box.y, 0);
  near(box.w, 65); near(box.h, 30);
});

test('svg: transform и единицы px', () => {
  const svg = `<svg width="96px" height="96px"><g transform="translate(10 0) scale(2)"><rect x="0" y="0" width="10" height="10"/></g></svg>`;
  const res = parseSvg(svg);
  const box = bboxOfSubPaths(res.paths);
  // 96px = 25.4мм; масштаб viewBox отсутствует → px→мм
  near(box.w, 20 * (25.4 / 96), 1e-6);
  near(box.x, 10 * (25.4 / 96), 1e-6);
});

test('svg: дуга A превращается в кубические, а не в прямую', () => {
  const paths = parsePathData('M 0 0 A 10 10 0 0 1 20 0');
  assert.equal(paths.length, 1);
  assert.ok(paths[0].segs.every((s) => s.t === 'c'), 'все сегменты кубические');
  const box = bboxOfSubPaths(paths);
  near(box.h, 10, 0.05, );
});

test('экспорт DXF: компенсация реза только на слое реза', () => {
  const doc = createDoc();
  const sheet = doc.sheets[0];
  const cut = makeObj({ sheetId: sheet.id, layerId: doc.layers[0].id, path: rectPath(100, 60), transform: { ...IDENT } , style: emptyStyle(doc.layers[0]) });
  const eng = makeObj({ sheetId: sheet.id, layerId: doc.layers[1].id, path: rectPath(40, 10), transform: { ...IDENT }, style: emptyStyle(doc.layers[1]) });
  doc.objects[cut.id] = cut; doc.objects[eng.id] = eng; doc.order = [cut.id, eng.id];
  assert.equal(doc.layers[0].op, 'cut');
  assert.equal(doc.layers[1].op, 'engrave');

  const pairs = (text: string): [string, string][] => {
    const lines = text.split(/\r?\n/);
    const out: [string, string][] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i].trim(), lines[i + 1].trim()]);
    return out;
  };
  const bbox = (text: string): { w: number; h: number } => {
    const p = pairs(text);
    const xs = p.filter(([c]) => c === '10').map(([, v]) => Number(v));
    const ys = p.filter(([c]) => c === '20').map(([, v]) => Number(v));
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  // без компенсации — контур ровно по чертежу
  const plain = bbox(exportDxf(doc, { onlyIds: [cut.id] }));
  near(plain.w, 100, 1e-6);
  near(plain.h, 60, 1e-6);

  // рез 0,2 мм → по 0,1 мм на каждую сторону
  const comp = bbox(exportDxf(doc, { onlyIds: [cut.id], kerf: 0.2 }));
  near(comp.w, 100.2, 0.02);
  near(comp.h, 60.2, 0.02);

  // гравировка не компенсируется: рез её не касается
  const engraveComp = bbox(exportDxf(doc, { onlyIds: [eng.id], kerf: 0.2 }));
  near(engraveComp.w, 40, 1e-6);
  near(engraveComp.h, 10, 1e-6);

  // дюймовый файл: kerf тоже переводится в дюймы
  const inch = bbox(exportDxf(doc, { onlyIds: [cut.id], kerf: 0.2, units: 'inch' }));
  near(inch.w, (100 + 0.2) / 25.4, 0.002);

  // нулевой/отрицательный рез ничего не меняет
  const zero = bbox(exportDxf(doc, { onlyIds: [cut.id], kerf: 0 }));
  near(zero.w, 100, 1e-6);
});

test('svg: экспорт и повторный импорт совпадают по bbox', () => {
  const doc = sampleDoc();
  const text = exportSvg(doc);
  assert.ok(text.includes('mm"'));
  const back = parseSvg(text);
  const before = bboxOfSubPaths(doc.order.flatMap((id) => transformSubPaths(doc.objects[id].path, doc.objects[id].transform)));
  const after = bboxOfSubPaths(back.paths);
  // SVG переворачивает Y через группу, поэтому сравниваем размеры и сдвиг по X
  near(before.w, after.w, 1e-2);
  near(before.h, after.h, 1e-2);
});

test('svg: transform-строки', () => {
  const m = parseTransform('translate(10,20) rotate(90)');
  const p = { x: 1, y: 0 };
  const q = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  near(q.x, 10, 1e-9);
  near(q.y, 21, 1e-9);
  near(lengthToMm('1in'), 25.4);
  near(lengthToMm('10mm'), 10);
  near(lengthToMm('72pt'), 25.4, 1e-9);
});

console.log('операции');

const rectAt = (w: number, h: number, x: number, y: number) => transformSubPaths(rectPath(w, h), translate(x, y));

test('булевы: площади объединения/пересечения/разности', () => {
  const a = rectAt(100, 100, 50, 50);
  const b = rectAt(100, 100, 100, 50);
  near(pathsArea(booleanPaths(a, b, 'union')), 15000, 0.5);
  near(pathsArea(booleanPaths(a, b, 'intersect')), 5000, 0.5);
  near(pathsArea(booleanPaths(a, b, 'diff')), 5000, 0.5);
  near(pathsArea(booleanPaths(a, b, 'xor')), 10000, 0.5);
});

test('булевы: вычитание отверстия из пластины', () => {
  const plate = rectAt(100, 100, 50, 50); // 0..100
  const hole = transformSubPaths(ellipsePath(20, 20), translate(50, 50)); // центр пластины
  const result = booleanPaths(plate, hole, 'diff');
  const area = pathsArea(unionPaths(result));
  near(area, 10000 - Math.PI * 100, 3);
  assert.equal(result.length, 2, 'два контура: пластина и отверстие');
});

test('offset: наружу и внутрь', () => {
  const a = rectAt(100, 100, 50, 50); // 0..100
  const out = offsetPaths(a, 5);
  const boxOut = bboxOfSubPaths(out);
  near(boxOut.x, -5, 1e-3); near(boxOut.w, 110, 1e-3);
  const inn = offsetPaths(a, -5);
  const boxIn = bboxOfSubPaths(inn);
  near(boxIn.w, 90, 1e-3);
});

console.log('проверка перед резкой');

test('валидатор: незамкнутый контур, выход за лист, дубликат', () => {
  const doc = createDoc();
  const layer = doc.layers[0];
  const add = (path: Obj['path'], x: number, y: number): void => {
    const obj = makeObj({ sheetId: doc.sheets[0].id, layerId: layer.id, path, transform: { ...IDENT, e: x, f: y }, style: emptyStyle(layer) });
    doc.objects[obj.id] = obj; doc.order.push(obj.id);
  };
  add([{ closed: false, start: { x: 0, y: 0 }, segs: [{ t: 'l', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }] }], 10, 10);
  add(rectPath(50, 50), 280, 180);
  add(rectPath(20, 20), 60, 60);
  add(rectPath(20, 20), 60, 60);

  const issues = validateDoc(doc, doc.sheets[0]);
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes('open-contour'), 'незамкнутый контур');
  assert.ok(codes.includes('outside-sheet'), 'выход за лист');
  assert.ok(codes.includes('duplicate'), 'дубликат');
  assert.equal(issues.find((i) => i.code === 'open-contour')?.severity, 'error');
});

console.log('узлы');

test('узлы: список, перемещение, удаление, разбиение', () => {
  const path = rectPath(100, 50);
  const nodes = pathNodes(path);
  assert.equal(nodes.length, 4, 'у прямоугольника 4 узла');

  const moved = moveNode(path, { sub: 0, index: 0 }, { x: -60, y: -30 });
  const box = bboxOfSubPaths(moved);
  near(box.x, -60, 1e-9);
  near(box.w, 110, 1e-9);

  const split = splitSegment(path, { sub: 0, index: 0 }, 0.5);
  assert.ok(split);
  assert.equal(pathNodes(split!.path).length, 5, 'добавился узел');

  const removed = deleteNode(path, { sub: 0, index: 1 });
  assert.equal(pathNodes(removed).length, 3, 'узел удалён, соседи склеены');

  const opened = toggleClosed(path, 0);
  assert.equal(opened[0].closed, false);
  assert.equal(toggleClosed(opened, 0)[0].closed, true);
});

test('узлы: «в кривую» даёт кубические сегменты', () => {
  const curved = toCurve(rectPath(50, 50), { sub: 0, index: 1 });
  assert.ok(curved[0].segs.some((s) => s.t === 'c'));
});

test('экспорт DXF: только выделенное, дюймы, точность', () => {
  const doc = createDoc();
  const sheet = doc.sheets[0];
  const a = makeObj({ sheetId: sheet.id, layerId: doc.layers[0].id, path: rectPath(100, 50), transform: { ...IDENT, e: 50, f: 25 }, style: emptyStyle(doc.layers[0]) });
  const b = makeObj({ sheetId: sheet.id, layerId: doc.layers[0].id, path: rectPath(20, 20), transform: { ...IDENT, e: 150, f: 60 }, style: emptyStyle(doc.layers[0]) });
  doc.objects[a.id] = a; doc.objects[b.id] = b; doc.order = [a.id, b.id];

  const pairs = (text: string): [string, string][] => {
    const lines = text.split(/\r?\n/);
    const out: [string, string][] = [];
    for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i].trim(), lines[i + 1].trim()]);
    return out;
  };
  const xs = (text: string): number[] => pairs(text).filter(([c]) => c === '10').map(([, v]) => Number(v));

  assert.equal(countDxfEntities(doc), 2);
  assert.equal(countDxfEntities(doc, sheet.id, [a.id]), 1);

  const full = exportDxf(doc, { onlyIds: [a.id, b.id] });
  const onlyA = exportDxf(doc, { onlyIds: [a.id] });
  assert.ok(full.length > onlyA.length, 'файл выделения короче полного');
  near(Math.max(...xs(onlyA)), 100, 1e-6);
  near(Math.max(...xs(full)), 160, 1e-6);

  // дюймы: координаты делятся на 25,4, в заголовке INSUNITS = 1
  assert.equal(unitScale('mm'), 1);
  near(unitScale('inch'), 1 / 25.4, 1e-12);
  const inch = exportDxf(doc, { onlyIds: [a.id], units: 'inch' });
  near(Math.max(...xs(inch)), 100 / 25.4, 1e-4);
  const insunits = pairs(inch).findIndex(([c, v]) => c === '9' && v === '$INSUNITS');
  assert.ok(insunits >= 0, 'в заголовке есть $INSUNITS');
  assert.equal(pairs(inch)[insunits + 1][1], '1', 'INSUNITS = 1 (дюймы)');
  const mm = exportDxf(doc, { onlyIds: [a.id] });
  const insMm = pairs(mm).findIndex(([c, v]) => c === '9' && v === '$INSUNITS');
  assert.equal(pairs(mm)[insMm + 1][1], '4', 'INSUNITS = 4 (мм)');

  // R12 без LWPOLYLINE
  const r12 = exportDxf(doc, { onlyIds: [a.id], version: 'R12' });
  assert.ok(r12.includes('POLYLINE') && !r12.includes('LWPOLYLINE'), 'R12: POLYLINE вместо LWPOLYLINE');
  // точность влияет на число вершин у кривой
  // именно эллипс (не круг): круг уходит как CIRCLE и от допуска не зависит
  const circle = makeObj({ sheetId: sheet.id, layerId: doc.layers[0].id, path: ellipsePath(80, 40), transform: { ...IDENT, e: 80, f: 80 }, style: emptyStyle(doc.layers[0]) });
  doc.objects[circle.id] = circle; doc.order = [a.id, b.id, circle.id];
  const coarse = exportDxf(doc, { onlyIds: [circle.id], tolerance: 0.5 });
  const fine = exportDxf(doc, { onlyIds: [circle.id], tolerance: 0.005 });
  assert.ok(fine.length > coarse.length, 'меньший допуск даёт больше точек');
});

console.log('текст');

atest('текст: шрифт загружается и даёт контуры', async () => {
  const ttf = readFileSync(new URL('../assets/fonts/DejaVuSans-subset.ttf', import.meta.url));
  setFontData(ttf.toString('base64'));
  const ok = await ensureFont();
  assert.ok(ok, 'шрифт разобран');
  const res = textToPaths('Тест 42', 10);
  assert.ok(res, 'текст переведён в кривые');
  assert.ok(res!.paths.length >= 5, `контуров: ${res!.paths.length}`);
  const box = bboxOfSubPaths(res!.paths);
  near(box.y, 0, 1e-6);
  assert.ok(box.h >= 10 && box.h <= 14, `высота заглавных ≈ 10 мм, получено ${box.h}`);
  assert.ok(res!.width > 30, 'ширина посчитана');
});

atest('текст по контуру: буквы идут по дуге и поворачиваются по касательной', async () => {
  const ttf = readFileSync(new URL('../assets/fonts/DejaVuSans-subset.ttf', import.meta.url));
  setFontData(ttf.toString('base64'));
  assert.ok(await ensureFont());

  // базовый контур — окружность радиуса 50 мм
  const circle = [{ closed: true, start: { x: 50, y: 0 }, segs: [
    { t: 'a' as const, a: { x: 50, y: 0 }, b: { x: -50, y: 0 }, center: { x: 0, y: 0 }, r: 50, a0: 0, sweep: Math.PI },
    { t: 'a' as const, a: { x: -50, y: 0 }, b: { x: 50, y: 0 }, center: { x: 0, y: 0 }, r: 50, a0: Math.PI, sweep: Math.PI },
  ] }];
  const res = textOnPath('ДУГА', 10, circle, { align: 'center' });
  assert.ok(res, 'текст по контуру построен');
  assert.ok(res!.paths.length >= 4, `контуров букв: ${res!.paths.length}`);
  assert.ok(Math.abs(res!.lengthMm - Math.PI * 100) < 0.5, `длина контура ≈ 314 мм, получено ${res!.lengthMm.toFixed(1)}`);
  assert.ok(res!.fit, 'надпись короче контура');

  // все буквы лежат в кольце вокруг центра (радиус 50 ± высота буквы)
  for (const sp of res!.paths) {
    const r = Math.hypot(sp.start.x, sp.start.y);
    assert.ok(r > 35 && r < 65, `буква на дуге (r=${r.toFixed(1)})`);
  }

  // без контура и без текста — null
  assert.equal(textOnPath('', 10, circle), null);
  assert.equal(textOnPath('Х', 10, []), null);
});

test('заливка: типы, угол и осевая линия градиента', () => {
  const solid = { fill: '#ff0000', stroke: '#000000', strokeWidth: 0.1, opacity: 1 };
  assert.equal(fillTypeOf(solid), 'solid');
  assert.equal(fillTypeOf({ ...solid, fill: null }), null);
  assert.equal(secondColorOf({ ...solid, fillType: 'linear' }), '#ffffff');
  assert.equal(angleOf({ ...solid, fillType: 'linear', fillAngle: 45 }), 45);

  const box = { x: 0, y: 0, w: 100, h: 40 };
  const line = gradientLine(box, 0);
  near(line.x0, 0, 1e-9);
  near(line.x1, 100, 1e-9);
  near(line.y0, 20, 1e-9);

  const vertical = gradientLine(box, 90);
  near(vertical.y0, 0, 1e-9);
  near(vertical.y1, 40, 1e-9);
  near(vertical.x0, 50, 1e-9);

  near(gradientRadius(box), Math.hypot(100, 40) / 2, 1e-9);
});

test('цвет: HEX ⇄ HSL для палитры и смесителя', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('ff8800'), '#ff8800');
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex('зелёный'), null);

  assert.equal(hslToHex(0, 100, 50), '#ff0000');
  assert.equal(hslToHex(120, 100, 50), '#00ff00');
  assert.equal(hslToHex(240, 100, 50), '#0000ff');
  assert.equal(hslToHex(0, 0, 0), '#000000');
  assert.equal(hslToHex(0, 0, 100), '#ffffff');
  // отрицательный и «перекрученный» оттенок приводится к 0…360
  assert.equal(hslToHex(-120, 100, 50), hslToHex(240, 100, 50));
  assert.equal(hslToHex(480, 100, 50), hslToHex(120, 100, 50));

  const back = hexToHsl('#e53935');
  assert.ok(back.h >= 0 && back.h < 360 && back.s > 50 && back.l > 30, `HSL из красного: ${JSON.stringify(back)}`);
  // обратный перевод обязан попасть в тот же цвет (точность не теряется)
  assert.equal(hslToHex(back.h, back.s, back.l), '#e53935');
  for (const hex of ['#fb8c00', '#1e88e5', '#43a047', '#ffffff', '#000000', '#7f7f7f']) {
    const hsl = hexToHsl(hex);
    assert.equal(hslToHex(hsl.h, hsl.s, hsl.l), hex, `round-trip ${hex}`);
  }
  // серый — без насыщенности
  const gray = hexToHsl('#808080');
  assert.equal(gray.s, 0);
  assert.ok(Math.abs(gray.l - 50) <= 1, `яркость серого ≈ 50%: ${gray.l}`);
});

test('трансформации: масштаб и поворот в матрице', () => {
  const m = compose(translate(10, 10), compose(rotate(Math.PI / 2), scaleM(2, 2)));
  const p = { x: 1, y: 0 };
  const q = { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  near(q.x, 10, 1e-9);
  near(q.y, 12, 1e-9);
  const m2 = mk(1, 0, 0, 1, 5, 6);
  near(m2.e, 5);
});

console.log('эталонные файлы (fixtures)');

const fixture = (rel: string): string => readFileSync(new URL(`./fixtures/${rel}`, import.meta.url), 'utf8');

test('fixture plate-r2000.dxf: скруглённый контур + 4 отверстия + гравировка', () => {
  const { opts: o } = opts();
  const res = importDxf(fixture('dxf/plate-r2000.dxf'), o);
  assert.equal(res.objects.length, 6, `объектов: ${res.objects.length}`);
  const box = res.bbox!;
  near(box.x, 0, 0.01); near(box.y, 0, 0.01);
  near(box.w, 120, 0.01); near(box.h, 80, 0.01);
  const cut = res.objects.filter((obj) => obj.layerId === o.cutLayerId);
  const engrave = res.objects.filter((obj) => obj.layerId === o.engraveLayerId);
  assert.equal(cut.length, 5);
  assert.equal(engrave.length, 1);
  // периметр скруглённого прямоугольника 120×80, r=10: 2(120+80) - 8r + 2πr
  const expected = 2 * (120 + 80) - 8 * 10 + 2 * Math.PI * 10;
  near(pathLength(cut[0].path), expected, 0.05);
});

test('fixture legacy-r12.dxf: POLYLINE, блоки INSERT, ARC', () => {
  const res = importDxf(fixture('dxf/legacy-r12.dxf'), opts().opts);
  assert.equal(res.objects.length, 4, `объектов: ${res.objects.length}`);
  const box = res.bbox!;
  near(box.x, 0, 0.01); near(box.y, 0, 0.01);
  near(box.w, 90, 0.01, );
  near(box.h, 40, 0.01);
  const arcs = res.objects.filter((o) => o.path.some((sp) => sp.segs.some((sg) => sg.t !== 'l')));
  assert.ok(arcs.length >= 2, 'есть кривые (круги блока и дуга)');
});

test('fixture inches.dxf: 2 дюйма = 50,8 мм', () => {
  const res = importDxf(fixture('dxf/inches.dxf'), opts().opts);
  near(pathLength(res.objects[0].path), 50.8, 1e-6);
});

test('fixture svg plate.svg: 4 контура в мм', () => {
  const res = parseSvg(fixture('svg/plate.svg'));
  assert.equal(res.paths.length, 4, `контуров: ${res.paths.length}`);
  const box = bboxOfSubPaths(res.paths);
  near(box.x, 5, 1e-6); near(box.w, 70, 1e-6);
  near(box.y, 5, 1e-6); near(box.h, 40, 1e-6);
});

test('fixture → документ → DXF → импорт: геометрия сохраняется', () => {
  const doc = createDoc();
  const o = {
    sheetId: doc.sheets[0].id,
    cutLayerId: doc.layers[0].id,
    engraveLayerId: doc.layers[1].id,
    cutColor: doc.layers[0].color,
    engraveColor: doc.layers[1].color,
  };
  const res = importDxf(fixture('dxf/plate-r2000.dxf'), o);
  for (const obj of res.objects) { doc.objects[obj.id] = obj; doc.order.push(obj.id); }
  const beforeLen = doc.order.reduce((sum, id) => sum + pathLength(transformSubPaths(doc.objects[id].path, doc.objects[id].transform)), 0);
  const back = importDxf(exportDxf(doc), o);
  assert.equal(back.objects.length, res.objects.length);
  const afterLen = back.objects.reduce((sum, o) => sum + pathLength(o.path), 0);
  // скругления при экспорте идут bulge-дугами, поэтому длина совпадает точно
  near(beforeLen, afterLen, 0.1);
});

console.log('раскладка');

test('nest: детали укладываются без пересечений и в лист', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, w: 60, h: 40 }));
  const res = nestObjects(items, 300, 200, { margin: 5, gap: 3, allowRotate: true });
  assert.equal(res.placements.length, 9);
  const boxes = res.placements.map((p) => ({ x: p.x, y: p.y, w: p.rotated ? 40 : 60, h: p.rotated ? 60 : 40 }));
  for (const b of boxes) {
    assert.ok(b.x >= 5 - 1e-9 && b.x + b.w <= 295 + 1e-9, 'внутри листа по X');
    assert.ok(b.y >= 5 - 1e-9 && b.y + b.h <= 195 + 1e-9, 'внутри листа по Y');
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
      assert.ok(!overlap, `детали ${i} и ${j} не пересекаются`);
    }
  }
  assert.ok(res.fill > 0.3, `заполнение ${res.fill}`);
});

test('nest: слишком большая деталь попадает в unplaced', () => {
  const res = nestObjects([{ id: 'big', w: 500, h: 500 }], 300, 200, { margin: 5, gap: 3, allowRotate: true });
  assert.equal(res.placements.length, 0);
  assert.deepEqual(res.unplaced, ['big']);
});

for (const [name, fn] of atests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log(`\n${passed} тестов пройдено`);
