import { redo, undo } from '@codemirror/commands';
import { EditorSelection, type Line } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type NotesEditorCommand = (view: EditorView) => boolean;

export const insertBold: NotesEditorCommand = (view) => wrapSelection(view, '**', '**', 'bold text');
export const insertItalic: NotesEditorCommand = (view) => wrapSelection(view, '*', '*', 'italic text');
export const insertStrikethrough: NotesEditorCommand = (view) => wrapSelection(view, '~~', '~~', 'strikethrough text');
export const insertHighlight: NotesEditorCommand = (view) => wrapSelection(view, '<mark>', '</mark>', 'highlighted text');
export const insertHighlightColor = (color: string): NotesEditorCommand =>
  (view) => wrapSelection(view, `<mark style="background-color: ${color}">`, '</mark>', 'highlighted text');
export const insertInlineCode: NotesEditorCommand = (view) => wrapSelection(view, '`', '`', 'code');
export const insertHeading: NotesEditorCommand = (view) => insertLinePrefix(view, '## ');
export const insertHeadingLevel = (level: 1 | 2 | 3): NotesEditorCommand =>
  (view) => insertLinePrefix(view, `${'#'.repeat(level)} `);
export const insertQuote: NotesEditorCommand = (view) => insertLinePrefix(view, '> ');
export const insertCallout: NotesEditorCommand = (view) =>
  insertTemplate(view, '> [!NOTE]\n> Write a helpful note here.', 'Write a helpful note here.');
export const insertCodeBlock: NotesEditorCommand = (view) =>
  insertTemplate(view, '```text\ncode\n```', 'code');
export const insertList: NotesEditorCommand = (view) => insertLinePrefix(view, '- ');
export const insertOrderedList: NotesEditorCommand = (view) => insertLinePrefix(view, '1. ');
export const insertChecklist: NotesEditorCommand = (view) => insertLinePrefix(view, '- [ ] ');
export const insertHorizontalRule: NotesEditorCommand = (view) => insertTemplate(view, '\n---\n');
export const insertDate: NotesEditorCommand = (view) => insertTemplate(view, new Date().toLocaleDateString('sv-SE'));

export const undoEditor: NotesEditorCommand = (view) => {
  const didUndo = undo(view);
  view.focus();
  return didUndo;
};

export const redoEditor: NotesEditorCommand = (view) => {
  const didRedo = redo(view);
  view.focus();
  return didRedo;
};

export const insertLink: NotesEditorCommand = (view) => {
  const { from, to } = view.state.selection.main;
  const selectedText = view.state.doc.sliceString(from, to);
  const label = selectedText || 'link text';
  const url = 'https://';
  const insert = `[${label}](${url})`;
  const selection =
    selectedText.length > 0
      ? EditorSelection.range(from + label.length + 3, from + label.length + 3 + url.length)
      : EditorSelection.range(from + 1, from + 1 + label.length);

  view.dispatch({
    changes: { from, to, insert },
    selection,
    scrollIntoView: true,
  });
  view.focus();

  return true;
};

export const insertTable: NotesEditorCommand = (view) =>
  insertTemplate(view, '| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |', 'Column 1');

export type NotesTableAlignment = 'left' | 'center' | 'right';

export const insertTableSize = (
  columnCount: number,
  rowCount: number,
): NotesEditorCommand =>
  (view) => {
    const columns = Math.max(1, Math.min(8, Math.floor(columnCount)));
    const rows = Math.max(1, Math.min(8, Math.floor(rowCount)));
    const header = `| ${Array.from({ length: columns }, (_, index) => `Heading ${index + 1}`).join(' | ')} |`;
    const separator = `| ${Array.from({ length: columns }, () => ':---').join(' | ')} |`;
    const body = Array.from(
      { length: Math.max(0, rows - 1) },
      () => `| ${Array.from({ length: columns }, () => ' ').join(' | ')} |`,
    );

    return insertTemplate(view, [header, separator, ...body].join('\n'), 'Heading 1');
  };

export const insertTextColor = (color: string): NotesEditorCommand =>
  (view) => wrapSelection(view, `<span style="color: ${color}">`, '</span>', 'colored text');

