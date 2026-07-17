export interface NoteMeta {
  createdAt: number;
  id: string;
  path: string;
  tags: string[];
  title: string;
  updatedAt: number;
}

export interface NoteFolderMeta {
  createdAt: number;
  path: string;
  updatedAt: number;
}

export interface NoteDocument {
  content: string;
  meta: NoteMeta;
}

export interface NotesListResult {
  folders: NoteFolderMeta[];
  notes: NoteMeta[];
}

export interface NoteSearchResultItem {
  matches: NoteSearchMatch[];
  matchKind: 'metadata' | 'content';
  note: NoteMeta;
  snippet?: string;
}

export interface NoteSearchMatch {
  lineNumber?: number;
  snippet: string;
}

export interface NotesSearchResult {
  notes: NoteSearchResultItem[];
}

export type NoteViewMode = 'edit' | 'live' | 'preview';
