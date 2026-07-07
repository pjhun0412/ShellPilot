use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::{
    io::Read,
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use crate::commands::credentials::{read_credential_secret, read_optional_credential_secret};
use russh::{
    client::{self, KeyboardInteractiveAuthResponse},
    keys::{
        agent::client::{AgentClient, AgentStream},
        load_secret_key, ssh_key, HashAlg, PrivateKeyWithHashAlg,
    },
    ChannelMsg, Disconnect,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

#[derive(Default)]
pub struct SshSessionStore {
    sessions: Mutex<HashMap<String, SshSessionHandle>>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownHosts {
    hosts: HashMap<String, KnownHostEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownHostEntry {
    algorithm: String,
    fingerprint: String,
}

struct SshSessionHandle {
    tx: mpsc::UnboundedSender<SshSessionCommand>,
}

enum SshSessionCommand {
    Close,
    Resize { cols: u32, rows: u32 },
    Write(String),
}

pub(crate) enum SshAuthRequest {
    Agent,
    Interactive {
        credential_id: Option<String>,
        response: Option<String>,
    },
    Password {
        credential_id: Option<String>,
        password: Option<String>,
    },
    Key {
        passphrase: Option<String>,
        passphrase_credential_id: Option<String>,
        private_key_path: Option<String>,
    },
}

impl SshAuthRequest {
    pub(crate) fn from_target(target: &SshShellTarget) -> Self {
        match target.auth_method.as_deref() {
            Some("agent") => Self::Agent,
            Some("interactive") => Self::Interactive {
                credential_id: target.credential_id.clone(),
                response: target.password.clone(),
            },
            Some("key") => Self::Key {
                passphrase: target.passphrase.clone(),
                passphrase_credential_id: target.passphrase_credential_id.clone(),
                private_key_path: target.private_key_path.clone(),
            },
            _ => Self::Password {
                credential_id: target.credential_id.clone(),
                password: target.password.clone(),
            },
        }
    }

    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Agent => "SSH agent",
            Self::Interactive { .. } => "keyboard-interactive",
            Self::Password { .. } => "password",
            Self::Key { .. } => "public key",
        }
    }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKnownHostRecord {
    algorithm: String,
    fingerprint: String,
    host: String,
    port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshShellTarget {
    pub(crate) accept_new_host_key: Option<bool>,
    pub(crate) auth_method: Option<String>,
    pub(crate) credential_id: Option<String>,
    pub(crate) host: String,
    pub(crate) panel_id: String,
    pub(crate) password: Option<String>,
    pub(crate) passphrase: Option<String>,
    pub(crate) passphrase_credential_id: Option<String>,
    pub(crate) port: u16,
    pub(crate) private_key_path: Option<String>,
    pub(crate) username: String,
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

#[derive(Debug)]
struct SshFailure {
    auth_prompt: bool,
    code: &'static str,
    message: String,
    retryable: bool,
}

impl SshFailure {
    fn auth(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: true,
            code: "auth_failed",
            message: message.into(),
            retryable: true,
        }
    }

    fn auth_with_code(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code,
            message: message.into(),
            retryable: true,
        }
    }

    fn connection(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "connection_failed",
            message: message.into(),
            retryable: true,
        }
    }

    fn connection_with_code(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code,
            message: message.into(),
            retryable: true,
        }
    }

    fn host_key(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "host_key_mismatch",
            message: message.into(),
            retryable: false,
        }
    }

    fn unknown_host_key(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "host_key_unknown",
            message: message.into(),
            retryable: true,
        }
    }

    fn session(message: impl Into<String>) -> Self {
        Self {
            auth_prompt: false,
            code: "session_failed",
            message: message.into(),
            retryable: true,
        }
    }
}

impl From<String> for SshFailure {
    fn from(message: String) -> Self {
        Self::session(message)
    }
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
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    credential_id: Option<String>,
    password: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<SshConnectResult, String> {
    let started_at = Instant::now();
    let auth = SshAuthRequest::Password {
        credential_id,
        password,
    };
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(8000));

    let config = Arc::new(client::Config {
        inactivity_timeout: Some(timeout),
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });

    let mut session = client::connect(
        config,
        (host.as_str(), port),
        ShellPilotSshClient::new(app, None, &host, port, false),
    )
    .await
    .map_err(|error| format!("ssh connect failed: {error}"))?;

    authenticate_session(&mut session, &username, &auth).await?;

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

    let auth = SshAuthRequest::from_target(&target);
    let (tx, rx) = mpsc::unbounded_channel();
    let panel_id = target.panel_id.clone();

    store
        .sessions
        .lock()
        .await
        .insert(panel_id.clone(), SshSessionHandle { tx });

    tauri::async_runtime::spawn(run_shell_session(app, target, auth, rx));
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

#[tauri::command]
pub fn forget_ssh_known_host(app: AppHandle, host: String, port: u16) -> Result<bool, String> {
    let key = format!("{}:{}", host.to_ascii_lowercase(), port);
    let path = known_hosts_path(&app)?;
    let mut known_hosts = read_known_hosts(&path)?;
    let removed = known_hosts.hosts.remove(&key).is_some();

    write_known_hosts(&path, &known_hosts)?;
    Ok(removed)
}

#[tauri::command]
pub fn clear_ssh_known_hosts(app: AppHandle) -> Result<usize, String> {
    let path = known_hosts_path(&app)?;
    let known_hosts = read_known_hosts(&path)?;
    let removed = known_hosts.hosts.len();

    write_known_hosts(&path, &KnownHosts::default())?;
    Ok(removed)
}

#[tauri::command]
pub fn list_ssh_known_hosts(app: AppHandle) -> Result<Vec<SshKnownHostRecord>, String> {
    let path = known_hosts_path(&app)?;
    let known_hosts = read_known_hosts(&path)?;
    let mut records = known_hosts
        .hosts
        .into_iter()
        .filter_map(|(key, entry)| {
            let (host, port) = key.rsplit_once(':')?;
            Some(SshKnownHostRecord {
                algorithm: entry.algorithm,
                fingerprint: entry.fingerprint,
                host: host.to_string(),
                port: port.parse().unwrap_or(22),
            })
        })
        .collect::<Vec<_>>();

    records.sort_by(|left, right| {
        left.host
            .cmp(&right.host)
            .then_with(|| left.port.cmp(&right.port))
    });

    Ok(records)
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
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
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
                            break;
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

fn read_ssh_banner(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = [0_u8; 256];
    let read_size = stream.read(&mut buffer).unwrap_or(0);

    if read_size == 0 {
        return None;
    }

    Some(
        String::from_utf8_lossy(&buffer[..read_size])
            .trim()
            .to_string(),
    )
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

fn emit_terminal_warning(
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

pub(crate) async fn authenticate_session(
    session: &mut client::Handle<ShellPilotSshClient>,
    username: &str,
    auth: &SshAuthRequest,
) -> Result<(), String> {
    let authenticated = match auth {
        SshAuthRequest::Agent => authenticate_with_agent(session, username).await?,
        SshAuthRequest::Interactive {
            credential_id,
            response,
        } => {
            let response = resolve_secret(
                credential_id.as_deref(),
                response.as_deref(),
                "interactive response",
            )?;

            authenticate_keyboard_interactive(session, username, response).await?
        }
        SshAuthRequest::Password {
            credential_id,
            password,
        } => {
            let secret = resolve_secret(credential_id.as_deref(), password.as_deref(), "password")?;

            session
                .authenticate_password(username.to_string(), secret)
                .await
                .map_err(|error| format!("ssh password authentication failed: {error}"))?
                .success()
        }
        SshAuthRequest::Key {
            passphrase,
            passphrase_credential_id,
            private_key_path,
        } => {
            let key_path = private_key_path
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "private key path is required".to_string())?;
            let passphrase = resolve_optional_secret(
                passphrase_credential_id.as_deref(),
                passphrase.as_deref(),
            )?;
            let key = load_secret_key(key_path, passphrase.as_deref())
                .map_err(|error| format!("failed to load ssh private key: {error}"))?;
            let hash_alg = if key.algorithm().is_rsa() {
                Some(HashAlg::Sha256)
            } else {
                None
            };

            session
                .authenticate_publickey(
                    username.to_string(),
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|error| format!("ssh public key authentication failed: {error}"))?
                .success()
        }
    };

    if !authenticated {
        return Err(format!(
            "ssh {} authentication rejected by server",
            auth.label()
        ));
    }

    Ok(())
}

async fn authenticate_keyboard_interactive(
    session: &mut client::Handle<ShellPilotSshClient>,
    username: &str,
    response: String,
) -> Result<bool, String> {
    let mut result = session
        .authenticate_keyboard_interactive_start(username.to_string(), None::<String>)
        .await
        .map_err(|error| format!("ssh keyboard-interactive authentication failed: {error}"))?;
    let mut rounds = 0;

    loop {
        match result {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                rounds += 1;
                if rounds > 4 {
                    return Err(
                        "ssh keyboard-interactive authentication exceeded prompt limit".to_string(),
                    );
                }

                if prompts.len() > 8 {
                    return Err(
                        "ssh keyboard-interactive authentication sent too many prompts".to_string(),
                    );
                }

                let responses = prompts
                    .iter()
                    .map(|prompt| {
                        if prompt.prompt.trim().is_empty() {
                            String::new()
                        } else {
                            response.clone()
                        }
                    })
                    .collect();

                result = session
                    .authenticate_keyboard_interactive_respond(responses)
                    .await
                    .map_err(|error| {
                        format!("ssh keyboard-interactive authentication failed: {error}")
                    })?;
            }
        }
    }
}

async fn authenticate_with_agent(
    session: &mut client::Handle<ShellPilotSshClient>,
    username: &str,
) -> Result<bool, String> {
    let mut agent = connect_ssh_agent().await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|error| format!("failed to list SSH agent identities: {error}"))?;

    if identities.is_empty() {
        return Err("SSH agent has no identities loaded".to_string());
    }

    for identity in identities {
        let public_key = identity.public_key().into_owned();
        let hash_alg = if public_key.algorithm().is_rsa() {
            Some(HashAlg::Sha256)
        } else {
            None
        };
        let result = session
            .authenticate_publickey_with(username.to_string(), public_key, hash_alg, &mut agent)
            .await
            .map_err(|error| format!("SSH agent signing failed: {error}"))?;

        if result.success() {
            return Ok(true);
        }
    }

    Ok(false)
}

type BoxedAgentClient = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

#[cfg(windows)]
async fn connect_ssh_agent() -> Result<BoxedAgentClient, String> {
    match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
        Ok(client) => return Ok(client.dynamic()),
        Err(open_ssh_error) => match AgentClient::connect_pageant().await {
            Ok(client) => Ok(client.dynamic()),
            Err(pageant_error) => Err(format!(
                "failed to connect to SSH agent. OpenSSH agent: {open_ssh_error}; Pageant: {pageant_error}"
            )),
        },
    }
}

