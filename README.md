# ShellPilot

ShellPilot은 SSH, SFTP, RDP, AI Agent, 로컬 터미널을 하나의 데스크톱 애플리케이션에서 통합해 사용하기 위한 원격 작업 공간입니다.

초기 목표는 개인 사용에 적합한 빠르고 가벼운 원격 접속 도구를 만드는 것이며, 이후 다국어, 플러그인, 팀 협업, 자동화 기능까지 확장할 수 있는 구조를 지향합니다.

> Modern Remote Workspace for SSH, SFTP, RDP, and AI Agent

---

## 개요

개발자, DevOps 엔지니어, 시스템 관리자 작업에서는 여러 도구를 동시에 사용하는 일이 많습니다.

- SSH 클라이언트
- SFTP 클라이언트
- 원격 데스크톱
- 로컬 터미널
- AI 채팅 또는 명령어 분석 도구
- 서버 접속 정보 관리 도구

ShellPilot은 이러한 도구들을 하나의 워크스페이스 안에서 사용할 수 있도록 만드는 것을 목표로 합니다.

기술 스택은 Tauri, Rust, React, TypeScript를 중심으로 구성합니다. Rust는 터미널, SSH, SFTP, 보안 저장소 같은 네이티브 기능을 담당하고, React는 워크스페이스 UI, 세션 관리, 스플릿 뷰, 설정 화면을 담당합니다.

---

## 핵심 방향

### 1. 통합 원격 워크스페이스

여러 프로그램을 오가며 작업하지 않고, 하나의 앱 안에서 서버 접속, 파일 전송, 원격 데스크톱, AI 지원을 사용할 수 있게 합니다.

### 2. 세션 중심 작업 흐름

서버 접속 정보를 그룹, 폴더, 태그, 즐겨찾기로 관리하고, 자주 사용하는 작업 환경을 빠르게 다시 열 수 있게 합니다.

### 3. 스플릿 뷰와 레이아웃 저장

IDE처럼 여러 터미널, SFTP 탐색기, AI 패널을 한 화면에 배치하고, 사용자가 만든 레이아웃을 저장할 수 있게 합니다.

### 4. AI Agent 통합

터미널 출력, 에러 로그, 명령어 실행 결과를 AI가 이해하고 설명하거나 다음 명령을 제안할 수 있도록 합니다.

### 5. 다국어 지원

초기 문서는 한국어를 기준으로 작성하지만, UI 문구와 문서는 한국어/영어를 포함한 다국어 확장을 고려해 설계합니다.

---

## 주요 기능

### SSH Terminal

- 인터랙티브 SSH 터미널
- 비밀번호 인증
- SSH 키 인증
- 다중 동시 접속
- 자동 재연결
- 포트 포워딩
- 로컬 터미널 지원
  - PowerShell
  - CMD
  - Bash

### SFTP Explorer

- 그래픽 파일 탐색기
- 업로드 및 다운로드
- 드래그 앤 드롭
- 파일 이름 변경
- 파일 삭제
- 폴더 생성
- 권한 변경
- 전송 큐
- 진행률 표시

### Session Manager

서버 접속 정보를 폴더와 그룹 단위로 정리합니다.

```text
Production
  Web-01
  Web-02
  Database

Development
  API
  Redis
  Docker
```

예정 기능:

- 트리 뷰
- 검색
- 즐겨찾기
- 태그
- 빠른 접속
- 가져오기/내보내기
- 접속 정보 암호화 저장

### Workspace

현대적인 IDE와 비슷한 유연한 작업 공간을 제공합니다.

- 멀티 탭
- 수평 분할
- 수직 분할
- 그리드 레이아웃
- 도킹 패널
- 레이아웃 저장 및 복원

예시:

```text
+-----------------------------+-----------------------------+
| SSH - Production            | SSH - Development           |
+-----------------------------+-----------------------------+
| AI Assistant                | SFTP Explorer               |
+-----------------------------+-----------------------------+
```

### AI Assistant

터미널 작업을 이해하는 AI 보조 기능을 제공합니다.

- 명령어 생성
- 명령어 설명
- 에러 진단
- 로그 분석
- Linux 트러블슈팅
- DevOps 작업 보조
- 인프라 관련 Q&A

지원 예정 Provider:

- OpenAI
- Ollama
- OpenRouter
- Anthropic

예시:

```text
$ systemctl status nginx

AI Analysis
- nginx 서비스가 시작되지 않았습니다.
- 80번 포트가 이미 사용 중일 수 있습니다.

Suggested Commands
sudo lsof -i :80
sudo systemctl restart nginx
```

