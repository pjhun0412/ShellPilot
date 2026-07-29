use std::collections::HashMap;

use russh_sftp::client::SftpSession;
use tauri::State;

use super::{
    connection::get_sftp_connection,
    models::{SftpEntry, SftpListResult},
    state::SftpSessionStore,
};

#[tauri::command]
pub async fn sftp_list(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    path: String,
) -> Result<SftpListResult, String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;
    let mut entries = Vec::new();

    let requested_path = normalize_remote_path(&path);
    let list_path = connection
        .session
        .canonicalize(requested_path.clone())
        .await
        .map_err(|error| {
            if requested_path == "." {
                format!("failed to resolve remote home directory: {error}")
            } else {
                format!("failed to resolve remote directory {requested_path}: {error}")
            }
        })?;
    let read_dir = connection
        .session
        .read_dir(list_path.clone())
        .await
        .map_err(|error| format!("failed to list remote directory: {error}"))?;

    for entry in read_dir {
        let filename = entry.file_name();

        if filename == "." || filename == ".." {
            continue;
        }

        let metadata = entry.metadata();
        let file_type = entry.file_type();

        entries.push(SftpEntry {
            filename: filename.to_string(),
            is_directory: file_type.is_dir(),
            kind: if file_type.is_dir() {
                "directory"
            } else if file_type.is_file() {
                "file"
            } else if file_type.is_symlink() {
                "symlink"
            } else {
                "other"
            }
            .to_string(),
            modified_at: metadata.mtime,
            owner: format_owner(
                metadata.uid,
                metadata.gid,
                &connection.users,
                &connection.groups,
            ),
            path: join_remote_path(&list_path, &filename),
            permissions: metadata.permissions.map(format_symbolic_permissions),
            size: metadata.size,
        });
    }

    entries.sort_by(|left, right| {
        right.is_directory.cmp(&left.is_directory).then_with(|| {
            left.filename
                .to_lowercase()
                .cmp(&right.filename.to_lowercase())
        })
    });

    Ok(SftpListResult {
        entries,
        path: list_path,
    })
}

#[tauri::command]

pub async fn sftp_mkdir(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    path: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;

    connection
        .session
        .create_dir(path)
        .await
        .map_err(|error| format!("failed to create remote directory: {error}"))
}

#[tauri::command]
pub async fn sftp_rename(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;

    connection
        .session
        .rename(old_path, new_path)
        .await
        .map_err(|error| format!("failed to rename remote path: {error}"))
}

#[tauri::command]
pub async fn sftp_path_exists(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    path: String,
) -> Result<bool, String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;

    match connection.session.metadata(path).await {
        Ok(_) => Ok(true),
        Err(error) if is_sftp_no_such_file_error(&error) => Ok(false),
        Err(error) => Err(format!("failed to check remote path: {error}")),
    }
}

fn is_sftp_no_such_file_error(error: &impl std::fmt::Display) -> bool {
    let message = error.to_string().to_ascii_lowercase();

    message.contains("no such file")
        || message.contains("not found")
        || message.contains("does not exist")
        || message.contains("no such path")
}

#[tauri::command]
pub async fn sftp_remove_file(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    path: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;

    connection
        .session
        .remove_file(path)
        .await
        .map_err(|error| format!("failed to remove remote file: {error}"))
}

#[tauri::command]
pub async fn sftp_remove_dir(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    path: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;

    remove_remote_directory_recursive(&connection.session, path).await
}

async fn remove_remote_directory_recursive(
    session: &SftpSession,
    root_path: String,
) -> Result<(), String> {
    let mut stack = vec![(root_path, false)];

    while let Some((current_path, visited)) = stack.pop() {
        if visited {
            session
                .remove_dir(current_path.clone())
                .await
                .map_err(|error| {
                    format!("failed to remove remote directory {current_path}: {error}")
                })?;
            continue;
        }

        let entries = session
            .read_dir(current_path.clone())
            .await
            .map_err(|error| format!("failed to list remote directory {current_path}: {error}"))?;

        stack.push((current_path.clone(), true));

        for entry in entries {
            let filename = entry.file_name();

            if filename == "." || filename == ".." {
                continue;
            }

            let child_path = join_remote_path(&current_path, &filename);

            if entry.file_type().is_dir() {
                stack.push((child_path, false));
            } else {
                session
                    .remove_file(child_path.clone())
                    .await
                    .map_err(|error| {
                        format!("failed to remove remote file {child_path}: {error}")
                    })?;
            }
        }
    }

    Ok(())
}

