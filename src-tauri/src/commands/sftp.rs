use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use russh::{client, ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

use crate::commands::ssh::{
    authenticate_session, ShellPilotSshClient, SshAuthRequest, SshShellTarget,
};

#[derive(Default)]
pub struct SftpSessionStore {
    sessions: Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>,
    transfers: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

struct SftpConnection {
    groups: HashMap<u32, String>,
    session: SftpSession,
    ssh: client::Handle<ShellPilotSshClient>,
    users: HashMap<u32, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    filename: String,
    owner: Option<String>,
    is_directory: bool,
    kind: String,
    modified_at: Option<u32>,
    path: String,
    permissions: Option<String>,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpListResult {
    entries: Vec<SftpEntry>,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferEvent {
    direction: SftpTransferDirection,
    message: Option<String>,
    panel_id: String,
    remote_path: String,
    local_path: String,
    status: SftpTransferStatus,
    total_bytes: u64,
    transferred_bytes: u64,
    transfer_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferDirection {
    Download,
    Upload,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferStatus {
    Canceled,
    Completed,
    Failed,
    Progress,
    Started,
}

struct SftpTransferRequest {
    direction: SftpTransferDirection,
    local_path: String,
    panel_id: String,
    remote_path: String,
    transfer_id: String,
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

    let requested_path = normalize_remote_path(&path);
    let is_home_path = requested_path == ".";
    let list_path = if is_home_path {
        connection
            .session
            .canonicalize(".")
            .await
            .map_err(|error| format!("failed to resolve remote home directory: {error}"))?
    } else {
        requested_path.clone()
    };
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
pub async fn sftp_upload(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let cancel_flag = register_transfer(&store, &transfer_id).await?;

    tokio::spawn(run_sftp_transfer(
        app,
        store.inner().transfers.clone(),
        connection,
        SftpTransferRequest {
            direction: SftpTransferDirection::Upload,
            local_path,
            panel_id,
            remote_path,
            transfer_id,
        },
        cancel_flag,
    ));

    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let cancel_flag = register_transfer(&store, &transfer_id).await?;

    tokio::spawn(run_sftp_transfer(
        app,
        store.inner().transfers.clone(),
        connection,
        SftpTransferRequest {
            direction: SftpTransferDirection::Download,
            local_path,
            panel_id,
            remote_path,
            transfer_id,
        },
        cancel_flag,
    ));

    Ok(())
}

#[tauri::command]
pub async fn sftp_cancel_transfer(
    store: State<'_, SftpSessionStore>,
    transfer_id: String,
) -> Result<(), String> {
    let transfers = store.transfers.lock().await;
    let cancel_flag = transfers
        .get(&transfer_id)
        .ok_or_else(|| "transfer is not running".to_string())?;

    cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

async fn register_transfer(
    store: &State<'_, SftpSessionStore>,
    transfer_id: &str,
) -> Result<Arc<AtomicBool>, String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let mut transfers = store.transfers.lock().await;

    if transfers.contains_key(transfer_id) {
        return Err("transfer id is already running".to_string());
    }

    transfers.insert(transfer_id.to_string(), cancel_flag.clone());
    Ok(cancel_flag)
}

async fn run_sftp_transfer(
    app: AppHandle,
    transfers: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    connection: Arc<Mutex<SftpConnection>>,
    request: SftpTransferRequest,
    cancel_flag: Arc<AtomicBool>,
) {
    let result = match request.direction {
        SftpTransferDirection::Upload => {
            upload_file(&app, &connection, &request, &cancel_flag).await
        }
        SftpTransferDirection::Download => {
            download_file(&app, &connection, &request, &cancel_flag).await
        }
    };

    transfers.lock().await.remove(&request.transfer_id);

    match result {
        Ok(()) => emit_transfer_event(
            &app,
            &request,
            SftpTransferStatus::Completed,
            None,
            0,
            0,
        ),
        Err(message) if message == "transfer canceled" => emit_transfer_event(
            &app,
            &request,
            SftpTransferStatus::Canceled,
            Some(message),
            0,
            0,
        ),
        Err(message) => emit_transfer_event(
            &app,
            &request,
            SftpTransferStatus::Failed,
            Some(message),
            0,
            0,
        ),
    }
}

async fn upload_file(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let total_bytes = fs::metadata(&request.local_path)
        .await
        .map_err(|error| format!("failed to read local file metadata: {error}"))?
        .len();
    let mut local_file = fs::File::open(&request.local_path)
        .await
        .map_err(|error| format!("failed to open local file: {error}"))?;
    let connection = connection.lock().await;
    let mut remote_file = connection
        .session
        .create(request.remote_path.clone())
        .await
        .map_err(|error| format!("failed to create remote file: {error}"))?;
    let mut buffer = vec![0_u8; 256 * 1024];
    let mut transferred_bytes = 0_u64;
    let mut last_emit = Instant::now();

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        None,
        total_bytes,
        transferred_bytes,
    );

    loop {
        ensure_transfer_active(cancel_flag)?;

        let read_size = local_file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("failed to read local file: {error}"))?;

        if read_size == 0 {
            break;
        }

        remote_file
            .write_all(&buffer[..read_size])
            .await
            .map_err(|error| format!("failed to write remote file: {error}"))?;

        transferred_bytes += read_size as u64;

        if last_emit.elapsed() >= Duration::from_millis(150) {
            emit_transfer_event(
                app,
                request,
                SftpTransferStatus::Progress,
                None,
                total_bytes,
                transferred_bytes,
            );
            last_emit = Instant::now();
        }
    }

    remote_file
        .flush()
        .await
        .map_err(|error| format!("failed to flush remote file: {error}"))?;
    remote_file
        .shutdown()
        .await
        .map_err(|error| format!("failed to close remote file: {error}"))?;

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Progress,
        None,
        total_bytes,
        transferred_bytes,
    );
    Ok(())
}

async fn download_file(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let connection = connection.lock().await;
    let mut remote_file = connection
        .session
        .open(request.remote_path.clone())
        .await
        .map_err(|error| format!("failed to open remote file: {error}"))?;
    let total_bytes = remote_file
        .metadata()
        .await
        .ok()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0);
    let mut local_file = fs::File::create(&request.local_path)
        .await
        .map_err(|error| format!("failed to create local file: {error}"))?;
    let mut buffer = vec![0_u8; 256 * 1024];
    let mut transferred_bytes = 0_u64;
    let mut last_emit = Instant::now();

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        None,
        total_bytes,
        transferred_bytes,
    );

    loop {
        ensure_transfer_active(cancel_flag)?;

        let read_size = remote_file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("failed to read remote file: {error}"))?;

        if read_size == 0 {
            break;
        }

        local_file
            .write_all(&buffer[..read_size])
            .await
            .map_err(|error| format!("failed to write local file: {error}"))?;

        transferred_bytes += read_size as u64;

        if last_emit.elapsed() >= Duration::from_millis(150) {
            emit_transfer_event(
                app,
                request,
                SftpTransferStatus::Progress,
                None,
                total_bytes,
                transferred_bytes,
            );
            last_emit = Instant::now();
        }
    }

    local_file
        .flush()
        .await
        .map_err(|error| format!("failed to flush local file: {error}"))?;

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Progress,
        None,
        total_bytes,
        transferred_bytes,
    );
    Ok(())
}

