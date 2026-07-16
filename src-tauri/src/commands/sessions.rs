use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};

use crate::commands::credentials::delete_credential_secret;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SESSION_REGISTRY_FILE: &str = "sessions.v1.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRegistry {
    pub version: u8,
    pub groups: Vec<SessionGroup>,
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self {
            version: 1,
            groups: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGroup {
    pub id: String,
    pub name: String,
    pub sessions: Vec<SessionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialRef {
    pub id: String,
    pub kind: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionItem {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub auth_method: Option<String>,
    pub credential_ref: Option<CredentialRef>,
    pub favorite: Option<bool>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub group_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub last_used_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum CredentialBindingKind {
    Key,
    Password,
}

impl CredentialBindingKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Key => "key",
            Self::Password => "password",
        }
    }
}

pub(crate) struct CredentialBindingTarget<'a> {
    pub(crate) credential_id: &'a str,
    pub(crate) expected_kind: CredentialBindingKind,
    pub(crate) host: &'a str,
    pub(crate) port: u16,
    pub(crate) session_id: Option<&'a str>,
    pub(crate) username: &'a str,
}

pub(crate) fn verify_credential_binding(
    app: &AppHandle,
    target: CredentialBindingTarget<'_>,
) -> Result<(), String> {
    let session_id = target
        .session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "credential session scope is required".to_string())?;
    let registry = load_session_registry(app.clone())?;
    let session = registry
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .find(|session| session.id == session_id)
        .ok_or_else(|| "credential session scope was not found".to_string())?;
    let credential_ref = session
        .credential_ref
        .as_ref()
        .ok_or_else(|| "session does not reference a stored credential".to_string())?;

    if credential_ref.id != target.credential_id
        || credential_ref.kind != target.expected_kind.as_str()
    {
        return Err("credential does not match the requested session".to_string());
    }

    let session_host = session
        .host
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "session host is required for credential binding".to_string())?;

    if !session_host.eq_ignore_ascii_case(target.host.trim()) {
        return Err("credential host does not match the requested session".to_string());
    }

    if session.port.unwrap_or(22) != target.port {
        return Err("credential port does not match the requested session".to_string());
    }

    let session_username = session
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "session username is required for credential binding".to_string())?;

    if session_username != target.username.trim() {
        return Err("credential username does not match the requested session".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn load_session_registry(app: AppHandle) -> Result<SessionRegistry, String> {
    let path = session_registry_path(&app)?;

    if !path.exists() {
        return Ok(SessionRegistry::default());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read session registry: {error}"))?;
    let registry = serde_json::from_str::<SessionRegistry>(&raw)
        .map_err(|error| format!("failed to parse session registry: {error}"))?;

    if registry.version != 1 {
        return Err(format!(
            "unsupported session registry version: {}",
            registry.version
        ));
    }

    Ok(registry)
}

#[tauri::command]
pub fn save_session_registry(app: AppHandle, registry: SessionRegistry) -> Result<(), String> {
    let previous_registry = load_session_registry(app.clone()).ok();
    let path = session_registry_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "failed to resolve session registry directory".to_string())?;

    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create session registry directory: {error}"))?;

    let raw = serde_json::to_string_pretty(&registry)
        .map_err(|error| format!("failed to serialize session registry: {error}"))?;

    fs::write(&path, raw).map_err(|error| format!("failed to save session registry: {error}"))?;
    cleanup_orphaned_credentials(previous_registry.as_ref(), &registry);
    Ok(())
}

fn cleanup_orphaned_credentials(
    previous_registry: Option<&SessionRegistry>,
    next_registry: &SessionRegistry,
) {
    let Some(previous_registry) = previous_registry else {
        return;
    };

    let next_ids = collect_credential_ids(next_registry);

    for credential_id in collect_credential_ids(previous_registry) {
        if !next_ids.contains(&credential_id) {
            let _ = delete_credential_secret(&credential_id);
        }
    }
}

fn collect_credential_ids(registry: &SessionRegistry) -> HashSet<String> {
    registry
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter())
        .filter_map(|session| session.credential_ref.as_ref())
        .map(|credential_ref| credential_ref.id.clone())
        .collect()
}

fn session_registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(SESSION_REGISTRY_FILE))
}
