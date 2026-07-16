use std::sync::Arc;

use crate::commands::{
    credentials::{read_credential_secret, read_optional_credential_secret},
    sessions::{verify_credential_binding, CredentialBindingKind, CredentialBindingTarget},
};
use russh::{
    client::{self, KeyboardInteractiveAuthResponse},
    keys::{
        agent::client::{AgentClient, AgentStream},
        load_secret_key, HashAlg, PrivateKeyWithHashAlg,
    },
};
use tauri::AppHandle;

use super::{ShellPilotSshClient, SshShellTarget};

#[derive(Debug, Clone, Copy)]
pub(crate) struct SshCredentialScope<'a> {
    pub(crate) host: &'a str,
    pub(crate) port: u16,
    pub(crate) session_id: Option<&'a str>,
    pub(crate) username: &'a str,
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

pub(crate) async fn authenticate_session(
    app: &AppHandle,
    session: &mut client::Handle<ShellPilotSshClient>,
    username: &str,
    auth: &SshAuthRequest,
    credential_scope: SshCredentialScope<'_>,
) -> Result<(), String> {
    let authenticated = match auth {
        SshAuthRequest::Agent => authenticate_with_agent(session, username).await?,
        SshAuthRequest::Interactive {
            credential_id,
            response,
        } => {
            let response = resolve_secret(
                app,
                credential_id.as_deref(),
                response.as_deref(),
                credential_scope,
                CredentialBindingKind::Password,
                "interactive response",
            )?;

            authenticate_keyboard_interactive(session, username, response).await?
        }
        SshAuthRequest::Password {
            credential_id,
            password,
        } => {
            let secret = resolve_secret(
                app,
                credential_id.as_deref(),
                password.as_deref(),
                credential_scope,
                CredentialBindingKind::Password,
                "password",
            )?;

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
                app,
                passphrase_credential_id.as_deref(),
                passphrase.as_deref(),
                credential_scope,
                CredentialBindingKind::Key,
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

    let mut had_server_rejection = false;
    let mut signing_errors = Vec::new();

    for identity in identities {
        let public_key = identity.public_key().into_owned();
        let hash_alg = if public_key.algorithm().is_rsa() {
            Some(HashAlg::Sha256)
        } else {
            None
        };
        let result = match session
            .authenticate_publickey_with(username.to_string(), public_key, hash_alg, &mut agent)
            .await
        {
            Ok(result) => result,
            Err(error) => {
                signing_errors.push(error.to_string());
                continue;
            }
        };

        if result.success() {
            return Ok(true);
        }

        had_server_rejection = true;
    }

    if had_server_rejection {
        return Ok(false);
    }

    let error_summary = signing_errors
        .iter()
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .join("; ");
    let extra_count = signing_errors.len().saturating_sub(3);
    let extra_summary = if extra_count > 0 {
        format!("; plus {extra_count} more")
    } else {
        String::new()
    };

    Err(format!(
        "SSH agent signing failed for all identities: {error_summary}{extra_summary}"
    ))
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

fn resolve_secret(
    app: &AppHandle,
    credential_id: Option<&str>,
    secret: Option<&str>,
    credential_scope: SshCredentialScope<'_>,
    credential_kind: CredentialBindingKind,
    secret_name: &str,
) -> Result<String, String> {
    if let Some(id) = credential_id {
        verify_scoped_credential(app, id, credential_scope, credential_kind)?;
        return read_credential_secret(id);
    }

    secret
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{secret_name} credential is required"))
}

fn resolve_optional_secret(
    app: &AppHandle,
    credential_id: Option<&str>,
    secret: Option<&str>,
    credential_scope: SshCredentialScope<'_>,
    credential_kind: CredentialBindingKind,
) -> Result<Option<String>, String> {
    if let Some(id) = credential_id {
        verify_scoped_credential(app, id, credential_scope, credential_kind)?;
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

fn verify_scoped_credential(
    app: &AppHandle,
    credential_id: &str,
    credential_scope: SshCredentialScope<'_>,
    credential_kind: CredentialBindingKind,
) -> Result<(), String> {
    verify_credential_binding(
        app,
        CredentialBindingTarget {
            credential_id,
            expected_kind: credential_kind,
            host: credential_scope.host,
            port: credential_scope.port,
            session_id: credential_scope.session_id,
            username: credential_scope.username,
        },
    )
}