fn ensure_transfer_active(cancel_flag: &AtomicBool) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("transfer canceled".to_string());
    }

    Ok(())
}

fn emit_transfer_event(
    app: &AppHandle,
    request: &SftpTransferRequest,
    status: SftpTransferStatus,
    message: Option<String>,
    total_bytes: u64,
    transferred_bytes: u64,
) {
    let _ = app.emit(
        "shellpilot-sftp-transfer",
        SftpTransferEvent {
            direction: request.direction.clone(),
            local_path: request.local_path.clone(),
            message,
            panel_id: request.panel_id.clone(),
            remote_path: request.remote_path.clone(),
            status,
            total_bytes,
            transferred_bytes,
            transfer_id: request.transfer_id.clone(),
        },
    );
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
    let users = load_remote_users(&ssh).await.unwrap_or_default();
    let groups = load_remote_groups(&ssh).await.unwrap_or_default();

    Ok(SftpConnection {
        groups,
        session,
        ssh,
        users,
    })
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

fn normalize_remote_path(path: &str) -> String {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return ".".to_string();
    }

    trimmed.to_string()
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

fn format_owner(
    uid: Option<u32>,
    gid: Option<u32>,
    users: &HashMap<u32, String>,
    groups: &HashMap<u32, String>,
) -> Option<String> {
    match (uid, gid) {
        (Some(uid), Some(gid)) => Some(format!(
            "{}:{}",
            users
                .get(&uid)
                .cloned()
                .unwrap_or_else(|| uid.to_string()),
            groups
                .get(&gid)
                .cloned()
                .unwrap_or_else(|| gid.to_string()),
        )),
        (Some(uid), None) => Some(users.get(&uid).cloned().unwrap_or_else(|| uid.to_string())),
        (None, Some(gid)) => Some(format!(
            ":{}",
            groups.get(&gid).cloned().unwrap_or_else(|| gid.to_string())
        )),
        (None, None) => None,
    }
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
    let read = if permissions & read_bit != 0 { 'r' } else { '-' };
    let write = if permissions & write_bit != 0 { 'w' } else { '-' };
    let execute = match (permissions & execute_bit != 0, permissions & special_bit != 0) {
        (true, true) => special_execute,
        (false, true) => special_execute.to_ascii_uppercase(),
        (true, false) => 'x',
        (false, false) => '-',
    };

    format!("{read}{write}{execute}")
}
