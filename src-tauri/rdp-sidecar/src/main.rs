use core::time::Duration;
use std::env;
use std::error::Error;
use std::io::{self, Write as _};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use ironrdp::cliprdr::backend::ClipboardMessage;
use ironrdp::cliprdr::pdu::{ClipboardFormat, ClipboardFormatId, FileDescriptor};
use ironrdp::cliprdr::CliprdrClient;
use ironrdp::connector::connection_activation::{ConnectionActivationSequence, ConnectionActivationState};
use ironrdp::connector::{self, ConnectionResult, Credentials};
use ironrdp::connector::Sequence as _;
use ironrdp::core::WriteBuf;
use ironrdp::displaycontrol::client::DisplayControlClient;
use ironrdp::displaycontrol::pdu::MonitorLayoutEntry;
use ironrdp::dvc::DrdynvcClient;
use ironrdp::pdu::gcc::KeyboardType;
use ironrdp::pdu::geometry::InclusiveRectangle;
use ironrdp::pdu::rdp::headers::ShareDataPdu;
use ironrdp::pdu::rdp::refresh_rectangle::RefreshRectanglePdu;
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::rdp::client_info::{CompressionType, PerformanceFlags, TimezoneInfo};
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sspi::network_client::reqwest_network_client::ReqwestNetworkClient;
use tokio_rustls::rustls;

mod clipboard;
mod input;

use clipboard::{
    create_local_clipboard_files, process_clipboard_file_copy, process_clipboard_message,
    LocalClipboardFile, ShellPilotClipboardBackend, ShellPilotClipboardProxy,
};
use input::{spawn_input_reader, to_fastpath_events, InputMessage};

type AppResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
type UpgradedFramed =
    ironrdp_blocking::Framed<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>;

#[derive(Clone, Copy)]
struct ActiveSessionParams {
    enable_server_pointer: bool,
}

