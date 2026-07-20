# SFTP handoff

Last updated: 2026-07-21

이 문서는 ShellPilot SFTP 영역의 현재 구현 상태와 다음 유지보수 포인트를 정리한다. 세부 전송 큐 정책은 `docs/sftp-transfer-queue.md`를 우선 참고한다.

## 현재 구현 요약

- SFTP는 SSH 세션 정보를 기반으로 여는 원격 파일 탐색기다.
- Explorer 모드는 Remote 단일 탐색, Commander 모드는 좌측 Local / 우측 Remote 탐색을 제공한다.
- SFTP 사이드바는 열린 탐색기, Local/Remote favorites, Transfer Queue 진입점을 제공한다.
- 하단 Transfer Queue는 여러 SFTP 패널/서버에서 발생한 upload/download를 통합 관리한다.
- 패널 내부 Transfers 요약은 현재 패널에서 발생한 전송 상태를 빠르게 보여주는 용도다.

## 주요 파일

Frontend:

- `src/features/sftp/SftpPanel.tsx`
  - SFTP 패널 상위 orchestration.
  - lifecycle, selection, commander/explorer mode, local refresh, remote refresh, transfer hook을 연결한다.
- `src/features/sftp/SftpPanelBody.tsx`
  - restored/closed/error 상태, operation notice, loading/empty state, panel transfer summary를 렌더링한다.
- `src/features/sftp/SftpTransferQueuePanel.tsx`
  - 하단 전역 Transfer Queue UI.
  - pause/resume, retry, restart, clear finished, concurrency control을 제공한다.
- `src/features/sftp/SftpPanelTransferQueue.tsx`
  - SFTP 패널 내부 compact transfer summary.
- `src/features/sftp/sftpTransferScheduler.ts`
  - frontend queue scheduling.
  - queued/running/paused 처리, concurrency 제한, retry/restart enqueue를 담당한다.
- `src/features/sftp/sftpTransferStore.ts`
  - 전송 item 상태 store.
  - queued/running/paused/completed/failed/canceled 상태를 관리한다.
- `src/features/sftp/sftpTransferTypes.ts`
  - transfer item, retry payload, metadata type 정의.
- `src/features/sftp/sftpTransferActionHelpers.ts`
  - upload/download transfer item 생성 helper.
  - retry payload에 direction/source/target/panel/session/conflict metadata를 안정적으로 담는다.
- `src/features/sftp/useSftpTransferActions.ts`
  - upload/download 요청, conflict dialog, queue enqueue를 담당한다.
- `src/features/sftp/useSftpTransfers.ts`
  - backend transfer event를 panel state와 전역 store에 반영한다.
- `src/features/sftp/useSftpPanelRemoteOperations.ts`
  - remote create/rename/delete/upload/download/move 등 panel operation wiring.
- `src/features/sftp/sftpBridge.ts`
  - Tauri SFTP command/listen boundary.
- `src/features/sftp/sftpSidebarState.ts`
  - SFTP sidebar event/state bus.

Backend:

- `src-tauri/src/commands/sftp.rs`
  - SFTP session store, file operation, upload/download, progress event, cancel/pause/resume control.
- `src-tauri/src/lib.rs`
  - SFTP/local helper command 등록.

Release/version:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

## Transfer Queue 상태

지원 상태:

- `queued`
- `running`
- `paused`
- `completed`
- `failed`
- `canceled`

지원 동작:

- 실패한 전송 개별 retry.
- 실패 항목 전체 `Retry failed`.
- running item pause/resume.
- queue scheduling pause/resume.
- 실패/완료/취소 항목 clear.
- running item은 clear 대상에서 제외.
- concurrency 1~8 설정.
- failed item의 명시적 restart.

주의:

- retry는 기존 transfer item의 direction/source/target/panel/session/conflict metadata를 재사용한다.
- restart는 기존 임시파일을 무시하도록 uploadId/downloadId를 새로 만든다.
- compact 패널 요약은 공간 때문에 일부 항목만 보여줄 수 있다. 전체 목록은 하단 Transfer Queue가 기준이다.

## 대용량 전송 안정화

업로드:

