# ShellPilot

ShellPilot은 SSH 중심의 원격 작업을 하나의 데스크톱 워크스페이스에서 관리하기 위한 Tauri 기반 애플리케이션입니다.

현재 구현은 세션 그룹 관리, 보안 credential 저장, SSH 터미널, 분할 워크스페이스, 탭 조작, 드래그 앤 드롭 UX를 중심으로 구성되어 있습니다.

## 주요 기능

- Rust `russh` 기반 SSH 터미널 접속
- 비밀번호 인증 및 SSH Private Key 인증
- Tauri 백엔드 credential store를 통한 비밀번호/passphrase 보안 저장
- 백엔드 세션 레지스트리 저장 및 로컬 fallback
- 그룹 접기/펼치기, 그룹 선택 표시, 컨텍스트 메뉴, 그룹/세션 드래그 앤 드롭
- 그룹 내부 세션 순서 변경 및 그룹 간 세션 이동
- FlexLayout 기반 워크스페이스 탭/분할 레이아웃
- 탭 드래그로 좌/우/상/하/중앙 분할
- 탭 우클릭 메뉴: Clone, Duplicate, Reconnect, Copy Host, Copy SSH Command, Close 계열 액션
- xterm.js 기반 고대비 다크 터미널 테마
- Tauri dialog 기반 SSH private key 파일 선택

## 보안 정책

ShellPilot은 접속 메타데이터와 secret material을 분리해서 관리합니다.

- 세션 데이터에는 host, port, username, tag, group, auth method, credential reference만 저장합니다.
- 비밀번호와 SSH key passphrase는 session JSON이나 localStorage에 저장하지 않습니다.
- secret은 Tauri 백엔드 credential command를 통해 저장/조회합니다.
- 세션 삭제 또는 인증 정보 변경 시 가능한 범위에서 고아 credential을 정리합니다.
- 세션 복제 시 credential reference는 기본적으로 복사하지 않습니다.

## 기술 스택

### Frontend

- React
- TypeScript
- Tailwind CSS
- Radix UI
- Lucide Icons
- FlexLayout
- xterm.js
- dnd-kit

### Desktop / Backend

- Tauri 2
- Rust
- Tokio
- russh
- keyring

## 개발 환경

필수 도구:

- Node.js 20+
- Rust 및 Cargo
- WebView2 Runtime

의존성 설치:

```bash
npm install
```

프론트엔드만 실행:

```bash
npm run dev
```

Tauri 앱 실행:

```bash
npm run tauri:dev
```

프론트엔드 빌드:

```bash
npm run build
```

Tauri 앱 빌드:

```bash
npm run tauri:build
```

Tauri 관련 npm script는 `scripts/tauri-with-rust-path.ps1` 래퍼를 통해 실행됩니다. 이 스크립트는 `node_modules/.bin`과 `%USERPROFILE%\.cargo\bin`을 PATH에 추가한 뒤 Tauri를 실행합니다. Cargo가 설치되어 있어도 현재 셸 PATH에서 보이지 않아 `cargo metadata`가 실패하는 문제를 피하기 위한 처리입니다.

## 프로젝트 구조

```text
src/
  components/
    navigation/
    shell/
    ui/
  features/
    connections/
    panels/
    sessions/
    terminal/
    workspace/
  styles/
  types/

src-tauri/
  capabilities/
  src/
    commands/

scripts/
  tauri-with-rust-path.ps1
```

## 구현 메모

- `src/features/sessions/useSessionRegistry.ts`
  - 세션 CRUD, 세션 저장, 그룹/세션 이동, credential cleanup을 담당합니다.
- `src/features/sessions/components/SessionTree.tsx`
  - 세션 트리 UI를 렌더링합니다.
- `src/features/sessions/components/sessionTreeDnd.ts`
  - 세션 트리 DnD id, drag item 파싱, drop 위치 계산을 담당합니다.
- `src/features/sessions/sessionForm.ts`
  - 세션 생성/수정 폼 입력을 `SessionItem`과 pending credential payload로 변환합니다.
- `src/features/terminal/sshTerminalBridge.ts`
  - xterm 컴포넌트와 Tauri SSH command 호출을 분리합니다.
- `src/features/workspace/workspaceLayoutActions.ts`
  - FlexLayout 탭 선택, 이동, 닫기 정책을 담당합니다.
- `src/features/workspace/WorkspaceTabMenu.tsx`
  - 워크스페이스 탭 우클릭 메뉴를 렌더링합니다.

## 현재 지원 상태

### 구현됨

- SSH password 인증
- SSH private key 인증
- key passphrase 저장
- 세션/그룹 저장
- 세션/그룹 드래그 앤 드롭
- 워크스페이스 탭 분할
- 탭 clone/duplicate/reconnect/close 메뉴
- private key 파일 선택 dialog
- Windows Cargo PATH 래퍼

### 예정

- SSH Agent 인증
- SSH key validation 및 오류 메시지 개선
- 세션 import/export
- 워크스페이스 layout reset/preset
- 테마 토큰 정리 및 light/high-contrast 테마 확장
- SFTP 브라우저
- RDP 패널
- 로컬 터미널 profile
- AI assistant 패널

## 라이선스

MIT License
