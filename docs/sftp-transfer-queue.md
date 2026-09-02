# SFTP Transfer Queue

> 상태: **활성 유지보수 / 전송 정책 기준 문서**

Last updated: 2026-09-02

이 문서는 ShellPilot SFTP 전송 큐의 현재 동작과 유지보수 정책을 정리한다.

## 목표

- 실패한 전송을 개별 retry할 수 있어야 한다.
- 실패 항목 전체를 `Retry failed`로 다시 enqueue할 수 있어야 한다.
- queue pause/resume과 running transfer pause/resume을 구분한다.
- completed/failed/canceled clear는 running item을 건드리지 않는다.
- upload/download 모두 대용량 파일에서 retry/resume/restart 경로가 안전해야 한다.

## Queue scheduling

Frontend scheduler는 `src/features/sftp/sftpTransferScheduler.ts`가 담당한다.

- `queued` item만 concurrency slot이 있을 때 실행한다.
- backend transfer event listener가 준비된 뒤에만 item을 dequeue하고 `running`으로 전환한다.
- listener 준비 실패는 item을 실패 처리하고 Promise를 종료하며 concurrency slot을 소비하지 않는다.
- queue가 paused이면 새 queued item scheduling을 멈춘다.
- 이미 `running`인 item은 queue pause만으로 자동 중단하지 않는다.
- concurrency는 UI에서 1~8 범위로 조정한다.
- 전송 terminal 상태 대기는 전역 store가 관리하므로 SFTP 패널을 닫아도 scheduler slot이 남지 않는다.

## Running pause/resume

Backend transfer control은 `src-tauri/src/commands/sftp.rs`의 transfer control map이 담당한다.

- pause 요청은 transfer control에 paused flag를 세운다.
- upload/download loop는 chunk boundary에서 pause flag를 확인하고 대기한다.
- resume 요청은 flag를 해제하고 waiter를 깨운다.
- cancel 요청은 canceled flag를 세우고 가능한 temp 파일을 정리한다.
- 상태 검사와 waiter 등록은 같은 동기화 경계에서 처리해 pause/resume/cancel 알림 유실을 막는다.

제한:

- 이미 진행 중인 blocking SFTP read/write 호출 자체를 즉시 preempt하지는 않는다.
- 따라서 UI에서 pause를 눌러도 현재 chunk 또는 현재 backend 호출이 끝난 뒤 멈출 수 있다.

## Retry

Retry는 기존 transfer item의 metadata를 재사용해 새 item을 enqueue한다.

재사용해야 하는 값:

- direction: upload/download
- source path
- target path
- total size
- panel id
- session/remote identity
- conflict decision
- uploadId/downloadId
- path upload의 local size/mtime metadata

정책:

- retry는 같은 uploadId/downloadId를 유지해 temp 파일 resume을 시도한다.
- temp 파일이 없거나 크기가 맞지 않거나 open/seek가 실패하면 backend가 restart 경로로 전환한다.
- path upload는 재시도 사이에 로컬 파일 size/mtime이 바뀌면 resume하지 않고 새 uploadId로 restart한다.

## Restart

Restart는 “이어올리기/이어받기”를 포기하고 처음부터 다시 보내는 명시 동작이다.

- upload는 새 uploadId를 만든다.
- download는 새 downloadId를 만든다.
- 기존 temp 파일은 재사용하지 않는다.
- UI에서는 failed item에 `Restart` 액션을 제공한다.

## Upload resume

Path upload:

- remote temp 파일 이름은 stable uploadId 기반이다.
- remote temp size가 expected local size 이하이면 해당 offset부터 이어 쓴다.
- local file size/mtime이 기존 retry payload와 다르면 restart한다.
- remote temp가 local보다 크거나 open/seek에 실패하면 temp를 제거하고 restart한다.

Dropped/stream upload:

- stream open 단계에서 resume offset을 받는다.
- frontend는 해당 offset만큼 browser File stream chunk를 skip한 뒤 이어 보낸다.
- browser File 객체를 그대로 재사용하는 동안에는 path upload보다 파일 변경 위험이 낮다.

Finalize:

- temp 파일에 전송 후 최종 remote path로 rename한다.
- close/flush timeout은 곧바로 실패가 아니라 size 확인과 finalize 확인으로 보정한다.
- rename 성공 직후 size confirm은 충분한 confirm timeout을 사용한다.
- overwrite backup은 성공 후 정리한다.

## Download resume

- local temp 파일 이름은 stable downloadId 기반이다.
- retry metadata의 remote size/mtime fingerprint가 현재 파일과 일치해야 resume을 허용한다.
- 기존 temp prefix와 현재 remote prefix가 일치해야 offset부터 이어받는다.
- 병렬 download writer는 앞에서부터 연속으로 완료된 범위만 재개 가능한 offset으로 기록한다.
- temp가 remote보다 크거나 open/seek 실패 시 temp를 제거하고 restart한다.
- 완료 후 temp를 최종 local path로 rename한다.
- 완료 이벤트를 받은 frontend는 현재 Local pane path와 다운로드 parent가 같을 때 목록을 refresh한다.

디렉터리 다운로드 안전 정책:

- 원격 entry는 단일 파일명으로만 해석하며 `..`, 절대 경로, 구분자와 Windows 예약 이름을 거부한다.
- Windows 대소문자 비구분 환경에서 같은 local path로 충돌하는 entry를 거부한다.
- 대상 root와 하위 디렉터리의 symlink, junction, reparse point를 거부하고 canonical path가 선택 root 안에 있는지 확인한다.

## Clear 정책

Clear finished 대상:

- `completed`
- `failed`
- `canceled`

Clear 대상 제외:

- `running`
- `queued`
- `paused`

이 정책은 사용자가 실수로 running transfer를 지우거나 상태 추적을 잃는 문제를 막기 위한 것이다.

## Temp cleanup 정책

현재:

- cancel은 temp 파일을 정리한다.
- failed는 retry/resume 가능성을 위해 temp 파일을 보존한다.
- restart는 새 id를 사용하므로 기존 temp를 재사용하지 않는다.

남은 과제:

- 사용자가 실패 항목을 방치하면 temp 파일이 남을 수 있다.
- 추후 TTL 기반 cleanup, “재개 가능한 임시파일 정리” UI, 또는 failed clear 시 cleanup 여부 선택 UX가 필요하다.

## 검증 체크리스트

필수:

- `npx tsc --noEmit`
- `cargo check`
- `npm run build`

수동 테스트:

- 10개 이상 파일 enqueue 시 전체 항목이 큐에 보이고 concurrency 수만큼만 running 되는지.
- 개별 failed retry.
- 전체 `Retry failed`.
- queue pause 상태에서 새 item이 queued로 남는지.
- running pause/resume이 chunk boundary에서 멈췄다가 재개되는지.
- completed/failed/canceled clear가 running item을 지우지 않는지.
- upload 완료 후 remote list refresh.
- download 완료 후 local list refresh.
- 1GB 이상 upload/download에서 close/finalize timeout이 잘 보정되는지.
- 3GB/5GB/10GB 파일에서 resume/restart 경로가 동작하는지.
