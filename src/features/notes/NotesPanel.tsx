import { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { loadPreferences, subscribePreferences, updatePreferences } from '@/features/settings/appPreferences';
import { cn } from '@/lib/utils';

import { NotesEditorToolbar } from './NotesEditorToolbar';
import { NotesLinkPanel } from './NotesLinkPanel';
import { NotesMarkdownEditor, type NotesEditorScrollState } from './NotesMarkdownEditor';
import { NotesPanelHeader } from './NotesPanelHeader';
import { type NotesEditorCommand } from './notesEditorCommands';
import {
  findHeadingLineNumber,
  resolveNoteLinkTarget,
  resolveNoteLinkTargetState,
  resolveNoteLinks,
  splitNoteLinkTarget,
  type ResolvedNoteLink,
} from './notesLinkUtils';
import {
  dispatchNoteOpen,
  dispatchNotesChanged,
  subscribeNoteNavigation,
  subscribeNotesMetaChanged,
  subscribeNotesChanged,
  type NoteNavigationRequest,
} from './notesNavigation';
import { createNote, listNotes, readNote, saveNoteAsset, updateNote } from './notesBridge';
import type { NoteHeading, NoteLink, NoteMention, NoteMeta, NoteViewMode } from './notesTypes';

type SaveStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

export function NotesPanel({ noteId }: { noteId?: string }) {
  const [content, setContent] = useState('');
  const [assetBaseDir, setAssetBaseDir] = useState('');
  const [error, setError] = useState<string>();
  const [headings, setHeadings] = useState<NoteHeading[]>([]);
  const [links, setLinks] = useState<NoteLink[]>([]);
  const [mentions, setMentions] = useState<NoteMention[]>([]);
  const [meta, setMeta] = useState<NoteMeta>();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
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
  const resolvedOutgoingLinks = useMemo(
    () => (noteId ? resolveNoteLinks(links.filter((link) => link.sourceId === noteId), notes, headings) : []),
    [headings, links, noteId, notes],
  );
  const resolvedBacklinks = useMemo(() => {
    if (!noteId) {
      return [];
    }

    return resolveNoteLinks(
      links.filter((link) => link.sourceId !== noteId && resolveNoteLinkTarget(link.target, notes)?.id === noteId),
      notes,
      headings,
    )
      .reduce<ResolvedNoteLink[]>((backlinks, link) => {
        const sourceNote = notes.find((note) => note.id === link.sourceId);

        if (sourceNote) {
          backlinks.push({
            ...link,
            matchCount: 1,
            resolvedNote: sourceNote,
            status: 'resolved',
          });
        }

        return backlinks;
      }, []);
  }, [headings, links, noteId, notes]);
  const unlinkedMentions = useMemo(() => {
    if (!noteId) {
      return [];
    }

    return mentions
      .filter((mention) => mention.targetId === noteId)
      .map((mention) => ({
        ...mention,
        sourceNote: notes.find((note) => note.id === mention.sourceId),
      }))
      .filter((mention) => mention.sourceNote);
  }, [mentions, noteId, notes]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => subscribePreferences(setPreferences), []);

  useEffect(() => {
    const refreshLinkIndex = () => {
      void listNotes()
        .then((result) => {
          setHeadings(result.headings ?? []);
          setLinks(result.links ?? []);
          setMentions(result.mentions ?? []);
          setNotes(result.notes);
        })
        .catch((caught) => setError(formatError(caught)));
    };

    refreshLinkIndex();

    return subscribeNotesChanged(refreshLinkIndex);
  }, []);

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

  const openResolvedLink = (link: ResolvedNoteLink) => {
    if (!link.resolvedNote) {
      return;
    }

    dispatchNoteOpen({
      lineNumber: link.headingLineNumber ?? link.lineNumber,
      noteId: link.resolvedNote.id,
      title: link.resolvedNote.title,
    });
  };

  const openWikiLinkTarget = async (target: string) => {
    const normalizedTarget = target.trim();
    const parsedTarget = splitNoteLinkTarget(normalizedTarget);

    if (!normalizedTarget) {
      return;
    }

    const resolved = resolveNoteLinkTargetState(normalizedTarget, notes);

    if (resolved.status === 'ambiguous') {
      setError(`Note link is ambiguous: ${normalizedTarget}. Use [[folder/note]] to disambiguate.`);
      return;
    }

    if (!resolved.note) {
      try {
        const created = await createNote(parsedTarget.target || normalizedTarget);
        setNotes((current) => [...current, created.meta]);
        setError(undefined);
        dispatchNotesChanged();
        dispatchNoteOpen({
          noteId: created.meta.id,
          title: created.meta.title,
        });
      } catch (caught) {
        setError(formatError(caught));
      }
      return;
    }

    dispatchNoteOpen({
      lineNumber:
        resolved.note && parsedTarget.heading
          ? findHeadingLineNumber(resolved.note.id, parsedTarget.heading, headings)
          : undefined,
      noteId: resolved.note.id,
      title: resolved.note.title,
    });
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
          viewMode === 'preview'
            ? 'grid-rows-[minmax(0,1fr)_auto_auto]'
            : 'grid-rows-[auto_minmax(0,1fr)_auto_auto]',
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
            notes={notes}
            scrollStateRef={scrollStateRef}
            showLineNumbers={showLineNumbers}
            viewMode={viewMode}
            onBlur={() => void flushSave()}
            onChange={(value) => {
              setContent(value);
              scheduleSave(value);
            }}
            onOpenWikiLink={(target) => void openWikiLinkTarget(target)}
            onSaveImageAsset={saveImageAsset}
          />
        )}

        <NotesLinkPanel
          backlinks={resolvedBacklinks}
          outgoingLinks={resolvedOutgoingLinks}
          unlinkedMentions={unlinkedMentions}
          onOpenLink={openResolvedLink}
          onOpenMention={(mention) => {
            if (!mention.sourceNote) {
              return;
            }

            dispatchNoteOpen({
              lineNumber: mention.lineNumber,
              noteId: mention.sourceNote.id,
              query: meta?.title,
              title: mention.sourceNote.title,
            });
          }}
        />

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
