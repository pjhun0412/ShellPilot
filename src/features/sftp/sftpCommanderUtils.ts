import type { DragEvent } from 'react';

import type { LocalFileEntry, SftpEntry } from './sftpBridge';
import { formatBytes } from './sftpPanelUtils';

export type CommanderPaneVariant = 'local' | 'remote';
export type CommanderEntry = LocalFileEntry | SftpEntry;
export type CommanderSortKey = 'modifiedAt' | 'name' | 'size';
export type CommanderSortState = {
  desc: boolean;
  key: CommanderSortKey;
};
type CommanderPathSegment = {
  label: string;
  path: string;
};

export const COMMANDER_GRID_TEMPLATE = 'minmax(180px,1fr) 144px 104px 8px';
export const COMMANDER_HEADER_CLASS_NAME =
  'grid shrink-0 items-center gap-x-2 border-b border-border/70 bg-slate-950/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground';
export const COMMANDER_BODY_CLASS_NAME = 'grid min-w-full gap-1 py-1.5 pl-2 pr-1';
export const COMMANDER_ROW_CLASS_NAME =
  'mr-2 grid min-h-9 items-center gap-x-2 rounded-md border border-transparent px-3 py-2 text-left text-xs text-foreground outline-none transition-colors hover:border-slate-700/70 hover:bg-slate-800/70 hover:text-foreground focus:outline-none';
export const COMMANDER_MAX_SPLIT_PERCENT = 75;
export const COMMANDER_MIN_SPLIT_PERCENT = 25;
export const COMMANDER_DEFAULT_SORT: CommanderSortState = { desc: false, key: 'name' };
export const COMMANDER_MARQUEE_THRESHOLD = 4;
export const COMMANDER_ACTION_FULL_WIDTH = 292;
export const COMMANDER_ACTION_COMPACT_WIDTH = 224;
export const COMMANDER_ACTION_TIGHT_WIDTH = 164;

const COMMANDER_DRAG_MIME = 'application/x-shellpilot-sftp-commander';

export function getGridTemplateColumns(_variant: CommanderPaneVariant) {
  return COMMANDER_GRID_TEMPLATE;
}

export function sortCommanderEntries(entries: CommanderEntry[], sort: CommanderSortState) {
  return [...entries].sort((left, right) => {
    const direction = sort.desc ? -1 : 1;
    const typeCompare = Number(right.isDirectory) - Number(left.isDirectory);

    if (typeCompare !== 0) {
      return typeCompare;
    }

    const valueCompare = compareCommanderEntryValue(left, right, sort.key);

    if (valueCompare !== 0) {
      return valueCompare * direction;
    }

    return left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function getCommanderEntryPathsInRect(
  container: HTMLElement,
  rect: { bottom: number; left: number; right: number; top: number },
) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-commander-entry-path]'))
    .filter((element) => {
      const bounds = element.getBoundingClientRect();

      return bounds.left <= rect.right
        && bounds.right >= rect.left
        && bounds.top <= rect.bottom
        && bounds.bottom >= rect.top;
    })
    .map((element) => element.dataset.commanderEntryPath)
    .filter((path): path is string => Boolean(path));
}

export function formatEntrySize(entry: CommanderEntry) {
  if (entry.filename === '..') {
    return '';
  }

  if (entry.size === null || entry.size === undefined) {
    return entry.isDirectory ? '-' : '';
  }

  return formatBytes(entry.size);
}

export function handlePaneDragOver(
  event: DragEvent<HTMLElement>,
  targetVariant: CommanderPaneVariant,
  dragSourceVariant?: CommanderPaneVariant,
) {
  if (!dragSourceVariant || dragSourceVariant === targetVariant) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

export function handlePaneDrop(
  event: DragEvent<HTMLElement>,
  targetVariant: CommanderPaneVariant,
  onDropPaths: (paths: string[]) => void,
) {
  const payload = readCommanderDragPayload(event);

  if (!payload || payload.variant === targetVariant || payload.paths.length === 0) {
    return;
  }

  event.preventDefault();
  onDropPaths(payload.paths);
}

export function handleRowDragStart(
  event: DragEvent<HTMLDivElement>,
  variant: CommanderPaneVariant,
  paths: string[],
) {
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData(COMMANDER_DRAG_MIME, JSON.stringify({ paths, variant }));
}

export function formatLocalDisplayPath(path: string) {
  return path
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '');
}

export function isSameLocalRoot(leftPath: string, rightPath: string) {
  return formatLocalDisplayPath(leftPath).replace(/[\\/]+$/, '').toLowerCase()
    === formatLocalDisplayPath(rightPath).replace(/[\\/]+$/, '').toLowerCase();
}

export function getLocalPathSegments(path: string): CommanderPathSegment[] {
  if (!path) {
    return [];
  }

  const normalizedPath = formatLocalDisplayPath(path).replace(/[\\/]+$/, '');

  if (normalizedPath.startsWith('\\\\')) {
    const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);

    if (parts.length === 0) {
      return [{ label: '\\\\', path: '\\\\' }];
    }

    return parts.map((part, index) => {
      const nextPath = `\\\\${parts.slice(0, index + 1).join('\\')}`;

      return {
        label: index === 0 ? `\\\\${part}` : part,
        path: nextPath,
      };
    });
  }

  const driveMatch = normalizedPath.match(/^[A-Za-z]:/);
  const separator = normalizedPath.includes('\\') ? '\\' : '/';
  const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);
  const segments: CommanderPathSegment[] = [];
  let startIndex = 0;

  if (driveMatch) {
    const drive = driveMatch[0];
    segments.push({ label: drive, path: `${drive}\\` });
    startIndex = parts[0] === drive ? 1 : 0;
  } else if (normalizedPath.startsWith('/')) {
    segments.push({ label: '/', path: '/' });
  }

  parts.slice(startIndex).forEach((part, index) => {
    const previousPath = segments[segments.length - 1]?.path ?? '';
    const nextPath = previousPath
      ? joinLocalSegmentPath(previousPath, part)
      : parts.slice(0, startIndex + index + 1).join(separator);

    segments.push({ label: part, path: nextPath });
  });

  return segments.length > 0 ? segments : [{ label: normalizedPath, path: normalizedPath }];
}

function compareCommanderEntryValue(left: CommanderEntry, right: CommanderEntry, key: CommanderSortKey) {
  if (key === 'name') {
    return left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: 'base' });
  }

  if (key === 'modifiedAt') {
    return (left.modifiedAt ?? 0) - (right.modifiedAt ?? 0);
  }

  return (left.size ?? 0) - (right.size ?? 0);
}

function readCommanderDragPayload(event: DragEvent<HTMLElement>) {
  const rawPayload = event.dataTransfer.getData(COMMANDER_DRAG_MIME);

  if (!rawPayload) {
    return undefined;
  }

  try {
    const payload = JSON.parse(rawPayload) as { paths?: unknown; variant?: unknown };

    if (
      (payload.variant === 'local' || payload.variant === 'remote') &&
      Array.isArray(payload.paths) &&
      payload.paths.every((path) => typeof path === 'string')
    ) {
      return {
        paths: payload.paths,
        variant: payload.variant,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function joinLocalSegmentPath(basePath: string, part: string) {
  if (basePath.endsWith('\\') || basePath.endsWith('/')) {
    return `${basePath}${part}`;
  }

  return `${basePath}\\${part}`;
}
