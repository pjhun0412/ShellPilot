import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type NotesEditorCommand = (view: EditorView) => boolean;

export const insertBold: NotesEditorCommand = (view) => wrapSelection(view, '**', '**', 'bold text');
export const insertItalic: NotesEditorCommand = (view) => wrapSelection(view, '*', '*', 'italic text');
export const insertInlineCode: NotesEditorCommand = (view) => wrapSelection(view, '`', '`', 'code');
export const insertHeading: NotesEditorCommand = (view) => insertLinePrefix(view, '## ');
export const insertQuote: NotesEditorCommand = (view) => insertLinePrefix(view, '> ');
export const insertList: NotesEditorCommand = (view) => insertLinePrefix(view, '- ');
export const insertChecklist: NotesEditorCommand = (view) => insertLinePrefix(view, '- [ ] ');

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
