# SFTP handoff

이 문서는 ShellPilot SFTP 영역의 현재 구현 상태와 다음 작업자가 바로 이어서 볼 핵심 내용을 정리한다. `docs/sftp-design.md`는 과거 설계 내용이 섞여 있을 수 있으므로 참고용으로만 본다.

## 현재 구현 요약

- SFTP는 SSH 세션 정보를 기반으로 열리는 원격 파일 탐색기다.
- 같은 서버/세션에서 여러 SFTP 패널을 동시에 열 수 있다.
- 각 SFTP 패널은 독립적인 `panelId`, 경로, 선택 상태, 이동 history, transfer 상태를 가진다.
- workspace 복원 후에는 파일 목록을 즉시 복원하지 않고 `restored` 상태에서 사용자가 reconnect하도록 한다.
- SFTP sidebar는 열린 explorer, remote bookmarks, transfer queue 진입점을 제공한다.
- 하단 전역 Transfer Queue는 여러 SFTP 패널/서버의 전송 상태를 통합해서 보여준다.
- 패널 내부 Transfers는 현재 패널에서 발생한 전송의 간단한 상태 확인용이다.

## 주요 파일

Frontend:

- `src/features/sftp/SftpPanel.tsx`
  - SFTP 패널의 상위 조정자.
  - lifecycle, selection, transfer, commander/explorer mode, sidebar state, 작업 배너를 연결한다.
- `src/features/sftp/SftpPanelHeader.tsx`
  - 상단 target, view mode, navigation, refresh, new folder, action menu.
- `src/features/sftp/SftpFileTable.tsx`
  - Explorer 모드 원격 파일 grid.
  - 정렬, 선택, 범위 선택, remote move/drop target, upload drop target을 처리한다.
- `src/features/sftp/SftpCommanderView.tsx`
  - Commander 모드.
  - 좌측 Local, 우측 Remote grid, split resize, 각 pane action, path bar, drag/drop 전송/이동을 처리한다.
- `src/features/sftp/useSftpBrowserLifecycle.ts`
  - `open/list/keepalive/close/reconnect/disconnect` lifecycle.
- `src/features/sftp/useSftpRemoteMove.ts`
  - 원격 파일/폴더 이동 drag/drop.
  - 같은 remote identity 안에서 rename 기반 이동을 수행한다.
- `src/features/sftp/useSftpTransferActions.ts`
  - upload/download, overwrite/skip dialog, transfer 시작 처리.
- `src/features/sftp/useSftpTransfers.ts`
  - backend transfer event를 패널 상태와 전역 store에 반영한다.
- `src/features/sftp/useLocalFileBrowser.ts`
  - Commander Local pane의 로컬 파일 목록, 선택, 폴더 생성/삭제.
- `src/features/sftp/sftpBridge.ts`
  - Tauri SFTP command/listen boundary.
- `src/features/sftp/sftpSidebarState.ts`
  - SFTP sidebar event/state bus.
- `src/features/sftp/sftpTransferQueueState.ts`
  - 하단 전역 Transfer Queue open/close state.

Backend:

- `src-tauri/src/commands/sftp.rs`
  - SFTP session store, file ops, transfer, progress event.
- `src-tauri/src/lib.rs`
  - SFTP command 등록.

## Lifecycle / 안정화 상태

- `sftp_open`은 새 연결이 성공한 뒤 기존 연결을 교체한다.
- frontend는 lifecycle generation/request guard를 사용해 오래된 `open/list` 결과가 최신 UI를 덮어쓰지 않게 한다.
- 같은 패널의 중복 open 요청은 queue로 직렬화한다.
- stale generation에서 open이 완료되면 backend `sftp_close`로 즉시 정리한다.
- `sftp session is not open` 또는 유사한 session closed 에러는 list 단계에서 자동 reconnect 후 동일 경로 list를 한 번 재시도한다.
- keepalive 실패는 현재 자동 reconnect하지 않고 failed 상태로 전환하며 backend session을 닫는다.

## Explorer 모드

지원 상태:

