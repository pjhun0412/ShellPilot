# ShellPilot 프로젝트 구조와 작업 인계

이 문서는 새 작업 스레드나 사용자가 ShellPilot 전체 구조를 빠르게 파악하기 위한 한국어 인계 문서입니다. 기능별 개발 상태는 `maintenance-status.md`, 활성 기능의 세부 동작은 `ssh-handoff.md`, `sftp-handoff.md`, `notes-design.md`를 우선합니다.

## 현재 제품 방향

ShellPilot은 원격 작업용 통합 워크스페이스입니다.

- 왼쪽 Activity/Sidebar에서 세션, SSH 도구, 열린 탭, SFTP 탐색기, Notes, AI 영역을 전환합니다.
- 중앙은 FlexLayout 기반 워크스페이스이며 SSH, SFTP, RDP, VNC, 로컬 터미널, AI, Notes, Settings 패널이 탭으로 열립니다.
- 각 패널은 `panelId` 중심으로 프론트 상태, Tauri command, 백엔드 세션 store를 연결합니다.
- 세션 메타데이터와 secret은 분리합니다. password/passphrase는 세션 JSON/localStorage에 저장하지 않습니다.

## 현재 유지보수 범위

- 활성 유지보수: SSH/Local PTY, SFTP
- 활성 개발: Notes
- 공통 기반: Workspace, Sessions, Credentials, Settings
- 동결: RDP, VNC, AI Assistant

동결 영역은 현재 동작과 큰 구조를 보존합니다. 활성 기능을 수정하는 데 꼭 필요한 공통 변경이나 보안·빌드 차단 문제가 아니라면 동결 영역의 기능 추가와 리팩터링을 함께 진행하지 않습니다.

## 진입점과 큰 흐름

```text
src/main.tsx
  -> App.tsx
     -> MenuBar
     -> ActivityBar
     -> SidebarShell
     -> Workspace
        -> createPanelFactory
           -> PanelBody
              -> SshTerminal | LocalPtyTerminal | SftpPanel | RdpPanel | VncPanel
               | AiPanel | NotesPanel | SettingsPanel
```

`App.tsx`는 최상위 조정자입니다.

- FlexLayout model 생성/저장
- 사이드바 너비/활성 activity 관리
- 패널 추가/복제/닫기
- bottom border의 AI Assistant와 Transfer Queue 토글
- bound AI 탭 동기화

`Workspace.tsx`는 FlexLayout 인스턴스를 감싸며 탭 우클릭 메뉴, 탭 렌더링, 연결 상태 표시, 탭 활성화/포커스 연동을 담당합니다.

`PanelBody.tsx`는 `WorkspacePanel.type`과 `session.kind`에 따라 실제 패널 컴포넌트를 선택합니다.

## 공통 패널 활성화 규칙

ShellPilot의 패널은 단순히 화면에 보이는 것과 “활성 작업 대상”인 것이 다릅니다. 분할 레이아웃에서는 여러 패널이 동시에 보일 수 있으므로, 현재 키보드 입력과 새 탭 추가 기준이 되는 active panel을 명확히 맞춰야 합니다.

- 모든 패널은 `PanelFocusFrame`으로 감싸집니다.
- 패널 내부를 클릭하면 `Workspace.activatePanel(panelId)`가 호출됩니다.
- `activatePanel`은 React 상태만 바꾸지 않고 `focusWorkspaceTab(model, panelId)`로 FlexLayout 선택 상태도 함께 맞춥니다.
- SSH/Local PTY는 `terminalRegistry.ts`에 focus handler를 등록하고, 활성 탭 변경 시 `focusRegisteredTerminal(panelId)`로 xterm focus를 맞춥니다.
- SFTP는 `isActive`를 받아 keyboard shortcut 활성 여부를 동기화합니다.
- RDP는 `isActive`를 받아 keyboard/window-key listener를 켜고 끕니다. mouse 입력은 canvas에서 좌표 계산 후 sidecar로 전달합니다.

