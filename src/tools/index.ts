import type { ToolId } from '../state/store';
import type { Tool } from './tool';
import { createSelectTool } from './select';
import { createShapeTool } from './shape';
import { nodeTool } from './node';
import { textTool } from './text';
import { jointTool } from './joint';

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: string;
  available: boolean;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    id: 'select', label: 'Выбор', key: 'V', available: true,
    icon: '<path d="M4 3l9.5 8.2-4.2.7 2.5 5-2.1 1-2.4-5.1L4 16z"/>',
  },
  {
    id: 'line', label: 'Линия', key: 'L', available: true,
    icon: '<path d="M4 17L17 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="4" cy="17" r="1.6"/><circle cx="17" cy="4" r="1.6"/>',
  },
  {
    id: 'rect', label: 'Прямоугольник', key: 'R', available: true,
    icon: '<rect x="4" y="5.5" width="13" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  },
  {
    id: 'ellipse', label: 'Эллипс', key: 'E', available: true,
    icon: '<ellipse cx="10.5" cy="10.5" rx="6.8" ry="5" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  },
  {
    id: 'polygon', label: 'Многоугольник', key: 'P', available: true,
    icon: '<path d="M10.5 3.2l6.4 3.7v7.2l-6.4 3.7-6.4-3.7V6.9z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  },
  {
    id: 'star', label: 'Звезда', key: 'S', available: true,
    icon: '<path d="M10.5 2.8l2.3 4.9 5.3.7-3.9 3.7 1 5.2-4.7-2.6-4.7 2.6 1-5.2L3 8.4l5.3-.7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  },
  {
    id: 'node', label: 'Узлы', key: 'N', available: true,
    icon: '<path d="M4 16c4-9 9-9 13 0" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2.6" y="14.6" width="3" height="3" fill="currentColor"/><rect x="14.4" y="14.6" width="3" height="3" fill="currentColor"/>',
  },
  {
    id: 'joint', label: 'Паз', key: 'J', available: true,
    icon: '<path d="M3.5 5h13v6.5h-4.2V16H7.7v-4.5H3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  },
  {
    id: 'text', label: 'Текст', key: 'T', available: true,
    icon: '<path d="M4 5h13M10.5 5v11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  },
];

export function createTools(): Record<string, Tool> {
  return {
    select: createSelectTool(),
    node: nodeTool,
    line: createShapeTool('line'),
    rect: createShapeTool('rect'),
    ellipse: createShapeTool('ellipse'),
    polygon: createShapeTool('polygon'),
    star: createShapeTool('star'),
    text: textTool,
    joint: jointTool,
  };
}
