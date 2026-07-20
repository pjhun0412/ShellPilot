import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SessionItem } from '@/types/workspace';
import { SftpCommanderView } from './SftpCommanderView';
import { SftpExplorerView } from './SftpExplorerView';
import { SftpPanelBody } from './SftpPanelBody';
import { SftpPanelHeader } from './SftpPanelHeader';
import { SftpPathBar } from './SftpPathBar';
import {
  requestSftpSidebarBookmark,
  requestSftpSidebarLocalFavorite,
  subscribeSftpSidebarLocalNavigation,
} from './sftpSidebarState';
import {
  isSftpResidualUploadEntry,
} from './sftpPanelUtils';
import { useSftpBrowserLifecycle } from './useSftpBrowserLifecycle';
import { useSftpExplorerTable } from './useSftpExplorerTable';
import { useSftpKeyboardShortcuts } from './useSftpKeyboardShortcuts';
import { useSftpCommanderOrchestration } from './useSftpCommanderOrchestration';
import { useSftpPanelHost } from './useSftpPanelHost';
import { useSftpPathActions } from './useSftpPathActions';
import { useSftpSelection } from './useSftpSelection';
import { useSftpPanelPublishing } from './useSftpPanelPublishing';
import { useSftpPanelHeaderActions } from './useSftpPanelHeaderActions';
import { useSftpDisplayPreferences } from './useSftpDisplayPreferences';
import { useSftpRemoteRefreshSubscription } from './useSftpRemoteRefreshSubscription';
import {
  useSftpPanelNavigation,
  useSftpPanelOpenActions,
} from './useSftpPanelNavigation';
import { useSftpActivationSelectionSync } from './useSftpActivationSelectionSync';
import { useSftpRemoteSelectionState } from './useSftpRemoteSelectionState';
import { useSftpPanelRemoteOperations } from './useSftpPanelRemoteOperations';

const sftpParentEntryPath = '__sftp_parent__';

