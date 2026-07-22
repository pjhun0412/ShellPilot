# RDP Design

> Status: **frozen historical design / decision log**
> 현재 구현은 `docs/rdp-handoff.md`를 먼저 본다. 이 문서는 상세 설계, 단계별 계획, 결정 로그를 보존하며 현재 로드맵으로 사용하지 않는다.

ShellPilot RDP is planned as an embedded tab experience, not an external client launcher.
The first target is Windows development and Windows RDP servers. macOS support is a later
compatibility pass, but early architecture should avoid Windows-only UI embedding.

## Current Implementation Snapshot

RDP currently uses a ShellPilot-managed IronRDP sidecar process:

- React renders the remote desktop in an `RdpPanel` canvas.
- The Tauri backend owns RDP session lifecycle and starts/stops one sidecar per panel.
- The sidecar receives credentials through stdin only after the backend has approved the server TLS
  fingerprint.
- Frames, lifecycle events, clipboard events, and display resize events are normalized into Tauri
  events for the frontend.
- Keyboard, mouse, wheel, clipboard, Windows-key capture, and display resize commands flow from
  React to Tauri and then to the sidecar.
- RDP tabs publish connection state so sidebar/tab status can reflect active, connecting, failed,
  and closed sessions.

The sidecar path is still preferred because direct IronRDP linkage risks dependency conflicts with
the existing SSH/SFTP backend dependency graph.

## File Map

Frontend RDP code lives under `src/features/rdp/`:

- `RdpPanel.tsx`: panel state, connection lifecycle, canvas sizing, display mode, resolution, and
  event listeners.
- `RdpPanelHeader.tsx`: responsive compact/comfortable/wide header layout.
- `RdpDisplayMenu.tsx`: hover submenu for display mode, image quality, and resolution.
- `rdpDisplayOptions.ts`: local-screen default resolution, preset list, and image quality options.
- `useRdpFrameRenderer.ts`: canvas frame drawing and network/frame statistics.
- `useRdpInputHandlers.ts`: pointer, wheel, keyboard, clipboard paste, and Windows-menu input.
- `useRdpViewportSize.ts`: callback-ref based viewport measurement for responsive canvas sizing.
- `rdpBridge.ts`: Tauri invoke/listen boundary.
- `rdpScancodes.ts`: keyboard mapping.
- `rdpNetworkStats.ts`, `rdpUiUtils.ts`, `RdpStatusBadge.tsx`, and
  `RdpDisconnectedState.tsx`: UI support.

Backend and sidecar code:

- `src-tauri/src/commands/rdp.rs`: Tauri commands, session store, sidecar process management,
  certificate trust store, local clipboard integration, and Windows-key hook.
- `src-tauri/rdp-sidecar/src/main.rs`: IronRDP connection, active session loop, display resize,
  frame decode, TLS fingerprint extraction, and sidecar wire messages.
- `src-tauri/rdp-sidecar/src/clipboard.rs`: CLIPRDR text/file clipboard helpers.
- `src-tauri/rdp-sidecar/src/input.rs`: input/scancode helpers.
- `src-tauri/.taurignore`: excludes sidecar source from the Tauri source package.

## Direction

Primary implementation path:

- Use IronRDP as the RDP protocol engine.
- Prefer direct Tauri Rust backend integration when dependency compatibility allows it.
- Use a ShellPilot-managed IronRDP sidecar when direct integration conflicts with existing
  SSH/SFTP dependencies.
- Render remote desktop frames in the React panel with canvas/WebGL.
- Send keyboard, mouse, wheel, resize, and clipboard-related events from React to Rust.
- Keep credentials in the existing backend credential store.

Fallback implementation path:

- Use a local gateway sidecar such as guacd if IronRDP cannot provide enough screen quality,
  performance, authentication coverage, or input reliability.
- The gateway would be managed by the Rust backend and communicate with the React panel over
  localhost WebSocket.

Out of scope for the main RDP path:

- Launching mstsc, xfreerdp, or Microsoft Remote Desktop as the primary workflow.
- Windows ActiveX embedding.
- A platform-specific native child-window renderer as the first implementation.

## Phase 0: Connection Proof

Goal: prove that ShellPilot can connect to an RDP server and receive a usable first frame.

Backend tasks:

- Add an RDP command module with an in-memory session store.
- Add a minimal `rdp_open` command that accepts panel id, host, port, username, and credential ref.
- Resolve the password through the existing credential store.
- Start an IronRDP client connection on a background task or managed sidecar process.
- Emit lifecycle events: connecting, connected, auth_failed, network_failed, closed.
- Capture the first decoded frame or bitmap update.

Frontend tasks:

- Replace the RDP placeholder with an `RdpPanel`.
- Show connection state, target, and reconnect controls.
- Show a canvas area even before frames are available.
- Display a clear failure card when authentication or network setup fails.

Success criteria:

- An RDP tab opens from an RDP session.
- The backend attempts a real RDP connection.
- Authentication failure and network failure are visible in the tab.
- At least one screen frame can be decoded and sent to the frontend.

## Phase 1: View-Only Renderer

Goal: display the remote desktop in the tab without full input support.

Backend:

- Normalize frame updates into a simple internal frame event.
- Prefer raw BGRA/RGBA frame chunks for the first pass.
- Add a frame sequence id so the frontend can ignore stale updates.
- Avoid blocking the Tauri main thread.

Frontend:

- Draw frames into a canvas.
- Preserve aspect ratio while fitting the panel.
- Show frame latency and connection state in a small status strip.

Open questions:

- Whether frames should be sent as raw byte arrays, compressed images, or a shared-buffer-like
  strategy.
- Whether IronRDP's reusable client crate exposes the right update granularity for continuous UI
  rendering without copying too much data.

## Phase 2: Input

Goal: make the session interactive.

Input events:

- Mouse move, down, up, double click.
- Mouse wheel.
- Keyboard down/up with modifier state.
- Focus capture and release.
- Local clipboard text paste using Unicode keyboard input.

Rules:

- The RDP panel must only capture keyboard input when focused.
- ShellPilot global shortcuts should not leak into the RDP session unless the panel has explicit
  focus.
- IME and Korean text input are tracked as a separate compatibility item.

## Phase 3: Workspace Integration

Goal: make RDP behave like SSH/SFTP panels.

Features:

- Session sidebar open.
- Open Tabs grouping.
- Reconnect and disconnect.
- Status dots and failure state.
- Per-tab AI binding only after stable RDP metadata exists.
- Settings for resize behavior and color depth.

## Security And Lifecycle

These items are part of the RDP MVP hardening path, not optional polish.

- Do not pass secrets through process arguments. The sidecar receives the password through stdin so
  it is not exposed through process listings.
- Do not send the password to the sidecar until the server TLS fingerprint has passed the backend
  TOFU trust decision.
- Do not write credentials to logs, stderr, telemetry, or reconnect messages.
- Sidecar processes are killed when a tab disconnects or closes.
- Backend session handles are removed when the sidecar exits, fails, or is closed.
- Late sidecar exits cannot delete a newer session for the same panel id because each run has a
  backend run id.
- Development builds the sidecar on demand only when the binary is missing or the sidecar source is
  newer than the binary.
- Release builds must use a bundled sidecar binary. A user machine must not require `cargo` just to
  open RDP.
- The sidecar first performs a certificate probe and emits the RDP TLS certificate SHA-256
  fingerprint before the backend sends credentials.
- The backend stores trusted RDP fingerprints in app data and applies a TOFU-style decision:
  unknown certificates are blocked until the user chooses `Trust and reconnect`, and changed
  fingerprints are blocked as certificate mismatches.
- If a fingerprint changes, the user can explicitly forget the stored certificate and reconnect;
  the next connection returns to the unknown-certificate trust flow.
- The sidecar compares the certificate used by the actual login connection with the fingerprint
  approved during the probe and aborts if it changes before credential exchange.
- Sidecar stderr is summarized before being shown in the UI. Full sidecar debug logging is disabled
  by default and only written when `SHELLPILOT_RDP_DEBUG_LOG=1` is set.

## Input Expectations

RDP input support should be good enough for normal operations, but it cannot perfectly replace a
native client inside a WebView:

- Normal keys, mouse movement, buttons, and wheel events are implemented.
- Ctrl/Alt/Win combinations should work when the WebView can capture them.
- The local OS may intercept the physical Windows key before the WebView receives it. ShellPilot
  should provide explicit toolbar/menu commands, such as `Windows menu` using `Ctrl+Esc`, for
  reserved keys that cannot be captured reliably.
- OS/browser-reserved shortcuts such as Ctrl+Alt+Del, Alt+F4, or some Windows-key combinations may
  need toolbar buttons or explicit commands instead of raw key capture.
- IME and Korean text input are a dedicated compatibility track.

## Rendering And Performance

The sidecar normalizes decoded updates into frame events. The frontend draws those updates to a
canvas and uses sequence ids to ignore stale frame events. Network/status information is shown in a
fixed-width responsive header pill to avoid layout jitter.

The current renderer is adequate for interactive MVP usage. Future optimization candidates:

- reduce frame copy overhead;
- drop or coalesce queued stale frame updates more aggressively;
- investigate shared-buffer or GPU-backed rendering if 4K/high-FPS sessions become too expensive.

## Resize Strategy

The current sidecar starts with the desktop size requested by the frontend. The frontend default is
the local display size:

- `window.screen.width * window.devicePixelRatio`
- `window.screen.height * window.devicePixelRatio`
- dimensions are rounded down to even numbers for MS-RDPEDISP compatibility.

If the detected size matches a preset, that preset is selected. Otherwise, the detected resolution is
added to the Resolution submenu as the current display size. This avoids falling back to `1280x800`
on high-DPI or 4K displays. Backend-only fallback paths use `1920x1080`.

