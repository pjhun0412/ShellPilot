import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type SortingState,
} from '@tanstack/react-table';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Server,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { Button } from '@/components/ui/button';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import type { SessionItem } from '@/types/workspace';
import {
  closeSftpSession,
  createSftpDirectory,
  listSftpDirectory,
  openSftpSession,
  removeSftpDirectory,
  removeSftpFile,
  renameSftpPath,
  type SftpEntry,
} from './sftpBridge';

const sftpGridScrollbarGutter = 18;
const sftpParentEntryPath = '__sftp_parent__';

export function SftpPanel({ panelId, session }: { panelId: string; session: SessionItem }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [homePath, setHomePath] = useState('.');
  const [panelWidth, setPanelWidth] = useState(0);
  const [path, setPath] = useState('.');
  const [pathDraft, setPathDraft] = useState('.');
  const [pathInputError, setPathInputError] = useState<string>();
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string>();
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<string[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>();
  const [showHiddenEntries, setShowHiddenEntries] = useState(true);
  const [showPermissions, setShowPermissions] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ desc: false, id: 'name' }]);
  const visibleEntries = useMemo(
    () => entries.filter((entry) => showHiddenEntries || !entry.filename.startsWith('.')),
    [entries, showHiddenEntries],
  );
  const selectedEntry = visibleEntries.find((entry) => entry.path === selectedEntryPath);
  const selectedEntries = visibleEntries.filter((entry) => selectedEntryPaths.includes(entry.path));
  const hasSingleSelection = selectedEntries.length === 1;
  const canRename = hasSingleSelection;
  const canDelete = selectedEntries.length > 0;
  const isMeasured = panelWidth > 0;
  const isCompact = isMeasured && panelWidth < 720;
  const isNarrow = isMeasured && panelWidth < 520;
  const isTiny = isMeasured && panelWidth < 380;
  const columnVisibility = useMemo<Record<string, boolean>>(
    () => ({
      kind: !isCompact,
      modifiedAt: !isNarrow,
      owner: !isCompact,
      permissions: showPermissions && !isCompact,
    }),
    [isCompact, isNarrow, showPermissions],
  );
  const columns = useMemo<ColumnDef<SftpEntry>[]>(
    () => [
      {
        accessorKey: 'filename',
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <SftpEntryIcon entry={row.original} />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate font-medium">{row.original.filename}</span>
              {isNarrow && (
                <span className="truncate font-mono text-[10px] font-normal text-slate-500">
                  {row.original.kind}
                  {row.original.modifiedAt ? ` · ${formatModifiedAt(row.original.modifiedAt)}` : ''}
                </span>
              )}
            </span>
          </span>
        ),
        header: 'Name',
        id: 'name',
        minSize: isTiny ? 132 : 180,
        size: 360,
      },
      {
        accessorKey: 'kind',
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-slate-500">{row.original.kind}</span>
        ),
        header: 'Type',
        id: 'kind',
        minSize: 72,
        size: 92,
      },
      {
        accessorKey: 'modifiedAt',
        cell: ({ row }) => (
          <span className="truncate font-mono text-[11px] text-slate-500">
            {formatModifiedAt(row.original.modifiedAt)}
          </span>
        ),
        header: 'Modified',
        id: 'modifiedAt',
        minSize: 136,
        size: 168,
        sortingFn: (left, right) =>
          (left.original.modifiedAt ?? 0) - (right.original.modifiedAt ?? 0),
      },
      {
        accessorKey: 'permissions',
        cell: ({ row }) => (
          <span className="block w-full text-right font-mono text-[11px] text-slate-500">
            {row.original.permissions ?? ''}
          </span>
        ),
        header: 'Perm',
        id: 'permissions',
        minSize: 72,
        size: 82,
      },
      {
        accessorKey: 'owner',
        cell: ({ row }) => (
          <span className="truncate font-mono text-[11px] text-slate-500">
            {row.original.owner ?? ''}
          </span>
        ),
        header: 'Owner',
        id: 'owner',
        minSize: 78,
        size: 96,
      },
      {
        accessorFn: (entry) => entry.size ?? 0,
        cell: ({ row }) => (
          <span className="block w-full text-right font-mono text-[11px] text-slate-500">
            {formatBytes(row.original.size)}
          </span>
        ),
        header: 'Size',
        id: 'size',
        minSize: isNarrow ? 78 : 112,
        size: isNarrow ? 86 : 144,
      },
    ],
    [isNarrow, isTiny],
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
  const gridTemplateColumns = visibleColumns
    .map((column) => {
      if (column.id === 'name') {
        return `minmax(${column.columnDef.minSize ?? 180}px, 1fr)`;
      }

      return `${column.getSize()}px`;
    })
    .join(' ');
  const tableGridTemplateColumns = `${gridTemplateColumns} ${sftpGridScrollbarGutter}px`;
  const pathSegments = useMemo(() => getSftpPathSegments(path), [path]);
  const parentPath = getSftpParentPath(path);
  const tableRows = table.getRowModel().rows;
  const navigablePaths = [
    ...(parentPath ? [sftpParentEntryPath] : []),
    ...tableRows.map((row) => row.original.path),
  ];

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
    if (!isPathEditing) {
      return;
    }

    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isPathEditing]);

  useEffect(() => {
    if (!selectedEntryPath) {
      return;
    }

    const selectedRow = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-sftp-entry-path]') ?? [],
    ).find((element) => element.dataset.sftpEntryPath === selectedEntryPath);

    selectedRow?.scrollIntoView({ block: 'nearest' });
  }, [selectedEntryPath]);

  const loadDirectory = async (
    nextPath = path,
    options: { onError?: (message: string) => void; recordHistory?: boolean } = {},
  ) => {
    const previousPath = path;
    setIsLoading(true);
    setError(undefined);

    try {
      const result = await listSftpDirectory(panelId, nextPath);

      if (nextPath === '.') {
        setHomePath(result.path);
      }

    setPath(result.path);
    setEntries(result.entries);
    setSelectedEntryPath(undefined);
    setSelectedEntryPaths([]);
    setSelectionAnchorPath(undefined);

      if ((options.recordHistory ?? true) && result.path !== previousPath) {
        setBackStack((stack) => [...stack, previousPath]);
        setForwardStack([]);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      setError(message);
      options.onError?.(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;

    const open = async () => {
      setIsLoading(true);
      setError(undefined);
      publishConnectionStatus({ panelId, status: 'connecting' });

      try {
        await openSftpSession(panelId, session);
        publishConnectionStatus({ panelId, status: 'connected' });
        if (!disposed) {
          await loadDirectory('.', { recordHistory: false });
        }
      } catch (error) {
        publishConnectionStatus({ panelId, status: 'failed' });
        if (!disposed) {
          setError(error instanceof Error ? error.message : String(error));
          setIsLoading(false);
        }
      }
    };

    void open();

    return () => {
      disposed = true;
      publishConnectionStatus({ panelId, status: 'closed' });
      void closeSftpSession(panelId);
    };
  }, [panelId, session]);

  useEffect(() => {
    setSelectedEntryPaths((paths) =>
      paths.filter((selectedPath) => visibleEntries.some((entry) => entry.path === selectedPath)),
    );

    if (selectedEntryPath && selectedEntryPath !== sftpParentEntryPath && !visibleEntries.some((entry) => entry.path === selectedEntryPath)) {
      setSelectedEntryPath(undefined);
      setSelectionAnchorPath(undefined);
    }
  }, [selectedEntryPath, visibleEntries]);

  const runAction = async (action: () => Promise<void>) => {
    setIsLoading(true);
    setError(undefined);

    try {
      await action();
      await loadDirectory();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
    }
  };
  const goBack = async () => {
    const previousPath = backStack[backStack.length - 1];

    if (!previousPath) {
      return;
    }

    const currentPath = path;
    const didLoad = await loadDirectory(previousPath, { recordHistory: false });

    if (didLoad) {
      setBackStack((stack) => stack.slice(0, -1));
      setForwardStack((stack) => [currentPath, ...stack]);
    }
  };
  const goForward = async () => {
    const nextPath = forwardStack[0];

    if (!nextPath) {
      return;
    }

    const currentPath = path;
    const didLoad = await loadDirectory(nextPath, { recordHistory: false });

    if (didLoad) {
      setForwardStack((stack) => stack.slice(1));
      setBackStack((stack) => [...stack, currentPath]);
    }
  };
  const openEntry = (entry: SftpEntry) => {
    if (entry.isDirectory) {
      void loadDirectory(entry.path);
    }
  };
  const makeChildPath = (name: string) => {
    if (path === '/') {
      return `/${name}`;
    }

    return `${path.replace(/\/$/, '')}/${name}`;
  };
  const createFolder = async () => {
    const folderName = (await appPrompt({
      confirmLabel: 'Create',
      message: 'Enter a folder name for the current remote path.',
      title: 'New Folder',
    }))?.trim();

    if (!folderName) {
      return;
    }

    await runAction(() => createSftpDirectory(panelId, makeChildPath(folderName)));
  };
  const renameEntry = async () => {
    const targetEntry = selectedEntries[0] ?? selectedEntry;

    if (!targetEntry || selectedEntries.length > 1) {
      return;
    }

    const nextName = (await appPrompt({
      defaultValue: targetEntry.filename,
      confirmLabel: 'Rename',
      message: 'Enter a new name for the selected remote item.',
      title: 'Rename',
    }))?.trim();

    if (!nextName || nextName === targetEntry.filename) {
      return;
    }

    await runAction(() => renameSftpPath(panelId, targetEntry.path, makeChildPath(nextName)));
  };
  const deleteEntry = async () => {
    if (selectedEntries.length === 0) {
      return;
    }

    const confirmed = await appConfirm({
      confirmLabel: 'Delete',
      message: selectedEntries.length === 1
        ? `Delete ${selectedEntries[0].filename}?`
        : `Delete ${selectedEntries.length} selected items?`,
      title: 'Delete Remote Item',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await runAction(async () => {
      for (const entry of selectedEntries) {
        if (entry.isDirectory) {
          await removeSftpDirectory(panelId, entry.path);
        } else {
          await removeSftpFile(panelId, entry.path);
        }
      }
    });
  };
  const beginPathEdit = () => {
    setPathDraft(path);
    setPathInputError(undefined);
    setIsPathEditing(true);
  };
  const cancelPathEdit = () => {
    setPathDraft(path);
    setPathInputError(undefined);
    setIsPathEditing(false);
  };
  const submitPathEdit = async () => {
    const nextPath = pathDraft.trim();

    if (!nextPath) {
      cancelPathEdit();
      return;
    }

    setPathInputError(undefined);

    const didLoad = await loadDirectory(
      normalizeSftpPathInput(nextPath, path, homePath),
      { onError: setPathInputError },
    );

    if (didLoad) {
      setPathInputError(undefined);
      setIsPathEditing(false);
    }
  };
  const copyPath = async () => {
    setIsActionMenuOpen(false);
    await navigator.clipboard?.writeText(path);
  };
  const copySelectedPath = async () => {
    const targetPath = selectedEntries.length === 1 ? selectedEntries[0].path : path;
    setIsActionMenuOpen(false);
    await navigator.clipboard?.writeText(targetPath);
  };
  const selectEntryPath = (entryPath: string, event?: MouseEvent<HTMLElement>) => {
    setSelectedEntryPath(entryPath);

    if (entryPath === sftpParentEntryPath) {
      setSelectedEntryPaths([]);
      setSelectionAnchorPath(undefined);
      return;
    }

    const entryPaths = tableRows.map((row) => row.original.path);

    if (event?.shiftKey && selectionAnchorPath) {
      const anchorIndex = entryPaths.indexOf(selectionAnchorPath);
      const nextIndex = entryPaths.indexOf(entryPath);

      if (anchorIndex !== -1 && nextIndex !== -1) {
        const [startIndex, endIndex] = anchorIndex < nextIndex
          ? [anchorIndex, nextIndex]
          : [nextIndex, anchorIndex];

        setSelectedEntryPaths(entryPaths.slice(startIndex, endIndex + 1));
        return;
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      setSelectedEntryPaths((paths) =>
        paths.includes(entryPath)
          ? paths.filter((path) => path !== entryPath)
          : [...paths, entryPath],
      );
      setSelectionAnchorPath(entryPath);
      return;
    }

    setSelectedEntryPaths([entryPath]);
    setSelectionAnchorPath(entryPath);
  };
  const selectAllEntries = () => {
    const entryPaths = tableRows.map((row) => row.original.path);
    const focusedPath =
      selectedEntryPath && entryPaths.includes(selectedEntryPath)
        ? selectedEntryPath
        : entryPaths[0];

    setSelectedEntryPaths(entryPaths);
    setSelectedEntryPath(focusedPath);
    setSelectionAnchorPath(focusedPath);
  };
  const moveSelection = (direction: -1 | 1, extendSelection = false) => {
    if (navigablePaths.length === 0) {
      return;
    }

    const currentIndex = selectedEntryPath
      ? navigablePaths.indexOf(selectedEntryPath)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? direction > 0 ? 0 : navigablePaths.length - 1
        : Math.max(0, Math.min(navigablePaths.length - 1, currentIndex + direction));

    const nextPath = navigablePaths[nextIndex];

    setSelectedEntryPath(nextPath);

    if (nextPath === sftpParentEntryPath) {
      if (!extendSelection) {
        setSelectedEntryPaths([]);
      }
      return;
    }

    if (extendSelection && selectionAnchorPath) {
      const entryPaths = tableRows.map((row) => row.original.path);
      const anchorIndex = entryPaths.indexOf(selectionAnchorPath);
      const nextEntryIndex = entryPaths.indexOf(nextPath);

      if (anchorIndex !== -1 && nextEntryIndex !== -1) {
        const [startIndex, endIndex] = anchorIndex < nextEntryIndex
          ? [anchorIndex, nextEntryIndex]
          : [nextEntryIndex, anchorIndex];

        setSelectedEntryPaths(entryPaths.slice(startIndex, endIndex + 1));
      }

      return;
    }

    setSelectedEntryPaths([nextPath]);
    setSelectionAnchorPath(nextPath);
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
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      beginPathEdit();
      return;
    }

    if (isPathEditing || isLoading) {
      return;
    }

    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      void goBack();
      return;
    }

    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      void goForward();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1, event.shiftKey);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1, event.shiftKey);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      if (navigablePaths[0]) {
        selectEntryPath(navigablePaths[0]);
      }
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      if (navigablePaths[navigablePaths.length - 1]) {
        selectEntryPath(navigablePaths[navigablePaths.length - 1]);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      openSelectedPath();
      return;
    }

    if (event.key === 'Backspace' && parentPath) {
      event.preventDefault();
      void loadDirectory(parentPath);
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      void renameEntry();
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      void deleteEntry();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAllEntries();
      return;
    }

    if (event.key === 'F5') {
      event.preventDefault();
      void loadDirectory();
    }
  };
  return (
    <div
      ref={panelRef}
      className="flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-sm text-slate-100"
      onKeyDown={handlePanelKeyDown}
      tabIndex={0}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <Server className="size-4 text-primary" />
        <div className="min-w-0 flex-1 truncate font-medium">
          {session.username ? `${session.username}@` : ''}{session.host}
        </div>
        <Button
          aria-label="Back"
          title="Back"
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => void goBack()}
          disabled={isLoading || backStack.length === 0}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          aria-label="Forward"
          title="Forward"
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => void goForward()}
          disabled={isLoading || forwardStack.length === 0}
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          aria-label="Refresh"
          title="Refresh"
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => void loadDirectory()}
          disabled={isLoading}
        >
          <RefreshCcw className="size-3.5" />
          {!isNarrow && <span>Refresh</span>}
        </Button>
        {!isTiny && (
          <Button
            aria-label="New folder"
            title="New folder"
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => void createFolder()}
            disabled={isLoading}
          >
            <Folder className="size-3.5" />
            {!isNarrow && <span>New</span>}
          </Button>
        )}
        {!isCompact && (
          <>
            <Button size="sm" variant="secondary" type="button" onClick={() => void renameEntry()} disabled={isLoading || !canRename}>
              <Pencil className="size-3.5" />
              Rename
            </Button>
            <Button size="sm" variant="destructive" type="button" onClick={() => void deleteEntry()} disabled={isLoading || !canDelete}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </>
        )}
        {isCompact && (
          <div className="relative">
            <Button
              aria-label="More SFTP actions"
              title="More actions"
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => setIsActionMenuOpen((value) => !value)}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
            {isActionMenuOpen && (
              <div className="absolute right-0 top-9 z-50 grid w-40 gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                {isTiny && (
                  <button
                    className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={isLoading}
                    onClick={() => {
                      setIsActionMenuOpen(false);
                      void createFolder();
                    }}
                  >
                    <Folder className="size-3.5" />
                    New Folder
                  </button>
                )}
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={isLoading}
                  onClick={() => void copyPath()}
                >
                  <Copy className="size-3.5" />
                  Copy Path
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={isLoading || !canRename}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void renameEntry();
                  }}
                >
                  <Pencil className="size-3.5" />
                  Rename
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={isLoading || !canDelete}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void deleteEntry();
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent"
                  type="button"
                  onClick={() => setShowHiddenEntries((value) => !value)}
                >
                  <span className="w-3.5 text-center">{showHiddenEntries ? '✓' : ''}</span>
                  Show Hidden
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent"
                  type="button"
                  onClick={() => setShowPermissions((value) => !value)}
                >
                  <span className="w-3.5 text-center">{showPermissions ? '✓' : ''}</span>
                  Show Permissions
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="flex h-9 shrink-0 items-center overflow-hidden border-b border-border/50 px-3 font-mono text-xs text-slate-300"
        title="Double-click or press Ctrl+L to edit path"
        onDoubleClick={beginPathEdit}
      >
        {isPathEditing ? (
          <input
            ref={pathInputRef}
            className={[
              'h-7 min-w-0 flex-1 rounded border bg-slate-950 px-2 text-xs text-slate-100 outline-none',
              pathInputError ? 'border-destructive/80' : 'border-primary/60',
            ].join(' ')}
            value={pathDraft}
            onBlur={cancelPathEdit}
            onChange={(event) => {
              setPathDraft(event.target.value);
              setPathInputError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitPathEdit();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                cancelPathEdit();
              }
            }}
          />
        ) : (
          <div className="app-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
            {pathSegments.map((segment, index) => {
              const isLast = index === pathSegments.length - 1;

              return (
                <span className="flex min-w-0 items-center gap-1" key={`${segment.path}-${index}`}>
                  {index > 0 && <span className="text-slate-600">/</span>}
                  <button
                    className={[
                      'max-w-44 truncate rounded px-1.5 py-0.5 text-left hover:bg-slate-900/70 hover:text-slate-100',
                      isLast ? 'cursor-default text-slate-100' : 'text-slate-400',
                    ].join(' ')}
                    type="button"
                    title={segment.path}
                    disabled={isLast || isLoading}
                    onClick={() => void loadDirectory(segment.path)}
                  >
                    {segment.label}
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {isPathEditing && pathInputError && (
          <span
            className="ml-2 min-w-20 max-w-56 truncate text-[11px] text-destructive"
            title={pathInputError}
          >
            {pathInputError}
          </span>
        )}
        <button
          className="ml-2 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          title="Edit path (Ctrl+L)"
          aria-label="Edit path"
          disabled={isLoading}
          onClick={(event) => {
            event.stopPropagation();
            beginPathEdit();
          }}
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          className="ml-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
          type="button"
          title="Copy path"
          aria-label="Copy path"
          onClick={(event) => {
            event.stopPropagation();
            void copyPath();
          }}
        >
          <Copy className="size-3.5" />
        </button>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
          {error}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <div className="p-3 text-xs text-slate-400">Loading SFTP directory...</div>
          ) : entries.length === 0 && !parentPath ? (
            <div className="p-3 text-xs text-slate-400">No remote entries.</div>
          ) : (
            <>
              {table.getHeaderGroups().map((headerGroup) => (
                <div
                  className="grid shrink-0 items-center gap-x-2 border-b border-border/60 bg-[hsl(var(--workspace-terminal))] px-3 py-1 text-[11px] font-semibold uppercase text-muted-foreground"
                  key={headerGroup.id}
                  style={{ gridTemplateColumns: tableGridTemplateColumns }}
                >
                  {headerGroup.headers.map((header) => (
                    <div className="relative min-w-0 pr-2" key={header.id}>
                      <button
                        className={[
                          'flex h-6 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-muted-foreground hover:bg-slate-900/70 hover:text-slate-100',
                          header.column.id === 'size' ? 'justify-end text-right' : 'justify-start',
                          header.column.getIsSorted() ? 'text-slate-100' : '',
                        ].join(' ')}
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="truncate">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {header.column.getIsSorted() && (
                          <span className="font-mono text-[10px] text-primary">
                            {header.column.getIsSorted() === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </button>
                      <span
                        className={[
                          'absolute right-0 top-0 h-full w-2 cursor-col-resize border-r hover:border-primary/80',
                          header.column.getIsResizing() ? 'border-primary' : 'border-border/50',
                        ].join(' ')}
                        role="separator"
                        aria-orientation="vertical"
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                    </div>
                  ))}
                  <span aria-hidden="true" />
                </div>
              ))}
              <div className="min-h-0 flex-1">
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="h-full min-h-0">
                      <OverlayScrollArea>
                        <div className="grid min-w-full gap-0.5 py-1 pl-2 pr-1">
                          {parentPath && (
                            <button
                              className={[
                                'grid min-h-8 items-center gap-x-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800/75 hover:text-white',
                                selectedEntryPath === sftpParentEntryPath ? 'bg-slate-800 text-white ring-1 ring-inset ring-primary/60' : '',
                              ].join(' ')}
                              data-sftp-entry-path={sftpParentEntryPath}
                              style={{ gridTemplateColumns: tableGridTemplateColumns }}
                              type="button"
                              title="Parent directory"
                              onClick={(event) => selectEntryPath(sftpParentEntryPath, event)}
                              onDoubleClick={() => void loadDirectory(parentPath)}
                            >
                              <span className="min-w-0 px-1">
                                <span className="flex min-w-0 items-center gap-2">
                                  <FolderOpen className="size-4 shrink-0 text-amber-300" />
                                  <span className="truncate font-medium">..</span>
                                </span>
                              </span>
                              {visibleColumns.some((column) => column.id === 'kind') && (
                                <span className="min-w-0 px-1">
                                  <span className="truncate font-mono text-[11px] text-slate-500">
                                    parent
                                  </span>
                                </span>
                              )}
                              {visibleColumns.some((column) => column.id === 'modifiedAt') && (
                                <span className="min-w-0 px-1" />
                              )}
                              {visibleColumns.some((column) => column.id === 'permissions') && (
                                <span className="min-w-0 px-1" />
                              )}
                              {visibleColumns.some((column) => column.id === 'owner') && (
                                <span className="min-w-0 px-1" />
                              )}
                              <span className="min-w-0 px-1" />
                              <span aria-hidden="true" />
                            </button>
                          )}
                          {tableRows.map((row) => (
                            <button
                              className={[
                                'grid min-h-8 items-center gap-x-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800/75 hover:text-white',
                                selectedEntryPaths.includes(row.original.path) ? 'bg-slate-800 text-white ring-1 ring-inset ring-primary/60' : '',
                                selectedEntryPath === row.original.path && !selectedEntryPaths.includes(row.original.path) ? 'ring-1 ring-inset ring-primary/40' : '',
                              ].join(' ')}
                              data-sftp-entry-path={row.original.path}
                              key={row.original.path}
                              style={{ gridTemplateColumns: tableGridTemplateColumns }}
                              type="button"
                              onClick={(event) => selectEntryPath(row.original.path, event)}
                              onContextMenu={(event) => {
                                if (!selectedEntryPaths.includes(row.original.path)) {
                                  selectEntryPath(row.original.path, event);
                                }
                              }}
                              onDoubleClick={() => openEntry(row.original)}
                            >
                              {row.getVisibleCells().map((cell) => (
                                <span className="min-w-0 px-1" key={cell.id}>
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </span>
                              ))}
                              <span aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </OverlayScrollArea>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuLabel>
                      {selectedEntries.length > 0
                        ? `${selectedEntries.length} selected`
                        : 'SFTP Explorer'}
                    </ContextMenuLabel>
                    <ContextMenuItem onSelect={() => void loadDirectory()} disabled={isLoading}>
                      Refresh
                      <ContextMenuShortcut>F5</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void createFolder()} disabled={isLoading}>
                      New Folder
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => void copySelectedPath()}>
                      Copy Path
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void renameEntry()} disabled={isLoading || !canRename}>
                      Rename
                      <ContextMenuShortcut>F2</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => void deleteEntry()}
                      disabled={isLoading || !canDelete}
                    >
                      Delete
                      <ContextMenuShortcut>Del</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuCheckboxItem
                      checked={showHiddenEntries}
                      onCheckedChange={(checked) => setShowHiddenEntries(Boolean(checked))}
                    >
                      Show Hidden Files
                    </ContextMenuCheckboxItem>
                    <ContextMenuCheckboxItem
                      checked={showPermissions}
                      onCheckedChange={(checked) => setShowPermissions(Boolean(checked))}
                    >
                      Show Permissions
                    </ContextMenuCheckboxItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SftpEntryIcon({ entry }: { entry: SftpEntry }) {
  if (entry.isDirectory) {
    return <Folder className="size-4 shrink-0 text-primary" />;
  }

  if (entry.kind === 'symlink') {
    return <FileSymlink className="size-4 shrink-0 text-slate-400" />;
  }

  return <File className="size-4 shrink-0 text-slate-400" />;
}

function getSftpPathSegments(path: string) {
  if (path === '.' || path === '') {
    return [{ label: 'Home', path: '.' }];
  }

  if (path === '/') {
    return [{ label: '/', path: '/' }];
  }

  const parts = path.split('/').filter(Boolean);
  const segments = path.startsWith('/')
    ? [{ label: '/', path: '/' }]
    : [{ label: 'Home', path: '.' }];

  parts.forEach((part, index) => {
    const nextPath = path.startsWith('/')
      ? `/${parts.slice(0, index + 1).join('/')}`
      : parts.slice(0, index + 1).join('/');

    segments.push({ label: part, path: nextPath });
  });

  return segments;
}

function getSftpParentPath(path: string) {
  if (path === '.' || path === '/' || path === '') {
    return undefined;
  }

  const normalizedPath = path.replace(/\/+$/, '');
  const parts = normalizedPath.split('/').filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length === 1) {
    return normalizedPath.startsWith('/') ? '/' : '.';
  }

  return normalizedPath.startsWith('/')
    ? `/${parts.slice(0, -1).join('/')}`
    : parts.slice(0, -1).join('/');
}

function normalizeSftpPathInput(inputPath: string, currentPath: string, homePath: string) {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath) {
    return currentPath;
  }

  if (trimmedPath === '~') {
    return homePath;
  }

  if (trimmedPath.startsWith('~/')) {
    return joinSftpPath(homePath, trimmedPath.slice(2));
  }

  if (trimmedPath.startsWith('/')) {
    return normalizeAbsoluteSftpPath(trimmedPath);
  }

  return joinSftpPath(currentPath, trimmedPath);
}

function joinSftpPath(basePath: string, childPath: string) {
  if (!childPath || childPath === '.') {
    return basePath;
  }

  if (childPath.startsWith('/')) {
    return normalizeAbsoluteSftpPath(childPath);
  }

  const isAbsolute = basePath.startsWith('/');
  const parts = [
    ...basePath.split('/').filter(Boolean),
    ...childPath.split('/').filter(Boolean),
  ];
  const normalizedParts: string[] = [];

  parts.forEach((part) => {
    if (part === '.') {
      return;
    }

    if (part === '..') {
      normalizedParts.pop();
      return;
    }

    normalizedParts.push(part);
  });

  if (isAbsolute) {
    return `/${normalizedParts.join('/')}` || '/';
  }

  return normalizedParts.join('/') || '.';
}

function normalizeAbsoluteSftpPath(path: string) {
  const normalizedParts: string[] = [];

  path.split('/').filter(Boolean).forEach((part) => {
    if (part === '.') {
      return;
    }

    if (part === '..') {
      normalizedParts.pop();
      return;
    }

    normalizedParts.push(part);
  });

  return `/${normalizedParts.join('/')}` || '/';
}

function formatBytes(size: number | undefined) {
  if (size === undefined) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatModifiedAt(modifiedAt: number | undefined) {
  if (!modifiedAt) {
    return '';
  }

  const date = new Date(modifiedAt * 1000);
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}. ${month}. ${day}. ${hour}:${minute}:${second}`;
}
