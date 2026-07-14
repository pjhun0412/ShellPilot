use std::{collections::HashMap, sync::Arc, time::Duration};

use russh::{client, ChannelMsg, Disconnect};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{self, MissedTickBehavior};

use super::{
    auth::{authenticate_session, SshAuthRequest},
    errors::{classify_auth_error, classify_connect_error, SshFailure},
    ShellPilotSshClient, SshShellTarget,
};

#[derive(Default)]
pub struct SshSessionStore {
    sessions: Mutex<HashMap<String, SshSessionHandle>>,
}

struct SshSessionHandle {
    tx: mpsc::UnboundedSender<SshSessionCommand>,
}

enum SshSessionCommand {
    Close,
    Resize { cols: u32, rows: u32 },
    Write(String),
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshTerminalEvent {
    auth_prompt: bool,
    code: Option<String>,
    data: Option<String>,
    message: Option<String>,
    panel_id: String,
    retryable: bool,
    status: SshTerminalStatus,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum SshTerminalStatus {
    Closed,
    Connected,
    Data,
    Warning,
    Info,
    Failed,
}

const DATA_FLUSH_INTERVAL: Duration = Duration::from_millis(12);
const DATA_FLUSH_MAX_BYTES: usize = 32 * 1024;

pub(crate) async fn open_shell(
    app: AppHandle,
    store: State<'_, SshSessionStore>,
    target: SshShellTarget,
) -> Result<(), String> {
    close_shell(store.clone(), target.panel_id.clone()).await?;

    let auth = SshAuthRequest::from_target(&target);
    let (tx, rx) = mpsc::unbounded_channel();
    let panel_id = target.panel_id.clone();

    store
        .sessions
        .lock()
        .await
        .insert(panel_id, SshSessionHandle { tx });

    tauri::async_runtime::spawn(run_shell_session(app, target, auth, rx));
    Ok(())
}

pub(crate) async fn write_shell(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    data: String,
) -> Result<(), String> {
    send_session_command(&store, &panel_id, SshSessionCommand::Write(data)).await
}

pub(crate) async fn resize_shell(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    send_session_command(&store, &panel_id, SshSessionCommand::Resize { cols, rows }).await
}

pub(crate) async fn close_shell(
    store: State<'_, SshSessionStore>,
    panel_id: String,
) -> Result<(), String> {
    let handle = store.sessions.lock().await.remove(&panel_id);

    if let Some(handle) = handle {
        let _ = handle.tx.send(SshSessionCommand::Close);
    }

    Ok(())
}

async fn run_shell_session(
    app: AppHandle,
    target: SshShellTarget,
    auth: SshAuthRequest,
    mut rx: mpsc::UnboundedReceiver<SshSessionCommand>,
) {
    let panel_id = target.panel_id.clone();
    let result = async {
        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some("resolving credential".to_string()),
        );
        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            ..Default::default()
        });
        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some("opening tcp/ssh transport".to_string()),
        );
        let mut session = client::connect(
            config,
            (target.host.as_str(), target.port),
            ShellPilotSshClient::new(
                app.clone(),
                Some(panel_id.clone()),
                &target.host,
                target.port,
                target.accept_new_host_key.unwrap_or(false),
            ),
        )
        .await
        .map_err(|error| classify_connect_error(error.to_string()))?;
        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some(format!("authenticating {}", auth.label())),
        );
        authenticate_session(&mut session, &target.username, &auth)
            .await
            .map_err(|error| classify_auth_error(error, &auth))?;

        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|error| SshFailure::session(format!("failed to open ssh channel: {error}")))?;

        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some("requesting pty".to_string()),
        );
        channel
            .request_pty(false, "xterm-256color", 120, 32, 0, 0, &[])
            .await
            .map_err(|error| SshFailure::session(format!("failed to request pty: {error}")))?;
        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some("requesting shell".to_string()),
        );
        channel
            .request_shell(false)
            .await
            .map_err(|error| SshFailure::session(format!("failed to request shell: {error}")))?;

        emit_terminal_event(&app, &panel_id, SshTerminalStatus::Connected, None, None);

        let mut pending_data = Vec::new();
        let mut data_flush = time::interval(DATA_FLUSH_INTERVAL);
        data_flush.set_missed_tick_behavior(MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = data_flush.tick() => {
                    flush_terminal_data(&app, &panel_id, &mut pending_data);
                }
                command = rx.recv() => {
                    match command {
                        Some(SshSessionCommand::Close) | None => {
                            flush_terminal_data(&app, &panel_id, &mut pending_data);
                            let _ = channel.eof().await;
                            let _ = session.disconnect(Disconnect::ByApplication, "closed", "en").await;
                            break;
                        }
                        Some(SshSessionCommand::Resize { cols, rows }) => {
                            channel
                                .window_change(cols, rows, 0, 0)
                                .await
                                .map_err(|error| SshFailure::session(format!("failed to resize pty: {error}")))?;
                        }
                        Some(SshSessionCommand::Write(data)) => {
                            channel
                                .data_bytes(data.into_bytes())
                                .await
                                .map_err(|error| SshFailure::session(format!("failed to write ssh data: {error}")))?;
                        }
                    }
                }
                message = channel.wait() => {
                    match message {
                        Some(ChannelMsg::Data { data }) => {
                            pending_data.extend_from_slice(&data);
                            if pending_data.len() >= DATA_FLUSH_MAX_BYTES {
                                flush_terminal_data(&app, &panel_id, &mut pending_data);
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            pending_data.extend_from_slice(&data);
                            if pending_data.len() >= DATA_FLUSH_MAX_BYTES {
                                flush_terminal_data(&app, &panel_id, &mut pending_data);
                            }
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            flush_terminal_data(&app, &panel_id, &mut pending_data);
                            emit_terminal_event(
                                &app,
                                &panel_id,
                                SshTerminalStatus::Info,
                                None,
                                Some(format!("remote shell exited with status {exit_status}")),
                            );
                            break;
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            flush_terminal_data(&app, &panel_id, &mut pending_data);
                            return Err(SshFailure::connection(
                                "SSH connection was lost unexpectedly. Reconnect to open a new shell session.",
                            ));
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok::<(), SshFailure>(())
    }
    .await;

    match result {
        Ok(()) => emit_terminal_event(&app, &panel_id, SshTerminalStatus::Closed, None, None),
        Err(error) => emit_terminal_failure(&app, &panel_id, error),
    }
}

fn flush_terminal_data(app: &AppHandle, panel_id: &str, pending_data: &mut Vec<u8>) {
    if pending_data.is_empty() {
        return;
    }

    let data = String::from_utf8_lossy(pending_data).to_string();
    pending_data.clear();

    emit_terminal_event(app, panel_id, SshTerminalStatus::Data, Some(data), None);
}

async fn send_session_command(
    store: &State<'_, SshSessionStore>,
    panel_id: &str,
    command: SshSessionCommand,
) -> Result<(), String> {
    let sessions = store.sessions.lock().await;
    let handle = sessions
        .get(panel_id)
        .ok_or_else(|| "ssh shell session is not open".to_string())?;

    handle
        .tx
        .send(command)
        .map_err(|_| "ssh shell session is closed".to_string())
}

fn emit_terminal_event(
    app: &AppHandle,
    panel_id: &str,
    status: SshTerminalStatus,
    data: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        "shellpilot-ssh-terminal",
        SshTerminalEvent {
            auth_prompt: false,
            code: None,
            data,
            message,
            panel_id: panel_id.to_string(),
            retryable: false,
            status,
        },
    );
}

fn emit_terminal_failure(app: &AppHandle, panel_id: &str, error: SshFailure) {
    let _ = app.emit(
        "shellpilot-ssh-terminal",
        SshTerminalEvent {
            auth_prompt: error.auth_prompt,
            code: Some(error.code.to_string()),
            data: None,
            message: Some(error.message),
            panel_id: panel_id.to_string(),
            retryable: error.retryable,
            status: SshTerminalStatus::Failed,
        },
    );
}

pub(crate) fn emit_terminal_warning(
    app: &AppHandle,
    panel_id: Option<&str>,
    code: &'static str,
    message: String,
) {
    if let Some(panel_id) = panel_id {
        let _ = app.emit(
            "shellpilot-ssh-terminal",
            SshTerminalEvent {
                auth_prompt: false,
                code: Some(code.to_string()),
                data: None,
                message: Some(message),
                panel_id: panel_id.to_string(),
                retryable: false,
                status: SshTerminalStatus::Warning,
            },
        );
    }
}
