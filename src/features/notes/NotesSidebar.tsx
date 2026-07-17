import { ChevronDown, ChevronRight, FileText, Folder, FolderPlus, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkspacePanel } from '@/types/workspace';

import {
  createNote,
  createNoteFolder,
  deleteNote,
  deleteNoteFolder,
  listNotes,
  renameNote,
  renameNoteFolder,
  searchNotes,
} from './notesBridge';
import { dispatchNoteNavigation } from './notesNavigation';
import type { NoteFolderMeta, NoteMeta, NoteSearchResultItem } from './notesTypes';

type NoteTreeNode =
  | {
      children: NoteTreeNode[];
      key: string;
      name: string;
      path: string;
      type: 'folder';
    }
  | {
      key: string;
      note: NoteMeta;
      searchResult?: NoteSearchResultItem;
      type: 'note';
    };

type NoteDragPayload =
  | {
      path: string;
      type: 'folder';
    }
  | {
      id: string;
      path: string;
      title: string;
      type: 'note';
    };

const noteDragMimeType = 'application/x-shellpilot-note-tree-item';

type PendingTreeInput =
  | {
      folderPath: string;
      kind: 'rename-folder';
      value: string;
    }
  | {
      kind: 'rename-note';
      note: NoteMeta;
      value: string;
    };

