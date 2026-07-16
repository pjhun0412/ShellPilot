import { flexRender, type Row } from '@tanstack/react-table';
import { FolderOpen } from 'lucide-react';
import type { DragEvent, MouseEvent } from 'react';

import type { SftpEntry } from './sftpBridge';

const fileTableRowBaseClassName = 'mr-2 grid min-h-9 items-center gap-x-2 rounded-md border border-transparent px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-slate-700/70 hover:bg-slate-800/70 hover:text-foreground';

export interface SftpFileTableParentRowProps {
  dragUploadTargetPath?: string;
  isPanelActive: boolean;
  isUploadDragOver: boolean;
  parentEntryPathKey: string;
  parentPath: string;
  pendingActivationSelectionPath?: string | null;
  remoteMoveTargetPath?: string;
  selectedEntryPath?: string;
  tableGridTemplateColumns: string;
  visibleColumnIds: Set<string>;
  onOpenParent: (path: string) => void;
  onRemoteMoveDragOver: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDrop: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onSelectEntry: (entryPath: string, event: MouseEvent<HTMLElement>) => void;
}

export function SftpFileTableParentRow({
  dragUploadTargetPath,
  isPanelActive,
  isUploadDragOver,
  parentEntryPathKey,
  parentPath,
  pendingActivationSelectionPath,
  remoteMoveTargetPath,
  selectedEntryPath,
  tableGridTemplateColumns,
  visibleColumnIds,
  onOpenParent,
  onRemoteMoveDragOver,
  onRemoteMoveDrop,
  onSelectEntry,
}: SftpFileTableParentRowProps) {
  const isSelected = isPanelActive && (
    pendingActivationSelectionPath === parentEntryPathKey ||
    (pendingActivationSelectionPath === undefined && selectedEntryPath === parentEntryPathKey)
  );
  const isDropTarget = (isUploadDragOver && dragUploadTargetPath === parentPath) || remoteMoveTargetPath === parentPath;

  return (
    <div
      className={[
        fileTableRowBaseClassName,
        isSelected ? 'border-primary/60 bg-primary/15 text-foreground shadow-[inset_3px_0_0_hsl(var(--primary))]' : '',
        isDropTarget ? 'border-primary/70 bg-primary/20' : '',
      ].join(' ')}
      data-sftp-entry-path={parentEntryPathKey}
      role="button"
      style={{ gridTemplateColumns: tableGridTemplateColumns }}
      tabIndex={-1}
      title="Parent directory"
      onDragOver={(event) => onRemoteMoveDragOver(event, parentPath)}
      onDrop={(event) => onRemoteMoveDrop(event, parentPath)}
      onClick={(event) => onSelectEntry(parentEntryPathKey, event)}
      onDoubleClick={() => onOpenParent(parentPath)}
    >
      <span className="min-w-0 px-1">
        <span className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-4 shrink-0 text-amber-300" />
          <span className="truncate font-semibold text-foreground">..</span>
        </span>
      </span>
      {visibleColumnIds.has('kind') && (
        <span className="min-w-0 px-1">
          <span className="truncate font-mono text-[11px] text-muted-foreground">parent</span>
        </span>
      )}
      {visibleColumnIds.has('modifiedAt') && <span className="min-w-0 px-1" />}
      {visibleColumnIds.has('permissions') && <span className="min-w-0 px-1" />}
      {visibleColumnIds.has('owner') && <span className="min-w-0 px-1" />}
      <span className="min-w-0 px-1" />
      <span aria-hidden="true" />
    </div>
  );
}

export interface SftpFileTableEntryRowProps {
  dragUploadTargetPath?: string;
  isPanelActive: boolean;
  isRemoteReady: boolean;
  isUploadDragOver: boolean;
  pendingActivationSelectionPath?: string | null;
  remoteMoveTargetPath?: string;
  row: Row<SftpEntry>;
  selectedEntryPath?: string;
  selectedEntryPaths: string[];
  tableGridTemplateColumns: string;
  onContextSelectEntry: (entryPath: string, event: MouseEvent<HTMLElement>) => void;
  onOpenEntry: (entry: SftpEntry) => void;
  onRemoteMoveDragEnd: () => void;
  onRemoteMoveDragOver: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDragStart: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onSelectEntry: (entryPath: string, event: MouseEvent<HTMLElement>) => void;
}

export function SftpFileTableEntryRow({
  dragUploadTargetPath,
  isPanelActive,
  isRemoteReady,
  isUploadDragOver,
  pendingActivationSelectionPath,
  remoteMoveTargetPath,
  row,
  selectedEntryPath,
  selectedEntryPaths,
  tableGridTemplateColumns,
  onContextSelectEntry,
  onOpenEntry,
  onRemoteMoveDragEnd,
  onRemoteMoveDragOver,
  onRemoteMoveDragStart,
  onRemoteMoveDrop,
  onSelectEntry,
}: SftpFileTableEntryRowProps) {
  const entry = row.original;
  const isPendingActivationSelection = pendingActivationSelectionPath === entry.path;
  const isSelected = isPanelActive && (
    isPendingActivationSelection ||
    (pendingActivationSelectionPath === undefined && selectedEntryPaths.includes(entry.path))
  );
  const isFocused = isPanelActive && pendingActivationSelectionPath === undefined && selectedEntryPath === entry.path && !isSelected;
  const isDropTarget = (isUploadDragOver && entry.isDirectory && dragUploadTargetPath === entry.path) || remoteMoveTargetPath === entry.path;

  return (
    <div
      className={[
        fileTableRowBaseClassName,
        !isSelected && !isFocused ? 'odd:bg-slate-950/20' : '',
        isSelected ? 'border-primary/60 bg-primary/15 text-foreground shadow-[inset_3px_0_0_hsl(var(--primary))]' : '',
        isFocused ? 'border-primary/40 bg-slate-800/45' : '',
        isDropTarget ? 'border-primary/70 bg-primary/20' : '',
      ].join(' ')}
      data-sftp-entry-path={entry.path}
      key={entry.path}
      role="button"
      style={{ gridTemplateColumns: tableGridTemplateColumns }}
      tabIndex={-1}
      draggable={isRemoteReady}
      onDragEnd={onRemoteMoveDragEnd}
      onDragOver={(event) => onRemoteMoveDragOver(event, entry.isDirectory ? entry.path : undefined)}
      onDragStart={(event) => {
        const paths = selectedEntryPaths.includes(entry.path) ? selectedEntryPaths : [entry.path];
        onRemoteMoveDragStart(event, paths);
      }}
      onDrop={(event) => onRemoteMoveDrop(event, entry.isDirectory ? entry.path : undefined)}
      onClick={(event) => onSelectEntry(entry.path, event)}
      onContextMenu={(event) => onContextSelectEntry(entry.path, event)}
      onDoubleClick={() => onOpenEntry(entry)}
    >
      {row.getVisibleCells().map((cell) => (
        <span className="min-w-0 px-1" key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </span>
      ))}
      <span aria-hidden="true" />
    </div>
  );
}
