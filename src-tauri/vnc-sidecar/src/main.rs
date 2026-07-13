use std::io::Write as _;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use aes::cipher::{generic_array::GenericArray, BlockEncrypt, KeyInit};
use aes::Aes128;
use base64::{engine::general_purpose, Engine as _};
use num_bigint::BigUint;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tokio::io::{
    AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader, ReadBuf,
};
use tokio::net::TcpStream;
use tokio::time;
use vnc::{
    ClientKeyEvent, ClientMouseEvent, PixelFormat, Rect, VncConnector, VncEncoding, VncEvent,
    X11Event,
};

const SECURITY_TYPE_NONE: u8 = 1;
const SECURITY_TYPE_VNC_AUTH: u8 = 2;
const SECURITY_TYPE_APPLE_ARD: u8 = 30;
const FRAME_POLL_INTERVAL_MS: u64 = 8;
const MAX_EVENTS_PER_POLL_TICK: usize = 128;
const MAX_FRAME_BATCH_SIZE: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    host: String,
    password: String,
    port: u16,
    username: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum InputMessage {
    Pointer { x: u16, y: u16, buttons: u8 },
    Key { keysym: u32, down: bool },
    Refresh { full: Option<bool> },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum OutputMessage {
    Connected {
        desktop_width: u16,
        desktop_height: u16,
    },
    FrameBatch {
        frames: Vec<FrameUpdate>,
    },
    Resized {
        desktop_width: u16,
        desktop_height: u16,
    },
    Error {
        message: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum FrameUpdate {
    Raw {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        data: String,
    },
    Copy {
        sequence: u64,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        source_x: u16,
        source_y: u16,
    },
}

struct Framebuffer {
    height: u16,
    pixels: Vec<u8>,
    sequence: u64,
    width: u16,
}

struct HandshakePrefixedStream {
    client_version_write_buffer: Vec<u8>,
    prefix: Vec<u8>,
    prefix_offset: usize,
    suppress_client_version_write: bool,
    stream: TcpStream,
    version_written: bool,
}

impl HandshakePrefixedStream {
    fn new(stream: TcpStream, prefix: Vec<u8>, suppress_client_version_write: bool) -> Self {
        Self {
            client_version_write_buffer: Vec::new(),
            prefix,
            prefix_offset: 0,
            suppress_client_version_write,
            stream,
            version_written: false,
        }
    }
}

impl AsyncRead for HandshakePrefixedStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.prefix_offset < self.prefix.len() {
            let remaining_prefix = self.prefix.len() - self.prefix_offset;
            let copy_len = remaining_prefix.min(buffer.remaining());
            let start = self.prefix_offset;
            let end = start + copy_len;

            buffer.put_slice(&self.prefix[start..end]);
            self.prefix_offset = end;
            return Poll::Ready(Ok(()));
        }

        Pin::new(&mut self.stream).poll_read(context, buffer)
    }
}

impl AsyncWrite for HandshakePrefixedStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        if self.suppress_client_version_write
            && !self.version_written
            && buffer.starts_with(b"RFB ")
            && buffer.len() >= 12
        {
            self.client_version_write_buffer
                .extend_from_slice(&buffer[..12]);
            self.version_written = true;
            return Poll::Ready(Ok(12));
        }

        let result = Pin::new(&mut self.stream).poll_write(context, buffer);

        if let Poll::Ready(Ok(written)) = result {
            if !self.version_written && written > 0 {
                self.client_version_write_buffer
                    .extend_from_slice(&buffer[..written]);

                if self.client_version_write_buffer.len() >= 12
                    && self.client_version_write_buffer.starts_with(b"RFB ")
                {
                    self.version_written = true;
                }
            }
        }

        result
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(context)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(context)
    }
}

impl Framebuffer {
    fn new(width: u16, height: u16) -> Self {
        Self {
            height,
            pixels: vec![0; width as usize * height as usize * 4],
            sequence: 0,
            width,
        }
    }

