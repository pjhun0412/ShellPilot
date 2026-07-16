import { useState, type RefObject } from 'react';

import type { SftpOperationNotice } from './SftpPanelBody';
import type { SftpEntry } from './sftpBridge';
import { requestSftpRemoteRefresh } from './sftpRemoteRefresh';
import { useSftpFileActions } from './useSftpFileActions';
import { useSftpRemoteMove } from './useSftpRemoteMove';
import { useSftpTransferActions } from './useSftpTransferActions';
import { useSftpTransfers } from './useSftpTransfers';
import { useSftpUploadDrop } from './useSftpUploadDrop';

export function useSftpPanelRemoteOperations({
  activeRemoteSelectedEntries,
  activeRemoteSelectedEntry,
  downloadableEntries,
  entries,
  isRemoteReady,
  panelId,
  panelRef,
  parentEntryPathKey,
  parentPath,
  path,
  refreshCurrentDirectory,
  remoteIdentity,
  residualUploadEntries,
  runBrowserAction,
  setError,
}: {
  activeRemoteSelectedEntries: SftpEntry[];
  activeRemoteSelectedEntry?: SftpEntry;
  downloadableEntries: SftpEntry[];
  entries: SftpEntry[];
  isRemoteReady: boolean;
  panelId: string;
  panelRef: RefObject<HTMLDivElement>;
  parentEntryPathKey: string;
  parentPath?: string;
  path: string;
  refreshCurrentDirectory: () => void;
  remoteIdentity: string;
  residualUploadEntries: SftpEntry[];
  runBrowserAction: (action: () => Promise<void>) => Promise<void>;
  setError: (message: string) => void;
}) {
  const [operationNotice, setOperationNotice] = useState<SftpOperationNotice>();
  const {
    addPendingTransfer,
    deleteTransferWaiter,
    markTransferFailed,
    transferSummary,
    transfers,
    waitForTransferCompletion,
  } = useSftpTransfers({
    onError: setError,
    onUploadCompleted: refreshCurrentDirectory,
    panelId,
  });
  const {
    startDownload,
    startDownloadEntries,
    startDownloadEntriesToDirectory,
    startUpload,
    startUploadFolder,
    startUploadFromPaths,
    startUploadFromDataTransfer,
  } = useSftpTransferActions({
    addPendingTransfer,
    currentEntries: entries,
    currentPath: path,
    deleteTransferWaiter,
    downloadableEntries,
    isRemoteReady,
    markTransferFailed,
    panelId,
    setError,
    waitForTransferCompletion,
  });
  const {
    dragUploadTargetPath,
    handleUploadDragLeave,
    handleUploadDragOver,
    handleUploadDrop,
    isUploadDragOver,
  } = useSftpUploadDrop({
    entries,
    isRemoteReady,
    panelRef,
    parentEntryPathKey,
    parentPath,
    path,
    startUploadFromDataTransfer,
  });
  const {
    clearRemoteMoveTarget,
    handleRemoteMoveDragOver,
    handleRemoteMoveDrop,
    markRemoteMoveDrag,
    moveTargetPath,
    moveStatus,
  } = useSftpRemoteMove({
    entries,
    isRemoteReady,
    panelId,
    onMoveComplete: () => requestSftpRemoteRefresh(remoteIdentity),
    onMoveNotice: (message) => {
      setOperationNotice(message ? { message } : undefined);
    },
    remoteIdentity,
    runBrowserAction,
  });
  const {
    cleanResidualUploadFiles,
    createFolder,
    deleteEntry,
    renameEntry,
  } = useSftpFileActions({
    entries,
    panelId,
    path,
    residualUploadEntries,
    runBrowserAction,
    selectedEntries: activeRemoteSelectedEntries,
    selectedEntry: activeRemoteSelectedEntry,
  });

  return {
    cleanResidualUploadFiles,
    clearRemoteMoveTarget,
    createFolder,
    deleteEntry,
    dragUploadTargetPath,
    handleRemoteMoveDragOver,
    handleRemoteMoveDrop,
    handleUploadDragLeave,
    handleUploadDragOver,
    handleUploadDrop,
    isUploadDragOver,
    markRemoteMoveDrag,
    moveStatus,
    moveTargetPath,
    operationNotice,
    renameEntry,
    setOperationNotice,
    startDownload,
    startDownloadEntries,
    startDownloadEntriesToDirectory,
    startUpload,
    startUploadFolder,
    startUploadFromPaths,
    transferSummary,
    transfers,
  };
}