## 핵심 타입

위치: `src/types/workspace.ts`

- `SessionItem`
  - 저장되는 세션 메타데이터입니다.
  - `kind`: `ssh`, `sftp`, `rdp`, `local`, `ftp`, `docker`, `wsl` 등.
  - `credentialRef`만 저장하고 secret은 저장하지 않습니다.
- `WorkspacePanel`
  - 실제 탭/패널을 열 때 사용하는 런타임 모델입니다.
- `WorkspaceTabItem`
  - 사이드바/Open Tabs/컨텍스트 메뉴에서 사용하는 탭 요약 모델입니다.
- `AiPanelBinding`
  - bound AI 패널이 어떤 원본 탭에 묶였는지 설명합니다.

## Frontend 모듈 지도

### Workspace

위치: `src/features/workspace/**`

- `Workspace.tsx`: FlexLayout 렌더링, 탭 메뉴, 활성 탭 포커스, 연결 상태.
- `workspaceLayout.ts`: 저장 레이아웃 load/save, 기본 레이아웃.
- `workspaceLayoutActions.ts`: 탭 선택/닫기/이동 정책.
- `workspaceTabs.tsx`: 탭 타이틀, 상태 dot, identity badge, middle-click close.
- `WorkspaceTabMenu.tsx`: 탭 우클릭 메뉴.
- `workspaceTabCollection.ts`: Open Tabs/SFTP 사이드바용 탭 수집.
- `boundAiWorkspace.ts`: bound AI panel id/title/binding 생성.

주의:

- 탭 메뉴에서 session panel별 reconnect/disconnect 라우팅이 다릅니다.
  - Terminal: `terminalLifecycle.ts`
  - SFTP: `sftpSidebarState.ts`
  - RDP: `rdpPanelLifecycle.ts`
- workspace 코드는 여러 기능을 묶는 통합 지점입니다. 기능 작업 중에는 필요한 라우팅/포커스 변경만 좁게 수정합니다.

### Panels

위치: `src/features/panels/**`

- `PanelBody.tsx`: 패널 타입을 실제 컴포넌트로 라우팅.
- `PanelSurfaces.tsx`: 공통 frame/placeholder/log panel surface.
- `panelCatalog.ts`: 기본 패널 카탈로그.

### Terminal / SSH / Local PTY

위치:

- Frontend: `src/features/terminal/**`
- Backend: `src-tauri/src/commands/ssh.rs`, `src-tauri/src/commands/local_pty.rs`

주요 파일:

- `SshTerminal.tsx`: SSH 터미널 UI.
- `LocalPtyTerminal.tsx`: 로컬 셸 터미널 UI.
- `useSshTerminalLifecycle.ts`, `useLocalPtyLifecycle.ts`: Tauri 이벤트 구독, xterm 연결.
- `terminalLifecycle.ts`: 탭/사이드바 reconnect/disconnect 요청 bus.
- `terminalRegistry.ts`: 활성 탭 전환 시 xterm focus를 위한 registry.
- `sshTerminalBridge.ts`, `localPtyBridge.ts`: Tauri invoke/listen 경계.

이벤트:

- SSH: `shellpilot-ssh-terminal`
- Local PTY: `shellpilot-local-pty`

### SFTP

위치:

- Frontend: `src/features/sftp/**`
- Backend: `src-tauri/src/commands/sftp.rs`

주요 파일:

- `SftpPanel.tsx`: 탐색기 화면의 조정자.
- `SftpFileTable.tsx`: 원격 파일 grid.
- `SftpCommanderView.tsx`, `SftpCommanderPane.tsx`: Local/Remote 2-pane Commander.
- `useSftpBrowserLifecycle.ts`: open/list/keepalive/close 흐름.
- `useSftpTransfers.ts`: backend 전송 이벤트를 panel/global store에 반영.
- `sftpTransferStore.ts`, `sftpTransferScheduler.ts`: 전송 상태와 동시성, pause/resume, retry/restart scheduling.
- `sftpSidebarState.ts`: SFTP 사이드바, 경로 이동, reconnect/disconnect 요청.
- `sftpBridge.ts`: Tauri command/event 경계.
- `SftpTransferQueuePanel.tsx`: 하단 transfer queue.

