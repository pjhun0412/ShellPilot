use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    sync::Arc,
    time::{Duration, Instant},
};

use russh::{client, keys::ssh_key, Disconnect};
use tauri::{AppHandle, State};

mod auth;
mod errors;
mod exec;
mod known_hosts;
mod shell;

pub(crate) use auth::{authenticate_session, SshAuthRequest};
use exec::{run_readonly_commands, SshCommandResult, SshReadonlyCommandsRequest};
use known_hosts::{
    clear_known_hosts as clear_known_hosts_store, forget_known_host, list_known_hosts,
    trust_known_host, verify_known_host, KnownHostDecision, KnownHostEntry,
};
pub use shell::SshSessionStore;
use shell::{close_shell, emit_terminal_warning, open_shell, resize_shell, write_shell};

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
    open_shell(app, store, target).await
}

#[tauri::command]
pub async fn ssh_run_readonly_commands(
    app: AppHandle,
    request: SshReadonlyCommandsRequest,
) -> Result<Vec<SshCommandResult>, String> {
    run_readonly_commands(app, request).await
}

#[tauri::command]
pub async fn ssh_write(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    data: String,
) -> Result<(), String> {
    write_shell(store, panel_id, data).await
}

#[tauri::command]
pub async fn ssh_resize(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    resize_shell(store, panel_id, cols, rows).await
}

#[tauri::command]
pub async fn ssh_close(store: State<'_, SshSessionStore>, panel_id: String) -> Result<(), String> {
    close_shell(store, panel_id).await
}

#[tauri::command]
pub fn forget_ssh_known_host(app: AppHandle, host: String, port: u16) -> Result<bool, String> {
    forget_known_host(&app, &host, port)
}

#[tauri::command]
pub fn clear_ssh_known_hosts(app: AppHandle) -> Result<usize, String> {
    clear_known_hosts_store(&app)
}

#[tauri::command]
pub fn list_ssh_known_hosts(app: AppHandle) -> Result<Vec<SshKnownHostRecord>, String> {
    list_known_hosts(&app)
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
