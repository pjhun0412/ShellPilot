import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  FileCode2,
  Heading2,
  Highlighter,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  TextQuote,
  Undo2,
} from 'lucide-react';
import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';

import {
  insertAlignment,
  insertBold,
  insertCallout,
  insertChecklist,
  insertCodeBlock,
  insertDate,
  insertHeadingLevel,
  insertHighlight,
  insertHighlightColor,
  insertHorizontalRule,
  insertInlineCode,
  insertItalic,
  insertLink,
  insertList,
  insertOrderedList,
  insertQuote,
  insertStrikethrough,
  insertTableSize,
  insertTextColor,
  insertWikiLink,
  redoEditor,
  type NotesEditorCommand,
  undoEditor,
} from './notesEditorCommands';

export function NotesEditorToolbar({ onCommand }: { onCommand: (command: NotesEditorCommand) => void }) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      if (toolbarRef.current?.contains(event.target as Node)) return;

      document.querySelectorAll<HTMLDetailsElement>('[data-notes-toolbar-menu][open]').forEach((menu) => {
        menu.removeAttribute('open');
      });
    };

    document.addEventListener('pointerdown', closeMenusOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsideClick);
  }, []);

  const runCommand = (command: NotesEditorCommand) => {
    document.querySelectorAll<HTMLDetailsElement>('[data-notes-toolbar-menu][open]').forEach((menu) => {
      menu.removeAttribute('open');
    });
    onCommand(command);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border/80 bg-background px-3 py-1.5" ref={toolbarRef}>
      <div className="notes-toolbar inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border border-border/80 bg-card/70 p-0.5">
        <ToolbarButton label="Undo" shortcut="Ctrl/Cmd+Z" onClick={() => runCommand(undoEditor)}>
          <Undo2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Redo" shortcut="Ctrl/Cmd+Shift+Z" onClick={() => runCommand(redoEditor)}>
          <Redo2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton label="Bold" shortcut="Ctrl/Cmd+B" onClick={() => runCommand(insertBold)}>
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Italic" shortcut="Ctrl/Cmd+I" onClick={() => runCommand(insertItalic)}>
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Link" shortcut="Ctrl/Cmd+K" onClick={() => runCommand(insertLink)}>
          <Link className="size-3.5" />
        </ToolbarButton>
        <ToolbarMenu label="Text">
          <ToolbarMenuItem icon={<Heading2 />} label="Heading 1" onClick={() => runCommand(insertHeadingLevel(1))} />
          <ToolbarMenuItem icon={<Heading2 />} label="Heading 2" onClick={() => runCommand(insertHeadingLevel(2))} />
          <ToolbarMenuItem icon={<Heading2 />} label="Heading 3" onClick={() => runCommand(insertHeadingLevel(3))} />
          <ToolbarMenuSeparator />
          <ToolbarMenuItem icon={<Strikethrough />} label="Strikethrough" onClick={() => runCommand(insertStrikethrough)} />
          <ToolbarMenuItem icon={<Highlighter />} label="Highlight" onClick={() => runCommand(insertHighlight)} />
          <ToolbarMenuItem icon={<Code2 />} label="Inline code" onClick={() => runCommand(insertInlineCode)} />
          <ToolbarMenuSeparator />
          <ToolbarMenuLabel icon={<Highlighter />} label="Highlight color" />
          <ColorPicker onSelect={(color) => runCommand(insertHighlightColor(color))} />
          <ToolbarMenuSeparator />
          <ToolbarMenuLabel icon={<Palette />} label="Font color" />
          <ColorPicker onSelect={(color) => runCommand(insertTextColor(color))} />
        </ToolbarMenu>
        <ToolbarMenu label="Block">
          <ToolbarMenuItem icon={<Quote />} label="Quote" onClick={() => runCommand(insertQuote)} />
          <ToolbarMenuItem icon={<TextQuote />} label="Callout note" onClick={() => runCommand(insertCallout)} />
          <ToolbarMenuItem icon={<FileCode2 />} label="Code block" onClick={() => runCommand(insertCodeBlock)} />
          <ToolbarMenuSeparator />
          <ToolbarMenuItem icon={<MoreHorizontal />} label="Divider" onClick={() => runCommand(insertHorizontalRule)} />
        </ToolbarMenu>
        <ToolbarMenu label="List">
          <ToolbarMenuItem icon={<List />} label="Bullet list" onClick={() => runCommand(insertList)} />
          <ToolbarMenuItem icon={<ListOrdered />} label="Numbered list" onClick={() => runCommand(insertOrderedList)} />
          <ToolbarMenuItem icon={<ListChecks />} label="Checklist" onClick={() => runCommand(insertChecklist)} />
        </ToolbarMenu>
        <ToolbarMenu label="Insert">
          <ToolbarMenuItem icon={<Link />} label="Web link" onClick={() => runCommand(insertLink)} />
          <ToolbarMenuItem icon={<Link />} label="Note link" onClick={() => runCommand(insertWikiLink)} />
          <ToolbarMenuSeparator />
          <ToolbarMenuLabel icon={<Table2 />} label="Table size" />
          <TableSizePicker onSelect={(columns, rows) => runCommand(insertTableSize(columns, rows))} />
          <ToolbarMenuSeparator />
          <ToolbarMenuItem icon={<MoreHorizontal />} label="Today's date" onClick={() => runCommand(insertDate)} />
        </ToolbarMenu>
        <ToolbarMenu label="Align">
          <ToolbarMenuLabel icon={<Table2 />} label="Text or current table cell" />
          <ToolbarMenuItem icon={<AlignLeft />} label="Align left" onClick={() => runCommand(insertAlignment('left'))} />
          <ToolbarMenuItem icon={<AlignCenter />} label="Align center" onClick={() => runCommand(insertAlignment('center'))} />
          <ToolbarMenuItem icon={<AlignRight />} label="Align right" onClick={() => runCommand(insertAlignment('right'))} />
        </ToolbarMenu>
      </div>
    </div>
  );
}

