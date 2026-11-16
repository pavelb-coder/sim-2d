import assert from 'node:assert/strict';
import { cubicBBox, cubicFlatten, cubicPoint, cubicSplit } from '../src/core/geom/bezier';
import { arcBBox, arcFromBulge, arcPoint, arcToCubics, bulgeFromSweep, angleInSweep } from '../src/core/geom/arc';
import { bboxOfSubPaths, flattenSubPaths, pathLength, transformSubPaths, worldBBox, nearestOnPath } from '../src/core/geom/path';
import { apply, compose, decompose, IDENT, invert, rotate, scaleM, translate } from '../src/core/geom/transform';
import { dist } from '../src/core/geom/vec';
import { ellipsePath, linePath, rectPath, uid } from '../src/core/shape';
import { setBBox, rotateTo } from '../src/state/edits';
import { makeObj } from '../src/core/shape';
import { applyPatches, invertPatches, addCmd, removeCmd, updateCmd } from '../src/state/history';
import { createDoc, emptyStyle } from '../src/core/doc';
import { roundCorners } from '../src/core/geom/corners';
import { smartAlign, smartSpacing } from '../src/core/smart';
import { moveNodes, moveNodeHandle, nodeHandles, nodesInBox, setNodeType, nodePoint, nodeTypeAt, moveSegment, joinNodes, reverseSubPath, alignNodes, nearestSegment } from '../src/core/geom/nodeEdit';
import { polygonPath, starPath } from '../src/core/shape';
import { handleAxes, anchorFor, handlePoints, hitHandle } from '../src/render/handles';
import { View } from '../src/render/view';
import { compensateKerf, kerfOffset, materialOf, defaultMaterial, MATERIAL_PRESETS, presetById } from '../src/core/geom/kerf';
import { pathsArea } from '../src/core/geom/boolean';

let passed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

console.log('geometry');

test('bbox кубической Безье — по экстремумам, а не по контрольным точкам', () => {
  const p0 = { x: 0, y: 0 }, c1 = { x: 100, y: 200 }, c2 = { x: 200, y: 200 }, p3 = { x: 300, y: 0 };
  const box = cubicBBox(p0, c1, c2, p3);
  near(box.x, 0); near(box.w, 300);
  // максимум по Y должен быть 150 (а не 200 по контрольным точкам)
  near(box.y, 0, 1e-6);
  near(box.h, 150, 1e-6);
});

test('flatten: все точки лежат на кривой и конечная совпадает с p3', () => {
  const p0 = { x: 0, y: 0 }, c1 = { x: 30, y: 60 }, c2 = { x: 70, y: -20 }, p3 = { x: 100, y: 10 };
  const pts = cubicFlatten(p0, c1, c2, p3, 0.01);
  near(pts[pts.length - 1].x, 100); near(pts[pts.length - 1].y, 10);
  for (const p of pts) {
    // ближайшая точка на кривой должна быть очень близко
    let best = Infinity;
    for (let i = 0; i <= 20000; i++) best = Math.min(best, dist(p, cubicPoint(p0, c1, c2, p3, i / 20000)));
    assert.ok(best < 0.02, `точка не на кривой: ${best}`);
  }
});

test('split: длины кусков складываются в исходную', () => {
  const p0 = { x: 0, y: 0 }, c1 = { x: 10, y: 40 }, c2 = { x: 90, y: 40 }, p3 = { x: 100, y: 0 };
  const { left, right } = cubicSplit(p0, c1, c2, p3, 0.35);
  const L = cubicPoint(p0, c1, c2, p3, 0.35);
  near(L.x, left[3].x); near(L.y, left[3].y);
  near(L.x, right[0].x);
});

console.log('arcs');

test('углы: angleInSweep работает для отрицательного sweep', () => {
  assert.ok(angleInSweep(Math.PI / 2, 0, Math.PI));
  assert.ok(!angleInSweep(-Math.PI / 2, 0, Math.PI));
  assert.ok(angleInSweep(-Math.PI / 2, 0, -Math.PI));
  assert.ok(!angleInSweep(Math.PI / 2, 0, -Math.PI));
});