#[derive(Debug)]
struct ProbeArgs {
    domain: Option<String>,
    height: u16,
    host: String,
    password: Option<String>,
    password_stdin: bool,
    port: u16,
    username: String,
    width: u16,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SidecarMessage {
    Connected {
        desktop_width: u16,
        desktop_height: u16,
        certificate_fingerprint: Option<String>,
    },
    Frame {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        data: String,
    },
    ClipboardText {
        text: String,
    },
    ClipboardFiles {
        paths: Vec<String>,
    },
    ClipboardError {
        message: String,
    },
    DisplayResized {
        desktop_width: u16,
        desktop_height: u16,
    },
    DisplayResizeError {
        message: String,
    },
}

/// `src-tauri/src/commands/rdp.rs` — keep the two in sync.
fn main() {
    // stdout is the JSON frame/message protocol `rdp.rs` parses line-by-line,
    // so tracing output must go to stderr only, never stdout.
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    if let Err(error) = run() {
        eprintln!("{error}");

        // The top-level message is often just a generic wrapper (e.g. plain
        // "decode error"); the real detail lives in the source chain, which
        // Display doesn't walk on its own.
        let mut source = error.source();
        while let Some(cause) = source {
            eprintln!("caused by: {cause}");
            source = cause.source();
        }

        std::process::exit(1);
    }
}

fn run() -> AppResult<()> {
    let mut args = parse_args()?;
    resolve_password(&mut args)?;
    let connector_config = build_config(&args)?;
    let local_clipboard_files = Arc::new(Mutex::new(Vec::new()));
    let local_clipboard_text = Arc::new(Mutex::new(None));
    let clipboard_ready = Arc::new(AtomicBool::new(false));
    let (clipboard_tx, clipboard_rx) = std::sync::mpsc::channel();
    let (sidecar_tx, sidecar_rx) = std::sync::mpsc::channel();
    let clipboard_proxy = ShellPilotClipboardProxy(clipboard_tx.clone());
    let clipboard_backend = ShellPilotClipboardBackend::new(
        Arc::clone(&local_clipboard_files),
        Arc::clone(&local_clipboard_text),
        sidecar_tx,
        clipboard_proxy,
        Arc::clone(&clipboard_ready),
    );
    let (connection_result, mut framed, certificate_fingerprint) =
        connect(connector_config, args.host, args.port, clipboard_backend)?;

    let desktop_width = connection_result.desktop_size.width;
    let desktop_height = connection_result.desktop_size.height;

    emit_message(&SidecarMessage::Connected {
        desktop_width,
        desktop_height,
        certificate_fingerprint,
    })?;

    let mut image = DecodedImage::new(
        ironrdp_graphics::image_processing::PixelFormat::RgbA32,
        desktop_width,
        desktop_height,
    );

    // The handshake (CredSSP, capability exchange) needs the generous initial
    // budget the socket already has from `connect()`. Only shorten it once we
    // reach the active stage, where the loop itself polls for input on timeout
    // instead of treating it as an error.
    framed
        .get_inner_mut()
        .0
        .sock
        .set_read_timeout(Some(Duration::from_millis(30)))?;

    let input_rx = spawn_input_reader();

    run_active_stage(
        connection_result,
        framed,
        &mut image,
        &input_rx,
        &clipboard_rx,
        &sidecar_rx,
        &clipboard_ready,
        &local_clipboard_files,
        &local_clipboard_text,
    )
}

fn parse_args() -> AppResult<ProbeArgs> {
    let mut host = None;
    let mut port = 3389;
    let mut username = None;
    let password = None;
    let mut password_stdin = false;
    let mut width = 1920;
    let mut height = 1080;
    let mut domain = None;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = |args: &mut std::iter::Skip<env::Args>, name: &str| -> AppResult<String> {
            args.next()
                .ok_or_else(|| format!("missing value for {name}").into())
        };

        match arg.as_str() {
            "--host" => host = Some(value(&mut args, "--host")?),
            "--port" => port = value(&mut args, "--port")?.parse()?,
            "--username" | "-u" => username = Some(value(&mut args, "--username")?),
            "--password-stdin" => password_stdin = true,
            "--width" => width = value(&mut args, "--width")?.parse()?,
            "--height" => height = value(&mut args, "--height")?.parse()?,
            "--domain" | "-d" => domain = Some(value(&mut args, "--domain")?),
            "--help" | "-h" => return Err(usage().into()),
            other => return Err(format!("unexpected argument: {other}\n{}", usage()).into()),
        }
    }

    Ok(ProbeArgs {
        domain,
        height,
        host: host.ok_or_else(|| "--host is required".to_string())?,
        password,
        password_stdin,
        port,
        username: username.ok_or_else(|| "--username is required".to_string())?,
        width,
    })
}

fn usage() -> &'static str {
    "usage: shellpilot-rdp-probe --host HOST --port 3389 --username USER --password-stdin [--domain DOMAIN] [--width 1920] [--height 1080]"
}

fn resolve_password(args: &mut ProbeArgs) -> AppResult<()> {
    if args.password_stdin {
        let mut password = String::new();
        io::stdin().read_line(&mut password)?;

        while password.ends_with('\n') || password.ends_with('\r') {
            password.pop();
        }

        if password.is_empty() {
            return Err("RDP password read from stdin was empty".into());
        }

        args.password = Some(password);
    }

    if args.password.is_none() {
        return Err("RDP password is required".into());
    }

    Ok(())
}

