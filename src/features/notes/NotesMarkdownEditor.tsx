import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import MarkdownPreview from '@uiw/react-markdown-preview';
import '@uiw/react-markdown-preview/markdown.css';
import { useEffect, useMemo, useRef } from 'react';

import { cn } from '@/lib/utils';

import { insertBold, insertItalic, insertLink } from './notesEditorCommands';
import { codeMirrorTheme, markdownHighlightExtension } from './notesEditorTheme';
import type { NoteViewMode } from './notesTypes';

export interface NotesEditorScrollState {
  editorTop: number;
  previewTop: number;
}

export function NotesMarkdownEditor({
  content,
  editorRef,
  onBlur,
  onChange,
  previewScrollRef,
  scrollStateRef,
  showLineNumbers,
  viewMode,
}: {
  content: string;
  editorRef: React.RefObject<ReactCodeMirrorRef>;
  onBlur: () => void;
  onChange: (value: string) => void;
  previewScrollRef: React.RefObject<HTMLDivElement>;
  scrollStateRef: React.MutableRefObject<NotesEditorScrollState>;
  showLineNumbers: boolean;
  viewMode: NoteViewMode;
}) {
  const previousViewModeRef = useRef(viewMode);
  const editorKeymap = useMemo(
    () =>
      keymap.of([
        { key: 'Mod-b', run: insertBold },
        { key: 'Mod-i', run: insertItalic },
        { key: 'Mod-k', run: insertLink },
      ]),
    [],
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

  return (
    <div
      className={cn(
        'notes-editor-frame grid min-h-0 bg-background',
        viewMode === 'live' ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1',
      )}
    >
      {viewMode !== 'preview' && (
        <CodeMirror
          ref={editorRef}
          basicSetup={{
            lineNumbers: showLineNumbers,
            drawSelection: false,
            foldGutter: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
          }}
          className="notes-codemirror app-scrollbar"
          extensions={[markdown(), markdownHighlightExtension, codeMirrorTheme, EditorView.lineWrapping, editorKeymap]}
          height="100%"
          indentWithTab
          placeholder="Write Markdown notes..."
          theme="none"
          value={content}
          onBlur={onBlur}
          onChange={onChange}
        />
      )}

      {viewMode !== 'edit' && (
        <div ref={previewScrollRef} className="notes-markdown-preview app-scrollbar">
          <MarkdownPreview className="notes-markdown-preview-body" source={content} wrapperElement={{ 'data-color-mode': 'dark' }} />
        </div>
      )}
    </div>
  );
}
