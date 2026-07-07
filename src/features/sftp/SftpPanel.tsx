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
  Download,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { Button } from '@/components/ui/button';
import { appChoose, appConfirm, appPrompt } from '@/components/ui/app-dialog';
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
  cancelSftpTransfer,
  closeSftpSession,
  closeSftpUploadStream,
  createSftpDirectory,
  downloadSftpFile,
  listenSftpTransferEvents,
  listSftpDirectory,
  openSftpUploadStream,
  openSftpSession,
  removeSftpDirectory,
  removeSftpFile,
  revealLocalPath,
  renameSftpPath,
  uploadSftpFile,
  writeSftpUploadStreamChunk,
  type SftpEntry,
  type SftpTransferEvent,
} from './sftpBridge';

type SftpConnectionState = 'closed' | 'connected' | 'connecting' | 'failed' | 'restored';
type SftpTransferRetryPayload =
  | { kind: 'path-upload'; localPath: string; remotePath: string }
  | { file: File; kind: 'drop-upload'; relativePath: string; remotePath: string }
  | { kind: 'download'; localPath: string; remotePath: string; totalBytes: number };
type SftpTransferItem = SftpTransferEvent & {
  retryPayload?: SftpTransferRetryPayload;
  startedAt?: number;
};
type SftpUploadConflictAction = 'cancel' | 'overwrite' | 'overwrite-all' | 'skip' | 'skip-all';
type SftpMarqueeBox = { height: number; left: number; top: number; width: number };
interface SftpDroppedUploadFile {
  file: File;
  relativePath: string;
}
interface SftpDroppedUploadPlan {
  directories: string[];
  files: SftpDroppedUploadFile[];
}
interface SftpFileSystemEntry {
  isDirectory: boolean;
  isFile: boolean;
  name: string;
}
interface SftpFileSystemFileEntry extends SftpFileSystemEntry {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}
interface SftpFileSystemDirectoryEntry extends SftpFileSystemEntry {
  createReader: () => {
    readEntries: (
      successCallback: (entries: SftpFileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  };
}
type SftpDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => SftpFileSystemEntry | null;
};

const sftpMarqueeThreshold = 4;
const sftpParentEntryPath = '__sftp_parent__';
const sftpTransferConcurrency = 2;
const sftpUploadStreamChunkSize = 4 * 1024 * 1024;

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
  const pathInputRef = useRef<HTMLInputElement>(null);
  const isActivePanelRef = useRef(false);
  const hasOpenedSessionRef = useRef(false);
  const currentPathRef = useRef('.');
  const transferWaitersRef = useRef(new Map<string, () => void>());
  const marqueeStartRef = useRef<{
    basePaths: string[];
    additive: boolean;
    clientX: number;
    clientY: number;
    container: HTMLElement;
    started: boolean;
  }>();
  const suppressNextEntryClickRef = useRef(false);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [connectionState, setConnectionState] = useState<SftpConnectionState>(
    autoConnect ? 'connecting' : 'restored',
  );
  const [error, setError] = useState<string>();
  const [dragUploadTargetPath, setDragUploadTargetPath] = useState<string>();
  const [isLoading, setIsLoading] = useState(autoConnect);
  const [isUploadDragOver, setIsUploadDragOver] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [marqueeBox, setMarqueeBox] = useState<SftpMarqueeBox>();
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
  const [transfers, setTransfers] = useState<SftpTransferItem[]>([]);
  const visibleEntries = useMemo(
    () => entries.filter((entry) => showHiddenEntries || !entry.filename.startsWith('.')),
    [entries, showHiddenEntries],
  );
  const residualUploadEntries = useMemo(
    () => entries.filter(isSftpResidualUploadEntry),
    [entries],
  );
  const selectedEntry = visibleEntries.find((entry) => entry.path === selectedEntryPath);
  const selectedEntries = visibleEntries.filter((entry) => selectedEntryPaths.includes(entry.path));
  const hasSingleSelection = selectedEntries.length === 1;
  const canRename = hasSingleSelection;
  const canDelete = selectedEntries.length > 0;
  const downloadableEntries = selectedEntries;
  const canDownload = downloadableEntries.length > 0;
  const isRemoteReady = connectionState === 'connected';
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
        minSize: isCompact ? 120 : 136,
        size: isCompact ? 144 : 168,
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
        minSize: isNarrow ? 78 : isCompact ? 88 : 112,
        size: isNarrow ? 86 : isCompact ? 104 : 144,
      },
    ],
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
  const gridTemplateColumns = visibleColumns
    .map((column) => {
      if (column.id === 'name') {
        return `minmax(${column.columnDef.minSize ?? 180}px, 1fr)`;
      }

      return `${column.getSize()}px`;
    })
    .join(' ');
  const tableGridTemplateColumns = `${gridTemplateColumns} ${isCompact ? 8 : 18}px`;
  const pathSegments = useMemo(() => getSftpPathSegments(path), [path]);
  const parentPath = getSftpParentPath(path);
  const tableRows = table.getRowModel().rows;
  const navigablePaths = [
    ...(parentPath ? [sftpParentEntryPath] : []),
    ...tableRows.map((row) => row.original.path),
  ];
  const sessionConnectionKey = useMemo(
    () =>
      [
        session.id,
        session.host ?? '',
        session.port ?? 22,
        session.username ?? '',
        session.authMethod ?? '',
        session.credentialRef?.id ?? '',
        session.credentialRef?.kind ?? '',
        typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : '',
      ].join('|'),
    [
      session.authMethod,
      session.credentialRef?.id,
      session.credentialRef?.kind,
      session.host,
      session.id,
      session.metadata?.privateKeyPath,
      session.port,
      session.username,
    ],
  );

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
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isActivePanelRef.current || !isRemoteReady || isPathEditing || isLoading) {
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
        return;
      }

      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      event.preventDefault();
      selectAllEntries();
    };

    document.addEventListener('keydown', handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [isLoading, isPathEditing, isRemoteReady, selectedEntryPath, tableRows]);

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
    currentPathRef.current = path;
  }, [path]);

  useEffect(() => {
    if (!selectedEntryPath) {
      return;
    }

    const selectedRow = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-sftp-entry-path]') ?? [],
    ).find((element) => element.dataset.sftpEntryPath === selectedEntryPath);

    if (selectedRow) {
      scrollSftpRowIntoView(selectedRow);
    }
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

      if (isSftpSessionClosedError(message)) {
        try {
          setConnectionState('connecting');
          publishConnectionStatus({ panelId, status: 'connecting' });

          if (hasOpenedSessionRef.current) {
            await closeSftpSession(panelId);
            hasOpenedSessionRef.current = false;
          }

          await openSftpSession(panelId, session);
          hasOpenedSessionRef.current = true;
          setConnectionState('connected');
          publishConnectionStatus({ panelId, status: 'connected' });

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
        } catch (reconnectError) {
          const reconnectMessage =
            reconnectError instanceof Error ? reconnectError.message : String(reconnectError);

          setConnectionState('failed');
          publishConnectionStatus({ panelId, status: 'failed' });
          setError(`SFTP session closed. Reconnect failed: ${reconnectMessage}`);
          options.onError?.(reconnectMessage);
          return false;
        }
      }

      setError(message);
      options.onError?.(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };
  const connectSftp = async () => {
    setConnectionState('connecting');
    setIsLoading(true);
    setError(undefined);
    publishConnectionStatus({ panelId, status: 'connecting' });

    try {
      if (hasOpenedSessionRef.current) {
        await closeSftpSession(panelId);
        hasOpenedSessionRef.current = false;
      }

      await openSftpSession(panelId, session);
      hasOpenedSessionRef.current = true;
      setConnectionState('connected');
      publishConnectionStatus({ panelId, status: 'connected' });
      await loadDirectory('.', { recordHistory: false });
    } catch (error) {
      setConnectionState('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      setError(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;

    const open = async () => {
      if (!autoConnect) {
        setConnectionState('restored');
        setIsLoading(false);
        setError(undefined);
        publishConnectionStatus({ panelId, status: 'restored' });
        return;
      }

      setIsLoading(true);
      setError(undefined);
      setConnectionState('connecting');
      publishConnectionStatus({ panelId, status: 'connecting' });

      try {
        if (hasOpenedSessionRef.current) {
          await closeSftpSession(panelId);
          hasOpenedSessionRef.current = false;
        }

        await openSftpSession(panelId, session);
        hasOpenedSessionRef.current = true;
        setConnectionState('connected');
        publishConnectionStatus({ panelId, status: 'connected' });
        if (!disposed) {
          await loadDirectory('.', { recordHistory: false });
        }
      } catch (error) {
        setConnectionState('failed');
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
      if (hasOpenedSessionRef.current) {
        hasOpenedSessionRef.current = false;
        void closeSftpSession(panelId);
      }
    };
  }, [autoConnect, panelId, sessionConnectionKey]);

  useEffect(() => {
    setSelectedEntryPaths((paths) =>
      paths.filter((selectedPath) => visibleEntries.some((entry) => entry.path === selectedPath)),
    );

    if (selectedEntryPath && selectedEntryPath !== sftpParentEntryPath && !visibleEntries.some((entry) => entry.path === selectedEntryPath)) {
      setSelectedEntryPath(undefined);
      setSelectionAnchorPath(undefined);
    }
  }, [selectedEntryPath, visibleEntries]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenSftpTransferEvents((event) => {
      if (disposed || event.panelId !== panelId) {
        return;
      }

      setTransfers((items) => {
        const nextEvent = mergeTransferEvent(items.find((item) => item.transferId === event.transferId), event);
        const nextItems = items.some((item) => item.transferId === event.transferId)
          ? items.map((item) => (item.transferId === event.transferId ? nextEvent : item))
          : [nextEvent, ...items];

        return nextItems.slice(0, 8);
      });

      if (isSftpTerminalTransferStatus(event.status)) {
        transferWaitersRef.current.get(event.transferId)?.();
        transferWaitersRef.current.delete(event.transferId);
      }

      if (event.status === 'completed' && event.direction === 'upload') {
        void loadDirectory(currentPathRef.current, { recordHistory: false });
      }
    }).then((dispose) => {
      unlisten = dispose;
      if (disposed) {
        dispose();
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [panelId]);

  function resolveUploadDropTargetAt(clientX: number, clientY: number) {
    const panelElement = panelRef.current;

    if (!panelElement) {
      return undefined;
    }

    const panelRect = panelElement.getBoundingClientRect();

    if (
      clientX < panelRect.left ||
      clientX > panelRect.right ||
      clientY < panelRect.top ||
      clientY > panelRect.bottom
    ) {
      return undefined;
    }

    const entryElement = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-sftp-entry-path]');

    if (entryElement && panelElement.contains(entryElement)) {
      const entryPath = entryElement.dataset.sftpEntryPath;

      if (entryPath === sftpParentEntryPath && parentPath) {
        return { path: parentPath };
      }

      const entry = entries.find((item) => item.path === entryPath);

      if (entry?.isDirectory) {
        return { path: entry.path };
      }
    }

    return { path };
  }

  const handleUploadDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isRemoteReady || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = resolveUploadDropTargetAt(event.clientX, event.clientY);

    if (!target) {
      setIsUploadDragOver(false);
      setDragUploadTargetPath(undefined);
      return;
    }

    event.dataTransfer.dropEffect = 'copy';
    setIsUploadDragOver(true);
    setDragUploadTargetPath(target.path);
  };
  const handleUploadDragLeave = (event: DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setIsUploadDragOver(false);
    setDragUploadTargetPath(undefined);
  };
  const handleUploadDrop = (event: DragEvent<HTMLElement>) => {
    if (!isRemoteReady || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = resolveUploadDropTargetAt(event.clientX, event.clientY);

    setIsUploadDragOver(false);
    setDragUploadTargetPath(undefined);

    if (!target) {
      return;
    }

    void startUploadFromDataTransfer(event.dataTransfer, target.path);
  };

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
  const cleanResidualUploadFiles = async () => {
    if (residualUploadEntries.length === 0) {
      return;
    }

    const confirmed = await appConfirm({
      confirmLabel: 'Clean',
      message: `Delete ${residualUploadEntries.length} leftover upload file${residualUploadEntries.length === 1 ? '' : 's'} in ${path}?`,
      title: 'Clean Upload Leftovers',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await runAction(async () => {
      for (const entry of residualUploadEntries) {
        await removeSftpFile(panelId, entry.path);
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
  const startUpload = async () => {
    if (!isRemoteReady) {
      return;
    }

    const selectedPaths = await openDialog({
      directory: false,
      multiple: true,
      title: 'Select files to upload',
    });

    const localPaths = Array.isArray(selectedPaths)
      ? selectedPaths.filter((selectedPath): selectedPath is string => typeof selectedPath === 'string')
      : typeof selectedPaths === 'string'
        ? [selectedPaths]
        : [];

    await startUploadFromPaths(localPaths, path);
  };
  const startUploadFolder = async () => {
    if (!isRemoteReady) {
      return;
    }

    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select folder to upload',
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await startUploadFromPaths([selectedPath], path);
  };
  const startUploadFromPaths = async (localPaths: string[], targetDirectory: string) => {
    if (!isRemoteReady || localPaths.length === 0) {
      return;
    }

    let targetEntries: SftpEntry[];

    try {
      targetEntries = targetDirectory === path
        ? entries
        : (await listSftpDirectory(panelId, targetDirectory)).entries;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }

    const existingNames = new Set(targetEntries.map((entry) => entry.filename));
    let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;

    const uploadTasks: Array<() => Promise<void>> = [];

    for (const localPath of localPaths) {
      const filename = getLocalFileName(localPath);
      const remotePath = joinSftpPath(targetDirectory, filename);

      if (existingNames.has(filename)) {
        const action = conflictActionForRemaining ?? await appChoose<SftpUploadConflictAction>({
            choices: [
              { label: 'Overwrite', tone: 'danger', value: 'overwrite' },
              { label: 'Overwrite All', tone: 'danger', value: 'overwrite-all' },
              { label: 'Skip', value: 'skip' },
              { label: 'Skip All', value: 'skip-all' },
              { label: 'Cancel', value: 'cancel' },
            ],
            message: `${filename} already exists in ${targetDirectory}.\nChoose how to continue.`,
            title: 'Remote File Exists',
          });

        if (action === 'cancel' || action === undefined) {
          return;
        }

        if (action === 'overwrite-all') {
          conflictActionForRemaining = 'overwrite';
        }

        if (action === 'skip-all') {
          conflictActionForRemaining = 'skip';
        }

        if (action === 'skip' || action === 'skip-all' || conflictActionForRemaining === 'skip') {
          continue;
        }
      }

      existingNames.add(filename);
      uploadTasks.push(() => startPathUploadTransfer(localPath, remotePath));
    }

    await runLimitedSftpTasks(uploadTasks, sftpTransferConcurrency);
  };
  const startPathUploadTransfer = async (localPath: string, remotePath: string) => {
      const transferId = createTransferId();

      addPendingTransfer({
        direction: 'upload',
        localPath,
        message: undefined,
        panelId,
        remotePath,
        retryPayload: { kind: 'path-upload', localPath, remotePath },
        status: 'started',
        totalBytes: 0,
        transferredBytes: 0,
        transferId,
      });

      try {
        const completion = waitForTransferCompletion(transferId);
        await uploadSftpFile(panelId, localPath, remotePath, transferId);
        await completion;
      } catch (error) {
        transferWaitersRef.current.delete(transferId);
        markTransferFailed(transferId, error instanceof Error ? error.message : String(error));
      }
  };
  const startUploadFromDataTransfer = async (dataTransfer: DataTransfer, targetDirectory: string) => {
    let uploadPlan: SftpDroppedUploadPlan;

    try {
      uploadPlan = await getDroppedUploadPlan(dataTransfer);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (!isRemoteReady || (uploadPlan.files.length === 0 && uploadPlan.directories.length === 0)) {
      setError('Dropped files did not include readable files.');
      return;
    }

    let targetEntries: SftpEntry[];

    try {
      targetEntries = targetDirectory === path
        ? entries
        : (await listSftpDirectory(panelId, targetDirectory)).entries;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }

    const existingNames = new Set(targetEntries.map((entry) => entry.filename));
    const skippedTopLevelNames = new Set<string>();
    let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;
    const topLevelNames = Array.from(new Set([
      ...uploadPlan.directories.map(getSftpTopLevelPathName),
      ...uploadPlan.files.map((file) => getSftpTopLevelPathName(file.relativePath)),
    ]));

    for (const topLevelName of topLevelNames) {
      if (existingNames.has(topLevelName)) {
        const action = conflictActionForRemaining ?? await appChoose<SftpUploadConflictAction>({
            choices: [
              { label: 'Overwrite', tone: 'danger', value: 'overwrite' },
              { label: 'Overwrite All', tone: 'danger', value: 'overwrite-all' },
              { label: 'Skip', value: 'skip' },
              { label: 'Skip All', value: 'skip-all' },
              { label: 'Cancel', value: 'cancel' },
            ],
            message: `${topLevelName} already exists in ${targetDirectory}.\nChoose how to continue.`,
            title: 'Remote File Exists',
          });

        if (action === 'cancel' || action === undefined) {
          return;
        }

        if (action === 'overwrite-all') {
          conflictActionForRemaining = 'overwrite';
        }

        if (action === 'skip-all') {
          conflictActionForRemaining = 'skip';
        }

        if (action === 'skip' || action === 'skip-all' || conflictActionForRemaining === 'skip') {
          skippedTopLevelNames.add(topLevelName);
          continue;
        }
      }
    }

    const directories = uploadPlan.directories
      .filter((directoryPath) => !skippedTopLevelNames.has(getSftpTopLevelPathName(directoryPath)))
      .sort((left, right) => left.split('/').length - right.split('/').length);
    const ensuredRemoteDirectories = new Set([
      targetDirectory,
      ...getSftpAncestorPaths(targetDirectory),
    ]);

    for (const directoryPath of directories) {
      const remoteDirectoryPath = joinSftpPath(targetDirectory, directoryPath);

      if (ensuredRemoteDirectories.has(remoteDirectoryPath)) {
        continue;
      }

      try {
        await createSftpDirectory(panelId, remoteDirectoryPath);
      } catch {
        // Directory may already exist. Uploading files will surface real path problems.
      }

      ensuredRemoteDirectories.add(remoteDirectoryPath);
    }

    const uploadTasks: Array<() => Promise<void>> = [];

    for (const uploadFile of uploadPlan.files) {
      const topLevelName = getSftpTopLevelPathName(uploadFile.relativePath);

      if (skippedTopLevelNames.has(topLevelName)) {
        continue;
      }

      const remotePath = joinSftpPath(targetDirectory, uploadFile.relativePath);
      await ensureRemoteDirectoriesForFile(remotePath, ensuredRemoteDirectories);
      uploadTasks.push(() => startDroppedFileUpload(uploadFile.file, uploadFile.relativePath, remotePath));
      existingNames.add(topLevelName);
    }

    await runLimitedSftpTasks(uploadTasks, sftpTransferConcurrency);
  };
  const ensureRemoteDirectoriesForFile = async (
    remoteFilePath: string,
    ensuredRemoteDirectories: Set<string>,
  ) => {
    for (const directoryPath of getSftpAncestorPaths(remoteFilePath)) {
      if (ensuredRemoteDirectories.has(directoryPath)) {
        continue;
      }

      try {
        await createSftpDirectory(panelId, directoryPath);
      } catch {
        // Directory may already exist. Uploading the file will surface real path problems.
      }

      ensuredRemoteDirectories.add(directoryPath);
    }
  };
  const startDroppedFileUpload = async (file: File, filename: string, remotePath: string) => {
    const transferId = createTransferId();

      addPendingTransfer({
        direction: 'upload',
        localPath: filename,
        message: undefined,
        panelId,
        remotePath,
        retryPayload: { file, kind: 'drop-upload', relativePath: filename, remotePath },
        status: 'started',
        totalBytes: file.size,
        transferredBytes: 0,
        transferId,
    });

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
  const startDownload = async () => {
    if (!isRemoteReady || downloadableEntries.length === 0) {
      return;
    }

    if (downloadableEntries.length === 1 && !downloadableEntries[0].isDirectory) {
      const entry = downloadableEntries[0];
      const localPath = await saveDialog({
        defaultPath: entry.filename,
        title: `Download ${entry.filename}`,
      });

      if (typeof localPath === 'string') {
        await startDownloadTransfer(entry, localPath);
      }

      return;
    }

    const targetDirectory = await openDialog({
      directory: true,
      multiple: false,
      title: downloadableEntries.length === 1
        ? `Select folder for ${downloadableEntries[0].filename}`
        : 'Select download folder',
    });

    if (typeof targetDirectory !== 'string') {
      return;
    }

    await runLimitedSftpTasks(
      downloadableEntries.map((entry) => () =>
        startDownloadTransfer(entry, joinLocalPath(targetDirectory, entry.filename))
      ),
      sftpTransferConcurrency,
    );
  };
  const startDownloadTransfer = async (entry: SftpEntry, localPath: string) => {
    const transferId = createTransferId();

      addPendingTransfer({
        direction: 'download',
        localPath,
        message: undefined,
        panelId,
        remotePath: entry.path,
        retryPayload: {
          kind: 'download',
          localPath,
          remotePath: entry.path,
          totalBytes: entry.size ?? 0,
        },
        status: 'started',
        totalBytes: entry.size ?? 0,
        transferredBytes: 0,
        transferId,
    });

    try {
      const completion = waitForTransferCompletion(transferId);
      await downloadSftpFile(panelId, entry.path, localPath, transferId);
      await completion;
    } catch (error) {
      transferWaitersRef.current.delete(transferId);
      markTransferFailed(transferId, error instanceof Error ? error.message : String(error));
    }
  };
  const addPendingTransfer = (transfer: SftpTransferItem, replaceTransferId?: string) => {
    const pendingTransfer = {
      ...transfer,
      startedAt: Date.now(),
    };

    setTransfers((items) =>
      [
        pendingTransfer,
        ...items.filter((item) =>
          item.transferId !== transfer.transferId && item.transferId !== replaceTransferId
        ),
      ].slice(0, 8),
    );
  };
  const waitForTransferCompletion = (transferId: string) =>
    new Promise<void>((resolve) => {
      transferWaitersRef.current.set(transferId, resolve);
    });
  const markTransferFailed = (transferId: string, message: string) => {
    setTransfers((items) =>
      items.map((item) =>
        item.transferId === transferId
          ? { ...item, message, status: 'failed' }
          : item,
      ),
    );
  };
  const retryTransfer = async (transfer: SftpTransferItem) => {
    if (!isRemoteReady || !transfer.retryPayload) {
      return;
    }

    const retryPayload = transfer.retryPayload;

    if (retryPayload.kind === 'drop-upload') {
      setTransfers((items) => items.filter((item) => item.transferId !== transfer.transferId));
      await startDroppedFileUpload(retryPayload.file, retryPayload.relativePath, retryPayload.remotePath);
      return;
    }

    const transferId = createTransferId();
    const retryTransferItem: SftpTransferItem = {
      direction: retryPayload.kind === 'download' ? 'download' : 'upload',
      localPath: retryPayload.localPath,
      message: undefined,
      panelId,
      remotePath: retryPayload.remotePath,
      retryPayload,
      status: 'started',
      totalBytes: retryPayload.kind === 'download' ? retryPayload.totalBytes : 0,
      transferredBytes: 0,
      transferId,
    };

    addPendingTransfer(retryTransferItem, transfer.transferId);

    try {
      const completion = waitForTransferCompletion(transferId);
      if (retryPayload.kind === 'download') {
        await downloadSftpFile(panelId, retryPayload.remotePath, retryPayload.localPath, transferId);
      } else {
        await uploadSftpFile(panelId, retryPayload.localPath, retryPayload.remotePath, transferId);
      }
      await completion;
    } catch (error) {
      transferWaitersRef.current.delete(transferId);
      markTransferFailed(transferId, error instanceof Error ? error.message : String(error));
    }
  };
  const revealDownloadedTransfer = async (transfer: SftpTransferItem) => {
    try {
      await revealLocalPath(transfer.localPath);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const beginMarqueeSelection = (event: MouseEvent<HTMLElement>) => {
    if (!isRemoteReady || isLoading || event.button !== 0) {
      return;
    }

    const container = event.currentTarget;

    marqueeStartRef.current = {
      additive: event.ctrlKey || event.metaKey,
      basePaths: event.ctrlKey || event.metaKey ? selectedEntryPaths : [],
      clientX: event.clientX,
      clientY: event.clientY,
      container,
      started: false,
    };
  };
  const updateMarqueeSelection = (event: MouseEvent<HTMLElement>) => {
    const drag = marqueeStartRef.current;

    if (!drag) {
      return;
    }

    const deltaX = Math.abs(event.clientX - drag.clientX);
    const deltaY = Math.abs(event.clientY - drag.clientY);

    if (!drag.started && deltaX < sftpMarqueeThreshold && deltaY < sftpMarqueeThreshold) {
      return;
    }

    drag.started = true;
    suppressNextEntryClickRef.current = true;

    const containerRect = drag.container.getBoundingClientRect();
    const left = Math.min(drag.clientX, event.clientX);
    const top = Math.min(drag.clientY, event.clientY);
    const right = Math.max(drag.clientX, event.clientX);
    const bottom = Math.max(drag.clientY, event.clientY);
    const hitPaths = getSftpEntryPathsInRect(drag.container, { bottom, left, right, top });
    const nextPaths = drag.additive
      ? Array.from(new Set([...drag.basePaths, ...hitPaths]))
      : hitPaths;
    const focusedPath = hitPaths[hitPaths.length - 1] ?? nextPaths[nextPaths.length - 1];

    event.preventDefault();
    setMarqueeBox({
      height: bottom - top,
      left: left - containerRect.left,
      top: top - containerRect.top,
      width: right - left,
    });
    setSelectedEntryPaths(nextPaths);
    setSelectedEntryPath(focusedPath);
    setSelectionAnchorPath(nextPaths[0]);
  };
  const endMarqueeSelection = () => {
    const didDrag = marqueeStartRef.current?.started;

    marqueeStartRef.current = undefined;
    setMarqueeBox(undefined);

    if (didDrag) {
      window.setTimeout(() => {
        suppressNextEntryClickRef.current = false;
      }, 0);
    }
  };
  const selectEntryPath = (entryPath: string, event?: MouseEvent<HTMLElement>) => {
    if (suppressNextEntryClickRef.current) {
      suppressNextEntryClickRef.current = false;
      return;
    }

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
    window.getSelection()?.removeAllRanges();

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
    if (!isRemoteReady) {
      return;
    }

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
          disabled={!isRemoteReady || isLoading || backStack.length === 0}
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
          disabled={!isRemoteReady || isLoading || forwardStack.length === 0}
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
          disabled={!isRemoteReady || isLoading}
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
            disabled={!isRemoteReady || isLoading}
          >
            <Folder className="size-3.5" />
            {!isNarrow && <span>New</span>}
          </Button>
        )}
        {
          <div className="relative">
            <Button
              aria-label="More SFTP actions"
              title="More actions"
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => setIsActionMenuOpen((value) => !value)}
              disabled={!isRemoteReady}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
            {isActionMenuOpen && (
              <div className="absolute right-0 top-9 z-50 grid w-44 gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                {isTiny && (
                  <button
                    className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={!isRemoteReady || isLoading}
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
                  disabled={!isRemoteReady || isLoading}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void startUpload();
                  }}
                >
                  <Upload className="size-3.5" />
                  Upload Files
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!isRemoteReady || isLoading}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void startUploadFolder();
                  }}
                >
                  <FolderOpen className="size-3.5" />
                  Upload Folder
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!isRemoteReady || isLoading || !canDownload}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void startDownload();
                  }}
                >
                  <Download className="size-3.5" />
                  Download
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!isRemoteReady || isLoading}
                  onClick={() => void copyPath()}
                >
                  <Copy className="size-3.5" />
                  Copy Path
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!isRemoteReady || isLoading || !canRename}
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
                  disabled={!isRemoteReady || isLoading || !canDelete}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void deleteEntry();
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </button>
                <button
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!isRemoteReady || isLoading || residualUploadEntries.length === 0}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    void cleanResidualUploadFiles();
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Clean Leftovers
                  {residualUploadEntries.length > 0 && (
                    <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      {residualUploadEntries.length}
                    </span>
                  )}
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
        }
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
          disabled={!isRemoteReady || isLoading}
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

      {connectionState === 'restored' ? (
        <SftpRestoredCard onReconnect={() => void connectSftp()} />
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
              {residualUploadEntries.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                  <span className="min-w-0 truncate">
                    {residualUploadEntries.length} leftover upload file{residualUploadEntries.length === 1 ? '' : 's'} in this folder.
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    disabled={!isRemoteReady || isLoading}
                    onClick={() => void cleanResidualUploadFiles()}
                  >
                    <Trash2 className="size-3.5" />
                    Clean
                  </Button>
                </div>
              )}
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
                    <div
                      className="relative h-full min-h-0 select-none"
                      onDragLeave={handleUploadDragLeave}
                      onDragOver={handleUploadDragOver}
                      onDrop={handleUploadDrop}
                      onMouseDown={beginMarqueeSelection}
                      onMouseLeave={endMarqueeSelection}
                      onMouseMove={updateMarqueeSelection}
                      onMouseUp={endMarqueeSelection}
                    >
                      <OverlayScrollArea data-sftp-scroll-viewport>
                        <div className="grid min-w-full gap-0.5 py-1 pl-2 pr-1">
                          {parentPath && (
                            <button
                              className={[
                                'mr-2 grid min-h-8 items-center gap-x-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800/75 hover:text-white',
                                selectedEntryPath === sftpParentEntryPath ? 'bg-slate-800 text-white ring-1 ring-inset ring-primary/60' : '',
                                isUploadDragOver && dragUploadTargetPath === parentPath ? 'bg-primary/15 ring-1 ring-inset ring-primary/70' : '',
                              ].join(' ')}
                              data-sftp-entry-path={sftpParentEntryPath}
                              style={{ gridTemplateColumns: tableGridTemplateColumns }}
                              type="button"
                              title="Parent directory"
                              onMouseDown={(event) => event.preventDefault()}
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
                                'mr-2 grid min-h-8 items-center gap-x-2 rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800/75 hover:text-white',
                                selectedEntryPaths.includes(row.original.path) ? 'bg-slate-800 text-white ring-1 ring-inset ring-primary/60' : '',
                                selectedEntryPath === row.original.path && !selectedEntryPaths.includes(row.original.path) ? 'ring-1 ring-inset ring-primary/40' : '',
                                isUploadDragOver && row.original.isDirectory && dragUploadTargetPath === row.original.path ? 'bg-primary/15 ring-1 ring-inset ring-primary/70' : '',
                              ].join(' ')}
                              data-sftp-entry-path={row.original.path}
                              key={row.original.path}
                              style={{ gridTemplateColumns: tableGridTemplateColumns }}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
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
                      {isUploadDragOver && (
                        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-md border border-dashed border-primary/70 bg-primary/5 text-xs font-medium text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.18)]">
                          Upload to {dragUploadTargetPath ?? path}
                        </div>
                      )}
                      {marqueeBox && (
                        <div
                          className="pointer-events-none absolute rounded border border-primary/80 bg-primary/15"
                          style={{
                            height: marqueeBox.height,
                            left: marqueeBox.left,
                            top: marqueeBox.top,
                            width: marqueeBox.width,
                          }}
                        />
                      )}
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
                    <ContextMenuItem onSelect={() => void startUpload()} disabled={!isRemoteReady || isLoading}>
                      <Upload className="size-3.5" />
                      Upload Files
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void startUploadFolder()} disabled={!isRemoteReady || isLoading}>
                      <FolderOpen className="size-3.5" />
                      Upload Folder
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void startDownload()} disabled={!isRemoteReady || isLoading || !canDownload}>
                      <Download className="size-3.5" />
                      Download
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => void copySelectedPath()}>
                      Copy Path
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void renameEntry()} disabled={!isRemoteReady || isLoading || !canRename}>
                      Rename
                      <ContextMenuShortcut>F2</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => void deleteEntry()}
                      disabled={!isRemoteReady || isLoading || !canDelete}
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
          {transfers.length > 0 && (
            <SftpTransferQueue
              transfers={transfers}
              onCancel={(transferId) => void cancelSftpTransfer(transferId)}
              onClearFinished={() =>
                setTransfers((items) =>
                  items.filter((item) => item.status === 'progress' || item.status === 'started'),
                )
              }
              onRetry={(transfer) => void retryTransfer(transfer)}
              onReveal={(transfer) => void revealDownloadedTransfer(transfer)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SftpTransferQueue({
  onCancel,
  onClearFinished,
  onReveal,
  onRetry,
  transfers,
}: {
  onCancel: (transferId: string) => void;
  onClearFinished: () => void;
  onReveal: (transfer: SftpTransferItem) => void;
  onRetry: (transfer: SftpTransferItem) => void;
  transfers: SftpTransferItem[];
}) {
  const runningCount = transfers.filter((item) => item.status === 'progress' || item.status === 'started').length;
  const failedCount = transfers.filter((item) => item.status === 'failed').length;
  const completedCount = transfers.filter((item) => item.status === 'completed').length;
  const canceledCount = transfers.filter((item) => item.status === 'canceled').length;

  return (
    <div className="shrink-0 border-t border-border/60 bg-slate-950/60 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs font-semibold text-slate-200">
          Transfer Queue
          <span className="ml-2 font-mono text-[11px] font-normal text-slate-500" title="Transfer summary">
            {runningCount} running
            {failedCount > 0 && ` / ${failedCount} failed`}
            {canceledCount > 0 && ` / ${canceledCount} canceled`}
            {completedCount > 0 && ` / ${completedCount} done`}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={onClearFinished}
          disabled={completedCount + failedCount + canceledCount === 0}
        >
          Clear Finished
        </Button>
      </div>
      <div className="h-36 min-h-0">
        <OverlayScrollArea>
          <div className="grid gap-1 pr-2">
            {transfers.map((transfer) => {
              const progress = getTransferProgress(transfer);
              const isRunning = transfer.status === 'progress' || transfer.status === 'started';
              const canRetry = Boolean(
                transfer.retryPayload &&
                (transfer.status === 'failed' || transfer.status === 'canceled'),
              );
              const canReveal = transfer.direction === 'download' && transfer.status === 'completed';
              const displayName = getTransferFileName(transfer);
              const detailText = getTransferDetailText(transfer);
              const statusStyle = getTransferStatusStyle(transfer);

              return (
                <div
                  className={[
                    'grid gap-1 rounded border border-border/70 bg-background/70 px-2 py-1.5 text-xs',
                    transfer.status === 'completed' ? 'opacity-70' : '',
                    transfer.status === 'failed' ? 'border-destructive/35 bg-destructive/5' : '',
                  ].join(' ')}
                  key={transfer.transferId}
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    {transfer.direction === 'upload' ? (
                      <Upload className="size-3.5 text-primary" />
                    ) : (
                      <Download className="size-3.5 text-primary" />
                    )}
                    <div className="grid min-w-0 gap-0.5">
                      <div className="min-w-0 truncate font-medium text-slate-200" title={getTransferDisplayName(transfer)}>
                        {displayName}
                      </div>
                      <div className="min-w-0 truncate font-mono text-[10px] text-slate-500" title={detailText}>
                        {detailText}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
                          statusStyle,
                        ].join(' ')}
                      >
                        {formatTransferStatus(transfer)}
                      </span>
                      {isRunning && (
                        <button
                          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-destructive/10 hover:text-destructive"
                          type="button"
                          title="Cancel transfer"
                          aria-label="Cancel transfer"
                          onClick={() => onCancel(transfer.transferId)}
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                      {canRetry && (
                        <button
                          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-primary/10 hover:text-primary"
                          type="button"
                          title="Retry transfer"
                          aria-label="Retry transfer"
                          onClick={() => onRetry(transfer)}
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                      {canReveal && (
                        <button
                          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-primary/10 hover:text-primary"
                          type="button"
                          title="Reveal in Explorer"
                          aria-label="Reveal in Explorer"
                          onClick={() => onReveal(transfer)}
                        >
                          <FolderOpen className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-slate-800">
                    <div
                      className={[
                        'h-full rounded transition-[width]',
                        transfer.status === 'failed'
                          ? 'bg-destructive'
                          : transfer.status === 'canceled'
                            ? 'bg-slate-600'
                            : 'bg-primary',
                      ].join(' ')}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {transfer.message && (
                    <div className="truncate text-[11px] text-destructive" title={transfer.message}>
                      {transfer.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

function SftpRestoredCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
      <span className="font-medium text-slate-100">SFTP session restored</span>
      <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
        Remote file listing was not restored. Reconnect to open a new SFTP session.
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" type="button" onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
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

function scrollSftpRowIntoView(row: HTMLElement) {
  const viewport = row.closest<HTMLElement>('[data-sftp-scroll-viewport]');

  if (!viewport) {
    row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }

  const scrollLeft = viewport.scrollLeft;
  const rowRect = row.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();

  if (rowRect.top < viewportRect.top) {
    viewport.scrollTop -= viewportRect.top - rowRect.top;
  } else if (rowRect.bottom > viewportRect.bottom) {
    viewport.scrollTop += rowRect.bottom - viewportRect.bottom;
  }

  viewport.scrollLeft = scrollLeft;
}

function isSftpSessionClosedError(message: string) {
  return message.toLowerCase().includes('session closed');
}

function isSftpTransferCanceledError(message: string) {
  const normalized = message.toLowerCase();

  return normalized.includes('transfer canceled') || normalized.includes('stream upload is not running');
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function hasDroppedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes('Files');
}

function isSftpResidualUploadEntry(entry: SftpEntry) {
  return !entry.isDirectory && (
    entry.filename.includes('.tmp-shellpilot-') ||
    entry.filename.includes('.bak-shellpilot-')
  );
}

async function getDroppedUploadPlan(dataTransfer: DataTransfer): Promise<SftpDroppedUploadPlan> {
  const entries = Array.from(dataTransfer.items)
    .map((item) =>
      ((item as unknown as SftpDataTransferItem).webkitGetAsEntry?.() ?? null) as SftpFileSystemEntry | null,
    )
    .filter((entry): entry is SftpFileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return {
      directories: [],
      files: Array.from(dataTransfer.files)
        .filter((file) => file.name && file.size >= 0)
        .map((file) => ({
        file,
        relativePath: normalizeSftpRelativePath(file.name),
        })),
    };
  }

  const plan: SftpDroppedUploadPlan = { directories: [], files: [] };

  for (const entry of entries) {
    mergeDroppedUploadPlan(plan, await readDroppedEntryPlan(entry, ''));
  }

  return {
    directories: Array.from(new Set(plan.directories)),
    files: plan.files,
  };
}

async function readDroppedEntryPlan(
  entry: SftpFileSystemEntry,
  parentPath: string,
): Promise<SftpDroppedUploadPlan> {
  const relativePath = normalizeSftpRelativePath(joinSftpPath(parentPath, entry.name));

  if (entry.isFile) {
    const file = await readDroppedFileEntry(entry as SftpFileSystemFileEntry);

    return { directories: [], files: [{ file, relativePath }] };
  }

  if (!entry.isDirectory) {
    return { directories: [], files: [] };
  }

  const children = await readDroppedDirectoryEntries(entry as SftpFileSystemDirectoryEntry);
  const plan: SftpDroppedUploadPlan = { directories: [relativePath], files: [] };

  for (const child of children) {
    mergeDroppedUploadPlan(plan, await readDroppedEntryPlan(child, relativePath));
  }

  return plan;
}

function mergeDroppedUploadPlan(target: SftpDroppedUploadPlan, source: SftpDroppedUploadPlan) {
  target.directories.push(...source.directories);
  target.files.push(...source.files);
}

function readDroppedFileEntry(entry: SftpFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDroppedDirectoryEntries(
  entry: SftpFileSystemDirectoryEntry,
): Promise<SftpFileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: SftpFileSystemEntry[] = [];

  while (true) {
    const batch = await new Promise<SftpFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (batch.length === 0) {
      break;
    }

    entries.push(...batch);
  }

  return entries;
}

function normalizeDroppedFilename(filename: string) {
  return filename.split(/[\\/]/).filter(Boolean).pop() ?? 'upload';
}

function normalizeSftpRelativePath(path: string) {
  return path
    .split(/[\\/]/)
    .filter(Boolean)
    .join('/');
}

function getSftpTopLevelPathName(path: string) {
  return normalizeSftpRelativePath(path).split('/')[0] || normalizeDroppedFilename(path);
}

function getSftpAncestorPaths(remoteFilePath: string) {
  const normalizedPath = remoteFilePath.replace(/\/+$/, '');
  const isAbsolute = normalizedPath.startsWith('/');
  const parts = normalizedPath.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return [];
  }

  return parts.slice(0, -1).map((_, index) => {
    const nextPath = parts.slice(0, index + 1).join('/');

    return isAbsolute ? `/${nextPath}` : nextPath;
  });
}

function getSftpEntryPathsInRect(
  container: HTMLElement,
  rect: { bottom: number; left: number; right: number; top: number },
) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-sftp-entry-path]'))
    .filter((element) => {
      const entryPath = element.dataset.sftpEntryPath;

      if (!entryPath || entryPath === sftpParentEntryPath) {
        return false;
      }

      const elementRect = element.getBoundingClientRect();

      return (
        elementRect.left < rect.right &&
        elementRect.right > rect.left &&
        elementRect.top < rect.bottom &&
        elementRect.bottom > rect.top
      );
    })
    .map((element) => element.dataset.sftpEntryPath)
    .filter((entryPath): entryPath is string => Boolean(entryPath));
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

function createTransferId() {
  return `sftp-transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeTransferEvent(
  previous: SftpTransferItem | undefined,
  next: SftpTransferEvent,
): SftpTransferItem {
  if (!previous) {
    return { ...next, startedAt: Date.now() };
  }

  return {
    ...previous,
    ...next,
    retryPayload: previous.retryPayload,
    startedAt: previous.startedAt,
    totalBytes: next.totalBytes || previous.totalBytes,
    transferredBytes: next.transferredBytes || previous.transferredBytes,
  };
}

function isSftpTerminalTransferStatus(status: SftpTransferEvent['status']) {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

async function runLimitedSftpTasks(tasks: Array<() => Promise<void>>, limit: number) {
  let nextIndex = 0;
  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex];
      nextIndex += 1;
      await task();
    }
  });

  await Promise.all(workers);
}

function getLocalFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'upload';
}

function joinLocalPath(directory: string, filename: string) {
  if (directory.endsWith('/') || directory.endsWith('\\')) {
    return `${directory}${filename}`;
  }

  return `${directory}\\${filename}`;
}

function getTransferDisplayName(transfer: SftpTransferItem) {
  return transfer.direction === 'upload'
    ? `${getLocalFileName(transfer.localPath)} -> ${transfer.remotePath}`
    : `${transfer.remotePath} -> ${transfer.localPath}`;
}

function getTransferFileName(transfer: SftpTransferItem) {
  return transfer.direction === 'upload'
    ? getLocalFileName(transfer.localPath)
    : getLocalFileName(transfer.remotePath);
}

function getTransferDetailText(transfer: SftpTransferItem) {
  const pathText = transfer.direction === 'upload'
    ? `to ${transfer.remotePath}`
    : `to ${transfer.localPath}`;
  const metricText = getTransferMetricText(transfer);

  return metricText ? `${pathText} / ${metricText}` : pathText;
}

function getTransferProgress(transfer: SftpTransferItem) {
  if (transfer.status === 'completed') {
    return 100;
  }

  if (!transfer.totalBytes) {
    return transfer.status === 'started' ? 4 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100)));
}

function formatTransferStatus(transfer: SftpTransferItem) {
  if (transfer.status === 'completed') {
    return 'done';
  }

  if (transfer.status === 'failed') {
    return 'failed';
  }

  if (transfer.status === 'canceled') {
    return 'canceled';
  }

  if (!transfer.totalBytes) {
    return transfer.status === 'started' ? 'starting' : formatBytes(transfer.transferredBytes);
  }

  return `${getTransferProgress(transfer)}%`;
}

function getTransferStatusStyle(transfer: SftpTransferItem) {
  if (transfer.status === 'failed') {
    return 'border-destructive/35 bg-destructive/10 text-destructive';
  }

  if (transfer.status === 'canceled') {
    return 'border-slate-700 bg-slate-900 text-slate-400';
  }

  if (transfer.status === 'completed') {
    return 'border-primary/25 bg-primary/10 text-primary';
  }

  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function getTransferMetricText(transfer: SftpTransferItem) {
  if (!transfer.startedAt || transfer.transferredBytes <= 0) {
    return '';
  }

  const elapsedSeconds = Math.max(1, (Date.now() - transfer.startedAt) / 1000);
  const bytesPerSecond = transfer.transferredBytes / elapsedSeconds;

  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '';
  }

  const speedText = `${formatBytes(bytesPerSecond)}/s`;

  if (
    transfer.status !== 'started' &&
    transfer.status !== 'progress' ||
    !transfer.totalBytes ||
    transfer.transferredBytes >= transfer.totalBytes
  ) {
    return speedText;
  }

  const remainingSeconds = Math.max(0, (transfer.totalBytes - transfer.transferredBytes) / bytesPerSecond);

  return `${speedText} / ${formatDuration(remainingSeconds)} left`;
}

function formatDuration(seconds: number) {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const restSeconds = roundedSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;

    return `${hours}h ${restMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }

  return `${restSeconds}s`;
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
