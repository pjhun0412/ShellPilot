use std::{
    collections::{BTreeMap, HashSet},
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;

use russh_sftp::{client::SftpSession, protocol::FileAttributes};
use tauri::AppHandle;
use tokio::{
    fs,
    io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::{mpsc, Mutex, OwnedSemaphorePermit, Semaphore},
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

const DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE: usize = 64 * 1024;

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
        let fingerprint = RemoteFileFingerprint::from_metadata(&metadata);
        download_single_file(
            app,
            session,
            request,
            &request.remote_path,
            &PathBuf::from(&request.local_path),
            fingerprint.size,
            fingerprint,
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
    remote_fingerprint: RemoteFileFingerprint,
    initial_transferred_bytes: u64,
    control: &Arc<SftpTransferControl>,
) -> Result<u64, String> {
    let file_size = remote_fingerprint.size;
    let temp_local_path =
        make_local_sidecar_path(local_path, "tmp-shellpilot", &request.download_id);
    let resume_metadata_path =
        make_local_sidecar_path(local_path, "tmp-shellpilot-meta", &request.download_id);
    let mut resume_offset =
        prepare_local_download_resume(&temp_local_path, &resume_metadata_path, remote_fingerprint)
            .await?;
    if resume_offset > 0 {
        let prefix_matches = verify_download_resume_prefix(
            &session,
            remote_path,
            &temp_local_path,
            resume_offset,
            control,
        )
        .await;

        match prefix_matches {
            Ok(true) => {}
            Ok(false) => {
                cleanup_local_download_resume(&temp_local_path, &resume_metadata_path).await?;
                resume_offset = prepare_local_download_resume(
                    &temp_local_path,
                    &resume_metadata_path,
                    remote_fingerprint,
                )
                .await?;
            }
            Err(message) => {
                if message == "transfer canceled" {
                    cleanup_local_download_resume(&temp_local_path, &resume_metadata_path).await?;
                }
                return Err(message);
            }
        }
    }
    let (mut local_file, resume_offset) =
        open_local_download_temp_file(&temp_local_path, resume_offset).await?;
    let mut transferred_bytes = initial_transferred_bytes + resume_offset;
    let mut last_emit = Instant::now();
    let mut discard_partial_download = false;

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
                mpsc::channel::<Result<(u64, Vec<u8>, OwnedSemaphorePermit), String>>(
                    worker_count * 2,
                );
            // A permit is acquired before assigning/allocating a chunk and is
            // held until that chunk is written. This bounds all in-flight and
            // reordered payload data to worker_count * DOWNLOAD_CHUNK_SIZE.
            let read_window = Arc::new(Semaphore::new(worker_count));
            let mut workers = JoinSet::new();

            for _ in 0..worker_count {
                let worker_session = session.clone();
                let worker_remote_path = remote_path.to_string();
                let worker_next_offset = next_offset.clone();
                let worker_control = control.clone();
                let worker_chunk_tx = chunk_tx.clone();
                let worker_read_window = read_window.clone();

                workers.spawn(async move {
                    let worker_result: Result<(), String> = async {
                        let mut remote_file = worker_session
                            .open(worker_remote_path.clone())
                            .await
                            .map_err(|error| format!("failed to open remote file: {error}"))?;

                        loop {
                            wait_for_transfer_resume(&worker_control).await?;

                            let permit = worker_read_window
                                .clone()
                                .acquire_owned()
                                .await
                                .map_err(|_| "download writer stopped".to_string())?;

                            let chunk_offset = worker_next_offset
                                .fetch_add(DOWNLOAD_CHUNK_SIZE, Ordering::Relaxed);

                            if chunk_offset >= file_size {
                                drop(permit);
                                break;
                            }

                            remote_file
                                .seek(SeekFrom::Start(chunk_offset))
                                .await
                                .map_err(|error| format!("failed to seek remote file: {error}"))?;

                            let chunk_size =
                                u64::min(DOWNLOAD_CHUNK_SIZE, file_size - chunk_offset) as usize;
                            let mut data = vec![0_u8; chunk_size];
                            let mut filled = 0;

                            while filled < data.len() {
                                wait_for_transfer_resume(&worker_control).await?;

                                let read_size = remote_file
                                    .read(&mut data[filled..])
                                    .await
                                    .map_err(|error| {
                                        format!("failed to read remote file: {error}")
                                    })?;

                                if read_size == 0 {
                                    return Err(format!(
                                        "remote file ended before expected size at offset {}",
                                        chunk_offset + filled as u64
                                    ));
                                }

                                filled += read_size;
                            }

                            worker_chunk_tx
                                .send(Ok((chunk_offset, data, permit)))
                                .await
                                .map_err(|_| "download writer stopped".to_string())?;
                        }

                        Ok(())
                    }
                    .await;

                    if let Err(message) = &worker_result {
                        let _ = worker_chunk_tx.send(Err(message.clone())).await;
                    }

                    worker_result
                });
            }

            drop(chunk_tx);
            let mut pending_chunks = BTreeMap::new();
            let mut next_write_offset = resume_offset;

            while let Some(chunk_result) = chunk_rx.recv().await {
                let (offset, data, permit) = match chunk_result {
                    Ok(chunk) => chunk,
                    Err(message) => {
                        workers.abort_all();
                        return Err(message);
                    }
                };

                wait_for_transfer_resume(control).await?;

                if offset < next_write_offset || pending_chunks.contains_key(&offset) {
                    workers.abort_all();
                    return Err(format!("received duplicate download chunk at offset {offset}"));
                }

                pending_chunks.insert(
                    offset,
                    BufferedDownloadChunk {
                        data,
                        _permit: permit,
                    },
                );
                let written_bytes = write_contiguous_download_chunks(
                    &mut local_file,
                    &mut pending_chunks,
                    &mut next_write_offset,
                )
                .await?;
                transferred_bytes += written_bytes;

                if written_bytes > 0 && last_emit.elapsed() >= Duration::from_millis(150) {
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

            if !pending_chunks.is_empty() {
                return Err("download chunks were not contiguous".to_string());
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

        let current_metadata = match session.metadata(remote_path.to_string()).await {
            Ok(metadata) => metadata,
            Err(error) => {
                discard_partial_download = true;
                return Err(format!("failed to verify remote file metadata: {error}"));
            }
        };

        if RemoteFileFingerprint::from_metadata(&current_metadata) != remote_fingerprint {
            discard_partial_download = true;
            return Err("remote file changed during download".to_string());
        }

        Ok(())
    }
    .await;

    drop(local_file);

    if let Err(message) = transfer_result {
        if message == "transfer canceled" || discard_partial_download {
            cleanup_local_download_resume(&temp_local_path, &resume_metadata_path).await?;
        }
        return Err(message);
    }

    finalize_local_download_file(&temp_local_path, local_path, &request.transfer_id).await?;
    let _ = fs::remove_file(&resume_metadata_path).await;

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

async fn verify_download_resume_prefix(
    session: &SftpSession,
    remote_path: &str,
    temp_local_path: &Path,
    resume_offset: u64,
    control: &SftpTransferControl,
) -> Result<bool, String> {
    wait_for_transfer_resume(control).await?;

    let mut local_file = fs::File::open(temp_local_path)
        .await
        .map_err(|error| format!("failed to open local file for resume verification: {error}"))?;
    let mut remote_file = session
        .open(remote_path.to_string())
        .await
        .map_err(|error| format!("failed to open remote file for resume verification: {error}"))?;

    compare_download_resume_prefix(&mut local_file, &mut remote_file, resume_offset, control).await
}

async fn compare_download_resume_prefix<L, R>(
    local_reader: &mut L,
    remote_reader: &mut R,
    resume_offset: u64,
    control: &SftpTransferControl,
) -> Result<bool, String>
where
    L: AsyncRead + Unpin,
    R: AsyncRead + Unpin,
{
    let mut local_buffer = vec![0_u8; DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE];
    let mut remote_buffer = vec![0_u8; DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE];
    let mut compared_bytes = 0_u64;

    while compared_bytes < resume_offset {
        wait_for_transfer_resume(control).await?;

        let compare_size = usize::try_from(u64::min(
            DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE as u64,
            resume_offset - compared_bytes,
        ))
        .expect("resume comparison size is bounded by the fixed buffer");

        local_reader
            .read_exact(&mut local_buffer[..compare_size])
            .await
            .map_err(|error| {
                format!("failed to read local file for resume verification: {error}")
            })?;
        remote_reader
            .read_exact(&mut remote_buffer[..compare_size])
            .await
            .map_err(|error| {
                format!("failed to read remote file for resume verification: {error}")
            })?;

        if local_buffer[..compare_size] != remote_buffer[..compare_size] {
            return Ok(false);
        }

        compared_bytes += compare_size as u64;
    }

    Ok(true)
}

struct BufferedDownloadChunk {
    data: Vec<u8>,
    _permit: OwnedSemaphorePermit,
}

async fn write_contiguous_download_chunks(
    local_file: &mut fs::File,
    pending_chunks: &mut BTreeMap<u64, BufferedDownloadChunk>,
    next_write_offset: &mut u64,
) -> Result<u64, String> {
    let mut written_bytes = 0_u64;

    while let Some(chunk) = pending_chunks.remove(&*next_write_offset) {
        if chunk.data.is_empty() {
            return Err(format!(
                "received empty download chunk at offset {}",
                *next_write_offset
            ));
        }

        local_file
            .seek(SeekFrom::Start(*next_write_offset))
            .await
            .map_err(|error| format!("failed to seek local file: {error}"))?;
        local_file
            .write_all(&chunk.data)
            .await
            .map_err(|error| format!("failed to write local file: {error}"))?;

        let chunk_size = chunk.data.len() as u64;
        *next_write_offset += chunk_size;
        written_bytes += chunk_size;
    }

    Ok(written_bytes)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RemoteFileFingerprint {
    modified: Option<u32>,
    size: u64,
}

impl RemoteFileFingerprint {
    fn from_metadata(metadata: &FileAttributes) -> Self {
        Self {
            modified: metadata.mtime,
            size: metadata.size.unwrap_or(0),
        }
    }

    fn can_resume(self) -> bool {
        self.modified.is_some()
    }

    fn encode(self) -> String {
        let modified = self
            .modified
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string());
        format!(
            "shellpilot-download-v1\nsize={}\nmtime={modified}\n",
            self.size
        )
    }

    fn decode(value: &str) -> Option<Self> {
        let mut lines = value.lines();
        if lines.next()? != "shellpilot-download-v1" {
            return None;
        }

        let size = lines.next()?.strip_prefix("size=")?.parse().ok()?;
        let modified = match lines.next()?.strip_prefix("mtime=")? {
            "-" => None,
            value => Some(value.parse().ok()?),
        };

        lines.next().is_none().then_some(Self { modified, size })
    }
}

async fn prepare_local_download_resume(
    temp_local_path: &Path,
    resume_metadata_path: &Path,
    remote_fingerprint: RemoteFileFingerprint,
) -> Result<u64, String> {
    if let Some(parent) = temp_local_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("failed to create local directory: {error}"))?;
    }

    reject_existing_local_symlink(temp_local_path, "partial download file").await?;
    reject_existing_local_symlink(resume_metadata_path, "download resume metadata").await?;
    let pending_metadata_path = make_resume_metadata_pending_path(resume_metadata_path);
    reject_existing_local_symlink(&pending_metadata_path, "pending download resume metadata")
        .await?;
    remove_local_download_resume_file(&pending_metadata_path, "pending download resume metadata")
        .await?;

    if let Ok(metadata) = fs::metadata(temp_local_path).await {
        let stored_fingerprint = fs::read_to_string(resume_metadata_path)
            .await
            .ok()
            .and_then(|value| RemoteFileFingerprint::decode(&value));
        let temp_size = metadata.len();

        if remote_fingerprint.can_resume()
            && stored_fingerprint == Some(remote_fingerprint)
            && temp_size <= remote_fingerprint.size
        {
            return Ok(temp_size);
        }
    }

    cleanup_local_download_resume(temp_local_path, resume_metadata_path).await?;
    write_download_resume_fingerprint(resume_metadata_path, remote_fingerprint).await?;
    Ok(0)
}

async fn write_download_resume_fingerprint(
    resume_metadata_path: &Path,
    remote_fingerprint: RemoteFileFingerprint,
) -> Result<(), String> {
    let pending_path = make_resume_metadata_pending_path(resume_metadata_path);
    let result: Result<(), std::io::Error> = async {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&pending_path)
            .await?;
        file.write_all(remote_fingerprint.encode().as_bytes())
            .await?;
        file.sync_all().await?;
        drop(file);
        fs::rename(&pending_path, resume_metadata_path).await
    }
    .await;

    if let Err(error) = result {
        let _ = fs::remove_file(&pending_path).await;
        return Err(format!(
            "failed to prepare download resume metadata: {error}"
        ));
    }

    Ok(())
}

fn make_resume_metadata_pending_path(resume_metadata_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.new", resume_metadata_path.to_string_lossy()))
}

async fn cleanup_local_download_resume(
    temp_local_path: &Path,
    resume_metadata_path: &Path,
) -> Result<(), String> {
    remove_local_download_resume_file(temp_local_path, "partial download file").await?;
    remove_local_download_resume_file(resume_metadata_path, "download resume metadata").await
}

async fn remove_local_download_resume_file(path: &Path, description: &str) -> Result<(), String> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove {description}: {error}")),
    }
}

