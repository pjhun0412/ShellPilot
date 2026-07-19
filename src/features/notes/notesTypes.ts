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
  assetBaseDir: string;
  content: string;
  meta: NoteMeta;
}

export interface NoteAsset {
  absolutePath: string;
  fileName: string;
  markdownPath: string;
  mimeType: string;
}

export interface NoteLink {
  heading?: string;
  lineNumber: number;
  raw: string;
  sourceId: string;
  target: string;
}

export interface NoteHeading {
  level: number;
  lineNumber: number;
  slug: string;
  sourceId: string;
  title: string;
}

export interface NoteMention {
  lineNumber: number;
  snippet: string;
  sourceId: string;
  targetId: string;
}

export interface NotesListResult {
  folders: NoteFolderMeta[];
  headings: NoteHeading[];
  links: NoteLink[];
  mentions: NoteMention[];
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
