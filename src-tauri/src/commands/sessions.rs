use std::{collections::HashMap, fs, path::PathBuf};

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
        return Err(format!("unsupported session registry version: {}", registry.version));
    }

    Ok(registry)
}

#[tauri::command]
pub fn save_session_registry(app: AppHandle, registry: SessionRegistry) -> Result<(), String> {
    let path = session_registry_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "failed to resolve session registry directory".to_string())?;

    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create session registry directory: {error}"))?;

    let raw = serde_json::to_string_pretty(&registry)
        .map_err(|error| format!("failed to serialize session registry: {error}"))?;

    fs::write(&path, raw).map_err(|error| format!("failed to save session registry: {error}"))?;
    Ok(())
}

fn session_registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(SESSION_REGISTRY_FILE))
}