- 원격 경로 이동
- breadcrumb 기반 이동
- direct path edit
- path copy
- back / forward / refresh
- parent directory row
- 파일/폴더 목록 조회
- Name / Modified / Size 중심의 responsive grid
- 정렬
- 다중 선택, 범위 선택, Ctrl+A
- keyboard navigation 및 선택 row scroll tracking
- 경로별 scroll position 복원
- 새 폴더 생성
- rename / delete
- upload / download
- remote 파일/폴더 이동 drag/drop

최근 정리된 UI 동작:

- SFTP 탭/패널이 비활성화되면 내부 선택 UI는 숨긴다.
- 비활성 탭을 다시 클릭할 때 기존 선택 UI가 먼저 깜빡이지 않도록 클릭 대상 row 또는 빈 공간 클릭 상태를 임시로 반영한다.
- 전체 선택 시 odd row 배경이 섞이지 않도록 선택 row 색상을 통일했다.
- 빈 영역에 remote item을 drop하면 현재 경로로 이동한다.
- 폴더 row에 drop하면 해당 폴더 안으로 이동한다.
- 파일 row 위 drop은 이동으로 처리하지 않는다.

## Commander 모드

현재 목적:

- WinSCP 계열처럼 좌측 Local, 우측 Remote를 동시에 보며 upload/download를 빠르게 수행한다.

지원 상태:

- Local / Remote 양쪽 grid 표시.
- Local drive/root 변경.
- Local path 직접 edit 및 OS folder picker.
- Remote path breadcrumb/edit/copy.
- Local / Remote back, forward, refresh, new folder.
- Local folder 생성/삭제.
- Remote folder 생성/rename/delete/download/upload.
- 각 pane 정렬.
- 각 pane keyboard navigation, Shift 범위 선택, Ctrl+A.
- mouse marquee 범위 선택.
- Local -> Remote drag/drop upload.
- Remote -> Local drag/drop download.
- Remote -> Remote drag/drop move.
- Remote move 완료 후 같은 remote identity를 가진 SFTP 패널은 refresh event로 갱신한다.

UI/상태 주의:

- Commander의 Local/Remote 선택 상태는 내부적으로 각각 유지한다.
- SFTP 패널 자체가 비활성일 때는 Commander 내부 선택 UI도 숨긴다.
- active pane만 선택 하이라이트를 보여준다.
- 상단 action은 Local pane이 활성일 때 local action, Remote pane이 활성일 때 remote action으로 동작한다.
- Commander more action menu는 panel action group 안에서 clipping되지 않도록 overflow를 열어둔다.

## Remote move / server-to-server 상태

현재 구현:

- 같은 remote identity 안에서는 rename 기반 이동을 지원한다.
- remote identity는 `username@host:port` 기반으로 만든다.
- 같은 서버를 좌/우 두 SFTP 패널로 열어 둔 경우에도 같은 remote identity면 이동 후 양쪽 패널을 refresh한다.
- 이동 전 대상 경로 존재 여부를 `sftp_path_exists`로 확인한다.
- 같은 이름이 있으면 이동하지 않고 작업 배너로 알린다.
- 일부만 실패한 경우 성공한 항목 수와 실패 항목을 작업 배너로 알린다.

아직 제한:

- 다른 remote identity 사이의 서버 대 서버 전송은 아직 실제 복사/전송으로 구현하지 않았다.
- 현재는 “Server-to-server transfer is not ready yet...” 작업 배너로 안내한다.
- 추후 서버 간 전송은 direct server-to-server가 아니라 download-to-temp 후 upload 또는 backend mediated transfer 정책 결정이 필요하다.

## 작업 배너 / 오류 표시

- 연결/lifecycle 오류는 기존 SFTP error 영역을 사용하며 Reconnect 버튼을 보여준다.
- 파일 작업 오류는 연결 오류와 분리된 작업 배너로 보여준다.
- Remote move 충돌/부분 실패/지원 안 됨은 작업 배너를 사용한다.
- 작업 배너는 닫기 버튼을 제공한다.

## Transfer Queue

역할 분리:

- 패널 내부 Transfers
  - 현재 SFTP 패널에서 방금 발생한 전송의 빠른 상태 확인용.
  - 긴 경로/상세 오류/재시도는 전역 queue가 주 역할이다.
