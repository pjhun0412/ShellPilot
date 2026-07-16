import {
  useCallback,
  useState,
  type DragEvent,
} from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

import type { LocalFileEntry, LocalRootEntry, SftpEntry } from './sftpBridge';
import { CommanderPane } from './SftpCommanderPane';
import { SftpCommanderToolbarRow } from './SftpCommanderToolbarRow';
import {
  COMMANDER_DEFAULT_SORT,
  type CommanderPaneVariant,
  type CommanderSortState,
} from './sftpCommanderUtils';
import { useSftpCommanderSplit } from './useSftpCommanderSplit';

export type { CommanderPaneVariant } from './sftpCommanderUtils';

export function SftpCommanderView({
  localEntries,
  localError,
  localIsLoading,
  localParentPath,
  localPath,
  localRoots,
  localSelectedPaths,
  localBackStackLength,
  localForwardStackLength,
  pendingActivationSelectionPath,
  activePane,
  isPanelActive,
  canRemoteDelete,
  canRemoteDownload,
  canRemoteRename,
  isRemoteReady,
  showHiddenEntries,
  showPermissions,
  onCreateRemoteFolder,
  onDeleteRemote,
  onDownloadRemote,
  onLocalGoBack,
  onLocalGoForward,
  onLocalNavigate,
  onLocalRefresh,
  onLocalSelect,
  onLocalSelectMany,
  onCreateLocalFolder,
  onDeleteLocal,
  onActivePaneChange,
  onDownloadRemotePathsToLocal,
  onCopyRemotePath,
  onRemoteNavigate,
  onRemoteRefresh,
  onRenameRemote,
  onRemoteMoveDragEnd,
  onRemoteMoveDragOver,
  onRemoteMoveDragStart,
  onRemoteMoveDrop,
  onRemoteGoBack,
  onRemoteGoForward,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onRemoteSelect,
  onRemoteSelectMany,
  onUploadFiles,
  onUploadFolder,
  onUploadLocalPathsToRemote,
  remoteEntries,
  remoteIsLoading,
  remoteMoveTargetPath,
  remoteParentPath,
  remotePath,
  remoteSelectedPaths,
  remoteBackStackLength,
  remoteForwardStackLength,
}: {
  localEntries: LocalFileEntry[];
  localError?: string;
  localIsLoading: boolean;
  localParentPath?: string;
  localPath: string;
  localRoots: LocalRootEntry[];
  localSelectedPaths: string[];
  localBackStackLength: number;
  localForwardStackLength: number;
  pendingActivationSelectionPath?: string | null;
  activePane: CommanderPaneVariant;
  isPanelActive: boolean;
  canRemoteDelete: boolean;
  canRemoteDownload: boolean;
  canRemoteRename: boolean;
  isRemoteReady: boolean;
  showHiddenEntries: boolean;
  showPermissions: boolean;
  onCreateRemoteFolder: () => void;
  onDeleteRemote: () => void;
  onDownloadRemote: () => void;
  onLocalGoBack: () => void;
  onLocalGoForward: () => void;
  onLocalNavigate: (path: string) => void;
  onLocalRefresh: () => void;
  onLocalSelect: (path: string, additive: boolean) => void;
  onLocalSelectMany: (paths: string[]) => void;
  onCreateLocalFolder: () => void;
  onDeleteLocal: () => void;
  onActivePaneChange: (variant: CommanderPaneVariant) => void;
  onDownloadRemotePathsToLocal: (paths: string[]) => void;
  onCopyRemotePath: () => void;
  onRemoteNavigate: (path: string) => void;
  onRemoteRefresh: () => void;
  onRenameRemote: () => void;
  onRemoteMoveDragEnd: () => void;
  onRemoteMoveDragOver: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDragStart: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteGoBack: () => void;
  onRemoteGoForward: () => void;
  onSetShowHiddenEntries: (value: boolean) => void;
  onSetShowPermissions: (value: boolean) => void;
  onRemoteSelect: (path: string, additive: boolean) => void;
  onRemoteSelectMany: (paths: string[]) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onUploadLocalPathsToRemote: (paths: string[]) => void;
  remoteEntries: SftpEntry[];
  remoteIsLoading: boolean;
  remoteMoveTargetPath?: string;
  remoteParentPath?: string;
  remotePath: string;
  remoteSelectedPaths: string[];
  remoteBackStackLength: number;
  remoteForwardStackLength: number;
}) {
  const [actionMenuVariant, setActionMenuVariant] = useState<CommanderPaneVariant>();
  const [dragSourceVariant, setDragSourceVariant] = useState<CommanderPaneVariant>();
  const [localSort, setLocalSort] = useState<CommanderSortState>(COMMANDER_DEFAULT_SORT);
  const [remoteSort, setRemoteSort] = useState<CommanderSortState>(COMMANDER_DEFAULT_SORT);
  const { containerRef, gridStyle, handleSplitterMouseDown } = useSftpCommanderSplit();

  const browseLocalDirectory = useCallback(async () => {
    const selectedPath = await openDialog({
      defaultPath: localPath,
      directory: true,
      multiple: false,
      title: 'Select local directory',
    });

    if (typeof selectedPath === 'string') {
      onLocalNavigate(selectedPath);
    }
  }, [localPath, onLocalNavigate]);

  return (
    <div
      className="grid min-h-0 flex-1 gap-1 p-2"
      ref={containerRef}
      style={gridStyle}
    >
      <SftpCommanderToolbarRow
        actionMenuVariant={actionMenuVariant}
        canRemoteDelete={canRemoteDelete}
        canRemoteDownload={canRemoteDownload}
        canRemoteRename={canRemoteRename}
        isRemoteReady={isRemoteReady}
        localBackStackLength={localBackStackLength}
        localForwardStackLength={localForwardStackLength}
        localIsLoading={localIsLoading}
        localPath={localPath}
        localSelectedPaths={localSelectedPaths}
        onCopyRemotePath={onCopyRemotePath}
        onCreateLocalFolder={onCreateLocalFolder}
        onCreateRemoteFolder={onCreateRemoteFolder}
        onDeleteLocal={onDeleteLocal}
        onDeleteRemote={onDeleteRemote}
        onDownloadRemote={onDownloadRemote}
        onLocalGoBack={onLocalGoBack}
        onLocalGoForward={onLocalGoForward}
        onLocalRefresh={onLocalRefresh}
        onRemoteGoBack={onRemoteGoBack}
        onRemoteGoForward={onRemoteGoForward}
        onRemoteRefresh={onRemoteRefresh}
        onRenameRemote={onRenameRemote}
        onSetActionMenuVariant={setActionMenuVariant}
        onSetShowHiddenEntries={onSetShowHiddenEntries}
        onSetShowPermissions={onSetShowPermissions}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
        onUploadLocalPathsToRemote={onUploadLocalPathsToRemote}
        remoteBackStackLength={remoteBackStackLength}
        remoteForwardStackLength={remoteForwardStackLength}
        remoteIsLoading={remoteIsLoading}
        showHiddenEntries={showHiddenEntries}
        showPermissions={showPermissions}
      />

      <CommanderPane
        entries={localEntries}
        error={localError}
        isLoading={localIsLoading}
        label="Local"
        isActive={isPanelActive && activePane === 'local'}
        canDelete={localSelectedPaths.length > 0}
        parentPath={localParentPath}
        path={localPath}
        localRoots={localRoots}
        selectedPaths={localSelectedPaths}
        pendingActivationSelectionPath={pendingActivationSelectionPath}
        onActivate={onActivePaneChange}
        onNavigate={onLocalNavigate}
        onBrowseDirectory={browseLocalDirectory}
        onCreateFolder={onCreateLocalFolder}
        onDelete={onDeleteLocal}
        onRefresh={onLocalRefresh}
        onSelect={onLocalSelect}
        onSelectMany={onLocalSelectMany}
        dragSourceVariant={dragSourceVariant}
        onDragSourceChange={setDragSourceVariant}
        onDropPaths={onDownloadRemotePathsToLocal}
        onSortChange={setLocalSort}
        sort={localSort}
        variant="local"
        onUploadSelectedLocal={() => onUploadLocalPathsToRemote(localSelectedPaths)}
      />

      <div className="relative z-10 flex min-w-0 items-center justify-center">
        <button
          aria-label="Resize commander panes"
          className="group absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 cursor-col-resize"
          type="button"
          onMouseDown={handleSplitterMouseDown}
        >
          <span className="mx-auto block h-full w-px bg-border/80 transition-colors group-hover:bg-primary/70" />
        </button>
      </div>

      <CommanderPane
        entries={remoteEntries}
        isLoading={remoteIsLoading}
        label="Remote"
        isActive={isPanelActive && activePane === 'remote'}
        parentPath={remoteParentPath}
        path={remotePath}
        selectedPaths={remoteSelectedPaths}
        pendingActivationSelectionPath={pendingActivationSelectionPath}
        canDelete={canRemoteDelete}
        canDownload={canRemoteDownload}
        canRename={canRemoteRename}
        isRemoteReady={isRemoteReady}
        showHiddenEntries={showHiddenEntries}
        showPermissions={showPermissions}
        onActivate={onActivePaneChange}
        onCopyPath={onCopyRemotePath}
        onCreateFolder={onCreateRemoteFolder}
        onDelete={onDeleteRemote}
        onDownload={onDownloadRemote}
        onNavigate={onRemoteNavigate}
        onRefresh={onRemoteRefresh}
        onRename={onRenameRemote}
        onRemoteMoveDragEnd={onRemoteMoveDragEnd}
        onRemoteMoveDragOver={onRemoteMoveDragOver}
        onRemoteMoveDragStart={onRemoteMoveDragStart}
        onRemoteMoveDrop={onRemoteMoveDrop}
        onSetShowHiddenEntries={onSetShowHiddenEntries}
        onSetShowPermissions={onSetShowPermissions}
        onSelect={onRemoteSelect}
        onSelectMany={onRemoteSelectMany}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
        dragSourceVariant={dragSourceVariant}
        onDragSourceChange={setDragSourceVariant}
        onDropPaths={onUploadLocalPathsToRemote}
        remoteMoveTargetPath={remoteMoveTargetPath}
        onSortChange={setRemoteSort}
        sort={remoteSort}
        variant="remote"
      />
    </div>
  );
}
