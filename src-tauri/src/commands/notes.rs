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
    pub asset_base_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAsset {
    pub absolute_path: String,
    pub file_name: String,
    pub markdown_path: String,
    pub mime_type: String,
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

    write_note_content(&paths.pages, &meta, &content)?;

    index.notes.push(meta.clone());
    update_search_entry(&mut index, &id, &content, now);
    add_parent_folders(&mut index, &meta.path, now);
    write_notes_index(&paths.index, &index)?;

    Ok(NoteDocument {
        asset_base_dir: note_asset_dir(&paths.assets, &meta.id)?
            .to_string_lossy()
            .to_string(),
        meta,
        content,
    })
}

#[tauri::command]
pub fn notes_create_folder(app: AppHandle, path: String) -> Result<NoteFolderMeta, String> {
    let folder_path = normalize_note_path(&path);
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let now = current_timestamp_ms();

    add_folder(&mut index, &folder_path, now);
    ensure_note_folder(&paths.pages, &folder_path)?;
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

    let mut moved_notes = Vec::new();

    for note in &mut index.notes {
        if note.path.starts_with(&format!("{old_path}/")) {
            let previous = note.clone();
            note.path = replace_path_prefix(&note.path, &old_path, &new_path);
            note.title = note_title_from_path(&note.path);
            note.updated_at = now;
            moved_notes.push((previous, note.clone()));
        }
    }

    add_folder(&mut index, &new_path, now);
    normalize_index(&mut index);
    for (previous, current) in moved_notes {
        move_note_content(&paths.pages, &previous, &current)?;
    }
    ensure_note_folder_tree(&paths.pages, &index.folders)?;
    remove_empty_directory_tree(&note_folder_path(&paths.pages, &old_path)?);
    remove_empty_parent_dirs(
        &paths.pages,
        note_folder_path(&paths.pages, &old_path)?.parent(),
    );
    write_notes_index(&paths.index, &index)?;

    notes_list(app)
}

#[tauri::command]
pub fn notes_delete_folder(app: AppHandle, path: String) -> Result<NotesListResult, String> {
    let folder_path = normalize_note_path(&path);
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let removed_notes = index
        .notes
        .iter()
        .filter(|note| note.path.starts_with(&format!("{folder_path}/")))
        .cloned()
        .collect::<Vec<_>>();
    let removed_note_ids = removed_notes
        .iter()
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

    for note in removed_notes {
        remove_note_content(&paths.pages, &note)?;
        remove_note_assets(&paths.assets, &note.id)?;
    }
    remove_empty_directory_tree(&note_folder_path(&paths.pages, &folder_path)?);
    remove_empty_parent_dirs(
        &paths.pages,
        note_folder_path(&paths.pages, &folder_path)?.parent(),
    );

    notes_list(app)
}

#[tauri::command]
pub fn notes_read(app: AppHandle, id: String) -> Result<NoteDocument, String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let index = read_notes_index(&paths.index)?;
    let meta = find_note_meta(&index, &id)?;
    let content = fs::read_to_string(existing_note_content_path(&paths.pages, &meta)?)
        .map_err(|error| format!("failed to read note content: {error}"))?;

    Ok(NoteDocument {
        asset_base_dir: note_asset_dir(&paths.assets, &id)?
            .to_string_lossy()
            .to_string(),
        meta,
        content,
    })
}

#[tauri::command]
pub fn notes_save_asset(
    app: AppHandle,
    id: String,
    file_name: String,
    mime_type: String,
    data: Vec<u8>,
) -> Result<NoteAsset, String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let index = read_notes_index(&paths.index)?;

    find_note_meta(&index, &id)?;

    let mime_type = normalize_image_mime_type(&mime_type)?;

    if data.is_empty() {
        return Err("note image is empty".to_string());
    }

    if data.len() > 15 * 1024 * 1024 {
        return Err("note image is too large. Maximum size is 15 MB.".to_string());
    }

    let asset_directory = note_asset_dir(&paths.assets, &id)?;
    fs::create_dir_all(&asset_directory)
        .map_err(|error| format!("failed to create note asset directory: {error}"))?;

    let now = current_timestamp_ms();
    let file_name = allocate_asset_file_name(
        &asset_directory,
        &sanitize_asset_file_name(&file_name, &mime_type, now),
    );
    let absolute_path = asset_directory.join(&file_name);

    fs::write(&absolute_path, data)
        .map_err(|error| format!("failed to write note image asset: {error}"))?;

    Ok(NoteAsset {
        absolute_path: absolute_path.to_string_lossy().to_string(),
        file_name: file_name.clone(),
        markdown_path: format!(
            "../assets/{id}/{}",
            encode_markdown_path_segment(&file_name)
        ),
        mime_type,
    })
}