이벤트:

- 전송 이벤트: `shellpilot-sftp-transfer`
- 프론트 내부 사이드바 이벤트: `shellpilot:sftp-sidebar-state`, `shellpilot:sftp-navigate`, `shellpilot:sftp-reconnect`, `shellpilot:sftp-disconnect`

자세한 내용은 `docs/sftp-handoff.md`.

### RDP

위치:

- Frontend: `src/features/rdp/**`
- Tauri backend: `src-tauri/src/commands/rdp.rs`
- Sidecar: `src-tauri/rdp-sidecar/**`

주요 파일:

- `RdpPanel.tsx`: RDP 패널 상태/연결/렌더링/메뉴 통합.
- `RdpPanelHeader.tsx`, `RdpDisplayMenu.tsx`: 반응형 헤더와 display submenu.
- `useRdpFrameRenderer.ts`: canvas frame drawing, FPS/network stats.
- `useRdpInputHandlers.ts`: 마우스/키보드/wheel/clipboard paste 입력.
- `useRdpViewportSize.ts`: panel resize 측정.
- `rdpBridge.ts`: Tauri command/event 경계.
- `rdpPanelLifecycle.ts`: 탭 메뉴/사이드바에서 RDP reconnect/disconnect 요청을 전달하는 bus.
- `rdpDisplayOptions.ts`: 원본/fit, 해상도, 이미지 품질 옵션.
- `rdpScancodes.ts`: 키보드 scancode mapping.

이벤트:

- 상태: `shellpilot-rdp`
- frame: `shellpilot-rdp-frame`
- remote cursor: `shellpilot-rdp-cursor`
- clipboard: `shellpilot-rdp-clipboard`

RDP는 현재 동결 영역입니다. 현재 동작은 `docs/rdp-handoff.md`, 과거 결정 로그는 `docs/rdp-design.md`를 참고합니다.

### VNC

위치:

- Frontend: `src/features/vnc/**`
- Tauri backend: `src-tauri/src/commands/vnc.rs`
- Sidecar: `src-tauri/vnc-sidecar/**`

`VncPanel.tsx`가 canvas와 입력을 관리하고, Tauri backend가 `panelId`별 sidecar lifecycle을 소유합니다. VNC는 현재 동결 영역이며, MVP 구조와 알려진 제한은 `docs/vnc-design.md`를 참고합니다.

### AI

위치:

- Frontend: `src/features/ai/**`
- Backend: `src-tauri/src/commands/ai.rs`
- SSH read-only executor: `src-tauri/src/commands/ssh.rs`

주요 파일:

- `AiAssistantPanel.tsx`: 일반 AI 패널.
- `BoundAiPanel.tsx`: 특정 SSH/SFTP 탭에 묶인 AI 패널.
- `useBoundAiChat.ts`: bound context 수집, tool routing, streaming.
- `aiToolRouter.ts`: read-only intent catalog와 fixed recipe 조립.
- `aiTerminalTarget.ts`: terminal context 수집.
- `aiBridge.ts`: Tauri AI command/event 경계.

이벤트:

- AI stream: `shellpilot-ai-prompt`

AI Assistant는 현재 동결 영역입니다. 읽기 전용 도구 계층은 유지하지만 mutating approval gate와 기능 확장은 보류합니다. 자세한 내용은 `docs/ai-tool-layer-design.md`.

### Notes

위치:

- Frontend: `src/features/notes/**`
- Backend: `src-tauri/src/commands/notes.rs`

주요 파일:

