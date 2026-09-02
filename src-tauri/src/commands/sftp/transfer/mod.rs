use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

mod download;
mod upload;

use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter, State};
use tokio::{io::AsyncWriteExt, sync::Mutex};

use super::{
    connection::get_sftp_connection,
    local::{
        resolve_existing_local_path, resolve_local_download_target, validate_display_local_path,
    },
    models::{SftpTransferDirection, SftpTransferEvent, SftpTransferRequest, SftpTransferStatus},
    remote_ops::remote_path_exists,
    state::{SftpConnection, SftpSessionStore, SftpTransferControl, SftpUploadStream},
};

use download::download_file;
use upload::{
    finish_stream_upload, get_upload_resume_message, make_remote_upload_temp_path,
    open_remote_upload_file, upload_file,
};

const DOWNLOAD_CHUNK_SIZE: u64 = 256 * 1024;
const DOWNLOAD_READ_WORKERS: usize = 8;
// russh-sftp's default per-request timeout (10s) is too tight for the final
// close-ack on large files, whose server-side fsync time scales with file
// size. This gives normal requests more headroom; the real fix for the close
// step specifically is verify_remote_file_size, since no fixed number scales
// to arbitrarily large files.
pub(super) const SFTP_REQUEST_TIMEOUT_SECS: u64 = 30;
const SFTP_UPLOAD_FINALIZE_CONFIRM_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SFTP_UPLOAD_FINALIZE_RETRY_DELAY: Duration = Duration::from_secs(2);

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    panel_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    upload_id: Option<String>,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let control = register_transfer(&store, &transfer_id).await?;
    let local_path = resolve_existing_local_path(PathBuf::from(local_path))
        .await?
        .to_string_lossy()
        .to_string();

    tokio::spawn(run_sftp_transfer(
        app,
        store.inner().transfers.clone(),
        connection,
        SftpTransferRequest {
            download_id: transfer_id.clone(),
            direction: SftpTransferDirection::Upload,
            local_path,
            panel_id,
            remote_path,
            transfer_id: transfer_id.clone(),
            upload_id: upload_id.unwrap_or(transfer_id),
        },
        control,
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
    upload_id: Option<String>,
) -> Result<u64, String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let control = register_transfer(&store, &transfer_id).await?;
    let upload_id = upload_id.unwrap_or_else(|| transfer_id.clone());
    let local_path = validate_display_local_path(local_path)?;
    let request = SftpTransferRequest {
        download_id: transfer_id.clone(),
        direction: SftpTransferDirection::Upload,
        local_path,
        panel_id,
        remote_path,
        transfer_id: transfer_id.clone(),
        upload_id,
    };
    let temp_remote_path = make_remote_upload_temp_path(&request.remote_path, &request.upload_id);
    let file_result = {
        let connection = connection.lock().await;
        open_remote_upload_file(&connection.session, &temp_remote_path, total_bytes, true).await
    };
    let (file, resume_offset) = match file_result {
        Ok(result) => result,
        Err(error) => {
            store.transfers.lock().await.remove(&transfer_id);
            return Err(error);
        }
    };

    emit_transfer_event(
        &app,
        &request,
        SftpTransferStatus::Started,
        get_upload_resume_message(resume_offset),
        total_bytes,
        resume_offset,
    );

    store.stream_uploads.lock().await.insert(
        transfer_id,
        SftpUploadStream {
            control,
            file,
            request,
            temp_remote_path,
            total_bytes,
            transferred_bytes: resume_offset,
        },
    );

    Ok(resume_offset)
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

    let control = {
        let transfers = store.transfers.lock().await;
        transfers
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| "stream upload is not running".to_string())?
    };

    wait_for_transfer_resume(&control).await?;

    let mut uploads = store.stream_uploads.lock().await;
    let upload = uploads
        .get_mut(transfer_id)
        .ok_or_else(|| "stream upload is not running".to_string())?;

    wait_for_transfer_resume(&upload.control).await?;

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
    download_id: Option<String>,
) -> Result<(), String> {
    let connection = get_sftp_connection(&store, &panel_id).await?;
    let control = register_transfer(&store, &transfer_id).await?;
    let local_path = resolve_local_download_target(PathBuf::from(local_path))
        .await?
        .to_string_lossy()
        .to_string();

    tokio::spawn(run_sftp_transfer(
        app,
        store.inner().transfers.clone(),
        connection,
        SftpTransferRequest {
            download_id: download_id.unwrap_or_else(|| transfer_id.clone()),
            direction: SftpTransferDirection::Download,
            local_path,
            panel_id,
            remote_path,
            transfer_id: transfer_id.clone(),
            upload_id: transfer_id,
        },
        control,
    ));

    Ok(())
}

