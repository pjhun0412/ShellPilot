use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write as _};
#[cfg(windows)]
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
#[cfg(windows)]
use std::{ffi::OsString, ptr};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

use crate::commands::credentials::read_credential_secret;

#[derive(Default)]
pub struct RdpSessionStore {
    next_run_id: AtomicU64,
    sessions: Mutex<HashMap<String, RdpSessionHandle>>,
}

struct RdpSessionHandle {
    run_id: u64,
    tx: mpsc::UnboundedSender<RdpSessionCommand>,
}

enum RdpSessionCommand {
    Close,
    Input(String),
}

/// Wire shape sent to the sidecar's stdin as one JSON line per input event.
/// Mirrors `InputMessage` in `rdp-sidecar/src/main.rs` — keep the two in sync.
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RdpInput {
    MouseMove {
        x: u16,
        y: u16,
    },
    MouseButton {
        x: u16,
        y: u16,
        button: String,
        down: bool,
    },
    MouseWheel {
        x: u16,
        y: u16,
        delta: i16,
    },
    Key {
        code: u8,
        extended: bool,
        down: bool,
    },
    PasteText {
        text: String,
    },
    ClipboardText {
        text: String,
    },
    ClipboardFiles {
        paths: Vec<String>,
    },
    Resize {
        width: u16,
        height: u16,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpTarget {
    accept_new_certificate: Option<bool>,
    credential_id: Option<String>,
    desktop_height: Option<u16>,
    desktop_width: Option<u16>,
    domain: Option<String>,
    host: String,
    panel_id: String,
    password: Option<String>,
    port: u16,
    username: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RdpEvent {
    certificate_fingerprint: Option<String>,
    code: Option<String>,
    desktop_height: Option<u16>,
    desktop_width: Option<u16>,
    message: Option<String>,
    panel_id: String,
    retryable: bool,
    status: RdpStatus,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum RdpStatus {
    Closed,
    Connected,
    Connecting,
    Failed,
    FrameReady,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RdpFrameEvent {
    data: String,
    height: u16,
    panel_id: String,
    sequence: u64,
    width: u16,
    x: u16,
    y: u16,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpKnownCertificates {
    hosts: HashMap<String, RdpKnownCertificateEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RdpKnownCertificateEntry {
    fingerprint: String,
}

enum RdpCertificateDecision {
    Trusted,
    TrustedNew,
}

struct RdpCertificateFailure {
    code: &'static str,
    message: String,
    retryable: bool,
}

/// Wire shape the sidecar prints as one JSON line per stdout message. Mirrors
/// `SidecarMessage` in `rdp-sidecar/src/main.rs` — keep the two in sync.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SidecarMessage {
    Connected {
        desktop_width: u16,
        desktop_height: u16,
        certificate_fingerprint: Option<String>,
    },
    Frame {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        data: String,
    },
    ClipboardText {
        text: String,
    },
    ClipboardFiles {
        paths: Vec<String>,
    },
    ClipboardError {
        message: String,
    },
    DisplayResized {
        desktop_width: u16,
        desktop_height: u16,
    },
    DisplayResizeError {
        message: String,
    },
}

enum SidecarOutput {
    Connected {
        desktop_width: u16,
        desktop_height: u16,
        certificate_fingerprint: Option<String>,
    },
    Frame {
        data: String,
        height: u16,
        sequence: u64,
        width: u16,
        x: u16,
        y: u16,
    },
    ClipboardText {
        text: String,
    },
    ClipboardFiles {
        paths: Vec<String>,
    },
    ClipboardError {
        message: String,
    },
    DisplayResized {
        desktop_width: u16,
        desktop_height: u16,
    },
    DisplayResizeError {
        message: String,
    },
    Exited {
        message: String,
    },
}

type SidecarChild = Arc<StdMutex<Child>>;

#[tauri::command]
pub async fn rdp_open(
    app: AppHandle,
    store: State<'_, RdpSessionStore>,
    target: RdpTarget,
) -> Result<(), String> {
    rdp_close(store.clone(), target.panel_id.clone()).await?;

    let (tx, rx) = mpsc::unbounded_channel();
    let panel_id = target.panel_id.clone();
    let run_id = store.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;

    store
        .sessions
        .lock()
        .await
        .insert(panel_id, RdpSessionHandle { run_id, tx });

    tauri::async_runtime::spawn(async move {
        run_rdp_session(app, target, run_id, rx).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn rdp_close(store: State<'_, RdpSessionStore>, panel_id: String) -> Result<(), String> {
    let handle = store.sessions.lock().await.remove(&panel_id);

    if let Some(handle) = handle {
        let _ = handle.tx.send(RdpSessionCommand::Close);
    }

    Ok(())
}

#[tauri::command]
pub async fn rdp_send_input(
    store: State<'_, RdpSessionStore>,
    panel_id: String,
    input: RdpInput,
) -> Result<(), String> {
    let sessions = store.sessions.lock().await;

    if let Some(handle) = sessions.get(&panel_id) {
        let line = serde_json::to_string(&input).map_err(|error| error.to_string())?;
        let _ = handle.tx.send(RdpSessionCommand::Input(line));
    }

    Ok(())
}

#[tauri::command]
pub async fn rdp_paste_clipboard_files(
    store: State<'_, RdpSessionStore>,
    panel_id: String,
) -> Result<usize, String> {
    let paths = read_clipboard_file_paths()?;

    if paths.is_empty() {
        return Ok(0);
    }

    let count = paths.len();
    let input = RdpInput::ClipboardFiles { paths };
    let line = serde_json::to_string(&input).map_err(|error| error.to_string())?;
    let sessions = store.sessions.lock().await;

    if let Some(handle) = sessions.get(&panel_id) {
        let _ = handle.tx.send(RdpSessionCommand::Input(line));
        Ok(count)
    } else {
        Err("RDP session is not connected.".to_string())
    }
}

#[tauri::command]
pub fn rdp_set_local_clipboard_text(text: String) -> Result<(), String> {
    write_clipboard_text(&text)
}

#[tauri::command]
pub fn rdp_forget_certificate(app: AppHandle, host: String, port: u16) -> Result<bool, String> {
    let path = rdp_known_certificates_path(&app)?;
    let mut known = read_rdp_known_certificates(&path)?;
    let removed = known
        .hosts
        .remove(&rdp_certificate_key(&host, port))
        .is_some();

    write_rdp_known_certificates(&path, &known)?;

    Ok(removed)
}

async fn run_rdp_session(
    app: AppHandle,
    target: RdpTarget,
    run_id: u64,
    mut rx: mpsc::UnboundedReceiver<RdpSessionCommand>,
) {
    let panel_id = target.panel_id.clone();
    let certificate_host = target.host.clone();
    let certificate_port = target.port;
    let accept_new_certificate = target.accept_new_certificate.unwrap_or(false);
    emit_rdp_event(
        &app,
        &panel_id,
        RdpStatus::Connecting,
        None,
        Some("starting embedded RDP session".to_string()),
        true,
        None,
        None,
    );

    let spawned = tokio::task::spawn_blocking(move || spawn_rdp_sidecar(target))
        .await
        .map_err(|error| format!("RDP worker failed: {error}"))
        .and_then(|value| value);

    let (child, mut stdin, mut stdout_rx) = match spawned {
        Ok(value) => value,
        Err(error) => {
            emit_rdp_event(
                &app,
                &panel_id,
                RdpStatus::Failed,
                Some(classify_rdp_error(&error).to_string()),
                Some(error),
                true,
                None,
                None,
            );
            cleanup_rdp_session(&app, &panel_id, run_id).await;
            return;
        }
    };

    let mut frame_ready_sent = false;

    loop {
        tokio::select! {
            message = stdout_rx.recv() => {
                match message {
                    Some(SidecarOutput::Connected {
                        desktop_width,
                        desktop_height,
                        certificate_fingerprint,
                    }) => {
                        match verify_or_trust_rdp_certificate(
                            &app,
                            &certificate_host,
                            certificate_port,
                            certificate_fingerprint.as_deref(),
                            accept_new_certificate,
                        ) {
                            Ok(RdpCertificateDecision::Trusted | RdpCertificateDecision::TrustedNew) => {}
                            Err(error) => {
                                if let Ok(mut guard) = child.lock() {
                                    let _ = guard.kill();
                                }

                                emit_rdp_event(
                                    &app,
                                    &panel_id,
                                    RdpStatus::Failed,
                                    Some(error.code.to_string()),
                                    Some(error.message),
                                    error.retryable,
                                    None,
                                    certificate_fingerprint,
                                );
                                break;
                            }
                        }

                        emit_rdp_event(
                            &app,
                            &panel_id,
                            RdpStatus::Connected,
                            None,
                            Some("IronRDP session established.".to_string()),
                            true,
                            Some((desktop_width, desktop_height)),
                            certificate_fingerprint,
                        );
                    }
                    Some(SidecarOutput::Frame { data, height, sequence, width, x, y }) => {
                        if !frame_ready_sent {
                            frame_ready_sent = true;
                            emit_rdp_event(
                                &app,
                                &panel_id,
                                RdpStatus::FrameReady,
                                None,
                                Some("Receiving desktop frames.".to_string()),
                                true,
                                None,
                                None,
                            );
                        }

                        emit_rdp_frame(&app, &panel_id, sequence, x, y, width, height, data);
                    }
                    Some(SidecarOutput::ClipboardText { text }) => {
                        emit_rdp_clipboard_text(&app, &panel_id, text);
                    }
                    Some(SidecarOutput::ClipboardFiles { paths }) => {
                        let count = paths.len();
                        if let Err(error) = write_clipboard_file_paths(&paths) {
                            emit_rdp_event(
                                &app,
                                &panel_id,
                                RdpStatus::Failed,
                                Some("clipboard_failed".to_string()),
                                Some(error),
                                true,
                                None,
                                None,
                            );
                        } else {
                            emit_rdp_event(
                                &app,
                                &panel_id,
                                RdpStatus::Connected,
                                None,
                                Some(format!(
                                    "Copied {count} RDP clipboard file{} to the local clipboard.",
                                    if count == 1 { "" } else { "s" }
                                )),
                                true,
                                None,
                                None,
                            );
                        }
                    }
                    Some(SidecarOutput::ClipboardError { message }) => {
                        emit_rdp_event(
                            &app,
                            &panel_id,
                            RdpStatus::Connected,
                            Some("clipboard_failed".to_string()),
                            Some(message),
                            true,
                            None,
                            None,
                        );
                    }
                    Some(SidecarOutput::DisplayResized { desktop_width, desktop_height }) => {
                        emit_rdp_event(
                            &app,
                            &panel_id,
                            RdpStatus::Connected,
                            None,
                            Some(format!("Remote display resized to {desktop_width}x{desktop_height}.")),
                            true,
                            Some((desktop_width, desktop_height)),
                            None,
                        );
                    }
                    Some(SidecarOutput::DisplayResizeError { message }) => {
                        emit_rdp_event(
                            &app,
                            &panel_id,
                            RdpStatus::Connected,
                            Some("display_resize_failed".to_string()),
                            Some(message),
                            true,
                            None,
                            None,
                        );
                    }
                    Some(SidecarOutput::Exited { message }) => {
                        emit_rdp_event(
                            &app,
                            &panel_id,
                            RdpStatus::Failed,
                            Some(classify_rdp_error(&message).to_string()),
                            Some(message),
                            true,
                            None,
                            None,
                        );
                        break;
                    }
                    None => {
                        emit_rdp_event(&app, &panel_id, RdpStatus::Closed, None, None, true, None, None);
                        break;
                    }
                }
            }
            command = rx.recv() => {
                match command {
                    Some(RdpSessionCommand::Input(line)) => {
                        let _ = writeln!(stdin, "{line}");
                    }
                    Some(RdpSessionCommand::Close) | None => {
                        if let Ok(mut guard) = child.lock() {
                            let _ = guard.kill();
                        }

                        emit_rdp_event(&app, &panel_id, RdpStatus::Closed, None, None, true, None, None);
                        break;
                    }
                }
            }
        }
    }

    cleanup_rdp_session(&app, &panel_id, run_id).await;
}

async fn cleanup_rdp_session(app: &AppHandle, panel_id: &str, run_id: u64) {
    let store = app.state::<RdpSessionStore>();
    let mut sessions = store.sessions.lock().await;

    if sessions
        .get(panel_id)
        .is_some_and(|handle| handle.run_id == run_id)
    {
        sessions.remove(panel_id);
    }
}

/// Spawns the sidecar as a long-lived child (not `.output()`, which only
/// returns after the process exits) and hands back the `Child` so the caller
/// can kill it on disconnect, plus a channel that yields one `SidecarOutput`
/// per stdout line the sidecar prints, for as long as the process runs.
fn spawn_rdp_sidecar(
    target: RdpTarget,
) -> Result<
    (
        SidecarChild,
        ChildStdin,
        mpsc::UnboundedReceiver<SidecarOutput>,
    ),
    String,
> {
    let password = resolve_password(&target)?;
    validate_sidecar_secret_line(&password)?;
    let binary_path = resolve_rdp_sidecar_binary()?;
    let mut command = Command::new(binary_path);

    command
        .arg("--host")
        .arg(&target.host)
        .arg("--port")
        .arg(target.port.to_string())
        .arg("--username")
        .arg(&target.username)
        .arg("--password-stdin")
        .arg("--width")
        .arg(target.desktop_width.unwrap_or(1920).to_string())
        .arg("--height")
        .arg(target.desktop_height.unwrap_or(1080).to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(domain) = target
        .domain
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.arg("--domain").arg(domain);
    }

    // Debugging aid: always capture sidecar tracing output to a fixed log file
    // (overwritten per connection) so issues can be diagnosed from a normal
    // GUI session without needing to run the sidecar by hand. Respect an
    // existing RUST_LOG from the parent's environment if the user already set
    // one, otherwise default to a useful debug level.
    command.env(
        "RUST_LOG",
        std::env::var("RUST_LOG").unwrap_or_else(|_| "ironrdp=debug".to_string()),
    );

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start RDP sidecar: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "RDP sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "RDP sidecar stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "RDP sidecar stderr unavailable".to_string())?;

    let stderr_buffer = Arc::new(StdMutex::new(String::new()));
    let (tx, rx) = mpsc::unbounded_channel();
    let child: SidecarChild = Arc::new(StdMutex::new(child));

    writeln!(stdin, "{password}")
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("failed to send RDP credentials to sidecar: {error}"))?;

    {
        let stderr_buffer = Arc::clone(&stderr_buffer);
        let mut log_file = fs::File::create(rdp_sidecar_log_path()).ok();

        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(file) = log_file.as_mut() {
                    let _ = writeln!(file, "{line}");
                    let _ = file.flush();
                }

                if let Ok(mut buffer) = stderr_buffer.lock() {
                    if !buffer.is_empty() {
                        buffer.push('\n');
                    }
                    buffer.push_str(&line);
                }
            }
        });
    }

    {
        let tx = tx.clone();
        let stderr_buffer = Arc::clone(&stderr_buffer);
        let child = Arc::clone(&child);

        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(message) = serde_json::from_str::<SidecarMessage>(&line) else {
                    continue;
                };

                let output = match message {
                    SidecarMessage::Connected {
                        desktop_width,
                        desktop_height,
                        certificate_fingerprint,
                    } => SidecarOutput::Connected {
                        desktop_width,
                        desktop_height,
                        certificate_fingerprint,
                    },
                    SidecarMessage::Frame {
                        sequence,
                        x,
                        y,
                        width,
                        height,
                        data,
                    } => SidecarOutput::Frame {
                        data,
                        height,
                        sequence,
                        width,
                        x,
                        y,
                    },
                    SidecarMessage::ClipboardText { text } => SidecarOutput::ClipboardText { text },
                    SidecarMessage::ClipboardFiles { paths } => {
                        SidecarOutput::ClipboardFiles { paths }
                    }
                    SidecarMessage::ClipboardError { message } => {
                        SidecarOutput::ClipboardError { message }
                    }
                    SidecarMessage::DisplayResized {
                        desktop_width,
                        desktop_height,
                    } => SidecarOutput::DisplayResized {
                        desktop_width,
                        desktop_height,
                    },
                    SidecarMessage::DisplayResizeError { message } => {
                        SidecarOutput::DisplayResizeError { message }
                    }
                };

                if tx.send(output).is_err() {
                    return;
                }
            }

            let exit_status = child.lock().ok().and_then(|mut guard| guard.wait().ok());
            let stderr_text = stderr_buffer
                .lock()
                .map(|buffer| buffer.clone())
                .unwrap_or_default();

            let message = if !stderr_text.is_empty() {
                format!("RDP sidecar failed: {stderr_text}")
            } else if exit_status.is_some_and(|status| !status.success()) {
                "RDP sidecar exited unexpectedly".to_string()
            } else {
                "RDP sidecar connection ended".to_string()
            };

            let _ = tx.send(SidecarOutput::Exited { message });
        });
    }

    Ok((child, stdin, rx))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RdpClipboardTextEvent {
    panel_id: String,
    text: String,
}

#[cfg(windows)]
struct ClipboardGuard;

#[cfg(windows)]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::System::DataExchange::CloseClipboard();
        }
    }
}

