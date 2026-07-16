# ShellPilot 1.0.2 릴리스 노트

작성일: 2026-07-16

## 요약

1.0.2는 SSH/SFTP 보안 하드닝과 연결 target 공통화가 중심인 릴리스입니다. 저장 credential을 사용할 때 세션/호스트/사용자 범위를 더 엄격하게 확인하고, SSH/SFTP/AI가 공유하는 SSH target 생성 로직을 한 곳으로 모았습니다.

## 주요 변경

### SSH/SFTP credential 보안

- 저장 credential id 형식을 `shellpilot_<session>_password|key` 형태로 검증합니다.
- SSH/SFTP가 저장 credential을 읽을 때 단순 `credentialId`만 믿지 않고 다음 값을 세션 레지스트리와 대조합니다.
  - `sessionId`
  - `credentialRef.id`
  - `credentialRef.kind`
  - host
  - port
  - username
- SSH shell, SSH read-only exec, SFTP open, SSH 연결 테스트가 같은 인증 검증 경로를 사용합니다.
- 세션 registry 저장 시 이전/새 registry를 비교해 더 이상 참조되지 않는 credential을 best-effort로 정리합니다.

### SSH host key 안정화

- unknown host key trust는 `acceptNewHostKey=true`만으로 처리하지 않습니다.
- 직전 경고에서 확인한 fingerprint와 같은 `acceptedHostKeyFingerprint`가 함께 들어온 경우에만 새 host key를 저장합니다.
- host key warning event는 `hostKeyFingerprint` 구조화 필드를 포함합니다.
- host key mismatch는 여전히 자동 trust하지 않습니다.

### 프론트 secret 노출면 축소

- SSH/SFTP password memory cache는 5분 TTL을 가집니다.
- command snippet 저장 시 password, token, api key, Authorization/Bearer 등 민감정보 패턴이 보이면 저장 전 경고합니다.
- session metadata/localStorage에는 secret을 저장하지 않고 credential reference만 저장하는 원칙을 유지합니다.

### SSH/SFTP/AI target 생성 공통화

- `src/features/connections/sshTarget.ts`를 추가했습니다.
- SSH terminal, SFTP, AI read-only command가 같은 target 생성 helper를 사용합니다.
- `sessionId`, credential id, private key path, host key fingerprint 전달이 한 곳에서 관리됩니다.

### SFTP local path 기본 검증

- backend local file command는 공통 helper로 로컬 경로 문자열을 검증합니다.
- 기존 경로를 다루는 명령은 가능한 범위에서 canonicalize와 file/directory 성격 확인을 거칩니다.
- download target은 대상 파일이 없어도 되므로 parent directory를 기준으로 검증합니다.
- drag/drop stream upload의 `localPath`는 OS path가 아닌 표시용 문자열로만 검증합니다.

## 배포 산출물

Windows release 스크립트 기준 산출물:

- `ShellPilot-1.0.2-setup.exe`
- `ShellPilot-1.0.2-setup.exe.sig`
- `ShellPilot-1.0.2-portable.zip`
- `latest.json`

`latest.json`은 Windows updater용 `windows-x86_64` platform 항목을 포함합니다.

## 자동 업데이트

1.0.1 설치형 앱이 프로덕션 빌드이고 updater endpoint에 접근 가능하면, 1.0.2 릴리스의 `latest.json`을 확인한 뒤 업데이트 확인 대화상자가 뜹니다.

조건:

- GitHub Release `v1.0.2`에 `latest.json`이 업로드되어 있어야 합니다.
- `latest.json`의 version이 `1.0.2`여야 합니다.
- `ShellPilot-1.0.2-setup.exe`와 `.sig`가 함께 업로드되어 있어야 합니다.
- 사용자가 업데이트에 동의해야 설치가 진행됩니다.

## 검증

이번 릴리스 준비 중 확인한 명령:

```powershell
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
git diff --check
```

릴리스 업로드 전 Windows release 스크립트가 추가로 수행하는 항목:

```powershell
cargo build --release --manifest-path src-tauri\rdp-sidecar\Cargo.toml
cargo build --release --manifest-path src-tauri\vnc-sidecar\Cargo.toml
npm run release:win:build
```

## 남은 고도화

- SFTP local file grant registry
- RDP/VNC credential binding을 SSH/SFTP와 같은 수준으로 확장할지 검토
- macOS release 업로드/자동 업데이트 자동화
