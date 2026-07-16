<div align="center">

# ShellPilot

**SSH · SFTP · RDP · VNC를 하나의 데스크톱 워크스페이스로.**

Tauri 2 + Rust + React 기반의 원격 접속 통합 클라이언트

[![Release](https://img.shields.io/github/v/release/pjhun0412/ShellPilot?include_prereleases&label=release)](https://github.com/pjhun0412/ShellPilot/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#라이선스)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey)](docs/macos-support.md)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)

</div>

---

> 최신 한국어 인계 문서는 [docs/index.md](docs/index.md)를 먼저 보세요.

ShellPilot은 SSH 터미널, SFTP 파일 전송, RDP/VNC 원격 데스크톱을 하나의 탭 기반 워크스페이스에서 관리하는 데스크톱 앱입니다. 세션은 서버별로 그룹핑해 저장하고, 비밀번호/키 passphrase 같은 secret은 OS 자격 증명 저장소에만 보관합니다.

## 목차

- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [시작하기](#시작하기)
- [프로젝트 구조](#프로젝트-구조)
- [문서](#문서)
- [로드맵](#로드맵)
- [라이선스](#라이선스)

## 주요 기능

### 🖥️ SSH 터미널

- Rust `russh` 기반 SSH 접속, xterm.js 다크 테마 터미널
- 비밀번호 / SSH Private Key / SSH Agent(OpenSSH Agent, Pageant) 인증
- known_hosts 저장·조회·삭제, host key 변경(TOFU mismatch) 차단
- 인증 정보 누락 시 터미널 패널 안에서 바로 입력/재접속

### 📁 SFTP

- SSH 세션에서 바로 SFTP 탭 열기 (탭에서 이동한 현재 원격 경로로 초기 오픈)
- 원격 파일 탐색, 정렬, 다중/범위 선택, breadcrumb·경로 직접 편집
- 파일/폴더 업로드·다운로드, 드래그 앤 드롭 업로드
- 전송 큐(진행률, 속도/ETA, 취소, 실패 재시도), temp/backup 기반 안전한 파일 교체
- 열린 탐색기 사이드바, 원격 경로 북마크

### 🖧 RDP

- IronRDP 기반 sidecar 프로세스로 원격 데스크톱을 탭 안 캔버스에 렌더링
- 서버 TLS fingerprint 승인/신뢰 저장소
- 클립보드 텍스트/파일 붙여넣기(CLIPRDR), 원격 커서 동기화
- 원본 크기 / 화면에 맞춤 표시 모드, 해상도·이미지 품질 옵션

### 🖼️ VNC

- RFB 프로토콜 기반 VNC 접속, framebuffer 렌더링
- VNC 비밀번호 인증 및 macOS 화면 공유(Apple Remote Desktop) 인증
- 마우스(이동/클릭/휠)·키보드 입력 전달, reconnect/disconnect

### 🤖 AI Assistant

- 로컬에 설치된 Claude Code CLI / Codex CLI를 감지해 앱 안에서 바로 실행
- 특정 SSH/SFTP 탭에 바인딩된 AI 패널로 터미널 컨텍스트 기반 질의
- 읽기 전용 도구 라우팅으로 안전한 범위 내에서 원격 상태 조회

### 🪟 워크스페이스 & 세션

- FlexLayout 기반 탭 분할(좌/우/상/하/중앙), 탭 드래그 앤 드롭
- 탭 우클릭 메뉴: Clone, Duplicate, Reconnect, Copy Host, Copy SSH Command 등
- Open Tabs 사이드바(서버별 그룹, 연결 상태 표시), 그룹 단위 reconnect/disconnect
- 세션 그룹 접기/펼치기, 드래그 앤 드롭으로 그룹/세션 재배치
- Windows/macOS 로컬 터미널 프로필 (PowerShell, CMD, WSL, Git Bash / Zsh, Bash)

## 보안 정책

- 세션 데이터에는 host, port, username, tag, group, auth method, credential reference만 저장합니다.
- 비밀번호와 SSH key passphrase는 session JSON이나 localStorage에 저장하지 않고, OS 자격 증명 저장소(`keyring`)를 통해서만 저장/조회합니다.
- SSH host key는 앱 로컬 데이터 디렉터리의 known_hosts 저장소에서 관리하며, 변경된 host key는 접속을 차단합니다.
- 세션 삭제·인증 정보 변경 시 가능한 범위에서 고아 credential을 정리하고, 세션 복제 시 credential reference는 기본적으로 복사하지 않습니다.

## 기술 스택

**Frontend** — React · TypeScript · Tailwind CSS · Radix UI · FlexLayout · xterm.js · dnd-kit

**Desktop / Backend** — Tauri 2 · Rust · Tokio · russh / russh-sftp · IronRDP (RDP sidecar) · vnc-rs (VNC sidecar) · keyring

## 시작하기

### 요구 사항

- Node.js 20+
- Rust & Cargo
- Windows: WebView2 Runtime
- macOS: Xcode Command Line Tools

### 설치

```bash
npm install
```

### 개발 서버 실행

```bash
# 프론트엔드만 (브라우저)
npm run dev

# Tauri 데스크톱 앱
npm run tauri:dev
```

### 빌드

```bash
# 프론트엔드 빌드
npm run build

# Tauri 앱 빌드 (현재 플랫폼)
npm run tauri:build

# Windows 배포 산출물
npm run release:win

# macOS 배포 산출물
npm run release:mac
```

> Windows에서 Tauri npm script는 `scripts/tauri-cli.mjs`를 통해 실행됩니다. Cargo가 설치되어 있어도 현재 셸 PATH에서 안 보여 `cargo metadata`가 실패하는 문제를 피하기 위한 처리입니다.

## 프로젝트 구조

```text
src/
  components/        공용 UI, 내비게이션
  features/
    ai/               AI Assistant 패널, 도구 라우팅
    connections/      연결 상태 publish/subscribe
    rdp/              RDP 패널, 입력/프레임 렌더링
    vnc/               VNC 패널, 입력/프레임 렌더링
    sessions/         세션 CRUD, 트리 UI, 자격 증명 브리지
    sftp/             SFTP 탐색기, 전송 큐
    terminal/         SSH / 로컬 PTY 터미널
    workspace/        FlexLayout 워크스페이스, 탭 메뉴
  types/

src-tauri/
  src/commands/       ssh, sftp, rdp, vnc, ai, sessions, credentials
  rdp-sidecar/        IronRDP 기반 RDP sidecar
  vnc-sidecar/        VNC(RFB) sidecar

scripts/
  tauri-cli.mjs           크로스 플랫폼 Tauri CLI 래퍼
  release-win.ps1          Windows 릴리즈 스크립트
  release-macos.sh         macOS 릴리즈 스크립트
```

## 문서

- [문서 인덱스](docs/index.md)
- [프로젝트 구조 & 작업 인계](docs/project-overview.md)
- [SSH 인계 문서](docs/ssh-handoff.md)
- [SFTP 인계 문서](docs/sftp-handoff.md)
- [RDP 인계 문서](docs/rdp-handoff.md)
- [VNC 설계 메모](docs/vnc-design.md)
- [AI Tool Layer 설계](docs/ai-tool-layer-design.md)
- [macOS 지원 메모](docs/macos-support.md)

## 로드맵

- SSH key validation 고도화
- 세션 import/export
- 워크스페이스 layout reset/preset
- 테마 토큰 정리 및 light/high-contrast 테마
- SFTP Commander 모드(로컬/원격 2-pane), pinned/recent 경로
- SFTP 전송 일시정지/이어받기
- VNC TLS(VeNCrypt) 지원
- macOS 자동 업데이트 및 code signing

## 라이선스

MIT License