pub(super) fn join_remote_path(parent: &str, filename: &str) -> String {
    if parent == "/" {
        return format!("/{filename}");
    }

    format!("{}/{}", parent.trim_end_matches('/'), filename)
}

pub(super) fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return ".".to_string();
    }

    trimmed.to_string()
}

fn format_owner(
    uid: Option<u32>,
    gid: Option<u32>,
    users: &HashMap<u32, String>,
    groups: &HashMap<u32, String>,
) -> Option<String> {
    match (uid, gid) {
        (Some(uid), Some(gid)) => Some(format!(
            "{}:{}",
            users.get(&uid).cloned().unwrap_or_else(|| uid.to_string()),
            groups.get(&gid).cloned().unwrap_or_else(|| gid.to_string()),
        )),
        (Some(uid), None) => Some(users.get(&uid).cloned().unwrap_or_else(|| uid.to_string())),
        (None, Some(gid)) => Some(format!(
            ":{}",
            groups.get(&gid).cloned().unwrap_or_else(|| gid.to_string())
        )),
        (None, None) => None,
    }
}

pub(super) async fn remote_path_exists(session: &SftpSession, path: &str) -> bool {
    session.metadata(path).await.is_ok()
}

fn format_symbolic_permissions(permissions: u32) -> String {
    let user = permission_triplet(permissions, 0o400, 0o200, 0o100, 0o4000, 's');
    let group = permission_triplet(permissions, 0o040, 0o020, 0o010, 0o2000, 's');
    let other = permission_triplet(permissions, 0o004, 0o002, 0o001, 0o1000, 't');

    format!("{user}{group}{other}")
}

fn permission_triplet(
    permissions: u32,
    read_bit: u32,
    write_bit: u32,
    execute_bit: u32,
    special_bit: u32,
    special_execute: char,
) -> String {
    let read = if permissions & read_bit != 0 {
        'r'
    } else {
        '-'
    };
    let write = if permissions & write_bit != 0 {
        'w'
    } else {
        '-'
    };
    let execute = match (
        permissions & execute_bit != 0,
        permissions & special_bit != 0,
    ) {
        (true, true) => special_execute,
        (false, true) => special_execute.to_ascii_uppercase(),
        (true, false) => 'x',
        (false, false) => '-',
    };

    format!("{read}{write}{execute}")
}

#[cfg(test)]
mod tests {
    use super::{
        format_symbolic_permissions, is_sftp_no_such_file_error, join_remote_path,
        normalize_remote_path,
    };

    #[test]
    fn remote_path_normalization_maps_blank_input_to_current_directory() {
        assert_eq!(normalize_remote_path(""), ".");
        assert_eq!(normalize_remote_path(" \t\r\n"), ".");
        assert_eq!(normalize_remote_path("  /srv/data  "), "/srv/data");
    }

    #[test]
    fn remote_path_join_handles_root_and_trailing_slashes() {
        assert_eq!(join_remote_path("/", "file.txt"), "/file.txt");
        assert_eq!(
            join_remote_path("/srv/data/", "file.txt"),
            "/srv/data/file.txt"
        );
        assert_eq!(join_remote_path(".", "file.txt"), "./file.txt");
    }

    #[test]
    fn symbolic_permissions_formats_regular_and_special_bits() {
        assert_eq!(format_symbolic_permissions(0o755), "rwxr-xr-x");
        assert_eq!(format_symbolic_permissions(0o640), "rw-r-----");
        assert_eq!(format_symbolic_permissions(0o7755), "rwsr-sr-t");
        assert_eq!(format_symbolic_permissions(0o7000), "--S--S--T");
    }

    #[test]
    fn missing_remote_path_errors_are_recognized_case_insensitively() {
        for message in [
            "No Such File",
            "remote entry NOT FOUND",
            "path does not exist",
            "No Such Path",
        ] {
            assert!(
                is_sftp_no_such_file_error(&message),
                "expected missing-path error: {message}"
            );
        }

        assert!(!is_sftp_no_such_file_error(&"permission denied"));
    }
}
