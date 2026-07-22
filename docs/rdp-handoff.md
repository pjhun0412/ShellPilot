# RDP 현행 인계

> 상태: **동결 / 현행 참고 문서**
> 현재 구현과 큰 구조를 보존한다. 명시적으로 개발을 재개하기 전에는 기능 추가나 대규모 리팩터링을 진행하지 않는다.

RDP는 외부 클라이언트 실행이 아니라 ShellPilot 탭 안에 내장되는 원격 데스크톱 패널입니다. 현재는 Tauri backend가 IronRDP sidecar process를 관리하고, React가 canvas에 frame을 렌더링합니다.

## 현재 구현 요약

- React `RdpPanel`이 원격 데스크톱을 canvas에 그립니다.
- Tauri backend는 `panelId`별 RDP 세션 lifecycle과 sidecar process를 관리합니다.
- sidecar는 backend가 서버 TLS fingerprint를 승인한 뒤에만 stdin으로 credential을 받습니다.
- frame, lifecycle, clipboard, remote cursor, display resize event는 Tauri event로 정규화되어 frontend로 전달됩니다.
- keyboard/mouse/wheel/clipboard/display resize 명령은 React → Tauri → sidecar 순서로 전달됩니다.
- RDP 탭은 `connectionStatus.ts`에 상태를 publish해서 sidebar/tab의 연결 표시와 연동됩니다.
- 탭 우클릭 메뉴의 reconnect/disconnect는 `rdpPanelLifecycle.ts`를 통해 RDP 패널에 전달됩니다.

## 파일 지도

Frontend:

- `src/features/rdp/RdpPanel.tsx`
  - 패널 상태, 연결 lifecycle, canvas sizing, display mode, resolution, Tauri event listener 통합.
- `src/features/rdp/RdpPanelHeader.tsx`
  - RDP 상단 헤더. 좁은/중간/넓은 폭에 맞춰 버튼과 상태 정보를 줄여 보여줍니다.
- `src/features/rdp/RdpDisplayMenu.tsx`
  - Display 메뉴. 원본 크기/크기 조정, 이미지 품질, 해상도 submenu를 담당합니다.
- `src/features/rdp/rdpDisplayOptions.ts`
  - 로컬 화면 기반 기본 해상도, preset 해상도, 이미지 품질 옵션.
- `src/features/rdp/rdpPanelLifecycle.ts`
  - Workspace 탭 메뉴에서 RDP reconnect/disconnect 요청을 전달하는 event bus.
- `src/features/rdp/useRdpFrameRenderer.ts`
  - canvas frame drawing, FPS/network stats 계산.
- `src/features/rdp/useRdpInputHandlers.ts`
  - pointer, wheel, keyboard, clipboard paste, Windows menu 입력.
- `src/features/rdp/useRdpViewportSize.ts`
  - RDP viewport resize 측정.
- `src/features/rdp/rdpBridge.ts`
  - Tauri invoke/listen 경계.
- `src/features/rdp/rdpScancodes.ts`
  - 키보드 scancode mapping.
- `src/features/rdp/rdpNetworkStats.ts`, `rdpUiUtils.ts`, `RdpStatusBadge.tsx`, `RdpDisconnectedState.tsx`
  - UI/상태 보조 로직.

Backend / Sidecar:

- `src-tauri/src/commands/rdp.rs`
  - Tauri commands, session store, sidecar process management, certificate trust store, local clipboard, Windows key capture.
- `src-tauri/rdp-sidecar/src/main.rs`
  - IronRDP connection, active session loop, display resize, frame decode, TLS fingerprint extraction, sidecar wire message.
- `src-tauri/rdp-sidecar/src/clipboard.rs`
  - CLIPRDR text/file clipboard helper.
- `src-tauri/rdp-sidecar/src/input.rs`
  - input/scancode helper.

## Tauri command / event

Frontend invoke:

```text
rdp_open
rdp_close
rdp_send_input
rdp_paste_clipboard_files
rdp_set_local_clipboard_text
rdp_forget_certificate
rdp_set_windows_key_capture
```

Frontend listen:

```text
shellpilot-rdp
shellpilot-rdp-frame
shellpilot-rdp-cursor
shellpilot-rdp-clipboard
```

## 보안 흐름

RDP credential 처리의 핵심 원칙:

- password를 process argv로 넘기지 않습니다.
- sidecar는 credential을 stdin으로만 받습니다.
- backend가 서버 TLS fingerprint를 먼저 승인한 뒤에만 password를 sidecar로 보냅니다.
- fingerprint는 app data의 RDP trust store에 저장합니다.
- unknown certificate는 사용자가 `Trust and reconnect`를 선택해야 진행합니다.
- fingerprint mismatch는 차단합니다.
- probe 연결에서 확인한 fingerprint와 실제 login 연결의 fingerprint가 다르면 credential exchange 전에 중단합니다.
- sidecar debug log는 기본 비활성화입니다. `SHELLPILOT_RDP_DEBUG_LOG=1`일 때만 자세한 log를 남깁니다.
- UI에는 sidecar raw debug log를 그대로 보여주지 않고 요약된 에러만 보여주는 방향입니다.

## 렌더링과 스크롤

- 원격 화면은 canvas에 렌더링합니다.
- 원본 크기 모드에서는 remote desktop 실제 pixel 크기를 유지하고, 패널보다 크면 공통 `OverlayScrollArea`를 사용합니다.
- 크기 조정 모드에서는 aspect ratio를 유지하면서 viewport 안에 맞춥니다.
- 원본/fit 전환 시 canvas가 불필요하게 unmount되지 않도록 주의합니다. canvas가 remount되면 검은 화면처럼 보일 수 있습니다.
- native scrollbar가 보이면 안 되고, 공통 overlay scrollbar 스타일을 사용해야 합니다.

## 해상도와 resize

현재 resize 전략:

- 처음 연결 기본값은 로컬 화면 크기를 기준으로 계산합니다.
  - `window.screen.width * window.devicePixelRatio`
  - `window.screen.height * window.devicePixelRatio`
  - MS-RDPEDISP 호환을 위해 짝수 크기로 보정합니다.
- display menu에서 해상도 preset을 선택할 수 있습니다.
- 해상도 변경은 세션 전체 reconnect가 아니라 MS-RDPEDISP display-control resize request를 보냅니다.
- sidecar는 resize 시 decoded image buffer를 reset하고 full refresh를 요청합니다.

주의:

- 일부 Windows/RDP 서버 조합은 resize 후 DPI scaling이나 아이콘 크기 반응이 다를 수 있습니다.
- 4K 해상도는 동작 대상이지만 CPU/메모리/대역폭 부담이 큽니다.

## 입력과 remote cursor

지원:

- mouse move/down/up
- wheel
- keyboard down/up
- clipboard text/file 일부
- Windows menu 보조 명령
- remote cursor shape forwarding

제약:

- Ctrl+Alt+Del, Alt+F4, 일부 Windows-key 조합은 WebView/OS가 먼저 가로챌 수 있습니다.
- IME/한국어 조합 입력은 별도 compatibility track입니다.
- remote cursor는 sidecar의 pointer event를 Tauri event로 보내고, frontend가 canvas CSS cursor로 적용합니다.

## Clipboard

현재 방향:

- CLIPRDR virtual channel을 사용합니다.
- local ↔ remote text/file clipboard 왕복을 목표로 합니다.
- 자동 동기화는 보안상 조심해야 하며, 가능한 사용자가 명시적으로 paste/copy하는 흐름을 유지합니다.
- CLIPRDR 실패가 RDP 세션 전체를 끊지 않게 해야 합니다.

## 최근 안정화 포인트

- TLS certificate 검증을 credential 전달 전으로 당겼습니다.
- sidecar debug log는 기본 비활성화하고 opt-in으로 바꿨습니다.
- sidecar error는 UI에 raw log 대신 요약 에러로 노출하는 방향입니다.
- 원본/fit 전환 시 canvas remount로 검은 화면이 나는 문제를 줄였습니다.
- RDP 영역과 resolution 메뉴에서 공통 overlay scrollbar 사용 방향을 잡았습니다.
- remote cursor를 전달해 파일 탐색기 column resize 같은 커서 모양이 보이도록 했습니다.
- RDP 탭 우클릭 disconnect/reconnect가 terminal lifecycle로 잘못 라우팅되던 문제를 `rdpPanelLifecycle.ts`로 분리했습니다.

## 남은 작업

- CLIPRDR text/file 반복 사용 안정화 테스트.
- IME/한국어 입력 compatibility.
- 4K/high-FPS 장시간 성능 테스트.
- release build에서 sidecar binary 번들링 검증.
- sidecar `main.rs`를 display resize/reactivation, frame decode, connection bootstrap 단위로 분리.
- 더 직접적인 pre-auth certificate hook이 IronRDP에 생기면 probe 방식 대체 검토.

## 검증

RDP 관련 변경 후 우선 확인:

```bash
npm run build
cargo check --manifest-path src-tauri\rdp-sidecar\Cargo.toml
cargo check --manifest-path src-tauri\Cargo.toml
```

RDP sidecar check가 `target` 쓰기 권한 문제로 실패하면 코드 문제가 아닐 수 있으므로 같은 명령을 권한 상승으로 재시도합니다.