#[cfg(windows)]
fn open_windows_clipboard() -> Result<ClipboardGuard, String> {
    use windows_sys::Win32::System::DataExchange::OpenClipboard;

    for attempt in 0..12 {
        unsafe {
            if OpenClipboard(ptr::null_mut()) != 0 {
                return Ok(ClipboardGuard);
            }
        }

        if attempt < 11 {
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
    }

    Err("failed to open Windows clipboard".to_string())
}

#[cfg(windows)]
fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    use windows_sys::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

    let available = unsafe { IsClipboardFormatAvailable(u32::from(CF_HDROP)) };

    if available == 0 {
        return Ok(Vec::new());
    }

    let _guard = open_windows_clipboard()?;
    let handle = unsafe { GetClipboardData(u32::from(CF_HDROP)) };

    if handle.is_null() {
        return Ok(Vec::new());
    }

    let hdrop = handle as HDROP;
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, ptr::null_mut(), 0) };
    let mut paths = Vec::with_capacity(count as usize);

    for index in 0..count {
        let length = unsafe { DragQueryFileW(hdrop, index, ptr::null_mut(), 0) };

        if length == 0 {
            continue;
        }

        let mut buffer = vec![0_u16; length as usize + 1];
        let copied =
            unsafe { DragQueryFileW(hdrop, index, buffer.as_mut_ptr(), buffer.len() as u32) };

        if copied == 0 {
            continue;
        }

        buffer.truncate(copied as usize);
        paths.push(OsString::from_wide(&buffer).to_string_lossy().into_owned());
    }

    Ok(paths)
}

