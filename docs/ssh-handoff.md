# SSH 현행 인계

이 문서는 SSH/로컬 터미널 영역을 새 스레드에서 바로 이어받기 위한 기준선입니다. ShellPilot의 터미널 작업은 `src/features/terminal/**`, `src/features/settings/**`, `src-tauri/src/commands/ssh.rs`, `src-tauri/src/commands/ssh/**`, `src-tauri/src/commands/local_pty.rs`가 중심입니다.

## 현재 구현 상태

- SSH 세션은 Tauri command `ssh_open_shell`로 열고, `ssh_write`, `ssh_resize`, `ssh_close`로 입출력과 크기 변경을 제어합니다.
- 프론트엔드는 xterm.js를 사용합니다. 패널 크기가 변하면 `FitAddon`으로 터미널 행/열을 다시 계산하고 백엔드 PTY에 resize를 전달합니다.
- SSH host key는 앱 데이터 디렉터리의 `known_hosts.json`에 저장합니다. 신규 키는 사용자가 확인 후 신뢰해야 하며, mismatch는 차단성 오류로 다룹니다.
- 인증 방식은 password, keyboard-interactive, private key/passphrase, SSH agent를 지원합니다.
- 비밀번호/passphrase는 세션 JSON에 저장하지 않고 OS credential store를 통해 저장/조회합니다.
- renderer에서 secret을 직접 조회하던 `get_credential` command는 제거되었습니다. 저장된 secret 조회는 SSH/RDP/VNC 등 백엔드 인증 흐름 안에서만 수행합니다.
- Workspace 탭/사이드바의 reconnect/disconnect 요청은 `terminalLifecycle.ts`의 작은 이벤트 버스를 통해 실제 터미널 패널로 전달됩니다.
- 활성 패널 전환 시 SSH/Local PTY 공통 hook `useActiveTerminalFocus.ts`를 통해 xterm focus를 맞춥니다.
- 선택 텍스트 자동 복사는 설정값 `terminal.autoCopySelection`으로 제어하며 기본값은 off입니다. 명시적 복사 단축키와 컨텍스트 메뉴 복사는 유지합니다.

## 주요 파일 지도

### Frontend

- `src/features/terminal/SshTerminal.tsx`
  - SSH 패널 최상위 UI입니다.
  - xterm container, overlay 상태 카드, 우클릭 메뉴, SFTP 열기 버튼을 묶습니다.
- `src/features/terminal/useSshTerminalLifecycle.ts`
  - xterm 생성/폐기, Tauri event listen, resize observer, open/close lifecycle을 담당합니다.
  - `terminalPerformance.ts`의 write buffer와 fit scheduler를 사용합니다.
- `src/features/terminal/useLocalPtyLifecycle.ts`
  - Local PTY용 xterm lifecycle입니다.
  - SSH와 동일한 write buffer/fit scheduler 패턴을 사용합니다.
- `src/features/terminal/useSshTerminalActions.ts`
  - reconnect, disconnect, typed password retry, host key trust/reset 액션을 담당합니다.
- `src/features/terminal/useActiveTerminalFocus.ts`
  - SSH/Local PTY active panel focus 복구 공통 hook입니다.
- `src/features/terminal/terminalPerformance.ts`
  - xterm write batching과 fit request coalescing 유틸입니다.
- `src/features/terminal/sshTerminalBridge.ts`
  - Tauri invoke 경계입니다.
  - credential ref 해석과 open target 조립이 여기에 있습니다.
  - 중복 resize invoke를 줄이기 위해 panel별 마지막 PTY 크기를 기억합니다.
- `src/features/terminal/localPtyBridge.ts`
  - Local PTY Tauri invoke 경계입니다.
  - SSH와 동일하게 중복 resize invoke를 줄입니다.
- `src/features/terminal/sshTerminalEventHandler.ts`
  - 백엔드 이벤트를 xterm 출력/상태 카드/credential 저장으로 변환합니다.
  - 상태 전환 전에는 pending write buffer를 flush합니다.
- `src/features/terminal/sshTerminalInput.ts`
  - SSH xterm 입력, 복사/붙여넣기 단축키, 선택 텍스트 자동 복사 설정을 처리합니다.
- `src/features/terminal/localPtyInput.ts`
  - Local PTY xterm 입력과 선택 텍스트 자동 복사 설정을 처리합니다.
- `src/features/terminal/terminalDiagnosticsHighlighter.ts`
  - 터미널 출력에서 진단 패턴을 찾아 decoration을 표시합니다.
  - write/render 연속 발생 시 스캔을 throttle하고, scroll/resize는 즉시 반영합니다.
- `src/features/terminal/SshTerminalStatusCards.tsx`
  - disconnected/restored/failure overlay UI입니다.
