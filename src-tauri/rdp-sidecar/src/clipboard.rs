use core::time::Duration;
use std::fs::{self, File};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use ironrdp::cliprdr::backend::{ClipboardMessage, ClipboardMessageProxy, CliprdrBackend};
use ironrdp::cliprdr::pdu::{
    ClipboardFileAttributes, ClipboardFormat, ClipboardFormatId, ClipboardFormatName,
    ClipboardGeneralCapabilityFlags, FileContentsFlags, FileContentsRequest, FileContentsResponse,
    FileDescriptor, FormatDataRequest, LockDataId, OwnedFormatDataResponse,
};
use ironrdp::cliprdr::CliprdrClient;
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use ironrdp::svc::{impl_as_any, SvcProcessorMessages};

use crate::{AppResult, SidecarMessage};

#[derive(Debug, Clone)]
pub(crate) struct ShellPilotClipboardProxy(pub(crate) Sender<ClipboardMessage>);

impl ClipboardMessageProxy for ShellPilotClipboardProxy {
    fn send_clipboard_message(&self, message: ClipboardMessage) {
        let _ = self.0.send(message);
    }
}

#[derive(Debug)]
pub(crate) struct ShellPilotClipboardBackend {
    local_files: Arc<Mutex<Vec<LocalClipboardFile>>>,
    local_text: Arc<Mutex<Option<String>>>,
    output_tx: Sender<SidecarMessage>,
    proxy: ShellPilotClipboardProxy,
    ready: Arc<AtomicBool>,
    last_remote_file_paste_request_at: Option<Instant>,
    remote_download: Option<RemoteClipboardDownload>,
    temporary_directory: String,
}

impl_as_any!(ShellPilotClipboardBackend);

impl ShellPilotClipboardBackend {
    pub(crate) fn new(
        local_files: Arc<Mutex<Vec<LocalClipboardFile>>>,
        local_text: Arc<Mutex<Option<String>>>,
        output_tx: Sender<SidecarMessage>,
        proxy: ShellPilotClipboardProxy,
        ready: Arc<AtomicBool>,
    ) -> Self {
        Self {
            local_files,
            local_text,
            output_tx,
            proxy,
            ready,
            last_remote_file_paste_request_at: None,
            remote_download: None,
            temporary_directory: std::env::temp_dir()
                .join("shellpilot-rdp-cliprdr")
                .to_string_lossy()
                .into_owned(),
        }
    }

    fn advertise_local_text(&self) {
        let has_text = self
            .local_text
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .is_some_and(|value| !value.is_empty());

        if has_text {
            self.proxy
                .send_clipboard_message(ClipboardMessage::SendInitiateCopy(vec![
                    ClipboardFormat::new(ClipboardFormatId::CF_UNICODETEXT),
                ]));
        }
    }

    /// [MS-RDPECLIP] 3.2.5.1 requires the client to respond to Monitor Ready
    /// with its Capabilities/Format List regardless of whether it currently
    /// has anything to offer. This is what moves the channel from
    /// `Initialization` to `Ready` in ironrdp-cliprdr.
    fn send_initial_format_list(&self) {
        let formats = self
            .local_text
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .filter(|value| !value.is_empty())
            .map(|_| vec![ClipboardFormat::new(ClipboardFormatId::CF_UNICODETEXT)])
            .unwrap_or_default();

        self.proxy
            .send_clipboard_message(ClipboardMessage::SendInitiateCopy(formats));
    }

    fn local_file_for_index(&self, index: i32) -> Option<LocalClipboardFile> {
        if index < 0 {
            return None;
        }

        self.local_files
            .lock()
            .ok()
            .and_then(|files| files.get(index as usize).cloned())
    }

    fn should_request_remote_file_paste(&mut self) -> bool {
        const REMOTE_FILE_PASTE_DEBOUNCE: Duration = Duration::from_millis(1_500);

        if self.remote_download.is_some() {
            return false;
        }

        let now = Instant::now();
        if self
            .last_remote_file_paste_request_at
            .is_some_and(|previous| now.duration_since(previous) < REMOTE_FILE_PASTE_DEBOUNCE)
        {
            return false;
        }

        self.last_remote_file_paste_request_at = Some(now);
        true
    }
}

impl CliprdrBackend for ShellPilotClipboardBackend {
    fn temporary_directory(&self) -> &str {
        &self.temporary_directory
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::USE_LONG_FORMAT_NAMES
            | ClipboardGeneralCapabilityFlags::STREAM_FILECLIP_ENABLED
            | ClipboardGeneralCapabilityFlags::FILECLIP_NO_FILE_PATHS
    }

    fn on_ready(&mut self) {
        self.ready.store(true, Ordering::SeqCst);
        self.advertise_local_text();
    }

    fn on_request_format_list(&mut self) {
        self.send_initial_format_list();
    }