#[cfg(not(windows))]
fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
fn write_clipboard_text(text: &str) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

    let _guard = open_windows_clipboard()?;

    unsafe {
        if EmptyClipboard() == 0 {
            return Err("failed to empty Windows clipboard".to_string());
        }
    }

    let mut wide = text.encode_utf16().collect::<Vec<_>>();
    wide.push(0);

    let byte_len = wide.len() * std::mem::size_of::<u16>();
    let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, byte_len) };

    if handle.is_null() {
        return Err("failed to allocate Windows clipboard memory".to_string());
    }

    let locked = unsafe { GlobalLock(handle) } as *mut u16;

    if locked.is_null() {
        unsafe {
            let _ = GlobalUnlock(handle);
        }
        return Err("failed to lock Windows clipboard memory".to_string());
    }

    unsafe {
        std::ptr::copy_nonoverlapping(wide.as_ptr(), locked, wide.len());
        let _ = GlobalUnlock(handle);

        if SetClipboardData(u32::from(CF_UNICODETEXT), handle).is_null() {
            return Err("failed to set Windows clipboard text".to_string());
        }
    }

    Ok(())
}

#[cfg(windows)]
fn write_clipboard_file_paths(paths: &[String]) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;

    let paths = paths
        .iter()
        .map(|path| PathBuf::from(path))
        .filter(|path| path.exists())
        .collect::<Vec<_>>();

    if paths.is_empty() {
        return Err("remote clipboard did not provide downloadable files".to_string());
    }

    let _guard = open_windows_clipboard()?;

    unsafe {
        if EmptyClipboard() == 0 {
            return Err("failed to empty Windows clipboard".to_string());
        }
    }

    let mut wide_paths = Vec::<u16>::new();

    for path in paths {
        wide_paths.extend(path.as_os_str().encode_wide());
        wide_paths.push(0);
    }

    wide_paths.push(0);

    #[repr(C)]
    struct DropFiles {
        p_files: u32,
        x: i32,
        y: i32,
        f_nc: i32,
        f_wide: i32,
    }

    let header = DropFiles {
        p_files: std::mem::size_of::<DropFiles>() as u32,
        x: 0,
        y: 0,
        f_nc: 0,
        f_wide: 1,
    };
    let byte_len = std::mem::size_of::<DropFiles>() + wide_paths.len() * std::mem::size_of::<u16>();
    let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, byte_len) };

    if handle.is_null() {
        return Err("failed to allocate Windows clipboard memory".to_string());
    }

    let locked = unsafe { GlobalLock(handle) } as *mut u8;

    if locked.is_null() {
        unsafe {
            let _ = GlobalUnlock(handle);
        }
        return Err("failed to lock Windows clipboard memory".to_string());
    }

    unsafe {
        std::ptr::copy_nonoverlapping(
            (&header as *const DropFiles).cast::<u8>(),
            locked,
            std::mem::size_of::<DropFiles>(),
        );
        std::ptr::copy_nonoverlapping(
            wide_paths.as_ptr().cast::<u8>(),
            locked.add(std::mem::size_of::<DropFiles>()),
            wide_paths.len() * std::mem::size_of::<u16>(),
        );
        let _ = GlobalUnlock(handle);

        if SetClipboardData(u32::from(CF_HDROP), handle).is_null() {
            return Err("failed to set Windows clipboard files".to_string());
        }
    }

    Ok(())
}