fn build_config(args: &ProbeArgs) -> AppResult<connector::Config> {
    Ok(connector::Config {
        credentials: Credentials::UsernamePassword {
            username: args.username.clone(),
            password: args
                .password
                .as_ref()
                .ok_or("RDP password is required")?
                .clone(),
        },
        domain: args.domain.clone(),
        enable_tls: false,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize {
            width: args.width,
            height: args.height,
        },
        bitmap: None,
        client_build: 0,
        client_name: "ShellPilot".to_string(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_string(),

        #[cfg(windows)]
        platform: MajorPlatformType::WINDOWS,
        #[cfg(target_os = "macos")]
        platform: MajorPlatformType::MACINTOSH,
        #[cfg(target_os = "linux")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "android")]
        platform: MajorPlatformType::ANDROID,

        enable_server_pointer: false,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        compression_type: Some(CompressionType::Rdp61),
        pointer_software_rendering: true,
        multitransport_flags: None,
        performance_flags: PerformanceFlags::default(),
        desktop_scale_factor: 100,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
        alternate_shell: String::new(),
        work_dir: String::new(),
    })
}

fn connect(
    config: connector::Config,
    server_name: String,
    port: u16,
    clipboard_backend: ShellPilotClipboardBackend,
) -> AppResult<(ConnectionResult, UpgradedFramed, Option<String>)> {
    let server_addr = lookup_addr(&server_name, port)?;
    let tcp_stream = TcpStream::connect(server_addr)?;
    tcp_stream.set_read_timeout(Some(Duration::from_secs(12)))?;

    let client_addr = tcp_stream.local_addr()?;
    let mut framed = ironrdp_blocking::Framed::new(tcp_stream);
    let display_control = DisplayControlClient::new(|_| Ok(Vec::new()));
    let dynamic_channels = DrdynvcClient::new().with_dynamic_channel(display_control);
    let mut connector = connector::ClientConnector::new(config, client_addr)
        .with_static_channel(dynamic_channels)
        .with_static_channel(CliprdrClient::new(Box::new(clipboard_backend)));
    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut connector)?;
    let initial_stream = framed.into_inner_no_leftover();
    let (upgraded_stream, server_public_key, certificate_fingerprint) =
        tls_upgrade(initial_stream, server_name.clone())?;
    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);
    let mut upgraded_framed = ironrdp_blocking::Framed::new(upgraded_stream);
    let mut network_client = ReqwestNetworkClient;
    let connection_result = ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut network_client,
        server_name.into(),
        server_public_key,
        None,
    )?;

    Ok((connection_result, upgraded_framed, certificate_fingerprint))
}