- `NotesSidebar.tsx`: 폴더/노트 트리, 검색, 태그, 생성·이름 변경·삭제·이동.
- `NotesPanel.tsx`: 노트 읽기, debounce 저장, pending save flush, 보기 모드.
- `NotesMarkdownEditor.tsx`: CodeMirror 편집기, preview, wiki link와 첨부 interaction.
- `notesBridge.ts`: Tauri command 경계.
- `notesNavigation.ts`: 열린 노트 이동과 Notes 변경 이벤트.

Notes는 현재 활성 개발 영역입니다. 진행 중인 기능 변경을 안정화한 뒤 backend의 storage/index/link/assets/command 경계를 분리하는 방향을 검토합니다. 자세한 내용은 `docs/notes-design.md`.

### Sessions / Credentials

위치:

- Frontend: `src/features/sessions/**`
- Backend: `src-tauri/src/commands/sessions.rs`, `src-tauri/src/commands/credentials.rs`

주요 파일:

- `useSessionRegistry.ts`: 세션 CRUD, 저장, DnD 이동, credential cleanup.
- `sessionStorage.ts`: Tauri registry 저장과 local fallback.
- `sessionForm.ts`: 폼 입력을 `SessionItem`과 pending credential payload로 변환.
- `credentialStore.ts`: credential save/delete bridge.
- `components/SessionTree.tsx`, `components/SessionsView.tsx`: 세션 UI.

보안 원칙:

- session registry에는 secret을 저장하지 않습니다.
- password/passphrase는 Tauri credential command를 통해 저장/조회합니다.
- SSH/SFTP는 credential을 사용할 때 session id, credential ref, host, port, username binding을 backend에서 다시 검증합니다.
- RDP/VNC credential binding은 같은 수준으로 확장하기 전까지 남은 보안 고도화 항목이며, 두 기능은 현재 동결 상태입니다.
- 세션 복제 시 credential ref 복사는 기본적으로 신중하게 다룹니다.

### Settings

위치: `src/features/settings/**`

- `SettingsPanel.tsx`: Settings 화면.
- `KnownHostsSettings.tsx`: SSH known_hosts 조회/삭제.
- `windowState.ts`: 창 상태 저장.
- `appPreferences.ts`: 앱 선호 설정.

### Shared UI / Styles

위치:

- `src/components/ui/**`
- `src/styles/**`

중요 규칙:

- 인앱 scrollable 영역은 native scrollbar를 그대로 노출하지 말고 공통 `OverlayScrollArea` 또는 `app-scrollbar` 스타일을 사용합니다.
- 터미널은 xterm.js 자체 viewport와 ShellPilot wrapper 스타일이 얽혀 있으므로 padding/overflow 변경 시 실제 포커스와 fit 동작을 확인합니다.
- FlexLayout 스타일은 `src/styles/flexlayout.css`에 집중되어 있습니다.

## Backend command 지도

위치: `src-tauri/src/commands/**`

- `ssh.rs`
  - SSH shell open/write/resize/close
  - known_hosts TOFU/mismatch 처리
  - SSH agent 연동
  - AI read-only command executor
- `sftp.rs`
  - SFTP open/list/keepalive/close
  - mkdir/rename/remove
  - upload/download/stream upload
  - transfer progress event
  - temp/backup 기반 안전한 교체, pause/resume, 조건부 이어받기
- `rdp.rs`
  - RDP open/close/input
  - sidecar process lifecycle
  - TLS fingerprint trust store
  - clipboard integration
  - Windows key capture
- `vnc.rs`
  - VNC open/close/input
  - sidecar process lifecycle와 framebuffer event
- `notes.rs`
  - Notes index/content/assets 저장
  - 검색, wiki link/heading/tag/mention index 갱신
- `local_pty.rs`
  - local PTY open/write/resize/close
  - elevated local terminal launcher
- `ai.rs`
  - provider list
  - prompt run/stream/cancel
- `sessions.rs`
  - session registry load/save
- `credentials.rs`
  - OS credential store wrapper

Tauri command 등록은 `src-tauri/src/lib.rs`의 `invoke_handler`를 확인합니다.