#[cfg(not(windows))]
fn write_clipboard_file_paths(_paths: &[String]) -> Result<(), String> {
    Err("native clipboard files are only implemented on Windows for now".to_string())
}

#[cfg(not(windows))]
fn write_clipboard_text(_text: &str) -> Result<(), String> {
    Err("native clipboard text is only implemented on Windows for now".to_string())
}

fn resolve_rdp_sidecar_binary() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_path = sidecar_manifest_path();
        let target_dir = sidecar_target_dir();

        return ensure_debug_rdp_sidecar_built(&manifest_path, &target_dir);
    }

    let binary_path = bundled_sidecar_binary_path()?;

    if !binary_path.exists() {
        return Err(format!(
            "Bundled RDP sidecar was not found: {}. Release builds must package the sidecar binary.",
            binary_path.display()
        ));
    }

    Ok(binary_path)
}

fn ensure_debug_rdp_sidecar_built(
    manifest_path: &Path,
    target_dir: &Path,
) -> Result<PathBuf, String> {
    let binary_path = sidecar_binary_path(target_dir);
    let should_build =
        !binary_path.exists() || is_sidecar_source_newer(manifest_path, &binary_path);

    if should_build {
        let output = Command::new("cargo")
            .env("CARGO_TARGET_DIR", target_dir)
            .arg("build")
            .arg("--quiet")
            .arg("--manifest-path")
            .arg(manifest_path)
            .output()
            .map_err(|error| format!("failed to build RDP sidecar: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if !stderr.trim().is_empty() {
                stderr
            } else {
                stdout
            };

            return Err(format!("RDP sidecar build failed: {}", detail.trim()));
        }
    }

    if !binary_path.exists() {
        return Err(format!(
            "RDP sidecar binary was not produced: {}",
            binary_path.display()
        ));
    }

    Ok(binary_path)
}

