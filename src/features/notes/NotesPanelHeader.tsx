import { Columns2, Eye, FileText, ListOrdered, PencilLine } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { NoteMeta, NoteViewMode } from './notesTypes';

export function NotesPanelHeader({
  meta,
  onChangeViewMode,
  onToggleLineNumbers,
  showLineNumbers,
  viewMode,
}: {
  meta?: NoteMeta;
  onChangeViewMode: (mode: NoteViewMode) => void;
  onToggleLineNumbers: () => void;
  showLineNumbers: boolean;
  viewMode: NoteViewMode;
}) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-3 border-b bg-card/80 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{meta?.title ?? 'Note'}</h2>
          <p className="truncate text-xs text-muted-foreground">{meta?.path ?? 'Markdown note'}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium transition-colors',
            showLineNumbers
              ? 'border-primary/35 bg-primary/14 text-primary hover:bg-primary/18'
              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
          )}
          title={showLineNumbers ? 'Hide line numbers' : 'Show line numbers'}
          type="button"
          onClick={onToggleLineNumbers}
        >
          <ListOrdered className="size-3.5" />
          Line No.
        </button>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          <ModeButton active={viewMode === 'edit'} onClick={() => onChangeViewMode('edit')}>
            <PencilLine className="size-3.5" />
            Edit
          </ModeButton>
          <ModeButton active={viewMode === 'live'} onClick={() => onChangeViewMode('live')}>
            <Columns2 className="size-3.5" />
            Live
          </ModeButton>
          <ModeButton active={viewMode === 'preview'} onClick={() => onChangeViewMode('preview')}>
            <Eye className="size-3.5" />
            Preview
          </ModeButton>
        </div>
      </div>
    </header>
  );
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-semibold transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
