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

export type NoteViewMode = 'edit' | 'live' | 'preview';
