use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use russh_sftp::{
    client::{fs::File as SftpRemoteFile, SftpSession},
    protocol::OpenFlags,
};
use tauri::{AppHandle, State};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::Mutex,
};

use super::{
    confirm_finalized_upload_with_retry, confirm_remote_file_size_with_retry, emit_transfer_event,
    is_timeout_error, wait_for_transfer_resume, SFTP_UPLOAD_FINALIZE_CONFIRM_TIMEOUT,
    SFTP_UPLOAD_FINALIZE_RETRY_DELAY,
};
use crate::commands::sftp::{
    connection::get_sftp_connection,
    models::{SftpTransferRequest, SftpTransferStatus},
    remote_ops::join_remote_path,
    state::{SftpConnection, SftpSessionStore, SftpTransferControl, SftpUploadStream},
};

pub(super) async fn finish_stream_upload(
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
            if let Err(error) = result {
                if !is_timeout_error(&error) {
                    return Err(format!("failed to flush remote file: {error}"));
                }
            }
        }

        let connection = get_sftp_connection(&store, &upload.request.panel_id).await?;
        let connection = connection.lock().await;

        if let Err(error) = shutdown_result {
            let closed_on_server = is_timeout_error(&error)
                && confirm_remote_file_size_with_retry(
                    &connection.session,
                    &upload.temp_remote_path,
                    upload.transferred_bytes,
                    SFTP_UPLOAD_FINALIZE_CONFIRM_TIMEOUT,
                )
                .await;

            if !closed_on_server {
                return Err(format!("failed to close remote file: {error}"));
            }
        }

        finalize_stream_upload_file(
            &connection.session,
            &upload.temp_remote_path,
            &upload.request.remote_path,
            &upload.request.transfer_id,
            upload.transferred_bytes,
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
    expected_bytes: u64,
) -> Result<(), String> {
    let deadline = Instant::now() + SFTP_UPLOAD_FINALIZE_CONFIRM_TIMEOUT;
    let backup_remote_path = format!("{remote_path}.bak-shellpilot-{transfer_id}");
    let mut last_error = None;

    while Instant::now() < deadline {
        match finalize_stream_upload_file_once(
            session,
            temp_remote_path,
            remote_path,
            &backup_remote_path,
        )
        .await
        {
            Ok(()) => {
                if confirm_remote_file_size_with_retry(
                    session,
                    remote_path,
                    expected_bytes,
                    SFTP_UPLOAD_FINALIZE_CONFIRM_TIMEOUT,
                )
                .await
                {
                    let _ = session.remove_file(backup_remote_path.clone()).await;
                    return Ok(());
                }

                last_error = Some(
                    "uploaded file finalized but final size could not be confirmed".to_string(),
                );
            }
            Err(error) => {
                if confirm_finalized_upload_with_retry(
                    session,
                    temp_remote_path,
                    remote_path,
                    expected_bytes,
                    SFTP_UPLOAD_FINALIZE_RETRY_DELAY,
                )
                .await
                {
                    let _ = session.remove_file(backup_remote_path.clone()).await;
                    return Ok(());
                }

                last_error = Some(error);
            }
        }

        tokio::time::sleep(SFTP_UPLOAD_FINALIZE_RETRY_DELAY).await;
    }

    if confirm_finalized_upload_with_retry(
        session,
        temp_remote_path,
        remote_path,
        expected_bytes,
        SFTP_UPLOAD_FINALIZE_RETRY_DELAY,
    )
    .await
    {
        let _ = session.remove_file(backup_remote_path).await;
        return Ok(());
    }

    Err(last_error.unwrap_or_else(|| "failed to finalize uploaded file".to_string()))
}

