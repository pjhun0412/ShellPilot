use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{
    io::Read,
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    sync::Arc,
    time::{Duration, Instant},
};

use crate::commands::credentials::read_credential_secret;
use russh::{client, ChannelMsg, Disconnect};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProbeResult {
    connected: bool,
    elapsed_ms: u128,
    host: String,
    is_ssh: bool,
    port: u16,
    ssh_banner: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectResult {
    authenticated: bool,
    elapsed_ms: u128,
    host: String,
    port: u16,
    username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshShellTarget {
    credential_id: Option<String>,
    host: String,
    panel_id: String,
    password: Option<String>,
    port: u16,
    username: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshTerminalEvent {
    data: Option<String>,
    message: Option<String>,
    panel_id: String,
    status: SshTerminalStatus,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum SshTerminalStatus {
    Closed,
    Connected,
    Data,
    Info,
    Failed,
}

#[tauri::command]
pub fn probe_ssh_connection(
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<SshProbeResult, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000));
    let started_at = Instant::now();
    let address = resolve_socket_addr(&host, port)?;
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("connection failed: {error}"))?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("failed to set read timeout: {error}"))?;

    let banner = read_ssh_banner(&mut stream);
    let is_ssh = banner
        .as_ref()
        .is_some_and(|value| value.to_ascii_uppercase().starts_with("SSH-"));

    Ok(SshProbeResult {
        connected: true,
        elapsed_ms: started_at.elapsed().as_millis(),
        host,
        is_ssh,
        port,
        ssh_banner: banner,
    })
}

#[tauri::command]
pub async fn connect_ssh_password(
    host: String,
    port: u16,
    username: String,
    credential_id: Option<String>,
    password: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<SshConnectResult, String> {
    let started_at = Instant::now();
    let secret = resolve_password(credential_id.as_deref(), password.as_deref())?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(8000));

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(timeout),
        ..Default::default()
    });

    let mut session = client::connect(config, (host.as_str(), port), ShellPilotSshClient)
        .await
        .map_err(|error| format!("ssh connect failed: {error}"))?;

    let auth = session
        .authenticate_password(username.clone(), secret)
        .await
        .map_err(|error| format!("ssh password authentication failed: {error}"))?;

    if !auth.success() {
        let _ = session
            .disconnect(Disconnect::ByApplication, "authentication failed", "en")
            .await;
        return Err("ssh password authentication rejected by server".to_string());
    }

    session
        .disconnect(Disconnect::ByApplication, "validated", "en")
        .await
        .map_err(|error| format!("ssh disconnect failed: {error}"))?;

    Ok(SshConnectResult {
        authenticated: true,
        elapsed_ms: started_at.elapsed().as_millis(),
        host,
        port,
        username,
    })
}

#[tauri::command]
pub async fn ssh_open_shell(
    app: AppHandle,
    store: State<'_, SshSessionStore>,
    target: SshShellTarget,
) -> Result<(), String> {
    ssh_close(store.clone(), target.panel_id.clone()).await?;

    let secret = resolve_password(target.credential_id.as_deref(), target.password.as_deref())?;
    let (tx, rx) = mpsc::unbounded_channel();
    let panel_id = target.panel_id.clone();

    store.sessions.lock().await.insert(
        panel_id.clone(),
        SshSessionHandle {
            tx,
        },
    );

    tauri::async_runtime::spawn(run_shell_session(app, target, secret, rx));
    Ok(())
}

#[tauri::command]
pub async fn ssh_write(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    data: String,
) -> Result<(), String> {
    send_session_command(&store, &panel_id, SshSessionCommand::Write(data)).await
}

#[tauri::command]
pub async fn ssh_resize(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    send_session_command(&store, &panel_id, SshSessionCommand::Resize { cols, rows }).await
}

#[tauri::command]
pub async fn ssh_close(store: State<'_, SshSessionStore>, panel_id: String) -> Result<(), String> {
    let handle = store.sessions.lock().await.remove(&panel_id);

    if let Some(handle) = handle {
        let _ = handle.tx.send(SshSessionCommand::Close);
    }

    Ok(())
}

async fn run_shell_session(
    app: AppHandle,
    target: SshShellTarget,
    password: String,
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
            ..Default::default()
        });
        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some("opening tcp/ssh transport".to_string()),
        );
        let mut session = client::connect(config, (target.host.as_str(), target.port), ShellPilotSshClient)
            .await
            .map_err(|error| format!("ssh connect failed: {error}"))?;
        emit_terminal_event(
            &app,
            &panel_id,
            SshTerminalStatus::Info,
            None,
            Some("authenticating password".to_string()),
        );
        let auth = session
            .authenticate_password(target.username.clone(), password)
            .await
            .map_err(|error| format!("ssh password authentication failed: {error}"))?;

        if !auth.success() {
            return Err("ssh password authentication rejected by server".to_string());
        }

        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|error| format!("failed to open ssh channel: {error}"))?;

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
            .map_err(|error| format!("failed to request pty: {error}"))?;
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
            .map_err(|error| format!("failed to request shell: {error}"))?;

        emit_terminal_event(&app, &panel_id, SshTerminalStatus::Connected, None, None);
        let _ = channel.data_bytes("\r").await;

        loop {
            tokio::select! {
                command = rx.recv() => {
                    match command {
                        Some(SshSessionCommand::Close) | None => {
                            let _ = channel.eof().await;
                            let _ = session.disconnect(Disconnect::ByApplication, "closed", "en").await;
                            break;
                        }
                        Some(SshSessionCommand::Resize { cols, rows }) => {
                            channel
                                .window_change(cols, rows, 0, 0)
                                .await
                                .map_err(|error| format!("failed to resize pty: {error}"))?;
                        }
                        Some(SshSessionCommand::Write(data)) => {
                            channel
                                .data_bytes(data.into_bytes())
                                .await
                                .map_err(|error| format!("failed to write ssh data: {error}"))?;
                        }
                    }
                }
                message = channel.wait() => {
                    match message {
                        Some(ChannelMsg::Data { data }) => {
                            emit_terminal_event(
                                &app,
                                &panel_id,
                                SshTerminalStatus::Data,
                                Some(String::from_utf8_lossy(&data).to_string()),
                                None,
                            );
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            emit_terminal_event(
                                &app,
                                &panel_id,
                                SshTerminalStatus::Data,
                                Some(String::from_utf8_lossy(&data).to_string()),
                                None,
                            );
                        }
                        Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok::<(), String>(())
    }
    .await;

    match result {
        Ok(()) => emit_terminal_event(&app, &panel_id, SshTerminalStatus::Closed, None, None),
        Err(error) => emit_terminal_event(&app, &panel_id, SshTerminalStatus::Failed, None, Some(error)),
    }
}

fn read_ssh_banner(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = [0_u8; 256];
    let read_size = stream.read(&mut buffer).unwrap_or(0);

    if read_size == 0 {
        return None;
    }

    Some(String::from_utf8_lossy(&buffer[..read_size]).trim().to_string())
}

fn resolve_socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve host: {error}"))?
        .next()
        .ok_or_else(|| "failed to resolve host: no address found".to_string())
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
            data,
            message,
            panel_id: panel_id.to_string(),
            status,
        },
    );
}

struct ShellPilotSshClient;

impl client::Handler for ShellPilotSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn resolve_password(credential_id: Option<&str>, password: Option<&str>) -> Result<String, String> {
    if let Some(id) = credential_id {
        return read_credential_secret(id);
    }

    password
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "password credential is required".to_string())
}
