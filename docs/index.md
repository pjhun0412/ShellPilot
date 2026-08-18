# ShellPilot 문서 인덱스

최종 갱신: 2026-07-22

현재 개발은 SSH, SFTP, Notes에 집중한다. RDP, VNC, AI Assistant는 구현된 구조를 유지하는 동결 상태다. 작업 전에는 아래 문서를 순서대로 확인한다.

## 먼저 읽을 문서

1. [현재 유지보수 상태](maintenance-status.md)
2. [프로젝트 구조와 작업 인계](project-overview.md)
3. 작업 영역의 기준 문서
   - [SSH 작업 인계](ssh-handoff.md)
   - [SFTP 작업 인계](sftp-handoff.md)
   - [SFTP Transfer Queue 정책](sftp-transfer-queue.md)
   - [Notes 설계와 현행 동작](notes-design.md)
4. 배포 작업인 경우 [릴리즈와 자동 업데이트](release-update.md)

## 기능별 상태

| 문서 | 상태 | 용도 |
| --- | --- | --- |
| [ssh-handoff.md](ssh-handoff.md) | 활성 기준 | SSH/Local PTY 구현과 유지보수 기준 |
| [sftp-handoff.md](sftp-handoff.md) | 활성 기준 | SFTP 현행 구현과 다음 안정화 작업 |
| [sftp-transfer-queue.md](sftp-transfer-queue.md) | 활성 기준 | 전송 스케줄링, pause/resume, retry/restart 정책 |
| [notes-design.md](notes-design.md) | 활성 기준 | Notes 저장·편집·검색·링크·첨부 정책 |
| [rdp-handoff.md](rdp-handoff.md) | 동결 참고 | RDP 현행 구현과 알려진 제한 |
| [vnc-design.md](vnc-design.md) | 동결 참고 | VNC MVP 구조와 결정 기록 |
| [ai-tool-layer-design.md](ai-tool-layer-design.md) | 동결 참고 | AI 읽기 전용 도구 계층과 보안 모델 |
| [macos-support.md](macos-support.md) | 부분 지원 | macOS 빌드·검증·배포 제한 |

## 과거 설계와 결정 기록

- [sftp-design.md](sftp-design.md): Remote-only 탐색기 시기의 설계가 섞여 있다. 현재 동작은 `sftp-handoff.md`를 우선한다.
- [rdp-design.md](rdp-design.md): RDP 단계별 계획과 결정 로그다. 현재 동작은 `rdp-handoff.md`를 우선한다.

## 릴리스 기록

- [ShellPilot 1.0.5 릴리스 노트](release-1.0.5.md)
- [ShellPilot 1.0.3 릴리스 노트](release-1.0.3.md)
- [ShellPilot 1.0.2 릴리스 노트](release-1.0.2.md)
- [ShellPilot 1.0.1 릴리스 노트](release-1.0.1.md)

릴리스 노트는 당시 상태를 보존하는 기록이다. 현재 구현 범위나 로드맵의 기준으로 사용하지 않는다. 저장소 버전 `1.0.5`는 현재 릴리스 준비 상태다.

## 문서 우선순위

내용이 충돌하면 현재 소스와 설정, `maintenance-status.md`, `project-overview.md`, 기능별 handoff, 과거 설계 문서 순으로 판단한다. 작업 규칙은 루트의 `AGENTS.md`를 최우선으로 따른다.