#[tauri::command]
pub fn notes_reveal_root(app: AppHandle) -> Result<(), String> {
    let paths = notes_paths(&app)?;

    reveal_path_in_file_manager(&paths.directory)
}

#[tauri::command]
pub fn notes_reveal_file(app: AppHandle, id: String) -> Result<(), String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let index = read_notes_index(&paths.index)?;

    let meta = find_note_meta(&index, &id)?;
    reveal_path_in_file_manager(&existing_note_content_path(&paths.pages, &meta)?)
}

#[tauri::command]
pub fn notes_reveal_assets(app: AppHandle, id: String) -> Result<(), String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let index = read_notes_index(&paths.index)?;
    let asset_directory = note_asset_dir(&paths.assets, &id)?;

    find_note_meta(&index, &id)?;
    fs::create_dir_all(&asset_directory)
        .map_err(|error| format!("failed to create note asset directory: {error}"))?;
    reveal_path_in_file_manager(&asset_directory)
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
    let updated_at = current_timestamp_ms();
    let meta = update_note_meta(&mut index, &id, updated_at)?;

    write_note_content(&paths.pages, &meta, &content)?;
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
    let previous = find_note_meta(&index, &id)?;
    let meta = update_note_meta_fields(&mut index, &id, |note| {
        note.title = title.clone();
        note.path = path.clone();
        note.updated_at = updated_at;
    })?;

    move_note_content(&paths.pages, &previous, &meta)?;
    write_notes_index(&paths.index, &index)?;

    Ok(meta)
}

#[tauri::command]
pub fn notes_delete(app: AppHandle, id: String) -> Result<bool, String> {
    let id = validate_note_id(&id)?;
    let paths = notes_paths(&app)?;
    let mut index = read_notes_index(&paths.index)?;
    let original_len = index.notes.len();
    let removed_note = find_note_meta(&index, &id)?;

    index.notes.retain(|note| note.id != id);
    index.search.retain(|entry| entry.id != id);

    if index.notes.len() == original_len {
        return Ok(false);
    }

    write_notes_index(&paths.index, &index)?;

    remove_note_content(&paths.pages, &removed_note)?;

    remove_note_assets(&paths.assets, &id)?;

    Ok(true)
}

struct NotesPaths {
    assets: PathBuf,
    directory: PathBuf,
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
    let assets = directory.join("assets");

    fs::create_dir_all(&pages)
        .map_err(|error| format!("failed to create notes directory: {error}"))?;
    fs::create_dir_all(&assets)
        .map_err(|error| format!("failed to create notes asset directory: {error}"))?;

