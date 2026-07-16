import { appChoose } from '@/components/ui/app-dialog';
import { listSftpDirectory, type SftpEntry } from './sftpBridge';
import { createTransferId, formatLocalDisplayPath } from './sftpPanelUtils';
import type { SftpTransferItem } from './sftpTransferTypes';

export type SftpFileConflictCarryAction = 'overwrite' | 'skip' | undefined;

type SftpFileConflictAction = 'cancel' | 'overwrite' | 'overwrite-all' | 'skip' | 'skip-all';

export async function getEntriesForTransferTargetDirectory({
  currentEntries,
  currentPath,
  panelId,
  setError,
  targetDirectory,
}: {
  currentEntries: SftpEntry[];
  currentPath: string;
  panelId: string;
  setError: (message: string) => void;
  targetDirectory: string;
}) {
  try {
    return targetDirectory === currentPath
      ? currentEntries
      : (await listSftpDirectory(panelId, targetDirectory)).entries;
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export async function chooseFileConflictDecision({
  conflictActionForRemaining,
  filename,
  targetDirectory,
  title,
}: {
  conflictActionForRemaining: SftpFileConflictCarryAction;
  filename: string;
  targetDirectory: string;
  title: string;
}) {
  const action = conflictActionForRemaining ?? await chooseFileConflict(filename, targetDirectory, title);

  if (action === 'cancel' || action === undefined) {
    return {
      conflictActionForRemaining,
      shouldCancel: true,
      shouldSkip: false,
    };
  }

  const nextConflictAction = action === 'overwrite-all'
    ? 'overwrite'
    : action === 'skip-all'
      ? 'skip'
      : conflictActionForRemaining;

  return {
    conflictActionForRemaining: nextConflictAction,
    shouldCancel: false,
    shouldSkip: action === 'skip' || action === 'skip-all' || nextConflictAction === 'skip',
  };
}

export function createPathUploadTransferItem({
  localPath,
  panelId,
  remotePath,
}: {
  localPath: string;
  panelId: string;
  remotePath: string;
}) {
  const transferId = createTransferId();

  return {
    transfer: {
      direction: 'upload',
      localPath,
      message: undefined,
      panelId,
      remotePath,
      retryPayload: { kind: 'path-upload', localPath, remotePath },
      status: 'started',
      totalBytes: 0,
      transferredBytes: 0,
      transferId,
    } satisfies SftpTransferItem,
    transferId,
  };
}

export function createDroppedUploadTransferItem({
  file,
  filename,
  panelId,
  remotePath,
}: {
  file: File;
  filename: string;
  panelId: string;
  remotePath: string;
}) {
  const transferId = createTransferId();

  return {
    transfer: {
      direction: 'upload',
      localPath: filename,
      message: undefined,
      panelId,
      remotePath,
      retryPayload: { file, kind: 'drop-upload', relativePath: filename, remotePath },
      status: 'started',
      totalBytes: file.size,
      transferredBytes: 0,
      transferId,
    } satisfies SftpTransferItem,
    transferId,
  };
}

export function createDownloadTransferItem({
  entry,
  localPath,
  panelId,
}: {
  entry: SftpEntry;
  localPath: string;
  panelId: string;
}) {
  const transferId = createTransferId();
  const totalBytes = entry.size ?? 0;

  return {
    transfer: {
      direction: 'download',
      localPath,
      message: undefined,
      panelId,
      remotePath: entry.path,
      retryPayload: {
        kind: 'download',
        localPath,
        remotePath: entry.path,
        totalBytes,
      },
      status: 'started',
      totalBytes,
      transferredBytes: 0,
      transferId,
    } satisfies SftpTransferItem,
    transferId,
  };
}

function chooseFileConflict(filename: string, targetDirectory: string, title: string) {
  return appChoose<SftpFileConflictAction>({
    choices: [
      { label: 'Overwrite', tone: 'danger', value: 'overwrite' },
      { label: 'Overwrite All', tone: 'danger', value: 'overwrite-all' },
      { label: 'Skip', value: 'skip' },
      { label: 'Skip All', value: 'skip-all' },
      { label: 'Cancel', value: 'cancel' },
    ],
    message: `${filename} already exists in ${formatLocalDisplayPath(targetDirectory)}.\nChoose how to continue.`,
    title,
  });
}
