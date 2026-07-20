import {
  cancelSftpTransfer,
  closeSftpUploadStream,
  downloadSftpFile,
  getLocalPathMetadata,
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
} from './sftpPanelUtils';
import { enqueueSftpTransfer } from './sftpTransferScheduler';
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

const sftpUploadStreamChunkSize = 4 * 1024 * 1024;

export function useSftpTransferActions({
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

    await Promise.all(downloadTasks.map((task) => task()));
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

    await Promise.all(uploadTasks.map((task) => task()));
  };

  const startPathUploadTransfer = async (localPath: string, remotePath: string) => {
    const metadata = await getLocalPathMetadata(localPath);
    const { transfer, transferId } = createPathUploadTransferItem({
      localModifiedAt: metadata.modifiedAt,
      localPath,
      localSize: metadata.size,
      panelId,
      remotePath,
    });

    await enqueueSftpTransfer(transfer, () => runTrackedTransfer(
      transferId,
      () => uploadSftpFile(panelId, localPath, remotePath, transferId, transfer.retryPayload?.kind === 'path-upload' ? transfer.retryPayload.uploadId : transferId),
    ));
  };

  const startDroppedFileUpload = async (file: File, filename: string, remotePath: string) => {
    const { transfer, transferId } = createDroppedUploadTransferItem({
      file,
      filename,
      panelId,
      remotePath,
    });

    await enqueueSftpTransfer(transfer, async () => {
      try {
        const resumeOffset = await openSftpUploadStream(
          panelId,
          filename,
          remotePath,
          transferId,
          file.size,
          transfer.retryPayload?.kind === 'drop-upload' ? transfer.retryPayload.uploadId : transferId,
        );

        for (let offset = resumeOffset; offset < file.size; offset += sftpUploadStreamChunkSize) {
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
    });
  };

  const startDownloadTransfer = async (entry: SftpEntry, localPath: string) => {
    const { transfer, transferId } = createDownloadTransferItem({
      entry,
      localPath,
      panelId,
    });

    await enqueueSftpTransfer(transfer, () => runTrackedTransfer(
      transferId,
      () => downloadSftpFile(
        panelId,
        entry.path,
        localPath,
        transferId,
        transfer.retryPayload?.kind === 'download' ? transfer.retryPayload.downloadId : transferId,
      ),
    ));
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