    fn on_process_negotiated_capabilities(
        &mut self,
        _capabilities: ClipboardGeneralCapabilityFlags,
    ) {
    }

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        if let Some(format) = available_formats.iter().find(|format| {
            format
                .name
                .as_ref()
                .is_some_and(|name| name.value() == ClipboardFormatName::FILE_LIST.value())
        }) {
            if self.should_request_remote_file_paste() {
                self.proxy
                    .send_clipboard_message(ClipboardMessage::SendInitiatePaste(format.id()));
            }
            return;
        }

        if available_formats
            .iter()
            .any(|format| format.id() == ClipboardFormatId::CF_UNICODETEXT)
        {
            self.proxy
                .send_clipboard_message(ClipboardMessage::SendInitiatePaste(
                    ClipboardFormatId::CF_UNICODETEXT,
                ));
        }
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        let response = if request.format == ClipboardFormatId::CF_UNICODETEXT {
            self.local_text
                .lock()
                .ok()
                .and_then(|value| value.clone())
                .filter(|value| !value.is_empty())
                .map(|value| OwnedFormatDataResponse::new_unicode_string(&value))
                .unwrap_or_else(OwnedFormatDataResponse::new_error)
        } else {
            OwnedFormatDataResponse::new_error()
        };

        self.proxy
            .send_clipboard_message(ClipboardMessage::SendFormatData(response));
    }

    fn on_format_data_response(&mut self, response: ironrdp::cliprdr::pdu::FormatDataResponse<'_>) {
        if response.is_error() {
            return;
        }

        if let Ok(text) = response.to_unicode_string() {
            let _ = self.output_tx.send(SidecarMessage::ClipboardText { text });
        }
    }

    fn on_file_contents_request(&mut self, request: FileContentsRequest) {
        let Some(file) = self.local_file_for_index(request.index) else {
            self.proxy
                .send_clipboard_message(ClipboardMessage::SendFileContentsResponse(
                    FileContentsResponse::new_error(request.stream_id),
                ));
            return;
        };

        let response = match create_file_contents_response(&file.path, &request) {
            Ok(response) => response,
            Err(_) => FileContentsResponse::new_error(request.stream_id),
        };

        self.proxy
            .send_clipboard_message(ClipboardMessage::SendFileContentsResponse(response));
    }

    fn on_remote_file_list(&mut self, files: &[FileDescriptor], clip_data_id: Option<u32>) {
        match RemoteClipboardDownload::new(files, clip_data_id) {
            Ok(mut download) => {
                if let Err(error) = download.advance(&self.proxy) {
                    let _ = self.output_tx.send(SidecarMessage::ClipboardError {
                        message: format!("RDP clipboard file download failed: {error}"),
                    });
                    return;
                }

                if download.pending.is_none() {
                    let paths = download
                        .top_paths
                        .iter()
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect::<Vec<_>>();
                    let _ = self
                        .output_tx
                        .send(SidecarMessage::ClipboardFiles { paths });
                    return;
                }

                self.remote_download = Some(download);
            }
            Err(error) => {
                let _ = self.output_tx.send(SidecarMessage::ClipboardError {
                    message: format!("RDP clipboard file download failed: {error}"),
                });
            }
        }
    }

    fn on_file_contents_response(&mut self, response: FileContentsResponse<'_>) {
        let Some(download) = self.remote_download.as_mut() else {
            return;
        };

        match download.handle_response(&response, &self.proxy) {
            Ok(Some(paths)) => {
                let _ = self
                    .output_tx
                    .send(SidecarMessage::ClipboardFiles { paths });
                self.remote_download = None;
            }
            Ok(None) => {}
            Err(error) => {
                let _ = self.output_tx.send(SidecarMessage::ClipboardError {
                    message: format!("RDP clipboard file download failed: {error}"),
                });
                self.remote_download = None;
            }
        }
    }

    fn on_lock(&mut self, _data_id: LockDataId) {}

    fn on_unlock(&mut self, _data_id: LockDataId) {}
}

#[derive(Debug, Clone)]
pub(crate) struct LocalClipboardFile {
    pub(crate) descriptor: FileDescriptor,
    path: PathBuf,
}

#[derive(Debug)]
struct RemoteClipboardDownload {
    data_id: Option<u32>,
    files: Vec<RemoteClipboardFile>,
    next_stream_id: u32,
    pending: Option<PendingRemoteChunk>,
    top_paths: Vec<PathBuf>,
}

#[derive(Debug)]
struct RemoteClipboardFile {
    is_directory: bool,
    path: PathBuf,
    position: u64,
    size: u64,
}

#[derive(Debug)]
struct PendingRemoteChunk {
    file_index: usize,
    position: u64,
    stream_id: u32,
}

impl RemoteClipboardDownload {
    const CHUNK_SIZE: u32 = 256 * 1024;

