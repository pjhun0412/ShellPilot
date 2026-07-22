# ShellPilot VNC 설계 메모

> 상태: **동결 / 설계·현행 참고 문서**
> 현재 MVP 구조를 보존한다. 명시적으로 개발을 재개하기 전에는 기능 추가나 대규모 리팩터링을 진행하지 않는다.

이 문서는 ShellPilot에 VNC 접속 기능을 추가할 때 사용한 초기 설계와 현재 구현 메모를 함께 보존한다. 초기 브랜치 작업 지시는 더 이상 현재 작업 기준이 아니다.

## 목표

- ShellPilot에서 VNC 서버에 접속할 수 있는 새 패널을 추가한다.
- RDP와 비슷한 사용자 경험을 제공하되, VNC 기능은 독립 모듈로 관리한다.
- 첫 구현은 안정적인 MVP를 우선한다.
- 사용자 레이아웃 변경, 탭 전환, 패널 resize에 맞춰 화면 표시가 자연스럽게 동작해야 한다.

## MVP 범위

첫 버전에서 목표로 하는 기능은 다음과 같다.

1. VNC 세션 등록/실행
2. VNC password 인증
3. framebuffer 화면 렌더링
4. 마우스 입력 전달
   - 이동
   - 좌/우/중 클릭
   - wheel scroll
5. 키보드 입력 전달
6. reconnect/disconnect
7. 표시 모드
   - original size
   - fit/scale to panel
   - custom scale 또는 custom size는 후속으로 확장 가능
8. Workspace 탭 상태 표시
9. 공통 `app-scrollbar` 스타일 사용
10. 최소한의 에러/상태 메시지

## 초기 제외 범위

다음은 MVP에서 제외하고 후속 작업으로 남긴다.

- VNC 파일 전송
- 고급 clipboard/file clipboard
- 모든 VNC 인증 방식 지원
- RealVNC/TightVNC 전용 확장 전체 지원
- 멀티 모니터
- 자동 원격 해상도 변경
- 고급 이미지 품질/코덱 튜닝
- SSH 터널링 내장
- reverse VNC/listen mode

## VNC 프로토콜 메모

VNC는 RFB(Remote Framebuffer) 프로토콜 기반이다. RDP보다 프로토콜 구조는 단순하지만 서버별 확장과 인코딩 차이가 크다.

초기 지원 후보:

- Protocol version: 3.8 우선
- Security type: VNC Authentication 우선
- Pixel format: 32-bit true color 우선
- Encoding:
  - Raw: 반드시 지원
  - CopyRect: 가능하면 지원
  - Hextile 또는 ZRLE: 성능 개선 단계에서 검토

Raw만으로도 기능 검증은 가능하지만 네트워크/CPU 사용량이 클 수 있다. MVP에서는 먼저 안정성을 확인하고, 성능 문제가 명확하면 ZRLE/Hextile을 추가한다.

## 구현 전략 후보

### 1. Rust sidecar 방식

RDP와 유사하게 별도 sidecar 프로세스가 VNC 프로토콜을 처리하고, Tauri backend가 이를 관리한다.

장점:

- RDP sidecar 구조와 운영 방식이 유사하다.
- 프로토콜/렌더 이벤트를 앱 본체와 분리할 수 있다.
- 장애 격리가 쉽다.

단점:

- sidecar binary bundle, release, macOS/Windows 빌드 처리를 추가해야 한다.
- 적절한 Rust VNC crate 품질 확인이 필요하다.

### 2. Tauri backend 내장 방식

`src-tauri/src/commands/vnc.rs`에서 VNC 연결을 직접 관리한다.

장점:

- sidecar bundle 작업이 줄어든다.
- 초기 wiring이 단순할 수 있다.

단점:

- 프로토콜 loop와 frame 처리가 앱 backend에 붙어 복잡해질 수 있다.
- 장애 격리가 약하다.

### 3. 프론트엔드/noVNC 계열 방식

브라우저 쪽 VNC 클라이언트 구현을 참고하거나 사용할 수 있다.

장점:

