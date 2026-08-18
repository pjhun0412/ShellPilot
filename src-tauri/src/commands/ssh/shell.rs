use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

#[cfg(debug_assertions)]
use std::time::Instant;

use russh::{client, ChannelMsg, Disconnect};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time;

use super::{
    auth::{authenticate_session, SshAuthRequest},
    errors::{classify_auth_error, classify_connect_error, SshFailure},
    ShellPilotSshClient, SshShellTarget,
};

#[derive(Default)]
pub struct SshSessionStore {
    sessions: Mutex<HashMap<String, SshSessionHandle>>,
}

struct SshSessionHandle {
    tx: mpsc::UnboundedSender<SshSessionCommand>,
}

enum SshSessionCommand {
    AcknowledgeOutput {
        stream_id: u64,
        through_sequence: u64,
    },
    Close,
    QueryCwd {
        respond_to: oneshot::Sender<Option<String>>,
    },
    Resize {
        cols: u32,
        rows: u32,
    },
    Write(String),
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshTerminalEvent {
    auth_prompt: bool,
    code: Option<String>,
    data: Option<String>,
    host_key_fingerprint: Option<String>,
    message: Option<String>,
    output_sequence: Option<u64>,
    output_stream_id: Option<u64>,
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

const SSH_CHANNEL_BUFFER_MESSAGES: usize = 8;
const SSH_CHANNEL_MAX_PACKET_BYTES: usize = 32 * 1024;
// This is remote transport credit, not an application output buffer. Keep
// russh's 2 MiB default so a normal network round trip cannot drain the SSH
// window during high-throughput output. Application memory is bounded
// separately by the channel message cap and OUTPUT_CREDIT_BYTES below.
const SSH_CHANNEL_WINDOW_BYTES: u32 = 2 * 1024 * 1024;
const OUTPUT_CREDIT_BATCHES: usize = 8;
const OUTPUT_CREDIT_BYTES: usize = OUTPUT_CREDIT_BATCHES * (SSH_CHANNEL_MAX_PACKET_BYTES + 4);
const OUTPUT_COALESCE_BYTES: usize = SSH_CHANNEL_MAX_PACKET_BYTES;
const OUTPUT_COALESCE_IDLE: Duration = Duration::from_millis(2);
const EXEC_COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
static NEXT_OUTPUT_STREAM_ID: AtomicU64 = AtomicU64::new(1);

#[cfg(debug_assertions)]
const PERF_REPORT_INTERVAL: Duration = Duration::from_secs(2);

#[cfg(debug_assertions)]
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshTerminalPerfEvent {
    ack_count: u64,
    credit_wait_count: u64,
    credit_wait_max_ms: f64,
    credit_wait_total_ms: f64,
    max_receive_gap_ms: f64,
    outstanding_batches: usize,
    outstanding_bytes: usize,
    panel_id: String,
    received_bytes: u64,
    received_packets: u64,
    stream_id: u64,
}

#[cfg(debug_assertions)]
struct SshOutputPerf {
    ack_count: u64,
    credit_wait_count: u64,
    credit_wait_max: Duration,
    credit_wait_started: Option<Instant>,
    credit_wait_total: Duration,
    last_receive_at: Option<Instant>,
    max_receive_gap: Duration,
    received_bytes: u64,
    received_packets: u64,
    report_started_at: Instant,
}

#[cfg(debug_assertions)]
impl SshOutputPerf {
    fn new() -> Self {
        Self {
            ack_count: 0,
            credit_wait_count: 0,
            credit_wait_max: Duration::ZERO,
            credit_wait_started: None,
            credit_wait_total: Duration::ZERO,
            last_receive_at: None,
            max_receive_gap: Duration::ZERO,
            received_bytes: 0,
            received_packets: 0,
            report_started_at: Instant::now(),
        }
    }

    fn record_ack(&mut self, can_receive_after_ack: bool) {
        self.ack_count += 1;
        if can_receive_after_ack {
            self.finish_credit_wait();
        }
    }

    fn record_receive(&mut self, bytes: usize, can_receive_after_packet: bool) {
        let now = Instant::now();
        if let Some(previous) = self.last_receive_at {
            self.max_receive_gap = self
                .max_receive_gap
                .max(now.saturating_duration_since(previous));
        }
        self.last_receive_at = Some(now);
        self.received_bytes += bytes as u64;
        self.received_packets += 1;

        if !can_receive_after_packet && self.credit_wait_started.is_none() {
            self.credit_wait_started = Some(now);
            self.credit_wait_count += 1;
        }
    }

    fn maybe_emit(
        &mut self,
        app: &AppHandle,
        panel_id: &str,
        stream_id: u64,
        output_flow: &SshOutputFlow,
    ) {
        if self.report_started_at.elapsed() < PERF_REPORT_INTERVAL {
            return;
        }

        let active_credit_wait = self
            .credit_wait_started
            .map(|started_at| started_at.elapsed())
            .unwrap_or_default();
        let _ = app.emit(
            "shellpilot-ssh-terminal-perf",
            SshTerminalPerfEvent {
                ack_count: self.ack_count,
                credit_wait_count: self.credit_wait_count,
                credit_wait_max_ms: duration_ms(self.credit_wait_max.max(active_credit_wait)),
                credit_wait_total_ms: duration_ms(self.credit_wait_total + active_credit_wait),
                max_receive_gap_ms: duration_ms(self.max_receive_gap),
                outstanding_batches: output_flow.outstanding.len(),
                outstanding_bytes: output_flow.outstanding_bytes,
                panel_id: panel_id.to_string(),
                received_bytes: self.received_bytes,
                received_packets: self.received_packets,
                stream_id,
            },
        );

        self.ack_count = 0;
        self.credit_wait_count = 0;
        self.credit_wait_max = Duration::ZERO;
        self.credit_wait_total = Duration::ZERO;
        self.max_receive_gap = Duration::ZERO;
        self.received_bytes = 0;
        self.received_packets = 0;
        self.report_started_at = Instant::now();
        if self.credit_wait_started.is_some() {
            self.credit_wait_started = Some(Instant::now());
        }
    }

    fn finish_credit_wait(&mut self) {
        let Some(started_at) = self.credit_wait_started.take() else {
            return;
        };
        let elapsed = started_at.elapsed();
        self.credit_wait_total += elapsed;
        self.credit_wait_max = self.credit_wait_max.max(elapsed);
    }
}

#[cfg(debug_assertions)]
fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

struct SshOutputBatch {
    data: String,
    sequence: u64,
}

struct SshOutputCoalescer {
    flush_deadline: Option<time::Instant>,
    pending: Vec<u8>,
}

impl SshOutputCoalescer {
    fn new() -> Self {
        Self {
            flush_deadline: None,
            pending: Vec::with_capacity(OUTPUT_COALESCE_BYTES),
        }
    }

    fn flush_deadline(&self) -> Option<time::Instant> {
        self.flush_deadline
    }

    fn pending_bytes(&self) -> usize {
        self.pending.len()
    }

    fn push(&mut self, data: &[u8]) -> Option<Vec<u8>> {
        self.pending.extend_from_slice(data);
        if self.pending.len() >= OUTPUT_COALESCE_BYTES {
            let remainder = self.pending.split_off(OUTPUT_COALESCE_BYTES);
            let batch = std::mem::replace(&mut self.pending, remainder);
            self.flush_deadline =
                (!self.pending.is_empty()).then(|| time::Instant::now() + OUTPUT_COALESCE_IDLE);
            return Some(batch);
        }

        self.flush_deadline = Some(time::Instant::now() + OUTPUT_COALESCE_IDLE);
        None
    }

    fn take_pending(&mut self) -> Vec<u8> {
        self.flush_deadline = None;
        std::mem::replace(&mut self.pending, Vec::with_capacity(OUTPUT_COALESCE_BYTES))
    }
}

struct SshOutputFlow {
    decoder_tail: Vec<u8>,
    next_sequence: u64,
    outstanding: VecDeque<(u64, usize)>,
    outstanding_bytes: usize,
    stream_id: u64,
}

impl SshOutputFlow {
    fn new(stream_id: u64) -> Self {
        Self {
            decoder_tail: Vec::with_capacity(4),
            next_sequence: 1,
            outstanding: VecDeque::with_capacity(OUTPUT_CREDIT_BATCHES),
            outstanding_bytes: 0,
            stream_id,
        }
    }

    fn acknowledge(&mut self, stream_id: u64, through_sequence: u64) {
        if stream_id != self.stream_id
            || through_sequence >= self.next_sequence
            || self
                .outstanding
                .front()
                .is_some_and(|(sequence, _)| through_sequence < *sequence)
        {
            return;
        }

        while self
            .outstanding
            .front()
            .is_some_and(|(sequence, _)| *sequence <= through_sequence)
        {
            if let Some((_, raw_bytes)) = self.outstanding.pop_front() {
                self.outstanding_bytes = self.outstanding_bytes.saturating_sub(raw_bytes);
            }
        }
    }

    fn can_receive_packet(&self, pending_bytes: usize) -> bool {
        self.outstanding.len() < OUTPUT_CREDIT_BATCHES
            && self.outstanding_bytes + pending_bytes + SSH_CHANNEL_MAX_PACKET_BYTES + 4
                <= OUTPUT_CREDIT_BYTES
    }

    fn finish_with(&mut self, data: &[u8]) -> Option<SshOutputBatch> {
        self.decode_and_track(data, true)
    }

    fn is_drained(&self) -> bool {
        self.outstanding.is_empty()
    }

    fn push(&mut self, data: &[u8]) -> Option<SshOutputBatch> {
        self.decode_and_track(data, false)
    }

    fn decode_and_track(&mut self, data: &[u8], final_chunk: bool) -> Option<SshOutputBatch> {
        self.decoder_tail.extend_from_slice(data);
        let consumed = utf8_consumed_prefix(&self.decoder_tail, final_chunk);

        if consumed == 0 {
            return None;
        }

        let raw = self.decoder_tail.drain(..consumed).collect::<Vec<_>>();
        let text = String::from_utf8_lossy(&raw).into_owned();

        if text.is_empty() {
            return None;
        }

        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        self.outstanding_bytes += raw.len();
        self.outstanding.push_back((sequence, raw.len()));

        Some(SshOutputBatch {
            data: text,
            sequence,
        })
    }
}

fn utf8_consumed_prefix(data: &[u8], final_chunk: bool) -> usize {
    if final_chunk {
        return data.len();
    }

    let mut offset = 0;
    while offset < data.len() {
        match std::str::from_utf8(&data[offset..]) {
            Ok(_) => return data.len(),
            Err(error) => {
                let valid_end = offset + error.valid_up_to();
                match error.error_len() {
                    Some(invalid_bytes) => offset = valid_end + invalid_bytes,
                    None => return valid_end,
                }
            }
        }
    }

    data.len()
}

// Directory tracking: identify the interactive shell's own PID via a
// throwaway exec channel (never the interactive one the user is looking at,
// so nothing ever appears on screen), then resolve its current directory on
// demand the same way whenever the frontend asks (e.g. "open SFTP here").
// This avoids ever installing a persistent per-prompt hook: no OSC7, no
// shell-specific scripts, no risk of clobbering the user's own prompt
// customization, and no visible injected command at all.
//
// PID identification is a heuristic, not a guarantee: a separate channel
// always spawns an unrelated process, so we can't ask the interactive shell
// to self-report without typing into it. Instead we list pty-attached
// processes and take the highest PID (Linux allocates PIDs monotonically),
// which is almost always the shell we just started. In the rare case another
// session for the same user starts on the same host in the same instant,
// this can pick the wrong PID — worst case is SFTP opening at the wrong
// initial path, never a security or data-loss issue.

/// Runs a command on a one-shot exec channel and returns its trimmed stdout,
/// or `None` on any failure (channel open/exec failure, empty output, or a
/// remote command that never finishes — bounded by `EXEC_COMMAND_TIMEOUT` so
/// a wedged remote command can never stall the interactive session's own
/// command loop, which awaits this inline). Used for anything we need from
/// the remote host that must never touch the interactive channel the user is
/// looking at.
async fn run_exec_command(
    session: &mut client::Handle<ShellPilotSshClient>,
    command: &str,
) -> Option<String> {
    let output = time::timeout(EXEC_COMMAND_TIMEOUT, async {
        let mut channel = session.channel_open_session().await.ok()?;
        channel.exec(false, command).await.ok()?;

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    output.extend_from_slice(&data);
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }

        Some(output)
    })
    .await
    .ok()
    .flatten()?;

    let text = String::from_utf8_lossy(&output).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Identifies the interactive shell's PID. When we know the local TCP port
/// our own connection used, this is deterministic: it scans pty-attached
/// processes' `/proc/<pid>/environ` for the `SSH_CONNECTION` entry whose
/// client-port field matches ours — sshd always sets this for pty sessions,
/// so it uniquely identifies our own shell even with multiple SSH tabs open
/// to the same host/account. Falls back to "highest PID with a pts tty" if
/// the port is unknown or nothing matched (still correct in the common case
/// of a single session, just no longer guaranteed under concurrent ones).
async fn detect_shell_pid(
    session: &mut client::Handle<ShellPilotSshClient>,
    local_port: Option<u16>,
) -> Option<String> {
    let fallback = "ps -eo pid,tty,comm | awk '$2 ~ /^pts/ {print $1}' | sort -n | tail -n1";
    let command = match local_port {
        Some(port) => format!(
            "match=\"\"; \
for pid in $(ps -eo pid,tty | awk '$2 ~ /^pts/ {{print $1}}'); do \
  line=$({{ tr '\\0' '\\n' < /proc/$pid/environ; }} 2>/dev/null | grep '^SSH_CONNECTION='); \
  if [ -n \"$line\" ]; then set -- $line; if [ \"$2\" = \"{port}\" ]; then match=$pid; break; fi; fi; \
done; \
if [ -n \"$match\" ]; then echo $match; else {fallback}; fi"
        ),
        None => fallback.to_string(),
    };

    let pid = run_exec_command(session, &command).await?;

    (!pid.is_empty() && pid.chars().all(|ch| ch.is_ascii_digit())).then_some(pid)
}

/// Resolves a PID's current working directory via a one-shot exec channel,
/// using Linux's procfs. Silently resolves to `None` on any failure (no
/// /proc, permissions, unsupported remote) — this is always a best-effort
/// convenience, never a hard requirement for opening SFTP.
async fn query_shell_cwd(
    session: &mut client::Handle<ShellPilotSshClient>,
    pid: &str,
) -> Option<String> {
    run_exec_command(session, &format!("readlink /proc/{pid}/cwd 2>/dev/null")).await
}

pub(crate) async fn open_shell(
    app: AppHandle,
    store: State<'_, SshSessionStore>,
    target: SshShellTarget,
) -> Result<(), String> {
    close_shell(store.clone(), target.panel_id.clone()).await?;

    let auth = SshAuthRequest::from_target(&target);
    let (tx, rx) = mpsc::unbounded_channel();
    let panel_id = target.panel_id.clone();
    let output_stream_id = NEXT_OUTPUT_STREAM_ID.fetch_add(1, Ordering::Relaxed);

    store
        .sessions
        .lock()
        .await
        .insert(panel_id, SshSessionHandle { tx });

    tauri::async_runtime::spawn(run_shell_session(app, target, auth, output_stream_id, rx));
    Ok(())
}

pub(crate) async fn acknowledge_shell_output(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    stream_id: u64,
    through_sequence: u64,
) -> Result<(), String> {
    let sessions = store.sessions.lock().await;
    if let Some(handle) = sessions.get(&panel_id) {
        let _ = handle.tx.send(SshSessionCommand::AcknowledgeOutput {
            stream_id,
            through_sequence,
        });
    }

    // ACKs are advisory and may race with a normal close. Treat a missing or
    // already-closed session as acknowledged so parser callbacks cannot create
    // an endless retry loop after disconnect.
    Ok(())
}

pub(crate) async fn write_shell(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    data: String,
) -> Result<(), String> {
    send_session_command(&store, &panel_id, SshSessionCommand::Write(data)).await
}

pub(crate) async fn resize_shell(
    store: State<'_, SshSessionStore>,
    panel_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    send_session_command(&store, &panel_id, SshSessionCommand::Resize { cols, rows }).await
}

pub(crate) async fn query_cwd(
    store: State<'_, SshSessionStore>,
    panel_id: String,
) -> Result<Option<String>, String> {
    let (respond_to, response) = oneshot::channel();

    send_session_command(
        &store,
        &panel_id,
        SshSessionCommand::QueryCwd { respond_to },
    )
    .await?;

    Ok(response.await.unwrap_or(None))
}

pub(crate) async fn close_shell(
    store: State<'_, SshSessionStore>,
    panel_id: String,
) -> Result<(), String> {
    let handle = store.sessions.lock().await.remove(&panel_id);

    if let Some(handle) = handle {
        let _ = handle.tx.send(SshSessionCommand::Close);
    }

    Ok(())
}

async fn run_shell_session(
    app: AppHandle,
    target: SshShellTarget,
    auth: SshAuthRequest,
    output_stream_id: u64,
    mut rx: mpsc::UnboundedReceiver<SshSessionCommand>,
) {
    let panel_id = target.panel_id.clone();
    let result = async {
        emit_terminal_event(
            &app,
            &panel_id,
            output_stream_id,
            SshTerminalStatus::Info,
            None,
            Some("resolving credential".to_string()),
        );
        let config = Arc::new(client::Config {
            channel_buffer_size: SSH_CHANNEL_BUFFER_MESSAGES,
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(30)),
            keepalive_max: 3,
            maximum_packet_size: SSH_CHANNEL_MAX_PACKET_BYTES as u32,
            window_size: SSH_CHANNEL_WINDOW_BYTES,
            ..Default::default()
        });
        emit_terminal_event(
            &app,
            &panel_id,
            output_stream_id,
            SshTerminalStatus::Info,
            None,
            Some("opening tcp/ssh transport".to_string()),
        );
        // Connect the TCP socket ourselves (rather than via `client::connect`)
        // so we can capture our own local port before handing the stream to
        // russh — sshd stamps this exact port into the remote shell's
        // `SSH_CONNECTION` environment variable, which lets us later identify
        // that specific shell process deterministically (see
        // `detect_shell_pid`).
        let tcp_stream = tokio::net::TcpStream::connect((target.host.as_str(), target.port))
            .await
            .map_err(|error| classify_connect_error(error.to_string()))?;
        let local_port = tcp_stream.local_addr().ok().map(|addr| addr.port());
        if config.nodelay {
            let _ = tcp_stream.set_nodelay(true);
        }
        let mut session = client::connect_stream(
            config,
            tcp_stream,
            ShellPilotSshClient::new(
                app.clone(),
                Some(panel_id.clone()),
                &target.host,
                target.port,
                target.accept_new_host_key.unwrap_or(false),
                target.accepted_host_key_fingerprint.clone(),
            )
            .with_terminal_stream_id(output_stream_id),
        )
        .await
        .map_err(|error| classify_connect_error(error.to_string()))?;
        emit_terminal_event(
            &app,
            &panel_id,
            output_stream_id,
            SshTerminalStatus::Info,
            None,
            Some(format!("authenticating {}", auth.label())),
        );
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
            .map_err(|error| classify_auth_error(error, &auth))?;

        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|error| SshFailure::session(format!("failed to open ssh channel: {error}")))?;

        emit_terminal_event(
            &app,
            &panel_id,
            output_stream_id,
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
            output_stream_id,
            SshTerminalStatus::Info,
            None,
            Some("requesting shell".to_string()),
        );
        channel
            .request_shell(false)
            .await
            .map_err(|error| SshFailure::session(format!("failed to request shell: {error}")))?;

        emit_terminal_connected(&app, &panel_id, output_stream_id);

        // Best-effort: identify the shell's own PID once, via a separate
        // exec channel, so cwd lookups can be resolved later without ever
        // touching the interactive channel. Never fatal if this fails.
        let shell_pid = detect_shell_pid(&mut session, local_port).await;

        let mut output_coalescer = SshOutputCoalescer::new();
        let mut output_flow = SshOutputFlow::new(output_stream_id);
        let mut remote_result: Option<Result<(), SshFailure>> = None;
        #[cfg(debug_assertions)]
        let mut output_perf = SshOutputPerf::new();

        let session_result = loop {
            if remote_result.is_some() && output_flow.is_drained() {
                break remote_result.take().expect("remote result is present");
            }

            let flush_deadline = output_coalescer.flush_deadline();
            tokio::select! {
                biased;
                command = rx.recv() => {
                    match command {
                        Some(SshSessionCommand::Close) | None => {
                            let _ = channel.eof().await;
                            let _ = session.disconnect(Disconnect::ByApplication, "closed", "en").await;
                            break Ok(());
                        }
                        Some(SshSessionCommand::AcknowledgeOutput {
                            stream_id,
                            through_sequence,
                        }) => {
                            output_flow.acknowledge(stream_id, through_sequence);
                            #[cfg(debug_assertions)]
                            {
                                output_perf.record_ack(
                                    output_flow.can_receive_packet(
                                        output_coalescer.pending_bytes(),
                                    ),
                                );
                                output_perf.maybe_emit(
                                    &app,
                                    &panel_id,
                                    output_stream_id,
                                    &output_flow,
                                );
                            }
                        }
                        Some(SshSessionCommand::QueryCwd { respond_to }) => {
                            let cwd = if remote_result.is_some() {
                                None
                            } else {
                                match &shell_pid {
                                    Some(pid) => query_shell_cwd(&mut session, pid).await,
                                    None => None,
                                }
                            };
                            let _ = respond_to.send(cwd);
                        }
                        Some(SshSessionCommand::Resize { cols, rows }) => {
                            if remote_result.is_none() {
                                channel
                                    .window_change(cols, rows, 0, 0)
                                    .await
                                    .map_err(|error| SshFailure::session(format!("failed to resize pty: {error}")))?;
                            }
                        }
                        Some(SshSessionCommand::Write(data)) => {
                            if remote_result.is_none() {
                                channel
                                    .data_bytes(data.into_bytes())
                                    .await
                                    .map_err(|error| SshFailure::session(format!("failed to write ssh data: {error}")))?;
                            }
                        }
                    }
                }
                _ = time::sleep_until(
                    flush_deadline.unwrap_or_else(time::Instant::now)
                ), if flush_deadline.is_some() => {
                    let pending = output_coalescer.take_pending();
                    if let Some(batch) = output_flow.push(&pending) {
                        emit_terminal_data(&app, &panel_id, output_stream_id, batch);
                    }
                }
                message = channel.wait(),
                    if remote_result.is_none()
                        && output_flow.can_receive_packet(output_coalescer.pending_bytes()) => {
                    match message {
                        Some(ChannelMsg::Data { data }) => {
                            #[cfg(debug_assertions)]
                            let received_bytes = data.len();
                            if let Some(coalesced) = output_coalescer.push(&data) {
                                if let Some(batch) = output_flow.push(&coalesced) {
                                    emit_terminal_data(&app, &panel_id, output_stream_id, batch);
                                }
                            }
                            #[cfg(debug_assertions)]
                            {
                                output_perf.record_receive(
                                    received_bytes,
                                    output_flow.can_receive_packet(
                                        output_coalescer.pending_bytes(),
                                    ),
                                );
                                output_perf.maybe_emit(
                                    &app,
                                    &panel_id,
                                    output_stream_id,
                                    &output_flow,
                                );
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            #[cfg(debug_assertions)]
                            let received_bytes = data.len();
                            if let Some(coalesced) = output_coalescer.push(&data) {
                                if let Some(batch) = output_flow.push(&coalesced) {
                                    emit_terminal_data(&app, &panel_id, output_stream_id, batch);
                                }
                            }
                            #[cfg(debug_assertions)]
                            {
                                output_perf.record_receive(
                                    received_bytes,
                                    output_flow.can_receive_packet(
                                        output_coalescer.pending_bytes(),
                                    ),
                                );
                                output_perf.maybe_emit(
                                    &app,
                                    &panel_id,
                                    output_stream_id,
                                    &output_flow,
                                );
                            }
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            let pending = output_coalescer.take_pending();
                            if let Some(batch) = output_flow.finish_with(&pending) {
                                emit_terminal_data(&app, &panel_id, output_stream_id, batch);
                            }
                            emit_terminal_event(
                                &app,
                                &panel_id,
                                output_stream_id,
                                SshTerminalStatus::Info,
                                None,
                                Some(format!("remote shell exited with status {exit_status}")),
                            );
                            remote_result = Some(Ok(()));
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            let pending = output_coalescer.take_pending();
                            if let Some(batch) = output_flow.finish_with(&pending) {
                                emit_terminal_data(&app, &panel_id, output_stream_id, batch);
                            }
                            remote_result = Some(Err(SshFailure::connection(
                                "SSH connection was lost unexpectedly. Reconnect to open a new shell session.",
                            )));
                        }
                        _ => {}
                    }
                }
            }
        };

        session_result?;
        Ok::<(), SshFailure>(())
    }
    .await;

    match result {
        Ok(()) => emit_terminal_event(
            &app,
            &panel_id,
            output_stream_id,
            SshTerminalStatus::Closed,
            None,
            None,
        ),
        Err(error) => emit_terminal_failure(&app, &panel_id, output_stream_id, error),
    }
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
    output_stream_id: u64,
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
            host_key_fingerprint: None,
            message,
            output_sequence: None,
            output_stream_id: Some(output_stream_id),
            panel_id: panel_id.to_string(),
            retryable: false,
            status,
        },
    );
}

