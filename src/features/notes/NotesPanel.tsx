import { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { loadPreferences, subscribePreferences, updatePreferences } from '@/features/settings/appPreferences';
import { cn } from '@/lib/utils';

import { NotesEditorToolbar } from './NotesEditorToolbar';
import { NotesMarkdownEditor, type NotesEditorScrollState } from './NotesMarkdownEditor';
import { NotesPanelHeader } from './NotesPanelHeader';
import { type NotesEditorCommand } from './notesEditorCommands';
import {
  dispatchNotesChanged,
  subscribeNoteNavigation,
  subscribeNotesMetaChanged,
  type NoteNavigationRequest,
} from './notesNavigation';
import { readNote, saveNoteAsset, updateNote } from './notesBridge';
import type { NoteMeta, NoteViewMode } from './notesTypes';

type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function NotesPanel({ noteId }: { noteId?: string }) {
  const [content, setContent] = useState('');
  const [assetBaseDir, setAssetBaseDir] = useState('');
  const [error, setError] = useState<string>();
  const [meta, setMeta] = useState<NoteMeta>();
  const [preferences, setPreferences] = useState(() => loadPreferences());
  const [navigationTarget, setNavigationTarget] = useState<NoteNavigationRequest>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [viewMode, setViewMode] = useState<NoteViewMode>('live');
  const [showLineNumbers, setShowLineNumbers] = useState(() => preferences.notes.editor.showLineNumbers);
  const contentRef = useRef('');
  const dirtyRef = useRef(false);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const mountedRef = useRef(true);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number>();
  const scrollStateRef = useRef<NotesEditorScrollState>({ editorTop: 0, previewTop: 0 });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => subscribePreferences(setPreferences), []);

  useEffect(() => {
    if (!noteId) {
      return undefined;
    }

    return subscribeNoteNavigation((request) => {
      if (request.noteId !== noteId) {
        return;
      }

      captureScrollPositions();
      window.setTimeout(() => setNavigationTarget(request), 0);
    });
  }, [noteId]);

  useEffect(() => {
    if (!noteId) {
      return undefined;
    }

    return subscribeNotesMetaChanged((notes) => {
      const updatedNote = notes.find((note) => note.id === noteId);

      if (updatedNote) {
        setMeta(updatedNote);
      }
    });
  }, [noteId]);

  useEffect(() => {
    setShowLineNumbers(preferences.notes.editor.showLineNumbers);
  }, [preferences.notes.editor.showLineNumbers]);

  useEffect(() => {
    if (!noteId) {
      setError('Missing note id.');
      setSaveStatus('error');
      return;
    }

    let isCanceled = false;
    setError(undefined);
    setSaveStatus('loading');

    void readNote(noteId)
      .then((document) => {
        if (isCanceled) {
          return;
        }

        contentRef.current = document.content;
        dirtyRef.current = false;
        scrollStateRef.current = { editorTop: 0, previewTop: 0 };
        setAssetBaseDir(document.assetBaseDir);
        setContent(document.content);
        setMeta(document.meta);
        setSaveStatus('idle');
      })
      .catch((caught) => {
        if (isCanceled) {
          return;
        }

        setError(formatError(caught));
        setSaveStatus('error');
      });

    return () => {
      isCanceled = true;
    };
  }, [noteId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }

      if (noteId && dirtyRef.current) {
        void updateNote(noteId, contentRef.current);
        dirtyRef.current = false;
      }
    };
  }, [noteId]);

  const captureScrollPositions = () => {
    const editorScroll = editorRef.current?.view?.scrollDOM;
    const previewScroll = previewScrollRef.current;

    if (editorScroll) {
      scrollStateRef.current.editorTop = editorScroll.scrollTop;
    }

    if (previewScroll) {
      scrollStateRef.current.previewTop = previewScroll.scrollTop;
    }
  };

  const scheduleSave = (nextContent: string) => {
    contentRef.current = nextContent;
    dirtyRef.current = true;
    setSaveStatus('saving');
    setError(undefined);

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 700);
  };

  const flushSave = async () => {
    if (!noteId || !dirtyRef.current) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }

    const pendingContent = contentRef.current;
    dirtyRef.current = false;
    setSaveStatus('saving');

    try {
      const updatedMeta = await updateNote(noteId, pendingContent);

      if (!mountedRef.current) {
        return;
      }

      setMeta(updatedMeta);
      setSaveStatus('idle');
      dispatchNotesChanged();
    } catch (caught) {
      dirtyRef.current = true;
      if (!mountedRef.current) {
        return;
      }

      setError(formatError(caught));
      setSaveStatus('error');
    }
  };

  const changeViewMode = (nextViewMode: NoteViewMode) => {
    captureScrollPositions();

    if (nextViewMode === 'preview') {
      void flushSave();
    }

    setViewMode(nextViewMode);
  };

  const runEditorCommand = (command: NotesEditorCommand) => {
    const view = editorRef.current?.view;

    if (!view) {
      return;
    }

    command(view);
  };

  const saveImageAsset = async (file: File, data: number[]) => {
    if (!noteId) {
      throw new Error('Missing note id.');
    }

    return saveNoteAsset(noteId, file, data);
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <NotesPanelHeader
        meta={meta}
        showLineNumbers={showLineNumbers}
        viewMode={viewMode}
        onChangeViewMode={changeViewMode}
        onToggleLineNumbers={() =>
          setShowLineNumbers((current) => {
            const next = !current;

            updatePreferences((preferences) => ({
              ...preferences,
              notes: {
                ...preferences.notes,
                editor: {
                  ...preferences.notes.editor,
                  showLineNumbers: next,
                },
              },
            }));

            return next;
          })
        }
      />

      <div
        className={cn(
          'grid min-h-0',
          viewMode === 'preview' ? 'grid-rows-[minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)_auto]',
        )}
      >
        {viewMode !== 'preview' && <NotesEditorToolbar onCommand={runEditorCommand} />}

        {saveStatus === 'loading' ? (
          <div className="grid place-items-center text-sm text-muted-foreground">Loading note...</div>
        ) : (
          <NotesMarkdownEditor
            content={content}
            assetBaseDir={assetBaseDir}
            editorTheme={preferences.notes.editor}
            editorRef={editorRef}
            previewScrollRef={previewScrollRef}
            navigationTarget={navigationTarget}
            scrollStateRef={scrollStateRef}
            showLineNumbers={showLineNumbers}
            viewMode={viewMode}
            onBlur={() => void flushSave()}
            onChange={(value) => {
              setContent(value);
              scheduleSave(value);
            }}
            onSaveImageAsset={saveImageAsset}
          />
        )}

        {error && (
          <div className="flex items-start gap-2 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <span className="min-w-0 flex-1">{error}</span>
            <button
              className="rounded p-0.5 text-destructive/80 transition hover:bg-destructive/10 hover:text-destructive"
              type="button"
              aria-label="Dismiss note error"
              onClick={() => setError(undefined)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
