import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { convertFileSrc } from '@tauri-apps/api/core';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import MarkdownPreview from '@uiw/react-markdown-preview';
import '@uiw/react-markdown-preview/markdown.css';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { cn } from '@/lib/utils';

import { insertBold, insertItalic, insertLink } from './notesEditorCommands';
import { createCodeMirrorTheme, markdownHighlightExtension, type NotesEditorThemeOptions } from './notesEditorTheme';
import { createWikiLinkPreviewSource, readWikiLinkPreviewTarget } from './notesLinkUtils';
import { createWikiLinkCompletion } from './notesWikiCompletion';
import type { NoteNavigationRequest } from './notesNavigation';
import type { NoteAsset, NoteMeta, NoteViewMode } from './notesTypes';

export interface NotesEditorScrollState {
  editorTop: number;
  previewTop: number;
}

export function NotesMarkdownEditor({
  assetBaseDir,
  content,
  editorTheme,
  editorRef,
  onBlur,
  onChange,
  navigationTarget,
  notes,
  previewScrollRef,
  scrollStateRef,
  showLineNumbers,
  viewMode,
  onSaveImageAsset,
  onOpenExternalUrl,
  onOpenWikiLink,
}: {
  assetBaseDir: string;
  content: string;
  editorTheme: NotesEditorThemeOptions;
  editorRef: React.RefObject<ReactCodeMirrorRef>;
  onBlur: () => void;
  onChange: (value: string) => void;
  navigationTarget?: NoteNavigationRequest;
  notes: NoteMeta[];
  previewScrollRef: React.RefObject<HTMLDivElement>;
  scrollStateRef: React.MutableRefObject<NotesEditorScrollState>;
  showLineNumbers: boolean;
  viewMode: NoteViewMode;
  onSaveImageAsset: (file: File, data: number[]) => Promise<NoteAsset>;
  onOpenExternalUrl: (url: string) => void;
  onOpenWikiLink: (target: string) => void;
}) {
  const previousViewModeRef = useRef(viewMode);
  const codeMirrorTheme = useMemo(() => createCodeMirrorTheme(editorTheme), [editorTheme]);
  const wikiLinkCompletion = useMemo(() => createWikiLinkCompletion(notes), [notes]);
  const editorKeymap = useMemo(
    () =>
      keymap.of([
        { key: 'Mod-b', run: insertBold },
        { key: 'Mod-i', run: insertItalic },
        { key: 'Mod-k', run: insertLink },
      ]),
    [],
  );
  const assetHandler = useMemo(
    () =>
      EditorView.domEventHandlers({
        drop: (event, view) => {
          const files = getDroppedFiles(event.dataTransfer?.files);

          if (files.length === 0) {
            return false;
          }

          event.preventDefault();

          const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position !== null) {
            view.dispatch({
              selection: EditorSelection.cursor(position),
            });
          }

          void insertFileAssets(view, files, onSaveImageAsset);

          return true;
        },
        paste: (event, view) => {
          const files = getDroppedFiles(event.clipboardData?.files);

          if (files.length === 0) {
            return false;
          }

          event.preventDefault();
          void insertFileAssets(view, files, onSaveImageAsset);

          return true;
        },
      }),
    [onSaveImageAsset],
  );

  useEffect(() => {
    const view = editorRef.current?.view;
    const scrollElement = view?.scrollDOM;

    if (!scrollElement) {
      return undefined;
    }

    const handleScroll = () => {
      scrollStateRef.current.editorTop = scrollElement.scrollTop;
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [editorRef, scrollStateRef, viewMode]);

  useEffect(() => {
    const previewElement = previewScrollRef.current;

    if (!previewElement) {
      return undefined;
    }

    const handleScroll = () => {
      scrollStateRef.current.previewTop = previewElement.scrollTop;
    };

    previewElement.addEventListener('scroll', handleScroll, { passive: true });

    return () => previewElement.removeEventListener('scroll', handleScroll);
  }, [previewScrollRef, scrollStateRef, viewMode]);

  useEffect(() => {
    if (previousViewModeRef.current === viewMode) {
      return;
    }

    previousViewModeRef.current = viewMode;

    window.requestAnimationFrame(() => {
      const editorScroll = editorRef.current?.view?.scrollDOM;
      const previewScroll = previewScrollRef.current;

      if (viewMode !== 'preview' && editorScroll) {
        editorScroll.scrollTop = scrollStateRef.current.editorTop;
      }

      if (viewMode !== 'edit' && previewScroll) {
        previewScroll.scrollTop = scrollStateRef.current.previewTop;
      }
    });
  }, [editorRef, previewScrollRef, scrollStateRef, viewMode]);

  useEffect(() => {
    if (!navigationTarget || viewMode === 'preview') {
      return;
    }

    window.requestAnimationFrame(() => {
      const view = editorRef.current?.view;

      if (!view) {
        return;
      }

      const range = resolveNavigationRange(view, navigationTarget);

      view.dispatch({
        selection: EditorSelection.range(range.from, range.to),
        scrollIntoView: true,
      });
      view.focus();
    });
  }, [editorRef, navigationTarget, viewMode]);

  const previewSource = useMemo(() => createWikiLinkPreviewSource(content), [content]);

  return (
    <div
      className={cn(
        'notes-editor-frame grid min-h-0 bg-background',
        viewMode === 'live' ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1',
      )}
    >
      {viewMode !== 'preview' && (
        <div className="group/editor-scroll relative min-h-0 overflow-hidden">
          <CodeMirror
            ref={editorRef}
            basicSetup={{
              lineNumbers: showLineNumbers,
              drawSelection: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
            }}
            className="notes-codemirror"
            extensions={[
              markdown(),
              markdownHighlightExtension,
              codeMirrorTheme,
              EditorView.lineWrapping,
              wikiLinkCompletion,
              editorKeymap,
            assetHandler,
            ]}
            height="100%"
            indentWithTab
            placeholder="Write Markdown notes..."
            theme="none"
            value={content}
            onBlur={onBlur}
            onChange={onChange}
          />
          <NotesCodeMirrorScrollbar editorRef={editorRef} />
        </div>
      )}

      {viewMode !== 'edit' && (
        <OverlayScrollArea
          ref={previewScrollRef}
          className="notes-markdown-preview"
          onClick={(event) => {
            const link = (event.target as HTMLElement).closest('a');
            const href = link?.getAttribute('href');

            if (!href) {
              return;
            }

            const target = readWikiLinkPreviewTarget(href);

            event.preventDefault();
            event.stopPropagation();

            if (target) {
              onOpenWikiLink(target);
              return;
            }

            if (isHttpUrl(href)) {
              onOpenExternalUrl(href);
            }
          }}
        >
          <MarkdownPreview
            className="notes-markdown-preview-body"
            source={previewSource}
            urlTransform={(url) => resolveNotePreviewUrl(url, assetBaseDir)}
            wrapperElement={{ 'data-color-mode': 'dark' }}
          />
        </OverlayScrollArea>
      )}
    </div>
  );
}

const notesScrollbarInset = 12;
const notesScrollbarMinThumbSize = 32;

function NotesCodeMirrorScrollbar({ editorRef }: { editorRef: React.RefObject<ReactCodeMirrorRef> }) {
  const dragRef = useRef<
    | {
        pointerStart: number;
        scrollStart: number;
      }
    | undefined
  >();
  const [thumb, setThumb] = useState({
    height: 0,
    top: 0,
    visible: false,
  });

  const getScrollElement = useCallback(() => editorRef.current?.view?.scrollDOM, [editorRef]);

  const syncThumb = useCallback(() => {
    const element = getScrollElement();

    if (!element) {
      setThumb({ height: 0, top: 0, visible: false });
      return;
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight;

    if (maxScrollTop <= 0) {
      setThumb({ height: 0, top: 0, visible: false });
      return;
    }

    const trackHeight = Math.max(notesScrollbarMinThumbSize, element.clientHeight - notesScrollbarInset * 2);
    const height = Math.max(
      notesScrollbarMinThumbSize,
      Math.round((element.clientHeight / element.scrollHeight) * trackHeight),
    );
    const top = Math.round((element.scrollTop / maxScrollTop) * (trackHeight - height));

    setThumb({ height, top, visible: true });
  }, [getScrollElement]);

  useEffect(() => {
    let resizeObserver: ResizeObserver | undefined;
    let animationFrame = 0;

    const attach = () => {
      const element = getScrollElement();

      if (!element) {
        animationFrame = window.requestAnimationFrame(attach);
        return;
      }

      element.addEventListener('scroll', syncThumb, { passive: true });
      resizeObserver = new ResizeObserver(syncThumb);
      resizeObserver.observe(element);
      if (element.firstElementChild) {
        resizeObserver.observe(element.firstElementChild);
      }
      syncThumb();
    };

    animationFrame = window.requestAnimationFrame(attach);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      getScrollElement()?.removeEventListener('scroll', syncThumb);
    };
  }, [getScrollElement, syncThumb]);

  const startThumbDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = getScrollElement();

    if (!element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerStart: event.clientY,
      scrollStart: element.scrollTop,
    };
  };

  const handleThumbDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = getScrollElement();

    if (!drag || !element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const maxScrollTop = element.scrollHeight - element.clientHeight;
    const trackHeight = Math.max(notesScrollbarMinThumbSize, element.clientHeight - notesScrollbarInset * 2);
    const travel = Math.max(1, trackHeight - thumb.height);
    const delta = event.clientY - drag.pointerStart;

    element.scrollTop = drag.scrollStart + (delta / travel) * maxScrollTop;
    syncThumb();
  };

  const stopThumbDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragRef.current = undefined;
  };

  if (!thumb.visible) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-0.5 top-3 z-10 w-1.5 opacity-0 transition-opacity duration-200 group-hover/editor-scroll:opacity-100">
      <div
        className="pointer-events-auto absolute right-0 w-1 cursor-grab touch-none rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200 hover:bg-[hsl(var(--scrollbar-thumb-hover)_/_0.9)] active:cursor-grabbing"
        style={{ height: thumb.height, top: thumb.top }}
        onPointerDown={startThumbDrag}
        onPointerMove={handleThumbDrag}
        onPointerUp={stopThumbDrag}
        onPointerCancel={stopThumbDrag}
      />
    </div>
  );
}