fn run_active_stage(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    image: &mut DecodedImage,
    input_rx: &Receiver<InputMessage>,
    clipboard_rx: &Receiver<ClipboardMessage>,
    sidecar_rx: &Receiver<SidecarMessage>,
    clipboard_ready: &Arc<AtomicBool>,
    local_clipboard_files: &Arc<Mutex<Vec<LocalClipboardFile>>>,
    local_clipboard_text: &Arc<Mutex<Option<String>>>,
) -> AppResult<()> {
    let active_params = ActiveSessionParams {
        enable_server_pointer: connection_result.enable_server_pointer,
    };
    let mut active_stage = ActiveStage::new(connection_result);
    let mut frame_sequence = 0_u64;
    let mut pending_local_files: Option<Vec<FileDescriptor>> = None;
    let mut pending_local_text = false;
    let mut pending_activation: Option<ConnectionActivationSequence> = None;

    loop {
        if clipboard_ready.load(Ordering::SeqCst) {
            if let Some(descriptors) = pending_local_files.take() {
                match process_clipboard_file_copy(&mut active_stage, descriptors) {
                    Ok(outputs) => {
                        handle_outputs(
                            &mut framed,
                            image,
                            outputs,
                            &mut frame_sequence,
                            &mut pending_activation,
                        )?
                    }
                    Err(error) => emit_message(&SidecarMessage::ClipboardError {
                        message: format!("RDP clipboard file copy failed: {error}"),
                    })?,
                }
            }

            if pending_local_text {
                pending_local_text = false;
                let result = process_clipboard_message(
                    &mut active_stage,
                    ClipboardMessage::SendInitiateCopy(vec![ClipboardFormat::new(
                        ClipboardFormatId::CF_UNICODETEXT,
                    )]),
                );

                match result {
                    Ok(outputs) => {
                        handle_outputs(
                            &mut framed,
                            image,
                            outputs,
                            &mut frame_sequence,
                            &mut pending_activation,
                        )?
                    }
                    Err(error) => emit_message(&SidecarMessage::ClipboardError {
                        message: format!("RDP clipboard text copy failed: {error}"),
                    })?,
                }
            }
        }

        while let Ok(message) = input_rx.try_recv() {
            if let InputMessage::ClipboardFiles { paths } = &message {
                let files = match create_local_clipboard_files(paths) {
                    Ok(files) => files,
                    Err(error) => {
                        emit_message(&SidecarMessage::ClipboardError {
                            message: format!("RDP clipboard file copy failed: {error}"),
                        })?;
                        continue;
                    }
                };
                let descriptors = files
                    .iter()
                    .map(|file| file.descriptor.clone())
                    .collect::<Vec<_>>();

                if descriptors.is_empty() {
                    continue;
                }

                if let Ok(mut value) = local_clipboard_files.lock() {
                    *value = files;
                }

                if clipboard_ready.load(Ordering::SeqCst) {
                    match process_clipboard_file_copy(&mut active_stage, descriptors) {
                        Ok(outputs) => {
                            handle_outputs(
                                &mut framed,
                                image,
                                outputs,
                                &mut frame_sequence,
                                &mut pending_activation,
                            )?
                        }
                        Err(error) => emit_message(&SidecarMessage::ClipboardError {
                            message: format!("RDP clipboard file copy failed: {error}"),
                        })?,
                    }
                } else {
                    pending_local_files = Some(descriptors);
                }
                continue;
            }

            if let InputMessage::ClipboardText { text } = &message {
                if let Ok(mut value) = local_clipboard_text.lock() {
                    *value = Some(text.clone());
                }

                if clipboard_ready.load(Ordering::SeqCst) {
                    let result = process_clipboard_message(
                        &mut active_stage,
                        ClipboardMessage::SendInitiateCopy(vec![ClipboardFormat::new(
                            ClipboardFormatId::CF_UNICODETEXT,
                        )]),
                    );

                    match result {
                        Ok(outputs) => {
                            handle_outputs(
                                &mut framed,
                                image,
                                outputs,
                                &mut frame_sequence,
                                &mut pending_activation,
                            )?
                        }
                        Err(error) => emit_message(&SidecarMessage::ClipboardError {
                            message: format!("RDP clipboard text copy failed: {error}"),
                        })?,
                    }
                } else {
                    pending_local_text = true;
                }
                continue;
            }

            if let InputMessage::Resize { width, height } = message {
                match encode_display_resize(&mut active_stage, width, height) {
                    Ok(Some(frame)) => {
                        framed.write_all(&frame)?;
                        let (desktop_width, desktop_height) = normalize_display_size(width, height)?;
                        *image = DecodedImage::new(
                            ironrdp_graphics::image_processing::PixelFormat::RgbA32,
                            desktop_width,
                            desktop_height,
                        );
                        // MS-RDPEDISP has no resize acknowledgement, so nothing
                        // else would ever tell the server to repaint the new
                        // canvas — without this the screen just stays blank.
                        request_full_refresh(&mut framed, &mut active_stage, desktop_width, desktop_height)?;
                        emit_message(&SidecarMessage::DisplayResized {
                            desktop_width,
                            desktop_height,
                        })?;
                    }
                    Ok(None) => emit_message(&SidecarMessage::DisplayResizeError {
                        message: "RDP server did not open the Display Control channel yet.".to_string(),
                    })?,
                    Err(error) => emit_message(&SidecarMessage::DisplayResizeError {
                        message: format!("RDP display resize failed: {error}"),
                    })?,
                }

                continue;
            }

            let events = to_fastpath_events(message);

            for chunk in events.chunks(64) {
                if chunk.is_empty() {
                    continue;
                }

                let outputs = active_stage.process_fastpath_input(image, chunk)?;
                handle_outputs(
                    &mut framed,
                    image,
                    outputs,
                    &mut frame_sequence,
                    &mut pending_activation,
                )?;
            }
        }

        while let Ok(message) = clipboard_rx.try_recv() {
            match process_clipboard_message(&mut active_stage, message) {
                Ok(outputs) => handle_outputs(
                    &mut framed,
                    image,
                    outputs,
                    &mut frame_sequence,
                    &mut pending_activation,
                )?,
                Err(error) => emit_message(&SidecarMessage::ClipboardError {
                    message: format!("RDP clipboard channel failed: {error}"),
                })?,
            }
        }

        while let Ok(message) = sidecar_rx.try_recv() {
            emit_message(&message)?;
        }

        // While a reactivation is in progress, the sequence must be fed PDUs
        // read according to its own `next_pdu_hint`, same as the library's own
        // `single_sequence_step` driver does for the initial connection. Reusing
        // the generic active-stage `read_pdu()` here reads/frames bytes
        // differently and desyncs the activation state machine, which showed up
        // as a "invalid pdu_type" decode error a few PDUs into reactivation.
        if let Some(activation) = pending_activation.as_mut() {
            // `next_pdu_hint() == None` means the sequence has a message to
            // send proactively without waiting for the server (`step_no_input`)
            // — skipping this case (as an earlier version of this loop did)
            // starves that send and desyncs the rest of the handshake.
            let step_result = if let Some(hint) = activation.next_pdu_hint() {
                let pdu = match framed.read_by_hint(hint) {
                    Ok(pdu) => pdu,
                    Err(error)
                        if error.kind() == io::ErrorKind::WouldBlock
                            || error.kind() == io::ErrorKind::TimedOut =>
                    {
                        continue;
                    }
                    Err(error) => return Err(Box::new(error)),
                };

                process_reactivation_frame(
                    &mut framed,
                    &mut active_stage,
                    image,
                    activation,
                    &active_params,
                    Some(&pdu),
                )?
            } else {
                process_reactivation_frame(
                    &mut framed,
                    &mut active_stage,
                    image,
                    activation,
                    &active_params,
                    None,
                )?
            };

            if let Some((desktop_width, desktop_height)) = step_result {
                emit_message(&SidecarMessage::DisplayResized {
                    desktop_width,
                    desktop_height,
                })?;
                pending_activation = None;
            }

            continue;
        }

        let (action, payload) = match framed.read_pdu() {
            Ok(pair) => pair,
            Err(error)
                if error.kind() == io::ErrorKind::WouldBlock
                    || error.kind() == io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(error) => return Err(Box::new(error)),
        };

        let outputs = active_stage.process(image, action, &payload)?;
        handle_outputs(
            &mut framed,
            image,
            outputs,
            &mut frame_sequence,
            &mut pending_activation,
        )?;
    }
}