    fn resize(&mut self, width: u16, height: u16) {
        self.width = width;
        self.height = height;
        self.pixels = vec![0; width as usize * height as usize * 4];
    }

    fn put_rect(&mut self, rect: Rect, data: &[u8]) -> Option<FrameUpdate> {
        if !self.rect_in_bounds(rect) {
            return None;
        }

        let expected_len = rect.width as usize * rect.height as usize * 4;

        if data.len() < expected_len {
            return None;
        }

        let target_start = (rect.y as usize * self.width as usize + rect.x as usize) * 4;
        let row_len = rect.width as usize * 4;

        if rect.x == 0 && rect.width == self.width {
            let target_end = target_start.saturating_add(expected_len);

            if target_end > self.pixels.len() {
                return None;
            }

            self.pixels[target_start..target_end].copy_from_slice(&data[..expected_len]);
        } else {
            for row in 0..rect.height as usize {
                let source_start = row * row_len;
                let target_start =
                    ((rect.y as usize + row) * self.width as usize + rect.x as usize) * 4;
                let target_end = target_start.saturating_add(row_len);

                if target_end > self.pixels.len() {
                    return None;
                }

                self.pixels[target_start..target_end]
                    .copy_from_slice(&data[source_start..source_start + row_len]);
            }
        }

        self.sequence += 1;
        Some(FrameUpdate::Raw {
            sequence: self.sequence,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            data: general_purpose::STANDARD.encode(&data[..expected_len]),
        })
    }

    fn copy_rect(&mut self, dst: Rect, src: Rect) -> Option<FrameUpdate> {
        if dst.width != src.width
            || dst.height != src.height
            || !self.rect_in_bounds(dst)
            || !self.rect_in_bounds(src)
        {
            return None;
        }

        let row_len = dst.width as usize * 4;
        let max_source_end =
            ((src.y as usize + src.height as usize - 1) * self.width as usize + src.x as usize) * 4
                + row_len;
        let max_target_end =
            ((dst.y as usize + dst.height as usize - 1) * self.width as usize + dst.x as usize) * 4
                + row_len;

        if max_source_end > self.pixels.len() || max_target_end > self.pixels.len() {
            return None;
        }

        if dst.y > src.y {
            for row in (0..dst.height as usize).rev() {
                self.copy_framebuffer_row(src, dst, row, row_len);
            }
        } else {
            for row in 0..dst.height as usize {
                self.copy_framebuffer_row(src, dst, row, row_len);
            }
        }

        self.sequence += 1;
        Some(FrameUpdate::Copy {
            sequence: self.sequence,
            x: dst.x,
            y: dst.y,
            width: dst.width,
            height: dst.height,
            source_x: src.x,
            source_y: src.y,
        })
    }

    fn copy_framebuffer_row(&mut self, src: Rect, dst: Rect, row: usize, row_len: usize) {
        let source_start = ((src.y as usize + row) * self.width as usize + src.x as usize) * 4;
        let source_end = source_start + row_len;
        let target_start = ((dst.y as usize + row) * self.width as usize + dst.x as usize) * 4;

        self.pixels
            .copy_within(source_start..source_end, target_start);
    }

