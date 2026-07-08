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
import type { SessionItem } from '@/types/workspace';
import { SftpClosedCard, SftpRestoredCard } from './SftpPanelChrome';
import { SftpFileTable } from './SftpFileTable';
import { SftpPanelHeader, SftpPathBar } from './SftpPanelHeader';
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
import { useSftpPathActions } from './useSftpPathActions';
import { useSftpSelection } from './useSftpSelection';
import { useSftpTransfers } from './useSftpTransfers';
import { useSftpUploadDrop } from './useSftpUploadDrop';
import { publishSftpSidebarPanelState } from './sftpSidebarState';
import type { SftpEntry } from './sftpBridge';

const sftpParentEntryPath = '__sftp_parent__';

export function SftpPanel({
  autoConnect = true,
  panelId,
  session,
}: {
  autoConnect?: boolean;
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
  const [showHiddenEntries, setShowHiddenEntries] = useState(true);
  const [showPermissions, setShowPermissions] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'name' }]);
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
    waitForTransferCompletion,
  } = useSftpTransfers({
    onError: setError,
    onUploadCompleted: () => {
      refreshCurrentDirectory();
    },
    panelId,
  });
  const isMeasured = panelWidth > 0;
  const isCompact = isMeasured && panelWidth < 720;
  const isNarrow = isMeasured && panelWidth < 520;
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
  const hasSingleSelection = selectedEntries.length === 1;
  const canRename = hasSingleSelection;
  const canDelete = selectedEntries.length > 0;
  const downloadableEntries = selectedEntries;
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
    loadDirectory,
    path,
    selectedEntries,
    setActionMenuOpen: setIsActionMenuOpen,
  });
  useEffect(() => {
    resetPathUiRef.current = resetPathUi;
  }, [resetPathUi]);
  const {
    startDownload,
    startUpload,
    startUploadFolder,
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
    cleanResidualUploadFiles,
    createFolder,
    deleteEntry,
    renameEntry,
  } = useSftpFileActions({
    panelId,
    path,
    residualUploadEntries,
    runBrowserAction,
    selectedEntries,
    selectedEntry,
  });
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

  const openEntry = (entry: SftpEntry) => {
    if (entry.isDirectory) {
      void loadDirectory(entry.path);
    }
  };
  const openSelectedPath = () => {
    if (selectedEntryPath === sftpParentEntryPath && parentPath) {
      void loadDirectory(parentPath);
      return;
    }

    if (selectedEntry?.isDirectory) {
      void loadDirectory(selectedEntry.path);
    }
  };
  const handlePanelKeyDown = useSftpKeyboardShortcuts({
    isActivePanelRef,
    isLoading,
    isPathEditing,
    isRemoteReady,
    navigablePaths,
    onBeginPathEdit: beginPathEdit,
    onDelete: () => void deleteEntry(),
    onGoBack: () => void goBack(),
    onGoForward: () => void goForward(),
    onMoveSelection: moveSelection,
    onOpenParent: (nextPath) => void loadDirectory(nextPath),
    onOpenSelectedPath: openSelectedPath,
    onRefresh: () => void loadDirectory(),
    onRename: () => void renameEntry(),
    onSelectAll: selectAllEntries,
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
        backStackLength={backStack.length}
        canDelete={canDelete}
        canDownload={canDownload}
        canRename={canRename}
        forwardStackLength={forwardStack.length}
        isActionMenuOpen={isActionMenuOpen}
        isLoading={isLoading}
        isNarrow={isNarrow}
        isRemoteReady={isRemoteReady}
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
        onGoBack={() => void goBack()}
        onGoForward={() => void goForward()}
        onRefresh={() => void loadDirectory()}
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
        sessionHost={session.host}
        sessionUsername={session.username}
        showHiddenEntries={showHiddenEntries}
        showPermissions={showPermissions}
      />

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
        onNavigate={(nextPath) => void loadDirectory(nextPath)}
        onSubmitEdit={() => void submitPathEdit()}
        pathDraft={pathDraft}
        segments={pathSegments}
      />

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
        <div className="flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <div className="min-h-0 flex-1 p-3 text-xs text-slate-400">Loading SFTP directory...</div>
          ) : entries.length === 0 && !parentPath ? (
            <div className="min-h-0 flex-1 p-3 text-xs text-slate-400">No remote entries.</div>
          ) : (
            <>
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
                onOpenParent={(nextPath) => void loadDirectory(nextPath)}
                onRefresh={() => void loadDirectory()}
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
                residualUploadEntries={residualUploadEntries}
                selectedEntriesCount={selectedEntries.length}
                selectedEntryPath={selectedEntryPath}
                selectedEntryPaths={selectedEntryPaths}
                showHiddenEntries={showHiddenEntries}
                showPermissions={showPermissions}
                table={table}
                tableGridTemplateColumns={tableGridTemplateColumns}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
