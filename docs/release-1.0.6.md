# ShellPilot 1.0.6 릴리스 노트

## 주요 변경 사항

### SFTP 전송 안정화

- 전송 이벤트 listener가 준비되기 전에 작업이 시작되는 경쟁 조건을 제거했다.
- SFTP 탭을 닫을 때 대기 중인 전송 Promise와 scheduler 슬롯이 남을 수 있던 문제를 수정했다.
- pause/resume 알림 유실을 막고 다운로드 writer가 연속된 범위만 완료 상태로 기록하도록 보강했다.
- 부분 다운로드 재개 시 원격 파일 fingerprint와 기존 prefix를 확인해 다른 파일의 임시 데이터를 이어받지 않도록 했다.
- 완료 파일 정리 실패 시 최종 파일과 재개 metadata를 잘못 제거하지 않도록 오류 처리를 보강했다.

### SFTP 디렉터리 다운로드 보안

- 원격 파일명이 `..`, 절대 경로, Windows 예약 이름 등을 이용해 선택한 로컬 디렉터리 밖으로 벗어나지 못하도록 검증한다.
- symlink, junction, reparse point를 통한 외부 경로 덮어쓰기를 차단한다.
- Windows의 대소문자 비구분 경로 충돌을 탐지한다.

### SSH 개인키 인증 수정

- passphrase가 없는 새 개인키 세션이 존재하지 않는 credential ID를 조회해 입력창을 띄우던 문제를 수정했다.
- 실제로 저장된 key credential 참조가 있을 때만 passphrase를 OS credential store에서 조회한다.

## 검증

- TypeScript 검사 및 Vite 프로덕션 빌드 통과
- Rust 라이브러리 테스트 44개 통과
- Rust 포맷 검사 통과
- Rust Clippy 통과(기존 경고 유지)
- 변경 내용 공백 오류 검사 통과

## Windows 배포 산출물

- `ShellPilot-1.0.6-setup.exe`
- `ShellPilot-1.0.6-portable.exe`

태그 기반 GitHub Actions 배포에는 updater용 `latest.json`과 서명 파일이 포함되지 않는다.
