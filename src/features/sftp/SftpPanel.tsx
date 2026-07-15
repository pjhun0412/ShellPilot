import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnSizingState,
  type SortingState,
} from '@tanstack/react-table';
import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { loadPreferences, updatePreferences } from '@/features/settings/appPreferences';
import type { SessionItem } from '@/types/workspace';
import { SftpCommanderView, type CommanderPaneVariant } from './SftpCommanderView';
import { SftpClosedCard, SftpRestoredCard } from './SftpPanelChrome';
import { SftpFileTable } from './SftpFileTable';
import { SftpPanelHeader, SftpPathBar, type SftpViewMode } from './SftpPanelHeader';
import { SftpPanelTransferSummary } from './SftpPanelTransferQueue';
import {
  getSftpParentPath,
  getSftpPathSegments,
} from './sftpPathUtils';
import {
  isSftpResidualUploadEntry,
  mapSftpConnectionStateToStatus,
} from './sftpPanelUtils';
import {
  createSftpColumns,
  getSftpColumnVisibility,
  getSftpTableGridTemplateColumns,
} from './sftpTableColumns';
import { useSftpTransferActions } from './useSftpTransferActions';
import { useSftpBrowserLifecycle } from './useSftpBrowserLifecycle';
import { useSftpFileActions } from './useSftpFileActions';
import { useSftpKeyboardShortcuts } from './useSftpKeyboardShortcuts';
import { useLocalFileBrowser } from './useLocalFileBrowser';
import { useSftpPathActions } from './useSftpPathActions';
import { useSftpRemoteMove } from './useSftpRemoteMove';
import { useSftpScrollRestoration } from './useSftpScrollRestoration';
import { useSftpSelection } from './useSftpSelection';
import { useSftpTransfers } from './useSftpTransfers';
import { useSftpUploadDrop } from './useSftpUploadDrop';
import {
  clearSftpAiContextSnapshot,
  publishSftpAiContextSnapshot,
} from './sftpAiContext';
import { publishSftpSidebarPanelState } from './sftpSidebarState';
import { requestSftpTransferQueueOpen } from './sftpTransferQueueState';
import type { SftpEntry } from './sftpBridge';

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
  const isActivePanelRef = useRef(false);
  const resetSelectionRef = useRef<() => void>(() => undefined);
  const resetPathUiRef = useRef<() => void>(() => undefined);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const [showHiddenEntries, setShowHiddenEntriesState] = useState(() => loadPreferences().sftp.showHiddenFiles);
  const [showPermissions, setShowPermissions] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'name' }]);
  const [viewMode, setViewMode] = useState<SftpViewMode>('explorer');
  const [commanderActivePane, setCommanderActivePane] = useState<CommanderPaneVariant>('remote');
  const [commanderRemoteSelectedPaths, setCommanderRemoteSelectedPaths] = useState<string[]>([]);
  const setShowHiddenEntries = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setShowHiddenEntriesState((current) => {
      const nextValue = typeof value === 'function' ? value(current) : value;

      updatePreferences((preferences) => ({
        ...preferences,
        sftp: {
          ...preferences.sftp,
          showHiddenFiles: nextValue,
        },
      }));

      return nextValue;
    });
  }, []);
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
  const visibleEntries = useMemo(
    () => entries.filter((entry) => showHiddenEntries || !entry.filename.startsWith('.')),
    [entries, showHiddenEntries],
  );
  const residualUploadEntries = useMemo(
    () => entries.filter(isSftpResidualUploadEntry),
    [entries],
  );
  const {
    addPendingTransfer,
    deleteTransferWaiter,
    markTransferFailed,
    transferSummary,
    transfers,
    waitForTransferCompletion,
  } = useSftpTransfers({
    onError: setError,
    onUploadCompleted: () => {
      refreshCurrentDirectory();
    },
    panelId,
  });
  const isMeasured = panelWidth > 0;
  const isCompact = isMeasured && panelWidth < 900;
  const isNarrow = isMeasured && panelWidth < 640;
  const isTiny = isMeasured && panelWidth < 380;
  const columnVisibility = useMemo(
    () => getSftpColumnVisibility({ isCompact, isNarrow, showPermissions }),
    [isCompact, isNarrow, showPermissions],
  );
  const columns = useMemo(
    () => createSftpColumns({ isCompact, isNarrow, isTiny }),
    [isCompact, isNarrow, isTiny],
  );
  const table = useReactTable({
    columnResizeMode: 'onChange',
    columns,
    data: visibleEntries,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnSizingChange: setColumnSizing,
    onSortingChange: setSorting,
    state: {
      columnSizing,
      columnVisibility,
      sorting,
    },
  });
  const visibleColumns = table.getVisibleLeafColumns();
  const tableGridTemplateColumns = getSftpTableGridTemplateColumns({
    isCompact,
    visibleColumns,
  });
  const pathSegments = useMemo(() => getSftpPathSegments(path), [path]);
  const parentPath = getSftpParentPath(path);
  const tableRows = table.getRowModel().rows;
  const tableEntries = tableRows.map((row) => row.original);
  const tableContentVersion = useMemo(() => {
    const firstPath = tableEntries[0]?.path ?? '';
    const lastPath = tableEntries[tableEntries.length - 1]?.path ?? '';

    return `${tableEntries.length}:${firstPath}:${lastPath}`;
  }, [tableEntries]);
  const {
    saveScrollPosition,
    scrollViewportRef: fileTableScrollViewportRef,
  } = useSftpScrollRestoration({
    contentVersion: tableContentVersion,
    path,
  });
  const loadSftpDirectory = useCallback((
    nextPath?: string,
    options?: Parameters<typeof loadDirectory>[1],
  ) => {
    saveScrollPosition();
    return loadDirectory(nextPath, options);
  }, [loadDirectory, saveScrollPosition]);
  const goBackWithScrollSave = useCallback(() => {
    saveScrollPosition();
    return goBack();
  }, [goBack, saveScrollPosition]);
  const goForwardWithScrollSave = useCallback(() => {
    saveScrollPosition();
    return goForward();
  }, [goForward, saveScrollPosition]);
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
  const commanderRemoteSelectedEntries = useMemo(
    () => visibleEntries.filter((entry) => commanderRemoteSelectedPaths.includes(entry.path)),
    [commanderRemoteSelectedPaths, visibleEntries],
  );
  const activeRemoteSelectedEntries = viewMode === 'commander'
    ? commanderRemoteSelectedEntries
    : selectedEntries;
  const activeRemoteSelectedEntry = activeRemoteSelectedEntries[0] ?? selectedEntry;
  const canRename = activeRemoteSelectedEntries.length === 1;
  const canDelete = activeRemoteSelectedEntries.length > 0;
  const downloadableEntries = activeRemoteSelectedEntries;
  const canDownload = downloadableEntries.length > 0;
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
    startDownload,
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
    parentEntryPathKey: sftpParentEntryPath,
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
    runBrowserAction,
  });
  const {
    cleanResidualUploadFiles,
    createFolder,
    deleteEntry,
    renameEntry,
  } = useSftpFileActions({
    panelId,
    path,
    residualUploadEntries,
    runBrowserAction,
    selectedEntries: activeRemoteSelectedEntries,
    selectedEntry: activeRemoteSelectedEntry,
  });
  const localBrowser = useLocalFileBrowser({ enabled: viewMode === 'commander' });
  const isCommanderLocalActive = viewMode === 'commander' && commanderActivePane === 'local';
  const handleCommanderRemoteSelect = useCallback((entryPath: string, additive: boolean) => {
    setCommanderRemoteSelectedPaths((current) => {
      if (!additive) {
        return [entryPath];
      }

      return current.includes(entryPath)
        ? current.filter((path) => path !== entryPath)
        : [...current, entryPath];
    });
  }, []);
  const handleViewModeChange = useCallback((nextViewMode: SftpViewMode) => {
    setIsActionMenuOpen(false);
    setViewMode(nextViewMode);
  }, []);
  const handleSelectAll = useCallback(() => {
    selectAllEntries();
  }, [selectAllEntries]);
  const handleHeaderRefresh = useCallback(() => {
    if (isCommanderLocalActive) {
      void localBrowser.loadDirectory(localBrowser.path);
      return;
    }

    void loadSftpDirectory();
  }, [isCommanderLocalActive, loadSftpDirectory, localBrowser]);
  useEffect(() => {
    isActivePanelRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const element = panelRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      setPanelWidth(Math.round(entry.contentRect.width));
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const panelElement = panelRef.current;

      if (!panelElement || !(event.target instanceof Node)) {
        isActivePanelRef.current = false;
        return;
      }

      isActivePanelRef.current = panelElement.contains(event.target);
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    };
  }, []);

  useEffect(() => {
    publishSftpSidebarPanelState(panelId, {
      host: session.host,
      path,
      status: mapSftpConnectionStateToStatus(connectionState),
      title: session.name,
      transferSummary,
      username: session.username,
    });
  }, [connectionState, panelId, path, session.host, session.name, session.username, transferSummary]);

  useEffect(() => {
    publishSftpAiContextSnapshot(panelId, {
      connectionState,
      entries: visibleEntries,
      host: session.host,
      isLoading,
      path,
      selectedEntries,
      sessionName: session.name,
      showHiddenEntries,
      totalEntryCount: entries.length,
      username: session.username,
      visibleEntryCount: visibleEntries.length,
    });
  }, [
    connectionState,
    entries.length,
    isLoading,
    panelId,
    path,
    selectedEntries,
    session.host,
    session.name,
    session.username,
    showHiddenEntries,
    visibleEntries,
  ]);

  useEffect(() => {
    return () => {
      clearSftpAiContextSnapshot(panelId);
    };
  }, [panelId]);

  const openEntry = (entry: SftpEntry) => {
    if (entry.isDirectory) {
      void loadSftpDirectory(entry.path);
    }
  };
  useEffect(() => {
    setCommanderRemoteSelectedPaths([]);
  }, [path]);

  const openSelectedPath = () => {
    if (selectedEntryPath === sftpParentEntryPath && parentPath) {
      void loadSftpDirectory(parentPath);
      return;
    }

    if (selectedEntry?.isDirectory) {
      void loadSftpDirectory(selectedEntry.path);
    }
  };
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
      className="relative flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-sm text-slate-100"
      onFocusCapture={() => {
        isActivePanelRef.current = true;
      }}
      onKeyDown={handlePanelKeyDown}
      onPointerDownCapture={() => {
        isActivePanelRef.current = true;
        panelRef.current?.focus({ preventScroll: true });
      }}
      tabIndex={0}
    >
      <SftpPanelHeader
        areRemoteActionsDisabled={isCommanderLocalActive}
        backStackLength={backStack.length}
        canDelete={canDelete}
        canDownload={canDownload}
        canRename={canRename}
        forwardStackLength={forwardStack.length}
        isActionMenuOpen={isActionMenuOpen}
        isLoading={isLoading}
        isNarrow={isNarrow}
        isRemoteReady={isRemoteReady}
        isRefreshDisabled={isCommanderLocalActive ? localBrowser.isLoading : undefined}
        isTiny={isTiny}
        onCleanResidualUploadFiles={() => {
          setIsActionMenuOpen(false);
          void cleanResidualUploadFiles();
        }}
        onCopyPath={() => void copyPath()}
        onCreateFolder={() => {
          setIsActionMenuOpen(false);
          void createFolder();
        }}
        onDelete={() => {
          setIsActionMenuOpen(false);
          void deleteEntry();
        }}
        onDownload={() => {
          setIsActionMenuOpen(false);
          void startDownload();
        }}
        onGoBack={() => void goBackWithScrollSave()}
        onGoForward={() => void goForwardWithScrollSave()}
        onRefresh={handleHeaderRefresh}
        onRename={() => {
          setIsActionMenuOpen(false);
          void renameEntry();
        }}
        onSetActionMenuOpen={setIsActionMenuOpen}
        onSetShowHiddenEntries={setShowHiddenEntries}
        onSetShowPermissions={setShowPermissions}
        onUploadFiles={() => {
          setIsActionMenuOpen(false);
          void startUpload();
        }}
        onUploadFolder={() => {
          setIsActionMenuOpen(false);
          void startUploadFolder();
        }}
        residualUploadCount={residualUploadEntries.length}
        refreshTitle={isCommanderLocalActive ? 'Refresh local' : 'Refresh remote'}
        sessionHost={session.host}
        sessionUsername={session.username}
        showHiddenEntries={showHiddenEntries}
        showPermissions={showPermissions}
        showInlineViewMode={!isCompact}
        viewMode={viewMode}
        onSetViewMode={handleViewModeChange}
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

      {connectionState === 'restored' ? (
        <SftpRestoredCard onReconnect={() => void connectSftp()} />
      ) : connectionState === 'closed' ? (
        <SftpClosedCard onReconnect={() => void connectSftp()} />
      ) : error ? (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-words">{error}</span>
            <Button size="sm" type="button" onClick={() => void connectSftp()}>
              <RotateCcw className="size-3.5" />
              Reconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {isLoading && entries.length === 0 && !parentPath ? (
            <div className="min-h-0 flex-1 p-3 text-xs text-slate-400">Loading SFTP directory...</div>
          ) : entries.length === 0 && !parentPath ? (
            <div className="min-h-0 flex-1 p-3 text-xs text-slate-400">No remote entries.</div>
          ) : (
            <>
              {viewMode === 'commander' ? (
                <SftpCommanderView
                  activePane={commanderActivePane}
                  canRemoteDelete={canDelete}
                  canRemoteDownload={canDownload}
                  canRemoteRename={canRename}
                  isRemoteReady={isRemoteReady}
                  localEntries={localBrowser.entries}
                  localError={localBrowser.error}
                  localIsLoading={localBrowser.isLoading}
                  localParentPath={localBrowser.parentPath}
                  localPath={localBrowser.path}
                  localRoots={localBrowser.roots}
                  localSelectedPaths={localBrowser.selectedEntryPaths}
                  onActivePaneChange={setCommanderActivePane}
                  onCopyRemotePath={() => void copySelectedPath()}
                  onCreateRemoteFolder={() => void createFolder()}
                  onDeleteRemote={() => void deleteEntry()}
                  onDownloadRemote={() => void startDownload()}
                  onLocalRefresh={() => void localBrowser.loadDirectory(localBrowser.path)}
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
                  showHiddenEntries={showHiddenEntries}
                  showPermissions={showPermissions}
                  onDownloadRemotePathsToLocal={(paths) => {
                    const draggedEntries = visibleEntries.filter((entry) => paths.includes(entry.path));
                    void startDownloadEntriesToDirectory(draggedEntries, localBrowser.path);
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
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <SftpFileTable
                    canDelete={canDelete}
                    canDownload={canDownload}
                    canRename={canRename}
                    dragUploadTargetPath={dragUploadTargetPath}
                    isLoading={isLoading}
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
                    remoteMoveTargetPath={moveTargetPath}
                    residualUploadEntries={residualUploadEntries}
                    selectedEntriesCount={selectedEntries.length}
                    selectedEntryPath={selectedEntryPath}
                    selectedEntryPaths={selectedEntryPaths}
                    showHiddenEntries={showHiddenEntries}
                    showPermissions={showPermissions}
                    scrollViewportRef={fileTableScrollViewportRef}
                    table={table}
                    tableGridTemplateColumns={tableGridTemplateColumns}
                  />
                  {isLoading && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-primary/20 bg-slate-950/80 px-3 py-1 text-[11px] font-medium text-primary">
                      Loading SFTP directory...
                    </div>
                  )}
                </div>
              )}
              {moveStatus && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-primary/20 bg-slate-950/90 px-3 py-1 text-[11px] font-medium text-primary shadow-sm">
                  Moving {moveStatus.count} item{moveStatus.count === 1 ? '' : 's'} to {moveStatus.targetPath}...
                </div>
              )}
              <SftpPanelTransferSummary
                summary={transferSummary}
                transfers={transfers}
                onOpenQueue={requestSftpTransferQueueOpen}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
