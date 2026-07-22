use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use russh_sftp::client::SftpSession;
use tauri::AppHandle;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::{mpsc, Mutex},
    task::JoinSet,
};

use super::{
    emit_transfer_event, upload::format_bytes_for_message, wait_for_transfer_resume,
    DOWNLOAD_CHUNK_SIZE, DOWNLOAD_READ_WORKERS,
};
use crate::commands::sftp::{
    models::{SftpTransferRequest, SftpTransferStatus},
    remote_ops::join_remote_path,
    state::{SftpConnection, SftpTransferControl},
};

pub(super) async fn download_file(
    app: &AppHandle,
    connection: &Arc<Mutex<SftpConnection>>,
    request: &SftpTransferRequest,
    control: &Arc<SftpTransferControl>,
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
        download_directory(app, &session, request, control).await
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
            control,
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
    control: &Arc<SftpTransferControl>,
) -> Result<u64, String> {
    let temp_local_path =
        make_local_sidecar_path(&local_path, "tmp-shellpilot", &request.download_id);
    let resume_offset = get_local_download_resume_offset(&temp_local_path, file_size).await;
    let (mut local_file, resume_offset) =
        open_local_download_temp_file(&temp_local_path, resume_offset).await?;
    let mut transferred_bytes = initial_transferred_bytes + resume_offset;
    let mut last_emit = Instant::now();

    emit_transfer_event(
        app,
        request,
        SftpTransferStatus::Started,
        get_download_resume_message(resume_offset),
        total_bytes,
        transferred_bytes,
    );

    let transfer_result: Result<(), String> = async {
        if file_size > 0 {
            let remaining_bytes = file_size.saturating_sub(resume_offset);
            let next_offset = Arc::new(AtomicU64::new(resume_offset));
            let chunk_count = remaining_bytes.saturating_add(DOWNLOAD_CHUNK_SIZE - 1) / DOWNLOAD_CHUNK_SIZE;
            let worker_count = usize::min(DOWNLOAD_READ_WORKERS, chunk_count as usize).max(1);
            let (chunk_tx, mut chunk_rx) =
                mpsc::channel::<Result<(u64, Vec<u8>), String>>(worker_count * 2);
            let mut workers = JoinSet::new();

            for _ in 0..worker_count {
                let worker_session = session.clone();
                let worker_remote_path = remote_path.to_string();
                let worker_next_offset = next_offset.clone();
                let worker_control = control.clone();
                let worker_chunk_tx = chunk_tx.clone();

                workers.spawn(async move {
                    let mut remote_file = worker_session
                        .open(worker_remote_path.clone())
                        .await
                        .map_err(|error| format!("failed to open remote file: {error}"))?;
                    let mut buffer = vec![0_u8; DOWNLOAD_CHUNK_SIZE as usize];

                    loop {
                        wait_for_transfer_resume(&worker_control).await?;

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
                            wait_for_transfer_resume(&worker_control).await?;

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

                wait_for_transfer_resume(control).await?;

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
        if message == "transfer canceled" {
            let _ = fs::remove_file(&temp_local_path).await;
        }
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

async fn get_local_download_resume_offset(temp_local_path: &Path, file_size: u64) -> u64 {
    let Ok(metadata) = fs::metadata(temp_local_path).await else {
        return 0;
    };

    let temp_size = metadata.len();

    if temp_size <= file_size {
        return temp_size;
    }

    let _ = fs::remove_file(temp_local_path).await;
    0
}

async fn open_local_download_temp_file(
    temp_local_path: &Path,
    resume_offset: u64,
) -> Result<(fs::File, u64), String> {
    if let Some(parent) = temp_local_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("failed to create local directory: {error}"))?;
    }

    if resume_offset > 0 {
        let mut resume_options = fs::OpenOptions::new();
        resume_options.create(true).write(true);

        if let Ok(mut file) = resume_options.open(temp_local_path).await {
            if file.seek(SeekFrom::Start(resume_offset)).await.is_ok() {
                return Ok((file, resume_offset));
            }
        }

        let _ = fs::remove_file(temp_local_path).await;
    }

    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(temp_local_path)
        .await
        .map_err(|error| format!("failed to create local file: {error}"))?;

    Ok((file, 0))
}

fn get_download_resume_message(resume_offset: u64) -> Option<String> {
    (resume_offset > 0)
        .then(|| format!("Resuming from {}", format_bytes_for_message(resume_offset)))
}

async fn download_directory(
    app: &AppHandle,
    session: &Arc<SftpSession>,
    request: &SftpTransferRequest,
    control: &Arc<SftpTransferControl>,
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
        wait_for_transfer_resume(control).await?;
        fs::create_dir_all(&local_dir)
            .await
            .map_err(|error| format!("failed to create local directory: {error}"))?;
    }

    for file in download_plan.files {
        wait_for_transfer_resume(control).await?;

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