    fn new(files: &[FileDescriptor], data_id: Option<u32>) -> AppResult<Self> {
        let root = std::env::temp_dir().join(format!(
            "shellpilot-rdp-remote-clip-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        fs::create_dir_all(&root)?;

        let mut remote_files = Vec::new();
        let mut top_paths = Vec::new();

        for descriptor in files {
            let Some(relative_path) = safe_remote_clipboard_path(descriptor) else {
                continue;
            };
            let target_path = root.join(&relative_path);
            let is_directory = descriptor
                .attributes
                .is_some_and(|attributes| attributes.contains(ClipboardFileAttributes::DIRECTORY));

            if descriptor.relative_path.is_none() {
                top_paths.push(target_path.clone());
            }

            if is_directory {
                fs::create_dir_all(&target_path)?;
            } else {
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                File::create(&target_path)?;
            }

            remote_files.push(RemoteClipboardFile {
                is_directory,
                path: target_path,
                position: 0,
                size: descriptor.file_size.unwrap_or(0),
            });
        }

        Ok(Self {
            data_id,
            files: remote_files,
            next_stream_id: 1,
            pending: None,
            top_paths,
        })
    }

    fn advance(&mut self, proxy: &ShellPilotClipboardProxy) -> AppResult<()> {
        if self.pending.is_some() {
            return Ok(());
        }

        loop {
            let Some((file_index, file)) = self
                .files
                .iter()
                .enumerate()
                .find(|(_, file)| !file.is_directory && file.position < file.size)
            else {
                return Ok(());
            };

            let remaining = file.size.saturating_sub(file.position);
            let requested_size = remaining.min(u64::from(Self::CHUNK_SIZE)) as u32;

            if requested_size == 0 {
                if let Some(file) = self.files.get_mut(file_index) {
                    file.position = file.size;
                }
                continue;
            }

            let stream_id = self.next_stream_id;
            self.next_stream_id = self.next_stream_id.saturating_add(1).max(1);
            let position = file.position;
            self.pending = Some(PendingRemoteChunk {
                file_index,
                position,
                stream_id,
            });
            proxy.send_clipboard_message(ClipboardMessage::SendFileContentsRequest(
                FileContentsRequest {
                    stream_id,
                    index: file_index as i32,
                    flags: FileContentsFlags::RANGE,
                    position,
                    requested_size,
                    data_id: self.data_id,
                },
            ));
            return Ok(());
        }
    }

    fn handle_response(
        &mut self,
        response: &FileContentsResponse<'_>,
        proxy: &ShellPilotClipboardProxy,
    ) -> AppResult<Option<Vec<String>>> {
        let Some(pending) = self.pending.take() else {
            return Ok(None);
        };

        if pending.stream_id != response.stream_id() {
            self.pending = Some(pending);
            return Ok(None);
        }

        if response.is_error() {
            return Err("remote file contents request failed".into());
        }

        let Some(file) = self.files.get_mut(pending.file_index) else {
            return Err("remote file index is out of bounds".into());
        };

        let mut output = File::options().write(true).open(&file.path)?;
        output.seek(SeekFrom::Start(pending.position))?;
        output.write_all(response.data())?;
        file.position = pending
            .position
            .saturating_add(response.data().len() as u64);

        self.advance(proxy)?;

        if self.pending.is_some() {
            return Ok(None);
        }

        let paths = self
            .top_paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        Ok(Some(paths))
    }
}

pub(crate) fn process_clipboard_message(
    active_stage: &mut ActiveStage,
    message: ClipboardMessage,
) -> AppResult<Vec<ActiveStageOutput>> {
    let Some(cliprdr) = active_stage.get_svc_processor_mut::<CliprdrClient>() else {
        return Ok(Vec::new());
    };

    let messages = match message {
        ClipboardMessage::SendInitiateCopy(formats) => cliprdr.initiate_copy(&formats)?,
        ClipboardMessage::SendFormatData(response) => cliprdr.submit_format_data(response)?,
        ClipboardMessage::SendInitiatePaste(format) => cliprdr.initiate_paste(format)?,
        ClipboardMessage::SendFileContentsRequest(request) => {
            cliprdr.request_file_contents(request)?
        }
        ClipboardMessage::SendFileContentsResponse(response) => {
            cliprdr.submit_file_contents(response)?
        }
        ClipboardMessage::Error(error) => return Err(error),
    };
    let frame = active_stage.process_svc_processor_messages(
        SvcProcessorMessages::<CliprdrClient>::new(messages.into()),
    )?;

    Ok(vec![ActiveStageOutput::ResponseFrame(frame)])
}

pub(crate) fn process_clipboard_file_copy(
    active_stage: &mut ActiveStage,
    descriptors: Vec<FileDescriptor>,
) -> AppResult<Vec<ActiveStageOutput>> {
    let Some(cliprdr) = active_stage.get_svc_processor_mut::<CliprdrClient>() else {
        return Ok(Vec::new());
    };

    let messages = cliprdr.initiate_file_copy(descriptors)?;
    let frame = active_stage.process_svc_processor_messages(
        SvcProcessorMessages::<CliprdrClient>::new(messages.into()),
    )?;

    Ok(vec![ActiveStageOutput::ResponseFrame(frame)])
}

pub(crate) fn create_local_clipboard_files(paths: &[String]) -> AppResult<Vec<LocalClipboardFile>> {
    let mut files = Vec::new();

    for path in paths {
        let path = PathBuf::from(path);
        let Some(name) = path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned)
        else {
            continue;
        };

        collect_local_clipboard_path(&path, None, name, &mut files)?;
    }

    Ok(files)
}

fn collect_local_clipboard_path(
    path: &Path,
    relative_path: Option<String>,
    name: String,
    files: &mut Vec<LocalClipboardFile>,
) -> AppResult<()> {
    let metadata = match path.symlink_metadata() {
        Ok(metadata) if !metadata.file_type().is_symlink() => metadata,
        _ => return Ok(()),
    };

    if metadata.is_file() {
        files.push(LocalClipboardFile {
            descriptor: create_file_descriptor(name, relative_path, &metadata, false),
            path: path.to_path_buf(),
        });
        return Ok(());
    }

    if !metadata.is_dir() {
        return Ok(());
    }

    files.push(LocalClipboardFile {
        descriptor: create_file_descriptor(name.clone(), relative_path.clone(), &metadata, true),
        path: path.to_path_buf(),
    });

    let child_relative_path = match relative_path {
        Some(parent) if !parent.is_empty() => format!("{parent}\\{name}"),
        _ => name,
    };

    for entry in path.read_dir()? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let child_path = entry.path();
        let Some(child_name) = child_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned)
        else {
            continue;
        };

