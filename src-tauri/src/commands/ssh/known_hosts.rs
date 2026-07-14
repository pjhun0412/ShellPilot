use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tauri::{AppHandle, Manager};

use super::SshKnownHostRecord;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownHosts {
    hosts: HashMap<String, KnownHostEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnownHostEntry {
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
}

pub(crate) enum KnownHostDecision {
    Mismatch { expected: KnownHostEntry },
    Trusted,
    Unknown,
}

pub(crate) fn forget_known_host(app: &AppHandle, host: &str, port: u16) -> Result<bool, String> {
    let key = known_host_key(host, port);
    let path = known_hosts_path(app)?;
    let mut known_hosts = read_known_hosts(&path)?;
    let removed = known_hosts.hosts.remove(&key).is_some();

    write_known_hosts(&path, &known_hosts)?;
    Ok(removed)
}

pub(crate) fn clear_known_hosts(app: &AppHandle) -> Result<usize, String> {
    let path = known_hosts_path(app)?;
    let known_hosts = read_known_hosts(&path)?;
    let removed = known_hosts.hosts.len();

    write_known_hosts(&path, &KnownHosts::default())?;
    Ok(removed)
}

pub(crate) fn list_known_hosts(app: &AppHandle) -> Result<Vec<SshKnownHostRecord>, String> {
    let path = known_hosts_path(app)?;
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

pub(crate) fn verify_known_host(
    app: &AppHandle,
    host: &str,
    port: u16,
    entry: &KnownHostEntry,
) -> Result<KnownHostDecision, String> {
    let key = known_host_key(host, port);
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

pub(crate) fn trust_known_host(
    app: &AppHandle,
    host: &str,
    port: u16,
    entry: &KnownHostEntry,
) -> Result<(), String> {
    let key = known_host_key(host, port);
    let path = known_hosts_path(app)?;
    let mut known_hosts = read_known_hosts(&path)?;

    known_hosts.hosts.insert(key, entry.clone());
    write_known_hosts(&path, &known_hosts)
}

fn known_host_key(host: &str, port: u16) -> String {
    format!("{}:{}", host.to_ascii_lowercase(), port)
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

    write_known_hosts_atomically(path, &content)
}

fn write_known_hosts_atomically(path: &Path, content: &str) -> Result<(), String> {
    let temporary_path = path.with_extension("json.tmp");
    let backup_path = path.with_extension("json.bak");

    fs::write(&temporary_path, content)
        .map_err(|error| format!("failed to write known hosts temporary file: {error}"))?;
    restrict_known_hosts_permissions(&temporary_path)?;

    if path.exists() {
        fs::copy(path, &backup_path)
            .map_err(|error| format!("failed to back up known hosts: {error}"))?;
        restrict_known_hosts_permissions(&backup_path)?;
    }

    // `fs::rename` already replaces an existing destination atomically on both
    // Unix (rename(2)) and Windows (MoveFileExW + MOVEFILE_REPLACE_EXISTING) —
    // deleting `path` first would just open a window where the file doesn't
    // exist on disk at all.
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("failed to commit known hosts update: {error}"))?;
    restrict_known_hosts_permissions(path)
}

#[cfg(unix)]
fn restrict_known_hosts_permissions(path: &Path) -> Result<(), String> {
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to secure known hosts permissions: {error}"))
}

#[cfg(not(unix))]
fn restrict_known_hosts_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}