The display menu currently supports:

- original size: render the remote desktop at actual pixels and use shared overlay scrollbars when
  the panel is smaller than the remote desktop;
- scale to fit: preserve aspect ratio and fit the canvas inside the panel;
- image quality: speed, balanced, quality;
- resolution presets: common desktop sizes including 4K.

Changing resolution sends an MS-RDPEDISP display-control resize request instead of reconnecting the
whole RDP session. The sidecar resets the decoded image buffer, requests a full refresh, and
continues through deactivate/reactivate frames when the server sends them.

Known resize caveats:

- Some Windows/RDP server combinations may react differently to DPI scaling after repeated size
  changes.
- The implementation keeps desktop scale factor at 100 to avoid unexpectedly enlarged remote icons
  after resize.
- 4K works as a requested desktop size, but it should still be treated as performance-heavy until
  longer usage confirms CPU, memory, and bandwidth behavior.

## Clipboard Scope

Clipboard is a separate feature track. It is not the same size as fit/fullscreen controls:

- Current implementation uses the RDP CLIPRDR virtual channel for local-to-remote text/file paste
  and remote-to-local text/file copy.
- Local paste remains visibly user-triggered from the keyboard menu or captured `Ctrl+V`; automatic
  paste/copy must stay opt-in because it crosses the local/remote boundary.
- CLIPRDR failures should surface as clipboard status errors without tearing down an otherwise
  usable RDP session.
- Image clipboard, richer format negotiation, and direction policy are later tracks.

## Session Model

RDP sessions use the existing `SessionItem` shape:

- `kind`: `rdp`
- `host`
- `port`, default 3389
- `username`
- `authMethod`: password first
- `credentialRef`

Future metadata fields:

- `domain`
- `desktopWidth`
- `desktopHeight`
- `fitMode`: `fit-panel` or `fixed-size`
- `colorDepth`
- `enableClipboard`
- `securityProtocol`

## Commit Slices

Recommended commit grouping for the current RDP work:

1. RDP frontend panel and UI
   - `src/features/rdp/**`
   - `src/features/panels/PanelBody.tsx`
   - RDP-related workspace/tab activation changes only, if included.

2. RDP backend and sidecar
   - `src-tauri/src/commands/rdp.rs`
   - `src-tauri/src/commands/mod.rs`
   - `src-tauri/src/lib.rs`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/rdp-sidecar/**`
   - `src-tauri/.taurignore`

3. Shared UI support and documentation
   - `src/components/ui/overlay-scroll-area.tsx`
   - `docs/rdp-design.md`

Keep unrelated AI, SSH, SFTP, settings, and workspace changes out of the RDP commits unless they are
strictly required for RDP integration.

## Remaining Work

Stabilization can continue from real usage reports. The known backlog is:

- CLIPRDR repeat-use testing for text and files.
- IME/Korean input compatibility.
- 4K/high-FPS performance testing.
- Release packaging verification for the sidecar binary.
- More direct pre-auth certificate hooks if IronRDP exposes them in a future API. The current
  implementation uses a probe connection before sending credentials to the login connection.
- Optional sidecar refactor of display resize/reactivation, frame decode, and connection bootstrap
  into smaller modules once behavior has settled.

## Risks

- IronRDP API surface may be lower-level than needed for a fast UI MVP.
- RDP graphics updates can become CPU-heavy if frames are copied too often.
- Keyboard mapping and IME behavior can take longer than connection and rendering.
- Clipboard and drive redirection must be opt-in for security.
- macOS support may expose different key mapping and packaging issues even if the backend is Rust.

## Decision Log

- External client launch is not the primary path.
- Windows ActiveX is rejected because macOS support is a future requirement.
- Native FreeRDP view embedding is not the first path because it creates platform-specific UI work.
- IronRDP is the first candidate because it fits ShellPilot's Rust backend architecture.
- guacd is the backup plan if IronRDP rendering or input support is not sufficient.
- Directly linking IronRDP 0.14-0.16 into the main Tauri backend currently conflicts with the
  existing `russh`/SFTP crypto dependency graph.
- Phase 0 therefore uses a ShellPilot-managed `rdp-sidecar` IronRDP probe process. This keeps the
  SSH/SFTP backend stable while still proving an internal embedded RDP engine, not an external RDP
  client launcher.
- RDP credentials are sent to the sidecar through stdin instead of argv, and only after the backend
  approves the server TLS fingerprint.
- RDP sidecar sessions now clean up their backend store entry on close/failure/exit and guard
  cleanup with a run id so stale exits do not delete newer sessions.
- RDP frame events include a monotonically increasing sequence id so the frontend can ignore stale
  frame updates.
- RDP now uses CLIPRDR for text/file clipboard exchange. The legacy Unicode keyboard paste path is
  retained only as an input fallback while CLIPRDR runtime stability is hardened.
- Display resize uses MS-RDPEDISP live resize instead of reconnecting the session for every
  resolution change.