        collect_local_clipboard_path(
            &child_path,
            Some(child_relative_path.clone()),
            child_name,
            files,
        )?;
    }

    Ok(())
}

fn create_file_descriptor(
    name: String,
    relative_path: Option<String>,
    metadata: &std::fs::Metadata,
    is_directory: bool,
) -> FileDescriptor {
    let attributes = if is_directory {
        ClipboardFileAttributes::DIRECTORY
    } else {
        ClipboardFileAttributes::ARCHIVE
    };
    let mut descriptor = FileDescriptor::new(name)
        .with_attributes(attributes)
        .with_file_size(if is_directory { 0 } else { metadata.len() });

    if let Some(relative_path) = relative_path.filter(|value| !value.is_empty()) {
        descriptor = descriptor.with_relative_path(relative_path);
    }

    if let Ok(modified) = metadata.modified() {
        descriptor = descriptor.with_last_write_time(system_time_to_windows_filetime(modified));
    }

    descriptor
}

fn create_file_contents_response(
    path: &Path,
    request: &FileContentsRequest,
) -> AppResult<FileContentsResponse<'static>> {
    let metadata = path.metadata()?;

    if request.flags.contains(FileContentsFlags::SIZE) {
        return Ok(FileContentsResponse::new_size_response(
            request.stream_id,
            if metadata.is_dir() { 0 } else { metadata.len() },
        ));
    }

    if metadata.is_dir() {
        return Err("cannot read directory clipboard contents".into());
    }

    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(request.position))?;

    let mut buffer = vec![0_u8; request.requested_size as usize];
    let read = file.read(&mut buffer)?;
    buffer.truncate(read);

    Ok(FileContentsResponse::new_data_response(
        request.stream_id,
        buffer,
    ))
}

fn system_time_to_windows_filetime(time: SystemTime) -> u64 {
    const WINDOWS_TICK: u64 = 10_000_000;
    const SEC_TO_UNIX_EPOCH: u64 = 11_644_473_600;

    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    (duration.as_secs() + SEC_TO_UNIX_EPOCH) * WINDOWS_TICK
        + u64::from(duration.subsec_nanos() / 100)
}

fn safe_remote_clipboard_path(descriptor: &FileDescriptor) -> Option<PathBuf> {
    let mut path = PathBuf::new();

    if let Some(relative_path) = descriptor.relative_path.as_deref() {
        for part in relative_path.split(['\\', '/']) {
            if !push_safe_path_component(&mut path, part) {
                return None;
            }
        }
    }

    if !push_safe_path_component(&mut path, &descriptor.name) {
        return None;
    }

    Some(path)
}

fn push_safe_path_component(path: &mut PathBuf, component: &str) -> bool {
    let component = component.trim();

    if component.is_empty()
        || component == "."
        || component == ".."
        || component.contains(':')
        || component.contains('\0')
    {
        return false;
    }

    path.push(component);
    true
}
