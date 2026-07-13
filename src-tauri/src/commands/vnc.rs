use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

use crate::commands::credentials::read_credential_secret;

#[derive(Default)]
pub struct VncSessionStore {
    next_run_id: AtomicU64,
    sessions: Mutex<HashMap<String, VncSessionHandle>>,
}

struct VncSessionHandle {
    run_id: u64,
    tx: mpsc::UnboundedSender<VncSessionCommand>,
}

enum VncSessionCommand {
    Close,
    Input(String),
    Inputs(Vec<String>),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncTarget {
    credential_id: Option<String>,
    host: String,
    panel_id: String,
    password: Option<String>,
    port: u16,
    username: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VncSidecarTarget {
    host: String,
    password: String,
    port: u16,
    username: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum VncInput {
    Pointer { x: u16, y: u16, buttons: u8 },
    Key { keysym: u32, down: bool },
    Refresh { full: Option<bool> },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VncEvent {
    desktop_height: Option<u16>,
    desktop_width: Option<u16>,
    message: Option<String>,
    panel_id: String,
    retryable: bool,
    status: VncStatus,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum VncStatus {
    Closed,
    Connected,
    Connecting,
    Failed,
    FrameReady,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VncFrameEvent {
    data: Option<String>,
    height: u16,
    kind: VncFrameKind,
    panel_id: String,
    sequence: u64,
    source_x: Option<u16>,
    source_y: Option<u16>,
    width: u16,
    x: u16,
    y: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum VncFrameKind {
    Copy,
    Raw,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SidecarMessage {
    Connected {
        desktop_width: u16,
        desktop_height: u16,
    },
    FrameBatch {
        frames: Vec<SidecarFrameMessage>,
    },
    Frame {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        data: String,
    },
    Copy {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        source_x: u16,
        source_y: u16,
    },
    Resized {
        desktop_width: u16,
        desktop_height: u16,
    },
    Error {
        message: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum SidecarFrameMessage {
    Raw {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        data: String,
    },
    Copy {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        source_x: u16,
        source_y: u16,
    },
}

enum SidecarOutput {
    Connected {
        desktop_width: u16,
        desktop_height: u16,
    },
    Frame {
        data: String,
        height: u16,
        sequence: u64,
        width: u16,
        x: u16,
        y: u16,
    },
    Copy {
        height: u16,
        sequence: u64,
        source_x: u16,
        source_y: u16,
        width: u16,
        x: u16,
        y: u16,
    },
    Frames(Vec<VncFrameEvent>),
    Resized {
        desktop_width: u16,
        desktop_height: u16,
    },
    Failed {
        detail: String,
        message: String,
    },
}

type SidecarChild = Arc<StdMutex<Child>>;

#[tauri::command]
pub async fn vnc_open(
    app: AppHandle,
    store: State<'_, VncSessionStore>,
    target: VncTarget,
) -> Result<(), String> {
    vnc_close(store.clone(), target.panel_id.clone()).await?;

    let (tx, rx) = mpsc::unbounded_channel();
    let panel_id = target.panel_id.clone();
    let run_id = store.next_run_id.fetch_add(1, Ordering::Relaxed) + 1;

    store
        .sessions
        .lock()
        .await
        .insert(panel_id, VncSessionHandle { run_id, tx });

    tauri::async_runtime::spawn(async move {
        run_vnc_session(app, target, run_id, rx).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn vnc_close(store: State<'_, VncSessionStore>, panel_id: String) -> Result<(), String> {
    let handle = store.sessions.lock().await.remove(&panel_id);

    if let Some(handle) = handle {
        let _ = handle.tx.send(VncSessionCommand::Close);
    }

    Ok(())
}

#[tauri::command]
pub async fn vnc_send_input(
    store: State<'_, VncSessionStore>,
    panel_id: String,
    input: VncInput,
) -> Result<(), String> {
    vnc_send_inputs(store, panel_id, vec![input]).await
}

#[tauri::command]
pub async fn vnc_send_inputs(
    store: State<'_, VncSessionStore>,
    panel_id: String,
    inputs: Vec<VncInput>,
) -> Result<(), String> {
    if inputs.is_empty() {
        return Ok(());
    }

    let sessions = store.sessions.lock().await;

    if let Some(handle) = sessions.get(&panel_id) {
        let lines = inputs
            .into_iter()
            .map(|input| serde_json::to_string(&input).map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?;

        let command = if lines.len() == 1 {
            VncSessionCommand::Input(lines.into_iter().next().unwrap())
        } else {
            VncSessionCommand::Inputs(lines)
        };

        let _ = handle.tx.send(command);
    }

    Ok(())
}

async fn run_vnc_session(
    app: AppHandle,
    target: VncTarget,
    run_id: u64,
    mut rx: mpsc::UnboundedReceiver<VncSessionCommand>,
) {
    let panel_id = target.panel_id.clone();
    emit_vnc_event(
        &app,
        &panel_id,
        VncStatus::Connecting,
        Some("Connecting to VNC server...".to_string()),
        true,
        None,
    );

    let spawned = tokio::task::spawn_blocking(move || spawn_vnc_sidecar(target))
        .await
        .map_err(|error| format!("VNC worker failed: {error}"))
        .and_then(|value| value);

    let (child, mut stdin, mut stdout_rx) = match spawned {
        Ok(value) => value,
        Err(error) => {
            emit_vnc_event(&app, &panel_id, VncStatus::Failed, Some(error), true, None);
            cleanup_vnc_session(&app, &panel_id, run_id).await;
            return;
        }
    };

    let mut deferred_output = None;
    let mut frame_ready_sent = false;

    loop {
        if let Some(output) = deferred_output.take() {
            if handle_sidecar_output(
                &app,
                &panel_id,
                output,
                &mut stdout_rx,
                &mut frame_ready_sent,
                &mut deferred_output,
            ) {
                break;
            }

            continue;
        }

        tokio::select! {
            message = stdout_rx.recv() => {
                match message {
                    Some(output) => {
                        if handle_sidecar_output(
                            &app,
                            &panel_id,
                            output,
                            &mut stdout_rx,
                            &mut frame_ready_sent,
                            &mut deferred_output,
                        ) {
                            break;
                        }
                    }
                    None => {
                        emit_vnc_event(&app, &panel_id, VncStatus::Closed, None, true, None);
                        break;
                    }
                }
            }
            command = rx.recv() => {
                match command {
                    Some(VncSessionCommand::Input(line)) => {
                        let _ = writeln!(stdin, "{line}");
                        let _ = stdin.flush();
                    }
                    Some(VncSessionCommand::Inputs(lines)) => {
                        for line in lines {
                            let _ = writeln!(stdin, "{line}");
                        }

                        let _ = stdin.flush();
                    }
                    Some(VncSessionCommand::Close) | None => {
                        if let Ok(mut guard) = child.lock() {
                            let _ = guard.kill();
                        }

                        emit_vnc_event(&app, &panel_id, VncStatus::Closed, None, true, None);
                        break;
                    }
                }
            }
        }
    }

    cleanup_vnc_session(&app, &panel_id, run_id).await;
}

fn handle_sidecar_output(
    app: &AppHandle,
    panel_id: &str,
    output: SidecarOutput,
    stdout_rx: &mut mpsc::UnboundedReceiver<SidecarOutput>,
    frame_ready_sent: &mut bool,
    deferred_output: &mut Option<SidecarOutput>,
) -> bool {
    match output {
        SidecarOutput::Connected {
            desktop_width,
            desktop_height,
        } => {
            emit_vnc_event(
                app,
                panel_id,
                VncStatus::Connected,
                Some("Connected.".to_string()),
                true,
                Some((desktop_width, desktop_height)),
            );
            false
        }
        SidecarOutput::Frame { .. } | SidecarOutput::Copy { .. } | SidecarOutput::Frames(_) => {
            let (frames, deferred) = collect_vnc_frame_batch(panel_id, output, stdout_rx);
            *deferred_output = deferred;

            if !*frame_ready_sent {
                *frame_ready_sent = true;
                emit_vnc_event(
                    app,
                    panel_id,
                    VncStatus::FrameReady,
                    Some("Framebuffer ready.".to_string()),
                    true,
                    None,
                );
            }

            emit_vnc_frame_batch(app, frames);
            false
        }
        SidecarOutput::Resized {
            desktop_width,
            desktop_height,
        } => {
            emit_vnc_event(
                app,
                panel_id,
                VncStatus::Connected,
                Some(format!(
                    "Remote framebuffer resized to {desktop_width}x{desktop_height}."
                )),
                true,
                Some((desktop_width, desktop_height)),
            );
            false
        }
        SidecarOutput::Failed { detail, message } => {
            let display_message = sanitize_vnc_failure_message(&detail, &message);
            emit_vnc_event(
                app,
                panel_id,
                VncStatus::Failed,
                Some(display_message),
                true,
                None,
            );
            true
        }
    }
}

fn collect_vnc_frame_batch(
    panel_id: &str,
    first_output: SidecarOutput,
    stdout_rx: &mut mpsc::UnboundedReceiver<SidecarOutput>,
) -> (Vec<VncFrameEvent>, Option<SidecarOutput>) {
    let mut frames = Vec::with_capacity(8);

    match sidecar_output_to_frame_events(panel_id, first_output) {
        Ok(first_frames) => frames.extend(first_frames),
        Err(output) => return (frames, Some(output)),
    }

    while frames.len() < 64 {
        match stdout_rx.try_recv() {
            Ok(output) => match sidecar_output_to_frame_events(panel_id, output) {
                Ok(next_frames) => frames.extend(next_frames),
                Err(output) => return (frames, Some(output)),
            },
            Err(_) => break,
        }
    }

    (frames, None)
}

fn sidecar_output_to_frame_events(
    panel_id: &str,
    output: SidecarOutput,
) -> Result<Vec<VncFrameEvent>, SidecarOutput> {
    match output {
        SidecarOutput::Frame {
            data,
            height,
            sequence,
            width,
            x,
            y,
        } => Ok(vec![VncFrameEvent {
            data: Some(data),
            height,
            kind: VncFrameKind::Raw,
            panel_id: panel_id.to_string(),
            sequence,
            source_x: None,
            source_y: None,
            width,
            x,
            y,
        }]),
        SidecarOutput::Copy {
            height,
            sequence,
            source_x,
            source_y,
            width,
            x,
            y,
        } => Ok(vec![VncFrameEvent {
            data: None,
            height,
            kind: VncFrameKind::Copy,
            panel_id: panel_id.to_string(),
            sequence,
            source_x: Some(source_x),
            source_y: Some(source_y),
            width,
            x,
            y,
        }]),
        SidecarOutput::Frames(mut frames) => {
            for frame in &mut frames {
                frame.panel_id = panel_id.to_string();
            }

            Ok(frames)
        }
        output => Err(output),
    }
}

async fn cleanup_vnc_session(app: &AppHandle, panel_id: &str, run_id: u64) {
    let store = app.state::<VncSessionStore>();
    let mut sessions = store.sessions.lock().await;

    if sessions
        .get(panel_id)
        .is_some_and(|handle| handle.run_id == run_id)
    {
        sessions.remove(panel_id);
    }
}

fn spawn_vnc_sidecar(
    target: VncTarget,
) -> Result<
    (
        SidecarChild,
        ChildStdin,
        mpsc::UnboundedReceiver<SidecarOutput>,
    ),
    String,
> {
    if target.host.trim().is_empty() {
        return Err("VNC host is required".to_string());
    }

    let password = resolve_password(&target)?;
    validate_sidecar_secret(&password)?;

    let binary_path = resolve_vnc_sidecar_binary()?;
    let mut child = Command::new(binary_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start VNC sidecar: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to open VNC sidecar stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open VNC sidecar stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to open VNC sidecar stderr".to_string())?;
    let sidecar_target = VncSidecarTarget {
        host: target.host,
        password,
        port: target.port,
        username: target.username,
    };
    let target_line = serde_json::to_string(&sidecar_target).map_err(|error| error.to_string())?;

    writeln!(stdin, "{target_line}")
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("failed to write VNC sidecar target: {error}"))?;

    let child = Arc::new(StdMutex::new(child));
    let wait_child = child.clone();
    let (tx, rx) = mpsc::unbounded_channel();
    let stdout_tx = tx.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            match line {
                Ok(line) if line.trim().is_empty() => {}
                Ok(line) => match serde_json::from_str::<SidecarMessage>(&line) {
                    Ok(SidecarMessage::Connected {
                        desktop_width,
                        desktop_height,
                    }) => {
                        let _ = stdout_tx.send(SidecarOutput::Connected {
                            desktop_width,
                            desktop_height,
                        });
                    }
                    Ok(SidecarMessage::FrameBatch { frames }) => {
                        let frames = frames
                            .into_iter()
                            .map(sidecar_frame_message_to_event)
                            .collect::<Vec<_>>();
                        let _ = stdout_tx.send(SidecarOutput::Frames(frames));
                    }
                    Ok(SidecarMessage::Frame {
                        sequence,
                        x,
                        y,
                        width,
                        height,
                        data,
                    }) => {
                        let _ = stdout_tx.send(SidecarOutput::Frame {
                            data,
                            height,
                            sequence,
                            width,
                            x,
                            y,
                        });
                    }
                    Ok(SidecarMessage::Copy {
                        sequence,
                        x,
                        y,
                        width,
                        height,
                        source_x,
                        source_y,
                    }) => {
                        let _ = stdout_tx.send(SidecarOutput::Copy {
                            height,
                            sequence,
                            source_x,
                            source_y,
                            width,
                            x,
                            y,
                        });
                    }
                    Ok(SidecarMessage::Resized {
                        desktop_width,
                        desktop_height,
                    }) => {
                        let _ = stdout_tx.send(SidecarOutput::Resized {
                            desktop_width,
                            desktop_height,
                        });
                    }
                    Ok(SidecarMessage::Error { message }) => {
                        let _ = stdout_tx.send(SidecarOutput::Failed {
                            detail: message.clone(),
                            message,
                        });
                    }
                    Err(error) => {
                        let _ = stdout_tx.send(SidecarOutput::Failed {
                            detail: line,
                            message: format!("VNC sidecar emitted invalid output: {error}"),
                        });
                    }
                },
                Err(error) => {
                    let _ = stdout_tx.send(SidecarOutput::Failed {
                        detail: error.to_string(),
                        message: "VNC sidecar output failed.".to_string(),
                    });
                    break;
                }
            }
        }
    });

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);

        for line in reader.lines().map_while(Result::ok) {
            eprintln!("[vnc-sidecar] {line}");
        }
    });

    std::thread::spawn(move || {
        let detail = match wait_child.lock() {
            Ok(mut guard) => match guard.wait() {
                Ok(status) => format!("VNC sidecar exited with {status}"),
                Err(error) => format!("failed to wait for VNC sidecar: {error}"),
            },
            Err(_) => "failed to lock VNC sidecar process".to_string(),
        };

        let _ = tx.send(SidecarOutput::Failed {
            detail,
            message: "VNC sidecar exited.".to_string(),
        });
    });

    Ok((child, stdin, rx))
}

fn sidecar_frame_message_to_event(frame: SidecarFrameMessage) -> VncFrameEvent {
    match frame {
        SidecarFrameMessage::Raw {
            sequence,
            x,
            y,
            width,
            height,
            data,
        } => VncFrameEvent {
            data: Some(data),
            height,
            kind: VncFrameKind::Raw,
            panel_id: String::new(),
            sequence,
            source_x: None,
            source_y: None,
            width,
            x,
            y,
        },
        SidecarFrameMessage::Copy {
            sequence,
            x,
            y,
            width,
            height,
            source_x,
            source_y,
        } => VncFrameEvent {
            data: None,
            height,
            kind: VncFrameKind::Copy,
            panel_id: String::new(),
            sequence,
            source_x: Some(source_x),
            source_y: Some(source_y),
            width,
            x,
            y,
        },
    }
}

fn resolve_vnc_sidecar_binary() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_path = vnc_sidecar_manifest_path();
        let target_dir = vnc_sidecar_target_dir();

        return ensure_debug_vnc_sidecar_built(&manifest_path, &target_dir);
    }

    let binary_path = bundled_vnc_sidecar_binary_path()?;

    if !binary_path.exists() {
        return Err(format!(
            "Bundled VNC sidecar was not found: {}. Release builds must package the sidecar binary.",
            binary_path.display()
        ));
    }

    Ok(binary_path)
}

fn ensure_debug_vnc_sidecar_built(
    manifest_path: &Path,
    target_dir: &Path,
) -> Result<PathBuf, String> {
    let binary_path = vnc_sidecar_binary_path(target_dir);
    let should_build =
        !binary_path.exists() || is_vnc_sidecar_source_newer(manifest_path, &binary_path);

    if should_build {
        let output = Command::new("cargo")
            .env("CARGO_TARGET_DIR", target_dir)
            .arg("build")
            .arg("--quiet")
            .arg("--manifest-path")
            .arg(manifest_path)
            .output()
            .map_err(|error| format!("failed to build VNC sidecar: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if !stderr.trim().is_empty() {
                stderr
            } else {
                stdout
            };

            return Err(format!("VNC sidecar build failed: {}", detail.trim()));
        }
    }

    if !binary_path.exists() {
        return Err(format!(
            "VNC sidecar binary was not produced: {}",
            binary_path.display()
        ));
    }

    Ok(binary_path)
}

fn vnc_sidecar_binary_path(target_dir: &Path) -> PathBuf {
    target_dir
        .join("debug")
        .join(vnc_sidecar_binary_file_name())
}

fn bundled_vnc_sidecar_binary_path() -> Result<PathBuf, String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("failed to resolve ShellPilot executable path: {error}"))?;

    Ok(current_exe
        .parent()
        .ok_or_else(|| "ShellPilot executable directory is unavailable".to_string())?
        .join(vnc_sidecar_binary_file_name()))
}

fn vnc_sidecar_binary_file_name() -> &'static str {
    if cfg!(windows) {
        "shellpilot-vnc-probe.exe"
    } else {
        "shellpilot-vnc-probe"
    }
}

fn vnc_sidecar_manifest_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("vnc-sidecar")
        .join("Cargo.toml")
}

fn vnc_sidecar_target_dir() -> PathBuf {
    std::env::temp_dir().join("shellpilot-vnc-sidecar-target")
}

fn is_vnc_sidecar_source_newer(manifest_path: &Path, binary_path: &Path) -> bool {
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

fn resolve_password(target: &VncTarget) -> Result<String, String> {
    if let Some(password) = target.password.as_deref().filter(|value| !value.is_empty()) {
        return Ok(password.to_string());
    }

    if let Some(credential_id) = target.credential_id.as_deref() {
        return read_credential_secret(credential_id);
    }

    Err("VNC password is required".to_string())
}

fn validate_sidecar_secret(password: &str) -> Result<(), String> {
    if password.contains('\n') || password.contains('\r') {
        return Err("VNC password cannot contain newline characters".to_string());
    }

    Ok(())
}

fn sanitize_vnc_failure_message(detail: &str, fallback: &str) -> String {
    let lower = detail.to_ascii_lowercase();

    if lower.contains("username") {
        return "macOS Screen Sharing requires the VNC session username. Edit the VNC session and enter the macOS account username.".to_string();
    }

    if lower.contains("apple") || lower.contains("macos") {
        return fallback.to_string();
    }

    if lower.contains("password") || lower.contains("auth") {
        return "VNC authentication failed.".to_string();
    }

    if lower.contains("timeout") || lower.contains("timed out") {
        return "VNC connection timed out.".to_string();
    }

    if lower.contains("refused") {
        return "VNC connection was refused.".to_string();
    }

    if lower.contains("resolve") || lower.contains("address") || lower.contains("dns") {
        return "VNC host could not be resolved.".to_string();
    }

    if fallback.trim().is_empty() {
        "VNC connection failed.".to_string()
    } else {
        fallback.to_string()
    }
}

fn emit_vnc_event(
    app: &AppHandle,
    panel_id: &str,
    status: VncStatus,
    message: Option<String>,
    retryable: bool,
    desktop_size: Option<(u16, u16)>,
) {
    let (desktop_width, desktop_height) = desktop_size
        .map(|(width, height)| (Some(width), Some(height)))
        .unwrap_or((None, None));

    let _ = app.emit(
        "shellpilot-vnc",
        VncEvent {
            desktop_height,
            desktop_width,
            message,
            panel_id: panel_id.to_string(),
            retryable,
            status,
        },
    );
}

fn emit_vnc_frame_batch(app: &AppHandle, frames: Vec<VncFrameEvent>) {
    if frames.is_empty() {
        return;
    }

    let _ = app.emit("shellpilot-vnc-frame-batch", frames);
}
