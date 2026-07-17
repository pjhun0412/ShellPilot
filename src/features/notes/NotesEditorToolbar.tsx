import { Bold, Code2, Heading2, Italic, Link, List, ListChecks, Quote, Table2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import {
  insertBold,
  insertChecklist,
  insertHeading,
  insertInlineCode,
  insertItalic,
  insertLink,
  insertList,
  insertQuote,
  insertTable,
  type NotesEditorCommand,
} from './notesEditorCommands';

export function NotesEditorToolbar({ onCommand }: { onCommand: (command: NotesEditorCommand) => void }) {
  return (
    <div className="app-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto border-b border-border/80 bg-background px-3 py-1.5">
      <div className="notes-toolbar inline-flex shrink-0 items-center rounded-md border border-border/80 bg-card/70 p-0.5">
        <ToolbarButton label="Bold" shortcut="Ctrl/Cmd+B" onClick={() => onCommand(insertBold)}>
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Italic" shortcut="Ctrl/Cmd+I" onClick={() => onCommand(insertItalic)}>
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton label="Heading" onClick={() => onCommand(insertHeading)}>
          <Heading2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Link" shortcut="Ctrl/Cmd+K" onClick={() => onCommand(insertLink)}>
          <Link className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Inline code" onClick={() => onCommand(insertInlineCode)}>
          <Code2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton label="Quote" onClick={() => onCommand(insertQuote)}>
          <Quote className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="List" onClick={() => onCommand(insertList)}>
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Checklist" onClick={() => onCommand(insertChecklist)}>
          <ListChecks className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Table" onClick={() => onCommand(insertTable)}>
          <Table2 className="size-3.5" />
        </ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarSeparator() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border/75" aria-hidden="true" />;
}

function ToolbarButton({
  active,
  children,
  label,
  onClick,
  shortcut,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      className={cn(
        'inline-grid size-7 place-items-center rounded transition-colors',
        active
          ? 'bg-primary/14 text-primary'
          : 'text-[#cccccc] hover:bg-muted/70 hover:text-foreground active:bg-primary/10',
      )}
      aria-label={title}
      title={title}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
