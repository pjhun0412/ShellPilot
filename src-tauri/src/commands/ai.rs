use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Error, ErrorKind, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// npm으로 설치된 claude/codex는 Windows에서 .cmd 셸 스크립트라, 확장자 없이는 spawn이 못 찾는다.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct AiRunStore {
    runs: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderInfo {
    id: String,
    label: String,
    command: String,
    available: bool,
    version: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPromptRequest {
    provider_id: String,
    prompt: String,
    context: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPromptStreamRequest {
    panel_id: String,
    run_id: String,
    provider_id: String,
    prompt: String,
    context: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPromptResponse {
    output: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPromptStreamEvent {
    panel_id: String,
    run_id: String,
    status: &'static str,
    data: Option<String>,
    message: Option<String>,
}

#[tauri::command]
pub async fn ai_list_providers() -> Vec<AiProviderInfo> {
    // 프로세스 spawn+대기가 최대 5초씩 걸릴 수 있어 blocking 스레드로 분리 (안 그러면 UI가 멈춤)
    tauri::async_runtime::spawn_blocking(|| {
        vec![probe_provider("claude-cli", "Claude CLI", "claude"), probe_provider("codex-cli", "Codex CLI", "codex")]
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn ai_run_prompt(request: AiPromptRequest) -> Result<AiPromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (command, args, stdin_input) = build_prompt_command(&request)?;
        let timeout = Duration::from_secs(request.timeout_seconds.unwrap_or(180).clamp(1, 180));
        let output = run_command(&command, args, None, timeout, stdin_input)?;

        if !output.status_success {
            return Err(first_non_empty(&output.stderr, &output.stdout)
                .unwrap_or("AI CLI exited with a non-zero status")
                .to_string());
        }

        Ok(AiPromptResponse {
            output: first_non_empty(&output.stdout, &output.stderr)
                .unwrap_or("")
                .to_string(),
        })
    })
    .await
    .map_err(|error| format!("failed to join AI prompt task: {error}"))?
}

#[tauri::command]
pub async fn ai_run_prompt_stream(app: AppHandle, request: AiPromptStreamRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_prompt_stream(app, request);
    });

    Ok(())
}

#[tauri::command]
pub async fn ai_cancel_prompt(app: AppHandle, run_id: String) -> Result<(), String> {
    let store = app.state::<AiRunStore>();
    let child = store
        .runs
        .lock()
        .map_err(|_| "failed to lock AI run store".to_string())?
        .remove(&run_id);

    if let Some(child) = child {
        let mut child = child
            .lock()
            .map_err(|_| "failed to lock AI process".to_string())?;
        let _ = child.kill();
        return Ok(());
    }

    Ok(())
}

fn probe_provider(id: &str, label: &str, command: &str) -> AiProviderInfo {
    match run_command(command, vec!["--version".to_string()], None, Duration::from_secs(5), None) {
        Ok(output) if output.status_success => AiProviderInfo {
            id: id.to_string(),
            label: label.to_string(),
            command: command.to_string(),
            available: true,
            version: first_non_empty(&output.stdout, &output.stderr).map(str::to_string),
            message: None,
        },
        Ok(output) => AiProviderInfo {
            id: id.to_string(),
            label: label.to_string(),
            command: command.to_string(),
            available: false,
            version: None,
            message: first_non_empty(&output.stderr, &output.stdout).map(str::to_string),
        },
        Err(error) => AiProviderInfo {
            id: id.to_string(),
            label: label.to_string(),
            command: command.to_string(),
            available: false,
            version: None,
            message: Some(error),
        },
    }
}

impl From<&AiPromptStreamRequest> for AiPromptRequest {
    fn from(request: &AiPromptStreamRequest) -> Self {
        Self {
            provider_id: request.provider_id.clone(),
            prompt: request.prompt.clone(),
            context: request.context.clone(),
            timeout_seconds: None,
        }
    }
}

fn build_prompt_command(request: &AiPromptRequest) -> Result<(String, Vec<String>, Option<String>), String> {
    let prompt = build_prompt_payload(request);

    match request.provider_id.as_str() {
        // plan mode: claude can read/reason but never executes tools or edits files, even headless.
        "claude-cli" => Ok((
            "claude".to_string(),
            vec![
                "-p".to_string(),
                "--permission-mode".to_string(),
                "plan".to_string(),
            ],
            Some(prompt),
        )),
        "codex-cli" => Ok((
            "codex".to_string(),
            vec![
                "exec".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "-".to_string(),
            ],
            Some(prompt),
        )),
        unknown => Err(format!("unsupported AI provider: {unknown}")),
    }
}

fn build_prompt_payload(request: &AiPromptRequest) -> String {
    let user_request = format!(
        "<user_request>\n{}\n</user_request>",
        escape_xml_text(&request.prompt)
    );

    match request.context.as_deref().filter(|context| !context.trim().is_empty()) {
        Some(context) => format!("{context}\n\n{user_request}"),
        None => user_request,
    }
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn run_prompt_stream(app: AppHandle, request: AiPromptStreamRequest) {
    emit_stream_event(&app, &request, "started", None, None);

    let prompt_request = AiPromptRequest::from(&request);
    let result = build_prompt_command(&prompt_request)
        .and_then(|(command, args, stdin_input)| {
            run_command_streaming(
                &app,
                &request,
                &command,
                args,
                None,
                Duration::from_secs(180),
                stdin_input,
            )
        });

    match result {
        Ok(()) => emit_stream_event(&app, &request, "completed", None, None),
        Err(message) if message == "AI run was canceled" => {
            emit_stream_event(&app, &request, "canceled", None, Some(message))
        }
        Err(message) => emit_stream_event(&app, &request, "failed", None, Some(message)),
    }
}

struct CommandOutput {
    status_success: bool,
    stdout: String,
    stderr: String,
}

fn run_command(
    command: &str,
    args: Vec<String>,
    current_dir: Option<PathBuf>,
    timeout: Duration,
    stdin_input: Option<String>,
) -> Result<CommandOutput, String> {
    let mut child = spawn_child(command, &args, current_dir.as_ref(), stdin_input.is_some())
        .map_err(|error| format!("failed to start {command}: {error}"))?;
    let mut stdout_reader = Some(read_pipe_in_thread(child.stdout.take()));
    let mut stderr_reader = Some(read_pipe_in_thread(child.stderr.take()));

    if let Some(stdin_input) = stdin_input {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("failed to open stdin for {command}"))?;

        stdin
            .write_all(stdin_input.as_bytes())
            .map_err(|error| format!("failed to write stdin for {command}: {error}"))?;
    }

    let started_at = Instant::now();

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to wait for {command}: {error}"))?
        {
            let stdout = join_pipe_reader(stdout_reader.take())?;
            let stderr = join_pipe_reader(stderr_reader.take())?;

            return Ok(CommandOutput {
                status_success: status.success(),
                stdout,
                stderr,
            });
        }

        if started_at.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = join_pipe_reader(stdout_reader.take());
            let _ = join_pipe_reader(stderr_reader.take());
            return Err(format!("{command} timed out after {} seconds", timeout.as_secs()));
        }

        std::thread::sleep(Duration::from_millis(80));
    }
}