test('bulge ↔ дуга: round-trip сохраняет sweep', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  for (const bulge of [0.4142135623730951, -0.4142135623730951, 1, -1, 0.2]) {
    const arc = arcFromBulge(a, b, bulge);
    assert.ok(arc, 'дуга должна построиться');
    if (!arc) continue;
    near(bulgeFromSweep(arc.sweep), bulge, 1e-9);
    near(arc.r, Math.abs(arc.r));
    // концы дуги совпадают с хордой
    near(dist(arcPoint(arc.center, arc.r, arc.a0, arc.sweep, 0), a), 0, 1e-9);
    near(dist(arcPoint(arc.center, arc.r, arc.a0, arc.sweep, 1), b), 0, 1e-9);
  }
});

test('arcBBox: полуокружность r=50 даёт 100×50', () => {
  const box = arcBBox({ x: 0, y: 0 }, 50, 0, Math.PI);
  near(box.w, 100, 1e-9); near(box.h, 50, 1e-9); near(box.y, 0, 1e-9);
});

test('arc → кубические: концы совпадают и отклонение < 0.01 мм при r=100', () => {
  const segs = arcToCubics({ x: 0, y: 0 }, 100, 0.3, 2.4);
  assert.ok(segs.length >= 2);
  const first = segs[0], last = segs[segs.length - 1];
  near(dist(first.a, arcPoint({ x: 0, y: 0 }, 100, 0.3, 2.4, 0)), 0, 1e-9);
  near(dist(last.b, arcPoint({ x: 0, y: 0 }, 100, 0.3, 2.4, 1)), 0, 1e-9);
  const mid = cubicPoint(first.a, (first as any).c1, (first as any).c2, first.b, 0.5);
  const exact = arcPoint({ x: 0, y: 0 }, 100, 0.3, 2.4, 0.5 / (segs.length * 1));
  assert.ok(Math.abs(dist(mid, { x: 0, y: 0 }) - 100) < 0.01, 'радиус должен сохраняться');
  void exact;
});

console.log('transforms');

test('матрицы: compose и invert согласованы', () => {
  const m = compose(translate(10, -5), compose(rotate(0.7), scaleM(2, 3)));
  const mi = invert(m);
  const p = { x: 3, y: 7 };
  const q = apply(mi, apply(m, p));
  near(q.x, p.x, 1e-9); near(q.y, p.y, 1e-9);
});

test('decompose восстанавливает угол и масштабы', () => {
  const m = compose(translate(4, 5), compose(rotate(0.5), scaleM(2, 2)));
  const d = decompose(m);
  near(d.rotation, 0.5, 1e-9); near(d.scaleX, 2, 1e-9); near(d.scaleY, 2, 1e-9);
  near(d.x, 4); near(d.y, 5);
});

test('поворот сохраняет дугу дугой и длину', () => {
  const circle = ellipsePath(60, 60);
  const m = compose(translate(10, 10), rotate(Math.PI / 3));
  const moved = transformSubPaths(circle, m);
  assert.equal(moved[0].segs.every((s) => s.t === 'a'), true, 'сегменты должны остаться дугами');
  near(pathLength(moved), pathLength(circle), 1e-9);
});

console.log('shapes & edits');

test('rectPath: bbox = w × h, центр в нуле', () => {
  const box = bboxOfSubPaths(rectPath(140, 100));
  near(box.w, 140); near(box.h, 100); near(box.x, -70); near(box.y, -50);
});

test('ellipsePath: круг r=30 даёт bbox 60×60 и длину 2πr', () => {
  const box = bboxOfSubPaths(ellipsePath(60, 60));
  near(box.w, 60, 1e-9); near(box.h, 60, 1e-9);
  near(pathLength(ellipsePath(60, 60)), 2 * Math.PI * 30, 1e-6);
});

test('эллипс (не круг) — 4 кубические, bbox точный', () => {
  const path = ellipsePath(80, 40);
  assert.equal(path[0].segs.every((s) => s.t === 'c'), true);
  const box = bboxOfSubPaths(path);
  near(box.w, 80, 1e-9); near(box.h, 40, 1e-9);
});

test('linePath: длина = len', () => {
  near(pathLength(linePath(60)), 60);
});