## Cross-cutting 상태와 이벤트

### 연결 상태

위치: `src/features/connections/connectionStatus.ts`

- SSH/SFTP/RDP 패널은 연결 상태를 publish합니다.
- Workspace tab renderer와 sidebar는 상태를 구독해 dot/badge를 표시합니다.
- 신규 구독자에게 현재 상태를 replay하는 구조입니다.

### 탭 reconnect/disconnect

기능별로 실제 lifecycle owner가 다릅니다.

- Terminal: `notifyTerminalReconnect`, `notifyTerminalDisconnect`
- SFTP: `requestSftpSidebarReconnect`, `requestSftpSidebarDisconnect`
- RDP: `requestRdpReconnect`, `requestRdpDisconnect`

Workspace 탭 메뉴는 `panelType`을 보고 맞는 bus로 라우팅해야 합니다.

Open Tabs 사이드바도 같은 규칙을 사용합니다.

- SSH terminal은 terminal lifecycle bus로 reconnect/disconnect합니다.
- SFTP는 SFTP sidebar state bus로 reconnect/disconnect합니다.
- RDP는 RDP panel lifecycle bus로 reconnect/disconnect합니다.
- Local PTY terminal은 아직 reconnect/disconnect lifecycle이 없으므로 close/reopen 방식만 사용합니다.

### 포커스

- `Workspace.tsx`는 활성 탭 변경 시 `focusRegisteredTerminal(panelId)`를 호출합니다.
- SSH/Local PTY 터미널은 `terminalRegistry.ts`에 focus handler를 등록합니다.
- RDP는 canvas focus를 panel pointer down과 input handler에서 관리합니다.

## 검증 기준

작업 후 관련 체크를 우선 실행합니다.

| 변경 범위 | 권장 체크 |
| --- | --- |
| React/TypeScript/UI | `npm run build` |
| Tauri backend | `cargo check --manifest-path src-tauri\Cargo.toml` |
| Notes | `npm run build`, `cargo check --manifest-path src-tauri\Cargo.toml` |
| SFTP | `npm run build`, `cargo check --manifest-path src-tauri\Cargo.toml` |
| RDP sidecar | `cargo check --manifest-path src-tauri\rdp-sidecar\Cargo.toml` |
| release/package | `npm run tauri:build` 또는 `npm run release:win:*` |

RDP sidecar check가 `target` 쓰기 권한으로 실패하면 코드 문제가 아닐 수 있습니다. 해당 경우 동일 명령을 권한 상승으로 재시도합니다.

## 현재 유지보수 주의점

- 커밋/푸시는 사용자가 명시적으로 요청할 때만 합니다.
- dirty worktree가 기본 상태일 수 있으므로 사용자 변경을 되돌리지 않습니다.
- SSH/SFTP/Notes/settings/workspace는 공통 session·credential·panel 흐름을 공유합니다. 기능별 작업 중 공통 통합 지점을 수정할 수는 있지만, 목적 없는 정리는 피합니다.
- RDP/VNC/AI는 동결 영역입니다. 활성 기능 작업과 함께 리팩터링하지 않습니다.
- SFTP 문서는 과거 인코딩 깨짐이 있었으므로 UTF-8로 유지합니다.
- `rdp.rs`와 `rdp-sidecar/src/main.rs`의 message/input enum은 서로 맞춰야 합니다.

## 권장 새 작업 시작 순서

1. `git status --short`
2. 관련 문서 확인
   - 전체 구조: 이 문서
   - 현재 범위: `maintenance-status.md`
   - 활성 기능: `ssh-handoff.md`, `sftp-handoff.md`, `notes-design.md`
3. 코드 심볼과 호출 관계는 codebase knowledge graph를 우선 사용하고, 문자열·설정·비코드 파일은 `rg`로 찾기
4. 작은 동작 단위로 수정
5. 관련 check 실행
6. 변경 파일과 check 결과 보고
