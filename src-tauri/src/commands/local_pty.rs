use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::Mutex,
};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct LocalPtySessionStore {
    sessions: Mutex<HashMap<String, LocalPtySessionHandle>>,
}

struct LocalPtySessionHandle {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPtyTarget {
    pub panel_id: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPtyEvent {
    panel_id: String,
    status: &'static str,
    data: Option<String>,
    message: Option<String>,
}

#[tauri::command]
pub async fn local_pty_open(
    app: AppHandle,
    store: State<'_, LocalPtySessionStore>,
    target: LocalPtyTarget,
) -> Result<(), String> {
    close_session(&store, &target.panel_id);

    // claude/codex REPL은 프로세스가 살아있는 동안 계속 읽어야 하는 blocking I/O라
    // tokio blocking 스레드풀에서 별도로 돌린다 (async 커맨드 자체는 바로 반환됨).
    tauri::async_runtime::spawn_blocking(move || run_pty_session(app, target));

    Ok(())
}

#[tauri::command]
pub async fn local_pty_write(
    store: State<'_, LocalPtySessionStore>,
    panel_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = store.sessions.lock().unwrap();
    let handle = sessions
        .get_mut(&panel_id)
        .ok_or_else(|| "local pty session not found".to_string())?;

    handle
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("failed to write to pty: {error}"))
}

#[tauri::command]
pub async fn local_pty_resize(
    store: State<'_, LocalPtySessionStore>,
    panel_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = store.sessions.lock().unwrap();
    let handle = sessions
        .get(&panel_id)
        .ok_or_else(|| "local pty session not found".to_string())?;

    handle
        .master
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize pty: {error}"))
}

#[tauri::command]
pub async fn local_pty_close(
    store: State<'_, LocalPtySessionStore>,
    panel_id: String,
) -> Result<(), String> {
    close_session(&store, &panel_id);
    Ok(())
}

fn close_session(store: &LocalPtySessionStore, panel_id: &str) {
    if let Some(mut handle) = store.sessions.lock().unwrap().remove(panel_id) {
        let _ = handle.child.kill();
        let _ = handle.child.wait();
    }
}

fn run_pty_session(app: AppHandle, target: LocalPtyTarget) {
    let panel_id = target.panel_id.clone();
    let outcome = open_and_stream(&app, &target);

    app.state::<LocalPtySessionStore>()
        .sessions
        .lock()
        .unwrap()
        .remove(&panel_id);

    // 실패한 경우 "failed"가 화면에 뜨자마자 "closed"로 덮어써버리지 않도록 둘 중 하나만 보낸다.
    match outcome {
        Ok(()) => emit_event(&app, &panel_id, "closed", None, None),
        Err(message) => emit_event(&app, &panel_id, "failed", None, Some(message)),
    }
}

// npm 등은 확장자 없는 유닉스용 셔뱅 스크립트와 .cmd/.exe를 같은 폴더에 함께 설치한다.
// portable-pty가 확장자 없는 파일을 실제 실행 파일로 착각해 열면 "올바른 Win32 응용
// 프로그램이 아닙니다"(os error 193)가 나므로, PATH에서 .cmd/.exe/.bat를 직접 찾아 넘긴다.
fn resolve_executable(command: &str) -> String {
    if !cfg!(windows) {
        return command.to_string();
    }

    if command.contains('\\') || command.contains('/') || Path::new(command).extension().is_some() {
        return command.to_string();
    }

    let Some(path_var) = std::env::var_os("PATH") else {
        return command.to_string();
    };

    for dir in std::env::split_paths(&path_var) {
        for ext in ["cmd", "exe", "bat"] {
            let candidate = dir.join(format!("{command}.{ext}"));
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    command.to_string()
}

fn open_and_stream(app: &AppHandle, target: &LocalPtyTarget) -> Result<(), String> {
    let panel_id = &target.panel_id;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            cols: target.cols.unwrap_or(80),
            rows: target.rows.unwrap_or(24),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open pty: {error}"))?;

    let resolved_command = resolve_executable(&target.command);
    let mut cmd = CommandBuilder::new(&resolved_command);
    if let Some(args) = &target.args {
        cmd.args(args);
    }
    if let Some(cwd) = &target.cwd {
        cmd.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| format!("failed to start {}: {error}", target.command))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to read pty output: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to open pty input: {error}"))?;

    app.state::<LocalPtySessionStore>().sessions.lock().unwrap().insert(
        panel_id.clone(),
        LocalPtySessionHandle {
            child,
            master: pair.master,
            writer,
        },
    );

    emit_event(app, panel_id, "connected", None, None);

    let mut buffer = [0u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read_count) => {
                let data = String::from_utf8_lossy(&buffer[..read_count]).into_owned();
                emit_event(app, panel_id, "data", Some(data), None);
            }
            Err(_) => break,
        }
    }

    Ok(())
}

fn emit_event(
    app: &AppHandle,
    panel_id: &str,
    status: &'static str,
    data: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        "shellpilot-local-pty",
        LocalPtyEvent {
            panel_id: panel_id.to_string(),
            status,
            data,
            message,
        },
    );
}