fn emit_terminal_connected(app: &AppHandle, panel_id: &str, output_stream_id: u64) {
    let _ = app.emit(
        "shellpilot-ssh-terminal",
        SshTerminalEvent {
            auth_prompt: false,
            code: None,
            data: None,
            host_key_fingerprint: None,
            message: None,
            output_sequence: None,
            output_stream_id: Some(output_stream_id),
            panel_id: panel_id.to_string(),
            retryable: false,
            status: SshTerminalStatus::Connected,
        },
    );
}

fn emit_terminal_data(
    app: &AppHandle,
    panel_id: &str,
    output_stream_id: u64,
    batch: SshOutputBatch,
) {
    let _ = app.emit(
        "shellpilot-ssh-terminal",
        SshTerminalEvent {
            auth_prompt: false,
            code: None,
            data: Some(batch.data),
            host_key_fingerprint: None,
            message: None,
            output_sequence: Some(batch.sequence),
            output_stream_id: Some(output_stream_id),
            panel_id: panel_id.to_string(),
            retryable: false,
            status: SshTerminalStatus::Data,
        },
    );
}

fn emit_terminal_failure(
    app: &AppHandle,
    panel_id: &str,
    output_stream_id: u64,
    error: SshFailure,
) {
    let _ = app.emit(
        "shellpilot-ssh-terminal",
        SshTerminalEvent {
            auth_prompt: error.auth_prompt,
            code: Some(error.code.to_string()),
            data: None,
            host_key_fingerprint: None,
            message: Some(error.message),
            output_sequence: None,
            output_stream_id: Some(output_stream_id),
            panel_id: panel_id.to_string(),
            retryable: error.retryable,
            status: SshTerminalStatus::Failed,
        },
    );
}