fn sidecar_binary_path(target_dir: &Path) -> PathBuf {
    target_dir.join("debug").join(sidecar_binary_file_name())
}

fn bundled_sidecar_binary_path() -> Result<PathBuf, String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("failed to resolve ShellPilot executable path: {error}"))?;
    let file_name = sidecar_binary_file_name();

    Ok(current_exe
        .parent()
        .ok_or_else(|| "ShellPilot executable directory is unavailable".to_string())?
        .join(file_name))
}

fn sidecar_binary_file_name() -> &'static str {
    if cfg!(windows) {
        "shellpilot-rdp-probe.exe"
    } else {
        "shellpilot-rdp-probe"
    }
}

fn sidecar_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("rdp-sidecar")
        .join("Cargo.toml")
}

fn is_sidecar_source_newer(manifest_path: &Path, binary_path: &Path) -> bool {
    let Ok(binary_modified) = fs::metadata(binary_path).and_then(|metadata| metadata.modified())
    else {
        return true;
    };
    let Some(sidecar_dir) = manifest_path.parent() else {
        return true;
    };
    let mut source_paths = vec![manifest_path.to_path_buf(), sidecar_dir.join("Cargo.lock")];

    if let Ok(entries) = fs::read_dir(sidecar_dir.join("src")) {
        source_paths.extend(
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|extension| extension == "rs")),
        );
    } else {
        return true;
    }

    source_paths.iter().any(|source_path| {
        fs::metadata(source_path)
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified > binary_modified)
            .unwrap_or(true)
    })
}