fn process_reactivation_frame(
    framed: &mut UpgradedFramed,
    active_stage: &mut ActiveStage,
    image: &mut DecodedImage,
    activation: &mut ConnectionActivationSequence,
    active_params: &ActiveSessionParams,
    payload: Option<&[u8]>,
) -> AppResult<Option<(u16, u16)>> {
    let mut output = WriteBuf::new();
    let written = match payload {
        Some(payload) => activation.step(payload, &mut output)?,
        None => activation.step_no_input(&mut output)?,
    };

    if !written.is_nothing() {
        framed.write_all(&output.into_inner())?;
    }

    if let ConnectionActivationState::Finalized {
        desktop_size,
        share_id,
        ..
    } = activation.connection_activation_state()
    {
        active_stage.set_share_id(share_id);
        active_stage.set_enable_server_pointer(active_params.enable_server_pointer);
        // Deliberately NOT rebuilding the fast-path processor here: it owns the
        // bulk (XCRUSH/MPPC) decompressor's history, bitmap cache, and pointer
        // cache, none of which the server resets across Deactivate-Reactivate.
        // Recreating it wipes that history and desyncs decompression on the
        // very next graphics update ("match output offset out of order").
        // `ironrdp-session` only exposes a `share_id` setter on the x224 side
        // for this exact reason — the fast-path side is meant to survive as-is.
        *image = DecodedImage::new(
            ironrdp_graphics::image_processing::PixelFormat::RgbA32,
            desktop_size.width,
            desktop_size.height,
        );
        request_full_refresh(framed, active_stage, desktop_size.width, desktop_size.height)?;

        return Ok(Some((desktop_size.width, desktop_size.height)));
    }

    Ok(None)
}

