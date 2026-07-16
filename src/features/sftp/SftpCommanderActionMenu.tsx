import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { CommanderPaneVariant } from './sftpCommanderUtils';

export function CommanderPaneActionMenu({
  backStackLength,
  canDelete,
  canDownload,
  canRename,
  canTransfer,
  forwardStackLength,
  isActionDisabled,
  isLoading,
  label,
  onBack,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onForward,
  onRename,
  onSetMenuOpen,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onTransfer,
  onUploadFiles,
  onUploadFolder,
  showHiddenEntries,
  showInlineHistory,
  showInlineNewFolder,
  showPermissions,
  variant,
}: {
  backStackLength: number;
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  canTransfer: boolean;
  forwardStackLength: number;
  isActionDisabled: boolean;
  isLoading: boolean;
  label: string;
  onBack: () => void;
  onCopyPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  onForward: () => void;
  onRename?: () => void;
  onSetMenuOpen: (isOpen: boolean) => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onTransfer?: () => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
  showHiddenEntries: boolean;
  showInlineHistory: boolean;
  showInlineNewFolder: boolean;
  showPermissions: boolean;
  variant: CommanderPaneVariant;
}) {
  const runMenuAction = (action?: () => void) => {
    onSetMenuOpen(false);
    action?.();
  };

  return (
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
