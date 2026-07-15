import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';

export interface SftpPathSegment {
  label: string;
  path: string;
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
  areRemoteActionsDisabled = false,
  refreshTitle = 'Refresh',
  residualUploadCount,
  sessionHost,
  sessionUsername,
  showInlineViewMode,
  showHiddenEntries,
  showPermissions,
  viewMode,
}: {
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
  areRemoteActionsDisabled?: boolean;
  refreshTitle?: string;
  residualUploadCount: number;
  sessionHost: string | undefined;
  sessionUsername: string | undefined;
  showInlineViewMode: boolean;
  showHiddenEntries: boolean;
  showPermissions: boolean;
  viewMode: SftpViewMode;
}) {
  const isRemoteActionDisabled = areRemoteActionsDisabled || !isRemoteReady || isLoading;
  const isRemoteNavigationDisabled = isRemoteActionDisabled;
  const isRefreshActionDisabled = isRefreshDisabled ?? (!isRemoteReady || isLoading);

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3">
      <Server className="size-4 text-primary" />
      <div className="min-w-0 flex-1 truncate font-medium">
        {sessionUsername ? `${sessionUsername}@` : ''}{sessionHost}
      </div>
      {showInlineViewMode && (
        <ViewModeToggle onSetViewMode={onSetViewMode} viewMode={viewMode} />
      )}
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
        {!isNarrow && <span>Refresh</span>}
      </Button>
      {!isTiny && (
        <Button
          aria-label="New folder"
          title="New folder"
          size="sm"
          variant="secondary"
          type="button"
          onClick={onCreateFolder}
          disabled={isRemoteActionDisabled}
        >
          <Folder className="size-3.5" />
          {!isNarrow && <span>New</span>}
        </Button>
      )}
      <div className="relative">
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
          <div className="absolute right-0 top-9 z-50 grid w-44 gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            {isTiny && (
              <HeaderMenuButton disabled={isRemoteActionDisabled} onClick={onCreateFolder}>
                <Folder className="size-3.5" />
                New Folder
              </HeaderMenuButton>
            )}
            {!showInlineViewMode && (
              <>
                <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  View Mode
                </div>
                <HeaderMenuButton onClick={() => onSetViewMode('explorer')}>
                  <span className="w-3.5 text-center">{viewMode === 'explorer' ? '✓' : ''}</span>
                  Remote Explorer
                </HeaderMenuButton>
                <HeaderMenuButton onClick={() => onSetViewMode('commander')}>
                  <span className="w-3.5 text-center">{viewMode === 'commander' ? '✓' : ''}</span>
                  Commander
                </HeaderMenuButton>
                <div className="my-1 h-px bg-border" />
              </>
            )}
            <HeaderMenuButton disabled={isRemoteActionDisabled} onClick={onUploadFiles}>
              <Upload className="size-3.5" />
              Upload Files
            </HeaderMenuButton>
            <HeaderMenuButton disabled={isRemoteActionDisabled} onClick={onUploadFolder}>
              <FolderOpen className="size-3.5" />
              Upload Folder
            </HeaderMenuButton>
            <HeaderMenuButton disabled={isRemoteActionDisabled || !canDownload} onClick={onDownload}>
              <Download className="size-3.5" />
              Download
            </HeaderMenuButton>
            <HeaderMenuButton disabled={isRemoteActionDisabled} onClick={onCopyPath}>
              <Copy className="size-3.5" />
              Copy Path
            </HeaderMenuButton>
            <HeaderMenuButton disabled={isRemoteActionDisabled || !canRename} onClick={onRename}>
              <Pencil className="size-3.5" />
              Rename
            </HeaderMenuButton>
            <HeaderMenuButton
              className="text-destructive hover:bg-destructive/10"
              disabled={isRemoteActionDisabled || !canDelete}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Delete
            </HeaderMenuButton>
            <HeaderMenuButton
              disabled={isRemoteActionDisabled || residualUploadCount === 0}
              onClick={onCleanResidualUploadFiles}
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
            <HeaderMenuButton onClick={() => onSetShowHiddenEntries((value) => !value)}>
              <span className="w-3.5 text-center">{showHiddenEntries ? '✓' : ''}</span>
              Show Hidden
            </HeaderMenuButton>
            <HeaderMenuButton onClick={() => onSetShowPermissions((value) => !value)}>
              <span className="w-3.5 text-center">{showPermissions ? '✓' : ''}</span>
              Show Permissions
            </HeaderMenuButton>
          </div>
        )}
      </div>
    </div>
  );
}

