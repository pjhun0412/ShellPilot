use std::{collections::HashMap, sync::Arc, time::Duration};

use russh::{client, Disconnect};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::commands::ssh::{
    authenticate_session, ShellPilotSshClient, SshAuthRequest, SshShellTarget,
};

#[derive(Default)]
pub struct SftpSessionStore {
    sessions: Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>,
}

struct SftpConnection {
    session: SftpSession,
    ssh: client::Handle<ShellPilotSshClient>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    filename: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListResult {
    entries: Vec<SftpEntry>,
    path: String,
}

#[tauri::command]
pub async fn sftp_open(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    target: SshShellTarget,
) -> Result<(), String> {
    sftp_close(store.clone(), target.panel_id.clone()).await?;

    let panel_id = target.panel_id.clone();
    let connection = open_sftp_connection(app, target).await?;

    store
        .sessions
        .lock()
        .await
        .insert(panel_id, Arc::new(Mutex::new(connection)));
    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    path: String,
) -> Result<SftpListResult, String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;
    let mut entries = Vec::new();

    for entry in connection
        .session
        .read_dir(path.clone())
        .await
        .map_err(|error| format!("failed to list remote directory: {error}"))?
    {
        let filename = entry.file_name();

        if filename == "." || filename == ".." {
            continue;
        }

        entries.push(SftpEntry {
            path: join_remote_path(&path, &filename),
            filename: filename.to_string(),
        });
    }

    entries.sort_by(|left, right| left.filename.cmp(&right.filename));

    Ok(SftpListResult { entries, path })
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

    connection
        .session
        .remove_dir(path)
        .await
        .map_err(|error| format!("failed to remove remote directory: {error}"))
}

#[tauri::command]
pub async fn sftp_close(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
) -> Result<(), String> {
    let connection = store.sessions.lock().await.remove(&panel_id);

    if let Some(connection) = connection {
        let connection = connection.lock().await;
        let _ = connection.session.close().await;
        let _ = connection
            .ssh
            .disconnect(Disconnect::ByApplication, "sftp closed", "en")
            .await;
    }

    Ok(())
}

async fn open_sftp_connection(
    app: AppHandle,
    target: SshShellTarget,
) -> Result<SftpConnection, String> {
    let auth = SshAuthRequest::from_target(&target);
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });
    let mut ssh = client::connect(
        config,
        (target.host.as_str(), target.port),
        ShellPilotSshClient::new(
            app,
            None,
            &target.host,
            target.port,
            target.accept_new_host_key.unwrap_or(false),
        ),
    )
    .await
    .map_err(|error| format!("failed to open ssh transport for sftp: {error}"))?;

    authenticate_session(&mut ssh, &target.username, &auth)
        .await
        .map_err(|error| {
            format!(
                "failed to authenticate sftp session using {}: {error}",
                auth.label()
            )
        })?;

    let channel = ssh
        .channel_open_session()
        .await
        .map_err(|error| format!("failed to open sftp channel: {error}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|error| format!("failed to request sftp subsystem: {error}"))?;
    let session = SftpSession::new(channel.into_stream())
        .await
        .map_err(|error| format!("failed to initialize sftp session: {error}"))?;

    Ok(SftpConnection { session, ssh })
}

async fn get_sftp_connection(
    store: &State<'_, SftpSessionStore>,
    panel_id: &str,
) -> Result<Arc<Mutex<SftpConnection>>, String> {
    store
        .sessions
        .lock()
        .await
        .get(panel_id)
        .cloned()
        .ok_or_else(|| "sftp session is not open".to_string())
}

fn join_remote_path(parent: &str, filename: &str) -> String {
    if parent == "/" {
        return format!("/{filename}");
    }

    format!("{}/{}", parent.trim_end_matches('/'), filename)
}