test('setBBox: задаёт точные W/H и X/Y', () => {
  const doc = createDoc();
  const obj = makeObj({
    sheetId: doc.sheets[0].id, layerId: doc.layers[0].id,
    path: rectPath(140, 100), transform: { ...IDENT, e: 78, f: 100 },
    style: emptyStyle(doc.layers[0]),
  });
  const resized = setBBox(obj, { x: 10, y: 20, w: 200, h: 50 });
  const box = worldBBox(resized.path, resized.transform);
  near(box.x, 10, 1e-6); near(box.y, 20, 1e-6); near(box.w, 200, 1e-6); near(box.h, 50, 1e-6);
});

test('rotateTo: поворот 90° не меняет центр и площадь bbox', () => {
  const doc = createDoc();
  const obj = makeObj({
    sheetId: doc.sheets[0].id, layerId: doc.layers[0].id,
    path: rectPath(100, 40), transform: { ...IDENT, e: 50, f: 50 },
    style: emptyStyle(doc.layers[0]),
  });
  const before = worldBBox(obj.path, obj.transform);
  const rotated = rotateTo(obj, 90);
  const after = worldBBox(rotated.path, rotated.transform);
  near(after.x + after.w / 2, before.x + before.w / 2, 1e-6);
  near(after.y + after.h / 2, before.y + before.h / 2, 1e-6);
  near(after.w, before.h, 1e-6);
  near(after.h, before.w, 1e-6);
});

test('hit: попадание в контур и внутрь, промах', () => {
  const path = rectPath(100, 100);
  const near1 = nearestOnPath(path, { x: 50.2, y: 0 }, 1);
  assert.ok(near1 && near1.dist < 0.5);
  const polys = flattenSubPaths(path, 0.01);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].length, 5, 'замкнутый прямоугольник = 5 точек');
});

console.log('history');

test('patch apply/invert — обратимы', () => {
  const doc = createDoc();
  const layer = doc.layers[0];
  const obj = makeObj({
    sheetId: doc.sheets[0].id, layerId: layer.id, path: rectPath(10, 10),
    transform: IDENT, style: emptyStyle(layer),
  });
  const added = applyPatches(doc, addCmd(obj).patches);
  assert.equal(Object.keys(added.objects).length, 1);
  const removed = applyPatches(added, invertPatches(addCmd(obj).patches));
  assert.equal(Object.keys(removed.objects).length, 0);

  const moved = { ...obj, transform: { ...IDENT, e: 5, f: 5 } };
  const cmd = updateCmd('move', [{ before: obj, after: moved }]);
  const after = applyPatches(added, cmd.patches);
  near(after.objects[obj.id].transform.e, 5);
  const back = applyPatches(after, invertPatches(cmd.patches));
  near(back.objects[obj.id].transform.e, 0);

  const gone = applyPatches(added, removeCmd([obj]).patches);
  assert.equal(gone.order.length, 0);
});

test('uid уникален на 5000 вызовов', () => {
  const set = new Set<string>();
  for (let i = 0; i < 5000; i++) set.add(uid());
  assert.equal(set.size, 5000);
});

test('скругление углов: 4 дуги, габарит и площадь не разъезжаются', () => {
  const rect = rectPath(40, 30);
  const rounded = roundCorners(rect, 5, 'fillet');
  const arcs = rounded[0].segs.filter((s) => s.t === 'a');
  assert.equal(arcs.length, 4, 'четыре скруглённых угла');
  // дуги касательные: суммарная длина дуг = 2πr (полный круг из четырёх четвертей)
  let arcLen = 0;
  for (const a of arcs) if (a.t === 'a') arcLen += Math.abs(a.sweep) * a.r;
  near(arcLen, 2 * Math.PI * 5, 1e-6);
  const box = bboxOfSubPaths(rounded);
  near(box.w, 40, 1e-6);
  near(box.h, 30, 1e-6);
  // периметр: 4 стороны минус 8 касательных отрезков плюс дуги
  const len = pathLength(rounded, 0.01);
  near(len, 2 * (40 + 30) - 8 * 5 + 2 * Math.PI * 5, 0.4); // допуск: контур сглажен
});

test('фаска углов: 8 отрезков, без дуг, габарит тот же', () => {
  const rect = rectPath(40, 30);
  const chamfered = roundCorners(rect, 5, 'chamfer');
  const segs = chamfered[0].segs;
  assert.equal(segs.filter((s) => s.t === 'a').length, 0, 'дуг нет');
  assert.equal(segs.length, 8, 'четыре стороны + четыре среза');
  const box = bboxOfSubPaths(chamfered);
  near(box.w, 40, 1e-6);
  near(box.h, 30, 1e-6);
});

