import type { Table } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import type { DragEvent, MouseEvent, Ref } from 'react';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import type { SftpEntry } from './sftpBridge';
import { SftpFileTableContextMenu } from './SftpFileTableContextMenu';
import { SftpFileTableHeader } from './SftpFileTableHeader';
import { SftpFileTableEntryRow, SftpFileTableParentRow } from './SftpFileTableRow';

export interface SftpMarqueeBox {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface SftpFileTableProps {
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
  scrollViewportRef?: Ref<HTMLDivElement>;
  selectedEntriesCount: number;
  selectedEntryPath?: string;
  selectedEntryPaths: string[];
  showHiddenEntries: boolean;
  showPermissions: boolean;
  table: Table<SftpEntry>;
  tableGridTemplateColumns: string;
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
}: SftpFileTableProps) {
  const visibleColumnIds = new Set(table.getVisibleLeafColumns().map((column) => column.id));
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
      <SftpFileTableHeader
        table={table}
        tableGridTemplateColumns={tableGridTemplateColumns}
      />
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
                    <SftpFileTableParentRow
                      dragUploadTargetPath={dragUploadTargetPath}
                      isPanelActive={isPanelActive}
                      isUploadDragOver={isUploadDragOver}
                      parentEntryPathKey={parentEntryPathKey}
                      parentPath={parentPath}
                      pendingActivationSelectionPath={pendingActivationSelectionPath}
                      remoteMoveTargetPath={remoteMoveTargetPath}
                      selectedEntryPath={selectedEntryPath}
                      tableGridTemplateColumns={tableGridTemplateColumns}
                      visibleColumnIds={visibleColumnIds}
                      onOpenParent={onOpenParent}
                      onRemoteMoveDragOver={onRemoteMoveDragOver}
                      onRemoteMoveDrop={onRemoteMoveDrop}
                      onSelectEntry={onSelectEntry}
                    />
                  )}
                  {tableRows.map((row) => (
                    <SftpFileTableEntryRow
                      dragUploadTargetPath={dragUploadTargetPath}
                      isPanelActive={isPanelActive}
                      isRemoteReady={isRemoteReady}
                      isUploadDragOver={isUploadDragOver}
                      key={row.original.path}
                      pendingActivationSelectionPath={pendingActivationSelectionPath}
                      remoteMoveTargetPath={remoteMoveTargetPath}
                      row={row}
                      selectedEntryPath={selectedEntryPath}
                      selectedEntryPaths={selectedEntryPaths}
                      tableGridTemplateColumns={tableGridTemplateColumns}
                      onContextSelectEntry={onContextSelectEntry}
                      onOpenEntry={onOpenEntry}
                      onRemoteMoveDragEnd={onRemoteMoveDragEnd}
                      onRemoteMoveDragOver={onRemoteMoveDragOver}
                      onRemoteMoveDragStart={onRemoteMoveDragStart}
                      onRemoteMoveDrop={onRemoteMoveDrop}
                      onSelectEntry={onSelectEntry}
                    />
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
          <SftpFileTableContextMenu
            canDelete={canDelete}
            canDownload={canDownload}
            canRename={canRename}
            isLoading={isLoading}
            isRemoteReady={isRemoteReady}
            onCopySelectedPath={onCopySelectedPath}
            onCreateFolder={onCreateFolder}
            onDelete={onDelete}
            onDownload={onDownload}
            onRefresh={onRefresh}
            onRename={onRename}
            onSetShowHiddenEntries={onSetShowHiddenEntries}
            onSetShowPermissions={onSetShowPermissions}
            onUploadFiles={onUploadFiles}
            onUploadFolder={onUploadFolder}
            selectedEntriesCount={selectedEntriesCount}
            showHiddenEntries={showHiddenEntries}
            showPermissions={showPermissions}
          />
        </ContextMenu>
      </div>
    </>
  );
}
