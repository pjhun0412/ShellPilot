# ShellPilot macOS 지원 메모

이 문서는 Windows 중심으로 구현된 ShellPilot을 macOS에서도 사용할 수 있게 만든 변경 사항과 아직 남은 항목을 정리한다.

## 현재 반영된 내용

- Tauri CLI 실행을 PowerShell 고정 방식에서 Node 기반 래퍼(`scripts/tauri-cli.mjs`)로 변경했다.
  - Windows/macOS 모두 `npm run tauri -- ...` 형식으로 실행할 수 있다.
- Rust 의존성을 OS별로 분리했다.
  - Windows: `keyring`의 `windows-native`, `windows-sys`
  - macOS: `keyring`의 `apple-native`
- 로컬 터미널 프로필을 플랫폼별로 분리했다.
  - Windows: PowerShell, CMD, WSL, Git Bash
  - macOS: Zsh, Bash, Default Shell
- 로컬 PTY 백엔드에서 `__shellpilot_default_shell` 명령을 `$SHELL` 또는 `/bin/sh`로 해석하도록 했다.
- macOS 커스텀 헤더 드래그를 보강했다.
  - 프론트엔드에서 `appWindow.startDragging()` fallback을 사용한다.
  - Tauri capability에 `core:window:allow-start-dragging` 권한을 추가했다.
- Workspace 공통 안정화를 반영했다.
  - Windows/Linux: `Ctrl+W` 탭 닫기
  - macOS: `⌘W` 탭 닫기
  - 탭 우클릭 메뉴에 OS별 단축키 표시
  - SSH 비밀번호 저장 후 열린 Workspace 탭의 session config도 함께 갱신
  - macOS Keychain 등 secure storage 읽기 실패 시 비밀번호 재입력 폼으로 복구
- macOS 릴리즈 빌드 초기 스크립트 `scripts/release-macos.sh`를 추가했다.
  - RDP sidecar를 현재 macOS host target으로 빌드한다.
  - Tauri가 요구하는 `src-tauri/binaries/shellpilot-rdp-probe-$TARGET` 위치로 복사한다.
  - `.app` bundle을 만들고 `release-assets/*.zip`으로 압축한다.
  - `.dmg` bundle 빌드를 시도한다.

## 기능별 예상 상태

| 기능 | macOS 예상 상태 | 메모 |
| --- | --- | --- |
| SSH 터미널 | 사용 가능 | `russh` 기반. 실제 macOS 접속 테스트 필요 |
| SFTP | 사용 가능 | macOS reveal은 `open -R` 분기 사용 |
| Credentials | 부분 사용 가능 | macOS Keychain 사용. dev/VNC/미서명 실행에서는 `User interaction is not allowed`가 날 수 있음 |
| Local Terminal | 사용 가능 | Zsh/Bash/Default Shell 프로필 추가됨 |
| Elevated local terminal | 미지원 | 현재 Windows UAC 전용 기능 |
| RDP 기본 연결/렌더링 | 확인 필요 | macOS용 sidecar 빌드는 가능하나 실제 접속 테스트 필요 |
| RDP Windows key capture | Windows 전용 | macOS에서는 일부 키 조합을 OS가 먼저 가져갈 수 있음 |
| RDP native clipboard text/file write | Windows 중심 | macOS native clipboard 연동은 추가 검토 필요 |
| 자동 업데이트 | Windows 중심 | macOS asset/signing/latest.json 연동 미완 |

## macOS에서 확인할 명령

macOS 장비에서 다음 순서로 확인한다.

```bash
npm install
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/rdp-sidecar/Cargo.toml
npm run tauri -- --version
npm run tauri:dev
```

릴리즈 번들 확인:

```bash
npm run release:mac
```

생성되는 주요 산출물:

```text
release-assets/ShellPilot-<version>-macos-<target>-app.zip
src-tauri/target/release/bundle/macos/ShellPilot.app
src-tauri/target/release/bundle/dmg/*.dmg
```

## macOS release 미완 항목

현재 `npm run release:mac`은 로컬 빌드/압축까지만 수행한다. GitHub Release 업로드와 자동 업데이트 연동은 아직 완료되지 않았다.

남은 작업:

1. `scripts/release-macos.sh`에서 `gh release upload` 자동화 추가
2. `.app.zip` 또는 `.dmg` 중 공식 배포 포맷 결정
3. macOS code signing/notarization 전략 결정
4. Tauri updater용 macOS signature 생성 방식 확정
5. `latest.json`에 macOS platform 항목 추가
6. GitHub Release에 macOS asset 업로드 후 updater 동작 확인
7. Intel Mac / Apple Silicon Mac 각각 빌드 타깃과 배포 파일명 정리

## 주의 사항

- 터미널에서 dev 앱을 실행하고 VNC로 확인하는 경우 macOS Keychain이 사용자 승인 UI를 띄우지 못해 `User interaction is not allowed`를 반환할 수 있다.
- 실제 배포 검증은 가능하면 `.app` bundle을 Finder/VNC GUI 세션에서 직접 실행해 확인한다.
- 서명되지 않은 `.app`은 Gatekeeper/Keychain 권한 동작이 최종 배포와 다를 수 있다.
- macOS release 자동화가 끝나기 전까지는 mac 산출물을 GitHub Release에 수동 업로드해야 한다.
