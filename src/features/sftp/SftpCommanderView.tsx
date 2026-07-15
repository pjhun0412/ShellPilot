import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type ReactNode,
} from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

import { Button } from '@/components/ui/button';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
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
import type { LocalFileEntry, LocalRootEntry, SftpEntry } from './sftpBridge';
import { getSftpFileIcon } from './SftpPanelChrome';
import { getSftpPathSegments } from './sftpPathUtils';
import { formatBytes, formatModifiedAt } from './sftpPanelUtils';

export type CommanderPaneVariant = 'local' | 'remote';
type CommanderEntry = LocalFileEntry | SftpEntry;
type CommanderSortKey = 'modifiedAt' | 'name' | 'size';
type CommanderSortState = {
  desc: boolean;
  key: CommanderSortKey;
};
type CommanderPathSegment = {
  label: string;
  path: string;
};

const COMMANDER_GRID_TEMPLATE = 'minmax(180px,1fr) 144px 104px 8px';
const COMMANDER_DRAG_MIME = 'application/x-shellpilot-sftp-commander';
const COMMANDER_HEADER_CLASS_NAME =
  'grid shrink-0 items-center gap-x-2 border-b border-border/70 bg-slate-950/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200';
const COMMANDER_BODY_CLASS_NAME = 'grid min-w-full gap-1 py-1.5 pl-2 pr-1';
const COMMANDER_ROW_CLASS_NAME =
  'mr-2 grid min-h-9 items-center gap-x-2 rounded-md border border-transparent px-3 py-2 text-left text-xs text-slate-200 outline-none transition-colors odd:bg-slate-950/20 hover:border-slate-700/70 hover:bg-slate-800/70 hover:text-white focus:outline-none';
