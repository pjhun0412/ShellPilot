import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  RefreshCcw,
} from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { SftpPanelHeaderActionMenu } from './SftpPanelHeaderActionMenu';
import type { SftpViewMode } from './sftpPanelTypes';
import { useSftpDismissibleLayer } from './useSftpDismissibleLayer';

export function SftpViewModeToggle({
  onSetViewMode,
  viewMode,
}: {
  onSetViewMode: (value: SftpViewMode) => void;
  viewMode: SftpViewMode;
}) {
  return (
    <div className="flex h-7 shrink-0 overflow-hidden rounded-md border border-border bg-slate-950/40 p-0.5 text-[11px]">
      <button
        className={[
          'rounded px-2 transition-colors',
          viewMode === 'explorer' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
        type="button"
        onClick={() => onSetViewMode('explorer')}
      >
        Explorer
      </button>
      <button
        className={[
          'rounded px-2 transition-colors',
          viewMode === 'commander' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
        type="button"
        onClick={() => onSetViewMode('commander')}
      >
        Commander
      </button>
    </div>
  );
}

export function SftpPanelHeaderActions({
  backStackLength,
  canDelete,
  canDownload,
  canRename,
  forwardStackLength,
  isActionMenuOpen,
  isPathActionDisabled,
  isRefreshActionDisabled,
  isRemoteActionDisabled,
  isRemoteNavigationDisabled,
  isTiny,
  onCleanResidualUploadFiles,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onGoBack,
  onGoForward,
  onRefresh,
  onRename,
  onSetActionMenuOpen,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onSetViewMode,
  onUploadFiles,
  onUploadFolder,
  refreshTitle,
  residualUploadCount,
  showHiddenEntries,
  showInlineViewMode,
  showPermissions,
  viewMode,
  actionScope = 'remote',
}: {
  backStackLength: number;
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  forwardStackLength: number;
  isActionMenuOpen: boolean;
  isPathActionDisabled: boolean;
  isRefreshActionDisabled: boolean;
  isRemoteActionDisabled: boolean;
  isRemoteNavigationDisabled: boolean;
  isTiny: boolean;
  onCleanResidualUploadFiles: () => void;
  onCopyPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onRefresh: () => void;
  onRename: () => void;
  onSetActionMenuOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  onSetShowHiddenEntries: (value: (current: boolean) => boolean) => void;
  onSetShowPermissions: (value: (current: boolean) => boolean) => void;
  onSetViewMode: (value: SftpViewMode) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  refreshTitle: string;
  residualUploadCount: number;
  showHiddenEntries: boolean;
  showInlineViewMode: boolean;
  showPermissions: boolean;
  viewMode: SftpViewMode;
  actionScope?: 'local' | 'remote';
}) {
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const isLocalScope = actionScope === 'local';
  const closeActionMenu = () => onSetActionMenuOpen(false);

  useSftpDismissibleLayer({
    isOpen: isActionMenuOpen,
    layerRef: actionMenuRef,
    onDismiss: closeActionMenu,
  });

  return (
    <>
      <Button
        aria-label="Back"
        title="Back"
        size="sm"
        variant="secondary"
        type="button"
        onClick={onGoBack}
        disabled={isRemoteNavigationDisabled || backStackLength === 0}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        aria-label="Forward"
        title="Forward"
        size="sm"
        variant="secondary"
        type="button"
        onClick={onGoForward}
        disabled={isRemoteNavigationDisabled || forwardStackLength === 0}
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <Button
        aria-label="Refresh"
        title={refreshTitle}
        size="sm"
        variant="secondary"
        type="button"
        onClick={onRefresh}
        disabled={isRefreshActionDisabled}
      >
        <RefreshCcw className="size-3.5" />
      </Button>
      {!isTiny && (
        <Button
          aria-label="New folder"
          title="New folder"
          size="sm"
          variant="secondary"
          type="button"
          onClick={onCreateFolder}
          disabled={isPathActionDisabled}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      )}
      <div className="relative" ref={actionMenuRef}>
        <Button
          aria-label="More SFTP actions"
          title="More actions"
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => onSetActionMenuOpen((value) => !value)}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
        {isActionMenuOpen && (
          <SftpPanelHeaderActionMenu
            canDelete={canDelete}
            canDownload={canDownload}
            canRename={canRename}
            isLocalScope={isLocalScope}
            isPathActionDisabled={isPathActionDisabled}
            isRemoteActionDisabled={isRemoteActionDisabled}
            isTiny={isTiny}
            onCleanResidualUploadFiles={onCleanResidualUploadFiles}
            onClose={closeActionMenu}
            onCopyPath={onCopyPath}
            onCreateFolder={onCreateFolder}
            onDelete={onDelete}
            onDownload={onDownload}
            onRename={onRename}
            onSetShowHiddenEntries={onSetShowHiddenEntries}
            onSetShowPermissions={onSetShowPermissions}
            onSetViewMode={onSetViewMode}
            onUploadFiles={onUploadFiles}
            onUploadFolder={onUploadFolder}
            residualUploadCount={residualUploadCount}
            showHiddenEntries={showHiddenEntries}
            showInlineViewMode={showInlineViewMode}
            showPermissions={showPermissions}
            viewMode={viewMode}
          />
        )}
      </div>
    </>
  );
}
