export interface NoteNavigationRequest {
  lineNumber?: number;
  noteId: string;
  query?: string;
  requestId: number;
}

export const notesNavigationEventName = 'shellpilot.notes.navigate';

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