export function SftpPathBar({
  inputError,
  inputRef,
  isEditing,
  isLoading,
  isRemoteReady,
  onBeginEdit,
  onCancelEdit,
  onCopyPath,
  onDraftChange,
  onNavigate,
  onSubmitEdit,
  pathDraft,
  segments,
}: {
  inputError?: string;
  inputRef: RefObject<HTMLInputElement>;
  isEditing: boolean;
  isLoading: boolean;
  isRemoteReady: boolean;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onCopyPath: () => void;
  onDraftChange: (value: string) => void;
  onNavigate: (path: string) => void;
  onSubmitEdit: () => void;
  pathDraft: string;
  segments: SftpPathSegment[];
}) {
  return (
    <div
      className="flex h-9 shrink-0 items-center overflow-hidden border-b border-border/50 px-3 font-mono text-xs text-slate-300"
      title="Double-click or press Ctrl+L to edit path"
      onDoubleClick={onBeginEdit}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          className={[
            'h-7 min-w-0 flex-1 rounded border bg-slate-950 px-2 text-xs text-slate-100 outline-none',
            inputError ? 'border-destructive/80' : 'border-primary/60',
          ].join(' ')}
          value={pathDraft}
          onBlur={onCancelEdit}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmitEdit();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              onCancelEdit();
            }
          }}
        />
      ) : (
        <div className="app-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {segments.map((segment, index) => {
            const isLast = index === segments.length - 1;

            return (
              <span className="flex min-w-0 items-center gap-1" key={`${segment.path}-${index}`}>
                {index > 0 && <span className="text-slate-600">/</span>}
                <button
                  className={[
                    'max-w-44 truncate rounded px-1.5 py-0.5 text-left hover:bg-slate-900/70 hover:text-slate-100',
                    isLast ? 'cursor-default text-slate-100' : 'text-slate-400',
                  ].join(' ')}
                  type="button"
                  title={segment.path}
                  disabled={isLast || isLoading}
                  onClick={() => onNavigate(segment.path)}
                >
                  {segment.label}
                </button>
              </span>
            );
          })}
        </div>
      )}
      {isEditing && inputError && (
        <span className="ml-2 min-w-20 max-w-56 truncate text-[11px] text-destructive" title={inputError}>
          {inputError}
        </span>
      )}
      <button
        className="ml-2 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        title="Edit path (Ctrl+L)"
        aria-label="Edit path"
        disabled={!isRemoteReady || isLoading}
        onClick={(event) => {
          event.stopPropagation();
          onBeginEdit();
        }}
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        className="ml-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
        type="button"
        title="Copy path"
        aria-label="Copy path"
        onClick={(event) => {
          event.stopPropagation();
          onCopyPath();
        }}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

export type SftpViewMode = 'commander' | 'explorer';

function ViewModeToggle({
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
          viewMode === 'explorer' ? 'bg-primary text-primary-foreground' : 'text-slate-400 hover:text-slate-100',
        ].join(' ')}
        type="button"
        onClick={() => onSetViewMode('explorer')}
      >
        Explorer
      </button>
      <button
        className={[
          'rounded px-2 transition-colors',
          viewMode === 'commander' ? 'bg-primary text-primary-foreground' : 'text-slate-400 hover:text-slate-100',
        ].join(' ')}
        type="button"
        onClick={() => onSetViewMode('commander')}
      >
        Commander
      </button>
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
