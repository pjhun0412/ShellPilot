import { Copy, FolderOpen, Pencil } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import type { LocalRootEntry } from './sftpBridge';
import { getSftpPathSegments } from './sftpPathUtils';
import {
  formatLocalDisplayPath,
  getLocalPathSegments,
  isSameLocalRoot,
  type CommanderPaneVariant,
} from './sftpCommanderUtils';

export function CommanderPathBar({
  displayPath,
  isActive,
  isLoading,
  isPathEditing,
  label,
  localRoots,
  onBrowseDirectory,
  onNavigate,
  onPathDraftChange,
  onPathInputKeyDown,
  onSetPathEditing,
  path,
  pathDraft,
  variant,
}: {
  displayPath: string;
  isActive: boolean;
  isLoading: boolean;
  isPathEditing: boolean;
  label: string;
  localRoots: LocalRootEntry[];
  onBrowseDirectory?: () => void;
  onNavigate: (path: string) => void;
  onPathDraftChange: (value: string) => void;
  onPathInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSetPathEditing: (isEditing: boolean) => void;
  path: string;
  pathDraft: string;
  variant: CommanderPaneVariant;
}) {
  const pathSegments = variant === 'local' ? getLocalPathSegments(displayPath) : getSftpPathSegments(path);
  const firstPathSegment = pathSegments[0];
  const breadcrumbSegments = variant === 'local' && localRoots.length > 0
    ? pathSegments.slice(1)
    : pathSegments;
  const selectedLocalRootPath = firstPathSegment
    ? localRoots.find((root) => isSameLocalRoot(root.path, firstPathSegment.path))?.path
    : undefined;

  const beginPathEdit = () => {
    onPathDraftChange(displayPath);
    onSetPathEditing(true);
  };

  return (
    <div
      className={[
        'flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b px-3 font-mono text-xs text-slate-300 transition-colors',
        isActive ? 'border-primary/40 bg-primary/5' : 'border-border/50',
      ].join(' ')}
      title="Double-click path to edit"
      onDoubleClick={beginPathEdit}
    >
      <span
        className={[
          'shrink-0 font-sans text-[11px] font-semibold uppercase tracking-wide',
          isActive ? 'text-primary' : 'text-slate-500',
        ].join(' ')}
      >
        {label}
      </span>
      {isPathEditing ? (
        <input
          className="h-7 min-w-0 flex-1 rounded border border-primary/60 bg-slate-950 px-2 text-xs text-slate-100 outline-none"
          autoFocus
          value={pathDraft}
          onBlur={() => {
            onPathDraftChange(displayPath);
            onSetPathEditing(false);
          }}
          onChange={(event) => onPathDraftChange(event.target.value)}
          onKeyDown={onPathInputKeyDown}
        />
      ) : (
        <div className="app-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {variant === 'local' && firstPathSegment && localRoots.length > 0 && (
            <select
              className="max-w-28 shrink-0 rounded border border-transparent bg-slate-950/40 px-1.5 py-0.5 font-mono text-xs text-slate-100 outline-none hover:border-border/70 hover:bg-slate-900/80 focus:border-primary/60"
              title="Change local drive"
              disabled={isLoading}
              value={selectedLocalRootPath ?? firstPathSegment.path}
              onChange={(event) => onNavigate(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {localRoots.map((root) => (
                <option
                  className="bg-popover text-popover-foreground"
                  key={root.path}
                  value={root.path}
                >
                  {root.label}
                </option>
              ))}
              {!selectedLocalRootPath && (
                <option
                  className="bg-popover text-popover-foreground"
                  value={firstPathSegment.path}
                >
                  {firstPathSegment.label}
                </option>
              )}
            </select>
          )}
          {breadcrumbSegments.length > 0 ? breadcrumbSegments.map((segment, index) => {
            const isLast = index === pathSegments.length - 1;
            const isCurrentPath = variant === 'local' && localRoots.length > 0
              ? index === breadcrumbSegments.length - 1
              : isLast;

            return (
              <span className="flex min-w-0 items-center gap-1" key={`${segment.path}-${index}`}>
                {(index > 0 || (variant === 'local' && localRoots.length > 0)) && (
                  <span className="text-slate-600">/</span>
                )}
                <button
                  className={[
                    'max-w-44 truncate rounded px-1.5 py-0.5 text-left hover:bg-slate-900/70 hover:text-slate-100',
                    isCurrentPath ? 'cursor-default text-slate-100' : 'text-slate-400',
                  ].join(' ')}
                  type="button"
                  title={segment.path}
                  disabled={isCurrentPath || isLoading}
                  onClick={() => onNavigate(segment.path)}
                >
                  {segment.label}
                </button>
              </span>
            );
          }) : pathSegments.length === 0 ? (
            <button
              className="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-slate-300 hover:bg-slate-900/70 hover:text-slate-100"
              title="Click to edit path"
              type="button"
              onClick={beginPathEdit}
            >
              Loading...
            </button>
          ) : (
            <span className="sr-only">Current local root</span>
          )}
        </div>
      )}
      <button
        className="ml-2 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        title="Edit path"
        aria-label={`Edit ${label} path`}
        disabled={isLoading}
        onClick={(event) => {
          event.stopPropagation();
          beginPathEdit();
        }}
      >
        <Pencil className="size-3.5" />
      </button>
      {onBrowseDirectory && (
        <button
          className="ml-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          title="Browse local directory"
          aria-label="Browse local directory"
          disabled={isLoading}
          onClick={(event) => {
            event.stopPropagation();
            onBrowseDirectory();
          }}
        >
          <FolderOpen className="size-3.5" />
        </button>
      )}
      <button
        className="ml-1 grid size-7 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-900/70 hover:text-slate-100"
        type="button"
        title="Copy path"
        aria-label={`Copy ${label} path`}
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard.writeText(displayPath);
        }}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}
