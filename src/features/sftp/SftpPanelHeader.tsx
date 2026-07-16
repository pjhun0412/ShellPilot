import { Server } from 'lucide-react';
import { SftpPanelHeaderActions, SftpViewModeToggle } from './SftpPanelHeaderActions';
import type { SftpViewMode } from './sftpPanelTypes';

export interface SftpPanelHeaderProps {
  backStackLength: number;
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  forwardStackLength: number;
  isActionMenuOpen: boolean;
  isLoading: boolean;
  isNarrow: boolean;
  isRemoteReady: boolean;
  isRefreshDisabled?: boolean;
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
  actionScope?: 'local' | 'remote';
  areRemoteActionsDisabled?: boolean;
  refreshTitle?: string;
  residualUploadCount: number;
  sessionHost: string | undefined;
  sessionUsername: string | undefined;
  showInlineViewMode: boolean;
  showHiddenEntries: boolean;
  showPermissions: boolean;
  showActions?: boolean;
  viewMode: SftpViewMode;
}

export function SftpPanelHeader({
  backStackLength,
  canDelete,
  canDownload,
  canRename,
  forwardStackLength,
  isActionMenuOpen,
  isLoading,
  isNarrow,
  isRemoteReady,
  isRefreshDisabled,
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
  actionScope = 'remote',
  areRemoteActionsDisabled = false,
  refreshTitle = 'Refresh',
  residualUploadCount,
  sessionHost,
  sessionUsername,
  showInlineViewMode,
  showHiddenEntries,
  showPermissions,
  showActions = true,
  viewMode,
}: SftpPanelHeaderProps) {
  const isLocalScope = actionScope === 'local';
  const isLocalActionDisabled = isRefreshDisabled ?? isLoading;
  const isRemoteActionDisabled = areRemoteActionsDisabled || !isRemoteReady || isLoading;
  const isPathActionDisabled = isLocalScope ? isLocalActionDisabled : isRemoteActionDisabled;
  const isRemoteNavigationDisabled = isRemoteActionDisabled;
  const isRefreshActionDisabled = isRefreshDisabled ?? (!isRemoteReady || isLoading);

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3">
      <Server className="size-4 text-primary" />
      <div className="min-w-0 max-w-[22rem] truncate font-medium">
        {sessionUsername ? `${sessionUsername}@` : ''}{sessionHost}
      </div>
      {showInlineViewMode && (
        <SftpViewModeToggle onSetViewMode={onSetViewMode} viewMode={viewMode} />
      )}
      <div className="min-w-0 flex-1" />
      {showActions && (
        <SftpPanelHeaderActions
          actionScope={actionScope}
          backStackLength={backStackLength}
          canDelete={canDelete}
          canDownload={canDownload}
          canRename={canRename}
          forwardStackLength={forwardStackLength}
          isActionMenuOpen={isActionMenuOpen}
          isPathActionDisabled={isPathActionDisabled}
          isRefreshActionDisabled={isRefreshActionDisabled}
          isRemoteActionDisabled={isRemoteActionDisabled}
          isRemoteNavigationDisabled={isRemoteNavigationDisabled}
          isTiny={isTiny}
          onCleanResidualUploadFiles={onCleanResidualUploadFiles}
          onCopyPath={onCopyPath}
          onCreateFolder={onCreateFolder}
          onDelete={onDelete}
          onDownload={onDownload}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          onRefresh={onRefresh}
          onRename={onRename}
          onSetActionMenuOpen={onSetActionMenuOpen}
          onSetShowHiddenEntries={onSetShowHiddenEntries}
          onSetShowPermissions={onSetShowPermissions}
          onSetViewMode={onSetViewMode}
          onUploadFiles={onUploadFiles}
          onUploadFolder={onUploadFolder}
          refreshTitle={refreshTitle}
          residualUploadCount={residualUploadCount}
          showHiddenEntries={showHiddenEntries}
          showInlineViewMode={showInlineViewMode}
          showPermissions={showPermissions}
          viewMode={viewMode}
        />
      )}
    </div>
  );
}
