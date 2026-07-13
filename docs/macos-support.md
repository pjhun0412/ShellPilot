# ShellPilot macOS 지원 메모

이 문서는 Windows 우선으로 구현된 ShellPilot을 macOS에서도 사용할 수 있게 만들기 위한 현재 상태와 남은 작업을 정리한다.

## 현재 반영된 내용

- Tauri CLI 실행 스크립트를 PowerShell 고정에서 Node 기반 래퍼(`scripts/tauri-cli.mjs`)로 변경했다.
  - Windows와 macOS 모두 `npm run tauri -- ...` 형식으로 실행할 수 있다.
- Rust 의존성을 OS별로 분리했다.
  - Windows: `keyring`의 `windows-native`, `windows-sys`
  - macOS: `keyring`의 `apple-native`
- 로컬 터미널 프로필을 플랫폼별로 분리했다.
  - Windows: PowerShell, CMD, WSL, Git Bash
  - macOS: Zsh, Bash, Default Shell
- 로컬 PTY 백엔드에서 `__shellpilot_default_shell` 명령을 `$SHELL` 또는 `/bin/sh`로 해석하도록 했다.
- macOS 릴리즈 빌드용 초기 스크립트 `scripts/release-macos.sh`를 추가했다.
  - RDP sidecar를 현재 macOS host target으로 빌드한다.
  - Tauri가 요구하는 `src-tauri/binaries/shellpilot-rdp-probe-$TARGET` 위치로 복사한다.
  - `.app`/`.dmg` 번들 빌드를 실행한다.

## 기능별 예상 상태

| 기능 | macOS 예상 상태 | 메모 |
| --- | --- | --- |
| SSH 터미널 | 사용 가능 예상 | `russh` 기반이라 OS 의존성이 낮다. 실제 macOS 빌드/접속 테스트 필요 |
| SFTP | 사용 가능 예상 | 로컬 reveal은 이미 `open -R` macOS 분기가 있다 |
| Credentials | 사용 가능 예상 | macOS Keychain(`apple-native`)로 분리했다 |
| Local Terminal | 사용 가능 예상 | Zsh/Bash/Default Shell 프로필 추가 |
| Elevated local terminal | 미지원 | 현재 Windows UAC 전용 기능 |
| RDP 기본 연결/렌더링 | 확인 필요 | `ironrdp` sidecar가 macOS에서 빌드/접속되는지 실제 테스트 필요 |
| RDP Windows key capture | Windows 전용 | macOS에서는 no-op |
| RDP native clipboard text/file write | Windows 전용 | macOS native clipboard 연동은 별도 구현 필요 |
| 자동 업데이트 | 추가 작업 필요 | macOS용 `.app`/`.dmg` asset과 `latest.json` platform 항목 추가 필요 |

## macOS에서 확인할 명령

macOS 머신에서 다음 순서로 확인한다.

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

## 남은 작업

1. 실제 Intel Mac / Apple Silicon Mac에서 `cargo check`와 `npm run tauri:dev` 확인
2. RDP sidecar macOS 빌드 및 접속 테스트
3. macOS RDP clipboard 구현 여부 결정
4. macOS code signing/notarization 전략 결정
5. GitHub Release에 macOS asset 업로드 흐름 추가
6. updater `latest.json`에 macOS platform 항목 추가