#[cfg(unix)]
async fn connect_ssh_agent() -> Result<BoxedAgentClient, String> {
    AgentClient::connect_env()
        .await
        .map(AgentClient::dynamic)
        .map_err(|error| format!("failed to connect to SSH_AUTH_SOCK agent: {error}"))
}

#[cfg(not(any(windows, unix)))]
async fn connect_ssh_agent() -> Result<BoxedAgentClient, String> {
    Err("SSH agent authentication is not supported on this platform".to_string())
}

pub(crate) struct ShellPilotSshClient {
    accept_new_host_key: bool,
    app: AppHandle,
    host: String,
    panel_id: Option<String>,
    port: u16,
}

impl ShellPilotSshClient {
    pub(crate) fn new(
        app: AppHandle,
        panel_id: Option<String>,
        host: &str,
        port: u16,
        accept_new_host_key: bool,
    ) -> Self {
        Self {
            accept_new_host_key,
            app,
            host: host.to_string(),
            panel_id,
            port,
        }
    }
}

impl client::Handler for ShellPilotSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let entry = KnownHostEntry {
            algorithm: server_public_key.algorithm().to_string(),
            fingerprint: server_public_key
                .fingerprint(ssh_key::HashAlg::Sha256)
                .to_string(),
        };

        match verify_known_host(&self.app, &self.host, self.port, &entry) {
            Ok(KnownHostDecision::Trusted) => Ok(true),
            Ok(KnownHostDecision::Unknown) if self.accept_new_host_key => {
                if let Err(error) = trust_known_host(&self.app, &self.host, self.port, &entry) {
                    emit_terminal_warning(
                        &self.app,
                        self.panel_id.as_deref(),
                        "host_key_store_failed",
                        format!("Security: failed to store SSH host key: {error}"),
                    );
                    return Err(russh::Error::UnknownKey);
                }

                emit_terminal_warning(
                    &self.app,
                    self.panel_id.as_deref(),
                    "host_key_trusted",
                    format!(
                        "Security: trusted new SSH host key for {}:{} ({})",
                        self.host, self.port, entry.fingerprint
                    ),
                );
                Ok(true)
            }
            Ok(KnownHostDecision::Unknown) => {
                emit_terminal_warning(
                    &self.app,
                    self.panel_id.as_deref(),
                    "host_key_unknown",
                    format!(
                        "Security: unknown SSH host key for {}:{}.\nAlgorithm: {}\nFingerprint: {}\nOnly trust this key if it matches the server you intended to reach.",
                        self.host, self.port, entry.algorithm, entry.fingerprint
                    ),
                );
                Ok(false)
            }
            Ok(KnownHostDecision::Mismatch { expected }) => {
                emit_terminal_warning(
                    &self.app,
                    self.panel_id.as_deref(),
                    "host_key_mismatch",
                    format!(
                        "Security: SSH host key mismatch for {}:{}. Expected {}, got {}.",
                        self.host, self.port, expected.fingerprint, entry.fingerprint
                    ),
                );
                Err(russh::Error::KeyChanged { line: 0 })
            }
            Err(error) => {
                emit_terminal_warning(
                    &self.app,
                    self.panel_id.as_deref(),
                    "host_key_store_failed",
                    format!("Security: failed to verify SSH host key: {error}"),
                );
                Err(russh::Error::UnknownKey)
            }
        }
    }
}

