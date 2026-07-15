import { flexRender, type Table } from '@tanstack/react-table';
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react';
import type { DragEvent, MouseEvent, Ref } from 'react';

import { Button } from '@/components/ui/button';
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
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import type { SftpEntry } from './sftpBridge';

export interface SftpMarqueeBox {
  height: number;
  left: number;
  top: number;
  width: number;
}

export function SftpFileTable({
  canDelete,
  canDownload,
  canRename,
  dragUploadTargetPath,
  isLoading,
  isPanelActive,
  isRemoteReady,
  isUploadDragOver,
  marqueeBox,
  onBeginMarqueeSelection,
  onCleanResidualUploadFiles,
  onContextSelectEntry,
  onCopySelectedPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onDragLeave,
  onDragOver,
  onDrop,
  onEndMarqueeSelection,
  onOpenEntry,
  onOpenParent,
  onRefresh,
  onRemoteMoveDragEnd,
  onRemoteMoveDragOver,
  onRemoteMoveDragStart,
  onRemoteMoveDrop,
  onRename,
  onSelectEntry,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onUpdateMarqueeSelection,
  onUploadFiles,
  onUploadFolder,
  parentEntryPathKey,
  parentPath,
  path,
  pendingActivationSelectionPath,
  remoteMoveTargetPath,
  residualUploadEntries,
  selectedEntryPath,
  selectedEntryPaths,
  selectedEntriesCount,
  showHiddenEntries,
  showPermissions,
  scrollViewportRef,
  table,
  tableGridTemplateColumns,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  dragUploadTargetPath?: string;
  isLoading: boolean;
  isPanelActive: boolean;
  isRemoteReady: boolean;
  isUploadDragOver: boolean;
  marqueeBox?: SftpMarqueeBox;
  onBeginMarqueeSelection: (event: MouseEvent<HTMLElement>) => void;
  onCleanResidualUploadFiles: () => void;
  onContextSelectEntry: (entryPath: string, event: MouseEvent<HTMLElement>) => void;
  onCopySelectedPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onEndMarqueeSelection: () => void;
  onOpenEntry: (entry: SftpEntry) => void;
  onOpenParent: (path: string) => void;
  onRefresh: () => void;
  onRemoteMoveDragEnd: () => void;
  onRemoteMoveDragOver: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDragStart: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRename: () => void;
  onSelectEntry: (entryPath: string, event: MouseEvent<HTMLElement>) => void;
  onSetShowHiddenEntries: (value: boolean) => void;
  onSetShowPermissions: (value: boolean) => void;
  onUpdateMarqueeSelection: (event: MouseEvent<HTMLElement>) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  parentEntryPathKey: string;
  parentPath?: string;
  path: string;
  pendingActivationSelectionPath?: string | null;
  remoteMoveTargetPath?: string;
  residualUploadEntries: SftpEntry[];
  selectedEntryPath?: string;
  selectedEntryPaths: string[];
  selectedEntriesCount: number;
  showHiddenEntries: boolean;
  showPermissions: boolean;
  scrollViewportRef?: Ref<HTMLDivElement>;
  table: Table<SftpEntry>;
  tableGridTemplateColumns: string;
}) {
  const visibleColumns = table.getVisibleLeafColumns();
  const tableRows = table.getRowModel().rows;
  return (
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
            onClick={onCleanResidualUploadFiles}
          >
            <Trash2 className="size-3.5" />
            Clean
          </Button>
        </div>
      )}
      {table.getHeaderGroups().map((headerGroup) => (
        <div
          className="grid shrink-0 items-center gap-x-2 border-b border-border/70 bg-slate-950/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-200"
          key={headerGroup.id}
          style={{ gridTemplateColumns: tableGridTemplateColumns }}
        >
          {headerGroup.headers.map((header) => (
            <div className="relative min-w-0 pr-2" key={header.id}>
              <button
                className={[
                  'flex h-6 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-slate-200 hover:bg-slate-800/80 hover:text-slate-50',
                  header.column.id === 'size' ? 'justify-end text-right' : 'justify-start',
                  header.column.getIsSorted() ? 'text-primary' : '',
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
              onDragLeave={onDragLeave}
              onDragOver={(event) => {
                if (onRemoteMoveDragOver(event, path)) {
                  return;
                }

                onDragOver(event);
              }}
              onDrop={(event) => {
                if (onRemoteMoveDrop(event, path)) {
                  return;
                }

                onDrop(event);
              }}
              onMouseDown={onBeginMarqueeSelection}
              onMouseLeave={onEndMarqueeSelection}
              onMouseMove={onUpdateMarqueeSelection}
              onMouseUp={onEndMarqueeSelection}
            >
              <OverlayScrollArea data-sftp-scroll-viewport ref={scrollViewportRef}>
                <div className="grid min-w-full gap-1 py-1.5 pl-2 pr-1">
                  {parentPath && (
                    <div
                      className={[
                        'mr-2 grid min-h-9 items-center gap-x-2 rounded-md border border-transparent px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:border-slate-700/70 hover:bg-slate-800/70 hover:text-white',
                        isPanelActive && (pendingActivationSelectionPath === parentEntryPathKey || (pendingActivationSelectionPath === undefined && selectedEntryPath === parentEntryPathKey)) ? 'border-primary/60 bg-primary/15 text-white shadow-[inset_3px_0_0_hsl(var(--primary))]' : '',
                        (isUploadDragOver && dragUploadTargetPath === parentPath) || remoteMoveTargetPath === parentPath ? 'border-primary/70 bg-primary/20' : '',
                      ].join(' ')}
                      data-sftp-entry-path={parentEntryPathKey}
                      role="button"
                      style={{ gridTemplateColumns: tableGridTemplateColumns }}
                      tabIndex={-1}
                      title="Parent directory"
                      onDragOver={(event) => onRemoteMoveDragOver(event, parentPath)}
                      onDrop={(event) => onRemoteMoveDrop(event, parentPath)}
                      onClick={(event) => onSelectEntry(parentEntryPathKey, event)}
                      onDoubleClick={() => onRefreshParent(parentPath)}
                    >
                      <span className="min-w-0 px-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="size-4 shrink-0 text-amber-300" />
                          <span className="truncate font-semibold text-slate-100">..</span>
                        </span>
                      </span>
                      {visibleColumns.some((column) => column.id === 'kind') && (
                        <span className="min-w-0 px-1">
                          <span className="truncate font-mono text-[11px] text-slate-300">parent</span>
                        </span>
                      )}
                      {visibleColumns.some((column) => column.id === 'modifiedAt') && <span className="min-w-0 px-1" />}
                      {visibleColumns.some((column) => column.id === 'permissions') && <span className="min-w-0 px-1" />}
                      {visibleColumns.some((column) => column.id === 'owner') && <span className="min-w-0 px-1" />}
                      <span className="min-w-0 px-1" />
                      <span aria-hidden="true" />
                    </div>
                  )}
                  {tableRows.map((row) => {
                    const isPendingActivationSelection = pendingActivationSelectionPath === row.original.path;
                    const isSelected = isPanelActive && (
                      isPendingActivationSelection || (pendingActivationSelectionPath === undefined && selectedEntryPaths.includes(row.original.path))
                    );
                    const isFocused = isPanelActive && pendingActivationSelectionPath === undefined && selectedEntryPath === row.original.path && !isSelected;

                    return (
                    <div
                      className={[
                        'mr-2 grid min-h-9 items-center gap-x-2 rounded-md border border-transparent px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:border-slate-700/70 hover:bg-slate-800/70 hover:text-white',
                        !isSelected && !isFocused ? 'odd:bg-slate-950/20' : '',
                        isSelected ? 'border-primary/60 bg-primary/15 text-white shadow-[inset_3px_0_0_hsl(var(--primary))]' : '',
                        isFocused ? 'border-primary/40 bg-slate-800/45' : '',
                        ((isUploadDragOver && row.original.isDirectory && dragUploadTargetPath === row.original.path) || remoteMoveTargetPath === row.original.path) ? 'border-primary/70 bg-primary/20' : '',
                      ].join(' ')}
                      data-sftp-entry-path={row.original.path}
                      key={row.original.path}
                      role="button"
                      style={{ gridTemplateColumns: tableGridTemplateColumns }}
                      tabIndex={-1}
                      draggable={isRemoteReady}
                      onDragEnd={onRemoteMoveDragEnd}
                      onDragOver={(event) => onRemoteMoveDragOver(event, row.original.isDirectory ? row.original.path : undefined)}
                      onDragStart={(event) => {
                        const paths = selectedEntryPaths.includes(row.original.path) ? selectedEntryPaths : [row.original.path];
                        onRemoteMoveDragStart(event, paths);
                      }}
                      onDrop={(event) => onRemoteMoveDrop(event, row.original.isDirectory ? row.original.path : undefined)}
                      onClick={(event) => onSelectEntry(row.original.path, event)}
                      onContextMenu={(event) => onContextSelectEntry(row.original.path, event)}
                      onDoubleClick={() => onOpenEntry(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <span className="min-w-0 px-1" key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </span>
                      ))}
                      <span aria-hidden="true" />
                    </div>
                    );
                  })}
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
              {selectedEntriesCount > 0 ? `${selectedEntriesCount} selected` : 'SFTP Explorer'}
            </ContextMenuLabel>
            <ContextMenuItem onSelect={onRefresh} disabled={isLoading}>
              Refresh
              <ContextMenuShortcut>F5</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCreateFolder} disabled={isLoading}>
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
            <ContextMenuItem onSelect={onCopySelectedPath}>
              Copy Path
            </ContextMenuItem>
            <ContextMenuItem onSelect={onRename} disabled={!isRemoteReady || isLoading || !canRename}>
              Rename
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onDelete}
              disabled={!isRemoteReady || isLoading || !canDelete}
            >
              Delete
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem checked={showHiddenEntries} onCheckedChange={(checked) => onSetShowHiddenEntries(Boolean(checked))}>
              Show Hidden Files
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem checked={showPermissions} onCheckedChange={(checked) => onSetShowPermissions(Boolean(checked))}>
              Show Permissions
            </ContextMenuCheckboxItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </>
  );

  function onRefreshParent(nextPath: string) {
    onOpenParent(nextPath);
  }
}