function ToolbarSeparator() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border/75" aria-hidden="true" />;
}

function ToolbarButton({
  children,
  label,
  onClick,
  shortcut,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      className="inline-grid size-7 place-items-center rounded text-[#cccccc] transition-colors hover:bg-muted/70 hover:text-foreground active:bg-primary/10"
      aria-label={title}
      title={title}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarMenu({ children, label }: { children: ReactNode; label: string }) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  return (
    <details
      className="group relative"
      data-notes-toolbar-menu
      ref={menuRef}
      onToggle={(event) => {
        if (!event.currentTarget.open) return;

        document.querySelectorAll<HTMLDetailsElement>('[data-notes-toolbar-menu][open]').forEach((menu) => {
          if (menu !== event.currentTarget) menu.removeAttribute('open');
        });
      }}
    >
      <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded px-2 text-xs font-medium text-[#cccccc] transition-colors hover:bg-muted/70 hover:text-foreground">
        {label}
      </summary>
      <div className="absolute left-0 top-8 z-30 grid min-w-44 gap-0.5 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        {Array.isArray(children)
          ? children.map((child, index) => cloneMenuChild(child, menuRef, index))
          : children}
      </div>
    </details>
  );
}

function cloneMenuChild(child: ReactNode, menuRef: RefObject<HTMLDetailsElement>, index: number) {
  if (!child || typeof child !== 'object' || !('props' in child)) {
    return child;
  }

  const element = child as ReactElement<{ onSelectMenu?: () => void }>;
  return cloneElement(element, {
    key: element.key ?? index,
    onSelectMenu: () => menuRef.current?.removeAttribute('open'),
  });
}

function ToolbarMenuItem({
  icon,
  label,
  onClick,
  onSelectMenu,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onSelectMenu?: () => void;
}) {
  return (
    <button
      className="flex min-h-8 items-center gap-2 rounded px-2 text-left text-xs text-foreground hover:bg-accent"
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onClick();
        onSelectMenu?.();
      }}
    >
      <span className="size-4 text-muted-foreground [&>svg]:size-4">{icon}</span>
      {label}
    </button>
  );
}

function ToolbarMenuSeparator({ onSelectMenu: _onSelectMenu }: { onSelectMenu?: () => void }) {
  return <span className="my-1 h-px bg-border" aria-hidden="true" />;
}

function ToolbarMenuLabel({
  icon,
  label,
  onSelectMenu: _onSelectMenu,
}: {
  icon: ReactNode;
  label: string;
  onSelectMenu?: () => void;
}) {
  return (
    <span className="flex items-center gap-2 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <span className="size-4 [&>svg]:size-4">{icon}</span>
      {label}
    </span>
  );
}

const textColors = [
  { color: '#000000', label: 'Black' },
  { color: '#ffffff', label: 'White' },
  { color: '#f87171', label: 'Red' },
  { color: '#fb923c', label: 'Orange' },
  { color: '#facc15', label: 'Yellow' },
  { color: '#4ade80', label: 'Green' },
  { color: '#60a5fa', label: 'Blue' },
  { color: '#a78bfa', label: 'Purple' },
  { color: '#f472b6', label: 'Pink' },
  { color: '#d1d5db', label: 'Gray' },
] as const;

function ColorPicker({
  onSelect,
  onSelectMenu,
}: {
  onSelect: (color: string) => void;
  onSelectMenu?: () => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5 px-2 pb-1">
      {textColors.map(({ color, label }) => (
        <button
          key={color}
          aria-label={label}
          className="size-4 rounded-sm border border-white/20 transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundColor: color }}
          title={label}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onSelect(color);
            onSelectMenu?.();
          }}
        />
      ))}
    </div>
  );
}

const tablePickerColumns = 8;
const tablePickerRows = 8;

function TableSizePicker({
  onSelect,
  onSelectMenu,
}: {
  onSelect: (columns: number, rows: number) => void;
  onSelectMenu?: () => void;
}) {
  const [hoveredSize, setHoveredSize] = useState({ columns: 0, rows: 0 });

  return (
    <div className="px-2 pb-1" onMouseLeave={() => setHoveredSize({ columns: 0, rows: 0 })}>
      <div className="mb-1.5 text-center text-[11px] text-muted-foreground">
        {hoveredSize.columns > 0 ? `${hoveredSize.columns} × ${hoveredSize.rows}` : 'Choose columns × rows'}
      </div>
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: tablePickerColumns * tablePickerRows }, (_, index) => {
          const columns = (index % tablePickerColumns) + 1;
          const rows = Math.floor(index / tablePickerColumns) + 1;
          const selected = columns <= hoveredSize.columns && rows <= hoveredSize.rows;

          return (
            <button
              key={`${columns}-${rows}`}
              aria-label={`${columns} columns by ${rows} rows`}
              className={selected
                ? 'size-4 rounded-sm border border-primary bg-primary/60'
                : 'size-4 rounded-sm border border-border bg-muted/40 hover:border-primary/70'}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHoveredSize({ columns, rows })}
              onFocus={() => setHoveredSize({ columns, rows })}
              onClick={() => {
                onSelect(columns, rows);
                onSelectMenu?.();
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