fn request_full_refresh(
    framed: &mut UpgradedFramed,
    active_stage: &mut ActiveStage,
    width: u16,
    height: u16,
) -> AppResult<()> {
    let right = width.saturating_sub(1);
    let bottom = height.saturating_sub(1);
    let mut output = WriteBuf::new();

    active_stage.encode_static(
        &mut output,
        ShareDataPdu::RefreshRectangle(RefreshRectanglePdu {
            areas_to_refresh: vec![InclusiveRectangle {
                left: 0,
                top: 0,
                right,
                bottom,
            }],
        }),
    )?;

    framed.write_all(&output.into_inner())?;
    Ok(())
}

fn encode_display_resize(
    active_stage: &mut ActiveStage,
    width: u16,
    height: u16,
) -> AppResult<Option<Vec<u8>>> {
    let (desktop_width, desktop_height) = normalize_display_size(width, height)?;

    active_stage
        .encode_resize(u32::from(desktop_width), u32::from(desktop_height), Some(100), None)
        .transpose()
        .map_err(|error| error.into())
}

fn normalize_display_size(width: u16, height: u16) -> AppResult<(u16, u16)> {
    let (width, height) = MonitorLayoutEntry::adjust_display_size(u32::from(width), u32::from(height));

    Ok((width.try_into()?, height.try_into()?))
}

fn handle_outputs(
    framed: &mut UpgradedFramed,
    image: &DecodedImage,
    outputs: Vec<ActiveStageOutput>,
    frame_sequence: &mut u64,
    pending_activation: &mut Option<ConnectionActivationSequence>,
) -> AppResult<()> {
    for output in outputs {
        match output {
            ActiveStageOutput::ResponseFrame(frame) => framed.write_all(&frame)?,
            ActiveStageOutput::GraphicsUpdate(rect) => {
                *frame_sequence = frame_sequence.saturating_add(1);
                emit_frame(image, &rect, *frame_sequence)?;
            }
            ActiveStageOutput::Terminate(reason) => {
                return Err(format!("RDP session terminated: {reason:?}").into());
            }
            ActiveStageOutput::DeactivateAll(sequence) => {
                *pending_activation = Some(*sequence);
            }
            _ => {}
        }
    }

    Ok(())
}

fn emit_frame(image: &DecodedImage, rect: &InclusiveRectangle, sequence: u64) -> AppResult<()> {
    // A resize swaps `image` for a differently-sized buffer without any
    // protocol handshake (MS-RDPEDISP has no ack), so a `GraphicsUpdate` the
    // server queued for the *previous* resolution can still land here after
    // the swap. Skip anything that no longer fits instead of indexing out of
    // bounds and taking down the whole sidecar process.
    if rect.right >= image.width() || rect.bottom >= image.height() {
        return Ok(());
    }

    let width = usize::from(rect.right - rect.left + 1);
    let height = usize::from(rect.bottom - rect.top + 1);
    let bytes_per_pixel = image.bytes_per_pixel();
    let stride = image.stride();
    let row_bytes = width * bytes_per_pixel;
    let col_offset = usize::from(rect.left) * bytes_per_pixel;
    let full_data = image.data();

    // `DecodedImage::data_for_rect` slices across the full-width stride, so for
    // any rect narrower than the whole screen the returned bytes interleave
    // pixels from outside the rect between rows. Canvas `ImageData` needs a
    // tightly packed width*height*bpp buffer, so repack row by row here.
    let mut packed = Vec::with_capacity(row_bytes * height);

    for row in 0..height {
        let row_start = (usize::from(rect.top) + row) * stride + col_offset;
        packed.extend_from_slice(&full_data[row_start..row_start + row_bytes]);
    }

    let data = base64::engine::general_purpose::STANDARD.encode(packed);

    emit_message(&SidecarMessage::Frame {
        sequence,
        x: rect.left,
        y: rect.top,
        width: width as u16,
        height: height as u16,
        data,
    })
}