fn run_command_streaming(
    app: &AppHandle,
    request: &AiPromptStreamRequest,
    command: &str,
    args: Vec<String>,
    current_dir: Option<PathBuf>,
    timeout: Duration,
    stdin_input: Option<String>,
) -> Result<(), String> {
    let mut child = spawn_child(command, &args, current_dir.as_ref(), stdin_input.is_some())
        .map_err(|error| format!("failed to start {command}: {error}"))?;
    let stdout = Arc::new(Mutex::new(String::new()));
    let stderr = Arc::new(Mutex::new(String::new()));
    let stdout_reader = read_pipe_streaming_in_thread(
        child.stdout.take(),
        app.clone(),
        request.clone(),
        stdout.clone(),
        "data",
    );
    let stderr_reader = read_pipe_streaming_in_thread(
        child.stderr.take(),
        app.clone(),
        request.clone(),
        stderr.clone(),
        "stderr",
    );
    let child = Arc::new(Mutex::new(child));
    register_streaming_child(app, &request.run_id, child.clone())?;

    if let Some(stdin_input) = stdin_input {
        let mut stdin = child
            .lock()
            .map_err(|_| format!("failed to lock {command} process"))?
            .stdin
            .take()
            .ok_or_else(|| format!("failed to open stdin for {command}"))?;

        stdin
            .write_all(stdin_input.as_bytes())
            .map_err(|error| format!("failed to write stdin for {command}: {error}"))?;
    }

    let started_at = Instant::now();

    loop {
        let status = child
            .lock()
            .map_err(|_| format!("failed to lock {command} process"))?
            .try_wait()
            .map_err(|error| format!("failed to wait for {command}: {error}"))?;

        if let Some(status) = status {
            let was_active = unregister_streaming_child(app, &request.run_id);
            join_stream_reader(stdout_reader)?;
            join_stream_reader(stderr_reader)?;

            if !was_active {
                return Err("AI run was canceled".to_string());
            }

            if status.success() {
                return Ok(());
            }

            let stderr_output = lock_string(&stderr);
            let stdout_output = lock_string(&stdout);
            let message = first_non_empty(&stderr_output, &stdout_output)
                .unwrap_or("AI CLI exited with a non-zero status")
                .to_string();

            if message.trim().is_empty() {
                return Err("AI run was canceled".to_string());
            }

            return Err(message);
        }

        if started_at.elapsed() > timeout {
            unregister_streaming_child(app, &request.run_id);
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let _ = join_stream_reader(stdout_reader);
            let _ = join_stream_reader(stderr_reader);
            return Err(format!("{command} timed out after {} seconds", timeout.as_secs()));
        }

        std::thread::sleep(Duration::from_millis(60));
    }
}

