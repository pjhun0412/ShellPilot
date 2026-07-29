use std::{
    env,
    path::{Path, PathBuf},
};

use tokio::fs;

use super::models::{
    LocalFileEntry, LocalListResult, LocalPathMetadata, LocalRootEntry, LocalRootsResult,
};

#[tauri::command]
pub async fn local_list(path: Option<String>) -> Result<LocalListResult, String> {
    let requested_path = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(resolve_local_home_dir);
    let list_path = resolve_existing_local_directory(requested_path).await?;

    let mut read_dir = fs::read_dir(&list_path)
        .await
        .map_err(|error| format!("failed to list local directory: {error}"))?;
    let mut entries = Vec::new();

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|error| format!("failed to read local directory entry: {error}"))?
    {
        let entry_path = entry.path();
        let filename = entry.file_name().to_string_lossy().to_string();
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let file_type = metadata.file_type();
        let is_directory = metadata.is_dir();
        let kind = if is_directory {
            "directory"
        } else if metadata.is_file() {
            "file"
        } else if file_type.is_symlink() {
            "symlink"
        } else {
            "other"
        };
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs());

        entries.push(LocalFileEntry {
            filename,
            is_directory,
            kind: kind.to_string(),
            modified_at,
            path: entry_path.to_string_lossy().to_string(),
            size: metadata.is_file().then_some(metadata.len()),
        });
    }

    entries.sort_by(|left, right| {
        right.is_directory.cmp(&left.is_directory).then_with(|| {
            left.filename
                .to_lowercase()
                .cmp(&right.filename.to_lowercase())
        })
    });

    Ok(LocalListResult {
        entries,
        path: list_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn local_mkdir(parent_path: String, name: String) -> Result<(), String> {
    let directory_name = name.trim();

    if directory_name.is_empty() {
        return Err("local directory name is required".to_string());
    }

    if directory_name
        .chars()
        .any(|character| matches!(character, '/' | '\\' | '\0'))
    {
        return Err("local directory name cannot contain path separators".to_string());
    }

    let parent = resolve_existing_local_directory(PathBuf::from(parent_path)).await?;

    fs::create_dir(parent.join(directory_name))
        .await
        .map_err(|error| format!("failed to create local directory: {error}"))
}

#[tauri::command]
pub async fn local_remove_path(path: String) -> Result<(), String> {
    let target_path = validate_absolute_local_path(path)?;
    let metadata = fs::symlink_metadata(&target_path)
        .await
        .map_err(|error| format!("failed to read local path metadata: {error}"))?;

    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(&target_path)
            .await
            .map_err(|error| format!("failed to remove local directory: {error}"))
    } else {
        fs::remove_file(&target_path)
            .await
            .map_err(|error| format!("failed to remove local file: {error}"))
    }
}

#[tauri::command]
pub async fn local_path_exists(path: String) -> Result<bool, String> {
    let path = validate_absolute_local_path(path)?;

    match fs::try_exists(path).await {
        Ok(exists) => Ok(exists),
        Err(error) => Err(format!("failed to check local path: {error}")),
    }
}

#[tauri::command]
pub async fn local_path_metadata(path: String) -> Result<LocalPathMetadata, String> {
    let path = resolve_existing_local_path(PathBuf::from(path)).await?;
    let metadata = fs::metadata(path)
        .await
        .map_err(|error| format!("failed to read local path metadata: {error}"))?;

    if !metadata.is_file() {
        return Err("local path is not a file".to_string());
    }

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    Ok(LocalPathMetadata {
        modified_at,
        size: metadata.len(),
    })
}

#[tauri::command]

pub async fn local_roots() -> Result<LocalRootsResult, String> {
    Ok(LocalRootsResult {
        roots: resolve_local_roots(),
    })
}

fn validate_local_path_text(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("local path is required".to_string());
    }

    if path.contains('\0') {
        return Err("local path cannot contain NUL bytes".to_string());
    }

    Ok(())
}