async fn reject_existing_local_symlink(path: &Path, description: &str) -> Result<(), String> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("{description} cannot be a symbolic link"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to inspect {description}: {error}")),
    }
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
    validate_directory_download_root(&request.remote_path, &local_root)?;
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

    let local_root_parent = local_root
        .parent()
        .ok_or_else(|| "local download directory must have a parent".to_string())?;
    let canonical_parent = fs::canonicalize(local_root_parent)
        .await
        .map_err(|error| format!("failed to resolve local download parent: {error}"))?;
    fs::create_dir_all(&local_root)
        .await
        .map_err(|error| format!("failed to create local directory: {error}"))?;
    reject_local_download_directory_alias(&local_root).await?;
    let canonical_root = fs::canonicalize(&local_root)
        .await
        .map_err(|error| format!("failed to resolve local download directory: {error}"))?;
    ensure_strict_local_path_containment(&canonical_parent, &canonical_root)?;

    for local_dir in download_plan.directories {
        wait_for_transfer_resume(control).await?;
        fs::create_dir_all(&local_dir)
            .await
            .map_err(|error| format!("failed to create local directory: {error}"))?;
        reject_local_download_directory_alias(&local_dir).await?;
        let canonical_directory = fs::canonicalize(&local_dir)
            .await
            .map_err(|error| format!("failed to resolve local download directory: {error}"))?;
        ensure_local_path_containment(&canonical_root, &canonical_directory)?;
    }

    for file in download_plan.files {
        wait_for_transfer_resume(control).await?;

        let metadata = session
            .metadata(file.remote_path.clone())
            .await
            .map_err(|error| format!("failed to read remote path metadata: {error}"))?;
        let fingerprint = RemoteFileFingerprint::from_metadata(&metadata);

        if let Some(parent) = file.local_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("failed to create local directory: {error}"))?;
            reject_local_download_directory_alias(parent).await?;
            let canonical_file_parent = fs::canonicalize(parent)
                .await
                .map_err(|error| format!("failed to resolve local download directory: {error}"))?;
            ensure_local_path_containment(&canonical_root, &canonical_file_parent)?;
        }

        transferred_bytes = download_single_file(
            app,
            session.clone(),
            request,
            &file.remote_path,
            &file.local_path,
            total_bytes,
            fingerprint,
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
    let mut planned_local_paths = HashSet::new();

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

            validate_remote_download_entry_name(&filename)?;

            let remote_path = join_remote_path(&remote_dir, &filename);
            let local_path = local_dir.join(filename);
            let normalized_local_path = normalize_planned_local_path(&local_path);

            if !planned_local_paths.insert(normalized_local_path) {
                return Err(format!(
                    "remote entries map to the same local download path: {}",
                    local_path.display()
                ));
            }

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

fn validate_directory_download_root(remote_root: &str, local_root: &Path) -> Result<(), String> {
    let remote_name = remote_root
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "remote download directory name is required".to_string())?;
    validate_remote_download_entry_name(remote_name)?;

    let local_name = local_root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "local download directory name is invalid".to_string())?;

    if local_name != remote_name {
        return Err(format!(
            "remote directory name cannot be mapped safely to the local destination: {remote_name:?}"
        ));
    }

    Ok(())
}

