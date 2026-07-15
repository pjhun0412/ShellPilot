import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

import { appChoose } from '@/components/ui/app-dialog';
import {
  cancelSftpTransfer,
  closeSftpUploadStream,
  createSftpDirectory,
  downloadSftpFile,
  listSftpDirectory,
  openSftpUploadStream,
  uploadSftpFile,
  writeSftpUploadStreamChunk,
  type SftpEntry,
} from './sftpBridge';
import {
  getDroppedUploadPlan,
  getSftpAncestorPaths,
  getSftpTopLevelPathName,
  joinSftpPath,
  type SftpDroppedUploadPlan,
} from './sftpPathUtils';
import {
  createTransferId,
  getLocalFileName,
  isSftpTransferCanceledError,
  joinLocalPath,
  runLimitedSftpTasks,
} from './sftpPanelUtils';
import type { SftpTransferItem } from './sftpTransferTypes';

type SftpUploadConflictAction = 'cancel' | 'overwrite' | 'overwrite-all' | 'skip' | 'skip-all';

const sftpTransferConcurrency = 2;
const sftpUploadStreamChunkSize = 4 * 1024 * 1024;

export function useSftpTransferActions({
  addPendingTransfer,
  currentEntries,
  currentPath,
  deleteTransferWaiter,
  downloadableEntries,
  isRemoteReady,
  markTransferFailed,
  panelId,
  setError,
  waitForTransferCompletion,
}: {
  addPendingTransfer: (transfer: SftpTransferItem, replaceTransferId?: string) => void;
  currentEntries: SftpEntry[];
  currentPath: string;
  deleteTransferWaiter: (transferId: string) => void;
  downloadableEntries: SftpEntry[];
  isRemoteReady: boolean;
  markTransferFailed: (transferId: string, message: string) => void;
  panelId: string;
  setError: (message: string) => void;
  waitForTransferCompletion: (transferId: string) => Promise<void>;
}) {
  const startUpload = async () => {
    if (!isRemoteReady) {
      return;
    }

    const selectedPaths = await openDialog({
      directory: false,
      multiple: true,
      title: 'Select files to upload',
    });

    const localPaths = Array.isArray(selectedPaths)
      ? selectedPaths.filter((selectedPath): selectedPath is string => typeof selectedPath === 'string')
      : typeof selectedPaths === 'string'
        ? [selectedPaths]
        : [];

    await startUploadFromPaths(localPaths, currentPath);
  };

  const startUploadFolder = async () => {
    if (!isRemoteReady) {
      return;
    }

    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select folder to upload',
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await startUploadFromPaths([selectedPath], currentPath);
  };

  const startUploadFromDataTransfer = async (dataTransfer: DataTransfer, targetDirectory: string) => {
    let uploadPlan: SftpDroppedUploadPlan;

    try {
      uploadPlan = await getDroppedUploadPlan(dataTransfer);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (!isRemoteReady || (uploadPlan.files.length === 0 && uploadPlan.directories.length === 0)) {
      setError('Dropped files did not include readable files.');
      return;
    }

    let targetEntries: SftpEntry[];

    try {
      targetEntries = targetDirectory === currentPath
        ? currentEntries
        : (await listSftpDirectory(panelId, targetDirectory)).entries;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }

    const existingNames = new Set(targetEntries.map((entry) => entry.filename));
    const skippedTopLevelNames = new Set<string>();
    let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;
    const topLevelNames = Array.from(new Set([
      ...uploadPlan.directories.map(getSftpTopLevelPathName),
      ...uploadPlan.files.map((file) => getSftpTopLevelPathName(file.relativePath)),
    ]));

    for (const topLevelName of topLevelNames) {
      if (existingNames.has(topLevelName)) {
        const action = conflictActionForRemaining ?? await chooseUploadConflict(topLevelName, targetDirectory);

        if (action === 'cancel' || action === undefined) {
          return;
        }

        if (action === 'overwrite-all') {
          conflictActionForRemaining = 'overwrite';
        }

        if (action === 'skip-all') {
          conflictActionForRemaining = 'skip';
        }

        if (action === 'skip' || action === 'skip-all' || conflictActionForRemaining === 'skip') {
          skippedTopLevelNames.add(topLevelName);
          continue;
        }
      }
    }

    const directories = uploadPlan.directories
      .filter((directoryPath) => !skippedTopLevelNames.has(getSftpTopLevelPathName(directoryPath)))
      .sort((left, right) => left.split('/').length - right.split('/').length);
    const ensuredRemoteDirectories = new Set([
      targetDirectory,
      ...getSftpAncestorPaths(targetDirectory),
    ]);

    for (const directoryPath of directories) {
      const remoteDirectoryPath = joinSftpPath(targetDirectory, directoryPath);

      if (ensuredRemoteDirectories.has(remoteDirectoryPath)) {
        continue;
      }

      try {
        await createSftpDirectory(panelId, remoteDirectoryPath);
      } catch {
        // Directory may already exist. Uploading files will surface real path problems.
      }

      ensuredRemoteDirectories.add(remoteDirectoryPath);
    }

    const uploadTasks: Array<() => Promise<void>> = [];

    for (const uploadFile of uploadPlan.files) {
      const topLevelName = getSftpTopLevelPathName(uploadFile.relativePath);

      if (skippedTopLevelNames.has(topLevelName)) {
        continue;
      }

      const remotePath = joinSftpPath(targetDirectory, uploadFile.relativePath);
      await ensureRemoteDirectoriesForFile(remotePath, ensuredRemoteDirectories);
      uploadTasks.push(() => startDroppedFileUpload(uploadFile.file, uploadFile.relativePath, remotePath));
      existingNames.add(topLevelName);
    }

    await runLimitedSftpTasks(uploadTasks, sftpTransferConcurrency);
  };

  const startDownload = async () => {
    if (!isRemoteReady || downloadableEntries.length === 0) {
      return;
    }

    await startDownloadEntries(downloadableEntries);
  };

  const startDownloadEntries = async (entries: SftpEntry[]) => {
    if (!isRemoteReady || entries.length === 0) {
      return;
    }

    if (entries.length === 1 && !entries[0].isDirectory) {
      const entry = entries[0];
      const localPath = await saveDialog({
        defaultPath: entry.filename,
        title: `Download ${entry.filename}`,
      });

      if (typeof localPath === 'string') {
        await startDownloadTransfer(entry, localPath);
      }

      return;
    }

    const targetDirectory = await openDialog({
      directory: true,
      multiple: false,
      title: entries.length === 1
        ? `Select folder for ${entries[0].filename}`
        : 'Select download folder',
    });

    if (typeof targetDirectory !== 'string') {
      return;
    }

    await runLimitedSftpTasks(
      entries.map((entry) => () =>
        startDownloadTransfer(entry, joinLocalPath(targetDirectory, entry.filename))
      ),
      sftpTransferConcurrency,
    );
  };

  const startDownloadEntriesToDirectory = async (entries: SftpEntry[], targetDirectory: string) => {
    if (!isRemoteReady || entries.length === 0 || !targetDirectory) {
      return;
    }

    await runLimitedSftpTasks(
      entries.map((entry) => () =>
        startDownloadTransfer(entry, joinLocalPath(targetDirectory, entry.filename))
      ),
      sftpTransferConcurrency,
    );
  };

  const startUploadFromPaths = async (localPaths: string[], targetDirectory: string) => {
    if (!isRemoteReady || localPaths.length === 0) {
      return;
    }

    let targetEntries: SftpEntry[];

    try {
      targetEntries = targetDirectory === currentPath
        ? currentEntries
        : (await listSftpDirectory(panelId, targetDirectory)).entries;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }

    const existingNames = new Set(targetEntries.map((entry) => entry.filename));
    let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;
    const uploadTasks: Array<() => Promise<void>> = [];

    for (const localPath of localPaths) {
      const filename = getLocalFileName(localPath);
      const remotePath = joinSftpPath(targetDirectory, filename);

      if (existingNames.has(filename)) {
        const action = conflictActionForRemaining ?? await chooseUploadConflict(filename, targetDirectory);

        if (action === 'cancel' || action === undefined) {
          return;
        }

        if (action === 'overwrite-all') {
          conflictActionForRemaining = 'overwrite';
        }

        if (action === 'skip-all') {
          conflictActionForRemaining = 'skip';
        }

        if (action === 'skip' || action === 'skip-all' || conflictActionForRemaining === 'skip') {
          continue;
        }
      }

      existingNames.add(filename);
      uploadTasks.push(() => startPathUploadTransfer(localPath, remotePath));
    }

    await runLimitedSftpTasks(uploadTasks, sftpTransferConcurrency);
  };

  const startPathUploadTransfer = async (localPath: string, remotePath: string) => {
    const transferId = createTransferId();

    addPendingTransfer({
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
    });

    try {
      const completion = waitForTransferCompletion(transferId);
      await uploadSftpFile(panelId, localPath, remotePath, transferId);
      await completion;
    } catch (error) {
      deleteTransferWaiter(transferId);
      markTransferFailed(transferId, error instanceof Error ? error.message : String(error));
    }
  };

  const ensureRemoteDirectoriesForFile = async (
    remoteFilePath: string,
    ensuredRemoteDirectories: Set<string>,
  ) => {
    for (const directoryPath of getSftpAncestorPaths(remoteFilePath)) {
      if (ensuredRemoteDirectories.has(directoryPath)) {
        continue;
      }

      try {
        await createSftpDirectory(panelId, directoryPath);
      } catch {
        // Directory may already exist. Uploading the file will surface real path problems.
      }

      ensuredRemoteDirectories.add(directoryPath);
    }
  };

  const startDroppedFileUpload = async (file: File, filename: string, remotePath: string) => {
    const transferId = createTransferId();

    addPendingTransfer({
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
    });

    try {
      await openSftpUploadStream(panelId, filename, remotePath, transferId, file.size);

      for (let offset = 0; offset < file.size; offset += sftpUploadStreamChunkSize) {
        const chunk = file.slice(offset, Math.min(offset + sftpUploadStreamChunkSize, file.size));
        const buffer = await chunk.arrayBuffer();

        await writeSftpUploadStreamChunk(transferId, new Uint8Array(buffer));
      }

      await closeSftpUploadStream(transferId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isSftpTransferCanceledError(message)) {
        return;
      }

      try {
        await cancelSftpTransfer(transferId);
      } catch {
        // The backend may already have removed the stream after a write failure.
      }

      markTransferFailed(transferId, message);
    }
  };

  const startDownloadTransfer = async (entry: SftpEntry, localPath: string) => {
    const transferId = createTransferId();

    addPendingTransfer({
      direction: 'download',
      localPath,
      message: undefined,
      panelId,
      remotePath: entry.path,
      retryPayload: {
        kind: 'download',
        localPath,
        remotePath: entry.path,
        totalBytes: entry.size ?? 0,
      },
      status: 'started',
      totalBytes: entry.size ?? 0,
      transferredBytes: 0,
      transferId,
    });

    try {
      const completion = waitForTransferCompletion(transferId);
      await downloadSftpFile(panelId, entry.path, localPath, transferId);
      await completion;
    } catch (error) {
      deleteTransferWaiter(transferId);
      markTransferFailed(transferId, error instanceof Error ? error.message : String(error));
    }
  };

  return {
    startDownload,
    startDownloadEntries,
    startDownloadEntriesToDirectory,
    startUpload,
    startUploadFolder,
    startUploadFromPaths,
    startUploadFromDataTransfer,
  };
}

function chooseUploadConflict(filename: string, targetDirectory: string) {
  return appChoose<SftpUploadConflictAction>({
    choices: [
      { label: 'Overwrite', tone: 'danger', value: 'overwrite' },
      { label: 'Overwrite All', tone: 'danger', value: 'overwrite-all' },
      { label: 'Skip', value: 'skip' },
      { label: 'Skip All', value: 'skip-all' },
      { label: 'Cancel', value: 'cancel' },
    ],
    message: `${filename} already exists in ${targetDirectory}.\nChoose how to continue.`,
    title: 'Remote File Exists',
  });
}
