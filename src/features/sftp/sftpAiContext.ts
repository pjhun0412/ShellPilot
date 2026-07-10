import type { SftpEntry } from './sftpBridge';

export interface SftpAiEntrySnapshot {
  filename: string;
  isDirectory: boolean;
  kind: SftpEntry['kind'];
  modifiedAt?: number;
  owner?: string;
  path: string;
  permissions?: string;
  size?: number;
}

export interface SftpAiContextSnapshot {
  connectionState: string;
  entries: SftpAiEntrySnapshot[];
  host?: string;
  isLoading: boolean;
  path: string;
  selectedEntries: SftpAiEntrySnapshot[];
  sessionName?: string;
  showHiddenEntries: boolean;
  totalEntryCount: number;
  username?: string;
  visibleEntryCount: number;
}

const sftpAiContextSnapshots = new Map<string, SftpAiContextSnapshot>();

export function publishSftpAiContextSnapshot(panelId: string, snapshot: SftpAiContextSnapshot) {
  sftpAiContextSnapshots.set(panelId, {
    ...snapshot,
    entries: snapshot.entries.map(toEntrySnapshot).slice(0, 200),
    selectedEntries: snapshot.selectedEntries.map(toEntrySnapshot).slice(0, 50),
  });
}

export function clearSftpAiContextSnapshot(panelId: string) {
  sftpAiContextSnapshots.delete(panelId);
}

export function readSftpAiContextSnapshot(panelId: string) {
  return sftpAiContextSnapshots.get(panelId);
}

function toEntrySnapshot(entry: SftpEntry | SftpAiEntrySnapshot): SftpAiEntrySnapshot {
  return {
    filename: entry.filename,
    isDirectory: entry.isDirectory,
    kind: entry.kind,
    modifiedAt: entry.modifiedAt,
    owner: entry.owner,
    path: entry.path,
    permissions: entry.permissions,
    size: entry.size,
  };
}
