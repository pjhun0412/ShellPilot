import { useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { CommanderContextMenu } from './SftpCommanderContextMenu';
import { CommanderRow } from './SftpCommanderRow';
import {
  COMMANDER_BODY_CLASS_NAME,
  handleRowDragStart,
  type CommanderEntry,
  type CommanderPaneVariant,
} from './sftpCommanderUtils';

type CommanderMarqueeBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function CommanderPaneBody({
  canDelete,
  canDownload,
  canRename,
  currentPath,
  displayPath,
  entriesCount,
  error,
  isActive,
  isLoading,
  isRemoteReady,
  marqueeBox,
  onActivate,
  onBeginMarqueeSelection,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onDragSourceChange,
  onEndMarqueeSelection,
  onFavoritePath,
  onNavigate,
  onRefresh,
  onRemoteMoveDragEnd,
  onRemoteMoveDragOver,
  onRemoteMoveDragStart,
  onRemoteMoveDrop,
  onRename,
  onSelect,
  onSelectRange,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onUpdateMarqueeSelection,
  onUploadFiles,
  onUploadFolder,
  onUploadSelectedLocal,
  parentPath,
  pendingActivationSelectionPath,
  remoteMoveTargetPath,
  selectedPaths,
  showHiddenEntries,
  showPermissions,
  sortedEntries,
  variant,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  currentPath: string;
  displayPath: string;
  entriesCount: number;
  error?: string;
  isActive: boolean;
  isLoading: boolean;
  isRemoteReady: boolean;
  marqueeBox?: CommanderMarqueeBox;
  onActivate: () => void;
  onBeginMarqueeSelection: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onCopyPath?: () => void;
  onCreateFolder?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onDragSourceChange: (variant: CommanderPaneVariant | undefined) => void;
  onEndMarqueeSelection: () => void;
  onFavoritePath?: (path: string) => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onRemoteMoveDragEnd?: () => void;
  onRemoteMoveDragOver?: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDragStart?: (event: DragEvent<HTMLElement>, paths: string[]) => void;
  onRemoteMoveDrop?: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRename?: () => void;
  onSelect: (path: string, additive: boolean) => void;
  onSelectRange: (path: string) => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onUpdateMarqueeSelection: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
  onUploadSelectedLocal?: () => void;
  parentPath?: string;
  pendingActivationSelectionPath?: string | null;
  remoteMoveTargetPath?: string;
  selectedPaths: string[];
  showHiddenEntries: boolean;
  showPermissions: boolean;
  sortedEntries: CommanderEntry[];
  variant: CommanderPaneVariant;
}) {
  const [favoriteContextPath, setFavoriteContextPath] = useState(currentPath);

  const updateFavoriteContextPath = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rowElement = (event.target as HTMLElement | null)?.closest('[data-commander-entry-path]');
    const rowPath = rowElement?.getAttribute('data-commander-entry-path');
    const rowEntry = rowPath
      ? sortedEntries.find((entry) => entry.path === rowPath)
      : undefined;

    if (!rowPath) {
      setFavoriteContextPath(currentPath);
      return;
    }

    setFavoriteContextPath(rowEntry?.isDirectory || rowPath === parentPath ? rowPath : currentPath);
  };

  if (error) {
    return <div className="p-3 text-xs text-destructive">{error}</div>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative min-h-0 flex-1 select-none"
          onMouseDown={onBeginMarqueeSelection}
          onMouseLeave={onEndMarqueeSelection}
          onMouseMove={onUpdateMarqueeSelection}
          onContextMenu={updateFavoriteContextPath}
          onMouseUp={onEndMarqueeSelection}
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
                  pendingActivationSelectionPath={pendingActivationSelectionPath}
                  showSelection={isActive}
                  onActivate={onActivate}
                  onNavigate={onNavigate}
                  onSelect={onSelect}
                  onSelectRange={onSelectRange}
                  onRemoteMoveDragOver={onRemoteMoveDragOver}
                  onRemoteMoveDrop={onRemoteMoveDrop}
                  onDragStart={undefined}
                  remoteMoveTargetPath={remoteMoveTargetPath}
                  remoteMoveTargetDirectoryPath={variant === 'remote' ? parentPath : undefined}
                  variant={variant}
                />
              )}
              {sortedEntries.map((entry) => (
                <CommanderRow
                  entry={entry}
                  key={entry.path}
                  selected={selectedPaths.includes(entry.path)}
                  pendingActivationSelectionPath={pendingActivationSelectionPath}
                  showSelection={isActive}
                  onActivate={onActivate}
                  onNavigate={onNavigate}
                  onSelect={onSelect}
                  onSelectRange={onSelectRange}
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
                  remoteMoveTargetDirectoryPath={variant === 'remote' && entry.kind === 'directory' ? entry.path : undefined}
                  variant={variant}
                />
              ))}
              {isLoading && (
                <div className="px-3 py-2 text-xs text-primary">Loading...</div>
              )}
              {!isLoading && entriesCount === 0 && !parentPath && (
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
        onFavoritePath={onFavoritePath ? () => onFavoritePath(favoriteContextPath) : undefined}
        onRefresh={onRefresh}
        onRename={onRename}
        onSetShowHiddenEntries={onSetShowHiddenEntries}
        onSetShowPermissions={onSetShowPermissions}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
        onUploadSelectedLocal={onUploadSelectedLocal}
      />
    </ContextMenu>
  );
}
