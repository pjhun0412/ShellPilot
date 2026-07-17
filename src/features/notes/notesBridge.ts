import { invoke } from '@tauri-apps/api/core';

import type { NoteDocument, NoteFolderMeta, NoteMeta, NotesListResult, NotesSearchResult } from './notesTypes';

export async function listNotes() {
  return invoke<NotesListResult>('notes_list');
}

export async function createNote(title: string) {
  return invoke<NoteDocument>('notes_create', { title });
}

export async function readNote(id: string) {
  return invoke<NoteDocument>('notes_read', { id });
}

export async function searchNotes(query: string) {
  return invoke<NotesSearchResult>('notes_search', { query });
}

export async function updateNote(id: string, content: string) {
  return invoke<NoteMeta>('notes_update', { content, id });
}

export async function renameNote(id: string, title: string) {
  return invoke<NoteMeta>('notes_rename', { id, title });
}

export async function deleteNote(id: string) {
  return invoke<boolean>('notes_delete', { id });
}

export async function createNoteFolder(path: string) {
  return invoke<NoteFolderMeta>('notes_create_folder', { path });
}

export async function renameNoteFolder(oldPath: string, newPath: string) {
  return invoke<NotesListResult>('notes_rename_folder', { newPath, oldPath });
}

export async function deleteNoteFolder(path: string) {
  return invoke<NotesListResult>('notes_delete_folder', { path });
}
