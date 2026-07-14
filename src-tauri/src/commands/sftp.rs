use std::{
    collections::HashMap,
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use russh::{client, ChannelMsg, Disconnect};
use russh_sftp::client::{fs::File as SftpRemoteFile, SftpSession};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::{mpsc, Mutex},
    task::JoinSet,
};

use crate::commands::ssh::{
    authenticate_session, ShellPilotSshClient, SshAuthRequest, SshShellTarget,
};

#[derive(Default)]
pub struct SftpSessionStore {
    sessions: Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>,
    stream_uploads: Mutex<HashMap<String, SftpUploadStream>>,
    transfers: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

struct SftpConnection {
    groups: HashMap<u32, String>,
    session: Arc<SftpSession>,
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

struct SftpUploadStream {
    cancel_flag: Arc<AtomicBool>,
    file: SftpRemoteFile,
    request: SftpTransferRequest,
    temp_remote_path: String,
    total_bytes: u64,
    transferred_bytes: u64,
}

const DOWNLOAD_CHUNK_SIZE: u64 = 256 * 1024;
const DOWNLOAD_READ_WORKERS: usize = 8;

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

    remove_remote_directory_recursive(&connection.session, path).await
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
pub async fn sftp_upload_stream_open(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    total_bytes: u64,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let cancel_flag = register_transfer(&store, &transfer_id).await?;
    let request = SftpTransferRequest {
        direction: SftpTransferDirection::Upload,
        local_path,
        panel_id,
        remote_path,
        transfer_id: transfer_id.clone(),
    };
    let temp_remote_path = format!("{}.tmp-shellpilot-{}", request.remote_path, transfer_id);
    let file_result = {
        let connection = connection.lock().await;
        connection.session.create(temp_remote_path.clone()).await
    };
    let file = match file_result {
        Ok(file) => file,
        Err(error) => {
            store.transfers.lock().await.remove(&transfer_id);
            return Err(format!("failed to create remote file: {error}"));
        }
    };

    emit_transfer_event(
        &app,
        &request,
        SftpTransferStatus::Started,
        None,
        total_bytes,
        0,
    );

    store.stream_uploads.lock().await.insert(
        transfer_id,
        SftpUploadStream {
            cancel_flag,
            file,
            request,
            temp_remote_path,
            total_bytes,
            transferred_bytes: 0,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload_stream_chunk(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let transfer_id = request
        .headers()
        .get("x-transfer-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "missing x-transfer-id header".to_string())?;
    let tauri::ipc::InvokeBody::Raw(chunk) = request.body() else {
        return Err("expected raw binary chunk body".to_string());
    };

    let mut uploads = store.stream_uploads.lock().await;
    let upload = uploads
        .get_mut(transfer_id)
        .ok_or_else(|| "stream upload is not running".to_string())?;

    if upload.cancel_flag.load(Ordering::Relaxed) {
        return Err("transfer canceled".to_string());
    }

    upload
        .file
        .write_all(chunk)
        .await
        .map_err(|error| format!("failed to write remote file: {error}"))?;
    upload.transferred_bytes += chunk.len() as u64;

    emit_transfer_event(
        &app,
        &upload.request,
        SftpTransferStatus::Progress,
        None,
        upload.total_bytes,
        upload.transferred_bytes,
    );

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload_stream_close(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    transfer_id: String,
) -> Result<(), String> {
    let upload = store
        .stream_uploads
        .lock()
        .await
        .remove(&transfer_id)
        .ok_or_else(|| "stream upload is not running".to_string())?;

    finish_stream_upload(app, store, upload, SftpTransferStatus::Completed, None).await
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
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    transfer_id: String,
) -> Result<(), String> {
    let cancel_flag = {
        let transfers = store.transfers.lock().await;
        transfers
            .get(&transfer_id)
            .cloned()
            .ok_or_else(|| "transfer is not running".to_string())?
    };

    cancel_flag.store(true, Ordering::Relaxed);

    let stream_upload = { store.stream_uploads.lock().await.remove(&transfer_id) };

    if let Some(upload) = stream_upload {
        finish_stream_upload(
            app,
            store,
            upload,
            SftpTransferStatus::Canceled,
            Some("transfer canceled".to_string()),
        )
        .await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn reveal_local_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);

    if !path.exists() {
        return Err("local path does not exist".to_string());
    }

    reveal_path_in_file_manager(&path)
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

async fn finish_stream_upload(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    mut upload: SftpUploadStream,
    status: SftpTransferStatus,
    message: Option<String>,
) -> Result<(), String> {
    let transfer_id = upload.request.transfer_id.clone();

    let flush_result = if matches!(status, SftpTransferStatus::Completed) {
        Some(upload.file.flush().await)
    } else {
        None
    };
    let shutdown_result = upload.file.shutdown().await;
    store.transfers.lock().await.remove(&transfer_id);

    if matches!(status, SftpTransferStatus::Completed) {
        if let Some(result) = flush_result {
            result.map_err(|error| format!("failed to flush remote file: {error}"))?;
        }

        shutdown_result.map_err(|error| format!("failed to close remote file: {error}"))?;

        let connection = get_sftp_connection(&store, &upload.request.panel_id).await?;
        let connection = connection.lock().await;
        finalize_stream_upload_file(
            &connection.session,
            &upload.temp_remote_path,
            &upload.request.remote_path,
            &upload.request.transfer_id,
        )
        .await?;
    } else if let Ok(connection) = get_sftp_connection(&store, &upload.request.panel_id).await {
        let connection = connection.lock().await;
        let _ = connection
            .session
            .remove_file(upload.temp_remote_path.clone())
            .await;
    }

    emit_transfer_event(
        &app,
        &upload.request,
        status,
        message,
        upload.total_bytes,
        upload.transferred_bytes,
    );

    Ok(())
}

async fn finalize_stream_upload_file(
    session: &SftpSession,
    temp_remote_path: &str,
    remote_path: &str,
    transfer_id: &str,
) -> Result<(), String> {
    if session
        .rename(temp_remote_path.to_string(), remote_path.to_string())
        .await
        .is_ok()
    {
        return Ok(());
    }

    let backup_remote_path = format!("{remote_path}.bak-shellpilot-{transfer_id}");
    let backup_result = session
        .rename(remote_path.to_string(), backup_remote_path.clone())
        .await;

    if backup_result.is_err() {
        session
            .rename(temp_remote_path.to_string(), remote_path.to_string())
            .await
            .map_err(|error| format!("failed to finalize uploaded file: {error}"))?;
        return Ok(());
    }

    match session
        .rename(temp_remote_path.to_string(), remote_path.to_string())
        .await
    {
        Ok(()) => {
            let _ = session.remove_file(backup_remote_path).await;
            Ok(())
        }
        Err(error) => {
            let restore_result = session
                .rename(backup_remote_path.clone(), remote_path.to_string())
                .await;

            if let Err(restore_error) = restore_result {
                return Err(format!(
                    "failed to finalize uploaded file: {error}; failed to restore backup: {restore_error}"
                ));
            }

            Err(format!("failed to finalize uploaded file: {error}"))
        }
    }
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
        Ok(()) => emit_transfer_event(&app, &request, SftpTransferStatus::Completed, None, 0, 0),
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
    let metadata = fs::metadata(&request.local_path)
        .await
        .map_err(|error| format!("failed to read local path metadata: {error}"))?;

    if metadata.is_dir() {
        upload_directory(app, connection, request, cancel_flag).await
    } else {
        upload_single_file(
            app,
            connection,
            request,
            &PathBuf::from(&request.local_path),
            &request.remote_path,
            metadata.len(),
            0,
            cancel_flag,
        )
        .await
        .map(|_| ())
    }
}

async fn upload_single_file(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    local_path: &Path,
    remote_path: &str,
    total_bytes: u64,
    initial_transferred_bytes: u64,
    cancel_flag: &AtomicBool,
) -> Result<u64, String> {
    let mut local_file = fs::File::open(local_path)
        .await
        .map_err(|error| format!("failed to open local file: {error}"))?;
    let connection = connection.lock().await;
    let temp_remote_path = format!("{}.tmp-shellpilot-{}", remote_path, request.transfer_id);
    let mut remote_file = connection
        .session
        .create(temp_remote_path.clone())
        .await
        .map_err(|error| format!("failed to create remote file: {error}"))?;

    let transfer_result = write_local_file_to_remote(
        app,
        request,
        &mut local_file,
        &mut remote_file,
        total_bytes,
        initial_transferred_bytes,
        cancel_flag,
    )
    .await;

    if let Err(message) = transfer_result {
        let _ = remote_file.shutdown().await;
        let _ = connection.session.remove_file(temp_remote_path).await;
        return Err(message);
    }

    let transferred_bytes = transfer_result?;

    if let Err(error) = remote_file.flush().await {
        let _ = remote_file.shutdown().await;
        let _ = connection.session.remove_file(temp_remote_path).await;
        return Err(format!("failed to flush remote file: {error}"));
    }

    if let Err(error) = remote_file.shutdown().await {
        let _ = connection.session.remove_file(temp_remote_path).await;
        return Err(format!("failed to close remote file: {error}"));
    }

    if let Err(message) = finalize_stream_upload_file(
        &connection.session,
        &temp_remote_path,
        remote_path,
        &request.transfer_id,
    )
    .await
    {
        return Err(message);
    }

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Progress,
        None,
        total_bytes,
        transferred_bytes,
    );
    Ok(transferred_bytes)
}

async fn write_local_file_to_remote(
    app: &AppHandle,
    request: &SftpTransferRequest,
    local_file: &mut fs::File,
    remote_file: &mut SftpRemoteFile,
    total_bytes: u64,
    initial_transferred_bytes: u64,
    cancel_flag: &AtomicBool,
) -> Result<u64, String> {
    let mut buffer = vec![0_u8; 256 * 1024];
    let mut transferred_bytes = initial_transferred_bytes;
    let mut last_emit = Instant::now();

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        None,
        total_bytes,
        initial_transferred_bytes,
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

    Ok(transferred_bytes)
}

async fn upload_directory(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let local_root = PathBuf::from(&request.local_path);
    let root_name = local_root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "failed to resolve local directory name".to_string())?;
    let remote_root = if request.remote_path.ends_with(root_name) {
        request.remote_path.clone()
    } else {
        join_remote_path(&request.remote_path, root_name)
    };
    let upload_plan = collect_upload_directory_plan(&local_root, &remote_root).await?;
    let total_bytes = upload_plan.files.iter().map(|file| file.size).sum();
    let mut transferred_bytes = 0_u64;

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        Some(format!("Preparing {} files", upload_plan.files.len())),
        total_bytes,
        transferred_bytes,
    );

    for remote_dir in upload_plan.directories {
        ensure_transfer_active(cancel_flag)?;
        create_remote_dir_if_missing(connection, &remote_dir).await?;
    }

    for file in upload_plan.files {
        ensure_transfer_active(cancel_flag)?;
        transferred_bytes = upload_single_file(
            app,
            connection,
            request,
            &file.local_path,
            &file.remote_path,
            total_bytes,
            transferred_bytes,
            cancel_flag,
        )
        .await?;
    }

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

struct UploadDirectoryPlan {
    directories: Vec<String>,
    files: Vec<UploadFilePlan>,
}

struct UploadFilePlan {
    local_path: PathBuf,
    remote_path: String,
    size: u64,
}

async fn collect_upload_directory_plan(
    local_root: &Path,
    remote_root: &str,
) -> Result<UploadDirectoryPlan, String> {
    let mut directories = vec![remote_root.to_string()];
    let mut files = Vec::new();
    let mut stack = vec![(local_root.to_path_buf(), remote_root.to_string())];

    while let Some((local_dir, remote_dir)) = stack.pop() {
        let mut entries = fs::read_dir(&local_dir)
            .await
            .map_err(|error| format!("failed to read local directory: {error}"))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("failed to read local directory entry: {error}"))?
        {
            let metadata = entry
                .metadata()
                .await
                .map_err(|error| format!("failed to read local entry metadata: {error}"))?;
            let filename = entry.file_name().to_string_lossy().to_string();
            let local_path = entry.path();
            let remote_path = join_remote_path(&remote_dir, &filename);

            if metadata.is_dir() {
                directories.push(remote_path.clone());
                stack.push((local_path, remote_path));
            } else if metadata.is_file() {
                files.push(UploadFilePlan {
                    local_path,
                    remote_path,
                    size: metadata.len(),
                });
            }
        }
    }

    Ok(UploadDirectoryPlan { directories, files })
}

async fn create_remote_dir_if_missing(
    connection: &Arc<Mutex<SftpConnection>>,
    remote_path: &str,
) -> Result<(), String> {
    let connection = connection.lock().await;

    match connection.session.create_dir(remote_path.to_string()).await {
        Ok(()) => Ok(()),
        Err(_) => {
            let metadata = connection
                .session
                .metadata(remote_path.to_string())
                .await
                .map_err(|error| format!("failed to create remote directory: {error}"))?;

            if metadata.is_dir() {
                Ok(())
            } else {
                Err(format!(
                    "remote path exists and is not a directory: {remote_path}"
                ))
            }
        }
    }
}

async fn download_file(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let (session, metadata) = {
        let connection = connection.lock().await;
        let metadata = connection
            .session
            .metadata(request.remote_path.clone())
            .await
            .map_err(|error| format!("failed to read remote path metadata: {error}"))?;
        (connection.session.clone(), metadata)
    };

    if metadata.is_dir() {
        download_directory(app, &session, request, cancel_flag).await
    } else {
        let file_size = metadata.size.unwrap_or(0);
        download_single_file(
            app,
            session,
            request,
            &request.remote_path,
            &PathBuf::from(&request.local_path),
            metadata.size.unwrap_or(0),
            file_size,
            0,
            cancel_flag,
        )
        .await
        .map(|_| ())
    }
}

async fn download_single_file(
    app: &AppHandle,
    session: Arc<SftpSession>,
    request: &SftpTransferRequest,
    remote_path: &str,
    local_path: &Path,
    total_bytes: u64,
    file_size: u64,
    initial_transferred_bytes: u64,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<u64, String> {
    let temp_local_path =
        make_local_sidecar_path(&local_path, "tmp-shellpilot", &request.transfer_id);
    let mut local_file = fs::File::create(&temp_local_path)
        .await
        .map_err(|error| format!("failed to create local file: {error}"))?;
    let mut transferred_bytes = initial_transferred_bytes;
    let mut last_emit = Instant::now();

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        None,
        total_bytes,
        initial_transferred_bytes,
    );

    let transfer_result: Result<(), String> = async {
        if file_size > 0 {
            let next_offset = Arc::new(AtomicU64::new(0));
            let chunk_count =
                file_size.saturating_add(DOWNLOAD_CHUNK_SIZE - 1) / DOWNLOAD_CHUNK_SIZE;
            let worker_count = usize::min(DOWNLOAD_READ_WORKERS, chunk_count as usize).max(1);
            let (chunk_tx, mut chunk_rx) =
                mpsc::channel::<Result<(u64, Vec<u8>), String>>(worker_count * 2);
            let mut workers = JoinSet::new();

            for _ in 0..worker_count {
                let worker_session = session.clone();
                let worker_remote_path = remote_path.to_string();
                let worker_next_offset = next_offset.clone();
                let worker_cancel_flag = cancel_flag.clone();
                let worker_chunk_tx = chunk_tx.clone();

                workers.spawn(async move {
                    let mut remote_file = worker_session
                        .open(worker_remote_path.clone())
                        .await
                        .map_err(|error| format!("failed to open remote file: {error}"))?;
                    let mut buffer = vec![0_u8; DOWNLOAD_CHUNK_SIZE as usize];

                    loop {
                        ensure_transfer_active(&worker_cancel_flag)?;

                        let chunk_offset =
                            worker_next_offset.fetch_add(DOWNLOAD_CHUNK_SIZE, Ordering::Relaxed);

                        if chunk_offset >= file_size {
                            break;
                        }

                        remote_file
                            .seek(SeekFrom::Start(chunk_offset))
                            .await
                            .map_err(|error| format!("failed to seek remote file: {error}"))?;

                        let mut bytes_remaining =
                            u64::min(DOWNLOAD_CHUNK_SIZE, file_size - chunk_offset) as usize;
                        let mut offset = chunk_offset;

                        while bytes_remaining > 0 {
                            ensure_transfer_active(&worker_cancel_flag)?;

                            let read_size = remote_file
                                .read(&mut buffer[..bytes_remaining])
                                .await
                                .map_err(|error| format!("failed to read remote file: {error}"))?;

                            if read_size == 0 {
                                break;
                            }

                            let data = buffer[..read_size].to_vec();
                            worker_chunk_tx
                                .send(Ok((offset, data)))
                                .await
                                .map_err(|_| "download writer stopped".to_string())?;

                            offset += read_size as u64;
                            bytes_remaining -= read_size;
                        }
                    }

                    Ok::<(), String>(())
                });
            }

            drop(chunk_tx);

            while let Some(chunk_result) = chunk_rx.recv().await {
                let (offset, data) = match chunk_result {
                    Ok(chunk) => chunk,
                    Err(message) => {
                        workers.abort_all();
                        return Err(message);
                    }
                };

                ensure_transfer_active(cancel_flag)?;

                local_file
                    .seek(SeekFrom::Start(offset))
                    .await
                    .map_err(|error| format!("failed to seek local file: {error}"))?;
                local_file
                    .write_all(&data)
                    .await
                    .map_err(|error| format!("failed to write local file: {error}"))?;

                transferred_bytes += data.len() as u64;

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

            while let Some(worker_result) = workers.join_next().await {
                match worker_result {
                    Ok(Ok(())) => {}
                    Ok(Err(message)) => return Err(message),
                    Err(error) => return Err(format!("download worker failed: {error}")),
                }
            }

            let downloaded_file_bytes = transferred_bytes.saturating_sub(initial_transferred_bytes);
            if downloaded_file_bytes != file_size {
                return Err(format!(
                    "downloaded file size mismatch: expected {file_size} bytes, received {downloaded_file_bytes} bytes"
                ));
            }
        }

        local_file
            .flush()
            .await
            .map_err(|error| format!("failed to flush local file: {error}"))?;
        Ok(())
    }
    .await;

    drop(local_file);

    if let Err(message) = transfer_result {
        let _ = fs::remove_file(&temp_local_path).await;
        return Err(message);
    }

    finalize_local_download_file(&temp_local_path, &local_path, &request.transfer_id).await?;

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Progress,
        None,
        total_bytes,
        transferred_bytes,
    );
    Ok(transferred_bytes)
}

async fn download_directory(
    app: &AppHandle,
    session: &Arc<SftpSession>,
    request: &SftpTransferRequest,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let local_root = PathBuf::from(&request.local_path);
    let download_plan =
        collect_download_directory_plan(session, &request.remote_path, &local_root).await?;
    let total_bytes = download_plan.files.iter().map(|file| file.size).sum();
    let mut transferred_bytes = 0_u64;

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        Some(format!("Preparing {} files", download_plan.files.len())),
        total_bytes,
        transferred_bytes,
    );

    for local_dir in download_plan.directories {
        ensure_transfer_active(cancel_flag)?;
        fs::create_dir_all(&local_dir)
            .await
            .map_err(|error| format!("failed to create local directory: {error}"))?;
    }

    for file in download_plan.files {
        ensure_transfer_active(cancel_flag)?;

        if let Some(parent) = file.local_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("failed to create local directory: {error}"))?;
        }

        transferred_bytes = download_single_file(
            app,
            session.clone(),
            request,
            &file.remote_path,
            &file.local_path,
            total_bytes,
            file.size,
            transferred_bytes,
            cancel_flag,
        )
        .await?;
    }

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

struct DownloadDirectoryPlan {
    directories: Vec<PathBuf>,
    files: Vec<DownloadFilePlan>,
}

struct DownloadFilePlan {
    local_path: PathBuf,
    remote_path: String,
    size: u64,
}

async fn collect_download_directory_plan(
    session: &SftpSession,
    remote_root: &str,
    local_root: &Path,
) -> Result<DownloadDirectoryPlan, String> {
    let mut directories = vec![local_root.to_path_buf()];
    let mut files = Vec::new();
    let mut stack = vec![(remote_root.to_string(), local_root.to_path_buf())];

    while let Some((remote_dir, local_dir)) = stack.pop() {
        let entries = session
            .read_dir(remote_dir.clone())
            .await
            .map_err(|error| format!("failed to list remote directory {remote_dir}: {error}"))?;

        for entry in entries {
            let filename = entry.file_name();

            if filename == "." || filename == ".." {
                continue;
            }

            let remote_path = join_remote_path(&remote_dir, &filename);
            let local_path = local_dir.join(filename);

            if entry.file_type().is_dir() {
                directories.push(local_path.clone());
                stack.push((remote_path, local_path));
            } else if entry.file_type().is_file() {
                files.push(DownloadFilePlan {
                    local_path,
                    remote_path,
                    size: entry.metadata().size.unwrap_or(0),
                });
            }
        }
    }

    Ok(DownloadDirectoryPlan { directories, files })
}

async fn finalize_local_download_file(
    temp_local_path: &Path,
    local_path: &Path,
    transfer_id: &str,
) -> Result<(), String> {
    if fs::rename(temp_local_path, local_path).await.is_ok() {
        return Ok(());
    }

    let backup_local_path = make_local_sidecar_path(local_path, "bak-shellpilot", transfer_id);
    let backup_result = fs::rename(local_path, &backup_local_path).await;

    if backup_result.is_err() {
        fs::rename(temp_local_path, local_path)
            .await
            .map_err(|error| format!("failed to finalize downloaded file: {error}"))?;
        return Ok(());
    }

    match fs::rename(temp_local_path, local_path).await {
        Ok(()) => {
            let _ = fs::remove_file(backup_local_path).await;
            Ok(())
        }
        Err(error) => {
            let restore_result = fs::rename(&backup_local_path, local_path).await;

            if let Err(restore_error) = restore_result {
                return Err(format!(
                    "failed to finalize downloaded file: {error}; failed to restore backup: {restore_error}"
                ));
            }

            Err(format!("failed to finalize downloaded file: {error}"))
        }
    }
}

fn make_local_sidecar_path(local_path: &Path, marker: &str, transfer_id: &str) -> PathBuf {
    PathBuf::from(format!(
        "{}.{marker}-{transfer_id}",
        local_path.to_string_lossy()
    ))
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

    cleanup_sftp_stream_uploads_for_panel(&store, &panel_id, connection.clone()).await;
    close_sftp_connection(connection).await;

    Ok(())
}

async fn cleanup_sftp_stream_uploads_for_panel(
    store: &State<'_, SftpSessionStore>,
    panel_id: &str,
    connection: Option<Arc<Mutex<SftpConnection>>>,
) {
    let stream_transfer_ids: Vec<String> = {
        let uploads = store.stream_uploads.lock().await;
        uploads
            .iter()
            .filter_map(|(transfer_id, upload)| {
                if upload.request.panel_id == panel_id {
                    Some(transfer_id.clone())
                } else {
                    None
                }
            })
            .collect()
    };

    for transfer_id in stream_transfer_ids {
        if let Some(mut upload) = store.stream_uploads.lock().await.remove(&transfer_id) {
            let _ = upload.file.shutdown().await;
            if let Some(connection) = connection.as_ref() {
                let connection = connection.lock().await;
                let _ = connection
                    .session
                    .remove_file(upload.temp_remote_path.clone())
                    .await;
            }
            store.transfers.lock().await.remove(&transfer_id);
        }
    }
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
        session: Arc::new(session),
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