fn sidecar_target_dir() -> PathBuf {
    std::env::temp_dir().join("shellpilot-rdp-sidecar-target")
}

fn rdp_sidecar_log_path() -> PathBuf {
    std::env::temp_dir().join("shellpilot-rdp-sidecar.log")
}

fn resolve_password(target: &RdpTarget) -> Result<String, String> {
    if let Some(password) = target.password.as_deref().filter(|value| !value.is_empty()) {
        return Ok(password.to_string());
    }

    if let Some(credential_id) = target.credential_id.as_deref() {
        return read_credential_secret(credential_id);
    }

    Err("RDP password is required".to_string())
}

fn validate_sidecar_secret_line(password: &str) -> Result<(), String> {
    if password.contains('\n') || password.contains('\r') {
        return Err("RDP password cannot contain newline characters".to_string());
    }

    Ok(())
}

fn classify_rdp_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();

    if lower.contains("password")
        || lower.contains("authentication")
        || lower.contains("access denied")
        || lower.contains("credssp")
    {
        return "auth_failed";
    }

    if lower.contains("timeout") || lower.contains("timed out") {
        return "connection_timeout";
    }

    if lower.contains("refused") {
        return "connection_refused";
    }

    if lower.contains("resolve") || lower.contains("address") {
        return "dns_failed";
    }

    "connection_failed"
}

