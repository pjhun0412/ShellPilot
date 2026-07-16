import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import type { LocalRootEntry } from './sftpBridge';
import { CommanderHeader } from './SftpCommanderHeader';
import { CommanderPaneBody } from './SftpCommanderPaneBody';
import { CommanderPathBar } from './SftpCommanderPathBar';
import { useSftpCommanderPaneSelection } from './useSftpCommanderPaneSelection';
import {
  formatLocalDisplayPath,
  handlePaneDragOver,
  handlePaneDrop,
  type CommanderEntry,
  type CommanderPaneVariant,
  type CommanderSortState,
} from './sftpCommanderUtils';

export function CommanderPane({
  entries,
  error,
  isLoading,
  isActive,
  label,
  parentPath,
  path,
  pendingActivationSelectionPath,
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
  pendingActivationSelectionPath?: string | null;
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
  onRemoteMoveDragOver?: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDragStart?: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop?: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
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
  const displayPath = variant === 'local' ? formatLocalDisplayPath(path) : path;
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState(displayPath);
  const {
    activatePane,
    beginMarqueeSelection,
    endMarqueeSelection,
    handleCommanderKeyDown,
    marqueeBox,
    selectEntry,
    selectEntryRange,
    sortedEntries,
    updateMarqueeSelection,
  } = useSftpCommanderPaneSelection({
    canDelete,
    canRename,
    entries,
    isLoading,
    isPathEditing,
    onActivate,
    onDelete,
    onNavigate,
    onRefresh,
    onRename,
    onSelect,
    onSelectMany,
    paneRef,
    parentPath,
    selectedPaths,
    sort,
    variant,
  });

  useEffect(() => {
    if (!isPathEditing) {
      setPathDraft(displayPath);
    }
  }, [displayPath, isPathEditing]);

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
      onDragOver={(event) => {
        if (variant === 'remote' && onRemoteMoveDragOver?.(event, path)) {
          return;
        }

        handlePaneDragOver(event, variant, dragSourceVariant);
      }}
      onDrop={(event) => {
        if (variant === 'remote' && onRemoteMoveDrop?.(event, path)) {
          return;
        }

        handlePaneDrop(event, variant, onDropPaths);
      }}
      onKeyDown={handleCommanderKeyDown}
      tabIndex={-1}
    >
      <CommanderPathBar
        displayPath={displayPath}
        isActive={isActive}
        isLoading={isLoading}
        isPathEditing={isPathEditing}
        label={label}
        localRoots={localRoots}
        onBrowseDirectory={onBrowseDirectory}
        onNavigate={onNavigate}
        onPathDraftChange={setPathDraft}
        onPathInputKeyDown={handlePathInputKeyDown}
        onSetPathEditing={setIsPathEditing}
        path={path}
        pathDraft={pathDraft}
        variant={variant}
      />

      <CommanderHeader
        onMouseDown={activatePane}
        onSortChange={onSortChange}
        sort={sort}
        variant={variant}
      />

      <CommanderPaneBody
        canDelete={canDelete}
        canDownload={canDownload}
        canRename={canRename}
        displayPath={displayPath}
        entriesCount={entries.length}
        error={error}
        isActive={isActive}
        isLoading={isLoading}
        isRemoteReady={isRemoteReady}
        marqueeBox={marqueeBox}
        onActivate={activatePane}
        onBeginMarqueeSelection={beginMarqueeSelection}
        onCopyPath={onCopyPath}
        onCreateFolder={onCreateFolder}
        onDelete={onDelete}
        onDownload={onDownload}
        onDragSourceChange={onDragSourceChange}
        onEndMarqueeSelection={endMarqueeSelection}
        onNavigate={onNavigate}
        onRefresh={onRefresh}
        onRemoteMoveDragEnd={onRemoteMoveDragEnd}
        onRemoteMoveDragOver={onRemoteMoveDragOver}
        onRemoteMoveDragStart={onRemoteMoveDragStart}
        onRemoteMoveDrop={onRemoteMoveDrop}
        onRename={onRename}
        onSelect={selectEntry}
        onSelectRange={selectEntryRange}
        onSetShowHiddenEntries={onSetShowHiddenEntries}
        onSetShowPermissions={onSetShowPermissions}
        onUpdateMarqueeSelection={updateMarqueeSelection}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
        onUploadSelectedLocal={onUploadSelectedLocal}
        parentPath={parentPath}
        pendingActivationSelectionPath={pendingActivationSelectionPath}
        remoteMoveTargetPath={remoteMoveTargetPath}
        selectedPaths={selectedPaths}
        showHiddenEntries={showHiddenEntries}
        showPermissions={showPermissions}
        sortedEntries={sortedEntries}
        variant={variant}
      />
    </section>
  );
}