pub(crate) fn emit_terminal_warning(
    app: &AppHandle,
    panel_id: Option<&str>,
    output_stream_id: Option<u64>,
    code: &'static str,
    message: String,
) {
    emit_terminal_warning_with_host_key(app, panel_id, output_stream_id, code, message, None);
}

pub(crate) fn emit_terminal_warning_with_host_key(
    app: &AppHandle,
    panel_id: Option<&str>,
    output_stream_id: Option<u64>,
    code: &'static str,
    message: String,
    host_key_fingerprint: Option<String>,
) {
    if let Some(panel_id) = panel_id {
        let _ = app.emit(
            "shellpilot-ssh-terminal",
            SshTerminalEvent {
                auth_prompt: false,
                code: Some(code.to_string()),
                data: None,
                host_key_fingerprint,
                message: Some(message),
                output_sequence: None,
                output_stream_id,
                panel_id: panel_id.to_string(),
                retryable: false,
                status: SshTerminalStatus::Warning,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_flow_applies_batch_credit_and_cumulative_acknowledgements() {
        let mut flow = SshOutputFlow::new(41);

        for index in 0..OUTPUT_CREDIT_BATCHES {
            let batch = flow
                .push(format!("line-{index}\n").as_bytes())
                .expect("text batch");
            assert_eq!(batch.sequence, index as u64 + 1);
        }

        assert!(!flow.can_receive_packet(0));
        flow.acknowledge(999, 8);
        assert!(
            !flow.can_receive_packet(0),
            "stale stream ack must be ignored"
        );
        flow.acknowledge(41, 4);
        assert!(flow.can_receive_packet(0));
        assert_eq!(flow.outstanding.len(), 4);
        flow.acknowledge(41, 99);
        assert_eq!(
            flow.outstanding.len(),
            4,
            "ack beyond the last emitted sequence must be ignored"
        );
        flow.acknowledge(41, 8);
        assert!(flow.is_drained());
    }

    #[test]
    fn output_flow_preserves_split_utf8_sequences() {
        let bytes = "한글 출력".as_bytes();
        let mut flow = SshOutputFlow::new(7);
        let mut output = String::new();

        for byte in bytes {
            if let Some(batch) = flow.push(&[*byte]) {
                output.push_str(&batch.data);
                flow.acknowledge(7, batch.sequence);
            }
        }

        if let Some(batch) = flow.finish_with(&[]) {
            output.push_str(&batch.data);
            flow.acknowledge(7, batch.sequence);
        }

        assert_eq!(output, "한글 출력");
        assert!(flow.is_drained());
    }

    #[test]
    fn output_flow_replaces_only_truly_invalid_or_incomplete_final_bytes() {
        let mut invalid = SshOutputFlow::new(1);
        let invalid_batch = invalid.push(&[0xff]).expect("invalid byte is surfaced");
        assert_eq!(invalid_batch.data, "\u{fffd}");

        let mut incomplete = SshOutputFlow::new(2);
        assert!(incomplete.push(&[0xe3, 0x81]).is_none());
        let final_batch = incomplete
            .finish_with(&[])
            .expect("incomplete final bytes are surfaced");
        assert_eq!(final_batch.data, "\u{fffd}");
    }

    #[test]
    fn output_flow_preserves_split_utf8_after_an_invalid_byte() {
        let mut flow = SshOutputFlow::new(3);
        let invalid_batch = flow
            .push(&[0xff, 0xe3, 0x81])
            .expect("invalid prefix is surfaced");
        assert_eq!(invalid_batch.data, "\u{fffd}");
        flow.acknowledge(3, invalid_batch.sequence);

        let completed_batch = flow
            .push(&[0x82])
            .expect("trailing split character is completed");
        assert_eq!(completed_batch.data, "\u{3042}");
        flow.acknowledge(3, completed_batch.sequence);
        assert!(flow.is_drained());
    }

    #[test]
    fn output_flow_memory_counters_remain_bounded_for_long_streams() {
        let mut flow = SshOutputFlow::new(55);
        let packet = vec![b'x'; SSH_CHANNEL_MAX_PACKET_BYTES];

        for _ in 0..10_000 {
            assert!(flow.can_receive_packet(0));
            let batch = flow.push(&packet).expect("packet batch");
            assert!(flow.outstanding.len() <= OUTPUT_CREDIT_BATCHES);
            assert!(flow.outstanding_bytes <= OUTPUT_CREDIT_BYTES);
            flow.acknowledge(55, batch.sequence);
        }

        assert!(flow.is_drained());
        assert_eq!(flow.outstanding_bytes, 0);
    }

    #[test]
    fn output_coalescer_groups_small_packets_into_fixed_size_batches() {
        let mut coalescer = SshOutputCoalescer::new();
        let half = vec![b'x'; OUTPUT_COALESCE_BYTES / 2];

        assert!(coalescer.push(&half).is_none());
        assert_eq!(coalescer.pending_bytes(), half.len());
        assert!(coalescer.flush_deadline().is_some());

        let batch = coalescer
            .push(&half)
            .expect("two half packets form one output batch");
        assert_eq!(batch.len(), OUTPUT_COALESCE_BYTES);
        assert_eq!(coalescer.pending_bytes(), 0);
        assert!(coalescer.flush_deadline().is_none());
    }

    #[test]
    fn output_credit_includes_unflushed_coalescer_bytes() {
        let mut flow = SshOutputFlow::new(77);
        let packet = vec![b'x'; OUTPUT_COALESCE_BYTES];

        for _ in 0..(OUTPUT_CREDIT_BATCHES - 1) {
            flow.push(&packet).expect("full output batch");
        }

        let remaining_pending_budget =
            OUTPUT_CREDIT_BYTES - flow.outstanding_bytes - SSH_CHANNEL_MAX_PACKET_BYTES - 4;
        assert!(flow.can_receive_packet(remaining_pending_budget));
        assert!(
            !flow.can_receive_packet(remaining_pending_budget + 1),
            "pending coalescer bytes must count against the fixed byte budget"
        );
    }
}
