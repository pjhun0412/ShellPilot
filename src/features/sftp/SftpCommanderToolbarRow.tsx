import { type Dispatch, type SetStateAction } from 'react';

import { CommanderPaneActionGroup } from './SftpCommanderActionGroup';
import { formatLocalDisplayPath, type CommanderPaneVariant } from './sftpCommanderUtils';

export function SftpCommanderToolbarRow({
  actionMenuVariant,
  canRemoteDelete,
  canRemoteDownload,
  canRemoteRename,
  isRemoteReady,
  localBackStackLength,
  localForwardStackLength,
  localIsLoading,
  localPath,
  localSelectedPaths,
  onCopyRemotePath,
  onCreateLocalFolder,
  onCreateRemoteFolder,
  onDeleteLocal,
  onDeleteRemote,
  onDownloadRemote,
  onLocalGoBack,
  onLocalGoForward,
  onLocalRefresh,
  onRemoteGoBack,
  onRemoteGoForward,
  onRemoteRefresh,
  onRenameRemote,
  onSetActionMenuVariant,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onUploadFiles,
  onUploadFolder,
  onUploadLocalPathsToRemote,
  remoteBackStackLength,
  remoteForwardStackLength,
  remoteIsLoading,
  showHiddenEntries,
  showPermissions,
}: {
  actionMenuVariant?: CommanderPaneVariant;
  canRemoteDelete: boolean;
  canRemoteDownload: boolean;
  canRemoteRename: boolean;
  isRemoteReady: boolean;
  localBackStackLength: number;
  localForwardStackLength: number;
  localIsLoading: boolean;
  localPath: string;
  localSelectedPaths: string[];
  onCopyRemotePath: () => void;
  onCreateLocalFolder: () => void;
  onCreateRemoteFolder: () => void;
  onDeleteLocal: () => void;
  onDeleteRemote: () => void;
  onDownloadRemote: () => void;
  onLocalGoBack: () => void;
  onLocalGoForward: () => void;
  onLocalRefresh: () => void;
  onRemoteGoBack: () => void;
  onRemoteGoForward: () => void;
  onRemoteRefresh: () => void;
  onRenameRemote: () => void;
  onSetActionMenuVariant: Dispatch<SetStateAction<CommanderPaneVariant | undefined>>;
  onSetShowHiddenEntries: (value: boolean) => void;
  onSetShowPermissions: (value: boolean) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onUploadLocalPathsToRemote: (paths: string[]) => void;
  remoteBackStackLength: number;
  remoteForwardStackLength: number;
  remoteIsLoading: boolean;
  showHiddenEntries: boolean;
  showPermissions: boolean;
}) {
  return (
    <>
      <div className="flex min-w-0 justify-end">
        <CommanderPaneActionGroup
          backStackLength={localBackStackLength}
          canDelete={localSelectedPaths.length > 0}
          canTransfer={localSelectedPaths.length > 0 && isRemoteReady}
          forwardStackLength={localForwardStackLength}
          isLoading={localIsLoading}
          isMenuOpen={actionMenuVariant === 'local'}
          label="Local"
          variant="local"
          onBack={onLocalGoBack}
          onCopyPath={() => {
            const targetPath = localSelectedPaths.length === 1 ? localSelectedPaths[0] : localPath;
            void navigator.clipboard?.writeText(formatLocalDisplayPath(targetPath));
          }}
          onCreateFolder={onCreateLocalFolder}
          onDelete={onDeleteLocal}
          onForward={onLocalGoForward}
          onRefresh={onLocalRefresh}
          onSetMenuOpen={(isOpen) => onSetActionMenuVariant(isOpen ? 'local' : undefined)}
          onTransfer={() => onUploadLocalPathsToRemote(localSelectedPaths)}
        />
      </div>

      <span className="h-7 w-px justify-self-center bg-border/70" aria-hidden="true" />

      <div className="flex min-w-0 justify-end">
        <CommanderPaneActionGroup
          backStackLength={remoteBackStackLength}
          canDelete={canRemoteDelete}
          canDownload={canRemoteDownload}
          canRename={canRemoteRename}
          forwardStackLength={remoteForwardStackLength}
          isLoading={remoteIsLoading}
          isMenuOpen={actionMenuVariant === 'remote'}
          isRemoteReady={isRemoteReady}
          label="Remote"
          showHiddenEntries={showHiddenEntries}
          showPermissions={showPermissions}
          variant="remote"
          onBack={onRemoteGoBack}
          onCopyPath={onCopyRemotePath}
          onCreateFolder={onCreateRemoteFolder}
          onDelete={onDeleteRemote}
          onDownload={onDownloadRemote}
          onForward={onRemoteGoForward}
          onRefresh={onRemoteRefresh}
          onRename={onRenameRemote}
          onSetMenuOpen={(isOpen) => onSetActionMenuVariant(isOpen ? 'remote' : undefined)}
          onSetShowHiddenEntries={onSetShowHiddenEntries}
          onSetShowPermissions={onSetShowPermissions}
          onUploadFiles={onUploadFiles}
          onUploadFolder={onUploadFolder}
        />
      </div>
    </>
  );
}
