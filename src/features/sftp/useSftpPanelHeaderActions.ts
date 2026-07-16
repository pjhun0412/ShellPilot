import { useCallback } from 'react';

import type { SftpPanelHeaderProps } from './SftpPanelHeader';
import type { SftpViewMode } from './sftpPanelTypes';

type HeaderActionProps = Pick<
  SftpPanelHeaderProps,
  | 'actionScope'
  | 'areRemoteActionsDisabled'
  | 'canDelete'
  | 'canDownload'
  | 'canRename'
  | 'isRefreshDisabled'
  | 'onCleanResidualUploadFiles'
  | 'onCopyPath'
  | 'onCreateFolder'
  | 'onDelete'
  | 'onDownload'
  | 'onRefresh'
  | 'onRename'
  | 'onSetViewMode'
  | 'onUploadFiles'
  | 'onUploadFolder'
  | 'refreshTitle'
>;

export function useSftpPanelHeaderActions({
  canRemoteDelete,
  canRemoteDownload,
  canRemoteRename,
  cleanResidualUploadFiles,
  copyRemotePath,
  createLocalFolder,
  createRemoteFolder,
  deleteLocalSelected,
  deleteRemote,
  downloadRemote,
  isCommanderLocalActive,
  localIsLoading,
  localPath,
  localSelectedEntriesCount,
  localSelectedEntryPaths,
  refreshLocal,
  refreshRemote,
  renameRemote,
  setActionMenuOpen,
  setViewMode,
  uploadFiles,
  uploadFolder,
}: {
  canRemoteDelete: boolean;
  canRemoteDownload: boolean;
  canRemoteRename: boolean;
  cleanResidualUploadFiles: () => void | Promise<void>;
  copyRemotePath: () => void | Promise<void>;
  createLocalFolder: () => void | Promise<void>;
  createRemoteFolder: () => void | Promise<void>;
  deleteLocalSelected: () => void | Promise<void>;
  deleteRemote: () => void | Promise<void>;
  downloadRemote: () => void | Promise<void>;
  isCommanderLocalActive: boolean;
  localIsLoading: boolean;
  localPath: string;
  localSelectedEntriesCount: number;
  localSelectedEntryPaths: string[];
  refreshLocal: () => void | Promise<void>;
  refreshRemote: () => void | Promise<void>;
  renameRemote: () => void | Promise<void>;
  setActionMenuOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  setViewMode: (value: SftpViewMode) => void;
  uploadFiles: () => void | Promise<void>;
  uploadFolder: () => void | Promise<void>;
}): HeaderActionProps {
  const closeActionMenu = useCallback(() => {
    setActionMenuOpen(false);
  }, [setActionMenuOpen]);

  const runAndClose = useCallback((action: () => void | Promise<void>) => {
    closeActionMenu();
    void action();
  }, [closeActionMenu]);

  const copyPath = useCallback(() => {
    if (isCommanderLocalActive) {
      const targetPath = localSelectedEntryPaths.length === 1
        ? localSelectedEntryPaths[0]
        : localPath;

      void navigator.clipboard?.writeText(targetPath);
      return;
    }

    void copyRemotePath();
  }, [copyRemotePath, isCommanderLocalActive, localPath, localSelectedEntryPaths]);

  const setHeaderViewMode = useCallback((nextViewMode: SftpViewMode) => {
    closeActionMenu();
    setViewMode(nextViewMode);
  }, [closeActionMenu, setViewMode]);

  return {
    actionScope: isCommanderLocalActive ? 'local' : 'remote',
    areRemoteActionsDisabled: isCommanderLocalActive,
    canDelete: isCommanderLocalActive ? localSelectedEntriesCount > 0 : canRemoteDelete,
    canDownload: isCommanderLocalActive ? false : canRemoteDownload,
    canRename: isCommanderLocalActive ? false : canRemoteRename,
    isRefreshDisabled: isCommanderLocalActive ? localIsLoading : undefined,
    onCleanResidualUploadFiles: () => runAndClose(cleanResidualUploadFiles),
    onCopyPath: copyPath,
    onCreateFolder: () => runAndClose(isCommanderLocalActive ? createLocalFolder : createRemoteFolder),
    onDelete: () => runAndClose(isCommanderLocalActive ? deleteLocalSelected : deleteRemote),
    onDownload: () => runAndClose(downloadRemote),
    onRefresh: () => {
      void (isCommanderLocalActive ? refreshLocal() : refreshRemote());
    },
    onRename: () => runAndClose(renameRemote),
    onSetViewMode: setHeaderViewMode,
    onUploadFiles: () => runAndClose(uploadFiles),
    onUploadFolder: () => runAndClose(uploadFolder),
    refreshTitle: isCommanderLocalActive ? 'Refresh local' : 'Refresh remote',
  };
}