    fn rect_in_bounds(&self, rect: Rect) -> bool {
        rect.width > 0
            && rect.height > 0
            && rect.x <= self.width
            && rect.y <= self.height
            && rect.width <= self.width.saturating_sub(rect.x)
            && rect.height <= self.height.saturating_sub(rect.y)
    }
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        emit(OutputMessage::Error {
            message: error.to_string(),
        });
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut stdin = BufReader::new(tokio::io::stdin()).lines();
    let target_line = stdin
        .next_line()
        .await?
        .ok_or("missing VNC target on stdin")?;
    let target: Target = serde_json::from_str(&target_line)?;
    let address = format!("{}:{}", target.host, target.port);
    let mut tcp = TcpStream::connect(address).await?;
    tcp.set_nodelay(true)?;
    let normalized_banner = read_normalized_rfb_banner(&mut tcp).await?;
    let stream = prepare_rfb_stream(tcp, normalized_banner, &target).await?;
    let password = target.password;
    let client = VncConnector::new(stream)
        .set_auth_method(async move { Ok(password) })
        .add_encoding(VncEncoding::Zrle)
        .add_encoding(VncEncoding::CopyRect)
        .add_encoding(VncEncoding::DesktopSizePseudo)
        .add_encoding(VncEncoding::Raw)
        .allow_shared(true)
        .set_pixel_format(PixelFormat::rgba())
        .build()?
        .try_start()
        .await?
        .finish()?;
    let mut framebuffer = Framebuffer::new(1, 1);
    let mut poll_interval = time::interval(Duration::from_millis(FRAME_POLL_INTERVAL_MS));
    poll_interval.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            line = stdin.next_line() => {
                let Some(line) = line? else {
                    break;
                };

                if line.trim().is_empty() {
                    continue;
                }

                let input: InputMessage = serde_json::from_str(&line)?;
                match input {
                    InputMessage::Pointer { x, y, buttons } => {
                        client.input(X11Event::PointerEvent(ClientMouseEvent {
                            position_x: x,
                            position_y: y,
                            bottons: buttons,
                        })).await?;
                    }
                    InputMessage::Key { keysym, down } => {
                        client.input(X11Event::KeyEvent(ClientKeyEvent {
                            keycode: keysym,
                            down,
                        })).await?;
                    }
                    InputMessage::Refresh { full } => {
                        client.input(if full.unwrap_or(false) {
                            X11Event::FullRefresh
                        } else {
                            X11Event::Refresh
                        }).await?;
                    }
                }
            }
            _ = poll_interval.tick() => {
                let mut frame_batch = Vec::new();
                let mut polled_events = 0;

                while polled_events < MAX_EVENTS_PER_POLL_TICK {
                    let Some(event) = client.poll_event().await? else {
                        break;
                    };

                    polled_events += 1;

                    match event {
                        VncEvent::SetResolution(screen) => {
                            emit_frame_batch(&mut frame_batch);
                            framebuffer.resize(screen.width, screen.height);
                            emit(OutputMessage::Connected {
                                desktop_width: screen.width,
                                desktop_height: screen.height,
                            });
                            emit(OutputMessage::Resized {
                                desktop_width: screen.width,
                                desktop_height: screen.height,
                            });
                        }
                        VncEvent::RawImage(rect, data) => {
                            if let Some(frame) = framebuffer.put_rect(rect, &data) {
                                frame_batch.push(frame);
                                emit_frame_batch_if_full(&mut frame_batch);
                            }
                        }
                        VncEvent::Copy(dst, src) => {
                            if let Some(frame) = framebuffer.copy_rect(dst, src) {
                                frame_batch.push(frame);
                                emit_frame_batch_if_full(&mut frame_batch);
                            }
                        }
                        VncEvent::Error(message) => {
                            emit_frame_batch(&mut frame_batch);
                            return Err(message.into());
                        }
                        VncEvent::Bell
                        | VncEvent::JpegImage(_, _)
                        | VncEvent::SetCursor(_, _)
                        | VncEvent::SetPixelFormat(_)
                        | VncEvent::Text(_) => {}
                        _ => {}
                    }
                }

                emit_frame_batch(&mut frame_batch);
            }
        }
    }

    client.close().await?;
    Ok(())
}