- 하단 전역 Transfer Queue
  - 여러 SFTP 패널/서버의 upload/download를 한 곳에서 관리한다.
  - 닫혀 있어도 transfer store가 event를 받도록 유지한다.

지원 상태:

- 파일 upload/download
- 폴더 upload/download
- drag/drop upload/download
- 다중 선택 upload/download
- progress/speed/size/status 표시
- cancel/retry/clear finished
- upload collision dialog
- download collision dialog
- download 완료 후 Commander Local pane refresh

주의:

- 로컬 경로는 Windows extended path prefix가 UI에 노출되지 않도록 표시 계층에서 정리한다.
- 에러 메시지는 가능한 한 작업 맥락을 포함해 표시한다.

## Backend command

주요 SFTP command:

```text
sftp_open
sftp_list
sftp_keepalive
sftp_mkdir
sftp_rename
sftp_remove_file
sftp_remove_dir
sftp_close
sftp_path_exists
```

전송 command:

```text
sftp_upload
sftp_upload_stream_open
sftp_upload_stream_chunk
sftp_upload_stream_close
sftp_download
sftp_download_dir
sftp_cancel_transfer
```

Local helper:

```text
list_local_directory
create_local_directory
delete_local_path
reveal_local_path
```

## 보안 / 안전 정책

- password, key passphrase는 session data/localStorage에 저장하지 않는다.
- session에는 credential ref만 보관한다.
- 실제 secret은 Tauri credential store에서 조회한다.
- unknown host key는 fingerprint 확인 후 저장한다.
- host key mismatch는 차단한다.
- transfer log와 UI 메시지에는 secret/private key/passphrase/password가 포함되지 않아야 한다.
- 파일 전송은 temp/backup finalize 흐름으로 가능한 범위에서 기존 파일 손상을 줄인다.
- remote move는 이동 전 destination 존재 여부를 확인해 의도치 않은 overwrite를 막는다.

## 구현 완료 상태

- SFTP open/close/reconnect/disconnect
- session restore card
- SFTP sidebar open explorers/bookmarks/queue
- Explorer mode
- Commander mode 기본 UI
- Local/Remote path navigation
- Local folder create/delete
- Remote folder create/rename/delete
- Upload/download
- Upload/download overwrite/skip dialog
- Transfer Queue
- Remote same-server move
- Remote move collision check
- Remote move operation banner
- Same remote identity panel refresh
- Selection UI inactive panel hiding
- Scroll restoration
- App scrollbar / OverlayScrollArea 적용

## 남은 작업 후보

우선순위 후보:

1. 서버 간 전송 정책 결정 및 구현
   - 다른 remote identity 사이 drag/drop.
   - backend mediated transfer 방식, 임시 로컬 경유 여부, collision dialog 정책 필요.
2. Commander UX 추가 안정화
   - Local/Remote action 반응형 세부 조정.
   - 더블 클릭/키보드/컨텍스트 메뉴 edge case 실사용 점검.
3. Transfer Queue 고도화
   - 대용량/다중 서버 동시 전송 장시간 테스트.
   - 실패/취소/재시도 UX 점검.
4. Lifecycle 장기 안정성 테스트
   - 여러 서버, 여러 패널, reconnect/disconnect/open tabs group action 반복 테스트.
5. Backend `sftp.rs` 분리 검토
   - 현재는 안정화 우선으로 단일 파일 유지.
   - 분리한다면 `session/lifecycle/file_ops/transfer/errors` 정도의 의미 있는 단위로만 분리한다.

## 유지보수 주의

- SFTP 작업은 가능한 `src/features/sftp/**`와 `src-tauri/src/commands/sftp.rs` 안에 머무른다.
- workspace/tab/focus 공통 코드는 꼭 필요할 때만 최소 수정한다.
- in-app scrollable 영역은 native scrollbar 대신 `app-scrollbar`/`OverlayScrollArea`를 사용한다.
- selection 로직은 Explorer/Commander 양쪽에서 재사용 관점으로 보되, Commander의 Local/Remote 상태 분리는 유지한다.
- remote move와 transfer는 overwrite/collision 정책이 다르므로 무리하게 합치지 않는다.