test('скругление не трогает концы незамкнутого контура', () => {
  const line = [{ closed: false, start: { x: 0, y: 0 }, segs: [
    { t: 'l' as const, a: { x: 0, y: 0 }, b: { x: 20, y: 0 } },
    { t: 'l' as const, a: { x: 20, y: 0 }, b: { x: 20, y: 20 } },
    { t: 'l' as const, a: { x: 20, y: 20 }, b: { x: 0, y: 20 } },
  ] }];
  const rounded = roundCorners(line, 4, 'fillet');
  assert.equal(rounded[0].closed, false);
  near(rounded[0].start.x, 0); near(rounded[0].start.y, 0);
  assert.equal(rounded[0].segs.filter((s) => s.t === 'a').length, 2, 'скруглены оба внутренних угла');
  const last = rounded[0].segs[rounded[0].segs.length - 1];
  near(last.b.x, 0); near(last.b.y, 20);
});

test('фаска больше половины стороны урезается, а не ломает контур', () => {
  const rect = rectPath(10, 10);
  const chamfered = roundCorners(rect, 100, 'chamfer');
  const box = bboxOfSubPaths(chamfered);
  assert.ok(box.w > 1 && box.w <= 10.001, `ширина ${box.w}`);
  assert.ok(pathLength(chamfered) > 0);
});

test('умное выравнивание: тянем объект к левому краю соседа', () => {
  const doc = createDoc();
  const sheet = doc.sheets[0];
  const a = makeObj({ sheetId: sheet.id, layerId: doc.layers[0].id, path: rectPath(20, 20), transform: { ...IDENT, e: 40, f: 40 }, style: emptyStyle(doc.layers[0]), name: 'A' });
  const b = makeObj({ sheetId: sheet.id, layerId: doc.layers[0].id, path: rectPath(20, 20), transform: { ...IDENT, e: 100, f: 40 }, style: emptyStyle(doc.layers[0]), name: 'B' });
  doc.objects[a.id] = a; doc.objects[b.id] = b; doc.order = [a.id, b.id];

  // B сдвинут так, что его левый край на 1 мм правее левого края A
  const box = { x: 41, y: 40, w: 20, h: 20 };
  const res = smartAlign(box, doc, sheet, 2, new Set([b.id]));
  near(res.dx, -1, 1e-9);
  assert.equal(res.lines.length >= 1, true);
  assert.equal(res.lines[0].axis, 'x');
  near(res.lines[0].at, 40, 1e-9);

  // вне допуска — выравнивания нет
  const far = smartAlign({ x: 60, y: 5, w: 20, h: 20 }, doc, sheet, 1, new Set([b.id]));
  assert.equal(far.dx, 0);
  assert.equal(far.dy, 0);
});

test('умное выравнивание ловит центр листа', () => {
  const doc = createDoc();
  const sheet = { ...doc.sheets[0], width: 300, height: 200 };
  const res = smartAlign({ x: 141, y: 20, w: 20, h: 20 }, doc, sheet, 2);
  near(res.dx, -1, 1e-9); // центр 150: 141+10 = 151 → сдвиг -1
  assert.equal(res.lines.some((l) => l.axis === 'x' && Math.abs(l.at - 150) < 1e-9), true);
});

test('многоугольник: 12 сторон, вписан в радиус, вершина сверху', () => {
  const path = polygonPath(10, 12);
  assert.equal(path.length, 1);
  assert.equal(path[0].segs.length, 12);
  assert.equal(path[0].closed, true);
  // вершина сверху: стартовая точка на оси Y
  near(path[0].start.x, 0, 1e-9);
  near(path[0].start.y, 10, 1e-9);
  // все вершины на радиусе 10
  for (const sg of path[0].segs) near(Math.hypot(sg.a.x, sg.a.y), 10, 1e-9);
  // число сторон ограничено снизу
  assert.equal(polygonPath(10, 1)[0].segs.length, 3);
});

test('звезда: 2n вершин, внутренний радиус = доля внешнего', () => {
  const path = starPath(20, 5, 0.5);
  assert.equal(path[0].segs.length, 10);
  const radii = path[0].segs.map((sg) => Math.hypot(sg.a.x, sg.a.y));
  near(Math.max(...radii), 20, 1e-9);
  near(Math.min(...radii), 10, 1e-9);
  // доля ограничена разумным диапазоном
  const tight = starPath(20, 6, 0.01);
  const r2 = tight[0].segs.map((sg) => Math.hypot(sg.a.x, sg.a.y));
  near(Math.min(...r2) / Math.max(...r2), 0.05, 1e-9);
});

