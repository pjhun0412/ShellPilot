# ShellPilot 유지보수 상태

최종 갱신: 2026-07-22

이 문서는 기능별 개발 우선순위와 기준 문서를 한곳에서 확인하기 위한 상태표다. 기능 구현의 세부 내용은 각 handoff 문서를 따르고, 과거 설계 문서는 결정 배경을 확인할 때만 참고한다.

## 현재 유지보수 범위

| 영역 | 상태 | 현재 방향 | 기준 문서 |
| --- | --- | --- | --- |
| SSH / Local PTY | 활성 유지보수 | 실제 사용 안정화, 인증·known_hosts·터미널 성능 개선 | [ssh-handoff.md](ssh-handoff.md) |
| SFTP | 활성 유지보수 | Commander/전송 큐 안정화, 대용량 전송 검증, 백엔드 구조 정리 | [sftp-handoff.md](sftp-handoff.md), [sftp-transfer-queue.md](sftp-transfer-queue.md) |
| Notes | 활성 개발 | 편집·검색·링크·첨부 안정화, 대용량 노트 저장소 대응 | [notes-design.md](notes-design.md) |
| Workspace / Sessions / Credentials | 공통 기반 | SSH/SFTP/Notes에 필요한 범위에서만 변경 | [project-overview.md](project-overview.md) |
| RDP | 동결 | 현재 큰 구조와 구현을 보존한다. 명시적인 재개 전에는 기능 추가·리팩터링하지 않는다. | [rdp-handoff.md](rdp-handoff.md) |
| VNC | 동결 | 현재 MVP 구조를 보존한다. 명시적인 재개 전에는 기능 추가·리팩터링하지 않는다. | [vnc-design.md](vnc-design.md) |
| AI Assistant | 동결 | 현재 읽기 전용 도구 계층을 유지한다. 변경 작업 승인 기능은 보류한다. | [ai-tool-layer-design.md](ai-tool-layer-design.md) |
| Release / macOS | 필요 시 유지보수 | Windows 릴리스를 우선하며 macOS는 빌드·배포 검증이 더 필요하다. | [release-update.md](release-update.md), [macos-support.md](macos-support.md) |

## 문서 우선순위

문서 내용이 충돌하면 다음 순서로 판단한다.

1. 현재 소스와 설정
2. 이 문서와 [project-overview.md](project-overview.md)
3. 기능별 최신 handoff 문서
4. 릴리스 문서
5. `*-design.md`에 남은 과거 계획과 결정 로그

`sftp-design.md`와 `rdp-design.md`는 일부 과거 계획을 포함한다. 현재 동작을 확인할 때는 각각 `sftp-handoff.md`, `rdp-handoff.md`를 먼저 본다. `release-1.0.x.md`는 해당 릴리스 당시 기록이므로 현재 로드맵의 기준으로 사용하지 않는다.

## 변경 원칙

- 활성 영역에서도 기능 변경과 구조 리팩터링을 한 작업에 크게 섞지 않는다.
- SSH는 이미 하위 모듈이 분리되어 있으므로 테스트와 경계 안정화를 우선한다.
- SFTP는 동작 검증 후 `sftp.rs`를 session/file operation/transfer/control 경계로 나누는 방향을 검토한다.
- Notes는 현재 진행 중인 기능 작업을 먼저 안정화한 뒤 storage/index/link/assets/command 경계 분리를 검토한다.
- RDP/VNC/AI는 공통 보안 문제나 빌드 차단 문제가 아닌 이상 함께 수정하지 않는다.
- 공통 Workspace, session type, credential 흐름을 수정할 때는 SSH/SFTP/Notes 회귀 영향을 먼저 확인한다.

## 1.0.4 상태

저장소의 버전 파일은 `1.0.4`를 가리키지만 정식 1.0.4 릴리스 문서는 아직 확정되지 않았다. 현재 문서에서 1.0.4는 준비 중인 작업 상태로 취급하며, 태그와 릴리스 산출물을 만든 뒤 별도 릴리스 노트를 확정한다.