- 렌더링/입력 모델이 브라우저와 가깝다.
- noVNC는 검증된 구현이다.

단점:

- 일반 VNC TCP 서버는 WebSocket이 아니므로 별도 proxy가 필요하다.
- ShellPilot의 Tauri/Rust 중심 연결 구조와 다소 어긋난다.

## 권장 방향

초기에는 Rust sidecar 방식을 우선 검토한다. 단, Rust VNC crate 품질이 부족하거나 유지보수 위험이 크면 Tauri backend 내장 최소 구현으로 전환할 수 있다.

작업 시작 시 반드시 crate 후보를 먼저 조사하고 다음을 문서에 남긴다.

- 사용 후보 crate 이름/버전
- 지원하는 인증 방식
- 지원하는 encoding
- async/runtime 호환성
- Windows/macOS 빌드 가능성
- 유지보수 상태
- 선택/보류 이유

## 구현 전략 조사 결과

조사 시점: 2026-07-13

### crate 후보

| 후보 | 확인 버전 | 인증 | encoding | async/runtime | 빌드/운영 메모 | 판단 |
| --- | ---: | --- | --- | --- | --- | --- |
| `vnc-rs` | `0.5.3` | None, VNC Authentication. TLS/VeNCrypt 등은 미구현 오류 처리 | Raw, CopyRect, Tight, TRLE, ZRLE, CursorPseudo, DesktopSizePseudo | Tokio 기반 async. `VncConnector`/`VncClient` 이벤트-입력 모델 | 순수 Rust 의존성 위주라 Windows/macOS sidecar 빌드에 적합. 예제는 TCP client + frontend 렌더러 분리 구조 | 채택 |
| `vnc` | `0.4.0` | VNC Authentication 계열 | Raw/ZRLE 등 기본 구현 | 오래된 blocking/std I/O 중심 | `byteorder 0.5`, `flate2 0.2`, `log 0.3` 등 오래된 의존성. API/문서도 장기 유지보수 관점에서 위험 | 보류 |
| `vnc-client` | `1.0.0` | `vnc` crate 기반 | `vnc` crate 기반 | desktop client binary 성격 | SDL2/X11 dependency가 포함되어 ShellPilot sidecar에 불필요한 GUI/native dependency를 끌어온다 | 보류 |

### 방식별 판단

1. Rust sidecar 방식
   - 선택한다.
   - `vnc-rs`가 frontend 렌더러와 protocol engine을 분리하는 이벤트 모델을 제공하므로 ShellPilot의 RDP sidecar 운영 방식과 잘 맞는다.
   - VNC protocol loop, frame decode, 입력 전송을 앱 backend와 분리해 장애 격리와 추후 교체 가능성을 확보한다.
   - Tauri backend는 sidecar spawn, password credential resolve, JSON line IPC, window event emit만 담당한다.

2. Tauri backend 내장 방식
   - MVP fallback으로 보류한다.
   - sidecar packaging은 필요 없지만, long-running protocol loop와 frame decode가 앱 backend command module에 붙어 복잡도가 커진다.
   - VNC crate 교체/실험 시 앱 본체 빌드 영향이 커진다.

3. noVNC/WebSocket proxy 방식
   - 보류한다.
   - noVNC 자체는 검증된 browser VNC client지만 일반 VNC 서버는 TCP RFB이므로 WebSocket proxy가 추가로 필요하다.
   - ShellPilot의 credential store/Tauri command/sidecar 구조와 맞추려면 결국 proxy sidecar가 필요해져 초기 MVP에는 계층이 늘어난다.

### MVP 선택