fn verify_or_trust_rdp_certificate(
    app: &AppHandle,
    host: &str,
    port: u16,
    fingerprint: Option<&str>,
    accept_new: bool,
) -> Result<RdpCertificateDecision, RdpCertificateFailure> {
    let fingerprint = fingerprint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RdpCertificateFailure {
            code: "certificate_missing",
            message: "RDP server did not provide a TLS certificate fingerprint.".to_string(),
            retryable: false,
        })?;
    let path = rdp_known_certificates_path(app).map_err(|message| RdpCertificateFailure {
        code: "certificate_store_failed",
        message,
        retryable: false,
    })?;
    let mut known =
        read_rdp_known_certificates(&path).map_err(|message| RdpCertificateFailure {
            code: "certificate_store_failed",
            message,
            retryable: false,
        })?;
    let key = rdp_certificate_key(host, port);

    if let Some(expected) = known.hosts.get(&key) {
        if expected.fingerprint.eq_ignore_ascii_case(fingerprint) {
            return Ok(RdpCertificateDecision::Trusted);
        }

        return Err(RdpCertificateFailure {
            code: "certificate_mismatch",
            message: format!(
                "RDP certificate changed for {host}:{port}. Expected {}, got {}.",
                expected.fingerprint, fingerprint
            ),
            retryable: false,
        });
    }

    if !accept_new {
        return Err(RdpCertificateFailure {
            code: "certificate_unknown",
            message: format!(
                "RDP certificate for {host}:{port} is not trusted yet. Verify the fingerprint before connecting."
            ),
            retryable: true,
        });
    }

    known.hosts.insert(
        key,
        RdpKnownCertificateEntry {
            fingerprint: fingerprint.to_string(),
        },
    );
    write_rdp_known_certificates(&path, &known).map_err(|message| RdpCertificateFailure {
        code: "certificate_store_failed",
        message,
        retryable: false,
    })?;

    Ok(RdpCertificateDecision::TrustedNew)
}

fn rdp_certificate_key(host: &str, port: u16) -> String {
    format!("{}:{port}", host.trim().to_ascii_lowercase())
}

fn rdp_known_certificates_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    Ok(directory.join("rdp_known_certificates.json"))
}

fn read_rdp_known_certificates(path: &PathBuf) -> Result<RdpKnownCertificates, String> {
    if !path.exists() {
        return Ok(RdpKnownCertificates::default());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("failed to read RDP trusted certificates: {error}"))?;

    serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse RDP trusted certificates: {error}"))
}

fn write_rdp_known_certificates(
    path: &PathBuf,
    known_certificates: &RdpKnownCertificates,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(known_certificates)
        .map_err(|error| format!("failed to serialize RDP trusted certificates: {error}"))?;

    fs::write(path, content)
        .map_err(|error| format!("failed to write RDP trusted certificates: {error}"))
}

fn emit_rdp_event(
    app: &AppHandle,
    panel_id: &str,
    status: RdpStatus,
    code: Option<String>,
    message: Option<String>,
    retryable: bool,
    desktop_size: Option<(u16, u16)>,
    certificate_fingerprint: Option<String>,
) {
    let (desktop_width, desktop_height) = desktop_size
        .map(|(width, height)| (Some(width), Some(height)))
        .unwrap_or((None, None));

    let _ = app.emit(
        "shellpilot-rdp",
        RdpEvent {
            certificate_fingerprint,
            code,
            desktop_height,
            desktop_width,
            message,
            panel_id: panel_id.to_string(),
            retryable,
            status,
        },
    );
}

