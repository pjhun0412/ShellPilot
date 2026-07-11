# ShellPilot 릴리즈와 자동 업데이트

ShellPilot은 Tauri v2 updater를 사용해 GitHub Releases 기반 업데이트를 수행한다.

## 목표 동작

1. 사용자가 ShellPilot을 실행한다.
2. 프로덕션 빌드에서만 GitHub Releases의 `latest.json`을 확인한다.
3. 현재 앱 버전보다 새 버전이 있으면 사용자에게 업데이트 여부를 묻는다.
4. 사용자가 동의하면 업데이트 패키지를 다운로드하고 설치한다.
5. 설치 후 ShellPilot 재시작 여부를 다시 묻는다.

개발 빌드에서는 시작 시 자동 확인을 하지 않는다. 개발 중 placeholder endpoint나 공개키 때문에 매번 오류 팝업이 뜨는 것을 막기 위해서다.

## 사용자 UI

- 시작 시 새 버전이 있으면 확인 대화상자가 뜬다.
- `Help -> Check for Updates`에서 수동 확인할 수 있다.
- 사용자가 동의하지 않으면 아무것도 설치하지 않는다.

## GitHub Releases 자산

릴리즈마다 다음 파일을 업로드한다.

```text
ShellPilot-<version>-setup.exe
ShellPilot-<version>-setup.exe.sig
ShellPilot-<version>-portable.exe
latest.json
```

`latest.json` 예시는 다음과 같다.

```json
{
  "version": "0.1.2",
  "notes": "ShellPilot v0.1.2 release",
  "pub_date": "2026-07-12T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<setup.exe.sig content>",
      "url": "https://github.com/pjhun0412/ShellPilot/releases/download/v0.1.2/ShellPilot-0.1.2-setup.exe"
    }
  }
}
```

앱의 updater endpoint는 GitHub 최신 릴리즈의 `latest.json`을 바라본다.

```text
https://github.com/pjhun0412/ShellPilot/releases/latest/download/latest.json
```

## 최초 설정

`src-tauri/tauri.conf.json`에서 updater endpoint와 공개키를 관리한다.

- GitHub repository: `pjhun0412/ShellPilot`
- `pubkey`: Tauri updater 공개키

업데이트 서명키는 릴리즈 빌드 환경 변수로 제공한다.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<private key>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password if used>"
```

공개키는 앱에 포함되어도 되지만, 개인키는 절대 저장소에 커밋하면 안 된다.

## 릴리즈 명령

```powershell
npm run release:win
```

`scripts/release-win.ps1`은 다음을 수행한다.

1. NSIS 설치 파일 빌드
2. portable exe 복사
3. updater 서명 파일 확인
4. `latest.json` 생성
5. GitHub Release 생성 또는 재사용
6. 설치 파일, 서명 파일, portable exe, `latest.json` 업로드

## 버전 관리

릴리즈 전 다음 버전을 모두 동일하게 올린다.

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

현재는 수동 변경 방식이다. 추후 `scripts/bump-version.ps1` 같은 동기화 스크립트를 추가하는 것이 좋다.

## 주의 사항

- updater 서명 파일이 없으면 release 스크립트가 실패한다.
- 설치형 업데이트는 서명된 설치 패키지 기준으로 동작한다.
- RDP sidecar는 앱 bundle에 포함되어야 업데이트 시 같이 교체된다.
- `latest.json`의 URL은 사용자가 접근 가능한 공개/인증 가능한 위치여야 한다.
- GitHub Release를 private repo에 둘 경우 updater 요청 인증 전략이 추가로 필요하다.