async fn prepare_rfb_stream(
    mut stream: TcpStream,
    normalized_banner: [u8; 12],
    target: &Target,
) -> Result<HandshakePrefixedStream, Box<dyn std::error::Error + Send + Sync>> {
    stream.write_all(&normalized_banner).await?;
    stream.flush().await?;

    if normalized_banner == *b"RFB 003.003\n" {
        let mut security_type = [0_u8; 4];
        stream.read_exact(&mut security_type).await?;

        let mut prefix = normalized_banner.to_vec();
        prefix.extend_from_slice(&security_type);
        return Ok(HandshakePrefixedStream::new(stream, prefix, true));
    }

    let security_types = read_modern_security_types(&mut stream).await?;

    let has_vnc_auth = security_types.contains(&SECURITY_TYPE_VNC_AUTH);
    let has_apple_ard = security_types.contains(&SECURITY_TYPE_APPLE_ARD);
    let has_username = target
        .username
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());

    if has_apple_ard && has_username {
        perform_apple_ard_authentication(&mut stream, target).await?;

        let mut prefix = b"RFB 003.003\n".to_vec();
        prefix.extend_from_slice(&(SECURITY_TYPE_NONE as u32).to_be_bytes());
        return Ok(HandshakePrefixedStream::new(stream, prefix, true));
    }

    if has_vnc_auth {
        let unsupported = security_types
            .iter()
            .copied()
            .filter(|security_type| *security_type != SECURITY_TYPE_VNC_AUTH)
            .collect::<Vec<_>>();

        if !unsupported.is_empty() {
            eprintln!("filtered unsupported VNC security types: {:?}", unsupported);
        }

        let mut prefix = normalized_banner.to_vec();
        prefix.extend_from_slice(&[1, SECURITY_TYPE_VNC_AUTH]);
        return Ok(HandshakePrefixedStream::new(stream, prefix, true));
    }

    if has_apple_ard {
        perform_apple_ard_authentication(&mut stream, target).await?;

        let mut prefix = b"RFB 003.003\n".to_vec();
        prefix.extend_from_slice(&(SECURITY_TYPE_NONE as u32).to_be_bytes());
        return Ok(HandshakePrefixedStream::new(stream, prefix, true));
    }

    Err(format!(
        "No supported VNC security type was offered. Server offered {:?}; ShellPilot currently supports VNC password auth and macOS Apple auth.",
        security_types
    )
    .into())
}

async fn read_modern_security_types(
    stream: &mut TcpStream,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let count = stream.read_u8().await? as usize;

    if count == 0 {
        let reason_length = stream.read_u32().await? as usize;
        let mut reason = vec![0; reason_length];
        stream.read_exact(&mut reason).await?;
        return Err(String::from_utf8_lossy(&reason).into_owned().into());
    }

    let mut security_types = vec![0; count];
    stream.read_exact(&mut security_types).await?;
    Ok(security_types)
}

async fn perform_apple_ard_authentication(
    stream: &mut TcpStream,
    target: &Target,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let username = target
        .username
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("macOS Screen Sharing requires a username for Apple authentication")?;

    stream.write_all(&[SECURITY_TYPE_APPLE_ARD]).await?;
    stream.flush().await?;

    let mut generator_bytes = [0_u8; 2];
    let mut key_length_bytes = [0_u8; 2];
    stream.read_exact(&mut generator_bytes).await?;
    stream.read_exact(&mut key_length_bytes).await?;

    let key_length = u16::from_be_bytes(key_length_bytes) as usize;

    if key_length == 0 || key_length > 4096 {
        return Err(format!("Invalid Apple VNC key length: {key_length}").into());
    }

    let mut prime_bytes = vec![0; key_length];
    let mut server_public_bytes = vec![0; key_length];
    stream.read_exact(&mut prime_bytes).await?;
    stream.read_exact(&mut server_public_bytes).await?;

    let generator = BigUint::from_bytes_be(&generator_bytes);
    let prime = BigUint::from_bytes_be(&prime_bytes);
    let server_public = BigUint::from_bytes_be(&server_public_bytes);
    let mut private_bytes = vec![0; key_length];
    rand::thread_rng().fill_bytes(&mut private_bytes);
    let mut private = BigUint::from_bytes_be(&private_bytes);

    if private == BigUint::from(0_u8) {
        private = BigUint::from(1_u8);
    }

    if private >= prime {
        private %= &prime;

        if private == BigUint::from(0_u8) {
            private = BigUint::from(1_u8);
        }
    }

    let public = generator.modpow(&private, &prime);
    let shared = server_public.modpow(&private, &prime);
    let public_bytes = biguint_to_padded_bytes(&public, key_length);
    let shared_bytes = biguint_to_padded_bytes(&shared, key_length);
    let aes_key = md5::compute(&shared_bytes);
    let mut userpass = [0_u8; 128];

    rand::thread_rng().fill_bytes(&mut userpass);
    copy_credential_field(&mut userpass[..64], username);
    copy_credential_field(&mut userpass[64..], &target.password);
    encrypt_aes128_ecb_in_place(&aes_key.0, &mut userpass);

    stream.write_all(&userpass).await?;
    stream.write_all(&public_bytes).await?;
    stream.flush().await?;

    read_security_result(stream).await
}