enum KnownHostDecision {
    Mismatch { expected: KnownHostEntry },
    Trusted,
    Unknown,
}

fn verify_known_host(
    app: &AppHandle,
    host: &str,
    port: u16,
    entry: &KnownHostEntry,
) -> Result<KnownHostDecision, String> {
    let key = format!("{}:{}", host.to_ascii_lowercase(), port);
    let path = known_hosts_path(app)?;
    let known_hosts = read_known_hosts(&path)?;

    if let Some(expected) = known_hosts.hosts.get(&key) {
        if expected.fingerprint == entry.fingerprint && expected.algorithm == entry.algorithm {
            return Ok(KnownHostDecision::Trusted);
        }

        return Ok(KnownHostDecision::Mismatch {
            expected: expected.clone(),
        });
    }

    Ok(KnownHostDecision::Unknown)
}

fn trust_known_host(
    app: &AppHandle,
    host: &str,
    port: u16,
    entry: &KnownHostEntry,
) -> Result<(), String> {
    let key = format!("{}:{}", host.to_ascii_lowercase(), port);
    let path = known_hosts_path(app)?;
    let mut known_hosts = read_known_hosts(&path)?;

    known_hosts.hosts.insert(key, entry.clone());
    write_known_hosts(&path, &known_hosts)
}

fn known_hosts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create app data directory: {error}"))?;

    Ok(directory.join("known_hosts.json"))
}

fn read_known_hosts(path: &PathBuf) -> Result<KnownHosts, String> {
    if !path.exists() {
        return Ok(KnownHosts::default());
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("failed to read known hosts: {error}"))?;

    serde_json::from_str(&content).map_err(|error| format!("failed to parse known hosts: {error}"))
}

fn write_known_hosts(path: &PathBuf, known_hosts: &KnownHosts) -> Result<(), String> {
    let content = serde_json::to_string_pretty(known_hosts)
        .map_err(|error| format!("failed to serialize known hosts: {error}"))?;

    fs::write(path, content).map_err(|error| format!("failed to write known hosts: {error}"))
}