- remote temp 파일에 먼저 쓰고, finalize 단계에서 최종 경로로 rename한다.
- close/flush timeout이 발생해도 즉시 실패시키지 않고 temp/final size 확인으로 성공 여부를 재확인한다.
- finalize confirm timeout은 대용량/NFS 계열 서버를 고려해 짧은 retry delay가 아니라 별도 confirm deadline을 사용한다.
- overwrite 시 backup 파일을 사용하고, 성공 후 백업 찌꺼기를 정리한다.
- path upload retry는 local size/mtime metadata가 바뀌면 resume 대신 restart로 전환한다.

다운로드:

- local temp 파일에 먼저 쓰고, 완료 후 최종 경로로 rename한다.
- temp size가 remote size 이하이면 offset부터 resume한다.
- temp가 없거나 크기가 맞지 않거나 seek/open이 실패하면 자동 restart 경로로 전환한다.

공통:

- cancel은 temp 파일을 정리한다.
- 실패 후 retry를 위해 temp 파일은 가능한 보존한다.
- 사용자가 재시도하지 않고 실패 항목을 방치하면 temp 파일이 남을 수 있다. 이 정리 정책은 추후 별도 UX가 필요하다.

## Pause/Resume 정책

현재 구현:

- frontend queue pause는 새 queued item scheduling을 멈춘다.
- running transfer pause는 backend transfer control flag를 통해 chunk loop에서 대기한다.
- 이미 backend I/O 호출 내부에 들어간 순간은 즉시 끊지 않고 다음 chunk boundary에서 멈춘다.

범위 밖:

- 서버가 하나의 blocking write/read를 오래 붙잡는 경우 OS/라이브러리 레벨에서 즉시 멈추는 hard pause는 지원하지 않는다.
- SSH/SFTP 세션 자체 suspend/resume은 별도 기능으로 본다.

## Refresh 정책

- upload 완료 시 같은 remote identity를 보는 SFTP 패널은 remote refresh event로 갱신한다.
- download 완료 시 현재 Local pane path와 다운로드 대상 parent가 일치하면 local list를 갱신한다.
- remote move 완료 시 같은 remote identity를 가진 패널을 refresh한다.

## UI 주의사항

- SFTP favorites 위치는 현재 Local/Remote가 분리되어 있다. Commander의 좌측 Local/우측 Remote 구조와 sidebar 순서 조정은 보류 상태다.
- 기존 SFTP favorites/UI는 전송 큐 작업 중 불필요하게 건드리지 않는다.
- 하단 Transfer Queue가 보이지 않을 때는 상단 `View > Show View`에서 하단 view를 다시 표시할 수 있다.
- 전송 속도 표시는 소수점이 노출되지 않도록 `formatBytes` 계열 helper를 사용한다.

## 보안 / 안전 정책

- password, key passphrase 등 secret은 session data/localStorage에 저장하지 않는다.
- session에는 credential ref만 보관한다.
- 실제 secret은 Tauri credential store에서 조회한다.
- transfer log/UI message에 secret/private key/passphrase/password가 포함되지 않도록 한다.
- local path 기반 작업은 backend에서 경로 검증을 거친다.

## 1.0.4 준비 메모

- `v1.0.3`과 `v1.0.2` 태그가 같은 commit을 가리키고 있었다.
- 해당 commit의 version 파일은 `1.0.2` 상태였기 때문에, 실제 파일 기준으로는 `1.0.3` bump가 누락된 상태였다.
- 이번 release prep에서 version 파일을 `1.0.4`로 맞췄다.
- `v1.0.4` 태그 생성/푸시는 release cut 시점에 별도로 결정한다.

## 다음 고도화 후보

1. Temp 파일 정리 UX
   - 실패 후 retry하지 않고 방치된 upload/download temp 파일 정리 정책.
   - “재개 가능 항목 유지”와 “서버/로컬 찌꺼기 방지” 사이 TTL 정책 필요.
2. 대용량 실사용 검증
   - 3GB, 5GB, 10GB 파일 upload/download 장시간 테스트.
   - 느린 서버, NFS backend, 네트워크 지연/끊김 시나리오 포함.
3. Resume 검증 강화
   - size/mtime 외 checksum 또는 prefix checksum 정책 검토.
   - 비용이 큰 전체 checksum은 옵션 또는 샘플링 방식 검토.
4. 서버 간 전송
   - 다른 remote identity 사이 drag/drop.
   - backend mediated transfer, local temp 경유 여부, conflict dialog 정책 결정 필요.
5. Backend 분리
   - `sftp.rs`가 커지고 있으므로 안정화 후 session/file_ops/transfer/control 단위 분리 검토.
