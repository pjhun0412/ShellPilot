import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const codeMirrorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'hsl(var(--background))',
      color: '#d4d4d4',
      fontSize: '14px',
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      lineHeight: '1.64',
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: '#ffffff',
      padding: '16px 0 20px',
    },
    '.cm-line': {
      padding: '0 20px',
    },
    '.cm-gutters': {
      backgroundColor: 'hsl(var(--background))',
      borderRight: '1px solid hsl(var(--border) / 0.72)',
      color: '#858585',
      paddingRight: '4px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '2.35rem',
      padding: '0 10px 0 12px',
    },
    '.cm-activeLine': {
      backgroundColor: 'hsl(var(--card) / 0.56)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(var(--card) / 0.56)',
      color: '#c6c6c6',
    },
    '& ::selection, .cm-content ::selection': {
      backgroundColor: '#264f78 !important',
      color: '#ffffff !important',
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
      backgroundColor: '#3a3d41',
      color: '#d4d4d4',
    },
  },
  { dark: true },
);

export const markdownHighlightExtension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: '#569cd6', fontWeight: '600' },
    { tag: tags.strong, color: '#d4d4d4', fontWeight: '700' },
    { tag: tags.emphasis, color: '#d4d4d4', fontStyle: 'italic' },
    { tag: tags.link, color: '#d4d4d4' },
    { tag: tags.url, color: '#4fc1ff' },
    { tag: tags.quote, color: '#6a9955' },
    { tag: tags.monospace, color: '#ce9178' },
    { tag: [tags.meta, tags.processingInstruction, tags.contentSeparator], color: '#808080' },
  ]),
);
