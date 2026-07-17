import type { NoteMeta } from './notesTypes';

export interface NoteNavigationRequest {
  lineNumber?: number;
  noteId: string;
  query?: string;
  requestId: number;
}

export const notesNavigationEventName = 'shellpilot.notes.navigate';
export const notesChangedEventName = 'shellpilot.notes.changed';
export const notesMetaChangedEventName = 'shellpilot.notes.meta.changed';

export function dispatchNoteNavigation(request: Omit<NoteNavigationRequest, 'requestId'>) {
  const detail: NoteNavigationRequest = {
    ...request,
    requestId: Date.now(),
  };

  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<NoteNavigationRequest>(notesNavigationEventName, { detail }));
  }, 0);
}

export function subscribeNoteNavigation(handler: (request: NoteNavigationRequest) => void) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<NoteNavigationRequest>).detail);
  };

  window.addEventListener(notesNavigationEventName, listener);

  return () => window.removeEventListener(notesNavigationEventName, listener);
}

export function dispatchNotesChanged() {
  window.dispatchEvent(new Event(notesChangedEventName));
}

export function subscribeNotesChanged(handler: () => void) {
  window.addEventListener(notesChangedEventName, handler);

  return () => window.removeEventListener(notesChangedEventName, handler);
}

export function dispatchNotesMetaChanged(notes: NoteMeta | NoteMeta[]) {
  const changedNotes = Array.isArray(notes) ? notes : [notes];

  if (changedNotes.length === 0) {
    return;
  }

  window.dispatchEvent(new CustomEvent<NoteMeta[]>(notesMetaChangedEventName, { detail: changedNotes }));
}

export function subscribeNotesMetaChanged(handler: (notes: NoteMeta[]) => void) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<NoteMeta[]>).detail);
  };

  window.addEventListener(notesMetaChangedEventName, listener);

  return () => window.removeEventListener(notesMetaChangedEventName, listener);
}