- sidecar: `src-tauri/vnc-sidecar`
- crate: `vnc-rs = 0.5.3` (`lib` crate name은 `vnc`)
- 인증: VNC password authentication 우선. None 인증은 crate가 지원하지만 ShellPilot MVP UI/세션은 password 인증을 기본으로 둔다.
- encoding: Raw와 CopyRect를 우선 검증하고, `vnc-rs`가 지원하는 ZRLE/Tight은 서버 호환성과 성능 개선용으로 enable한다. 문제가 드러나면 encoding 목록을 Raw/CopyRect로 축소할 수 있게 sidecar 내부에 모은다.
- pixel format: frontend canvas에 바로 올리기 위해 `PixelFormat::rgba()`를 요청한다.
- IPC: sidecar stdout은 JSON line event, stdin은 JSON line input command로 제한한다. 비밀번호는 argv/stdout에 노출하지 않고 stdin 첫 줄 target JSON에 포함하되 로그에는 쓰지 않는다.

### macOS Screen Sharing / Apple ARD 인증

macOS 내장 Screen Sharing 서버는 `RFB 003.889` 같은 비표준 banner와 Apple 전용 Diffie-Hellman 기반 인증인 security type `30`을 제공할 수 있다. 이 방식은 표준 VNC password authentication(security type `2`)이 아니며 `vnc-rs 0.5.3`에도 구현되어 있지 않다.

ShellPilot sidecar는 이 경우 `vnc-rs`에 넘기기 전에 raw socket 단계에서 Apple ARD 인증을 직접 처리한다.

- 서버 security list에 표준 VNC password auth(type `2`)가 있으면 MVP 기본 경로인 `vnc-rs` VNCAuth를 우선 사용한다.
- 서버가 Apple ARD(type `30`)만 제공하면 sidecar가 type `30`을 선택하고 DH/AES 인증을 수행한다.
- 인증 후의 framebuffer update/input 처리는 표준 RFB 흐름으로 돌아가므로 기존 `vnc-rs` 렌더/입력 루프를 그대로 사용한다.
- Apple ARD 인증에는 macOS 계정 username과 password가 모두 필요하다. VNC 세션의 `username` 필드를 macOS 계정 이름으로 입력해야 한다.

구현 근거는 LibVNCServer의 `HandleARDAuth` 구현과 동일한 흐름이다.

1. 서버가 generator, key length, prime modulus, server public key를 전송한다.
2. 클라이언트가 DH private/public key를 만들고 shared secret을 계산한다.
3. shared secret을 MD5 해시해 AES-128 key로 사용한다.
4. `username[64] + password[64]` 128-byte buffer를 AES-128-ECB(no padding)로 암호화한다.
5. ciphertext와 client public key를 서버에 전송하고 SecurityResult를 확인한다.

## 예상 파일 구조

프론트엔드:

```text
src/features/vnc/
  VncPanel.tsx
  VncPanelHeader.tsx
  VncDisconnectedState.tsx
  VncStatusBadge.tsx
  vncBridge.ts
  vncDisplay.ts
  vncProfiles.ts
  vncUiUtils.ts
  useVncFrameRenderer.ts
  useVncPanelLifecycle.ts
```

백엔드:

```text
src-tauri/src/commands/vnc.rs
```

sidecar를 선택하는 경우:

```text
src-tauri/vnc-sidecar/
  Cargo.toml
  src/main.rs
```

문서:

```text
docs/vnc-design.md
```

## 기존 구조 참고 파일

RDP 구조를 참고하되 VNC 코드는 독립적으로 구성한다.

- `src/features/rdp/RdpPanel.tsx`
- `src/features/rdp/RdpPanelHeader.tsx`
- `src/features/rdp/RdpDisconnectedState.tsx`
- `src/features/rdp/rdpBridge.ts`
- `src/features/rdp/useRdpFrameRenderer.ts`
- `src/features/rdp/rdpPanelLifecycle.ts`
- `src-tauri/src/commands/rdp.rs`
- `src-tauri/rdp-sidecar/src/main.rs`
- `src-tauri/rdp-sidecar/src/input.rs`

Workspace/session 확장 시 참고:

- `src/types/workspace.ts`
- `src/features/workspace/panelFactory.tsx`
- `src/features/workspace/workspaceLayout.ts`
- `src/features/workspace/Workspace.tsx`
- `src/features/sessions/session.schema.ts`
- `src/features/sessions/sessionForm.ts`
- `src/features/sessions/components/CreateSessionDialog.tsx`
- `src/features/sessions/components/SessionBasicFields.tsx`

