# ShellPilot 1.0.1 릴리스 노트

작성일: 2026-07-13

## 요약

1.0.1은 VNC MVP를 추가하는 릴리스다. 기존 SSH/SFTP/RDP 흐름과 별도로 VNC 전용 sidecar를 두고, ShellPilot workspace 안에서 VNC 화면 표시와 기본 입력을 사용할 수 있게 했다.

## 추가된 기능

### VNC 세션

- 세션 종류에 `VNC` 추가
- VNC 세션 생성/수정 폼에서 host, port, username, password credential 설정 지원
- 기본 포트는 5900
- VNC 패널을 workspace tab/panel로 열 수 있음

### VNC 연결과 인증

- 표준 VNC password authentication 지원
- macOS Screen Sharing 서버 지원
  - macOS의 비표준 `RFB 003.889` banner normalization
  - Apple ARD authentication security type `30` 구현
  - macOS 계정 username + password 기반 인증
- reconnect/disconnect 지원
- 인증 실패, username 누락, 연결 실패 등 기본 오류 메시지 처리

### 화면 표시

- Canvas 기반 framebuffer 렌더링
- Raw/ZRLE/CopyRect/DesktopSizePseudo encoding 요청
- 원격 framebuffer resize 이벤트 처리
- `Original` 표시 모드
- `Fit` 표시 모드
- ShellPilot 공통 scroll area 사용

### 입력

- 마우스 이동, 좌/중/우 클릭, wheel 입력 전달
- 키보드 입력 전달
- Ctrl/Shift/Alt/Meta 계열 modifier key 처리
- blur 시 눌린 mouse/modifier 상태 release 처리

### 성능 개선

- sidecar에서 frame batch 전송
- frontend에서 frame batch 수신
- `requestAnimationFrame` 기반 canvas 렌더링
- CopyRect는 픽셀 재전송 대신 canvas copy로 처리
- 숨겨진 패널/백그라운드 문서에서는 refresh와 frame render 중지
- 다시 보일 때 full refresh 요청
- 입력 coalescing과 batching으로 Tauri IPC 호출 수 감소
- sidecar TCP_NODELAY 활성화
- sidecar poll tick당 이벤트 처리량 제한으로 입력 응답성 개선

## 배포 포함 사항

1.0.1부터 VNC sidecar 실행 파일이 앱 번들에 포함된다.

- Tauri `externalBin`에 `binaries/shellpilot-vnc-probe` 등록
- Windows 배포 시 `shellpilot-vnc-probe-x86_64-pc-windows-msvc.exe` 형태로 번들링
- release build 과정에서 VNC sidecar source가 external binary보다 최신이면 `build.rs`가 sidecar를 다시 빌드하고 `src-tauri/binaries/`로 복사

따라서 정상 release build 경로를 사용하면 ShellPilot 본체와 VNC sidecar exe가 함께 배포된다.

## 보안 메모

- VNC 비밀번호는 프로세스 argv로 전달하지 않는다.
- sidecar stdout/frame event에 비밀번호를 출력하지 않는다.
- 저장 비밀번호는 기존 credential store 흐름을 사용한다.
- VNC 자체는 TLS/VeNCrypt 미지원 상태에서는 화면/입력 트래픽이 암호화되지 않을 수 있다.
- 개인 LAN/VPN 사용은 MVP 범위로 적합하지만, 인터넷에 VNC 포트를 직접 노출하는 사용은 권장하지 않는다.

## 알려진 제한

- TLS/VeNCrypt 미지원
- SSH 터널링 미지원
- 파일 전송 미지원
- 고급 clipboard 미지원
- RealVNC/TightVNC 전체 확장 미지원
- 멀티 모니터 미지원
- 자동 원격 해상도 변경 미지원
- 일부 OS/브라우저 예약 단축키는 WebView에서 가로채지 못할 수 있음

## 검증

이번 릴리스 준비 중 실행한 주요 검증:

```powershell
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
cargo check --manifest-path src-tauri\vnc-sidecar\Cargo.toml
```