async function insertFileAssets(
  view: EditorView,
  files: File[],
  onSaveImageAsset: (file: File, data: number[]) => Promise<NoteAsset>,
) {
  const inserted = new Array<string>();

  for (const file of files) {
    const data = await readFileBytes(file);
    const asset = await onSaveImageAsset(file, data);
    inserted.push(asset.markdownPath);
  }

  insertMarkdownBlock(view, inserted.join('\n'));
}

function insertMarkdownBlock(view: EditorView, markdown: string) {
  const selection = view.state.selection.main;
  const before = view.state.doc.sliceString(Math.max(0, selection.from - 1), selection.from);
  const after = view.state.doc.sliceString(selection.to, Math.min(view.state.doc.length, selection.to + 1));
  const prefix = selection.from > 0 && before !== '\n' ? '\n\n' : '';
  const suffix = selection.to < view.state.doc.length && after !== '\n' ? '\n\n' : '\n';
  const insert = `${prefix}${markdown}${suffix}`;

  view.dispatch({
    changes: { from: selection.from, insert, to: selection.to },
    selection: EditorSelection.cursor(selection.from + insert.length),
    scrollIntoView: true,
  });
  view.focus();
}

function getDroppedFiles(fileList?: FileList | null) {
  if (!fileList) {
    return [];
  }

  return Array.from(fileList).filter((file) => file.size > 0);
}

