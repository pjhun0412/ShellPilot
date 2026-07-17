import { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { NotesEditorToolbar } from './NotesEditorToolbar';
import { NotesMarkdownEditor, type NotesEditorScrollState } from './NotesMarkdownEditor';
import { NotesPanelHeader } from './NotesPanelHeader';
import { type NotesEditorCommand } from './notesEditorCommands';
import { readNote, updateNote } from './notesBridge';
import type { NoteMeta, NoteViewMode } from './notesTypes';

type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function NotesPanel({ noteId }: { noteId?: string }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string>();
  const [meta, setMeta] = useState<NoteMeta>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [viewMode, setViewMode] = useState<NoteViewMode>('live');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
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

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <NotesPanelHeader
        meta={meta}
        showLineNumbers={showLineNumbers}
        viewMode={viewMode}
        onChangeViewMode={changeViewMode}
        onToggleLineNumbers={() => setShowLineNumbers((current) => !current)}
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
            editorRef={editorRef}
            previewScrollRef={previewScrollRef}
            scrollStateRef={scrollStateRef}
            showLineNumbers={showLineNumbers}
            viewMode={viewMode}
            onBlur={() => void flushSave()}
            onChange={(value) => {
              setContent(value);
              scheduleSave(value);
            }}
          />
        )}

        {error && (
          <div className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