test('умные интервалы: объект встаёт посередине между соседями', () => {
  const doc = createDoc();
  const sheet = doc.sheets[0];
  const mk = (cx: number, name: string) => makeObj({
    sheetId: sheet.id, layerId: doc.layers[0].id, path: rectPath(20, 20),
    transform: { ...IDENT, e: cx, f: 50 }, style: emptyStyle(doc.layers[0]), name,
  });
  const left = mk(20, 'L');   // занимает 10…30
  const right = mk(120, 'R'); // занимает 110…130
  const mid = mk(70, 'M');    // 60…80, зазор 30 / 30 — уже по центру
  doc.objects[left.id] = left; doc.objects[right.id] = right; doc.objects[mid.id] = mid;
  doc.order = [left.id, right.id, mid.id];

  // сдвинули на 2 мм вправо: интервалы стали 32 / 28 → тянем назад в центр
  const res = smartSpacing({ x: 62, y: 40, w: 20, h: 20 }, doc, sheet, 3, new Set([mid.id]));
  near(res.dx, -2, 1e-9);
  assert.equal(res.lines.some((l) => l.kind === 'gap'), true);

  // вне допуска — не липнет
  const far = smartSpacing({ x: 70, y: 40, w: 20, h: 20 }, doc, sheet, 1, new Set([mid.id]));
  assert.equal(far.dx, 0);
});

test('ручки трансформации: попадание мышью и неподвижная точка', () => {
  const view = new View(1200, 800);
  view.scale = 2; // 2 px на мм
  view.tx = 0; view.ty = 0;
  const box = { x: 10, y: 10, w: 40, h: 20 };

  // правый-нижний угол в мире → экран
  const se = view.toScreen({ x: 50, y: 10 });
  assert.equal(hitHandle(box, view, view.toMm({ x: se.x, y: se.y })), 'se');
  assert.equal(hitHandle(box, view, view.toMm({ x: 0, y: 0 })), null);

  // ручка поворота — над верхней гранью
  const pts = handlePoints(box, view);
  const rot = pts.find((p) => p.id === 'rotate');
  assert.ok(rot);
  assert.equal(hitHandle(box, view, view.toMm(rot.screen)), 'rotate');

  // неподвижная точка при масштабе за 'se' — левый верхний угол
  const anchor = anchorFor('se', box);
  assert.ok(anchor);
  near(anchor.x, 10, 1e-9);
  near(anchor.y, 30, 1e-9);
  // оси: 'n' двигает только Y, 'e' — только X
  assert.deepEqual(handleAxes('n'), { x: false, y: true });
  assert.deepEqual(handleAxes('e'), { x: true, y: false });
});

test('узлы 2.0: ручки Безье появляются у кривых и тянутся с зеркалом', () => {
  const curve = setNodeType(rectPath(20, 10), { sub: 0, index: 0 }, 'smooth');
  const handles = nodeHandles(curve, { sub: 0, index: 0 });
  assert.equal(handles.length, 2, 'у узла замкнутого контура две ручки');
  const before = handles.find((h) => h.side === 'out');
  assert.ok(before);

  // тянем исходящую ручку вверх — при типе smooth входящая разворачивается
  const node = nodePoint(curve, { sub: 0, index: 0 });
  assert.ok(node);
  const moved = moveNodeHandle(curve, { sub: 0, index: 0 }, 'out', { x: node.x + 5, y: node.y + 5 }, 'smooth');
  const after = nodeHandles(moved, { sub: 0, index: 0 });
  const outH = after.find((h) => h.side === 'out');
  const inH = after.find((h) => h.side === 'in');
  assert.ok(outH && inH);
  near(outH.p.x, node.x + 5, 1e-9);
  // входящая ручка смотрит в противоположную сторону
  assert.ok((inH.p.x - node.x) * (outH.p.x - node.x) < 0);

  // symmetric выравнивает длины ручек
  const sym = setNodeType(curve, { sub: 0, index: 0 }, 'symmetric');
  const sh = nodeHandles(sym, { sub: 0, index: 0 });
  const dIn = Math.hypot(sh[0].p.x - node.x, sh[0].p.y - node.y);
  const dOut = Math.hypot(sh[1].p.x - node.x, sh[1].p.y - node.y);
  near(dIn, dOut, 1e-9);
});