    Ok(NotesPaths {
        assets,
        directory: directory.clone(),
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

fn note_markdown_path(pages: &Path, note: &NoteMeta) -> PathBuf {
    let mut path = pages.to_path_buf();
    let mut segments = note.path.split('/').collect::<Vec<_>>();

    if segments.is_empty() {
        segments.push(&note.title);
    }

    for segment in &segments[..segments.len().saturating_sub(1)] {
        path.push(sanitize_note_file_segment(segment));
    }

    let file_name = segments
        .last()
        .map(|segment| sanitize_note_file_segment(segment))
        .filter(|segment| !segment.is_empty())
        .unwrap_or_else(|| sanitize_note_file_segment(&note.title));

    path.join(format!("{file_name}.md"))
}

fn note_folder_path(pages: &Path, folder_path: &str) -> Result<PathBuf, String> {
    let folder_path = normalize_note_path(folder_path);
    let mut path = pages.to_path_buf();

    for segment in folder_path.split('/') {
        path.push(sanitize_note_file_segment(segment));
    }

    Ok(path)
}

fn ensure_note_folder(pages: &Path, folder_path: &str) -> Result<(), String> {
    let path = note_folder_path(pages, folder_path)?;

    fs::create_dir_all(path).map_err(|error| format!("failed to create note folder: {error}"))
}

fn ensure_note_folder_tree(pages: &Path, folders: &[NoteFolderMeta]) -> Result<(), String> {
    for folder in folders {
        ensure_note_folder(pages, &folder.path)?;
    }

    Ok(())
}

fn existing_note_content_path(pages: &Path, note: &NoteMeta) -> Result<PathBuf, String> {
    let path = note_markdown_path(pages, note);

    if path.exists() {
        return Ok(path);
    }

    note_content_path(pages, &note.id)
}

fn write_note_content(pages: &Path, note: &NoteMeta, content: &str) -> Result<(), String> {
    let path = note_markdown_path(pages, note);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create note folder: {error}"))?;
    }

    fs::write(&path, content).map_err(|error| format!("failed to write note content: {error}"))?;

    let legacy_path = note_content_path(pages, &note.id)?;
    if legacy_path != path {
        match fs::remove_file(legacy_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to remove old note content: {error}")),
        }
    }

    Ok(())
}

fn move_note_content(pages: &Path, previous: &NoteMeta, current: &NoteMeta) -> Result<(), String> {
    let previous_path = existing_note_content_path(pages, previous)?;
    let current_path = note_markdown_path(pages, current);

    if previous_path == current_path {
        return Ok(());
    }

    if let Some(parent) = current_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create note folder: {error}"))?;
    }

    if current_path.exists() {
        return Err("target note file already exists".to_string());
    }

    fs::rename(&previous_path, &current_path)
        .map_err(|error| format!("failed to move note content: {error}"))?;
    remove_empty_parent_dirs(pages, previous_path.parent());
    Ok(())
}

fn remove_note_content(pages: &Path, note: &NoteMeta) -> Result<(), String> {
    let mut candidates = vec![
        note_markdown_path(pages, note),
        note_content_path(pages, &note.id)?,
    ];
    candidates.dedup();

    for path in candidates {
        let parent = path.parent().map(Path::to_path_buf);

        match fs::remove_file(&path) {
            Ok(()) => remove_empty_parent_dirs(pages, parent.as_deref()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("failed to delete note content: {error}")),
        }
    }

    Ok(())
}

fn remove_empty_parent_dirs(root: &Path, mut current: Option<&Path>) {
    while let Some(directory) = current {
        if directory == root || !directory.starts_with(root) {
            break;
        }

        match fs::remove_dir(directory) {
            Ok(()) => current = directory.parent(),
            Err(_) => break,
        }
    }
}

fn remove_empty_directory_tree(path: &Path) {
    let children = match fs::read_dir(path) {
        Ok(children) => children,
        Err(_) => return,
    };

    for child in children.flatten() {
        let child_path = child.path();

        if child_path.is_dir() {
            remove_empty_directory_tree(&child_path);
        }
    }

    let _ = fs::remove_dir(path);
}

fn sanitize_note_file_segment(segment: &str) -> String {
    let sanitized = segment
        .trim()
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*' => ' ',
            character if character.is_control() => ' ',
            character => character,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let sanitized = sanitized
        .trim_matches(['.', ' '])
        .chars()
        .take(120)
        .collect::<String>();

    if sanitized.is_empty() {
        "Untitled note".to_string()
    } else {
        sanitized
    }
}

fn note_asset_dir(assets: &Path, id: &str) -> Result<PathBuf, String> {
    let id = validate_note_id(id)?;

    Ok(assets.join(id))
}

fn remove_note_assets(assets: &Path, id: &str) -> Result<(), String> {
    let asset_directory = note_asset_dir(assets, id)?;

    match fs::remove_dir_all(asset_directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to delete note assets: {error}")),
    }
}

#[cfg(target_os = "windows")]
fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve notes path: {error}"))?;
    let mut command = std::process::Command::new("explorer.exe");

    if path.is_file() {
        command.arg(format!("/select,{}", path.to_string_lossy()));
    } else {
        command.arg(path);
    }

    command
        .spawn()
        .map_err(|error| format!("failed to open Explorer: {error}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|error| format!("failed to reveal notes path: {error}"))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    let target = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };

    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map_err(|error| format!("failed to open file manager: {error}"))?;
    Ok(())
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

fn normalize_image_mime_type(mime_type: &str) -> Result<String, String> {
    let normalized = mime_type.trim().to_ascii_lowercase();

    match normalized.as_str() {
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp" | "image/svg+xml" => {
            Ok(normalized)
        }
        _ => Err("only image attachments are supported for notes".to_string()),
    }
}

fn sanitize_asset_file_name(file_name: &str, mime_type: &str, timestamp: u64) -> String {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .filter(|extension| is_allowed_image_extension(extension))
        .unwrap_or_else(|| image_extension_from_mime_type(mime_type).to_string());
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| {
            stem.chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                        character
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
                .trim_matches('-')
                .chars()
                .take(48)
                .collect::<String>()
        })
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "image".to_string());

    format!("{stem}-{timestamp}.{extension}")
}

fn allocate_asset_file_name(directory: &Path, preferred_file_name: &str) -> String {
    if !directory.join(preferred_file_name).exists() {
        return preferred_file_name.to_string();
    }

    let path = Path::new(preferred_file_name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("png");

    for offset in 1..100_u16 {
        let candidate = format!("{stem}-{offset}.{extension}");

        if !directory.join(&candidate).exists() {
            return candidate;
        }
    }

    preferred_file_name.to_string()
}

fn is_allowed_image_extension(extension: &str) -> bool {
    matches!(
        extension,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg"
    )
}

fn image_extension_from_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "png",
    }
}

fn encode_markdown_path_segment(segment: &str) -> String {
    segment.replace(' ', "%20")
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

        let content = fs::read_to_string(existing_note_content_path(pages, &note)?)
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