fn emit_message(message: &SidecarMessage) -> AppResult<()> {
    let line = serde_json::to_string(message)?;
    let mut stdout = io::stdout();
    writeln!(stdout, "{line}")?;
    stdout.flush()?;
    Ok(())
}

fn lookup_addr(hostname: &str, port: u16) -> AppResult<core::net::SocketAddr> {
    use std::net::ToSocketAddrs as _;

    (hostname, port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| "socket address not found".into())
}

fn tls_upgrade(
    stream: TcpStream,
    server_name: String,
) -> AppResult<(
    rustls::StreamOwned<rustls::ClientConnection, TcpStream>,
    Vec<u8>,
    Option<String>,
)> {
    let mut config = rustls::client::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(danger::NoCertificateVerification))
        .with_no_client_auth();

    config.key_log = std::sync::Arc::new(rustls::KeyLogFile::new());
    config.resumption = rustls::client::Resumption::disabled();

    let client =
        rustls::ClientConnection::new(std::sync::Arc::new(config), server_name.try_into()?)?;
    let mut tls_stream = rustls::StreamOwned::new(client, stream);
    tls_stream.flush()?;

    let cert = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .ok_or_else(|| "peer certificate is missing".to_string())?;
    let server_public_key = extract_tls_server_public_key(cert)?;
    let certificate_fingerprint = Some(format_sha256_fingerprint(cert));

    Ok((tls_stream, server_public_key, certificate_fingerprint))
}

fn extract_tls_server_public_key(cert: &[u8]) -> AppResult<Vec<u8>> {
    use x509_cert::der::Decode as _;

    let cert = x509_cert::Certificate::from_der(cert)?;
    let server_public_key = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .ok_or_else(|| "subject public key BIT STRING is not aligned".to_string())?
        .to_owned();

    Ok(server_public_key)
}

fn format_sha256_fingerprint(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);

    digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

mod danger {
    use tokio_rustls::rustls::client::danger::{
        HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
    };
    use tokio_rustls::rustls::{pki_types, DigitallySignedStruct, Error, SignatureScheme};

    #[derive(Debug)]
    pub(super) struct NoCertificateVerification;

    impl ServerCertVerifier for NoCertificateVerification {
        fn verify_server_cert(
            &self,
            _: &pki_types::CertificateDer<'_>,
            _: &[pki_types::CertificateDer<'_>],
            _: &pki_types::ServerName<'_>,
            _: &[u8],
            _: pki_types::UnixTime,
        ) -> Result<ServerCertVerified, Error> {
            Ok(ServerCertVerified::assertion())
        }

        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            vec![
                SignatureScheme::RSA_PKCS1_SHA1,
                SignatureScheme::ECDSA_SHA1_Legacy,
                SignatureScheme::RSA_PKCS1_SHA256,
                SignatureScheme::ECDSA_NISTP256_SHA256,
                SignatureScheme::RSA_PKCS1_SHA384,
                SignatureScheme::ECDSA_NISTP384_SHA384,
                SignatureScheme::RSA_PKCS1_SHA512,
                SignatureScheme::ECDSA_NISTP521_SHA512,
                SignatureScheme::RSA_PSS_SHA256,
                SignatureScheme::RSA_PSS_SHA384,
                SignatureScheme::RSA_PSS_SHA512,
                SignatureScheme::ED25519,
                SignatureScheme::ED448,
            ]
        }
    }
}