async fn finalize_stream_upload_file_once(
    session: &SftpSession,
    temp_remote_path: &str,
    remote_path: &str,
    backup_remote_path: &str,
) -> Result<(), String> {
    match session
        .rename(temp_remote_path.to_string(), remote_path.to_string())
        .await
    {
        Ok(()) => return Ok(()),
        Err(error) if is_timeout_error(&error) => {
            return Err(format!("failed to finalize uploaded file: {error}"));
        }
        Err(_) => {}
    }

    match session
        .rename(remote_path.to_string(), backup_remote_path.to_string())
        .await
    {
        Ok(()) => {}
        Err(error) if is_timeout_error(&error) => {
            return Err(format!("failed to prepare remote overwrite: {error}"));
        }
        Err(_) => {
            session
                .rename(temp_remote_path.to_string(), remote_path.to_string())
                .await
                .map_err(|error| format!("failed to finalize uploaded file: {error}"))?;
            return Ok(());
        }
    }

    match session
        .rename(temp_remote_path.to_string(), remote_path.to_string())
        .await
    {
        Ok(()) => {
            let _ = session.remove_file(backup_remote_path.to_string()).await;
            Ok(())
        }
        Err(error) if is_timeout_error(&error) => {
            Err(format!("failed to finalize uploaded file: {error}"))
        }
        Err(error) => {
            let restore_result = session
                .rename(backup_remote_path.to_string(), remote_path.to_string())
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

pub(super) async fn upload_file(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    control: &SftpTransferControl,
) -> Result<(), String> {
    let metadata = fs::metadata(&request.local_path)
        .await
        .map_err(|error| format!("failed to read local path metadata: {error}"))?;

    if metadata.is_dir() {
        upload_directory(app, connection, request, control).await
    } else {
        upload_single_file(
            app,
            connection,
            request,
            &PathBuf::from(&request.local_path),
            &request.remote_path,
            metadata.len(),
            0,
            control,
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
    control: &SftpTransferControl,
) -> Result<u64, String> {
    let mut local_file = fs::File::open(local_path)
        .await
        .map_err(|error| format!("failed to open local file: {error}"))?;
    let connection = connection.lock().await;
    let temp_remote_path = make_remote_upload_temp_path(remote_path, &request.upload_id);
    let (mut remote_file, resume_offset) = open_remote_upload_file(
        &connection.session,
        &temp_remote_path,
        total_bytes - initial_transferred_bytes,
        true,
    )
    .await?;

    if resume_offset > 0 {
        local_file
            .seek(SeekFrom::Start(resume_offset))
            .await
            .map_err(|error| format!("failed to seek local file for resume: {error}"))?;
    }

    let transfer_result = write_local_file_to_remote(
        app,
        request,
        &mut local_file,
        &mut remote_file,
        total_bytes,
        initial_transferred_bytes + resume_offset,
        control,
    )
    .await;

    if let Err(message) = transfer_result {
        let _ = remote_file.shutdown().await;
        if message == "transfer canceled" {
            let _ = connection.session.remove_file(temp_remote_path).await;
        }
        return Err(message);
    }

    let transferred_bytes = transfer_result?;

    let flush_result = remote_file.flush().await;

    if let Err(error) = remote_file.shutdown().await {
        let this_file_bytes = transferred_bytes - initial_transferred_bytes;
        let closed_on_server = is_timeout_error(&error)
            && confirm_remote_file_size_with_retry(
                &connection.session,
                &temp_remote_path,
                this_file_bytes,
                SFTP_UPLOAD_FINALIZE_CONFIRM_TIMEOUT,
            )
            .await;

        if !closed_on_server {
            return Err(format!("failed to close remote file: {error}"));
        }
    }

    if let Err(error) = flush_result {
        if !is_timeout_error(&error) {
            return Err(format!("failed to flush remote file: {error}"));
        }
    }

    if let Err(message) = finalize_stream_upload_file(
        &connection.session,
        &temp_remote_path,
        remote_path,
        &request.transfer_id,
        transferred_bytes - initial_transferred_bytes,
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

pub(super) async fn open_remote_upload_file(
    session: &SftpSession,
    temp_remote_path: &str,
    expected_bytes: u64,
    resume: bool,
) -> Result<(SftpRemoteFile, u64), String> {
    if resume {
        if let Ok(metadata) = session.metadata(temp_remote_path.to_string()).await {
            let remote_size = metadata.size.unwrap_or(0);

            if remote_size <= expected_bytes {
                let file_result = session
                    .open_with_flags(temp_remote_path.to_string(), OpenFlags::WRITE)
                    .await;

                match file_result {
                    Ok(mut file) => {
                        if file.seek(SeekFrom::Start(remote_size)).await.is_ok() {
                            return Ok((file, remote_size));
                        }
                    }
                    Err(_) => {}
                }

                let _ = session.remove_file(temp_remote_path.to_string()).await;
            } else {
                let _ = session.remove_file(temp_remote_path.to_string()).await;
            }
        }
    }

    let file = session
        .create(temp_remote_path.to_string())
        .await
        .map_err(|error| format!("failed to create remote file: {error}"))?;

    Ok((file, 0))
}

pub(super) fn make_remote_upload_temp_path(remote_path: &str, upload_id: &str) -> String {
    format!("{remote_path}.tmp-shellpilot-{upload_id}")
}

pub(super) fn get_upload_resume_message(resume_offset: u64) -> Option<String> {
    (resume_offset > 0)
        .then(|| format!("Resuming from {}", format_bytes_for_message(resume_offset)))
}

pub(super) fn format_bytes_for_message(size: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];

    if size < 1024 {
        return format!("{size} B");
    }

    let mut value = size as f64 / 1024.0;
    let mut unit_index = 0;

    while value >= 1024.0 && unit_index < UNITS.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }

    if value >= 10.0 {
        format!("{value:.0} {}", UNITS[unit_index])
    } else {
        format!("{value:.1} {}", UNITS[unit_index])
    }
}

#[cfg(test)]
mod tests {
    use super::{
        format_bytes_for_message, get_upload_resume_message, make_remote_upload_temp_path,
    };

    #[test]
    fn remote_upload_temp_path_appends_upload_identifier() {
        assert_eq!(
            make_remote_upload_temp_path("/srv/archive.tar", "upload-42"),
            "/srv/archive.tar.tmp-shellpilot-upload-42"
        );
    }

    #[test]
    fn byte_format_uses_expected_units_and_precision() {
        assert_eq!(format_bytes_for_message(0), "0 B");
        assert_eq!(format_bytes_for_message(1023), "1023 B");
        assert_eq!(format_bytes_for_message(1024), "1.0 KB");
        assert_eq!(format_bytes_for_message(9 * 1024), "9.0 KB");
        assert_eq!(format_bytes_for_message(10 * 1024), "10 KB");
        assert_eq!(format_bytes_for_message(1536), "1.5 KB");
        assert_eq!(format_bytes_for_message(1024 * 1024 - 1), "1024 KB");
        assert_eq!(format_bytes_for_message(1024 * 1024), "1.0 MB");
        assert_eq!(format_bytes_for_message(1024 * 1024 * 1024), "1.0 GB");
        assert_eq!(format_bytes_for_message(1024_u64.pow(4)), "1.0 TB");
    }

    #[test]
    fn upload_resume_message_is_only_present_for_nonzero_offset() {
        assert_eq!(get_upload_resume_message(0), None);
        assert_eq!(
            get_upload_resume_message(1536),
            Some("Resuming from 1.5 KB".to_string())
        );
    }
}

async fn write_local_file_to_remote(
    app: &AppHandle,
    request: &SftpTransferRequest,
    local_file: &mut fs::File,
    remote_file: &mut SftpRemoteFile,
    total_bytes: u64,
    initial_transferred_bytes: u64,
    control: &SftpTransferControl,
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
        wait_for_transfer_resume(control).await?;

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
    control: &SftpTransferControl,
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
        wait_for_transfer_resume(control).await?;
        create_remote_dir_if_missing(connection, &remote_dir).await?;
    }

    for file in upload_plan.files {
        wait_for_transfer_resume(control).await?;
        transferred_bytes = upload_single_file(
            app,
            connection,
            request,
            &file.local_path,
            &file.remote_path,
            total_bytes,
            transferred_bytes,
            control,
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
