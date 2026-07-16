import {
  Copy,
  Download,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { SftpViewMode } from './sftpPanelTypes';

export function SftpPanelHeaderActionMenu({
  canDelete,
  canDownload,
  canRename,
  isLocalScope,
  isPathActionDisabled,
  isRemoteActionDisabled,
  isTiny,
  onCleanResidualUploadFiles,
  onClose,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onRename,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onSetViewMode,
  onUploadFiles,
  onUploadFolder,
  residualUploadCount,
  showHiddenEntries,
  showInlineViewMode,
  showPermissions,
  viewMode,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  isLocalScope: boolean;
  isPathActionDisabled: boolean;
  isRemoteActionDisabled: boolean;
  isTiny: boolean;
  onCleanResidualUploadFiles: () => void;
  onClose: () => void;
  onCopyPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onRename: () => void;
  onSetShowHiddenEntries: (value: (current: boolean) => boolean) => void;
  onSetShowPermissions: (value: (current: boolean) => boolean) => void;
  onSetViewMode: (value: SftpViewMode) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  residualUploadCount: number;
  showHiddenEntries: boolean;
  showInlineViewMode: boolean;
  showPermissions: boolean;
  viewMode: SftpViewMode;
}) {
  const runMenuAction = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div className="absolute right-0 top-9 z-50 grid w-44 gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
      {isTiny && (
        <HeaderMenuButton disabled={isPathActionDisabled} onClick={() => runMenuAction(onCreateFolder)}>
          <FolderPlus className="size-3.5" />
          New Folder
        </HeaderMenuButton>
      )}
      {!showInlineViewMode && (
        <>
          <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            View Mode
          </div>
          <HeaderMenuButton onClick={() => runMenuAction(() => onSetViewMode('explorer'))}>
            <span className="w-3.5 text-center">{viewMode === 'explorer' ? '\u2713' : ''}</span>
            Remote Explorer
          </HeaderMenuButton>
          <HeaderMenuButton onClick={() => runMenuAction(() => onSetViewMode('commander'))}>
            <span className="w-3.5 text-center">{viewMode === 'commander' ? '\u2713' : ''}</span>
            Commander
          </HeaderMenuButton>
          <div className="my-1 h-px bg-border" />
        </>
      )}
      <HeaderMenuButton disabled={isLocalScope || isRemoteActionDisabled} onClick={() => runMenuAction(onUploadFiles)}>
        <Upload className="size-3.5" />
        Upload Files
      </HeaderMenuButton>
      <HeaderMenuButton disabled={isLocalScope || isRemoteActionDisabled} onClick={() => runMenuAction(onUploadFolder)}>
        <FolderOpen className="size-3.5" />
        Upload Folder
      </HeaderMenuButton>
      <HeaderMenuButton disabled={isLocalScope || isRemoteActionDisabled || !canDownload} onClick={() => runMenuAction(onDownload)}>
        <Download className="size-3.5" />
        Download
      </HeaderMenuButton>
      <HeaderMenuButton disabled={isPathActionDisabled} onClick={() => runMenuAction(onCopyPath)}>
        <Copy className="size-3.5" />
        Copy Path
      </HeaderMenuButton>
      <HeaderMenuButton disabled={isLocalScope || isRemoteActionDisabled || !canRename} onClick={() => runMenuAction(onRename)}>
        <Pencil className="size-3.5" />
        Rename
      </HeaderMenuButton>
      <HeaderMenuButton
        className="text-destructive hover:bg-destructive/10"
        disabled={isPathActionDisabled || !canDelete}
        onClick={() => runMenuAction(onDelete)}
      >
        <Trash2 className="size-3.5" />
        Delete
      </HeaderMenuButton>
      <HeaderMenuButton
        disabled={isLocalScope || isRemoteActionDisabled || residualUploadCount === 0}
        onClick={() => runMenuAction(onCleanResidualUploadFiles)}
      >
        <Trash2 className="size-3.5" />
        Clean Leftovers
        {residualUploadCount > 0 && (
          <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            {residualUploadCount}
          </span>
        )}
      </HeaderMenuButton>
      <div className="my-1 h-px bg-border" />
      <HeaderMenuButton onClick={() => runMenuAction(() => onSetShowHiddenEntries((value) => !value))}>
        <span className="w-3.5 text-center">{showHiddenEntries ? '\u2713' : ''}</span>
        Show Hidden
      </HeaderMenuButton>
      <HeaderMenuButton onClick={() => runMenuAction(() => onSetShowPermissions((value) => !value))}>
        <span className="w-3.5 text-center">{showPermissions ? '\u2713' : ''}</span>
        Show Permissions
      </HeaderMenuButton>
    </div>
  );
}

function HeaderMenuButton({
  children,
  className = '',
  disabled,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        'flex h-8 items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
