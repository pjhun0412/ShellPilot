import type { ConnectionStatus } from '@/features/connections/connectionStatus';
import type { SftpEntry, SftpTransferEvent } from './sftpBridge';
import type { SftpTransferItem } from './sftpTransferTypes';

export type SftpConnectionState = 'closed' | 'connected' | 'connecting' | 'failed' | 'restored';

export function scrollSftpRowIntoView(row: HTMLElement) {
  const viewport = row.closest<HTMLElement>('[data-sftp-scroll-viewport]');

  if (!viewport) {
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }

  const scrollLeft = viewport.scrollLeft;
  const rowRect = row.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();

  if (rowRect.top < viewportRect.top) {
    viewport.scrollTop -= viewportRect.top - rowRect.top;
  } else if (rowRect.bottom > viewportRect.bottom) {
    viewport.scrollTop += rowRect.bottom - viewportRect.bottom;
  }

  viewport.scrollLeft = scrollLeft;
}

export function isSftpSessionClosedError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes('session closed') ||
    normalized.includes('session is not open') ||
    normalized.includes('sftp session is not open')
  );
}

export function isSftpResidualUploadEntry(entry: SftpEntry) {
  return !entry.isDirectory && (
    entry.filename.includes('.tmp-shellpilot-') ||
    entry.filename.includes('.bak-shellpilot-')
  );
}

export function getSftpEntryPathsInRect({
  container,
  parentEntryPathKey,
  rect,
}: {
  container: HTMLElement;
  parentEntryPathKey: string;
  rect: { bottom: number; left: number; right: number; top: number };
}) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-sftp-entry-path]'))
    .filter((element) => {
      const entryPath = element.dataset.sftpEntryPath;

      if (!entryPath || entryPath === parentEntryPathKey) {
        return false;
      }

      const elementRect = element.getBoundingClientRect();

      return (
        elementRect.left < rect.right &&
        elementRect.right > rect.left &&
        elementRect.top < rect.bottom &&
        elementRect.bottom > rect.top
      );
    })
    .map((element) => element.dataset.sftpEntryPath)
    .filter((entryPath): entryPath is string => Boolean(entryPath));
}

export function resolveSftpUploadDropTargetAt({
  clientX,
  clientY,
  entries,
  panelElement,
  parentEntryPathKey,
  parentPath,
  path,
}: {
  clientX: number;
  clientY: number;
  entries: SftpEntry[];
  panelElement: HTMLElement | null;
  parentEntryPathKey: string;
  parentPath: string | undefined;
  path: string;
}) {
  if (!panelElement) {
    return undefined;
  }

  const panelRect = panelElement.getBoundingClientRect();

  if (
    clientX < panelRect.left ||
    clientX > panelRect.right ||
    clientY < panelRect.top ||
    clientY > panelRect.bottom
  ) {
    return undefined;
  }

  const entryElement = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-sftp-entry-path]');

  if (entryElement && panelElement.contains(entryElement)) {
    const entryPath = entryElement.dataset.sftpEntryPath;

    if (entryPath === parentEntryPathKey && parentPath) {
      return { path: parentPath };
    }

    const entry = entries.find((item) => item.path === entryPath);

    if (entry?.isDirectory) {
      return { path: entry.path };
    }
  }

  return { path };
}

export function isSftpTransferCanceledError(message: string) {
  const normalized = message.toLowerCase();

  return normalized.includes('transfer canceled') || normalized.includes('stream upload is not running');
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function createTransferId() {
  return `sftp-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function mergeTransferEvent(
  previous: SftpTransferItem | undefined,
  next: SftpTransferEvent,
): SftpTransferItem {
  if (!previous) {
    return { ...next, startedAt: next.status === 'queued' ? undefined : Date.now() };
  }

  return {
    ...previous,
    ...next,
    retryPayload: previous.retryPayload,
    startedAt: previous.startedAt ?? (next.status === 'queued' ? undefined : Date.now()),
    status: previous.status === 'paused' && next.status === 'progress' ? 'paused' : next.status,
    totalBytes: next.totalBytes || previous.totalBytes,
    transferredBytes: next.transferredBytes || previous.transferredBytes,
  };
}

export function isSftpTerminalTransferStatus(status: SftpTransferEvent['status']) {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

export async function runLimitedSftpTasks(tasks: Array<() => Promise<void>>, limit: number) {
  let nextIndex = 0;
  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      await task();
    }
  });

  await Promise.all(workers);
}

export function getLocalFileName(path: string) {
  return formatLocalDisplayPath(path).split(/[\\/]/).filter(Boolean).pop() ?? 'upload';
}

export function formatLocalDisplayPath(path: string) {
  return path
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '');
}

export function getAvailableFolderName(entries: Array<{ filename: string }>, baseName = '\uC0C8\uD3F4\uB354') {
  const entryNames = getNormalizedEntryNames(entries);
  const normalizedBaseName = normalizeEntryName(baseName);

  if (!entryNames.has(normalizedBaseName)) {
    return baseName;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseName} (${index})`;

    if (!entryNames.has(normalizeEntryName(candidate))) {
      return candidate;
    }
  }

  return `${baseName}-${Date.now()}`;
}

export function hasEntryNamed(entries: Array<{ filename: string }>, name: string) {
  return getNormalizedEntryNames(entries).has(normalizeEntryName(name));
}

function getNormalizedEntryNames(entries: Array<{ filename: string }>) {
  return new Set(entries.map((entry) => normalizeEntryName(entry.filename)));
}

function normalizeEntryName(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function joinLocalPath(directory: string, filename: string) {
  if (directory.endsWith('/') || directory.endsWith('\\')) {
    return `${directory}${filename}`;
  }

  return `${directory}\\${filename}`;
}

export function mapSftpConnectionStateToStatus(state: SftpConnectionState): ConnectionStatus {
  if (state === 'closed') {
    return 'closed';
  }

  if (state === 'connected') {
    return 'connected';
  }

  if (state === 'connecting') {
    return 'connecting';
  }

  if (state === 'failed') {
    return 'failed';
  }

  return 'restored';
}

export function formatBytes(size: null | number | undefined) {
  if (size === null || size === undefined) {
    return '';
  }

  if (size < 1024) {
    return `${Math.max(0, Math.round(size))} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatModifiedAt(modifiedAt: number | undefined) {
  if (!modifiedAt) {
    return '';
  }

  const date = new Date(modifiedAt * 1000);
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}. ${month}. ${day}. ${hour}:${minute}:${second}`;
}
