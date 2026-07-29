use std::{collections::HashMap, sync::Arc, time::Duration};

use russh::{client, ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

use crate::commands::ssh::{
    authenticate_session, ShellPilotSshClient, SshAuthRequest, SshShellTarget,
};

use super::{
    state::{SftpConnection, SftpSessionStore},
    transfer::{cleanup_sftp_stream_uploads_for_panel, SFTP_REQUEST_TIMEOUT_SECS},
};

#[tauri::command]
pub async fn sftp_open(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    target: SshShellTarget,
) -> Result<(), String> {
    let panel_id = target.panel_id.clone();
    let connection = open_sftp_connection(app, target).await?;
    let previous_connection = store
        .sessions
        .lock()
        .await
        .insert(panel_id.clone(), Arc::new(Mutex::new(connection)));

    cleanup_sftp_stream_uploads_for_panel(&store, &panel_id, previous_connection.clone()).await;
    close_sftp_connection(previous_connection).await;
    Ok(())
}

#[tauri::command]

pub async fn sftp_keepalive(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let connection = connection.lock().await;

    connection
        .session
        .canonicalize(".")
        .await
        .map(|_| ())
        .map_err(|error| format!("failed to keep sftp session alive: {error}"))
}

#[tauri::command]
pub async fn sftp_close(
    store: State<'_, SftpSessionStore>,
    panel_id: String,
) -> Result<(), String> {
    let connection = store.sessions.lock().await.remove(&panel_id);

    cleanup_sftp_stream_uploads_for_panel(&store, &panel_id, connection.clone()).await;
    close_sftp_connection(connection).await;

    Ok(())
}

async fn close_sftp_connection(connection: Option<Arc<Mutex<SftpConnection>>>) {
    if let Some(connection) = connection {
        let connection = connection.lock().await;
        let _ = connection.session.close().await;
        let _ = connection
            .ssh
            .disconnect(Disconnect::ByApplication, "sftp closed", "en")
            .await;
    }
}

async fn open_sftp_connection(
    app: AppHandle,
    target: SshShellTarget,
) -> Result<SftpConnection, String> {
    let auth = SshAuthRequest::from_target(&target);
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });
    let mut ssh = client::connect(
        config,
        (target.host.as_str(), target.port),
        ShellPilotSshClient::new(
            app.clone(),
            None,
            &target.host,
            target.port,
            target.accept_new_host_key.unwrap_or(false),
            target.accepted_host_key_fingerprint.clone(),
        ),
    )
    .await
    .map_err(|error| format!("failed to open ssh transport for sftp: {error}"))?;

    authenticate_session(
        &app,
        &mut ssh,
        &target.username,
        &auth,
        crate::commands::ssh::SshCredentialScope {
            host: &target.host,
            port: target.port,
            session_id: target.session_id.as_deref(),
            username: &target.username,
        },
    )
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
    session.set_timeout(SFTP_REQUEST_TIMEOUT_SECS);
    let users = load_remote_users(&ssh).await.unwrap_or_default();
    let groups = load_remote_groups(&ssh).await.unwrap_or_default();

    Ok(SftpConnection {
        groups,
        session: Arc::new(session),
        ssh,
        users,
    })
}

pub(super) async fn get_sftp_connection(
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

async fn load_remote_users(
    ssh: &client::Handle<ShellPilotSshClient>,
) -> Result<HashMap<u32, String>, String> {
    let output = run_remote_command(ssh, "getent passwd || cat /etc/passwd").await?;
    let mut users = HashMap::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split(':').collect();

        if parts.len() < 3 {
            continue;
        }

        if let Ok(uid) = parts[2].parse::<u32>() {
            users.insert(uid, parts[0].to_string());
        }
    }

    Ok(users)
}

async fn load_remote_groups(
    ssh: &client::Handle<ShellPilotSshClient>,
) -> Result<HashMap<u32, String>, String> {
    let output = run_remote_command(ssh, "getent group || cat /etc/group").await?;
    let mut groups = HashMap::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split(':').collect();

        if parts.len() < 3 {
            continue;
        }

        if let Ok(gid) = parts[2].parse::<u32>() {
            groups.insert(gid, parts[0].to_string());
        }
    }

    Ok(groups)
}

async fn run_remote_command(
    ssh: &client::Handle<ShellPilotSshClient>,
    command: &str,
) -> Result<String, String> {
    let mut channel = ssh
        .channel_open_session()
        .await
        .map_err(|error| format!("failed to open ssh exec channel: {error}"))?;

    channel
        .exec(true, command)
        .await
        .map_err(|error| format!("failed to execute remote command: {error}"))?;

    let mut output = String::new();

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => {
                output.push_str(&String::from_utf8_lossy(&data));
            }
            ChannelMsg::ExitStatus { .. } | ChannelMsg::Eof | ChannelMsg::Close => {
                break;
            }
            _ => {}
        }
    }

    Ok(output)
}
