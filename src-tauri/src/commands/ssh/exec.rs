use std::{sync::Arc, time::Duration};

use russh::{client, ChannelMsg, Disconnect};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::time;

use super::{
    auth::{authenticate_session, SshAuthRequest},
    errors::{classify_auth_error, classify_connect_error},
    ShellPilotSshClient, SshShellTarget,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCommandResult {
    error: Option<String>,
    exit_code: Option<u32>,
    stderr: String,
    stdout: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshReadonlyCommandsRequest {
    commands: Vec<String>,
    target: SshShellTarget,
    working_directories: Option<Vec<Option<String>>>,
}

pub(crate) async fn run_readonly_commands(
    app: AppHandle,
    request: SshReadonlyCommandsRequest,
) -> Result<Vec<SshCommandResult>, String> {
    let commands = request
        .commands
        .iter()
        .enumerate()
        .map(|(index, command)| {
            let command = validate_readonly_command(command)?;
            let working_directory = request
                .working_directories
                .as_ref()
                .and_then(|directories| directories.get(index))
                .and_then(|directory| directory.as_deref())
                .map(validate_readonly_working_directory)
                .transpose()?;

            build_readonly_execution_string(command, working_directory)
        })
        .collect::<Result<Vec<_>, _>>()?;

    run_ssh_exec_many(app, request.target, &commands, Duration::from_secs(15)).await
}

async fn run_ssh_exec_many(
    app: AppHandle,
    target: SshShellTarget,
    commands: &[String],
    timeout: Duration,
) -> Result<Vec<SshCommandResult>, String> {
    let auth = SshAuthRequest::from_target(&target);
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(timeout),
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        ..Default::default()
    });
    // One connection/authentication is reused for every command in the plan
    // instead of reconnecting per step, which used to dominate latency.
    let mut session = client::connect(
        config,
        (target.host.as_str(), target.port),
        ShellPilotSshClient::new(
            app.clone(),
            Some(target.panel_id.clone()),
            &target.host,
            target.port,
            target.accept_new_host_key.unwrap_or(false),
            target.accepted_host_key_fingerprint.clone(),
        ),
    )
    .await
    .map_err(|error| classify_connect_error(error.to_string()).message)?;

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
    .map_err(|error| classify_auth_error(error, &auth).message)?;

    let mut results = Vec::with_capacity(commands.len());

    for command in commands {
        results.push(exec_one_command(&mut session, command, timeout).await);
    }

    let _ = session
        .disconnect(Disconnect::ByApplication, "exec complete", "en")
        .await;

    Ok(results)
}

async fn exec_one_command(
    session: &mut client::Handle<ShellPilotSshClient>,
    command: &str,
    timeout: Duration,
) -> SshCommandResult {
    let outcome = time::timeout(timeout, async {
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|error| format!("failed to open ssh exec channel: {error}"))?;

        channel
            .exec(true, command)
            .await
            .map_err(|error| format!("failed to execute remote command: {error}"))?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code = None;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    stdout.push_str(&String::from_utf8_lossy(&data));
                    if stdout.len() > 24_000 {
                        stdout.truncate(24_000);
                        stdout.push_str("\n[output truncated]\n");
                    }
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    stderr.push_str(&String::from_utf8_lossy(&data));
                    if stderr.len() > 8_000 {
                        stderr.truncate(8_000);
                        stderr.push_str("\n[stderr truncated]\n");
                    }
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(exit_status);
                }
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        Ok::<SshCommandResult, String>(SshCommandResult {
            error: None,
            exit_code,
            stderr,
            stdout,
        })
    })
    .await;

    match outcome {
        Ok(Ok(command_result)) => command_result,
        Ok(Err(message)) => SshCommandResult {
            error: Some(message),
            exit_code: None,
            stderr: String::new(),
            stdout: String::new(),
        },
        Err(_) => SshCommandResult {
            error: Some(format!(
                "remote command timed out after {} seconds",
                timeout.as_secs()
            )),
            exit_code: None,
            stderr: String::new(),
            stdout: String::new(),
        },
    }
}

