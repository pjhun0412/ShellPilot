use std::{collections::HashMap, sync::Arc, time::Duration};

use russh::{client, ChannelMsg, Disconnect};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
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
    QueryCwd {
        respond_to: oneshot::Sender<Option<String>>,
    },
    Resize {
        cols: u32,
        rows: u32,
    },
    Write(String),
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshTerminalEvent {
    auth_prompt: bool,
    code: Option<String>,
    data: Option<String>,
    host_key_fingerprint: Option<String>,
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
const DATA_FLUSH_MAX_BYTES: usize = 64 * 1024;
const EXEC_COMMAND_TIMEOUT: Duration = Duration::from_secs(2);

// Directory tracking: identify the interactive shell's own PID via a
// throwaway exec channel (never the interactive one the user is looking at,
// so nothing ever appears on screen), then resolve its current directory on
// demand the same way whenever the frontend asks (e.g. "open SFTP here").
// This avoids ever installing a persistent per-prompt hook: no OSC7, no
// shell-specific scripts, no risk of clobbering the user's own prompt
// customization, and no visible injected command at all.
//
// PID identification is a heuristic, not a guarantee: a separate channel
// always spawns an unrelated process, so we can't ask the interactive shell
// to self-report without typing into it. Instead we list pty-attached
// processes and take the highest PID (Linux allocates PIDs monotonically),
// which is almost always the shell we just started. In the rare case another
// session for the same user starts on the same host in the same instant,
// this can pick the wrong PID — worst case is SFTP opening at the wrong
// initial path, never a security or data-loss issue.

/// Runs a command on a one-shot exec channel and returns its trimmed stdout,
/// or `None` on any failure (channel open/exec failure, empty output, or a
/// remote command that never finishes — bounded by `EXEC_COMMAND_TIMEOUT` so
/// a wedged remote command can never stall the interactive session's own
/// command loop, which awaits this inline). Used for anything we need from
/// the remote host that must never touch the interactive channel the user is
/// looking at.
async fn run_exec_command(
    session: &mut client::Handle<ShellPilotSshClient>,
    command: &str,
) -> Option<String> {
    let output = time::timeout(EXEC_COMMAND_TIMEOUT, async {
        let mut channel = session.channel_open_session().await.ok()?;
        channel.exec(false, command).await.ok()?;

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    output.extend_from_slice(&data);
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }

        Some(output)
    })
    .await
    .ok()
    .flatten()?;

    let text = String::from_utf8_lossy(&output).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Identifies the interactive shell's PID. When we know the local TCP port
/// our own connection used, this is deterministic: it scans pty-attached
/// processes' `/proc/<pid>/environ` for the `SSH_CONNECTION` entry whose
/// client-port field matches ours — sshd always sets this for pty sessions,
/// so it uniquely identifies our own shell even with multiple SSH tabs open
/// to the same host/account. Falls back to "highest PID with a pts tty" if
/// the port is unknown or nothing matched (still correct in the common case
/// of a single session, just no longer guaranteed under concurrent ones).
async fn detect_shell_pid(
    session: &mut client::Handle<ShellPilotSshClient>,
    local_port: Option<u16>,
) -> Option<String> {
    let fallback = "ps -eo pid,tty,comm | awk '$2 ~ /^pts/ {print $1}' | sort -n | tail -n1";
    let command = match local_port {
        Some(port) => format!(
            "match=\"\"; \
for pid in $(ps -eo pid,tty | awk '$2 ~ /^pts/ {{print $1}}'); do \
  line=$(tr '\\0' '\\n' < /proc/$pid/environ 2>/dev/null | grep '^SSH_CONNECTION='); \
  if [ -n \"$line\" ]; then set -- $line; if [ \"$2\" = \"{port}\" ]; then match=$pid; break; fi; fi; \
done; \
if [ -n \"$match\" ]; then echo $match; else {fallback}; fi"
        ),
        None => fallback.to_string(),
    };

    let pid = run_exec_command(session, &command).await?;

    (!pid.is_empty() && pid.chars().all(|ch| ch.is_ascii_digit())).then_some(pid)
}

/// Resolves a PID's current working directory via a one-shot exec channel,
/// using Linux's procfs. Silently resolves to `None` on any failure (no
/// /proc, permissions, unsupported remote) — this is always a best-effort
/// convenience, never a hard requirement for opening SFTP.
async fn query_shell_cwd(
    session: &mut client::Handle<ShellPilotSshClient>,
    pid: &str,
) -> Option<String> {
    run_exec_command(session, &format!("readlink /proc/{pid}/cwd 2>/dev/null")).await
}

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

pub(crate) async fn query_cwd(
    store: State<'_, SshSessionStore>,
    panel_id: String,
) -> Result<Option<String>, String> {
    let (respond_to, response) = oneshot::channel();

    send_session_command(
        &store,
        &panel_id,
        SshSessionCommand::QueryCwd { respond_to },
    )
    .await?;

    Ok(response.await.unwrap_or(None))
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
        // Connect the TCP socket ourselves (rather than via `client::connect`)
        // so we can capture our own local port before handing the stream to
        // russh — sshd stamps this exact port into the remote shell's
        // `SSH_CONNECTION` environment variable, which lets us later identify
        // that specific shell process deterministically (see
        // `detect_shell_pid`).
        let tcp_stream = tokio::net::TcpStream::connect((target.host.as_str(), target.port))
            .await
            .map_err(|error| classify_connect_error(error.to_string()))?;
        let local_port = tcp_stream.local_addr().ok().map(|addr| addr.port());
        if config.nodelay {
            let _ = tcp_stream.set_nodelay(true);
        }
        let mut session = client::connect_stream(
            config,
            tcp_stream,
            ShellPilotSshClient::new(
                app.clone(),
                Some(panel_id.clone()),
                &target.host,
                target.port,
                target.accept_new_host_key.unwrap_or(false),
                target.accepted_host_key_fingerprint.clone(),
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
        authenticate_session(
            &app,
            &mut session,
            &target.username,
            &auth,
            super::SshCredentialScope {
                host: &target.host,
                port: target.port,
                session_id: target.session_id.as_deref(),
                username: &target.username,
            },
        )
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

        // Best-effort: identify the shell's own PID once, via a separate
        // exec channel, so cwd lookups can be resolved later without ever
        // touching the interactive channel. Never fatal if this fails.
        let shell_pid = detect_shell_pid(&mut session, local_port).await;

        let mut pending_data = Vec::with_capacity(DATA_FLUSH_MAX_BYTES);
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
                        Some(SshSessionCommand::QueryCwd { respond_to }) => {
                            let cwd = match &shell_pid {
                                Some(pid) => query_shell_cwd(&mut session, pid).await,
                                None => None,
                            };
                            let _ = respond_to.send(cwd);
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
            host_key_fingerprint: None,
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
            host_key_fingerprint: None,
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
    emit_terminal_warning_with_host_key(app, panel_id, code, message, None);
}

pub(crate) fn emit_terminal_warning_with_host_key(
    app: &AppHandle,
    panel_id: Option<&str>,
    code: &'static str,
    message: String,
    host_key_fingerprint: Option<String>,
) {
    if let Some(panel_id) = panel_id {
        let _ = app.emit(
            "shellpilot-ssh-terminal",
            SshTerminalEvent {
                auth_prompt: false,
                code: Some(code.to_string()),
                data: None,
                host_key_fingerprint,
                message: Some(message),
                panel_id: panel_id.to_string(),
                retryable: false,
                status: SshTerminalStatus::Warning,
            },
        );
    }
}