async fn read_security_result(
    stream: &mut TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let result = stream.read_u32().await?;

    if result == 0 {
        return Ok(());
    }

    let reason = match stream.read_u32().await {
        Ok(length) if length > 0 && length < 4096 => {
            let mut bytes = vec![0; length as usize];
            stream.read_exact(&mut bytes).await?;
            String::from_utf8_lossy(&bytes).into_owned()
        }
        _ => "Apple VNC authentication failed".to_string(),
    };

    Err(reason.into())
}

fn biguint_to_padded_bytes(value: &BigUint, length: usize) -> Vec<u8> {
    let bytes = value.to_bytes_be();

    if bytes.len() >= length {
        return bytes[bytes.len() - length..].to_vec();
    }

    let mut padded = vec![0; length - bytes.len()];
    padded.extend(bytes);
    padded
}

fn copy_credential_field(target: &mut [u8], value: &str) {
    let bytes = value.as_bytes();
    let copy_len = bytes.len().min(target.len().saturating_sub(1));

    target[..copy_len].copy_from_slice(&bytes[..copy_len]);
    if copy_len < target.len() {
        target[copy_len] = 0;
    }
}

fn encrypt_aes128_ecb_in_place(key: &[u8; 16], data: &mut [u8; 128]) {
    let cipher = Aes128::new_from_slice(key).expect("AES-128 key length is fixed");

    for block in data.chunks_exact_mut(16) {
        cipher.encrypt_block(GenericArray::from_mut_slice(block));
    }
}

fn emit(message: OutputMessage) {
    match serde_json::to_string(&message) {
        Ok(line) => println!("{line}"),
        Err(error) => eprintln!("failed to serialize VNC sidecar message: {error}"),
    }

    let _ = std::io::stdout().flush();
}

fn emit_frame_batch(frames: &mut Vec<FrameUpdate>) {
    if frames.is_empty() {
        return;
    }

    emit(OutputMessage::FrameBatch {
        frames: std::mem::take(frames),
    });
}

fn emit_frame_batch_if_full(frames: &mut Vec<FrameUpdate>) {
    if frames.len() >= MAX_FRAME_BATCH_SIZE {
        emit_frame_batch(frames);
    }
}

async fn read_normalized_rfb_banner(
    stream: &mut TcpStream,
) -> Result<[u8; 12], Box<dyn std::error::Error + Send + Sync>> {
    let mut banner = [0_u8; 12];

    stream.read_exact(&mut banner).await?;

    if !banner.starts_with(b"RFB ") || banner[11] != b'\n' {
        return Err(format!(
            "Invalid VNC protocol banner: {}",
            String::from_utf8_lossy(&banner).trim_end()
        )
        .into());
    }

    let major = std::str::from_utf8(&banner[4..7])?.parse::<u16>()?;
    let minor = std::str::from_utf8(&banner[8..11])?.parse::<u16>()?;
    let normalized = if major > 3 || (major == 3 && minor >= 8) {
        *b"RFB 003.008\n"
    } else if major == 3 && minor >= 7 {
        *b"RFB 003.007\n"
    } else {
        *b"RFB 003.003\n"
    };

    if banner != normalized {
        eprintln!(
            "normalized VNC protocol banner from {} to {}",
            String::from_utf8_lossy(&banner).trim_end(),
            String::from_utf8_lossy(&normalized).trim_end()
        );
    }

    Ok(normalized)
}