### Remote Desktop

RDP는 후순위 기능으로 계획합니다.

예정 기능:

- 앱 내장 RDP
- 클립보드 동기화
- 전체 화면
- 동적 해상도
- 멀티 모니터 지원

---

## 보안 방향

- SSH 키 인증
- 비밀번호 인증
- 접속 정보 암호화 저장
- Windows Credential Manager 연동
- 안전한 세션 데이터베이스
- 민감 정보 마스킹
- AI 전송 컨텍스트 제어

AI 기능은 터미널 출력이나 로그를 외부 Provider에 보낼 수 있으므로, 사용자가 전송 범위와 Provider를 명확히 제어할 수 있어야 합니다.

---

## 기술 스택

### Frontend

- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide Icons
- FlexLayout
- xterm.js

### Desktop / Backend

- Tauri
- Rust
- Tokio

### Networking

- SSH
- SFTP
- WebSocket

### AI

- OpenAI API
- Ollama
- OpenRouter
- MCP

### Storage

- SQLite
- Encrypted local storage
- Windows Credential Manager

---

## 다국어 계획

초기 개발 단계부터 UI 문구를 직접 하드코딩하지 않고, 다국어 리소스 파일로 분리하는 구조를 고려합니다.

예상 구조:

```text
src/
  i18n/
    locales/
      ko.json
      en.json
    index.ts
```

초기 지원 언어:

- Korean
- English

---

## 개발 로드맵

### Phase 0. Project Foundation

- [x] README 정리
- [x] MVP 범위 확정
- [x] Tauri 프로젝트 생성
- [x] React + TypeScript 설정
- [x] 기본 레이아웃 구성
- [x] 다국어 구조 설계

### Phase 1. Core Workspace

- [ ] 로컬 터미널
- [x] 기본 탭 시스템
- [x] 스플릿 뷰
- [x] 세션 매니저 UI
- [ ] 설정 화면
- [ ] 테마 지원
- [x] 레이아웃 저장

### Phase 2. SSH / SFTP

- [x] SSH 접속
- [ ] SSH 키 인증
- [x] 접속 세션 저장
- [ ] 자동 재연결
- [ ] SFTP 탐색기
- [ ] 파일 업로드/다운로드
- [ ] 전송 큐

### Phase 3. Productivity

- [ ] 명령 팔레트
- [ ] 스니펫
- [ ] 포트 포워딩
- [ ] 터미널 녹화
- [ ] 세션 동기화
- [ ] 작업 공간 프리셋

### Phase 4. AI

- [ ] AI 채팅
- [ ] 터미널 컨텍스트 전달
- [ ] 명령어 추천
- [ ] 에러 진단
- [ ] 로그 분석
- [ ] AI Agent 워크플로우

### Phase 5. Remote Desktop

- [ ] Embedded RDP
- [ ] Clipboard Sync
- [ ] File Sharing
- [ ] Multi-monitor Support
- [ ] Performance Optimization

---

## 권장 MVP

초기 버전에서는 범위를 작게 잡고 실제로 매일 사용할 수 있는 기능부터 구현합니다.

1. 로컬 터미널
2. SSH 터미널
3. 세션 저장
4. 좌측 세션 트리
5. 탭 및 스플릿 뷰
6. 기본 설정
7. 간단한 AI 명령어 설명

SFTP, RDP, 고급 AI Agent, 팀 협업 기능은 MVP 이후 단계적으로 추가합니다.

---

## 예상 프로젝트 구조

```text
shellpilot/
  src/
    components/
    layouts/
    pages/
    hooks/
    stores/
    services/
    types/
    utils/
    i18n/

  src-tauri/
    src/
      ssh/
      sftp/
      terminal/
      ai/
      storage/
      commands/
      main.rs

  README.md
```

---

## 개발 환경

필요 도구:

- Node.js 20+
- Rust
- Cargo
- WebView2 Runtime

설치:

```bash
npm install
```

개발 실행:

```bash
npm run tauri dev
```

빌드:

```bash
npm run tauri build
```

Windows PowerShell에서 `npm.ps1` 실행 정책 오류가 발생하면 `npm.cmd`를 사용합니다.

```bash
npm.cmd install
npm.cmd run dev
npm.cmd run tauri:dev
```

---

## 장기 아이디어

- Docker 관리
- Kubernetes Dashboard
- Serial Console
- Database Client
- Terminal Themes
- Session Sync
- Plugin System
- AI Automation
- Remote Scripts
- Team Collaboration

---

## License

MIT License