const COMMANDER_MAX_SPLIT_PERCENT = 75;
const COMMANDER_MIN_SPLIT_PERCENT = 25;
const COMMANDER_DEFAULT_SORT: CommanderSortState = { desc: false, key: 'name' };
const COMMANDER_MARQUEE_THRESHOLD = 4;
const COMMANDER_ACTION_FULL_WIDTH = 292;
const COMMANDER_ACTION_COMPACT_WIDTH = 224;
const COMMANDER_ACTION_TIGHT_WIDTH = 164;

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
  activePane,
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
  activePane: CommanderPaneVariant;
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
  onRemoteMoveDragOver: (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => boolean;
  onRemoteMoveDragStart: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop: (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => boolean;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [actionMenuVariant, setActionMenuVariant] = useState<CommanderPaneVariant>();
  const [dragSourceVariant, setDragSourceVariant] = useState<CommanderPaneVariant>();
  const [localSort, setLocalSort] = useState<CommanderSortState>(COMMANDER_DEFAULT_SORT);
  const [remoteSort, setRemoteSort] = useState<CommanderSortState>(COMMANDER_DEFAULT_SORT);
  const [splitPercent, setSplitPercent] = useState(50);

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

  const updateSplitPercent = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    const nextPercent = ((clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.min(COMMANDER_MAX_SPLIT_PERCENT, Math.max(COMMANDER_MIN_SPLIT_PERCENT, nextPercent)));
  }, []);

  const handleSplitterMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    updateSplitPercent(event.clientX);

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      updateSplitPercent(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [updateSplitPercent]);

  return (
    <div
      className="grid min-h-0 flex-1 gap-1 p-2"
      ref={containerRef}
      style={{
        gridTemplateColumns: `minmax(0, ${splitPercent}fr) 2px minmax(0, ${100 - splitPercent}fr)`,
        gridTemplateRows: 'auto minmax(0, 1fr)',
      }}
    >
      <div className="flex min-w-0 justify-end overflow-hidden">
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
          onSetMenuOpen={(isOpen) => setActionMenuVariant(isOpen ? 'local' : undefined)}
          onTransfer={() => onUploadLocalPathsToRemote(localSelectedPaths)}
        />
      </div>

      <span className="h-7 w-px justify-self-center bg-border/70" aria-hidden="true" />

      <div className="flex min-w-0 justify-end overflow-hidden">
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
          onSetMenuOpen={(isOpen) => setActionMenuVariant(isOpen ? 'remote' : undefined)}
          onSetShowHiddenEntries={onSetShowHiddenEntries}
          onSetShowPermissions={onSetShowPermissions}
          onUploadFiles={onUploadFiles}
          onUploadFolder={onUploadFolder}
        />
      </div>

      <CommanderPane
        entries={localEntries}
        error={localError}
        isLoading={localIsLoading}
        label="Local"
        isActive={activePane === 'local'}
        canDelete={localSelectedPaths.length > 0}
        parentPath={localParentPath}
        path={localPath}
        localRoots={localRoots}
        selectedPaths={localSelectedPaths}
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
        isActive={activePane === 'remote'}
        parentPath={remoteParentPath}
        path={remotePath}
        selectedPaths={remoteSelectedPaths}
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

function CommanderPaneActionGroup({
  backStackLength,
  canDelete = false,
  canDownload = false,
  canRename = false,
  canTransfer = false,
  forwardStackLength,
  isLoading,
  isMenuOpen,
  isRemoteReady = true,
  label,
  showHiddenEntries = false,
  showPermissions = false,
  variant,
  onBack,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onForward,
  onRefresh,
  onRename,
  onSetMenuOpen,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onTransfer,
  onUploadFiles,
  onUploadFolder,
}: {
  backStackLength: number;
  canDelete?: boolean;
  canDownload?: boolean;
  canRename?: boolean;
  canTransfer?: boolean;
  forwardStackLength: number;
  isLoading: boolean;
  isMenuOpen: boolean;
  isRemoteReady?: boolean;
  label: string;
  showHiddenEntries?: boolean;
  showPermissions?: boolean;
  variant: CommanderPaneVariant;
  onBack: () => void;
  onCopyPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onSetMenuOpen: (isOpen: boolean) => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onTransfer?: () => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
}) {
  const actionGroupRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionGroupWidth = useElementWidth(actionGroupRef);
  const isActionDisabled = isLoading || (variant === 'remote' && !isRemoteReady);
  const isFull = actionGroupWidth >= COMMANDER_ACTION_FULL_WIDTH;
  const isCompact = actionGroupWidth >= COMMANDER_ACTION_COMPACT_WIDTH;
  const isTight = actionGroupWidth >= COMMANDER_ACTION_TIGHT_WIDTH;
  const showInlineHistory = isCompact;
  const showInlineNewFolder = isTight;

  const runMenuAction = (action?: () => void) => {
    onSetMenuOpen(false);
    action?.();
  };

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        onSetMenuOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onSetMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isMenuOpen, onSetMenuOpen]);

  return (
    <div ref={actionGroupRef} className="flex w-full min-w-0 max-w-full items-center justify-end gap-1 pb-1">
      {isFull && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      {showInlineHistory && (
        <>
          <Button
            aria-label={`${label} back`}
            title={`${label} back`}
            size="sm"
            variant="secondary"
            type="button"
            onClick={onBack}
            disabled={isActionDisabled || backStackLength === 0}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            aria-label={`${label} forward`}
            title={`${label} forward`}
            size="sm"
            variant="secondary"
            type="button"
            onClick={onForward}
            disabled={isActionDisabled || forwardStackLength === 0}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </>
      )}
      <Button
        aria-label={`Refresh ${label.toLowerCase()}`}
        title={`Refresh ${label.toLowerCase()}`}
        size="sm"
        variant="secondary"
        type="button"
        onClick={onRefresh}
        disabled={isActionDisabled}
      >
        <RefreshCcw className="size-3.5" />
      </Button>
      {showInlineNewFolder && (
        <Button
          aria-label={`New ${label.toLowerCase()} folder`}
          title={`New ${label.toLowerCase()} folder`}
          size="sm"
          variant="secondary"
          type="button"
          onClick={onCreateFolder}
          disabled={isActionDisabled}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      )}
      <div className="relative" ref={actionMenuRef}>
        <Button
          aria-label={`${label} more actions`}
          title={`${label} more actions`}
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => onSetMenuOpen(!isMenuOpen)}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
        {isMenuOpen && (
          <div className="absolute right-0 top-9 z-50 grid w-48 gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {label} Actions
            </div>
            {!showInlineHistory && (
              <>
                <CommanderPaneMenuButton disabled={isActionDisabled || backStackLength === 0} onClick={() => runMenuAction(onBack)}>
                  <ChevronLeft className="size-3.5" />
                  Back
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton disabled={isActionDisabled || forwardStackLength === 0} onClick={() => runMenuAction(onForward)}>
                  <ChevronRight className="size-3.5" />
                  Forward
                </CommanderPaneMenuButton>
              </>
            )}
            {!showInlineNewFolder && (
              <CommanderPaneMenuButton disabled={isActionDisabled} onClick={() => runMenuAction(onCreateFolder)}>
                <FolderPlus className="size-3.5" />
                New Folder
              </CommanderPaneMenuButton>
            )}
            {(!showInlineHistory || !showInlineNewFolder) && <div className="my-1 h-px bg-border" />}
            {variant === 'local' ? (
              <>
                <CommanderPaneMenuButton disabled={isLoading || !canTransfer} onClick={() => runMenuAction(onTransfer)}>
                  <Upload className="size-3.5" />
                  Upload Selected
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton disabled={isLoading} onClick={() => runMenuAction(onCopyPath)}>
                  <Copy className="size-3.5" />
                  Copy Path
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton
                  className="text-destructive hover:bg-destructive/10"
                  disabled={isLoading || !canDelete}
                  onClick={() => runMenuAction(onDelete)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </CommanderPaneMenuButton>
              </>
            ) : (
              <>
                <CommanderPaneMenuButton disabled={isActionDisabled} onClick={() => runMenuAction(onUploadFiles)}>
                  <Upload className="size-3.5" />
                  Upload Files
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton disabled={isActionDisabled} onClick={() => runMenuAction(onUploadFolder)}>
                  <FolderOpen className="size-3.5" />
                  Upload Folder
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton disabled={isActionDisabled || !canDownload} onClick={() => runMenuAction(onDownload)}>
                  <Download className="size-3.5" />
                  Download
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton disabled={isActionDisabled} onClick={() => runMenuAction(onCopyPath)}>
                  <Copy className="size-3.5" />
                  Copy Path
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton disabled={isActionDisabled || !canRename} onClick={() => runMenuAction(onRename)}>
                  <Pencil className="size-3.5" />
                  Rename
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton
                  className="text-destructive hover:bg-destructive/10"
                  disabled={isActionDisabled || !canDelete}
                  onClick={() => runMenuAction(onDelete)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </CommanderPaneMenuButton>
                <div className="my-1 h-px bg-border" />
                <CommanderPaneMenuButton
                  onClick={() => {
                    onSetMenuOpen(false);
                    onSetShowHiddenEntries?.(!showHiddenEntries);
                  }}
                >
                  <span className="w-3.5 text-center">{showHiddenEntries ? '\u2713' : ''}</span>
                  Show Hidden
                </CommanderPaneMenuButton>
                <CommanderPaneMenuButton
                  onClick={() => {
                    onSetMenuOpen(false);
                    onSetShowPermissions?.(!showPermissions);
                  }}
                >
                  <span className="w-3.5 text-center">{showPermissions ? '\u2713' : ''}</span>
                  Show Permissions
                </CommanderPaneMenuButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommanderPaneMenuButton({
  children,
  className = '',
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={[
        'flex min-h-8 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45',
        className,
      ].join(' ')}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function useElementWidth<TElement extends HTMLElement>(ref: RefObject<TElement>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return undefined;
    }

    const updateWidth = () => {
      setWidth(element.getBoundingClientRect().width);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);

      return () => {
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}

function CommanderPane({
  entries,
  error,
  isLoading,
  isActive,
  label,
  parentPath,
  path,
  localRoots = [],
  selectedPaths,
  canDelete = false,
  canDownload = false,
  canRename = false,
  dragSourceVariant,
  isRemoteReady = true,
  showHiddenEntries = false,
  showPermissions = false,
  onActivate,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onNavigate,
  onBrowseDirectory,
  onRefresh,
  onRename,
  onRemoteMoveDragEnd,
  onRemoteMoveDragOver,
  onRemoteMoveDragStart,
  onRemoteMoveDrop,
  onSelect,
  onSelectMany,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onDragSourceChange,
  onDropPaths,
  onSortChange,
  onUploadFiles,
  onUploadFolder,
  onUploadSelectedLocal,
  remoteMoveTargetPath,
  sort,
  variant,
}: {
  entries: CommanderEntry[];
  error?: string;
  isLoading: boolean;
  isActive: boolean;
  isRemoteReady?: boolean;
  label: string;
  parentPath?: string;
  path: string;
  localRoots?: LocalRootEntry[];
  selectedPaths: string[];
  canDelete?: boolean;
  canDownload?: boolean;
  canRename?: boolean;
  dragSourceVariant?: CommanderPaneVariant;
  showHiddenEntries?: boolean;
  showPermissions?: boolean;
  onActivate: (variant: CommanderPaneVariant) => void;
  onCopyPath?: () => void;
  onCreateFolder?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onNavigate: (path: string) => void;
  onBrowseDirectory?: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onRemoteMoveDragEnd?: () => void;
  onRemoteMoveDragOver?: (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => boolean;
  onRemoteMoveDragStart?: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop?: (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => boolean;
  onSelect: (path: string, additive: boolean) => void;
  onSelectMany: (paths: string[]) => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onDragSourceChange: (variant: CommanderPaneVariant | undefined) => void;
  onDropPaths: (paths: string[]) => void;
  onSortChange: (sort: CommanderSortState) => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
  onUploadSelectedLocal?: () => void;
  remoteMoveTargetPath?: string;
  sort: CommanderSortState;
  variant: CommanderPaneVariant;
}) {
  const paneRef = useRef<HTMLElement>(null);
  const marqueeStartRef = useRef<{
    additive: boolean;
    basePaths: string[];
    clientX: number;
    clientY: number;
    container: HTMLElement;
    started: boolean;
  }>();
  const displayPath = variant === 'local' ? formatLocalDisplayPath(path) : path;
  const gridTemplateColumns = getGridTemplateColumns(variant);
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [marqueeBox, setMarqueeBox] = useState<{ height: number; left: number; top: number; width: number }>();
  const [pathDraft, setPathDraft] = useState(displayPath);
  const [focusedEntryPath, setFocusedEntryPath] = useState<string>();
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>();
  const pathSegments = useMemo(
    () => variant === 'local' ? getLocalPathSegments(displayPath) : getSftpPathSegments(path),
    [displayPath, path, variant],
  );
  const sortedEntries = useMemo(() => sortCommanderEntries(entries, sort), [entries, sort]);
  const firstPathSegment = pathSegments[0];
  const breadcrumbSegments = variant === 'local' && localRoots.length > 0
    ? pathSegments.slice(1)
    : pathSegments;
  const selectedLocalRootPath = firstPathSegment
    ? localRoots.find((root) => isSameLocalRoot(root.path, firstPathSegment.path))?.path
    : undefined;
  const sortedEntryPaths = useMemo(() => sortedEntries.map((entry) => entry.path), [sortedEntries]);
  const parentMoveTarget: SftpEntry | undefined = variant === 'remote' && parentPath
    ? {
        filename: '..',
        isDirectory: true,
        kind: 'directory',
        path: parentPath,
      }
    : undefined;
  const activatePane = useCallback(() => {
    onActivate(variant);
    paneRef.current?.focus({ preventScroll: true });
  }, [onActivate, variant]);

  useEffect(() => {
    if (!isPathEditing) {
      setPathDraft(displayPath);
    }
  }, [displayPath, isPathEditing]);

  useEffect(() => {
    if (!focusedEntryPath) {
      return;
    }

    const focusedRow = Array.from(
      paneRef.current?.querySelectorAll<HTMLElement>('[data-commander-entry-path]') ?? [],
    ).find((element) => element.dataset.commanderEntryPath === focusedEntryPath);

    focusedRow?.scrollIntoView({ block: 'nearest' });
  }, [focusedEntryPath]);

  const handleSortClick = (key: CommanderSortKey) => {
    onSortChange(sort.key === key ? { key, desc: !sort.desc } : { key, desc: false });
  };

  const selectEntry = (entryPath: string, additive: boolean) => {
    activatePane();
    onSelect(entryPath, additive);
    setFocusedEntryPath(entryPath);
    setSelectionAnchorPath(entryPath);
  };

  const selectEntryRange = (entryPath: string) => {
    activatePane();

    if (!selectionAnchorPath) {
      onSelectMany([entryPath]);
      setFocusedEntryPath(entryPath);
      setSelectionAnchorPath(entryPath);
      return;
    }

    const anchorIndex = sortedEntryPaths.indexOf(selectionAnchorPath);
    const nextIndex = sortedEntryPaths.indexOf(entryPath);

    if (anchorIndex === -1 || nextIndex === -1) {
      onSelectMany([entryPath]);
      setFocusedEntryPath(entryPath);
      setSelectionAnchorPath(entryPath);
      return;
    }

    const [startIndex, endIndex] = anchorIndex < nextIndex
      ? [anchorIndex, nextIndex]
      : [nextIndex, anchorIndex];

    onSelectMany(sortedEntryPaths.slice(startIndex, endIndex + 1));
    setFocusedEntryPath(entryPath);
  };

  const moveSelection = (direction: -1 | 1, extendSelection = false) => {
    if (sortedEntryPaths.length === 0) {
      return;
    }

    const currentPath = selectedPaths.find((selectedPath) => sortedEntryPaths.includes(selectedPath));
    const currentIndex = currentPath ? sortedEntryPaths.indexOf(currentPath) : -1;
    const nextIndex = currentIndex === -1
      ? direction > 0 ? 0 : sortedEntryPaths.length - 1
      : Math.max(0, Math.min(sortedEntryPaths.length - 1, currentIndex + direction));
    const nextPath = sortedEntryPaths[nextIndex];

    if (extendSelection) {
      selectEntryRange(nextPath);
      return;
    }

    activatePane();
    onSelectMany([nextPath]);
    setFocusedEntryPath(nextPath);
    setSelectionAnchorPath(nextPath);
  };

  const handleCommanderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isPathEditing || isLoading) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      activatePane();
      onSelectMany(sortedEntryPaths);
      setFocusedEntryPath(sortedEntryPaths[0]);
      setSelectionAnchorPath(sortedEntryPaths[0]);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(1, event.shiftKey);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(-1, event.shiftKey);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      if (sortedEntryPaths[0]) {
        activatePane();
        onSelectMany([sortedEntryPaths[0]]);
        setFocusedEntryPath(sortedEntryPaths[0]);
        setSelectionAnchorPath(sortedEntryPaths[0]);
      }
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      const lastPath = sortedEntryPaths[sortedEntryPaths.length - 1];
      if (lastPath) {
        activatePane();
        onSelectMany([lastPath]);
        setFocusedEntryPath(lastPath);
        setSelectionAnchorPath(lastPath);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const selectedPath = selectedPaths.find((candidatePath) => sortedEntryPaths.includes(candidatePath));
      const selectedEntry = sortedEntries.find((entry) => entry.path === selectedPath);
      if (selectedEntry?.isDirectory) {
        onNavigate(selectedEntry.path);
      }
      return;
    }

    if (event.key === 'Backspace' && parentPath) {
      event.preventDefault();
      event.stopPropagation();
      onNavigate(parentPath);
      return;
    }

    if (event.key === 'F5') {
      event.preventDefault();
      event.stopPropagation();
      onRefresh();
      return;
    }

    if (variant === 'remote' && event.key === 'F2' && canRename) {
      event.preventDefault();
      event.stopPropagation();
      onRename?.();
      return;
    }

    if (event.key === 'Delete' && canDelete) {
      event.preventDefault();
      event.stopPropagation();
      onDelete?.();
    }
  };

  const beginMarqueeSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isLoading) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('[data-commander-entry-path]')) {
      return;
    }

    activatePane();
    marqueeStartRef.current = {
      additive: event.ctrlKey || event.metaKey,
      basePaths: event.ctrlKey || event.metaKey ? selectedPaths : [],
      clientX: event.clientX,
      clientY: event.clientY,
      container: event.currentTarget,
      started: false,
    };
  };

  const updateMarqueeSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    const drag = marqueeStartRef.current;

    if (!drag) {
      return;
    }

    const deltaX = Math.abs(event.clientX - drag.clientX);
    const deltaY = Math.abs(event.clientY - drag.clientY);

    if (!drag.started && deltaX < COMMANDER_MARQUEE_THRESHOLD && deltaY < COMMANDER_MARQUEE_THRESHOLD) {
      return;
    }

    drag.started = true;
    event.preventDefault();

    const containerRect = drag.container.getBoundingClientRect();
    const left = Math.min(drag.clientX, event.clientX);
    const top = Math.min(drag.clientY, event.clientY);
    const right = Math.max(drag.clientX, event.clientX);
    const bottom = Math.max(drag.clientY, event.clientY);
    const hitPaths = getCommanderEntryPathsInRect(drag.container, { bottom, left, right, top });
    const nextPaths = drag.additive
      ? Array.from(new Set([...drag.basePaths, ...hitPaths]))
      : hitPaths;
    const focusedPath = hitPaths[hitPaths.length - 1] ?? nextPaths[nextPaths.length - 1];

    onSelectMany(nextPaths);
    setFocusedEntryPath(focusedPath);
    setSelectionAnchorPath(nextPaths[0]);
    setMarqueeBox({
      height: bottom - top,
      left: left - containerRect.left,
      top: top - containerRect.top,
      width: right - left,
    });
  };

  const endMarqueeSelection = () => {
    const shouldClearSelection = marqueeStartRef.current && !marqueeStartRef.current.started && !marqueeStartRef.current.additive;

    marqueeStartRef.current = undefined;
    setMarqueeBox(undefined);

    if (shouldClearSelection) {
      onSelectMany([]);
      setFocusedEntryPath(undefined);
      setSelectionAnchorPath(undefined);
    }
  };

  const submitPathEdit = () => {
    const nextPath = pathDraft.trim();

    setIsPathEditing(false);

    if (nextPath && nextPath !== displayPath) {
      onNavigate(nextPath);
    }
  };

  const handlePathInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitPathEdit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setPathDraft(displayPath);
      setIsPathEditing(false);
    }
  };

  return (
    <section
      ref={paneRef}
      className={[
        'flex min-w-0 flex-col overflow-hidden rounded-md border bg-[hsl(var(--workspace-terminal))] outline-none transition-colors focus:outline-none',
        isActive ? 'border-primary/70 shadow-[inset_0_0_0_1px_hsl(var(--primary)_/_0.16)]' : 'border-border/70',
      ].join(' ')}
      onFocusCapture={() => onActivate(variant)}
      onDragOver={(event) => handlePaneDragOver(event, variant, dragSourceVariant)}
      onDrop={(event) => handlePaneDrop(event, variant, onDropPaths)}
      onKeyDown={handleCommanderKeyDown}
      tabIndex={-1}
    >
      <div
        className={[
          'flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b px-3 font-mono text-xs text-slate-300 transition-colors',
          isActive ? 'border-primary/40 bg-primary/5' : 'border-border/50',
        ].join(' ')}
        title="Double-click path to edit"
        onDoubleClick={() => {
          setPathDraft(displayPath);
          setIsPathEditing(true);
        }}
      >
        <span
          className={[
            'shrink-0 font-sans text-[11px] font-semibold uppercase tracking-wide',
            isActive ? 'text-primary' : 'text-slate-500',
          ].join(' ')}
        >
          {label}
        </span>
        {isPathEditing ? (
          <input
            className="h-7 min-w-0 flex-1 rounded border border-primary/60 bg-slate-950 px-2 text-xs text-slate-100 outline-none"
            autoFocus
            value={pathDraft}
            onBlur={() => {
              setPathDraft(displayPath);
              setIsPathEditing(false);
            }}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={handlePathInputKeyDown}
          />
        ) : (
          <div className="app-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
            {variant === 'local' && firstPathSegment && localRoots.length > 0 && (
              <select
                className="max-w-28 shrink-0 rounded border border-transparent bg-slate-950/40 px-1.5 py-0.5 font-mono text-xs text-slate-100 outline-none hover:border-border/70 hover:bg-slate-900/80 focus:border-primary/60"
                title="Change local drive"
                disabled={isLoading}
                value={selectedLocalRootPath ?? firstPathSegment.path}
                onChange={(event) => onNavigate(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {localRoots.map((root) => (
                  <option
                    className="bg-popover text-popover-foreground"
                    key={root.path}
                    value={root.path}
                  >
                    {root.label}
                  </option>
                ))}
                {!selectedLocalRootPath && (
                  <option
                    className="bg-popover text-popover-foreground"
                    value={firstPathSegment.path}
                  >
                    {firstPathSegment.label}
                  </option>
                )}
              </select>
            )}
            {breadcrumbSegments.length > 0 ? breadcrumbSegments.map((segment, index) => {
              const isLast = index === pathSegments.length - 1;
              const isCurrentPath = variant === 'local' && localRoots.length > 0
                ? index === breadcrumbSegments.length - 1
                : isLast;

              return (
                <span className="flex min-w-0 items-center gap-1" key={`${segment.path}-${index}`}>
                  {(index > 0 || (variant === 'local' && localRoots.length > 0)) && (
                    <span className="text-slate-600">/</span>
                  )}
                  <button
                    className={[
                      'max-w-44 truncate rounded px-1.5 py-0.5 text-left hover:bg-slate-900/70 hover:text-slate-100',
                      isCurrentPath ? 'cursor-default text-slate-100' : 'text-slate-400',
                    ].join(' ')}
                    type="button"
                    title={segment.path}
                    disabled={isCurrentPath || isLoading}
                    onClick={() => onNavigate(segment.path)}
                  >
                    {segment.label}
                  </button>
                </span>
              );
            }) : pathSegments.length === 0 ? (
              <button
                className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-slate-300 hover:bg-slate-900/70 hover:text-slate-100"
                title="Click to edit path"
                type="button"
                onClick={() => {
                  setPathDraft(displayPath);
                  setIsPathEditing(true);
                }}
              >
                Loading...
              </button>
            ) : (
              <span className="sr-only">Current local root</span>
            )}
          </div>
        )}
        <button
          className="ml-2 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          title="Edit path"
          aria-label={`Edit ${label} path`}
          disabled={isLoading}
          onClick={(event) => {
            event.stopPropagation();
            setPathDraft(displayPath);
            setIsPathEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
        </button>
        {onBrowseDirectory && (
          <button
            className="ml-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            title="Browse local directory"
            aria-label="Browse local directory"
            disabled={isLoading}
            onClick={(event) => {
              event.stopPropagation();
              onBrowseDirectory();
            }}
          >
            <FolderOpen className="size-3.5" />
          </button>
        )}
        <button
          className="ml-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
          type="button"
          title="Copy path"
          aria-label={`Copy ${label} path`}
          onClick={(event) => {
            event.stopPropagation();
            void navigator.clipboard.writeText(displayPath);
          }}
        >
          <Copy className="size-3.5" />
        </button>
      </div>

      <div
        className={COMMANDER_HEADER_CLASS_NAME}
        style={{ gridTemplateColumns }}
        onMouseDown={activatePane}
      >
        <CommanderHeaderCell
          isActive={sort.key === 'name'}
          onClick={() => handleSortClick('name')}
        >
          <>
            <span className="truncate">Name</span>
            {sort.key === 'name' && <CommanderSortIndicator desc={sort.desc} />}
          </>
        </CommanderHeaderCell>
        <CommanderHeaderCell
          isActive={sort.key === 'modifiedAt'}
          onClick={() => handleSortClick('modifiedAt')}
        >
          <>
            <span className="truncate">Modified</span>
            {sort.key === 'modifiedAt' && <CommanderSortIndicator desc={sort.desc} />}
          </>
        </CommanderHeaderCell>
        <CommanderHeaderCell
          align="right"
          isActive={sort.key === 'size'}
          onClick={() => handleSortClick('size')}
        >
          <>
            <span className="truncate">Size</span>
            {sort.key === 'size' && <CommanderSortIndicator desc={sort.desc} />}
          </>
        </CommanderHeaderCell>
        <span aria-hidden="true" />
      </div>

      {error ? (
        <div className="p-3 text-xs text-destructive">{error}</div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="relative min-h-0 flex-1 select-none"
              onMouseDown={beginMarqueeSelection}
              onMouseLeave={endMarqueeSelection}
              onMouseMove={updateMarqueeSelection}
              onMouseUp={endMarqueeSelection}
            >
              <OverlayScrollArea>
                <div className={COMMANDER_BODY_CLASS_NAME}>
                  {parentPath && (
                    <CommanderRow
                      entry={{
                        filename: '..',
                        isDirectory: true,
                        kind: 'directory',
                        path: parentPath,
                      }}
                      selected={false}
                      showSelection={isActive}
                      onActivate={activatePane}
                      onNavigate={onNavigate}
                      onSelect={selectEntry}
                      onSelectRange={selectEntryRange}
                      onRemoteMoveDragOver={onRemoteMoveDragOver}
                      onRemoteMoveDrop={onRemoteMoveDrop}
                      onDragStart={undefined}
                      remoteMoveTargetPath={remoteMoveTargetPath}
                      remoteMoveTargetEntry={parentMoveTarget}
                      variant={variant}
                    />
                  )}
                  {sortedEntries.map((entry) => (
                    <CommanderRow
                      entry={entry}
                      key={entry.path}
                      selected={selectedPaths.includes(entry.path)}
                      showSelection={isActive}
                      onActivate={activatePane}
                      onNavigate={onNavigate}
                      onSelect={selectEntry}
                      onSelectRange={selectEntryRange}
                      onRemoteMoveDragOver={onRemoteMoveDragOver}
                      onRemoteMoveDrop={onRemoteMoveDrop}
                      onDragStart={(event) => {
                        const paths = selectedPaths.includes(entry.path) ? selectedPaths : [entry.path];
                        handleRowDragStart(event, variant, paths);
                        if (variant === 'remote') {
                          onRemoteMoveDragStart?.(event, paths);
                        }
                        onDragSourceChange(variant);
                      }}
                      onDragEnd={() => {
                        onRemoteMoveDragEnd?.();
                        onDragSourceChange(undefined);
                      }}
                      remoteMoveTargetPath={remoteMoveTargetPath}
                      remoteMoveTargetEntry={entry.kind === 'directory' ? (entry as SftpEntry) : undefined}
                      variant={variant}
                    />
                  ))}
                  {isLoading && (
                    <div className="px-3 py-2 text-xs text-primary">Loading...</div>
                  )}
                  {!isLoading && entries.length === 0 && !parentPath && (
                    <div className="px-3 py-2 text-xs text-slate-500">No entries.</div>
                  )}
                </div>
              </OverlayScrollArea>
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
          <CommanderContextMenu
            canDelete={canDelete}
            canDownload={canDownload}
            canRename={canRename}
            isLoading={isLoading}
            isRemoteReady={isRemoteReady}
            path={displayPath}
            selectedCount={selectedPaths.length}
            selectedPaths={selectedPaths}
            showHiddenEntries={showHiddenEntries}
            showPermissions={showPermissions}
            variant={variant}
            onCopyPath={onCopyPath}
            onCreateFolder={onCreateFolder}
            onDelete={onDelete}
            onDownload={onDownload}
            onRefresh={onRefresh}
            onRename={onRename}
            onSetShowHiddenEntries={onSetShowHiddenEntries}
            onSetShowPermissions={onSetShowPermissions}
            onUploadFiles={onUploadFiles}
            onUploadFolder={onUploadFolder}
            onUploadSelectedLocal={onUploadSelectedLocal}
          />
        </ContextMenu>
      )}
    </section>
  );
}

function CommanderRow({
  entry,
  selected,
  showSelection,
  onActivate,
  onNavigate,
  onSelect,
  onSelectRange,
  onRemoteMoveDragOver,
  onRemoteMoveDrop,
  onDragStart,
  onDragEnd,
  remoteMoveTargetEntry,
  remoteMoveTargetPath,
  variant,
}: {
  entry: CommanderEntry;
  selected: boolean;
  showSelection: boolean;
  onActivate: () => void;
  onNavigate: (path: string) => void;
  onSelect: (path: string, additive: boolean) => void;
  onSelectRange: (path: string) => void;
  onDragEnd?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onRemoteMoveDragOver?: (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => boolean;
  onRemoteMoveDrop?: (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => boolean;
  remoteMoveTargetEntry?: SftpEntry;
  remoteMoveTargetPath?: string;
  variant: CommanderPaneVariant;
}) {
  const didDragRef = useRef(false);
  const pendingSelectedClickRef = useRef(false);
  const gridTemplateColumns = getGridTemplateColumns(variant);
  const fileIcon = entry.kind === 'symlink'
    ? { Icon: File, className: 'text-sky-300' }
    : getSftpFileIcon(entry.filename);

  const selectEntry = (additive: boolean, range: boolean) => {
    onActivate();
    if (range) {
      onSelectRange(entry.path);
      return;
    }
    onSelect(entry.path, additive);
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    didDragRef.current = false;

    if (selected && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      onActivate();
      pendingSelectedClickRef.current = true;
      return;
    }

    pendingSelectedClickRef.current = false;
    selectEntry(event.ctrlKey || event.metaKey, event.shiftKey);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (pendingSelectedClickRef.current) {
      pendingSelectedClickRef.current = false;

      if (!didDragRef.current) {
        selectEntry(false, false);
      }

      didDragRef.current = false;
      return;
    }

    if (event.detail !== 0) {
      return;
    }

    selectEntry(event.ctrlKey || event.metaKey, event.shiftKey);
  };

  return (
    <div
      data-commander-entry-path={entry.path}
      className={[
        COMMANDER_ROW_CLASS_NAME,
        selected && showSelection ? 'border-primary/60 bg-primary/15 text-white shadow-[inset_3px_0_0_hsl(var(--primary))]' : '',
        remoteMoveTargetPath === entry.path ? 'border-primary/70 bg-primary/20' : '',
      ].join(' ')}
      role="button"
      style={{ gridTemplateColumns }}
      tabIndex={-1}
      draggable={Boolean(onDragStart)}
      title={variant === 'local' ? formatLocalDisplayPath(entry.path) : entry.path}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={() => {
        onActivate();
        if (!selected) {
          onSelect(entry.path, false);
        }
      }}
      onDragEnd={() => {
        onDragEnd?.();
        pendingSelectedClickRef.current = false;
        didDragRef.current = false;
      }}
      onDragOver={(event) => onRemoteMoveDragOver?.(event, remoteMoveTargetEntry)}
      onDragStart={(event) => {
        didDragRef.current = true;
        onDragStart?.(event);
      }}
      onDrop={(event) => onRemoteMoveDrop?.(event, remoteMoveTargetEntry)}
      onDoubleClick={() => {
        if (entry.isDirectory) {
          onNavigate(entry.path);
        }
      }}
    >
      <span className="min-w-0 px-1">
        <span className="flex min-w-0 items-center gap-2">
          {entry.filename === '..' ? (
            <FolderOpen className="size-4 shrink-0 text-amber-300" />
          ) : entry.isDirectory ? (
            <Folder className="size-3.5 shrink-0 text-primary" />
          ) : (
            <fileIcon.Icon className={['size-3.5 shrink-0', fileIcon.className].join(' ')} />
          )}
          <span className="truncate font-semibold text-slate-100">{entry.filename}</span>
        </span>
      </span>

      <span className="min-w-0 whitespace-nowrap px-1 font-mono text-[11px] text-slate-300">
        {formatModifiedAt(entry.modifiedAt)}
      </span>

      <span className="min-w-0 whitespace-nowrap px-1 text-right font-mono text-[11px] text-slate-300">
        {formatEntrySize(entry)}
      </span>

      <span aria-hidden="true" />
    </div>
  );
}

function CommanderContextMenu({
  canDelete,
  canDownload,
  canRename,
  isLoading,
  isRemoteReady,
  path,
  selectedCount,
  selectedPaths,
  showHiddenEntries,
  showPermissions,
  variant,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onRefresh,
  onRename,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onUploadFiles,
  onUploadFolder,
  onUploadSelectedLocal,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  isLoading: boolean;
  isRemoteReady: boolean;
  path: string;
  selectedCount: number;
  selectedPaths: string[];
  showHiddenEntries: boolean;
  showPermissions: boolean;
  variant: CommanderPaneVariant;
  onCopyPath?: () => void;
  onCreateFolder?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
  onUploadSelectedLocal?: () => void;
}) {
  if (variant === 'local') {
    const copyLocalPath = async () => {
      const targetPath = selectedPaths.length === 1 ? selectedPaths[0] : path;
      await navigator.clipboard?.writeText(targetPath);
    };

    return (
      <ContextMenuContent>
        <ContextMenuLabel>
          {selectedCount > 0 ? `${selectedCount} selected` : 'Local'}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={onRefresh} disabled={isLoading}>
          Refresh
          <ContextMenuShortcut>F5</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreateFolder} disabled={isLoading}>
          <Folder className="size-3.5" />
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onUploadSelectedLocal} disabled={isLoading || selectedCount === 0}>
          <Upload className="size-3.5" />
          Upload to Remote
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyLocalPath()}>
          <Copy className="size-3.5" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onDelete}
          disabled={isLoading || selectedCount === 0}
        >
          <Trash2 className="size-3.5" />
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent>
      <ContextMenuLabel>
        {selectedCount > 0 ? `${selectedCount} selected` : 'Remote'}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={onRefresh} disabled={isLoading}>
        Refresh
        <ContextMenuShortcut>F5</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onCreateFolder} disabled={!isRemoteReady || isLoading}>
        <Folder className="size-3.5" />
        New Folder
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onUploadFiles} disabled={!isRemoteReady || isLoading}>
        <Upload className="size-3.5" />
        Upload Files
      </ContextMenuItem>
      <ContextMenuItem onSelect={onUploadFolder} disabled={!isRemoteReady || isLoading}>
        <FolderOpen className="size-3.5" />
        Upload Folder
      </ContextMenuItem>
      <ContextMenuItem onSelect={onDownload} disabled={!isRemoteReady || isLoading || !canDownload}>
        <Download className="size-3.5" />
        Download
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onCopyPath}>
        <Copy className="size-3.5" />
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onSelect={onRename} disabled={!isRemoteReady || isLoading || !canRename}>
        <Pencil className="size-3.5" />
        Rename
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={onDelete}
        disabled={!isRemoteReady || isLoading || !canDelete}
      >
        <Trash2 className="size-3.5" />
        Delete
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem
        checked={showHiddenEntries}
        onCheckedChange={(checked) => onSetShowHiddenEntries?.(Boolean(checked))}
      >
        Show Hidden Files
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem
        checked={showPermissions}
        onCheckedChange={(checked) => onSetShowPermissions?.(Boolean(checked))}
      >
        Show Permissions
      </ContextMenuCheckboxItem>
    </ContextMenuContent>
  );
}

function getGridTemplateColumns(variant: CommanderPaneVariant) {
  return COMMANDER_GRID_TEMPLATE;
}

function CommanderSortIndicator({ desc }: { desc: boolean }) {
  return <span className="font-mono text-[10px] text-primary">{desc ? '▼' : '▲'}</span>;
}

function CommanderHeaderCell({
  align = 'left',
  children,
  isActive = false,
  onClick,
}: {
  align?: 'left' | 'right';
  children: ReactNode;
  isActive?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="relative min-w-0 pr-2">
      <button
        className={[
          'flex h-6 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
          align === 'right' ? 'justify-end text-right' : 'justify-start',
          isActive ? 'text-primary' : '',
        ].join(' ')}
        type="button"
        onClick={onClick}
      >
        {children}
      </button>
      <span className="absolute right-0 top-0 h-full w-2 border-r border-border/50" aria-hidden="true" />
    </div>
  );
}

function sortCommanderEntries(entries: CommanderEntry[], sort: CommanderSortState) {
  return [...entries].sort((left, right) => {
    const direction = sort.desc ? -1 : 1;
    const typeCompare = Number(right.isDirectory) - Number(left.isDirectory);

    if (typeCompare !== 0) {
      return typeCompare;
    }

    const valueCompare = compareCommanderEntryValue(left, right, sort.key);

    if (valueCompare !== 0) {
      return valueCompare * direction;
    }

    return left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function compareCommanderEntryValue(left: CommanderEntry, right: CommanderEntry, key: CommanderSortKey) {
  if (key === 'name') {
    return left.filename.localeCompare(right.filename, undefined, { numeric: true, sensitivity: 'base' });
  }

  if (key === 'modifiedAt') {
    return (left.modifiedAt ?? 0) - (right.modifiedAt ?? 0);
  }

  return (left.size ?? 0) - (right.size ?? 0);
}

function getCommanderEntryPathsInRect(
  container: HTMLElement,
  rect: { bottom: number; left: number; right: number; top: number },
) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-commander-entry-path]'))
    .filter((element) => {
      const bounds = element.getBoundingClientRect();

      return bounds.left <= rect.right
        && bounds.right >= rect.left
        && bounds.top <= rect.bottom
        && bounds.bottom >= rect.top;
    })
    .map((element) => element.dataset.commanderEntryPath)
    .filter((path): path is string => Boolean(path));
}

function formatEntrySize(entry: CommanderEntry) {
  if (entry.filename === '..') {
    return '';
  }

  if (entry.size === null || entry.size === undefined) {
    return entry.isDirectory ? '-' : '';
  }

  return formatBytes(entry.size);
}

function handlePaneDragOver(
  event: DragEvent<HTMLElement>,
  targetVariant: CommanderPaneVariant,
  dragSourceVariant?: CommanderPaneVariant,
) {
  if (!dragSourceVariant || dragSourceVariant === targetVariant) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function handlePaneDrop(
  event: DragEvent<HTMLElement>,
  targetVariant: CommanderPaneVariant,
  onDropPaths: (paths: string[]) => void,
) {
  const payload = readCommanderDragPayload(event);

  if (!payload || payload.variant === targetVariant || payload.paths.length === 0) {
    return;
  }

  event.preventDefault();
  onDropPaths(payload.paths);
}

function handleRowDragStart(
  event: DragEvent<HTMLDivElement>,
  variant: CommanderPaneVariant,
  paths: string[],
) {
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData(COMMANDER_DRAG_MIME, JSON.stringify({ paths, variant }));
}

function readCommanderDragPayload(event: DragEvent<HTMLElement>) {
  const rawPayload = event.dataTransfer.getData(COMMANDER_DRAG_MIME);

  if (!rawPayload) {
    return undefined;
  }

  try {
    const payload = JSON.parse(rawPayload) as { paths?: unknown; variant?: unknown };

    if (
      (payload.variant === 'local' || payload.variant === 'remote') &&
      Array.isArray(payload.paths) &&
      payload.paths.every((path) => typeof path === 'string')
    ) {
      return {
        paths: payload.paths,
        variant: payload.variant,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function formatLocalDisplayPath(path: string) {
  return path
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/i, '');
}

function isSameLocalRoot(leftPath: string, rightPath: string) {
  return formatLocalDisplayPath(leftPath).replace(/[\\/]+$/, '').toLowerCase()
    === formatLocalDisplayPath(rightPath).replace(/[\\/]+$/, '').toLowerCase();
}

function getLocalPathSegments(path: string): CommanderPathSegment[] {
  if (!path) {
    return [];
  }

  const normalizedPath = formatLocalDisplayPath(path).replace(/[\\/]+$/, '');

  if (normalizedPath.startsWith('\\\\')) {
    const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);

    if (parts.length === 0) {
      return [{ label: '\\\\', path: '\\\\' }];
    }

    return parts.map((part, index) => {
      const nextPath = `\\\\${parts.slice(0, index + 1).join('\\')}`;

      return {
        label: index === 0 ? `\\\\${part}` : part,
        path: nextPath,
      };
    });
  }

  const driveMatch = normalizedPath.match(/^[A-Za-z]:/);
  const separator = normalizedPath.includes('\\') ? '\\' : '/';
  const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);
  const segments: CommanderPathSegment[] = [];
  let startIndex = 0;

  if (driveMatch) {
    const drive = driveMatch[0];
    segments.push({ label: drive, path: `${drive}\\` });
    startIndex = parts[0] === drive ? 1 : 0;
  } else if (normalizedPath.startsWith('/')) {
    segments.push({ label: '/', path: '/' });
  }

  parts.slice(startIndex).forEach((part, index) => {
    const previousPath = segments[segments.length - 1]?.path ?? '';
    const nextPath = previousPath
      ? joinLocalSegmentPath(previousPath, part)
      : parts.slice(0, startIndex + index + 1).join(separator);

    segments.push({ label: part, path: nextPath });
  });

  return segments.length > 0 ? segments : [{ label: normalizedPath, path: normalizedPath }];
}

function joinLocalSegmentPath(basePath: string, part: string) {
  if (basePath.endsWith('\\') || basePath.endsWith('/')) {
    return `${basePath}${part}`;
  }

  return `${basePath}\\${part}`;
}