fn validate_remote_download_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("unsafe remote download entry name: {name:?}"));
    }

    if name
        .chars()
        .any(|character| character == '/' || character == '\0' || character.is_control())
    {
        return Err(format!("unsafe remote download entry name: {name:?}"));
    }

    #[cfg(target_os = "windows")]
    {
        if name.ends_with([' ', '.'])
            || name.chars().any(|character| {
                matches!(character, '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
            })
            || is_windows_reserved_filename(name)
        {
            return Err(format!("unsafe remote download entry name: {name:?}"));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn is_windows_reserved_filename(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches([' ', '.'])
        .to_uppercase();

    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$"
    ) || stem.strip_prefix("COM").is_some_and(|suffix| {
        matches!(
            suffix,
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        )
    }) || stem.strip_prefix("LPT").is_some_and(|suffix| {
        matches!(
            suffix,
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        )
    })
}

#[cfg(target_os = "windows")]
fn normalize_planned_local_path(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

#[cfg(not(target_os = "windows"))]
fn normalize_planned_local_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn ensure_local_path_containment(root: &Path, candidate: &Path) -> Result<(), String> {
    if candidate == root || candidate.starts_with(root) {
        return Ok(());
    }

    Err(format!(
        "local download path escapes the selected directory: {}",
        candidate.display()
    ))
}

fn ensure_strict_local_path_containment(parent: &Path, candidate: &Path) -> Result<(), String> {
    if candidate != parent && candidate.starts_with(parent) {
        return Ok(());
    }

    Err(format!(
        "local download directory escapes its selected parent: {}",
        candidate.display()
    ))
}

async fn reject_local_download_directory_alias(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .await
        .map_err(|error| format!("failed to inspect local download directory: {error}"))?;

    if local_directory_metadata_is_alias(&metadata) {
        return Err(format!(
            "local download directory cannot be a symbolic link or reparse point: {}",
            path.display()
        ));
    }

    if !metadata.is_dir() {
        return Err(format!(
            "local download path is not a directory: {}",
            path.display()
        ));
    }

    Ok(())
}

fn local_directory_metadata_is_alias(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        windows_file_attributes_are_reparse_point(metadata.file_attributes())
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn windows_file_attributes_are_reparse_point(attributes: u32) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
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

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        io::Cursor,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc,
        },
    };

    use tokio::{
        io::AsyncWriteExt,
        sync::Semaphore,
        time::{timeout, Duration},
    };

    use super::{
        cleanup_local_download_resume, compare_download_resume_prefix,
        ensure_local_path_containment, ensure_strict_local_path_containment,
        get_download_resume_message, local_directory_metadata_is_alias, make_local_sidecar_path,
        make_resume_metadata_pending_path, prepare_local_download_resume,
        reject_local_download_directory_alias, validate_directory_download_root,
        validate_remote_download_entry_name, write_contiguous_download_chunks,
        BufferedDownloadChunk, RemoteFileFingerprint, SftpTransferControl,
        DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE,
    };

    #[cfg(target_os = "windows")]
    use super::windows_file_attributes_are_reparse_point;

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        async fn create() -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "shellpilot-sftp-download-test-{}-{sequence}",
                std::process::id()
            ));
            tokio::fs::create_dir_all(&path)
                .await
                .expect("test directory should be created");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn local_sidecar_path_appends_marker_and_transfer_identifier() {
        assert_eq!(
            make_local_sidecar_path(Path::new("downloads/archive.tar"), "tmp-shellpilot", "dl-7"),
            PathBuf::from("downloads/archive.tar.tmp-shellpilot-dl-7")
        );
        assert_eq!(
            make_local_sidecar_path(Path::new("downloads/archive.tar"), "bak-shellpilot", "tx-8"),
            PathBuf::from("downloads/archive.tar.bak-shellpilot-tx-8")
        );
    }

    #[test]
    fn remote_download_entry_name_rejects_path_components() {
        for name in [
            "",
            ".",
            "..",
            "../../outside.txt",
            "dir/file.txt",
            "bad\0name",
        ] {
            assert!(
                validate_remote_download_entry_name(name).is_err(),
                "hostile remote name should be rejected: {name:?}"
            );
        }

        assert_eq!(
            validate_remote_download_entry_name("한글 보고서.txt"),
            Ok(())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn remote_download_entry_name_rejects_windows_unsafe_names() {
        for name in [
            r"..\..\outside.txt",
            r"C:\outside.txt",
            r"\rooted.txt",
            "CON",
            "con.txt",
            "CON .txt",
            "CONIN$",
            "COM1.log",
            "LPT²",
            "filename.",
            "filename ",
            "stream:name",
            "wild?.txt",
            "wild*.txt",
        ] {
            assert!(
                validate_remote_download_entry_name(name).is_err(),
                "Windows-unsafe remote name should be rejected: {name:?}"
            );
        }

        assert_eq!(
            validate_remote_download_entry_name("normal file.txt"),
            Ok(())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn directory_download_root_must_preserve_the_validated_remote_name() {
        assert_eq!(
            validate_directory_download_root("/srv/reports", Path::new(r"C:\downloads\reports")),
            Ok(())
        );
        assert!(validate_directory_download_root(
            r"/srv/..\..\outside.txt",
            Path::new(r"C:\downloads\outside.txt")
        )
        .is_err());
        assert!(validate_directory_download_root(
            "/srv/reports",
            Path::new(r"C:\downloads\renamed")
        )
        .is_err());
    }

    #[test]
    fn canonical_download_paths_must_remain_inside_the_root() {
        let root = Path::new("/download/root");

        assert_eq!(ensure_local_path_containment(root, root), Ok(()));
        assert_eq!(
            ensure_local_path_containment(root, Path::new("/download/root/nested")),
            Ok(())
        );
        assert!(
            ensure_local_path_containment(root, Path::new("/download/root-escape/file")).is_err()
        );
        assert_eq!(
            ensure_strict_local_path_containment(
                Path::new("/download"),
                Path::new("/download/root")
            ),
            Ok(())
        );
        assert!(ensure_strict_local_path_containment(root, root).is_err());
        assert!(ensure_strict_local_path_containment(
            Path::new("/download"),
            Path::new("/outside/root")
        )
        .is_err());
    }

    #[tokio::test]
    async fn regular_local_download_directory_is_not_treated_as_an_alias() {
        let directory = TestDirectory::create().await;
        let metadata = tokio::fs::symlink_metadata(&directory.0)
            .await
            .expect("test directory metadata should be available");

        assert!(!local_directory_metadata_is_alias(&metadata));
        assert_eq!(
            reject_local_download_directory_alias(&directory.0).await,
            Ok(())
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_reparse_point_attribute_is_always_treated_as_an_alias() {
        assert!(!windows_file_attributes_are_reparse_point(0));
        assert!(windows_file_attributes_are_reparse_point(0x0400));
        assert!(windows_file_attributes_are_reparse_point(0x0410));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unix_symbolic_link_directory_is_rejected_as_an_alias() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::create().await;
        let target = directory.0.join("target");
        let alias = directory.0.join("alias");
        tokio::fs::create_dir(&target)
            .await
            .expect("symlink target should be created");
        symlink(&target, &alias).expect("directory symlink should be created");

        assert!(reject_local_download_directory_alias(&alias).await.is_err());
    }

    #[test]
    fn download_resume_message_is_only_present_for_nonzero_offset() {
        assert_eq!(get_download_resume_message(0), None);
        assert_eq!(
            get_download_resume_message(1536),
            Some("Resuming from 1.5 KB".to_string())
        );
    }

    #[test]
    fn remote_file_fingerprint_round_trips_and_rejects_corruption() {
        let fingerprint = RemoteFileFingerprint {
            modified: Some(1_723_456_789),
            size: 987_654_321,
        };

        assert_eq!(
            RemoteFileFingerprint::decode(&fingerprint.encode()),
            Some(fingerprint)
        );
        assert_eq!(
            RemoteFileFingerprint::decode("shellpilot-download-v1\nsize=bad\nmtime=1\n"),
            None
        );
        assert_eq!(RemoteFileFingerprint::decode("truncated"), None);
    }

    #[tokio::test]
    async fn matching_remote_prefix_is_accepted_across_bounded_buffer_reads() {
        let content = vec![b'x'; DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE + 17];
        let mut local_reader = Cursor::new(content.clone());
        let mut remote_reader = Cursor::new(content.clone());
        let control = SftpTransferControl::default();

        assert!(compare_download_resume_prefix(
            &mut local_reader,
            &mut remote_reader,
            content.len() as u64,
            &control,
        )
        .await
        .expect("matching prefix comparison should succeed"));
    }

    #[tokio::test]
    async fn changed_remote_prefix_is_rejected_even_with_the_same_length() {
        let local_content = vec![b'x'; DOWNLOAD_RESUME_COMPARE_BUFFER_SIZE + 17];
        let mut remote_content = local_content.clone();
        *remote_content
            .last_mut()
            .expect("test content should not be empty") = b'y';
        let mut local_reader = Cursor::new(local_content.clone());
        let mut remote_reader = Cursor::new(remote_content);
        let control = SftpTransferControl::default();

        assert!(!compare_download_resume_prefix(
            &mut local_reader,
            &mut remote_reader,
            local_content.len() as u64,
            &control,
        )
        .await
        .expect("different prefix comparison should complete"));
    }

    #[tokio::test]
    async fn resume_prefix_comparison_respects_pause_and_cancel() {
        let control = Arc::new(SftpTransferControl::default());
        control.pause();
        let waiter_control = control.clone();
        let waiter = tokio::spawn(async move {
            let mut local_reader = Cursor::new(b"prefix".to_vec());
            let mut remote_reader = Cursor::new(b"prefix".to_vec());
            compare_download_resume_prefix(
                &mut local_reader,
                &mut remote_reader,
                6,
                &waiter_control,
            )
            .await
        });

        tokio::task::yield_now().await;
        assert!(!waiter.is_finished(), "comparison should wait while paused");
        control.resume();
        assert_eq!(
            timeout(Duration::from_secs(1), waiter)
                .await
                .expect("resumed comparison should finish")
                .expect("comparison task should not panic"),
            Ok(true)
        );

        let canceled_control = SftpTransferControl::default();
        canceled_control.cancel();
        let mut local_reader = Cursor::new(b"prefix".to_vec());
        let mut remote_reader = Cursor::new(b"prefix".to_vec());
        assert_eq!(
            compare_download_resume_prefix(
                &mut local_reader,
                &mut remote_reader,
                6,
                &canceled_control,
            )
            .await,
            Err("transfer canceled".to_string())
        );
    }

    #[tokio::test]
    async fn matching_remote_fingerprint_resumes_existing_partial_file() {
        let directory = TestDirectory::create().await;
        let temp_path = directory.0.join("archive.tmp");
        let metadata_path = directory.0.join("archive.meta");
        let fingerprint = RemoteFileFingerprint {
            modified: Some(100),
            size: 10,
        };

        assert_eq!(
            prepare_local_download_resume(&temp_path, &metadata_path, fingerprint)
                .await
                .expect("initial resume state should be prepared"),
            0
        );
        tokio::fs::write(&temp_path, b"partial")
            .await
            .expect("partial file should be written");

        assert_eq!(
            prepare_local_download_resume(&temp_path, &metadata_path, fingerprint)
                .await
                .expect("matching resume state should be accepted"),
            7
        );
        assert_eq!(
            tokio::fs::read(&temp_path)
                .await
                .expect("partial file should remain"),
            b"partial"
        );
    }

    #[tokio::test]
    async fn cleanup_failure_is_reported_without_removing_metadata_or_final_file() {
        let directory = TestDirectory::create().await;
        let final_path = directory.0.join("archive.bin");
        let temp_path = directory.0.join("archive.tmp");
        let metadata_path = directory.0.join("archive.meta");
        tokio::fs::write(&final_path, b"existing-final")
            .await
            .expect("final file should be written");
        tokio::fs::create_dir(&temp_path)
            .await
            .expect("directory should make remove_file fail consistently");
        tokio::fs::write(&metadata_path, b"resume metadata")
            .await
            .expect("resume metadata should be written");

        let error = cleanup_local_download_resume(&temp_path, &metadata_path)
            .await
            .expect_err("partial cleanup failure must be returned");

        assert!(error.starts_with("failed to remove partial download file:"));
        assert!(temp_path.is_dir(), "failed cleanup target should remain");
        assert!(
            metadata_path.exists(),
            "metadata must remain when partial deletion fails"
        );
        assert_eq!(
            tokio::fs::read(&final_path)
                .await
                .expect("existing final file should remain readable"),
            b"existing-final"
        );
    }

    #[tokio::test]
    async fn out_of_order_chunk_never_extends_the_resumable_prefix() {
        let directory = TestDirectory::create().await;
        let temp_path = directory.0.join("archive.tmp");
        let metadata_path = directory.0.join("archive.meta");
        let fingerprint = RemoteFileFingerprint {
            modified: Some(100),
            size: 12,
        };

        prepare_local_download_resume(&temp_path, &metadata_path, fingerprint)
            .await
            .expect("initial resume state should be prepared");
        tokio::fs::write(&temp_path, b"abcd")
            .await
            .expect("contiguous prefix should be written");

        let mut local_file = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&temp_path)
            .await
            .expect("partial file should open");
        let permits = Arc::new(Semaphore::new(2));
        let mut pending_chunks = BTreeMap::new();
        let mut next_write_offset = 4;
        pending_chunks.insert(
            8,
            BufferedDownloadChunk {
                data: b"ijkl".to_vec(),
                _permit: permits
                    .clone()
                    .acquire_owned()
                    .await
                    .expect("test permit should be available"),
            },
        );

        assert_eq!(
            write_contiguous_download_chunks(
                &mut local_file,
                &mut pending_chunks,
                &mut next_write_offset,
            )
            .await
            .expect("out-of-order chunk should remain buffered"),
            0
        );
        local_file.flush().await.expect("partial file should flush");
        drop(local_file);
        drop(pending_chunks);

        assert_eq!(
            tokio::fs::metadata(&temp_path)
                .await
                .expect("partial file should exist")
                .len(),
            4
        );
        assert_eq!(
            prepare_local_download_resume(&temp_path, &metadata_path, fingerprint)
                .await
                .expect("only the contiguous prefix should resume"),
            4
        );
    }

    #[tokio::test]
    async fn changed_remote_fingerprint_discards_partial_file_and_restarts() {
        let directory = TestDirectory::create().await;
        let temp_path = directory.0.join("archive.tmp");
        let metadata_path = directory.0.join("archive.meta");
        let original = RemoteFileFingerprint {
            modified: Some(100),
            size: 10,
        };
        let changed = RemoteFileFingerprint {
            modified: Some(101),
            size: 10,
        };

        prepare_local_download_resume(&temp_path, &metadata_path, original)
            .await
            .expect("initial resume state should be prepared");
        tokio::fs::write(&temp_path, b"old-data")
            .await
            .expect("partial file should be written");
        let pending_metadata_path = make_resume_metadata_pending_path(&metadata_path);
        tokio::fs::write(&pending_metadata_path, b"stale pending metadata")
            .await
            .expect("stale pending metadata should be written");

        assert_eq!(
            prepare_local_download_resume(&temp_path, &metadata_path, changed)
                .await
                .expect("changed source should prepare a clean restart"),
            0
        );
        assert!(!temp_path.exists(), "old partial file should be discarded");
        assert_eq!(
            RemoteFileFingerprint::decode(
                &tokio::fs::read_to_string(&metadata_path)
                    .await
                    .expect("new fingerprint should be stored")
            ),
            Some(changed)
        );
        assert!(
            !pending_metadata_path.exists(),
            "atomic metadata write should not leave its pending file"
        );
    }

    #[tokio::test]
    async fn corrupt_resume_metadata_forces_a_clean_restart() {
        let directory = TestDirectory::create().await;
        let temp_path = directory.0.join("archive.tmp");
        let metadata_path = directory.0.join("archive.meta");
        let fingerprint = RemoteFileFingerprint {
            modified: Some(100),
            size: 10,
        };

        tokio::fs::write(&temp_path, b"partial")
            .await
            .expect("partial file should be written");
        tokio::fs::write(&metadata_path, b"corrupt")
            .await
            .expect("corrupt metadata should be written");

        assert_eq!(
            prepare_local_download_resume(&temp_path, &metadata_path, fingerprint)
                .await
                .expect("unsafe resume state should become a clean restart"),
            0
        );
        assert!(
            !temp_path.exists(),
            "unsafe partial file should be discarded"
        );
    }

    #[tokio::test]
    async fn missing_remote_mtime_disables_partial_file_resume() {
        let directory = TestDirectory::create().await;
        let temp_path = directory.0.join("archive.tmp");
        let metadata_path = directory.0.join("archive.meta");
        let fingerprint_without_mtime = RemoteFileFingerprint {
            modified: None,
            size: 10,
        };

        prepare_local_download_resume(&temp_path, &metadata_path, fingerprint_without_mtime)
            .await
            .expect("initial resume state should be prepared");
        tokio::fs::write(&temp_path, b"partial")
            .await
            .expect("partial file should be written");

        assert_eq!(
            prepare_local_download_resume(&temp_path, &metadata_path, fingerprint_without_mtime)
                .await
                .expect("unverifiable source should become a clean restart"),
            0
        );
        assert!(
            !temp_path.exists(),
            "partial file without a stable remote identity should be discarded"
        );
    }
}