export function SftpPanel({
  autoConnect = true,
  initialPath,
  isActive = false,
  panelId,
  session,
}: {
  autoConnect?: boolean;
  initialPath?: string;
  isActive?: boolean;
  panelId: string;
  session: SessionItem;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const resetSelectionRef = useRef<() => void>(() => undefined);
  const resetPathUiRef = useRef<() => void>(() => undefined);
  const localDownloadRefreshTimerRef = useRef<number>();
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const {
    setShowHiddenEntries,
    setShowPermissions,
    setViewMode,
    showHiddenEntries,
    showPermissions,
    viewMode,
  } = useSftpDisplayPreferences();
  const {
    clearPendingActivationSelectionPath,
    handleFocusCapture,
    handlePointerDownCapture,
    isActivePanelRef,
    panelWidth,
    pendingActivationSelectionPath,
  } = useSftpPanelHost({
    isActive,
    panelRef,
  });
  const resetSelectionFromLifecycle = useCallback(() => {
    resetSelectionRef.current();
  }, []);
  const {
    backStack,
    connectSftp,
    connectionState,
    entries,
    error,
    forwardStack,
    goBack,
    goForward,
    homePath,
    isLoading,
    isRemoteReady,
    loadDirectory,
    path,
    refreshCurrentDirectory,
    runBrowserAction,
    setError,
  } = useSftpBrowserLifecycle({
    autoConnect,
    onClearBrowserUi: () => {
      resetPathUiRef.current();
    },
    initialPath,
    panelId,
    resetSelection: resetSelectionFromLifecycle,
    session,
  });
  const {
    isNarrow,
    isTiny,
    saveScrollPosition,
    scrollViewportRef: fileTableScrollViewportRef,
    table,
    tableEntries,
    tableGridTemplateColumns,
    visibleEntries,
  } = useSftpExplorerTable({
    entries,
    panelWidth,
    path,
    showHiddenEntries,
    showPermissions,
  });
  const residualUploadEntries = useMemo(
    () => entries.filter(isSftpResidualUploadEntry),
    [entries],
  );
  const {
    goBackWithScrollSave,
    goForwardWithScrollSave,
    loadSftpDirectory,
    parentPath,
    pathSegments,
  } = useSftpPanelNavigation({
    goBack,
    goForward,
    loadDirectory,
    path,
    saveScrollPosition,
  });
  const remoteIdentity = useSftpRemoteRefreshSubscription({
    isRemoteReady,
    loadDirectory: loadSftpDirectory,
    session,
  });
  const {
    beginMarqueeSelection,
    endMarqueeSelection,
    marqueeBox,
    moveSelection,
    navigablePaths,
    resetSelection,
    selectAllEntries,
    selectEntryPath,
    selectedEntries,
    selectedEntry,
    selectedEntryPath,
    selectedEntryPaths,
    updateMarqueeSelection,
  } = useSftpSelection({
    isLoading,
    isRemoteReady,
    panelRef,
    parentEntryPathKey: sftpParentEntryPath,
    parentPath,
    tableEntries,
    visibleEntries,
  });
  useEffect(() => {
    resetSelectionRef.current = resetSelection;
  }, [resetSelection]);
  const {
    openEntry,
    openSelectedPath,
  } = useSftpPanelOpenActions({
    loadSftpDirectory,
    parentEntryPathKey: sftpParentEntryPath,
    parentPath,
    selectedEntry,
    selectedEntryPath,
  });
  const {
    activePane: commanderActivePane,
    isLocalActive: isCommanderLocalActive,
    localBrowser,
    remoteSelectedEntries: commanderRemoteSelectedEntries,
    remoteSelectedPaths: commanderRemoteSelectedPaths,
    setActivePane: setCommanderActivePane,
    setRemoteSelectedPaths: setCommanderRemoteSelectedPaths,
    toggleRemoteSelectedPath: handleCommanderRemoteSelect,
  } = useSftpCommanderOrchestration({
    remoteEntries: visibleEntries,
    remotePath: path,
    viewMode,
  });
  const {
    canDelete,
    canDownload,
    canRename,
    downloadableEntries,
    selectedEntries: activeRemoteSelectedEntries,
    selectedEntry: activeRemoteSelectedEntry,
  } = useSftpRemoteSelectionState({
    commanderSelectedEntries: commanderRemoteSelectedEntries,
    explorerSelectedEntries: selectedEntries,
    fallbackExplorerEntry: selectedEntry,
    viewMode,
  });
  const favoriteRemotePath = useCallback((targetPath: string) => {
    requestSftpSidebarBookmark(panelId, targetPath);
  }, [panelId]);
  const favoriteLocalPath = useCallback((targetPath: string) => {
    requestSftpSidebarLocalFavorite(panelId, targetPath);
  }, [panelId]);

  useEffect(() => {
    return subscribeSftpSidebarLocalNavigation(({ panelId: targetPanelId, path: targetPath }) => {
      if (targetPanelId !== panelId) {
        return;
      }

      setViewMode('commander');
      setCommanderActivePane('local');
      void localBrowser.loadDirectory(targetPath);
    });
  }, [localBrowser, panelId, setCommanderActivePane, setViewMode]);
  useEffect(() => {
    return () => {
      if (localDownloadRefreshTimerRef.current !== undefined) {
        window.clearTimeout(localDownloadRefreshTimerRef.current);
      }
    };
  }, []);

  const scheduleLocalRefreshAfterDownload = useCallback((downloadedLocalPath: string) => {
    if (!isLocalFileInDirectory(downloadedLocalPath, localBrowser.path)) {
      return;
    }

    if (localDownloadRefreshTimerRef.current !== undefined) {
      window.clearTimeout(localDownloadRefreshTimerRef.current);
    }

    localDownloadRefreshTimerRef.current = window.setTimeout(() => {
      localDownloadRefreshTimerRef.current = undefined;

      if (isLocalFileInDirectory(downloadedLocalPath, localBrowser.path)) {
        void localBrowser.loadDirectory(localBrowser.path, { recordHistory: false });
      }
    }, 150);
  }, [localBrowser]);

  const {
    beginPathEdit,
    cancelPathEdit,
    copyPath,
    copySelectedPath,
    isPathEditing,
    pathDraft,
    pathInputError,
    pathInputRef,
    resetPathUi,
    setPathDraft,
    setPathInputError,
    submitPathEdit,
  } = useSftpPathActions({
    homePath,
    loadDirectory: loadSftpDirectory,
    path,
    selectedEntries: activeRemoteSelectedEntries,
    setActionMenuOpen: setIsActionMenuOpen,
  });
  useEffect(() => {
    resetPathUiRef.current = resetPathUi;
  }, [resetPathUi]);
  const {
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
  } = useSftpPanelRemoteOperations({
    activeRemoteSelectedEntries,
    activeRemoteSelectedEntry,
    downloadableEntries,
    entries,
    isRemoteReady,
    onDownloadCompleted: scheduleLocalRefreshAfterDownload,
    panelId,
    panelRef,
    parentEntryPathKey: sftpParentEntryPath,
    parentPath,
    path,
    refreshCurrentDirectory,
    remoteIdentity,
    residualUploadEntries,
    runBrowserAction,
    setError,
  });
  const startActiveRemoteDownload = () => startDownloadEntries(activeRemoteSelectedEntries);
  const startCommanderRemoteDownload = () => startDownloadEntries(commanderRemoteSelectedEntries);
  const handleSelectAll = useCallback(() => {
    selectAllEntries();
  }, [selectAllEntries]);
  const headerActions = useSftpPanelHeaderActions({
    canRemoteDelete: canDelete,
    canRemoteDownload: canDownload,
    canRemoteRename: canRename,
    cleanResidualUploadFiles,
    copyRemotePath: copyPath,
    createLocalFolder: localBrowser.createFolder,
    createRemoteFolder: createFolder,
    deleteLocalSelected: localBrowser.deleteSelected,
    deleteRemote: deleteEntry,
    downloadRemote: startActiveRemoteDownload,
    isCommanderLocalActive,
    localIsLoading: localBrowser.isLoading,
    localPath: localBrowser.path,
    localSelectedEntriesCount: localBrowser.selectedEntries.length,
    localSelectedEntryPaths: localBrowser.selectedEntryPaths,
    refreshLocal: () => localBrowser.loadDirectory(localBrowser.path),
    refreshRemote: () => void loadSftpDirectory(),
    renameRemote: renameEntry,
    setActionMenuOpen: setIsActionMenuOpen,
    setViewMode,
    uploadFiles: startUpload,
    uploadFolder: startUploadFolder,
  });
  useSftpActivationSelectionSync({
    clearPendingActivationSelectionPath,
    commanderRemoteSelectedPaths,
    localSelectedEntryPaths: localBrowser.selectedEntryPaths,
    pendingActivationSelectionPath,
    selectedEntryPath,
    selectedEntryPaths,
  });

  useSftpPanelPublishing({
    connectionState,
    entries,
    isLoading,
    localPath: localBrowser.path,
    panelId,
    path,
    selectedEntries,
    session,
    showHiddenEntries,
    transferSummary,
    visibleEntries,
    viewMode,
  });

  const handlePanelKeyDown = useSftpKeyboardShortcuts({
    enabled: viewMode === 'explorer',
    isActivePanelRef,
    isLoading: isCommanderLocalActive ? localBrowser.isLoading : isLoading,
    isPathEditing,
    isRemoteReady,
    navigablePaths,
    onBeginPathEdit: beginPathEdit,
    onDelete: () => void deleteEntry(),
    onGoBack: () => void goBackWithScrollSave(),
    onGoForward: () => void goForwardWithScrollSave(),
    onMoveSelection: moveSelection,
    onOpenParent: (nextPath) => void loadSftpDirectory(nextPath),
    onOpenSelectedPath: openSelectedPath,
    onRefresh: () => void loadSftpDirectory(),
    onRename: () => void renameEntry(),
    onSelectAll: handleSelectAll,
    onSelectEntryPath: selectEntryPath,
    parentPath,
  });
  return (
    <div
      ref={panelRef}
      className="relative flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-sm text-foreground"
      onFocusCapture={handleFocusCapture}
      onKeyDown={handlePanelKeyDown}
      onPointerDownCapture={handlePointerDownCapture}
      tabIndex={0}
    >
      <SftpPanelHeader
        backStackLength={backStack.length}
        forwardStackLength={forwardStack.length}
        isActionMenuOpen={isActionMenuOpen}
        isLoading={isLoading}
        isNarrow={isNarrow}
        isRemoteReady={isRemoteReady}
        isTiny={isTiny}
        onGoBack={() => void goBackWithScrollSave()}
        onGoForward={() => void goForwardWithScrollSave()}
        onSetActionMenuOpen={setIsActionMenuOpen}
        onSetShowHiddenEntries={setShowHiddenEntries}
        onSetShowPermissions={setShowPermissions}
        residualUploadCount={residualUploadEntries.length}
        sessionHost={session.host}
        sessionUsername={session.username}
        showHiddenEntries={showHiddenEntries}
        showPermissions={showPermissions}
        showActions={viewMode === 'explorer'}
        showInlineViewMode
        viewMode={viewMode}
        {...headerActions}
      />

      {viewMode === 'explorer' && (
        <SftpPathBar
          inputError={pathInputError}
          inputRef={pathInputRef}
          isEditing={isPathEditing}
          isLoading={isLoading}
          isRemoteReady={isRemoteReady}
          onBeginEdit={beginPathEdit}
          onCancelEdit={cancelPathEdit}
          onCopyPath={() => void copyPath()}
          onDraftChange={(value) => {
            setPathDraft(value);
            setPathInputError(undefined);
          }}
          onNavigate={(nextPath) => void loadSftpDirectory(nextPath)}
          onSubmitEdit={() => void submitPathEdit()}
          pathDraft={pathDraft}
          segments={pathSegments}
        />
      )}

      <SftpPanelBody
        connectionState={connectionState}
        entriesCount={entries.length}
        error={error}
        isLoading={isLoading}
        moveStatus={moveStatus}
        onDismissOperationNotice={() => setOperationNotice(undefined)}
        onReconnect={() => void connectSftp()}
        operationNotice={operationNotice}
        parentPath={parentPath}
        transferSummary={transferSummary}
        transfers={transfers}
      >
        {viewMode === 'commander' ? (
          <SftpCommanderView
            activePane={commanderActivePane}
            canRemoteDelete={canDelete}
            canRemoteDownload={canDownload}
            canRemoteRename={canRename}
            isPanelActive={isActive}
            isRemoteReady={isRemoteReady}
            localEntries={localBrowser.entries}
            localError={localBrowser.error}
            localIsLoading={localBrowser.isLoading}
            localParentPath={localBrowser.parentPath}
            localPath={localBrowser.path}
            localRoots={localBrowser.roots}
            localSelectedPaths={localBrowser.selectedEntryPaths}
            pendingActivationSelectionPath={pendingActivationSelectionPath}
            localBackStackLength={localBrowser.backStack.length}
            localForwardStackLength={localBrowser.forwardStack.length}
            onActivePaneChange={setCommanderActivePane}
            onCopyRemotePath={() => void copySelectedPath()}
            onCreateRemoteFolder={() => void createFolder()}
            onDeleteRemote={() => void deleteEntry()}
            onDownloadRemote={() => void startCommanderRemoteDownload()}
            onLocalGoBack={() => void localBrowser.goBack()}
            onLocalGoForward={() => void localBrowser.goForward()}
            onLocalRefresh={() => void localBrowser.loadDirectory(localBrowser.path)}
            onCreateLocalFolder={() => void localBrowser.createFolder()}
            onDeleteLocal={() => void localBrowser.deleteSelected()}
            onFavoriteLocalPath={favoriteLocalPath}
            onFavoriteRemotePath={favoriteRemotePath}
            onRemoteGoBack={() => void goBackWithScrollSave()}
            onRemoteGoForward={() => void goForwardWithScrollSave()}
            onRemoteRefresh={() => void loadSftpDirectory()}
            onRenameRemote={() => void renameEntry()}
            onRemoteMoveDragEnd={clearRemoteMoveTarget}
            onRemoteMoveDragOver={handleRemoteMoveDragOver}
            onRemoteMoveDragStart={(event, paths) => markRemoteMoveDrag(event.dataTransfer, paths)}
            onRemoteMoveDrop={handleRemoteMoveDrop}
            onSetShowHiddenEntries={(value) => setShowHiddenEntries(value)}
            onSetShowPermissions={(value) => setShowPermissions(value)}
            onUploadFiles={() => void startUpload()}
            onUploadFolder={() => void startUploadFolder()}
            remoteEntries={visibleEntries}
            remoteIsLoading={isLoading}
            remoteMoveTargetPath={moveTargetPath}
            remoteParentPath={parentPath}
            remotePath={path}
            remoteSelectedPaths={commanderRemoteSelectedPaths}
            remoteBackStackLength={backStack.length}
            remoteForwardStackLength={forwardStack.length}
            showHiddenEntries={showHiddenEntries}
            showPermissions={showPermissions}
            onDownloadRemotePathsToLocal={(paths) => {
              const draggedEntries = visibleEntries.filter((entry) => paths.includes(entry.path));
              void startDownloadEntriesToDirectory(draggedEntries, localBrowser.path).then(() => {
                void localBrowser.loadDirectory(localBrowser.path);
              });
            }}
            onLocalNavigate={(nextPath) => void localBrowser.loadDirectory(nextPath)}
            onLocalSelect={localBrowser.toggleSelectedEntry}
            onLocalSelectMany={localBrowser.setSelectedEntryPaths}
            onRemoteNavigate={(nextPath) => void loadSftpDirectory(nextPath)}
            onRemoteSelect={handleCommanderRemoteSelect}
            onRemoteSelectMany={setCommanderRemoteSelectedPaths}
            onUploadLocalPathsToRemote={(paths) => {
              void startUploadFromPaths(paths, path);
            }}
          />
        ) : (
          <SftpExplorerView
            canDelete={canDelete}
            canDownload={canDownload}
            canRename={canRename}
            dragUploadTargetPath={dragUploadTargetPath}
            isLoading={isLoading}
            isPanelActive={isActive}
            isRemoteReady={isRemoteReady}
            isUploadDragOver={isUploadDragOver}
            marqueeBox={marqueeBox}
            onBeginMarqueeSelection={beginMarqueeSelection}
            onCleanResidualUploadFiles={() => void cleanResidualUploadFiles()}
            onContextSelectEntry={(entryPath, event) => {
              if (!selectedEntryPaths.includes(entryPath)) {
                selectEntryPath(entryPath, event);
              }
            }}
            onCopySelectedPath={() => void copySelectedPath()}
            onCreateFolder={() => void createFolder()}
            onDelete={() => void deleteEntry()}
            onDownload={() => void startDownload()}
            onDragLeave={handleUploadDragLeave}
            onDragOver={handleUploadDragOver}
            onDrop={handleUploadDrop}
            onEndMarqueeSelection={endMarqueeSelection}
            onFavoritePath={favoriteRemotePath}
            onOpenEntry={openEntry}
            onOpenParent={(nextPath) => void loadSftpDirectory(nextPath)}
            onRefresh={() => void loadSftpDirectory()}
            onRemoteMoveDragEnd={clearRemoteMoveTarget}
            onRemoteMoveDragOver={handleRemoteMoveDragOver}
            onRemoteMoveDragStart={(event, paths) => markRemoteMoveDrag(event.dataTransfer, paths)}
            onRemoteMoveDrop={handleRemoteMoveDrop}
            onRename={() => void renameEntry()}
            onSelectEntry={selectEntryPath}
            onSetShowHiddenEntries={(value) => setShowHiddenEntries(value)}
            onSetShowPermissions={(value) => setShowPermissions(value)}
            onUpdateMarqueeSelection={updateMarqueeSelection}
            onUploadFiles={() => void startUpload()}
            onUploadFolder={() => void startUploadFolder()}
            parentEntryPathKey={sftpParentEntryPath}
            parentPath={parentPath}
            path={path}
            pendingActivationSelectionPath={pendingActivationSelectionPath}
            remoteMoveTargetPath={moveTargetPath}
            residualUploadEntries={residualUploadEntries}
            scrollViewportRef={fileTableScrollViewportRef}
            selectedEntriesCount={selectedEntries.length}
            selectedEntryPath={selectedEntryPath}
            selectedEntryPaths={selectedEntryPaths}
            showHiddenEntries={showHiddenEntries}
            showLoadingOverlay={isLoading}
            showPermissions={showPermissions}
            table={table}
            tableGridTemplateColumns={tableGridTemplateColumns}
          />
        )}
      </SftpPanelBody>
    </div>
  );
}

function isLocalFileInDirectory(filePath: string | undefined, directoryPath: string | undefined) {
  if (!filePath || !directoryPath) {
    return false;
  }

  return normalizeLocalPathForCompare(getLocalParentPath(filePath)) === normalizeLocalPathForCompare(directoryPath);
}

function getLocalParentPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');

  if (lastSeparatorIndex <= 0) {
    return normalizedPath;
  }

  return normalizedPath.slice(0, lastSeparatorIndex);
}

function normalizeLocalPathForCompare(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
