/** Базовые типы документа. Единицы — всегда миллиметры. */

export type Id = string;
export type Mm = number;

export interface Vec2 { x: number; y: number }
/** Прямоугольник: x,y — левый нижний угол (ось Y вверх, как в DXF). */
export interface Box { x: number; y: number; w: number; h: number }
/** Аффинная матрица 2×3: [a c e; b d f] — как в Canvas/SVG. */
export interface Mat2x3 { a: number; b: number; c: number; d: number; e: number; f: number }

export type Seg =
  | { t: 'l'; a: Vec2; b: Vec2 }
  | { t: 'c'; a: Vec2; c1: Vec2; c2: Vec2; b: Vec2 }
  | { t: 'a'; a: Vec2; b: Vec2; center: Vec2; r: number; a0: number; sweep: number };

export interface SubPath { closed: boolean; start: Vec2; segs: Seg[] }

export type Op = 'cut' | 'engrave' | 'score';

export interface Layer {
  id: Id;
  name: string;
  op: Op;
  color: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

export interface Guide { id: Id; axis: 'x' | 'y'; at: Mm }

export interface Sheet {
  id: Id;
  name: string;
  width: Mm;
  height: Mm;
  showGrid: boolean;
  gridStep: Mm;
  snapGrid: boolean;
  snapObjects: boolean;
  guides: Guide[];
}

export interface Style {
  fill: string | null;
  /** вид заливки: сплошная (по умолчанию), линейный или радиальный градиент */
  fillType?: 'solid' | 'linear' | 'radial';
  /** второй цвет градиента */
  fill2?: string;
  /** угол линейного градиента в градусах */
  fillAngle?: number;
  stroke: string;
  strokeWidth: Mm;
  opacity: number;
}

export interface ObjBase {
  id: Id;
  sheetId: Id;
  layerId: Id;
  transform: Mat2x3;
  style: Style;
  name?: string;
  locked?: boolean;
  hidden?: boolean;
  /** объекты одной группы выделяются вместе */
  groupId?: Id | null;
}

export type Obj = ObjBase & { kind: 'path'; path: SubPath[] };

export interface Doc {
  schemaVersion: 1;
  units: 'mm';
  sheets: Sheet[];
  activeSheetId: Id;
  layers: Layer[];
  objects: Record<Id, Obj>;
  order: Id[];
  meta: { name: string; createdAt: string; app: 'lasercut-studio' };
}