## UI/UX 원칙

- RDP와 비슷한 상단 헤더 패턴을 쓰되 VNC에 필요한 정보만 표시한다.
- 화면 영역은 최대한 크게 보여준다.
- 어중간한 패널 크기에서도 헤더가 잘리지 않도록 반응형으로 구성한다.
- native scrollbar를 직접 노출하지 말고 ShellPilot 공통 `app-scrollbar` 스타일을 사용한다.
- 표시 모드 메뉴는 RDP와 유사하게 구성한다.
  - Original
  - Fit
  - Custom/Scale은 후속 확장 가능
- status 텍스트는 가변 폭으로 UI가 흔들리지 않게 고정 폭/축약 표시를 사용한다.
- 사용자가 레이아웃을 옮기고 늘리고 줄여도 canvas/framebuffer가 맞춰져야 한다.

## 세션 모델

초기에는 기존 `SessionItem`에 `kind: 'vnc'`를 추가하는 방향을 검토한다.

필요 필드 후보:

- `host`
- `port` 기본값 5900
- `username`은 VNC 표준에는 보통 필요 없지만 일부 서버/확장 가능성을 위해 선택 필드 유지 가능
- `authMethod: 'password'`
- `credentialRef`
- `metadata`:
  - display mode
  - scale
  - preferred encoding 후보

세션 저장 시 비밀번호는 기존 credential store 흐름을 재사용한다.

## Tauri command 후보

초기 command 후보:

```text
vnc_open
vnc_close
vnc_reconnect
vnc_pointer_event
vnc_key_event
vnc_clipboard_text  # 후속
```

sidecar 방식이면 Tauri command는 sidecar spawn/IPC/event routing을 담당한다.

프론트 이벤트 후보:

```text
shellpilot-vnc-frame
shellpilot-vnc-status
shellpilot-vnc-error
```

## 렌더링 방향

- RDP처럼 canvas 기반 렌더링을 우선한다.
- sidecar/backend에서 frame update를 받아 프론트에서 canvas에 그린다.
- MVP에서는 전체 framebuffer 또는 dirty rect 업데이트 중 구현 난이도가 낮은 방식을 선택한다.
- 성능 개선 단계에서 dirty rect batching, requestAnimationFrame 조절, frame drop 정책을 적용한다.

## 입력 처리 방향

마우스:

- canvas 좌표를 원격 framebuffer 좌표로 변환한다.
- scale/original/fit 모드 모두 좌표 변환이 정확해야 한다.
- wheel은 VNC button mask 방식으로 변환한다.

키보드:

- browser KeyboardEvent를 VNC keysym으로 변환해야 한다.
- ASCII/기본 제어키부터 시작한다.
- Ctrl/Alt/Meta 조합은 OS/브라우저 제약을 문서화한다.

## 보안 주의 사항

- 비밀번호는 프론트 로그/터미널 로그/sidecar stdout에 노출하지 않는다.
- credential store를 재사용하고, 세션 metadata/localStorage에는 secret을 저장하지 않는다.
- VNC는 기본적으로 암호화되지 않는 경우가 많다. TLS/VeNCrypt 미지원 상태에서는 UI에 보안 주의 문구를 표시하는 방안을 검토한다.
- 디버그 로그는 연결 상태/오류 중심으로 제한한다.

현재 MVP 보안 상태:

- VNC 비밀번호는 프로세스 argv로 전달하지 않고 backend가 credential store 또는 사용자 입력값을 해석한 뒤 sidecar stdin의 첫 JSON line으로만 전달한다.
- sidecar stdout은 상태/frame JSON 전용으로 사용하고 secret을 출력하지 않는다.
- backend는 password/auth 관련 sidecar 오류를 일반 인증 실패 메시지로 축약해 UI에 전달한다.
- macOS Screen Sharing Apple ARD 인증(type 30)은 raw socket 단계에서 인증을 완료한 뒤, 이미 인증된 RFB 스트림을 `vnc-rs`에 넘기기 위한 shim으로 내부 prefix를 구성한다.
- TLS/VeNCrypt는 아직 지원하지 않는다. 개인용 LAN/VPN 환경은 MVP 사용 범위로 허용하되, 인터넷에 VNC 포트를 직접 노출하는 사용은 권장하지 않는다.

