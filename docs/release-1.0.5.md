# ShellPilot 1.0.5 릴리스 노트

## 주요 변경 사항

### SSH 터미널 출력 안정화

- SSH 대용량 출력을 Rust에서 적절한 크기로 묶어 프런트엔드 이벤트 호출 수를 줄였다.
- xterm 파서 완료 시점에 출력 credit을 반환하는 backpressure를 적용해 UI 큐와 메모리가 과도하게 증가하지 않도록 했다.
- 출력 stream ID와 sequence를 사용해 재연결 전후의 오래된 ACK와 출력이 새 세션에 섞이지 않도록 했다.
- 개발 환경에서만 활성화할 수 있는 SSH 성능 계측 로그를 추가했다.

### 터미널 크기 동기화 수정

- 숨겨진 탭의 0 크기가 2열 1행 PTY 크기로 전송되던 경로를 차단했다.
- SSH 또는 로컬 터미널 탭 활성화, 창 크기 변경, 최소화 후 복원 시 현재 화면 크기로 다시 동기화한다.
- 원격 셸의 열 수와 xterm 화면 너비가 달라져 입력 글자나 커서가 다음 줄로 내려가던 현상을 수정했다.

## 검증

- SSH 출력 흐름 Rust 단위 테스트 통과
- Rust 포맷 검사 통과
- TypeScript 검사 및 Vite 프로덕션 빌드 통과

## Windows 배포 산출물

- `ShellPilot-1.0.5-setup.exe`
- `ShellPilot-1.0.5-setup.exe.sig`
- `ShellPilot-1.0.5-portable.zip`
- `latest.json`