export const insertWikiLink: NotesEditorCommand = (view) => wrapSelection(view, '[[', ']]', 'note name');

export const insertAlignment = (alignment: 'center' | 'left' | 'right'): NotesEditorCommand =>
  (view) => alignTableCell(view, alignment)
    || wrapSelection(view, `<div align="${alignment}">\n`, '\n</div>', 'aligned text');

function alignTableCell(view: EditorView, alignment: NotesTableAlignment) {
  const cursor = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursor);

  if (!cursorLine.text.includes('|')) {
    return false;
  }

  let tableStart = cursorLine.number;
  let tableEnd = cursorLine.number;

  while (tableStart > 1 && view.state.doc.line(tableStart - 1).text.includes('|')) {
    tableStart -= 1;
  }
  while (tableEnd < view.state.doc.lines && view.state.doc.line(tableEnd + 1).text.includes('|')) {
    tableEnd += 1;
  }

  let separatorLine: Line | undefined;
  for (let lineNumber = tableStart; lineNumber <= tableEnd; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    if (isMarkdownTableSeparator(line.text)) {
      separatorLine = line;
      break;
    }
  }

  if (!separatorLine) {
    return false;
  }

  if (cursorLine.number === separatorLine.number) {
    return true;
  }

  const cursorOffset = Math.max(0, cursor - cursorLine.from);
  const leftPipe = cursorLine.text.lastIndexOf('|', Math.max(0, cursorOffset - 1));
  const rightPipe = cursorLine.text.indexOf('|', cursorOffset);
  const cellStart = leftPipe >= 0 ? leftPipe + 1 : 0;
  const cellEnd = rightPipe >= 0 ? rightPipe : cursorLine.text.length;
  const rawCell = cursorLine.text.slice(cellStart, cellEnd);
  const content = unwrapCellAlignment(rawCell.trim()) || 'Cell text';
  const alignedCell = ` <span style="display: block; text-align: ${alignment}">${content}</span> `;

  view.dispatch({
    changes: {
      from: cursorLine.from + cellStart,
      to: cursorLine.from + cellEnd,
      insert: alignedCell,
    },
    selection: EditorSelection.range(
      cursorLine.from + cellStart + alignedCell.indexOf(content),
      cursorLine.from + cellStart + alignedCell.indexOf(content) + content.length,
    ),
    scrollIntoView: true,
  });
  view.focus();

  return true;
}

function unwrapCellAlignment(content: string) {
  const match = content.match(
    /^<span style="display:\s*block;\s*text-align:\s*(?:left|center|right)">([\s\S]*)<\/span>$/i,
  );
  return match?.[1] ?? content;
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function wrapSelection(view: EditorView, prefix: string, suffix: string, placeholder: string) {
  const { from, to } = view.state.selection.main;
  const selectedText = view.state.doc.sliceString(from, to);
  const body = selectedText || placeholder;
  const insert = `${prefix}${body}${suffix}`;
  const bodyFrom = from + prefix.length;
  const bodyTo = bodyFrom + body.length;

  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(bodyFrom, bodyTo),
    scrollIntoView: true,
  });
  view.focus();

  return true;
}

function insertTemplate(view: EditorView, template: string, selectText?: string) {
  const { from, to } = view.state.selection.main;
  const selectOffset = selectText ? template.indexOf(selectText) : -1;
  const selection =
    selectText && selectOffset >= 0
      ? EditorSelection.range(from + selectOffset, from + selectOffset + selectText.length)
      : EditorSelection.cursor(from + template.length);

  view.dispatch({
    changes: { from, to, insert: template },
    selection,
    scrollIntoView: true,
  });
  view.focus();

  return true;
}

function insertLinePrefix(view: EditorView, marker: string) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to > from ? to - 1 : to);
  const changes = [];

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    changes.push({ from: view.state.doc.line(lineNumber).from, insert: marker });
  }

  const lineCount = endLine.number - startLine.number + 1;
  view.dispatch({
    changes,
    selection:
      from === to
        ? EditorSelection.cursor(from + marker.length)
        : EditorSelection.range(from + marker.length, to + marker.length * lineCount),
    scrollIntoView: true,
  });
  view.focus();

  return true;
}