pub(super) fn validate_display_local_path(path: String) -> Result<String, String> {
    validate_local_path_text(&path)?;
    Ok(path)
}

fn validate_absolute_local_path(path: String) -> Result<PathBuf, String> {
    validate_local_path_text(&path)?;
    let path = PathBuf::from(path);

    if !path.is_absolute() {
        return Err("local path must be absolute".to_string());
    }

    Ok(path)
}

pub(super) async fn resolve_existing_local_path(path: PathBuf) -> Result<PathBuf, String> {
    validate_local_path_text(&path.to_string_lossy())?;

    if !path.is_absolute() {
        return Err("local path must be absolute".to_string());
    }

    fs::canonicalize(&path)
        .await
        .map_err(|error| format!("failed to resolve local path: {error}"))
}

pub(super) async fn resolve_existing_local_directory(path: PathBuf) -> Result<PathBuf, String> {
    let path = resolve_existing_local_path(path).await?;
    let metadata = fs::metadata(&path)
        .await
        .map_err(|error| format!("failed to read local directory metadata: {error}"))?;

    if metadata.is_dir() {
        Ok(path)
    } else {
        Err(format!("local path is not a directory: {}", path.display()))
    }
}

pub(super) async fn resolve_local_download_target(path: PathBuf) -> Result<PathBuf, String> {
    validate_local_path_text(&path.to_string_lossy())?;

    if !path.is_absolute() {
        return Err("local download path must be absolute".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "local download path must have a parent directory".to_string())?;
    let parent = resolve_existing_local_directory(parent.to_path_buf()).await?;
    let filename = path
        .file_name()
        .ok_or_else(|| "local download filename is required".to_string())?;

    Ok(parent.join(filename))
}

fn resolve_local_home_dir() -> PathBuf {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg(target_os = "windows")]
fn resolve_local_roots() -> Vec<LocalRootEntry> {
    ('A'..='Z')
        .filter_map(|letter| {
            let path = format!("{letter}:\\");

            Path::new(&path).is_dir().then(|| LocalRootEntry {
                label: format!("{letter}:"),
                path,
            })
        })
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn resolve_local_roots() -> Vec<LocalRootEntry> {
    vec![LocalRootEntry {
        label: "/".to_string(),
        path: "/".to_string(),
    }]
}

#[tauri::command]
pub async fn reveal_local_path(path: String) -> Result<(), String> {
    let path = resolve_existing_local_path(PathBuf::from(path)).await?;

    reveal_path_in_file_manager(&path)
}

#[cfg(target_os = "windows")]
fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve local path: {error}"))?;
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

#[cfg(test)]
mod tests {
    use super::{
        validate_absolute_local_path, validate_display_local_path, validate_local_path_text,
    };

    #[test]
    fn local_path_text_rejects_blank_and_nul_input() {
        assert_eq!(
            validate_local_path_text(" \t\r\n").unwrap_err(),
            "local path is required"
        );
        assert_eq!(
            validate_local_path_text("valid\0invalid").unwrap_err(),
            "local path cannot contain NUL bytes"
        );
    }

    #[test]
    fn display_local_path_preserves_valid_input() {
        let path = "  relative/path  ".to_string();

        assert_eq!(validate_display_local_path(path.clone()), Ok(path));
    }

    #[test]
    fn absolute_local_path_rejects_relative_input() {
        assert_eq!(
            validate_absolute_local_path("relative/path".to_string()).unwrap_err(),
            "local path must be absolute"
        );
    }

    #[test]
    fn absolute_local_path_accepts_absolute_input() {
        let path = if cfg!(windows) {
            std::path::PathBuf::from(r"C:\\shellpilot-test")
        } else {
            std::path::PathBuf::from("/shellpilot-test")
        };

        assert_eq!(
            validate_absolute_local_path(path.to_string_lossy().into_owned()),
            Ok(path)
        );
    }
}

#[cfg(target_os = "macos")]
fn reveal_path_in_file_manager(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|error| format!("failed to reveal local path: {error}"))?;
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