#[tauri::command]
pub async fn sftp_cancel_transfer(
    app: AppHandle,
    store: State<'_, SftpSessionStore>,
    transfer_id: String,
) -> Result<(), String> {
    let control = {
        let transfers = store.transfers.lock().await;
        transfers
            .get(&transfer_id)
            .cloned()
            .ok_or_else(|| "transfer is not running".to_string())?
    };

    control.cancel();

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
pub async fn sftp_pause_transfer(
    store: State<'_, SftpSessionStore>,
    transfer_id: String,
) -> Result<(), String> {
    let control = {
        let transfers = store.transfers.lock().await;
        transfers
            .get(&transfer_id)
            .cloned()
            .ok_or_else(|| "transfer is not running".to_string())?
    };

    control.pause();
    Ok(())
}

#[tauri::command]
pub async fn sftp_resume_transfer(
    store: State<'_, SftpSessionStore>,
    transfer_id: String,
) -> Result<(), String> {
    let control = {
        let transfers = store.transfers.lock().await;
        transfers
            .get(&transfer_id)
            .cloned()
            .ok_or_else(|| "transfer is not running".to_string())?
    };

    control.resume();
    Ok(())
}

async fn register_transfer(
    store: &State<'_, SftpSessionStore>,
    transfer_id: &str,
) -> Result<Arc<SftpTransferControl>, String> {
    let control = Arc::new(SftpTransferControl::default());
    let mut transfers = store.transfers.lock().await;

    if transfers.contains_key(transfer_id) {
        return Err("transfer id is already running".to_string());
    }

    transfers.insert(transfer_id.to_string(), control.clone());
    Ok(control)
}

async fn run_sftp_transfer(
    app: AppHandle,
    transfers: Arc<Mutex<HashMap<String, Arc<SftpTransferControl>>>>,
    connection: Arc<Mutex<SftpConnection>>,
    request: SftpTransferRequest,
    control: Arc<SftpTransferControl>,
) {
    let result = match request.direction {
        SftpTransferDirection::Upload => upload_file(&app, &connection, &request, &control).await,
        SftpTransferDirection::Download => {
            download_file(&app, &connection, &request, &control).await
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

async fn wait_for_transfer_resume(control: &SftpTransferControl) -> Result<(), String> {
    wait_for_transfer_resume_before_wait(control, || {}).await
}

async fn wait_for_transfer_resume_before_wait<F>(
    control: &SftpTransferControl,
    mut before_wait: F,
) -> Result<(), String>
where
    F: FnMut(),
{
    loop {
        let notified = control.notify.notified();
        tokio::pin!(notified);

        // Notify::notify_waiters does not retain a permit. Register before
        // checking the predicates so resume/cancel cannot be lost between
        // the state check and awaiting the notification.
        notified.as_mut().enable();

        if control.is_canceled() {
            return Err("transfer canceled".to_string());
        }

        if !control.is_paused() {
            return Ok(());
        }

        before_wait();
        notified.await;
    }
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

pub(super) async fn cleanup_sftp_stream_uploads_for_panel(
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

fn is_timeout_error(error: &impl std::fmt::Display) -> bool {
    error.to_string().to_ascii_lowercase().contains("timeout")
}

// A close/shutdown timeout only means the server's SSH_FXP_STATUS ack for
// SSH_FXP_CLOSE didn't arrive in time (the fixed request timeout in
// russh-sftp isn't scaled to file size, so a large file's close-time fsync
// can outrun it). It does not mean the write failed - every byte was already
// acked before we reached close. Confirm the truth via a fresh stat instead
// of guessing: if the remote file's size matches what we sent, the transfer
// genuinely succeeded regardless of the missing close ack.
async fn verify_remote_file_size(session: &SftpSession, path: &str, expected_bytes: u64) -> bool {
    matches!(session.metadata(path).await, Ok(metadata) if metadata.size == Some(expected_bytes))
}

async fn confirm_remote_file_size_with_retry(
    session: &SftpSession,
    path: &str,
    expected_bytes: u64,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;

    loop {
        if verify_remote_file_size(session, path, expected_bytes).await {
            return true;
        }

        if Instant::now() >= deadline {
            return false;
        }

        tokio::time::sleep(SFTP_UPLOAD_FINALIZE_RETRY_DELAY).await;
    }
}

async fn confirm_finalized_upload_with_retry(
    session: &SftpSession,
    temp_remote_path: &str,
    remote_path: &str,
    expected_bytes: u64,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;

    loop {
        if verify_remote_file_size(session, remote_path, expected_bytes).await
            && !remote_path_exists(session, temp_remote_path).await
        {
            return true;
        }

        if Instant::now() >= deadline {
            return false;
        }

        tokio::time::sleep(SFTP_UPLOAD_FINALIZE_RETRY_DELAY).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use tokio::time::{timeout, Duration};

    use super::{
        wait_for_transfer_resume, wait_for_transfer_resume_before_wait, SftpTransferControl,
    };

    #[tokio::test]
    async fn resume_notification_between_predicate_check_and_wait_is_not_lost() {
        let control = SftpTransferControl::default();
        control.pause();

        let result = timeout(
            Duration::from_secs(1),
            wait_for_transfer_resume_before_wait(&control, || control.resume()),
        )
        .await
        .expect("resume notification should wake the registered waiter");

        assert_eq!(result, Ok(()));
    }

    #[tokio::test]
    async fn cancel_notification_between_predicate_check_and_wait_is_not_lost() {
        let control = SftpTransferControl::default();
        control.pause();

        let result = timeout(
            Duration::from_secs(1),
            wait_for_transfer_resume_before_wait(&control, || control.cancel()),
        )
        .await
        .expect("cancel notification should wake the registered waiter");

        assert_eq!(result, Err("transfer canceled".to_string()));
    }

    #[tokio::test]
    async fn resume_releases_all_registered_waiters() {
        const WAITER_COUNT: usize = 8;

        let control = Arc::new(SftpTransferControl::default());
        let registered = Arc::new(AtomicUsize::new(0));
        let all_registered = Arc::new(tokio::sync::Notify::new());
        let mut waiters = Vec::with_capacity(WAITER_COUNT);
        control.pause();

        for _ in 0..WAITER_COUNT {
            let waiter_control = control.clone();
            let waiter_registered = registered.clone();
            let waiter_all_registered = all_registered.clone();
            waiters.push(tokio::spawn(async move {
                wait_for_transfer_resume_before_wait(&waiter_control, || {
                    if waiter_registered.fetch_add(1, Ordering::AcqRel) + 1 == WAITER_COUNT {
                        waiter_all_registered.notify_one();
                    }
                })
                .await
            }));
        }

        timeout(Duration::from_secs(1), async {
            while registered.load(Ordering::Acquire) < WAITER_COUNT {
                all_registered.notified().await;
            }
        })
        .await
        .expect("all waiters should register before resume");

        control.resume();

        for waiter in waiters {
            let result = timeout(Duration::from_secs(1), waiter)
                .await
                .expect("resume should wake every waiter")
                .expect("waiter task should not panic");
            assert_eq!(result, Ok(()));
        }

        assert_eq!(wait_for_transfer_resume(&control).await, Ok(()));
    }
}
