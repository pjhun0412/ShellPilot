use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const NOTE_SEARCH_INDEX_VERSION: u32 = 3;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotesIndex {
    #[serde(default)]
    folders: Vec<NoteFolderMeta>,
    #[serde(default)]
    notes: Vec<NoteMeta>,
    #[serde(default)]
    search: Vec<NoteSearchEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub path: String,
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFolderMeta {
    pub path: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesListResult {
    pub folders: Vec<NoteFolderMeta>,
    pub notes: Vec<NoteMeta>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub meta: NoteMeta,
    pub content: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSearchEntry {
    id: String,
    #[serde(default)]
    lines: Vec<NoteSearchLine>,
    text: String,
    preview: String,
    updated_at: u64,
    #[serde(default)]
    version: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteSearchLine {
    line_number: usize,
    text: String,
    preview: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesSearchResult {
    pub notes: Vec<NoteSearchResultItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchResultItem {
    pub matches: Vec<NoteSearchMatch>,
    pub note: NoteMeta,
    pub snippet: Option<String>,
    pub match_kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchMatch {
    pub line_number: Option<usize>,
    pub snippet: String,
}

#[tauri::command]
pub fn notes_list(app: AppHandle) -> Result<NotesListResult, String> {
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;

    normalize_index(&mut index);

    index
        .folders
        .sort_by(|left, right| left.path.cmp(&right.path));
    index.notes.sort_by(|left, right| {
        right.updated_at.cmp(&left.updated_at).then_with(|| {
            left.title
                .to_ascii_lowercase()
                .cmp(&right.title.to_ascii_lowercase())
        })
    });

    Ok(NotesListResult {
        folders: index.folders,
        notes: index.notes,
    })
}

#[tauri::command]
pub fn notes_create(app: AppHandle, title: String) -> Result<NoteDocument, String> {
    let path = normalize_note_path(&title);
    let title = note_title_from_path(&path);
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let now = current_timestamp_ms();
    let id = create_note_id(&paths.pages, now)?;
    let meta = NoteMeta {
        id: id.clone(),
        path,
        tags: Vec::new(),
        title: title.clone(),
        created_at: now,
        updated_at: now,
    };
    let content = format!("# {}\n", title);

    fs::write(note_content_path(&paths.pages, &id)?, &content)
        .map_err(|error| format!("failed to create note content: {error}"))?;

    index.notes.push(meta.clone());
    update_search_entry(&mut index, &id, &content, now);
    add_parent_folders(&mut index, &meta.path, now);
    write_notes_index(&paths.index, &index)?;

    Ok(NoteDocument { meta, content })
}

#[tauri::command]
pub fn notes_create_folder(app: AppHandle, path: String) -> Result<NoteFolderMeta, String> {
    let folder_path = normalize_note_path(&path);
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let now = current_timestamp_ms();

    add_folder(&mut index, &folder_path, now);
    write_notes_index(&paths.index, &index)?;

    index
        .folders
        .into_iter()
        .find(|folder| folder.path == folder_path)
        .ok_or_else(|| "failed to create note folder".to_string())
}

#[tauri::command]
pub fn notes_rename_folder(
    app: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<NotesListResult, String> {
    let old_path = normalize_note_path(&old_path);
    let new_path = normalize_note_path(&new_path);

    if old_path == new_path {
        return notes_list(app);
    }

    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let now = current_timestamp_ms();

    for folder in &mut index.folders {
        if folder.path == old_path || folder.path.starts_with(&format!("{old_path}/")) {
            folder.path = replace_path_prefix(&folder.path, &old_path, &new_path);
            folder.updated_at = now;
        }
    }

    for note in &mut index.notes {
        if note.path.starts_with(&format!("{old_path}/")) {
            note.path = replace_path_prefix(&note.path, &old_path, &new_path);
            note.title = note_title_from_path(&note.path);
            note.updated_at = now;
        }
    }

    add_folder(&mut index, &new_path, now);
    normalize_index(&mut index);
    write_notes_index(&paths.index, &index)?;

    notes_list(app)
}

#[tauri::command]
pub fn notes_delete_folder(app: AppHandle, path: String) -> Result<NotesListResult, String> {
    let folder_path = normalize_note_path(&path);
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let removed_note_ids = index
        .notes
        .iter()
        .filter(|note| note.path.starts_with(&format!("{folder_path}/")))
        .map(|note| note.id.clone())
        .collect::<Vec<_>>();

    index.folders.retain(|folder| {
        folder.path != folder_path && !folder.path.starts_with(&format!("{folder_path}/"))
    });
    index
        .notes
        .retain(|note| !note.path.starts_with(&format!("{folder_path}/")));
    index
        .search
        .retain(|entry| !removed_note_ids.iter().any(|note_id| note_id == &entry.id));
    normalize_index(&mut index);
    write_notes_index(&paths.index, &index)?;

    for note_id in removed_note_ids {
        match fs::remove_file(note_content_path(&paths.pages, &note_id)?) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to delete note content: {error}")),
        }
    }

    notes_list(app)
}

#[tauri::command]
pub fn notes_read(app: AppHandle, id: String) -> Result<NoteDocument, String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let index = read_notes_index(&paths.index)?;
    let meta = find_note_meta(&index, &id)?;
    let content = fs::read_to_string(note_content_path(&paths.pages, &id)?)
        .map_err(|error| format!("failed to read note content: {error}"))?;

    Ok(NoteDocument { meta, content })
}

#[tauri::command]
pub fn notes_search(app: AppHandle, query: String) -> Result<NotesSearchResult, String> {
    let query = normalize_search_query(&query);

    if query.is_empty() {
        return Ok(NotesSearchResult { notes: Vec::new() });
    }

    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let index_changed = ensure_search_index(&mut index, &paths.pages)?;

    if index_changed {
        write_notes_index(&paths.index, &index)?;
    }

    let mut results = index
        .notes
        .iter()
        .filter_map(|note| {
            let metadata = normalize_search_text(&format!(
                "{} {} {}",
                note.title,
                note.path,
                note.tags.join(" ")
            ));
            let content_entry = index.search.iter().find(|entry| entry.id == note.id);

            if metadata.contains(&query) {
                let matches = content_entry
                    .map(|entry| build_search_matches(&entry.lines, &query))
                    .unwrap_or_default();

                return Some(NoteSearchResultItem {
                    matches,
                    note: note.clone(),
                    snippet: content_entry
                        .map(|entry| entry.preview.clone())
                        .filter(|preview| !preview.is_empty()),
                    match_kind: "metadata".to_string(),
                });
            }

            let entry = content_entry?;
            if !entry.text.contains(&query) {
                return None;
            }

            let matches = build_search_matches(&entry.lines, &query);
            let snippet = matches
                .first()
                .map(|matched| matched.snippet.clone())
                .or_else(|| build_search_snippet(&entry.preview, &query));

            Some(NoteSearchResultItem {
                matches,
                note: note.clone(),
                snippet,
                match_kind: "content".to_string(),
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| {
        note_search_rank(&left.match_kind)
            .cmp(&note_search_rank(&right.match_kind))
            .then_with(|| right.note.updated_at.cmp(&left.note.updated_at))
            .then_with(|| {
                left.note
                    .title
                    .to_ascii_lowercase()
                    .cmp(&right.note.title.to_ascii_lowercase())
            })
    });
    results.truncate(50);

    Ok(NotesSearchResult { notes: results })
}

#[tauri::command]
pub fn notes_update(app: AppHandle, id: String, content: String) -> Result<NoteMeta, String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let content_path = note_content_path(&paths.pages, &id)?;
    let updated_at = current_timestamp_ms();
    let meta = update_note_meta(&mut index, &id, updated_at)?;

    fs::write(content_path, &content)
        .map_err(|error| format!("failed to update note content: {error}"))?;
    update_search_entry(&mut index, &id, &content, updated_at);
    write_notes_index(&paths.index, &index)?;

    Ok(meta)
}

#[tauri::command]
pub fn notes_rename(app: AppHandle, id: String, title: String) -> Result<NoteMeta, String> {
    let id = validate_note_id(&id)?;
    let path = normalize_note_path(&title);
    let title = note_title_from_path(&path);
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let updated_at = current_timestamp_ms();
    let meta = update_note_meta_fields(&mut index, &id, |note| {
        note.title = title.clone();
        note.path = path.clone();
        note.updated_at = updated_at;
    })?;

    write_notes_index(&paths.index, &index)?;

    Ok(meta)
}

#[tauri::command]
pub fn notes_delete(app: AppHandle, id: String) -> Result<bool, String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let original_len = index.notes.len();

    index.notes.retain(|note| note.id != id);
    index.search.retain(|entry| entry.id != id);

    if index.notes.len() == original_len {
        return Ok(false);
    }

    write_notes_index(&paths.index, &index)?;

    match fs::remove_file(note_content_path(&paths.pages, &id)?) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to delete note content: {error}")),
    }

    Ok(true)
}

struct NotesPaths {
    index: PathBuf,
    pages: PathBuf,
}

fn notes_paths(app: &AppHandle) -> Result<NotesPaths, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("notes");
    let pages = directory.join("pages");

    fs::create_dir_all(&pages)
        .map_err(|error| format!("failed to create notes directory: {error}"))?;

    Ok(NotesPaths {
        index: directory.join("index.json"),
        pages,
    })
}

fn read_notes_index(path: &Path) -> Result<NotesIndex, String> {
    if !path.exists() {
        return Ok(NotesIndex::default());
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("failed to read notes index: {error}"))?;

    serde_json::from_str(&content).map_err(|error| format!("failed to parse notes index: {error}"))
}

fn write_notes_index(path: &Path, index: &NotesIndex) -> Result<(), String> {
    let content = serde_json::to_string_pretty(index)
        .map_err(|error| format!("failed to serialize notes index: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");

    fs::write(&temporary_path, content)
        .map_err(|error| format!("failed to write notes index temporary file: {error}"))?;
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("failed to commit notes index update: {error}"))
}

fn add_parent_folders(index: &mut NotesIndex, note_path: &str, timestamp: u64) {
    let segments = note_path.split('/').collect::<Vec<_>>();

    if segments.len() <= 1 {
        return;
    }

    for depth in 1..segments.len() {
        add_folder(index, &segments[..depth].join("/"), timestamp);
    }
}

fn add_folder(index: &mut NotesIndex, path: &str, timestamp: u64) {
    let path = normalize_note_path(path);

    if !index.folders.iter().any(|folder| folder.path == path) {
        index.folders.push(NoteFolderMeta {
            path,
            created_at: timestamp,
            updated_at: timestamp,
        });
    }
}

fn normalize_index(index: &mut NotesIndex) {
    let mut folders = Vec::<NoteFolderMeta>::new();

    for folder in index.folders.drain(..) {
        let path = normalize_note_path(&folder.path);

        if path.is_empty() || folders.iter().any(|current| current.path == path) {
            continue;
        }

        folders.push(NoteFolderMeta { path, ..folder });
    }

    for note in &index.notes {
        add_parent_folder_paths(&mut folders, &note.path, note.created_at);
    }

    index.folders = folders;
    let note_ids = index
        .notes
        .iter()
        .map(|note| note.id.as_str())
        .collect::<Vec<_>>();
    index
        .search
        .retain(|entry| note_ids.iter().any(|note_id| *note_id == entry.id));
}

fn add_parent_folder_paths(folders: &mut Vec<NoteFolderMeta>, note_path: &str, timestamp: u64) {
    let segments = note_path.split('/').collect::<Vec<_>>();

    if segments.len() <= 1 {
        return;
    }

    for depth in 1..segments.len() {
        let path = segments[..depth].join("/");

        if !folders.iter().any(|folder| folder.path == path) {
            folders.push(NoteFolderMeta {
                path,
                created_at: timestamp,
                updated_at: timestamp,
            });
        }
    }
}

fn replace_path_prefix(path: &str, old_prefix: &str, new_prefix: &str) -> String {
    if path == old_prefix {
        return new_prefix.to_string();
    }

    path.strip_prefix(&format!("{old_prefix}/"))
        .map(|suffix| format!("{new_prefix}/{suffix}"))
        .unwrap_or_else(|| path.to_string())
}

fn note_content_path(pages: &Path, id: &str) -> Result<PathBuf, String> {
    let id = validate_note_id(id)?;

    Ok(pages.join(format!("{id}.md")))
}

fn validate_note_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    let is_safe = trimmed.starts_with("note-")
        && trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');

    if !is_safe {
        return Err("invalid note id".to_string());
    }

    Ok(trimmed.to_string())
}

fn normalize_note_path(path: &str) -> String {
    let normalized = path
        .split('/')
        .map(str::trim)
        .filter(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
        .collect::<Vec<_>>()
        .join("/");

    if normalized.is_empty() {
        "Untitled note".to_string()
    } else {
        normalized.chars().take(180).collect()
    }
}

fn note_title_from_path(path: &str) -> String {
    path.rsplit('/')
        .next()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("Untitled note")
        .chars()
        .take(120)
        .collect()
}

fn create_note_id(pages: &Path, timestamp: u64) -> Result<String, String> {
    for offset in 0..100_u64 {
        let id = format!("note-{}-{}", timestamp, offset);

        if !note_content_path(pages, &id)?.exists() {
            return Ok(id);
        }
    }

    Err("failed to allocate note id".to_string())
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn find_note_meta(index: &NotesIndex, id: &str) -> Result<NoteMeta, String> {
    index
        .notes
        .iter()
        .find(|note| note.id == id)
        .cloned()
        .ok_or_else(|| "note not found".to_string())
}

fn update_note_meta(index: &mut NotesIndex, id: &str, updated_at: u64) -> Result<NoteMeta, String> {
    update_note_meta_fields(index, id, |note| {
        note.updated_at = updated_at;
    })
}

fn update_note_meta_fields(
    index: &mut NotesIndex,
    id: &str,
    update: impl FnOnce(&mut NoteMeta),
) -> Result<NoteMeta, String> {
    let note = index
        .notes
        .iter_mut()
        .find(|note| note.id == id)
        .ok_or_else(|| "note not found".to_string())?;

    update(note);

    Ok(note.clone())
}

fn update_search_entry(index: &mut NotesIndex, id: &str, content: &str, updated_at: u64) {
    let entry = NoteSearchEntry {
        id: id.to_string(),
        lines: build_search_lines(content),
        preview: normalize_preview_text(content),
        text: normalize_search_text(content),
        updated_at,
        version: NOTE_SEARCH_INDEX_VERSION,
    };

    if let Some(current) = index.search.iter_mut().find(|current| current.id == id) {
        *current = entry;
    } else {
        index.search.push(entry);
    }
}

fn ensure_search_index(index: &mut NotesIndex, pages: &Path) -> Result<bool, String> {
    let mut changed = false;
    let notes = index.notes.clone();

    for note in notes {
        let existing = index.search.iter().find(|entry| entry.id == note.id);

        if existing.is_some_and(|entry| {
            entry.updated_at >= note.updated_at && entry.version >= NOTE_SEARCH_INDEX_VERSION
        }) {
            continue;
        }

        let content = fs::read_to_string(note_content_path(pages, &note.id)?)
            .map_err(|error| format!("failed to read note content for search: {error}"))?;
        update_search_entry(index, &note.id, &content, note.updated_at);
        changed = true;
    }

    let note_ids = index
        .notes
        .iter()
        .map(|note| note.id.as_str())
        .collect::<Vec<_>>();
    let original_len = index.search.len();
    index
        .search
        .retain(|entry| note_ids.iter().any(|note_id| *note_id == entry.id));

    Ok(changed || original_len != index.search.len())
}

fn normalize_search_query(query: &str) -> String {
    normalize_search_text(query).chars().take(120).collect()
}

fn normalize_search_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn normalize_preview_text(content: &str) -> String {
    content
        .lines()
        .take(120)
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(8000)
        .collect()
}

fn build_search_lines(content: &str) -> Vec<NoteSearchLine> {
    content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let preview = line.trim();

            if preview.is_empty() {
                return None;
            }

            Some(NoteSearchLine {
                line_number: index + 1,
                text: normalize_search_text(preview),
                preview: preview.chars().take(220).collect(),
            })
        })
        .take(2000)
        .collect()
}

fn build_search_snippet(preview: &str, query: &str) -> Option<String> {
    let normalized_preview = normalize_search_text(preview);
    let match_index = normalized_preview.find(query)?;
    let start = match_index.saturating_sub(64);
    let snippet = preview
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if snippet.is_empty() {
        return None;
    }

    Some(
        snippet
            .chars()
            .skip(start)
            .take(160)
            .collect::<String>()
            .trim()
            .to_string(),
    )
}

fn build_search_matches(lines: &[NoteSearchLine], query: &str) -> Vec<NoteSearchMatch> {
    lines
        .iter()
        .filter_map(|line| {
            if !line.text.contains(query) {
                return None;
            }

            Some(NoteSearchMatch {
                line_number: Some(line.line_number),
                snippet: line.preview.clone(),
            })
        })
        .take(8)
        .collect()
}

fn note_search_rank(match_kind: &str) -> u8 {
    match match_kind {
        "metadata" => 0,
        _ => 1,
    }
}