fn classify_auth_error(error: String, auth: &SshAuthRequest) -> SshFailure {
    let label = auth.label();

    if matches!(auth, SshAuthRequest::Agent) {
        return SshFailure::auth_with_code(
            "agent_failed",
            format!("SSH agent authentication failed. Make sure OpenSSH Agent or Pageant is running and has a valid identity loaded. {error}"),
        );
    }

    SshFailure::auth(format!("SSH {label} authentication failed. {error}"))
}

fn classify_connect_error(error: String) -> SshFailure {
    let lower = error.to_ascii_lowercase();

    if lower.contains("unknown server key") || lower.contains("unknownkey") {
        return SshFailure::unknown_host_key(
            "SSH host key is not trusted yet. Verify the fingerprint and trust this server to continue.",
        );
    }

    if lower.contains("key changed") {
        return SshFailure::host_key(format!("SSH host key verification failed. {error}"));
    }

    if is_host_key_verification_error(&lower) {
        return SshFailure::host_key(format!("SSH host key verification failed. {error}"));
    }

    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connectiontimeout")
    {
        return SshFailure::connection_with_code(
            "connection_timeout",
            format!(
                "SSH connection timed out. Check network reachability and firewall rules. {error}"
            ),
        );
    }

    if lower.contains("refused") || lower.contains("10061") {
        return SshFailure::connection_with_code(
            "connection_refused",
            format!(
                "SSH connection was refused. Check that SSH is running on the target port. {error}"
            ),
        );
    }

    if lower.contains("no route")
        || lower.contains("network unreachable")
        || lower.contains("10065")
    {
        return SshFailure::connection_with_code(
            "network_unreachable",
            format!("SSH network is unreachable. Check routing, VPN, and firewall rules. {error}"),
        );
    }

    if lower.contains("resolve")
        || lower.contains("lookup")
        || lower.contains("dns")
        || lower.contains("no address")
    {
        return SshFailure::connection_with_code(
            "dns_failed",
            format!("SSH host could not be resolved. Check the host name or DNS settings. {error}"),
        );
    }

    SshFailure::connection(format!("SSH connection failed. {error}"))
}

fn is_host_key_verification_error(lower: &str) -> bool {
    lower.contains("host key verification")
        || lower.contains("server key verification")
        || lower.contains("hostkey")
        || lower.contains("keychanged")
}

fn resolve_secret(
    credential_id: Option<&str>,
    secret: Option<&str>,
    secret_name: &str,
) -> Result<String, String> {
    if let Some(id) = credential_id {
        return read_credential_secret(id);
    }

    secret
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{secret_name} credential is required"))
}

fn resolve_optional_secret(
    credential_id: Option<&str>,
    secret: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(id) = credential_id {
        return match read_optional_credential_secret(id) {
            Ok(Some(value)) if !value.is_empty() => Ok(Some(value)),
            Ok(_) if secret.is_some_and(|value| !value.is_empty()) => {
                Ok(secret.map(ToOwned::to_owned))
            }
            Ok(_) => Ok(None),
            Err(error) => Err(error),
        };
    }

    Ok(secret
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_key_exchange_failure_as_retryable_connection_error() {
        let failure = classify_connect_error("Key exchange failed".to_string());

        assert_eq!(failure.code, "connection_failed");
        assert!(failure.retryable);
        assert!(!failure.auth_prompt);
    }

    #[test]
    fn classify_key_exchange_init_failure_as_retryable_connection_error() {
        let failure = classify_connect_error("Key exchange init failed".to_string());

        assert_eq!(failure.code, "connection_failed");
        assert!(failure.retryable);
        assert!(!failure.auth_prompt);
    }

    #[test]
    fn classify_unknown_server_key_as_trust_prompt() {
        let failure = classify_connect_error("unknown server key".to_string());

        assert_eq!(failure.code, "host_key_unknown");
        assert!(failure.retryable);
        assert!(!failure.auth_prompt);
    }

    #[test]
    fn classify_changed_host_key_as_blocking_host_key_error() {
        let failure = classify_connect_error("key changed".to_string());

        assert_eq!(failure.code, "host_key_mismatch");
        assert!(!failure.retryable);
        assert!(!failure.auth_prompt);
    }
}