fn validate_readonly_command(command: &str) -> Result<&str, String> {
    let command = command.trim();

    if command.is_empty() {
        return Err("read-only command is empty".to_string());
    }

    if command.len() > 500 {
        return Err("read-only command is too long".to_string());
    }

    // Block shell control operators. A single `&` can split foreground and
    // background jobs, so checking only `&&` is not sufficient.
    let forbidden_tokens = [";", "&", "`", "$(", ">", "<", "|", "\n", "\r"];

    if let Some(token) = forbidden_tokens
        .iter()
        .find(|token| command.contains(**token))
    {
        return Err(format!(
            "read-only command rejected: forbidden token `{token}`"
        ));
    }

    let first_word = command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|value: char| value == '\'' || value == '"');
    let allowed_commands = [
        "cat",
        "df",
        "dir",
        "du",
        "egrep",
        "find",
        "free",
        "grep",
        "head",
        "id",
        "journalctl",
        "ls",
        "lsof",
        "netstat",
        "pgrep",
        "ps",
        "pwd",
        "ss",
        "stat",
        "sw_vers",
        "sysctl",
        "tail",
        "tasklist",
        "uname",
        "uptime",
        "ver",
        "vm_stat",
        "wc",
        "wmic",
        "who",
        "whoami",
        "zcat",
        "zgrep",
    ];

    if !allowed_commands.contains(&first_word) {
        return Err(format!(
            "read-only command rejected: `{first_word}` is not allowed"
        ));
    }

    if first_word == "wmic" {
        let lower = command.to_ascii_lowercase();
        let allowed_wmic_query = lower.contains(" get ")
            && !lower.contains(" call ")
            && !lower.contains(" create ")
            && !lower.contains(" delete ")
            && !lower.contains(" set ");

        if !allowed_wmic_query {
            return Err(
                "read-only command rejected: only WMIC query commands are allowed".to_string(),
            );
        }
    }

    if first_word == "sysctl" {
        let lower = command.to_ascii_lowercase();

        if lower.contains(" -w ") || lower.starts_with("sysctl -w") {
            return Err("read-only command rejected: sysctl writes are not allowed".to_string());
        }
    }

    let forbidden_words = [
        "apt",
        "bash",
        "chmod",
        "chown",
        "cp",
        "curl",
        "dd",
        "dnf",
        "kill",
        "mkfs",
        "mkdir",
        "mv",
        "perl",
        "pkill",
        "python",
        "python3",
        "reboot",
        "rm",
        "rmdir",
        "service",
        "sh",
        "shutdown",
        "sudo",
        "systemctl",
        "tee",
        "touch",
        "truncate",
        "wget",
        "yum",
        // find is allowed for discovery, but these actions can execute
        // commands, delete files, or write reports on the remote host.
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-delete",
        "-fprint",
        "-fprintf",
        "-fls",
        // journalctl has maintenance options that mutate journal state.
        "--vacuum-time",
        "--flush",
        "--relinquish-var",
        "--smart-relinquish-var",
        "--sync",
        "--vacuum-size",
        "--vacuum-files",
        "--rotate",
    ];

    for word in
        command.split(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '-')
    {
        if forbidden_words.contains(&word) {
            return Err(format!(
                "read-only command rejected: `{word}` is not allowed"
            ));
        }
    }

    Ok(command)
}

fn validate_readonly_working_directory(directory: &str) -> Result<&str, String> {
    let directory = directory.trim();

    if directory.is_empty() {
        return Err("read-only command rejected: working directory is empty".to_string());
    }

    if directory.len() > 260 {
        return Err("read-only command rejected: working directory is too long".to_string());
    }

    if !directory.starts_with('/') && !directory.starts_with("~/") {
        return Err(
            "read-only command rejected: working directory must be absolute or home-relative"
                .to_string(),
        );
    }

    if directory.contains("..") {
        return Err(
            "read-only command rejected: working directory cannot contain `..`".to_string(),
        );
    }

    let forbidden_tokens = [
        "\"", "'", "`", "\\", ";", "&", "|", "$", ">", "<", "\n", "\r",
    ];

    if let Some(token) = forbidden_tokens
        .iter()
        .find(|token| directory.contains(**token))
    {
        return Err(format!(
            "read-only command rejected: working directory contains forbidden token `{token}`"
        ));
    }

    Ok(directory)
}

// Builds the final string that is actually sent to the remote shell. This is
// deliberately a separate check from `validate_readonly_command`: that
// function validates a bare user-facing command, never one containing `&&`.
// This wrapper is the one place allowed to introduce `&&`, and only in this
// exact `cd -- "<dir>" && <command>` shape, over pieces that were already
// validated independently. Re-checking the directory here (instead of just
// trusting the caller) means a future change to `validate_readonly_working_directory`
// or to this function can't silently widen what reaches the remote shell.
fn build_readonly_execution_string(
    command: &str,
    working_directory: Option<&str>,
) -> Result<String, String> {
    let Some(directory) = working_directory else {
        return Ok(command.to_string());
    };

    if directory.is_empty() || directory.contains('"') {
        return Err(
            "read-only command rejected: working directory wrapper is malformed".to_string(),
        );
    }

    let prefix = format!("cd -- \"{directory}\" && ");
    let assembled = format!("{prefix}{command}");

    match assembled.strip_prefix(prefix.as_str()) {
        Some(remainder) if remainder == command => Ok(assembled),
        _ => Err(
            "read-only command rejected: working directory wrapper structure mismatch".to_string(),
        ),
    }
}