export function NotesSidebar({
  onAddPanel,
  onClosePanel,
}: {
  onAddPanel: (panel: WorkspacePanel) => void;
  onClosePanel: (panelId: string) => void;
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [folders, setFolders] = useState<NoteFolderMeta[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NoteSearchResultItem[]>([]);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string>();
  const [pendingInput, setPendingInput] = useState<PendingTreeInput>();

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    if (!keyword) {
      return { folders, notes };
    }

    if (searchResults.length > 0) {
      return {
        folders: folders.filter((folder) => folder.path.toLowerCase().includes(keyword)),
        notes: searchResults.map((result) => result.note),
      };
    }

    return {
      folders: folders.filter((folder) => folder.path.toLowerCase().includes(keyword)),
      notes: notes.filter((note) => [note.title, note.path, ...note.tags].join(' ').toLowerCase().includes(keyword)),
    };
  }, [folders, notes, query, searchResults]);
  const searchResultByNoteId = useMemo(
    () => new Map(searchResults.map((result) => [result.note.id, result])),
    [searchResults],
  );
  const noteTree = useMemo(
    () => buildNoteTree(filtered.folders, filtered.notes, searchResultByNoteId),
    [filtered, searchResultByNoteId],
  );
  const isFiltering = query.trim().length > 0;

  const refreshNotes = async () => {
    setError(undefined);
    try {
      const result = await listNotes();
      setFolders(result.folders);
      setNotes(result.notes);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshNotes();
  }, []);

  useEffect(() => {
    const keyword = query.trim();

    if (!keyword) {
      setSearchResults([]);
      setIsSearching(false);
      return undefined;
    }

    let isCanceled = false;
    setIsSearching(true);

    const timeoutId = window.setTimeout(() => {
      void searchNotes(keyword)
        .then((result) => {
          if (!isCanceled) {
            setSearchResults(result.notes);
          }
        })
        .catch((caught) => {
          if (!isCanceled) {
            setError(formatError(caught));
          }
        })
        .finally(() => {
          if (!isCanceled) {
            setIsSearching(false);
          }
        });
    }, 180);

    return () => {
      isCanceled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  const openNote = (note: NoteMeta, navigation?: { lineNumber?: number; query?: string }) => {
    onAddPanel({
      id: createNotePanelId(note.id),
      noteId: note.id,
      title: `${note.title}.md`,
      type: 'note',
    });

    if (navigation) {
      dispatchNoteNavigation({
        lineNumber: navigation.lineNumber,
        noteId: note.id,
        query: navigation.query,
      });
    }
  };

  const createNoteAtPath = async (folderPath?: string) => {
    const path = createUniqueChildPath(folderPath, 'Untitled note', [
      ...folders.map((folder) => folder.path),
      ...notes.map((note) => note.path),
    ]);
    setIsCreating(true);
    setError(undefined);

    try {
      const note = await createNote(path);
      await refreshNotes();
      setQuery('');
      setPendingInput({ kind: 'rename-note', note: note.meta, value: note.meta.title });
      openNote(note.meta);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsCreating(false);
    }
  };

  const createFolderAtPath = async (parentPath?: string) => {
    const path = createUniqueChildPath(parentPath, 'New folder', [
      ...folders.map((folder) => folder.path),
      ...notes.map((note) => note.path),
    ]);
    setIsCreating(true);
    setError(undefined);

    try {
      const folder = await createNoteFolder(path);
      await refreshNotes();
      setQuery('');
      setPendingInput({ folderPath: folder.path, kind: 'rename-folder', value: lastPathSegment(folder.path) });
      setCollapsedFolders((current) => {
        const next = new Set(current);
        next.delete(parentPath ?? '');
        next.delete(folder.path);
        return next;
      });
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setIsCreating(false);
    }
  };

  const handleRenameNote = async (note: NoteMeta, name: string) => {
    const path = resolveChildPath(parentPathOf(note.path), name);

    if (!path || path === note.path) {
      return;
    }

    setError(undefined);

    try {
      await renameNote(note.id, path);
      await refreshNotes();
    } catch (caught) {
      setError(formatError(caught));
    }
  };

  const handleDeleteNote = async (note: NoteMeta) => {
    if (!window.confirm(`Delete note "${note.title}"?`)) {
      return;
    }

    setError(undefined);

    try {
      await deleteNote(note.id);
      onClosePanel(createNotePanelId(note.id));
      await refreshNotes();
    } catch (caught) {
      setError(formatError(caught));
    }
  };

  const handleRenameFolder = async (path: string, name: string) => {
    const nextPath = resolveChildPath(parentPathOf(path), name);

    if (!nextPath || nextPath === path) {
      return;
    }

    setError(undefined);

    try {
      const result = await renameNoteFolder(path, nextPath);
      setFolders(result.folders);
      setNotes(result.notes);
      setCollapsedFolders((current) => {
        const next = new Set(current);
        next.delete(path);
        next.delete(nextPath);
        return next;
      });
    } catch (caught) {
      setError(formatError(caught));
    }
  };

  const handleDeleteFolder = async (path: string) => {
    if (!window.confirm(`Delete folder "${path}" and all notes inside it?`)) {
      return;
    }

    setError(undefined);

    try {
      const notePanelIdsToClose = notes
        .filter((note) => note.path.startsWith(`${path}/`))
        .map((note) => createNotePanelId(note.id));
      const result = await deleteNoteFolder(path);
      notePanelIdsToClose.forEach(onClosePanel);
      setFolders(result.folders);
      setNotes(result.notes);
    } catch (caught) {
      setError(formatError(caught));
    }
  };

  const toggleFolder = (path: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  };

  const moveTreeItem = async (payload: NoteDragPayload, targetFolderPath: string) => {
    const itemName = payload.type === 'folder' ? lastPathSegment(payload.path) : payload.title;
    const nextPath = targetFolderPath ? `${targetFolderPath}/${itemName}` : itemName;

    if (payload.path === nextPath) {
      return;
    }

    if (payload.type === 'folder' && (targetFolderPath === payload.path || targetFolderPath.startsWith(`${payload.path}/`))) {
      setError('Cannot move a folder inside itself.');
      return;
    }

    setError(undefined);

    try {
      if (payload.type === 'folder') {
        const result = await renameNoteFolder(payload.path, nextPath);
        setFolders(result.folders);
        setNotes(result.notes);
      } else {
        await renameNote(payload.id, nextPath);
        await refreshNotes();
      }
      setCollapsedFolders((current) => {
        const next = new Set(current);
        next.delete(targetFolderPath);
        return next;
      });
    } catch (caught) {
      setError(formatError(caught));
    }
  };

  const handleDropOnFolder = async (event: React.DragEvent, targetFolderPath: string) => {
    const payload = readDragPayload(event);

    if (!payload) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderPath(undefined);
    await moveTreeItem(payload, targetFolderPath);
  };

  const submitPendingInput = async () => {
    const draft = pendingInput;
    const value = draft?.value.trim();

    if (!draft || !value) {
      setPendingInput(undefined);
      return;
    }

    setPendingInput(undefined);

    if (draft.kind === 'rename-note') {
      await handleRenameNote(draft.note, value);
      return;
    }

    if (draft.kind === 'rename-folder') {
      await handleRenameFolder(draft.folderPath, value);
    }
  };

  const startNewNote = (parentPath?: string) => {
    void createNoteAtPath(parentPath);
    if (parentPath) {
      setCollapsedFolders((current) => {
        const next = new Set(current);
        next.delete(parentPath);
        return next;
      });
    }
  };

  const startNewFolder = (parentPath?: string) => {
    void createFolderAtPath(parentPath);
    if (parentPath) {
      setCollapsedFolders((current) => {
        const next = new Set(current);
        next.delete(parentPath);
        return next;
      });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_2.25rem] gap-2">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/80 focus:ring-1 focus:ring-primary/45"
                placeholder="Search notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Button
              className="size-9"
              size="icon"
              variant="outline"
              type="button"
              disabled={isCreating}
              title="New folder"
              aria-label="New folder"
              onClick={() => startNewFolder()}
            >
              <FolderPlus className="size-4" />
            </Button>
            <Button
              className="size-9"
              size="icon"
              type="button"
              disabled={isCreating}
              title="New note"
              aria-label="New note"
              onClick={() => startNewNote()}
            >
              <Plus className="size-4" />
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div
            className={cn(
              'app-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-md border border-transparent',
              dragOverFolderPath === '' && 'border-primary/40 bg-primary/5',
            )}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) {
                setDragOverFolderPath(undefined);
              }
            }}
            onDragOver={(event) => {
              if (hasDragPayload(event)) {
                event.preventDefault();
                setDragOverFolderPath('');
              }
            }}
            onDrop={(event) => void handleDropOnFolder(event, '')}
          >
            {isLoading ? (
              <NotesEmptyState title="Loading notes" description="Reading your local note index..." />
            ) : (
              <div className="space-y-0.5 py-1">
                {noteTree.length === 0 ? (
                  <NotesEmptyState
                    title={notes.length === 0 && folders.length === 0 ? 'No notes yet' : 'No matching notes'}
                    description={
                      notes.length === 0 && folders.length === 0
                        ? 'Create folders and Markdown notes like an Obsidian vault.'
                        : isSearching
                          ? 'Searching note contents...'
                          : 'Try another title, path, tag, or note body text.'
                    }
                  />
                ) : (
                  noteTree.map((node) => (
                    <NoteTreeNodeView
                      key={node.key}
                      collapsedFolders={collapsedFolders}
                      depth={0}
                      isFiltering={isFiltering}
                      node={node}
                      dragOverFolderPath={dragOverFolderPath}
                      pendingInput={pendingInput}
                      query={query}
                      onCancelPendingInput={() => setPendingInput(undefined)}
                      onChangePendingInput={(value) =>
                        pendingInput ? setPendingInput({ ...pendingInput, value } as PendingTreeInput) : undefined
                      }
                      onCreateFolder={startNewFolder}
                      onCreateNote={startNewNote}
                      onDeleteFolder={handleDeleteFolder}
                      onDeleteNote={handleDeleteNote}
                      onDragLeaveFolder={() => setDragOverFolderPath(undefined)}
                      onDragOverFolder={setDragOverFolderPath}
                      onDropOnFolder={handleDropOnFolder}
                      onOpenNote={openNote}
                      onRenameFolder={(folderPath) =>
                        setPendingInput({
                          folderPath,
                          kind: 'rename-folder',
                          value: lastPathSegment(folderPath),
                        })
                      }
                      onRenameNote={(note) =>
                        setPendingInput({
                          kind: 'rename-note',
                          note,
                          value: note.title,
                        })
                      }
                      onSubmitPendingInput={() => void submitPendingInput()}
                      onToggleFolder={toggleFolder}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuLabel>Notes</ContextMenuLabel>
        <ContextMenuItem onSelect={() => startNewNote()}>
          <FileText className="size-3.5" />
          New note
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => startNewFolder()}>
          <FolderPlus className="size-3.5" />
          New folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NoteTreeNodeView({
  collapsedFolders,
  depth,
  dragOverFolderPath,
  isFiltering,
  node,
  onCancelPendingInput,
  onChangePendingInput,
  onCreateFolder,
  onCreateNote,
  onDeleteFolder,
  onDeleteNote,
  onDragLeaveFolder,
  onDragOverFolder,
  onDropOnFolder,
  onOpenNote,
  onRenameFolder,
  onRenameNote,
  onSubmitPendingInput,
  pendingInput,
  query,
  onToggleFolder,
}: {
  collapsedFolders: Set<string>;
  depth: number;
  dragOverFolderPath?: string;
  isFiltering: boolean;
  node: NoteTreeNode;
  onCancelPendingInput: () => void;
  onChangePendingInput: (value: string) => void;
  onCreateFolder: (parentPath?: string) => void;
  onCreateNote: (folderPath?: string) => void;
  onDeleteFolder: (path: string) => Promise<void>;
  onDeleteNote: (note: NoteMeta) => Promise<void>;
  onDragLeaveFolder: () => void;
  onDragOverFolder: (folderPath: string) => void;
  onDropOnFolder: (event: React.DragEvent, targetFolderPath: string) => Promise<void>;
  onOpenNote: (note: NoteMeta, navigation?: { lineNumber?: number; query?: string }) => void;
  onRenameFolder: (path: string) => void;
  onRenameNote: (note: NoteMeta) => void;
  onSubmitPendingInput: () => void;
  pendingInput?: PendingTreeInput;
  query: string;
  onToggleFolder: (path: string) => void;
}) {
  if (node.type === 'folder') {
    const isCollapsed = !isFiltering && collapsedFolders.has(node.path);
    const Chevron = isCollapsed ? ChevronRight : ChevronDown;
    const isDragOver = dragOverFolderPath === node.path;
    const isRenaming =
      pendingInput?.kind === 'rename-folder' && pendingInput.folderPath === node.path;
    const children = !isCollapsed ? (
      <div>
        {node.children.map((child) => (
          <NoteTreeNodeView
            key={child.key}
            collapsedFolders={collapsedFolders}
            depth={depth + 1}
            dragOverFolderPath={dragOverFolderPath}
            isFiltering={isFiltering}
            node={child}
            pendingInput={pendingInput}
            query={query}
            onCancelPendingInput={onCancelPendingInput}
            onChangePendingInput={onChangePendingInput}
            onCreateFolder={onCreateFolder}
            onCreateNote={onCreateNote}
            onDeleteFolder={onDeleteFolder}
            onDeleteNote={onDeleteNote}
            onDragLeaveFolder={onDragLeaveFolder}
            onDragOverFolder={onDragOverFolder}
            onDropOnFolder={onDropOnFolder}
            onOpenNote={onOpenNote}
            onRenameFolder={onRenameFolder}
            onRenameNote={onRenameNote}
            onSubmitPendingInput={onSubmitPendingInput}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
    ) : null;

    if (isRenaming) {
      return (
        <div>
          <PendingTreeInputRow
            depth={depth}
            folderChevron={isCollapsed ? 'right' : 'down'}
            icon="folder"
            value={pendingInput.value}
            onCancel={onCancelPendingInput}
            onChange={onChangePendingInput}
            onSubmit={onSubmitPendingInput}
          />
          {children}
        </div>
      );
    }

    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              className={cn(
                'flex h-7 w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-left text-sm font-medium text-foreground/90 outline-none transition hover:bg-accent/60 focus-visible:bg-accent',
                isDragOver && 'bg-primary/10 ring-1 ring-primary/45',
              )}
              type="button"
              draggable
              title={node.path}
              style={{ paddingLeft: depth * 14 + 4 }}
              onClick={(event) => {
                if (event.button !== 0 || event.ctrlKey) {
                  event.preventDefault();
                  return;
                }

                onToggleFolder(node.path);
              }}
              onDragStart={(event) => writeDragPayload(event, { path: node.path, type: 'folder' })}
              onDragLeave={onDragLeaveFolder}
              onDragOver={(event) => {
                if (hasDragPayload(event)) {
                  event.preventDefault();
                  event.stopPropagation();
                  onDragOverFolder(node.path);
                }
              }}
              onDrop={(event) => void onDropOnFolder(event, node.path)}
            >
              <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
              <Folder className="size-4 shrink-0 text-primary" />
              <span className="truncate">{node.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
            <ContextMenuLabel>{node.path}</ContextMenuLabel>
            <ContextMenuItem onSelect={() => onCreateNote(node.path)}>
              <FileText className="size-3.5" />
              New note
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onCreateFolder(node.path)}>
              <FolderPlus className="size-3.5" />
              New folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onRenameFolder(node.path)}>Rename folder</ContextMenuItem>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => void onDeleteFolder(node.path)}
            >
              Delete folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {children}
      </>
    );
  }

  const isRenaming = pendingInput?.kind === 'rename-note' && pendingInput.note.id === node.note.id;

  if (isRenaming) {
    return (
      <PendingTreeInputRow
        depth={depth}
        icon="note"
        value={pendingInput.value}
        onCancel={onCancelPendingInput}
        onChange={onChangePendingInput}
        onSubmit={onSubmitPendingInput}
      />
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          className={cn(
            'grid min-h-7 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-foreground/85 outline-none transition hover:bg-accent/60 focus-visible:bg-accent',
          )}
          type="button"
          draggable
          title={node.note.path}
          style={{ paddingLeft: depth * 14 + 22 }}
          onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey) {
              event.preventDefault();
              return;
            }

            onOpenNote(node.note);
          }}
          onDragStart={(event) =>
            writeDragPayload(event, {
              id: node.note.id,
              path: node.note.path,
              title: node.note.title,
              type: 'note',
            })
          }
        >
          <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate">{node.note.title}</span>
            {node.searchResult ? (
              <span className="mt-0.5 block space-y-0.5">
                {getSearchPreviewLines(node.searchResult).map((match, index) => (
                  <span
                    className="block truncate rounded-sm text-[11px] leading-4 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    key={`${match.lineNumber ?? 'preview'}-${index}`}
                    role="button"
                    tabIndex={0}
                    title={match.snippet}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenNote(node.note, { lineNumber: match.lineNumber, query });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenNote(node.note, { lineNumber: match.lineNumber, query });
                      }
                    }}
                  >
                    {node.searchResult?.matchKind === 'content' ? 'Body' : 'Info'}
                    {match.lineNumber ? `:${match.lineNumber}` : ''} —{' '}
                    <HighlightedSearchText query={query} text={match.snippet} />
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenuLabel>{node.note.path}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => onOpenNote(node.note)}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={() => onRenameNote(node.note)}>Rename note</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => void onDeleteNote(node.note)}
        >
          Delete note
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PendingTreeInputRow({
  depth,
  folderChevron = 'right',
  icon,
  onCancel,
  onChange,
  onSubmit,
  value,
}: {
  depth: number;
  folderChevron?: 'down' | 'right';
  icon: 'folder' | 'note';
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canSubmitOnBlurRef = useRef(false);
  const didSubmitRef = useRef(false);
  const hasEditedRef = useRef(false);
  const initialValueRef = useRef(value);
  const isFolder = icon === 'folder';
  const Icon = icon === 'folder' ? Folder : FileText;
  const Chevron = folderChevron === 'down' ? ChevronDown : ChevronRight;

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    const animationFrameId = window.requestAnimationFrame(focusInput);
    const timeoutId = window.setTimeout(focusInput, 0);
    const blurSubmitGuardId = window.setTimeout(() => {
      canSubmitOnBlurRef.current = true;
    }, 120);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
      window.clearTimeout(blurSubmitGuardId);
    };
  }, []);

  return (
    <div
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1 rounded-md border border-primary/70 bg-accent/45 px-1.5 text-sm text-foreground/85',
      )}
      style={{ paddingLeft: isFolder ? depth * 14 + 4 : depth * 14 + 22 }}
    >
      {isFolder ? <Chevron className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <Icon className={cn('shrink-0', isFolder ? 'size-4 text-primary' : 'size-3.5 text-muted-foreground')} />
      <input
        ref={inputRef}
        className="h-5 min-w-0 flex-1 bg-transparent text-sm leading-5 text-foreground outline-none"
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          if (!canSubmitOnBlurRef.current) {
            window.requestAnimationFrame(() => inputRef.current?.focus());
            return;
          }

          if (didSubmitRef.current) {
            return;
          }

          if (!hasEditedRef.current && event.currentTarget.value.trim() === initialValueRef.current.trim()) {
            onCancel();
            return;
          }

          didSubmitRef.current = true;
          onSubmit();
        }}
        onChange={(event) => {
          hasEditedRef.current = true;
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (didSubmitRef.current) {
              return;
            }
            didSubmitRef.current = true;
            onSubmit();
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}

function buildNoteTree(
  folders: NoteFolderMeta[],
  notes: NoteMeta[],
  searchResultByNoteId = new Map<string, NoteSearchResultItem>(),
): NoteTreeNode[] {
  const root = createFolderNode('', '');

  folders.forEach((folder) => ensureFolder(root, splitPath(folder.path)));
  notes.forEach((note) => {
    const segments = splitPath(note.path || note.title);
    const parent = ensureFolder(root, segments.slice(0, -1));

    parent.children.push({
      key: note.id,
      note,
      searchResult: searchResultByNoteId.get(note.id),
      type: 'note',
    });
  });

  return sortTreeNodes(root.children);
}

function createFolderNode(name: string, path: string): Extract<NoteTreeNode, { type: 'folder' }> {
  return {
    children: [],
    key: `folder:${path || 'root'}`,
    name,
    path,
    type: 'folder',
  };
}

function ensureFolder(
  root: Extract<NoteTreeNode, { type: 'folder' }>,
  segments: string[],
): Extract<NoteTreeNode, { type: 'folder' }> {
  let current = root;
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    let next = current.children.find(
      (child): child is Extract<NoteTreeNode, { type: 'folder' }> =>
        child.type === 'folder' && child.path === currentPath,
    );

    if (!next) {
      next = createFolderNode(segment, currentPath);
      current.children.push(next);
    }

    current = next;
  }

  return current;
}

function splitPath(path: string) {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function sortTreeNodes(nodes: NoteTreeNode[]): NoteTreeNode[] {
  return nodes
    .map((node) =>
      node.type === 'folder'
        ? {
            ...node,
            children: sortTreeNodes(node.children),
          }
        : node,
    )
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1;
      }

      const leftName = left.type === 'folder' ? left.name : left.note.title;
      const rightName = right.type === 'folder' ? right.name : right.note.title;

      return leftName.localeCompare(rightName);
    });
}

function resolveChildPath(parentPath: string | undefined, input: string) {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    return '';
  }

  if (!parentPath || trimmedInput.includes('/')) {
    return normalizeNotePath(trimmedInput);
  }

  return normalizeNotePath(`${parentPath}/${trimmedInput}`);
}

function createUniqueChildPath(parentPath: string | undefined, baseName: string, existingPaths: string[]) {
  const normalizedExistingPaths = new Set(existingPaths.map(normalizeNotePath));
  let index = 1;

  while (true) {
    const name = index === 1 ? baseName : `${baseName} ${index}`;
    const path = resolveChildPath(parentPath, name);

    if (!normalizedExistingPaths.has(path)) {
      return path;
    }

    index += 1;
  }
}

function normalizeNotePath(path: string) {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

function parentPathOf(path: string) {
  const segments = splitPath(path);

  return segments.slice(0, -1).join('/') || undefined;
}

function lastPathSegment(path: string) {
  const segments = splitPath(path);

  return segments[segments.length - 1] ?? path;
}

function writeDragPayload(event: React.DragEvent, payload: NoteDragPayload) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(noteDragMimeType, JSON.stringify(payload));
}

function readDragPayload(event: React.DragEvent): NoteDragPayload | undefined {
  if (!hasDragPayload(event)) {
    return undefined;
  }

  const rawPayload = event.dataTransfer.getData(noteDragMimeType);

  if (!rawPayload) {
    return undefined;
  }

  try {
    const payload = JSON.parse(rawPayload) as Partial<NoteDragPayload>;

    if (payload.type === 'folder' && typeof payload.path === 'string') {
      return { path: payload.path, type: 'folder' };
    }

    if (
      payload.type === 'note' &&
      typeof payload.id === 'string' &&
      typeof payload.path === 'string' &&
      typeof payload.title === 'string'
    ) {
      return {
        id: payload.id,
        path: payload.path,
        title: payload.title,
        type: 'note',
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function hasDragPayload(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes(noteDragMimeType);
}

function createNotePanelId(noteId: string) {
  return `note-${noteId}`;
}

function getSearchPreviewLines(result: NoteSearchResultItem) {
  if (result.matches.length > 0) {
    return result.matches;
  }

  if (result.snippet) {
    return [{ snippet: result.snippet }];
  }

  return [];
}

function HighlightedSearchText({ query, text }: { query: string; text: string }) {
  const keyword = query.trim();

  if (!keyword) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(keyword)})`, 'ig'));

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === keyword.toLowerCase() ? (
          <mark
            className="rounded-sm bg-[rgb(156_111_0_/_52%)] px-0.5 text-foreground"
            key={`${part}-${index}`}
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function NotesEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-border/80 p-4 text-center">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
