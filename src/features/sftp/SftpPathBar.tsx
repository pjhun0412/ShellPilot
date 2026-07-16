import { Copy, Pencil } from 'lucide-react';
import { type KeyboardEvent, type RefObject } from 'react';

import type { SftpPathSegment } from './sftpPanelTypes';

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
