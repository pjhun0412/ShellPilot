import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { NoteMeta } from './notesTypes';

export function createWikiLinkCompletion(notes: NoteMeta[]) {
  return autocompletion({
    activateOnTyping: true,
    override: [(context) => completeWikiLink(context, notes)],
  });
}

function completeWikiLink(context: CompletionContext, notes: NoteMeta[]) {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const match = beforeCursor.match(/\[\[([^\]\n]*)$/);

  if (!match) {
    return null;
  }

  const query = match[1].trim().toLowerCase();
  const from = context.pos - match[1].length;
  const options = createWikiLinkOptions(notes, query);

  if (options.length === 0 && !context.explicit) {
    return null;
  }

  return {
    from,
    options,
    validFor: /^[^\]\n]*$/,
  };
}

function createWikiLinkOptions(notes: NoteMeta[], query: string): Completion[] {
  return notes
    .filter((note) => {
      const haystack = `${note.title} ${note.path}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort((left, right) => rankNote(left, query) - rankNote(right, query) || left.path.localeCompare(right.path))
    .slice(0, 30)
    .map((note) => ({
      apply: (view, _completion, from, to) => applyWikiLinkCompletion(view, note.path, from, to),
      detail: note.path === note.title ? undefined : note.path,
      displayLabel: note.title,
      label: note.path,
      type: 'text',
    }));
}

function applyWikiLinkCompletion(view: EditorView, path: string, from: number, to: number) {
  const afterSelection = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + 2));
  const replaceTo = afterSelection === ']]' ? to + 2 : to;
  const insert = `${path}]]`;

  view.dispatch({
    changes: { from, insert, to: replaceTo },
    selection: EditorSelection.cursor(from + insert.length),
  });
}

function rankNote(note: NoteMeta, query: string) {
  if (!query) {
    return 2;
  }

  const title = note.title.toLowerCase();
  const path = note.path.toLowerCase();

  if (title === query || path === query) {
    return 0;
  }

  if (title.startsWith(query) || path.startsWith(query)) {
    return 1;
  }

  return 2;
}
