# ShellPilot

ShellPilot은 SSH 중심의 원격 작업을 하나의 데스크톱 워크스페이스에서 관리하기 위한 Tauri 기반 애플리케이션입니다.

현재 구현은 세션 그룹 관리, 보안 credential 저장, SSH 터미널, SFTP 원격 탐색기/전송, 분할 워크스페이스, 탭 조작, 드래그 앤 드롭 UX를 중심으로 구성되어 있습니다.

## 주요 기능

- Rust `russh` 기반 SSH 터미널 접속
- 비밀번호 인증 및 SSH Private Key 인증
- SSH Agent 인증(OpenSSH Agent/Pageant)
- Tauri 백엔드 credential store를 통한 비밀번호/passphrase 보안 저장
- username/password 누락 시 터미널 패널 내부 입력 카드 제공
- SSH known_hosts 저장, 조회, 삭제 및 host key 변경 감지
- 백엔드 세션 레지스트리 저장 및 로컬 fallback
- 그룹 접기/펼치기, 그룹 선택 표시, 컨텍스트 메뉴, 그룹/세션 드래그 앤 드롭
- 그룹 내부 세션 순서 변경 및 그룹 간 세션 이동
- FlexLayout 기반 워크스페이스 탭/분할 레이아웃
- 탭 드래그로 좌/우/상/하/중앙 분할
- 탭 우클릭 메뉴: Clone, Duplicate, Reconnect, Copy Host, Copy SSH Command, Close 계열 액션
- xterm.js 기반 고대비 다크 터미널 테마
- Tauri dialog 기반 SSH private key 파일 선택
- SSH 세션 기반 SFTP 탭 열기
- SFTP 원격 파일 탐색, 경로 이동, 정렬, 다중 선택, 키보드 탐색
- 원격 폴더 생성, 이름 변경, 파일/폴더 삭제
- 파일/폴더 업로드 및 다운로드
- 드래그 앤 드롭 파일/폴더 업로드
- 전송 충돌 처리: 덮어쓰기, 모두 덮어쓰기, 건너뛰기, 모두 건너뛰기, 취소
- 전송 큐, 진행률, 속도/ETA, 취소, 실패 재시도, 완료 항목 정리
- 다운로드 완료 항목의 로컬 폴더 열기
- SFTP 전송 중 temp/backup 기반 안전한 파일 교체

## 보안 정책

ShellPilot은 접속 메타데이터와 secret material을 분리해서 관리합니다.

- 세션 데이터에는 host, port, username, tag, group, auth method, credential reference만 저장합니다.
- 비밀번호와 SSH key passphrase는 session JSON이나 localStorage에 저장하지 않습니다.
- secret은 Tauri 백엔드 credential command를 통해 저장/조회합니다.
- SSH host key는 앱 로컬 데이터 디렉터리의 known_hosts 저장소에서 관리합니다.
- 최초 접속 호스트는 fingerprint 확인 후 신뢰 저장하며, 변경된 host key는 차단합니다.
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
- russh-sftp
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
    sftp/
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
- `src/features/sftp/SftpPanel.tsx`
  - SFTP 원격 탐색기, 경로 이동, 다중 선택, 업로드/다운로드, 전송 큐 UI를 담당합니다.
- `src/features/sftp/sftpBridge.ts`
  - SFTP Tauri command와 프론트엔드 호출부를 분리합니다.
- `src-tauri/src/commands/ssh.rs`
  - SSH 접속, 인증, PTY I/O, known_hosts 검증 및 SSH Agent 연동을 담당합니다.
- `src-tauri/src/commands/sftp.rs`
  - SFTP 연결, 원격 파일 작업, 재귀 업로드/다운로드, 진행률 이벤트, 안전한 temp/backup 교체를 담당합니다.
- `src/features/workspace/workspaceLayoutActions.ts`
  - FlexLayout 탭 선택, 이동, 닫기 정책을 담당합니다.
- `src/features/workspace/WorkspaceTabMenu.tsx`
  - 워크스페이스 탭 우클릭 메뉴를 렌더링합니다.

## 설계 문서

- [SFTP 구현 설계](docs/sftp-design.md)

## 현재 지원 상태

### 구현됨

- SSH password 인증
- SSH private key 인증
- SSH Agent 인증
- key passphrase 저장
- username/password 입력 프롬프트 및 저장
- known_hosts 기반 host key 검증
- unknown host key 승인 후 재접속
- host key mismatch 차단 및 신뢰 초기화
- SSH 접속 실패 메시지 분류
- 세션/그룹 저장
- 세션/그룹 드래그 앤 드롭
- 워크스페이스 탭 분할
- 탭 clone/duplicate/reconnect/close 메뉴
- Settings 탭 기반 SSH Known Hosts 관리
- private key 파일 선택 dialog
- Windows Cargo PATH 래퍼
- SSH 탭에서 SFTP 탭 열기
- SFTP 원격 파일 목록 조회 및 경로 이동
- breadcrumb 경로 편집, 복사, 키보드 단축키
- SFTP 그리드 정렬, 컬럼 리사이즈, 반응형 컬럼 표시
- 다중 선택, 범위 선택, Ctrl+A 전체 선택
- 원격 폴더 생성, 이름 변경, 삭제
- 파일/폴더 업로드, 드래그 앤 드롭 업로드
- 파일/폴더 다운로드
- 전송 큐, 진행률, 속도/ETA, 취소, 재시도, 완료 항목 정리
- 다운로드 완료 후 로컬 폴더 열기
- 파일 충돌 처리 및 안전한 temp/backup 교체
- 잔여 temp/backup 파일 감지 및 정리

### 예정

- SSH key validation 추가 고도화
- 세션 import/export
- 워크스페이스 layout reset/preset
- 테마 토큰 정리 및 light/high-contrast 테마 확장
- SFTP Commander 모드
- SFTP pinned/recent remote paths
- SFTP 전송 일시정지/이어받기
- RDP 패널
- 로컬 터미널 profile
- AI assistant 패널

## 라이선스

MIT License
