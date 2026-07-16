import {
  cancelSftpTransfer,
  closeSftpUploadStream,
  downloadSftpFile,
  localPathExists,
  openSftpUploadStream,
  uploadSftpFile,
  writeSftpUploadStreamChunk,
  type SftpEntry,
} from './sftpBridge';
import {
  joinSftpPath,
} from './sftpPathUtils';
import {
  getLocalFileName,
  isSftpTransferCanceledError,
  joinLocalPath,
  runLimitedSftpTasks,
} from './sftpPanelUtils';
import {
  chooseFileConflictDecision,
  createDownloadTransferItem,
  createDroppedUploadTransferItem,
  createPathUploadTransferItem,
  getEntriesForTransferTargetDirectory,
} from './sftpTransferActionHelpers';
import type { SftpTransferItem } from './sftpTransferTypes';
import { startDroppedUploadPlan } from './sftpDroppedUploadActions';
import {
  selectDownloadFilePath,
  selectDownloadTargetDirectory,
  selectUploadFilePaths,
  selectUploadFolderPath,
} from './sftpTransferDialogs';

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
  const getEntriesForTargetDirectory = async (targetDirectory: string) => {
    return getEntriesForTransferTargetDirectory({
      currentEntries,
      currentPath,
      panelId,
      setError,
      targetDirectory,
    });
  };

  const runTrackedTransfer = async (
    transferId: string,
    action: () => Promise<void>,
  ) => {
    try {
      const completion = waitForTransferCompletion(transferId);
      await action();
      await completion;
    } catch (error) {
      deleteTransferWaiter(transferId);
      markTransferFailed(transferId, error instanceof Error ? error.message : String(error));
    }
  };

  const startUpload = async () => {
    if (!isRemoteReady) {
      return;
    }

    const localPaths = await selectUploadFilePaths();
    await startUploadFromPaths(localPaths, currentPath);
  };

  const startUploadFolder = async () => {
    if (!isRemoteReady) {
      return;
    }

    const selectedPath = await selectUploadFolderPath();

    if (!selectedPath) {
      return;
    }

    await startUploadFromPaths([selectedPath], currentPath);
  };

  const startUploadFromDataTransfer = async (dataTransfer: DataTransfer, targetDirectory: string) => {
    await startDroppedUploadPlan({
      dataTransfer,
      getTargetEntries: getEntriesForTargetDirectory,
      isRemoteReady,
      panelId,
      setError,
      startDroppedFileUpload,
      targetDirectory,
    });
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
      const localPath = await selectDownloadFilePath(entry);

      if (localPath) {
        await startDownloadTransfer(entry, localPath);
      }

      return;
    }

    const targetDirectory = await selectDownloadTargetDirectory(entries);

    if (!targetDirectory) {
      return;
    }

    await startDownloadEntriesIntoDirectory(entries, targetDirectory);
  };

  const startDownloadEntriesToDirectory = async (entries: SftpEntry[], targetDirectory: string) => {
    if (!isRemoteReady || entries.length === 0 || !targetDirectory) {
      return;
    }

    await startDownloadEntriesIntoDirectory(entries, targetDirectory);
  };

  const startDownloadEntriesIntoDirectory = async (entries: SftpEntry[], targetDirectory: string) => {
    let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;
    const downloadTasks: Array<() => Promise<void>> = [];

    for (const entry of entries) {
      const localPath = joinLocalPath(targetDirectory, entry.filename);

      try {
        if (await localPathExists(localPath)) {
          const conflictDecision = await chooseFileConflictDecision({
            conflictActionForRemaining,
            filename: entry.filename,
            targetDirectory,
            title: 'Local File Exists',
          });

          if (conflictDecision.shouldCancel) {
            return;
          }

          conflictActionForRemaining = conflictDecision.conflictActionForRemaining;

          if (conflictDecision.shouldSkip) {
            continue;
          }
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
        return;
      }

      downloadTasks.push(() => startDownloadTransfer(entry, localPath));
    }

    await runLimitedSftpTasks(
      downloadTasks,
      sftpTransferConcurrency,
    );
  };

  const startUploadFromPaths = async (localPaths: string[], targetDirectory: string) => {
    if (!isRemoteReady || localPaths.length === 0) {
      return;
    }

    const targetEntries = await getEntriesForTargetDirectory(targetDirectory);

    if (!targetEntries) {
      return;
    }

    const existingNames = new Set(targetEntries.map((entry) => entry.filename));
    let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;
    const uploadTasks: Array<() => Promise<void>> = [];

    for (const localPath of localPaths) {
      const filename = getLocalFileName(localPath);
      const remotePath = joinSftpPath(targetDirectory, filename);

      if (existingNames.has(filename)) {
        const conflictDecision = await chooseFileConflictDecision({
          conflictActionForRemaining,
          filename,
          targetDirectory,
          title: 'Remote File Exists',
        });

        if (conflictDecision.shouldCancel) {
          return;
        }

        conflictActionForRemaining = conflictDecision.conflictActionForRemaining;

        if (conflictDecision.shouldSkip) {
          continue;
        }
      }

      existingNames.add(filename);
      uploadTasks.push(() => startPathUploadTransfer(localPath, remotePath));
    }

    await runLimitedSftpTasks(uploadTasks, sftpTransferConcurrency);
  };

  const startPathUploadTransfer = async (localPath: string, remotePath: string) => {
    const { transfer, transferId } = createPathUploadTransferItem({
      localPath,
      panelId,
      remotePath,
    });

    addPendingTransfer(transfer);
    await runTrackedTransfer(
      transferId,
      () => uploadSftpFile(panelId, localPath, remotePath, transferId),
    );
  };

  const startDroppedFileUpload = async (file: File, filename: string, remotePath: string) => {
    const { transfer, transferId } = createDroppedUploadTransferItem({
      file,
      filename,
      panelId,
      remotePath,
    });

    addPendingTransfer(transfer);

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
    const { transfer, transferId } = createDownloadTransferItem({
      entry,
      localPath,
      panelId,
    });

    addPendingTransfer(transfer);
    await runTrackedTransfer(
      transferId,
      () => downloadSftpFile(panelId, entry.path, localPath, transferId),
    );
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