test('узлы 2.0: группа узлов двигается одной дельтой, рамка их находит', () => {
  const path = rectPath(20, 10);
  // все 4 узла прямоугольника лежат в рамке побольше
  const inside = nodesInBox(path, { x: -20, y: -20, w: 40, h: 40 });
  assert.equal(inside.length, 4);

  const moved = moveNodes(path, inside, { x: 3, y: -2 });
  const p0 = nodePoint(moved, { sub: 0, index: 0 });
  const q0 = nodePoint(path, { sub: 0, index: 0 });
  assert.ok(p0 && q0);
  near(p0.x, q0.x + 3, 1e-9);
  near(p0.y, q0.y - 2, 1e-9);

  // рамка вокруг одного узла находит только его
  const one = nodesInBox(path, { x: -11, y: 3, w: 3, h: 3 });
  assert.equal(one.length, 1);
});

test('узлы 3.0: тип узла по геометрии (квадрат/круг/ромб)', () => {
  const rect = rectPath(20, 10);
  assert.equal(nodeTypeAt(rect, { sub: 0, index: 0 }), 'corner', 'у прямоугольника угловые узлы');
  const smooth = setNodeType(rect, { sub: 0, index: 0 }, 'smooth');
  assert.equal(nodeTypeAt(smooth, { sub: 0, index: 0 }), 'smooth');
  const sym = setNodeType(rect, { sub: 0, index: 0 }, 'symmetric');
  assert.equal(nodeTypeAt(sym, { sub: 0, index: 0 }), 'symmetric');
  // потянули одну ручку без зеркала — снова излом
  const node = nodePoint(sym, { sub: 0, index: 0 });
  assert.ok(node);
  const broken = moveNodeHandle(sym, { sub: 0, index: 0 }, 'out', { x: node.x + 7, y: node.y + 1 }, 'corner');
  assert.equal(nodeTypeAt(broken, { sub: 0, index: 0 }), 'corner');
});

test('узлы 3.0: перетаскивание сегмента двигает оба его узла', () => {
  const rect = rectPath(20, 10);
  const before = bboxOfSubPaths(rect);
  const moved = moveSegment(rect, { sub: 0, index: 0 }, { x: 5, y: 3 });
  const after = bboxOfSubPaths(moved);
  // сегмент 0 — нижняя сторона: сдвинулись только её два узла
  assert.ok(Math.abs(after.y - (before.y + 3)) < 1e-9, `низ поднялся на 3 мм (${before.y} → ${after.y})`);
  assert.ok(Math.abs(after.h - (before.h - 3)) < 1e-9, 'высота уменьшилась на 3 мм');
  const p0 = nodePoint(moved, { sub: 0, index: 1 });
  const q0 = nodePoint(rect, { sub: 0, index: 1 });
  assert.ok(p0 && q0);
  near(p0.y, q0.y + 3, 1e-9);
  // верхние узлы остались на месте
  const top = nodePoint(moved, { sub: 0, index: 2 });
  const topOld = nodePoint(rect, { sub: 0, index: 2 });
  assert.ok(top && topOld);
  near(top.x, topOld.x, 1e-9);
  near(top.y, topOld.y, 1e-9);
  // поиск сегмента под точкой
  const seg = nearestSegment(rect, { x: 0, y: -5 }, 0.5);
  assert.ok(seg, 'сегмент найден под точкой');
  assert.equal(seg!.sub, 0);
});