fn emit_rdp_frame(
    app: &AppHandle,
    panel_id: &str,
    sequence: u64,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    data: String,
) {
    let _ = app.emit(
        "shellpilot-rdp-frame",
        RdpFrameEvent {
            data,
            height,
            panel_id: panel_id.to_string(),
            sequence,
            width,
            x,
            y,
        },
    );
}

fn emit_rdp_clipboard_text(app: &AppHandle, panel_id: &str, text: String) {
    let _ = app.emit(
        "shellpilot-rdp-clipboard",
        RdpClipboardTextEvent {
            panel_id: panel_id.to_string(),
            text,
        },
    );
}

// Windows key capture: while a specific RDP panel is focused, a system-wide
// low-level keyboard hook forwards LWIN/RWIN presses to that RDP session
// instead of letting the local Explorer shell act on them (Win normally opens
// the Start Menu no matter which app has focus — only a WH_KEYBOARD_LL hook
// can suppress that, same technique real RDP/remote-desktop clients use).
// The hook installs once, lazily, and just checks this shared state on every
// Win-key event; disabling capture (`panel_id: None`) makes the key behave
// locally again immediately.
#[cfg(windows)]
static WIN_KEY_CAPTURE: StdMutex<Option<(String, mpsc::UnboundedSender<RdpSessionCommand>)>> =
    StdMutex::new(None);

#[tauri::command]
pub async fn rdp_set_windows_key_capture(
    store: State<'_, RdpSessionStore>,
    panel_id: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        match panel_id {
            Some(panel_id) => {
                let tx = {
                    let sessions = store.sessions.lock().await;
                    sessions.get(&panel_id).map(|handle| handle.tx.clone())
                };

                let Some(tx) = tx else {
                    eprintln!("[rdp] set_windows_key_capture: no session for panel {panel_id}");
                    return Ok(());
                };

                windows_key_hook::ensure_installed();

                if let Ok(mut guard) = WIN_KEY_CAPTURE.lock() {
                    eprintln!("[rdp] set_windows_key_capture: enabled for panel {panel_id}");
                    *guard = Some((panel_id, tx));
                }
            }
            None => {
                if let Ok(mut guard) = WIN_KEY_CAPTURE.lock() {
                    eprintln!("[rdp] set_windows_key_capture: disabled");
                    *guard = None;
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (store, panel_id);
    }

    Ok(())
}

#[cfg(windows)]
mod windows_key_hook {
    use std::ptr;
    use std::sync::Once;

    use serde_json;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    use super::{RdpInput, RdpSessionCommand, WIN_KEY_CAPTURE};

    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;

    pub fn ensure_installed() {
        static STARTED: Once = Once::new();

        STARTED.call_once(|| {
            std::thread::spawn(|| unsafe {
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), ptr::null_mut(), 0);

                if hook.is_null() {
                    eprintln!("[rdp] Windows key hook: SetWindowsHookExW failed");
                    return;
                }

                eprintln!("[rdp] Windows key hook installed");

                let mut message: MSG = std::mem::zeroed();

                loop {
                    let result = GetMessageW(&mut message, ptr::null_mut(), 0, 0);

                    if result <= 0 {
                        break;
                    }

                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            });
        });
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = &*(lparam as *const KBDLLHOOKSTRUCT);

            if info.vkCode == VK_LWIN || info.vkCode == VK_RWIN {
                let message = wparam as u32;
                let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                let up = message == WM_KEYUP || message == WM_SYSKEYUP;

                if down || up {
                    let captured = WIN_KEY_CAPTURE.lock().ok().and_then(|guard| guard.clone());
                    eprintln!(
                        "[rdp] win key event down={down} captured={}",
                        captured.is_some()
                    );

                    if let Some((_, tx)) = captured {
                        let input = RdpInput::Key {
                            code: 0x5B,
                            extended: true,
                            down,
                        };

                        if let Ok(line) = serde_json::to_string(&input) {
                            let _ = tx.send(RdpSessionCommand::Input(line));
                        }

                        // Suppress: block the local shell from ever seeing this
                        // key while an RDP panel is focused.
                        return 1;
                    }
                }
            }
        }

        CallNextHookEx(ptr::null_mut(), code, wparam, lparam)
    }
}