- `src/features/terminal/terminalLifecycle.ts`
  - Workspace/Open Tabs/탭 메뉴에서 들어오는 터미널 reconnect/disconnect/closing 이벤트 버스입니다.
- `src/features/terminal/terminalRegistry.ts`
  - 활성 패널 전환 시 xterm focus를 복구하기 위한 registry입니다.
- `src/features/terminal/LocalPtyTerminal.tsx`
  - 로컬 터미널입니다. SSH와 xterm 기반 구조를 공유하지만 Tauri command는 `local_pty.rs`를 사용합니다.
- `src/features/settings/appPreferences.ts`
  - `terminal.autoCopySelection` 기본값과 정규화를 담당합니다.
- `src/features/settings/SettingsPanel.tsx`
  - Terminal 설정에서 Auto-copy selection 토글을 제공합니다.

### Backend

- `src-tauri/src/commands/ssh.rs`
  - Tauri command wrapper와 SSH probe/connect 공통 흐름을 담당합니다.
  - host key verification callback과 module re-export를 유지합니다.
- `src-tauri/src/commands/ssh/auth.rs`
  - `SshAuthRequest`, credential resolve, password/key/agent/keyboard-interactive 인증을 담당합니다.
- `src-tauri/src/commands/ssh/errors.rs`
  - connect/auth failure classification을 담당합니다.
  - 분류 테스트가 이 파일에 있습니다.
- `src-tauri/src/commands/ssh/exec.rs`
  - AI read-only command executor인 `ssh_run_readonly_commands`의 내부 실행을 담당합니다.
- `src-tauri/src/commands/ssh/known_hosts.rs`
  - known host load/save/verify/trust/reset/list를 담당합니다.
  - 저장 시 tmp 파일 작성, 기존 파일 백업, atomic replace를 사용합니다.
  - Unix 계열에서는 파일 권한을 `0600`으로 맞춥니다.
- `src-tauri/src/commands/ssh/shell.rs`
  - SSH shell session store, open/write/resize/close, shell event loop를 담당합니다.
  - SSH stdout/stderr data event를 짧은 주기로 batching합니다.
- `src-tauri/src/commands/local_pty.rs`
  - 로컬 PTY session lifecycle을 담당합니다.
  - Local PTY output도 SSH와 유사하게 batching합니다.
- `src-tauri/src/commands/credentials.rs`
  - credential 저장/삭제와 백엔드 내부 secret 조회 helper를 담당합니다.
  - renderer-facing `get_credential` command는 더 이상 노출하지 않습니다.

## 현재 동작 기준

SSH 연결 흐름:

1. `SshTerminal` mount
2. `useSshTerminalLifecycle`가 xterm 생성 후 Tauri event listener 등록
3. listener 준비 후 `openSshShell(panelId, session)` 호출
4. 백엔드 `ssh_open_shell`이 기존 panel session을 닫고 새 task를 spawn
5. 백엔드가 `shellpilot-ssh-terminal` 이벤트로 info/warning/connected/data/failed/closed 전달
6. 프론트 `sshTerminalEventHandler`가 상태 카드와 xterm 출력을 갱신
7. data 이벤트는 프론트 write buffer를 거쳐 xterm에 쓰입니다.

Reconnect 흐름:

- UI나 Open Tabs/탭 메뉴에서 reconnect 요청
- `notifyTerminalReconnect(panelId)`
- 현재 패널이 구독 중이면 `useSshTerminalActions.reconnectSession()` 실행
- 아직 패널 listener가 없으면 `terminalLifecycle.ts`가 pending reconnect로 보관했다가 구독 시 전달

Disconnect 흐름:

- UI나 Open Tabs/탭 메뉴에서 disconnect 요청
- `notifyTerminalDisconnect(panelId)`
- 해당 SSH 패널이 `closeSshShell(panelId)` 호출 후 closed overlay로 전환

Resize 흐름:

- container resize 또는 lifecycle 이벤트에서 fit request 발생
- `terminalPerformance.ts`의 fit scheduler가 같은 frame의 요청을 합칩니다.
- 계산된 cols/rows가 직전 성공값과 같으면 bridge에서 resize invoke를 생략합니다.
- open/close 시 panel별 resize cache는 초기화합니다.

## 완료된 SSH/터미널 개선

구조 분리:

- `ssh.rs`의 known hosts, errors, auth, read-only exec, shell loop를 기능 단위 module로 분리했습니다.
- `ssh.rs`는 Tauri command wrapper와 probe/connect 공통 흐름 중심으로 축소했습니다.
- SFTP 등 기존 호출부 호환을 위해 필요한 SSH type은 re-export합니다.

성능:

- SSH data event를 12ms 또는 32KB 기준으로 batching합니다.
- Local PTY output event도 동일한 방향으로 batching합니다.
- 프론트 xterm write도 write buffer를 통해 한 번 더 coalescing합니다.
- `FitAddon.fit()` 호출은 scheduler로 묶고, 백엔드 resize invoke는 동일 크기 반복을 생략합니다.
- diagnostics highlighter는 write/render 연속 이벤트에서 스캔을 throttle합니다.

보안:

- renderer-facing `get_credential` command를 제거해 secret 반환 표면을 줄였습니다.
- 선택 텍스트 자동 복사는 기본 off 설정으로 전환했습니다.
- known hosts 저장은 tmp/backup/replace 흐름과 Unix `0600` 권한을 사용합니다.

## 보안/안정화 주의점

- password/passphrase/interactive response는 로그나 터미널 출력에 직접 쓰면 안 됩니다.
- host key unknown은 사용자가 fingerprint를 확인하고 Trust해야 합니다. 자동 신뢰는 명시 요청 없이 넣지 않습니다.
- host key mismatch는 일반 reconnect로 풀면 안 됩니다. 사용자가 Reset Host Key를 선택해야 합니다.
- macOS Keychain은 실행 환경에 따라 `User interaction is not allowed`가 날 수 있습니다. 이 경우 저장된 secret을 읽지 못한 것이므로 사용자에게 다시 입력을 요구해야 합니다.
- `ssh.rs`와 `ssh/**`의 에러 메시지는 사용자에게 노출되므로 민감정보가 포함되지 않도록 유지합니다.
- `ssh_run_readonly_commands`는 AI용 read-only executor입니다. SSH 작업 중 AI 영역까지 동작을 바꾸지 않도록 주의합니다.
- credential save/delete command는 남아 있습니다. renderer가 임의 credential id를 조작하는 시나리오는 별도 점검 후보입니다.
- clipboard는 OS 전역 자원이므로 자동 복사 기능은 계속 기본 off로 유지하는 것이 안전합니다.

## 현재 리스크와 다음 작업

우선순위 높은 항목:

1. SSH/Local PTY 수동 검증
   - 실제 서버 접속과 장시간 출력은 자동 빌드로 확인하기 어렵습니다.
   - 사용 중 발견되는 끊김, 출력 누락, resize 문제를 로그 기준으로 좁히는 방식이 현실적입니다.
2. credential save/delete 권한 경계 재검토
   - secret 조회 command는 제거됐지만 저장/삭제 command는 renderer에 남아 있습니다.
   - credential id namespace, 세션 소유권, 삭제 범위를 점검합니다.
3. known_hosts UX 보강
   - mismatch/unknown 화면에서 fingerprint copy, 파일 위치 표시, 백업 존재 여부 안내를 개선할 수 있습니다.
4. SSH agent UX 보강
   - agent 없음/identity 없음/signing 실패 메시지가 현재보다 명확한지 확인합니다.
5. diagnostics highlighter 안전장치 검토
   - 현재는 throttle 중심입니다.
   - 매우 긴 라인, decoration 최대 개수 제한은 실제 사용 중 병목이 보이면 추가합니다.

낮은 우선순위:

- SSH 연결 상태 배지/탭 색상 정책을 SSH/SFTP/RDP/VNC와 맞추기
- private key path 선택 UX 개선
- known_hosts 설정 화면에서 fingerprint copy/action 보강
- dev-only terminal performance counters 추가
- `createXtermTerminal` scrollback 기본값을 실제 사용량 기준으로 재조정

## 검증 기준

프론트/문서 변경:

```powershell
npm run build
```

Tauri SSH backend 변경:

```powershell
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml classify_
```

SSH 동작 수동 확인:

- password 세션 신규 접속
- 저장된 password로 재접속
- private key/passphrase 세션 접속
- SSH agent 세션 접속
- host key unknown Trust 후 접속
- host key Reset 후 재접속
- host key mismatch 차단 확인
- 탭 전환 후 터미널 입력 focus
- 패널 resize 후 PTY 행/열 변경
- 탭/Open Tabs 우클릭 reconnect/disconnect
- 대량 출력 명령에서 출력 누락/순서 꼬임 없음
- SSH 세션에서 SFTP 열기

Local PTY 동작 수동 확인:

- 새 Local PTY 열기
- 입력/붙여넣기/명시적 복사
- Auto-copy selection off 기본값 확인
- Auto-copy selection on 설정 시 선택 복사 확인
- 대량 출력 명령에서 출력 누락/순서 꼬임 없음
- 패널 resize 후 PTY 행/열 변경

최근 확인된 자동 검증:

- `npm run build`
- `cargo fmt --manifest-path src-tauri\Cargo.toml --check`
- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml classify_`