## 현재 구현 상태

2026-07-13 기준 MVP 구현 내용:

- `kind: 'vnc'` 세션과 VNC 세션 폼/워크스페이스 패널 연결
- Rust sidecar 기반 VNC 연결
- VNC password authentication(type 2)
- macOS Screen Sharing Apple ARD authentication(type 30)
- `RFB 003.889` 같은 macOS 비표준 banner normalization
- framebuffer canvas 렌더링
- Raw, ZRLE, CopyRect, DesktopSizePseudo encoding 요청
- 마우스 이동/클릭/휠 입력
- 키보드 입력과 Ctrl/Alt/Meta/Shift modifier 처리
- reconnect/disconnect
- original/fit 표시 모드
- 공통 `OverlayScrollArea` 기반 스크롤 영역 사용
- frame batch, CopyRect canvas copy, requestAnimationFrame 렌더링, 숨겨진 패널 refresh 중지, 입력 batching 성능 개선

MVP 이후 후보:

- TLS/VeNCrypt
- SSH 터널링
- clipboard 고도화
- 고급 encoding/프레임 압축 튜닝
- 멀티 모니터/원격 해상도 변경

## 배포 메모

1.0.1 배포부터 VNC sidecar가 앱 번들에 포함된다.

- `src-tauri/tauri.conf.json`의 `bundle.externalBin`에 `binaries/shellpilot-vnc-probe`가 등록되어 있다.
- Windows target에서는 Tauri가 `src-tauri/binaries/shellpilot-vnc-probe-x86_64-pc-windows-msvc.exe` 형태의 target-specific external binary를 번들링한다.
- `src-tauri/build.rs`는 VNC sidecar source 또는 lockfile이 external binary보다 최신이면 sidecar를 다시 빌드하고 `src-tauri/binaries/`로 복사한다.
- 따라서 1.0.1 release build를 정상 경로(`npm run tauri:build` 또는 release script)로 만들면 ShellPilot 본체와 VNC sidecar exe가 함께 배포된다.

## 구현 순서 제안

1. VNC crate/sidecar 전략 조사
2. 이 문서에 선택 근거 추가
3. `SessionItem`/세션 폼에 `vnc` kind 추가
4. `VncPanel` skeleton과 workspace panel factory 연결
5. backend command 또는 sidecar skeleton 추가
6. 연결/인증 MVP 구현
7. framebuffer Raw 렌더링
8. 마우스 입력 구현
9. 키보드 입력 구현
10. reconnect/disconnect 구현
11. 표시 모드 original/fit 구현
12. build/check 및 문서 업데이트

## 검증 명령

변경 후 최소 확인:

```powershell
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
```

sidecar를 추가한 경우:

```powershell
cargo check --manifest-path src-tauri\vnc-sidecar\Cargo.toml
```

RDP sidecar나 release bundle을 건드린 경우:

```powershell
cargo check --manifest-path src-tauri\rdp-sidecar\Cargo.toml
```

## 현재 주의 상태

- 이 브랜치 생성 시점에 `src-tauri/binaries/shellpilot-rdp-probe-x86_64-pc-windows-msvc.exe` 로컬 변경이 남아 있었다.
- 이 파일은 VNC 작업과 무관하므로 명시 지시가 없으면 커밋하거나 되돌리지 않는다.

## 새 작업 스레드 주의 사항

- AGENTS.md를 준수한다.
- AI/SSH/SFTP/settings/RDP 코드는 명시 없이 건드리지 않는다.
- Workspace/session 타입 확장은 VNC 추가에 필요한 범위에서만 수정한다.
- RDP 코드는 참고만 하고 무분별하게 복사하지 않는다.
- 커밋/푸시는 사용자 지시가 있을 때만 한다.