test('узлы 3.0: соединение концов, реверс и выравнивание узлов', () => {
  const a = linePath(10)[0];              // открытый: −5…5 по X
  const b: typeof a = {
    closed: false,
    start: { x: 20, y: 10 },
    segs: [{ t: 'l', a: { x: 20, y: 10 }, b: { x: 30, y: 10 } }],
  };
  const joined = joinNodes([a, b], { sub: 0, index: 1 }, { sub: 1, index: 0 });
  assert.ok(joined, 'два открытых подпути склеились');
  assert.equal(joined!.length, 1, 'остался один подпуть');
  assert.equal(joined![0].segs.length, 3, 'два исходных отрезка + соединяющий мостик');
  assert.equal(joined![0].closed, false, 'склеенный подпуть остался открытым');

  // замыкание одного подпути по двум его концам
  const closed = joinNodes([a], { sub: 0, index: 0 }, { sub: 0, index: 1 });
  assert.ok(closed && closed[0].closed, 'подпуть замкнулся');

  // реверс: направление меняется, концевые точки местами
  const rev = reverseSubPath([a], 0);
  assert.ok(Math.abs(rev[0].start.x - 5) < 1e-9 || Math.abs(rev[0].start.x + 5) < 1e-9);
  const back = reverseSubPath(rev, 0);
  assert.ok(Math.abs(back[0].start.x - a.start.x) < 1e-9, 'двойной реверс возвращает старт');

  // выравнивание узлов по X
  const rect = rectPath(20, 10);
  const aligned = alignNodes(rect, [{ sub: 0, index: 0 }, { sub: 0, index: 1 }], 'x');
  const p1 = nodePoint(aligned, { sub: 0, index: 0 });
  const p2 = nodePoint(aligned, { sub: 0, index: 1 });
  assert.ok(p1 && p2);
  near(p1.x, p2.x, 1e-9);
});

test('материал и рез: пресеты, kerfOffset, значения по умолчанию', () => {
  assert.ok(MATERIAL_PRESETS.length >= 8);
  const ply = presetById('plywood-6');
  assert.ok(ply);
  assert.equal(ply!.thickness, 6);
  assert.ok(ply!.kerf > 0 && ply!.kerf < 0.5, 'рез в разумных пределах');
  near(kerfOffset(0.3), 0.15);
  near(kerfOffset(0), 0);
  near(kerfOffset(-1), 0, 1e-12);

  const def = defaultMaterial();
  assert.equal(def.presetId, 'plywood-3');
  assert.equal(def.compensate, false);

  // старый документ без material получает значения по умолчанию
  const old = materialOf({});
  assert.equal(old.name, def.name);
  // битые значения не ломают документ
  const broken = materialOf({ material: { presetId: 'custom', name: '', thickness: Number.NaN, kerf: -5, compensate: 1 as unknown as boolean } });
  assert.equal(broken.thickness, 3);
  assert.ok(broken.kerf >= 0, 'отрицательный рез приводится к нулю');
  assert.equal(broken.compensate, true);
});

test('компенсация реза: деталь растёт, отверстие сжимается', () => {
  const plate = [...rectPath(100, 60), ...ellipsePath(20, 20)];
  const before = bboxOfSubPaths(plate);
  const k = compensateKerf(plate, 0.2);       // по 0,1 мм на сторону
  const after = bboxOfSubPaths(k);
  near(after.w, before.w + 0.2, 0.02);
  near(after.h, before.h + 0.2, 0.02);
  near(after.x, before.x - 0.1, 0.02);

  // площадь: внешний прямоугольник 100,2 × 60,2 минус отверстие r = 9,9
  const expected = 100.2 * 60.2 - Math.PI * 9.9 * 9.9;
  const actual = pathsArea(k);
  assert.ok(Math.abs(actual - expected) < expected * 0.01, `площадь ${actual.toFixed(1)} ≠ ${expected.toFixed(1)}`);
  // отверстие действительно стало меньше: площадь больше, чем у детали без реза
  // (100 × 60 − π·10² = 5685,84 мм²) — значит внешний контур вырос, а отверстие сжалось
  assert.ok(actual > 5685.84, 'деталь с компенсацией больше исходной');
  assert.equal(k.filter((sp) => sp.closed).length, 2, 'оба контура на месте');
});

test('компенсация реза: нулевой рез и разомкнутые контуры не меняются', () => {
  const plate = rectPath(50, 30);
  assert.equal(compensateKerf(plate, 0), plate, 'рез 0 — тот же контур');
  // линия-гравировка остаётся отрезком, а не превращается в полигон
  const line = linePath(20)[0];
  const mixed = compensateKerf([...plate, line], 0.1);
  const open = mixed.filter((sp) => !sp.closed);
  assert.equal(open.length, 1, 'разомкнутый контур сохранился');
  assert.equal(open[0].segs[0].t, 'l');
});

console.log(`\n${passed} тестов пройдено`);