fn spawn_child(
    command: &str,
    args: &[String],
    current_dir: Option<&PathBuf>,
    pipe_stdin: bool,
) -> Result<Child, Error> {
    let candidates: Vec<String> = if cfg!(windows) {
        vec![command.to_string(), format!("{command}.cmd"), format!("{command}.exe")]
    } else {
        vec![command.to_string()]
    };

    let mut last_error = None;
    for candidate in candidates {
        let mut child_command = Command::new(&candidate);
        child_command
            .args(args)
            .stdin(if pipe_stdin { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(current_dir) = current_dir {
            child_command.current_dir(current_dir);
        }

        #[cfg(windows)]
        child_command.creation_flags(CREATE_NO_WINDOW);

        match child_command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) if error.kind() == ErrorKind::NotFound => last_error = Some(error),
            Err(error) => return Err(error),
        }
    }

    Err(last_error.unwrap_or_else(|| Error::new(ErrorKind::NotFound, command.to_string())))
}

fn register_streaming_child(
    app: &AppHandle,
    run_id: &str,
    child: Arc<Mutex<Child>>,
) -> Result<(), String> {
    let store = app.state::<AiRunStore>();
    store
        .runs
        .lock()
        .map_err(|_| "failed to lock AI run store".to_string())?
        .insert(run_id.to_string(), child);
    Ok(())
}

fn unregister_streaming_child(app: &AppHandle, run_id: &str) -> bool {
    app.state::<AiRunStore>()
        .runs
        .lock()
        .map(|mut runs| runs.remove(run_id).is_some())
        .unwrap_or(false)
}

type PipeReader = JoinHandle<Result<String, String>>;
type StreamReader = JoinHandle<Result<(), String>>;

fn read_pipe_in_thread<T>(pipe: Option<T>) -> PipeReader
where
    T: Read + Send + 'static,
{
    thread::spawn(move || read_pipe(pipe))
}

fn read_pipe<T: Read>(pipe: Option<T>) -> Result<String, String> {
    let Some(mut pipe) = pipe else {
        return Ok(String::new());
    };
    let mut output = String::new();

    pipe.read_to_string(&mut output)
        .map_err(|error| format!("failed to read command output: {error}"))?;

    Ok(output)
}

fn join_pipe_reader(reader: Option<PipeReader>) -> Result<String, String> {
    let Some(reader) = reader else {
        return Ok(String::new());
    };

    reader
        .join()
        .map_err(|_| "failed to join command output reader".to_string())?
}

fn read_pipe_streaming_in_thread<T>(
    pipe: Option<T>,
    app: AppHandle,
    request: AiPromptStreamRequest,
    output: Arc<Mutex<String>>,
    status: &'static str,
) -> StreamReader
where
    T: Read + Send + 'static,
{
    thread::spawn(move || read_pipe_streaming(pipe, app, request, output, status))
}

fn read_pipe_streaming<T: Read>(
    pipe: Option<T>,
    app: AppHandle,
    request: AiPromptStreamRequest,
    output: Arc<Mutex<String>>,
    status: &'static str,
) -> Result<(), String> {
    let Some(mut pipe) = pipe else {
        return Ok(());
    };
    let mut buffer = [0_u8; 4096];

    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(read_count) => {
                let data = String::from_utf8_lossy(&buffer[..read_count]).into_owned();
                output.lock().map_err(|_| "failed to lock AI output".to_string())?.push_str(&data);
                emit_stream_event(&app, &request, status, Some(data), None);
            }
            Err(error) => return Err(format!("failed to read command output: {error}")),
        }
    }
}

fn join_stream_reader(reader: StreamReader) -> Result<(), String> {
    reader
        .join()
        .map_err(|_| "failed to join command output reader".to_string())?
}

fn lock_string(value: &Arc<Mutex<String>>) -> String {
    value.lock().map(|value| value.clone()).unwrap_or_default()
}

fn emit_stream_event(
    app: &AppHandle,
    request: &AiPromptStreamRequest,
    status: &'static str,
    data: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        "shellpilot-ai-prompt",
        AiPromptStreamEvent {
            panel_id: request.panel_id.clone(),
            run_id: request.run_id.clone(),
            status,
            data,
            message,
        },
    );
}

fn first_non_empty<'a>(primary: &'a str, fallback: &'a str) -> Option<&'a str> {
    let primary = primary.trim();
    if !primary.is_empty() {
        return Some(primary);
    }

    let fallback = fallback.trim();
    if fallback.is_empty() {
        None
    } else {
        Some(fallback)
    }
}