async function readFileBytes(file: File) {
  return Array.from(new Uint8Array(await file.arrayBuffer()));
}

function resolveNotePreviewUrl(url: string, assetBaseDir: string) {
  if (!assetBaseDir || isExternalUrl(url)) {
    return url;
  }

  const normalizedUrl = url.replace(/\\/g, '/');
  const match = normalizedUrl.match(/(?:^|\/)assets\/note-[A-Za-z0-9-]+\/([^/?#]+)/);

  if (!match) {
    return url;
  }

  const fileName = decodeURIComponent(match[1]);
  const separator = assetBaseDir.includes('\\') ? '\\' : '/';

  return convertFileSrc(`${assetBaseDir}${separator}${fileName}`);
}

function isExternalUrl(url: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url);
}

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function resolveNavigationRange(view: EditorView, navigation: NoteNavigationRequest) {
  const query = navigation.query?.trim().toLowerCase();
  const doc = view.state.doc;

  if (navigation.lineNumber && navigation.lineNumber <= doc.lines) {
    const line = doc.line(navigation.lineNumber);
    const match = findQueryInText(line.text, query);

    if (match) {
      return { from: line.from + match.from, to: line.from + match.to };
    }

    return { from: line.from, to: line.from };
  }

  if (query) {
    const content = doc.toString();
    const matchIndex = content.toLowerCase().indexOf(query);

    if (matchIndex >= 0) {
      return { from: matchIndex, to: matchIndex + query.length };
    }
  }

  return { from: 0, to: 0 };
}

function findQueryInText(text: string, query?: string) {
  if (!query) {
    return undefined;
  }

  const matchIndex = text.toLowerCase().indexOf(query);

  if (matchIndex < 0) {
    return undefined;
  }

  return {
    from: matchIndex,
    to: matchIndex + query.length,
  };
}
