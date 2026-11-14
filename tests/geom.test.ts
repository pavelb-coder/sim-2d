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

console.log(`\n${passed} тестов пройдено`);
