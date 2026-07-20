import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export interface NotesEditorThemeOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export function createCodeMirrorTheme({ fontFamily, fontSize, lineHeight }: NotesEditorThemeOptions) {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: '#0d1117',
      color: '#c9d1d9',
      fontSize: `${fontSize}px`,
    },
    '.cm-scroller': {
      fontFamily,
      lineHeight: String(lineHeight),
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: '#ffffff',
      padding: '18px 0 24px',
    },
    '.cm-line': {
      padding: '0 22px',
    },
    '.cm-gutters': {
      backgroundColor: '#0d1117',
      borderRight: '1px solid #30363d',
      color: '#6e7681',
      paddingRight: '4px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '2.35rem',
      padding: '0 10px 0 12px',
    },
    '.cm-activeLine': {
      backgroundColor: '#161b22',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#161b22',
      color: '#8b949e',
    },
    '& ::selection, .cm-content ::selection': {
      backgroundColor: '#264f78 !important',
      color: '#ffffff !important',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(156, 111, 0, 0.45) !important',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(156, 111, 0, 0.52) !important',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'rgba(202, 138, 4, 0.64) !important',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor': {
      borderLeftColor: '#ffffff',
    },
    '.cm-placeholder': {
      color: '#858585',
    },
    '.cm-matchingBracket': {
      backgroundColor: '#30363d',
      color: '#c9d1d9',
    },
  }, { dark: true });
}

export const markdownHighlightExtension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: '#79c0ff', fontWeight: '600' },
    { tag: tags.strong, color: '#c9d1d9', fontWeight: '700' },
    { tag: tags.emphasis, color: '#c9d1d9', fontStyle: 'italic' },
    { tag: tags.link, color: '#c9d1d9' },
    { tag: tags.url, color: '#58a6ff' },
    { tag: tags.quote, color: '#8b949e' },
    { tag: tags.monospace, color: '#a5d6ff' },
    { tag: [tags.meta, tags.processingInstruction, tags.contentSeparator], color: '#6e7681' },
  ]),
);
