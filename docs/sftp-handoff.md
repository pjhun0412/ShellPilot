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
  - lifecycle, selection, transfer, commander/explorer mode, publishing hook, 작업 배너를 연결한다.
- `src/features/sftp/SftpPanelBody.tsx`
  - restored/closed/error 상태 카드, operation notice, empty/loading message, move status overlay, panel transfer summary를 담당한다.
  - `SftpPanel.tsx`는 body chrome 대신 Explorer/Commander content 선택과 hook wiring에 집중한다.
- `src/features/sftp/SftpPanelHeader.tsx`
  - 상단 target, view mode, navigation, refresh, new folder, action menu.
- `src/features/sftp/SftpPanelHeaderActions.tsx`
  - SFTP header의 navigation/action buttons, responsive action menu, view mode toggle 렌더링을 담당한다.
  - `SftpPanelHeader.tsx`는 target 표시와 action disabled 상태 계산, path bar export에 집중한다.
- `src/features/sftp/SftpPanelHeaderActionMenu.tsx`
  - SFTP header overflow action menu 항목 구성을 담당한다.
  - responsive header의 버튼 row와 menu item 상세 구성을 분리해 유지보수한다.
- `src/features/sftp/SftpPathBar.tsx`
  - Explorer mode의 remote path breadcrumb, path edit input, path copy/edit 버튼을 담당한다.
  - `SftpPanelHeader.tsx`가 target/action header에 집중하도록 path bar UI를 분리한다.
- `src/features/sftp/sftpPanelTypes.ts`
  - SFTP panel 공용 view mode/path segment 타입을 보관한다.
  - header/action/menu/hook 사이 type-only 의존이 `SftpPanelHeader.tsx`로 모이지 않도록 한다.
- `src/features/sftp/useSftpPanelHeaderActions.ts`
  - SFTP header의 Local/Remote action 분기, view mode 전환, action menu close 처리를 담당한다.
  - `SftpPanel.tsx`는 header action 구현을 직접 보유하지 않고 hook 반환값을 `SftpPanelHeader`에 전달한다.
- `src/features/sftp/useSftpDismissibleLayer.ts`
  - SFTP 내부 dropdown/menu layer의 outside pointer down과 Escape dismiss 로직을 공통 처리한다.
  - header action menu와 Commander action menu가 같은 dismiss 규칙을 공유한다.
- `src/features/sftp/SftpExplorerView.tsx`
  - Explorer 모드의 table wiring과 loading overlay를 묶는다.
  - `SftpPanel.tsx`는 Explorer/Commander 전환과 상태 연결에 집중하고, Explorer table shell은 이 파일에서 관리한다.
- `src/features/sftp/useSftpExplorerTable.ts`
  - Explorer table 생성, responsive column visibility, visible entry filtering, scroll restoration 연결을 담당한다.
  - `SftpPanel.tsx`는 table 내부 상태 대신 hook 반환값만 Explorer view/selection에 전달한다.
- `src/features/sftp/useSftpPanelHost.ts`
  - SFTP panel root의 active ref, focus capture, pointer activation, width measurement, activation selection 후보 추적을 담당한다.
  - `SftpPanel.tsx`는 tab/workspace focus 세부 처리 대신 hook 반환 handler와 `panelWidth`만 사용한다.
- `src/features/sftp/useSftpActivationSelectionSync.ts`
  - 비활성 패널을 클릭해 활성화할 때 임시 선택 후보가 실제 Explorer/Commander/Local 선택 상태에 반영되면 pending 상태를 정리한다.
  - `SftpPanel.tsx`는 activation selection 동기화 effect 세부 조건을 직접 보유하지 않는다.
- `src/features/sftp/useSftpDisplayPreferences.ts`
  - SFTP Explorer/Commander view mode, show hidden files preference, permissions 표시 상태를 담당한다.
  - `showHiddenFiles`는 settings preference에 저장하고, `SftpPanel.tsx`는 표시 상태 반환값만 사용한다.
- `src/features/sftp/useSftpPanelNavigation.ts`
  - SFTP path segment/parent path 계산, directory load 전 scroll 저장, back/forward scroll 저장, selected/open action을 담당한다.
  - `SftpPanel.tsx`는 navigation helper 반환값을 header/pathbar/table에 전달한다.
- `src/features/sftp/useSftpRemoteSelectionState.ts`
  - Explorer/Commander view mode에 따라 현재 active remote selected entries, 대표 selected entry, rename/delete/download 가능 여부를 계산한다.
  - `SftpPanel.tsx`는 선택 파생 상태 계산 대신 hook 반환값으로 header/action/file operation을 연결한다.
- `src/features/sftp/SftpFileTable.tsx`
  - Explorer 모드 원격 파일 grid.
  - 정렬, 선택, 범위 선택, remote move/drop target, upload drop target을 처리한다.
  - `SftpFileTableProps`를 export해 wrapper/adapter에서 같은 contract를 재사용한다.
- `src/features/sftp/SftpFileTableHeader.tsx`
  - Explorer table의 TanStack header 렌더링, sort indicator, column resize handle을 담당한다.
- `src/features/sftp/SftpFileTableContextMenu.tsx`
  - Explorer table context menu의 refresh/new folder/upload/download/rename/delete/display option 항목을 담당한다.
- `src/features/sftp/SftpFileTableRow.tsx`
  - Explorer table의 parent row와 file row 렌더링을 담당한다.
  - `SftpFileTable.tsx`는 scroll/context menu/drop shell에 집중하고, row selection/drag/drop/double-click UI detail은 이 파일에서 관리한다.
- `src/features/sftp/SftpCommanderView.tsx`
  - Commander 모드.
  - 좌측 Local/우측 Remote 배치, sort/drag source 상태를 조정한다.
- `src/features/sftp/SftpCommanderToolbarRow.tsx`
  - Commander Local/Remote pane 상단 action row를 담당한다.
  - `SftpCommanderView.tsx`는 action group 세부 props 조립 대신 pane 레이아웃에 집중한다.
- `src/features/sftp/useSftpCommanderSplit.ts`
  - Commander 좌우 pane split 비율, resize drag handler, grid style 계산을 담당한다.
  - split resize 상태가 view 조립 코드와 섞이지 않도록 분리한다.
- `src/features/sftp/SftpCommanderPane.tsx`
  - Commander Local/Remote pane shell, header, keyboard navigation, marquee selection, context menu 연결을 담당한다.
  - pane 내부 path bar/row/context menu/action handler를 묶어 `SftpCommanderView.tsx`가 상위 레이아웃에 집중하도록 한다.
- `src/features/sftp/SftpCommanderPaneBody.tsx`
  - Commander pane의 scrollable body, parent row, entry row list, loading/empty message, marquee overlay, context menu wiring을 담당한다.
  - `SftpCommanderPane.tsx`는 path/header/keyboard/action shell에 집중하고, list body 렌더링은 이 파일에서 관리한다.
- `src/features/sftp/SftpCommanderHeader.tsx`
  - Commander pane의 sortable column header와 sort indicator 렌더링을 담당한다.
  - `SftpCommanderPane.tsx`는 header markup/detail 대신 sort state와 activate handler만 전달한다.
- `src/features/sftp/useSftpCommanderPaneSelection.ts`
  - Commander pane의 정렬된 목록, keyboard navigation, range selection, marquee selection 상태/핸들러를 담당한다.
  - `SftpCommanderPane.tsx`는 pane UI 조립과 path edit/drag/drop 연결에 집중한다.
- `src/features/sftp/useSftpCommanderMarqueeSelection.ts`
  - Commander pane의 mouse drag marquee selection 시작/업데이트/종료 상태를 담당한다.
  - keyboard/range selection과 분리해 `useSftpCommanderPaneSelection.ts`가 focus/anchor selection orchestration에 집중하도록 한다.
- `src/features/sftp/useSftpCommanderOrchestration.ts`
  - Commander mode의 active pane, remote 선택 목록, Local browser hook 연결, remote 선택 토글을 담당한다.
  - `SftpPanel.tsx`는 Commander mode 상태를 직접 보유하지 않고 hook 반환값으로 header/commander view를 연결한다.
- `src/features/sftp/SftpCommanderActionGroup.tsx`
  - Commander Local/Remote pane 상단 action group과 compact overflow menu를 담당한다.
  - pane 폭에 따라 history/new-folder 버튼을 inline 또는 menu로 전환한다.
- `src/features/sftp/SftpCommanderActionMenu.tsx`
  - Commander pane overflow menu 항목 구성을 담당한다.
  - Local upload/copy/delete와 Remote upload/download/rename/delete/display option 메뉴를 분리해 관리한다.
- `src/features/sftp/SftpCommanderContextMenu.tsx`
  - Commander Local/Remote context menu를 담당한다.
  - Local upload/copy/delete와 Remote upload/download/rename/delete/show-hidden/show-permissions 메뉴를 분리해 관리한다.
- `src/features/sftp/SftpCommanderRow.tsx`
  - Commander Local/Remote grid row 표시, 선택 click 처리, drag/drop hook 연결, directory double-click open을 담당한다.
- `src/features/sftp/SftpCommanderPathBar.tsx`
  - Commander Local/Remote path bar, local root selector, breadcrumb navigation, path edit/copy/browse buttons를 담당한다.
- `src/features/sftp/sftpCommanderUtils.ts`
  - Commander 모드의 순수 타입, 상수, 정렬, drag payload, local path segment/helper를 담당한다.
  - Commander 계열 컴포넌트는 JSX/상태 연결 중심으로 유지하고, 순수 계산/문자열/drag helper는 이 파일에 둔다.
- `src/features/sftp/useSftpBrowserLifecycle.ts`
  - `open/list/keepalive/close/reconnect/disconnect` lifecycle.
- `src/features/sftp/useSftpAutoConnectLifecycle.ts`
  - SFTP panel mount 시 auto-connect/restored 상태 전환과 unmount cleanup을 담당한다.
  - `useSftpBrowserLifecycle.ts`는 directory load/reconnect/history 상태 흐름에 집중한다.
- `src/features/sftp/useSftpSidebarLifecycleEvents.ts`
  - SFTP sidebar navigation/reconnect/disconnect event 구독을 담당한다.
  - `useSftpBrowserLifecycle.ts`는 lifecycle 상태 전이와 directory load 흐름에 집중한다.
- `src/features/sftp/sftpLifecycleUtils.ts`
  - SFTP session connection key 생성과 error message 정규화 같은 lifecycle 순수 helper를 담당한다.
- `src/features/sftp/useSftpKeepalive.ts`
  - SFTP keepalive interval preference 구독, connected 상태 keepalive timer, 실패 시 cleanup/status/error 처리를 담당한다.
  - `useSftpBrowserLifecycle.ts`는 keepalive 세부 interval 처리 대신 lifecycle 상태와 clear callback만 전달한다.
- `src/features/sftp/useSftpRemoteMove.ts`
  - 원격 파일/폴더 이동 drag/drop.
  - 같은 remote identity 안에서 rename 기반 이동을 수행한다.
- `src/features/sftp/sftpRemoteRefresh.ts`
  - remote move 완료 후 같은 remote identity를 가진 SFTP 패널을 갱신하기 위한 frontend event bus다.
  - `SftpPanel.tsx`는 event bus 구현을 직접 보유하지 않고 subscribe/request 함수만 사용한다.
- `src/features/sftp/useSftpRemoteRefreshSubscription.ts`
  - session 기반 remote identity 계산과 같은 remote identity 패널 refresh 구독을 담당한다.
  - `SftpPanel.tsx`는 remote move 완료 시 반환된 identity로 refresh request만 발행한다.
- `src/features/sftp/useSftpTransferActions.ts`
  - upload/download, overwrite/skip dialog, transfer 시작 처리.
  - target directory 목록 조회와 overwrite/skip/cancel conflict decision은 `sftpTransferActionHelpers.ts`로 분리했다.
- `src/features/sftp/sftpTransferActionHelpers.ts`
  - transfer 대상 remote directory entry 조회와 overwrite/skip/cancel decision helper를 담당한다.
  - path upload, dropped upload, download pending transfer item 생성 helper를 제공해 retry payload/metadata shape를 한 곳에서 관리한다.
  - upload path, dropped upload, download 경로가 같은 conflict 정책을 공유하도록 한다.
- `src/features/sftp/sftpDroppedUploadActions.ts`
  - DataTransfer 기반 dropped upload plan 읽기, top-level conflict 처리, remote directory 보장, dropped file upload task 구성을 담당한다.
  - `useSftpTransferActions.ts`는 drag/drop upload 세부 절차 대신 transfer 시작 함수 연결에 집중한다.
- `src/features/sftp/sftpTransferDialogs.ts`
  - upload file/folder 선택, single file download save path, multi download target directory 선택 dialog를 담당한다.
  - `useSftpTransferActions.ts`에서 Tauri dialog 호출과 결과 정규화 로직을 분리한다.
- `src/features/sftp/useSftpTransfers.ts`
  - backend transfer event를 패널 상태와 전역 store에 반영한다.
- `src/features/sftp/useSftpPanelRemoteOperations.ts`
  - SFTP panel의 remote file operation 묶음을 담당한다.
  - transfer queue 연결, upload drag/drop, remote move drag/drop, create/rename/delete/cleanup action을 조립한다.
  - `SftpPanel.tsx`는 operation hook 반환값을 header/explorer/commander view에 전달하는 역할에 집중한다.
- `src/features/sftp/useSftpPanelPublishing.ts`
  - SFTP sidebar panel state와 AI context snapshot 발행/정리 side-effect를 담당한다.
  - `SftpPanel.tsx`는 발행 payload를 조합하지 않고 현재 상태만 hook에 전달한다.
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
- frontend 연결 상태 변경은 `useSftpBrowserLifecycle.ts` 내부 helper로 `connectionState`와 공통 tab/sidebar status publish를 함께 처리해 둘이 어긋나지 않게 한다.
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

리팩토링 후보:

- `SftpCommanderView.tsx`는 Commander 상위 pane 조립과 sort/drag source 상태만 담당하도록 줄였다.
- Commander split resize 상태는 `useSftpCommanderSplit.ts`로 분리했다. split 비율 계산과 mouse drag listener를 해당 hook에서 관리한다.
- Commander 상단 Local/Remote action row는 `SftpCommanderToolbarRow.tsx`로 분리했다. view 본문은 pane 레이아웃과 pane props 연결에 집중한다.
- Commander action group은 `SftpCommanderActionGroup.tsx`로 분리했다. action menu의 open/close, ResizeObserver 기반 compact 판단은 해당 파일에서 관리한다.
- Commander row는 `SftpCommanderRow.tsx`로 분리했다. row selection 지연 처리, drag 시작/종료 상태, remote move target 하이라이트는 해당 파일에서 관리한다.
- Commander context menu는 `SftpCommanderContextMenu.tsx`로 분리했다. Local/Remote 메뉴 차이를 이 파일 안에서 관리한다.
- Commander path bar는 `SftpCommanderPathBar.tsx`로 분리했다. Local root selector와 Remote breadcrumb/path action 영역을 해당 파일에서 관리한다.
- Commander pane shell은 `SftpCommanderPane.tsx`로 분리했다. header, keyboard navigation, marquee selection, context menu 연결을 해당 파일에서 관리한다.
- Commander pane selection 로직은 `useSftpCommanderPaneSelection.ts`로 분리했다. 정렬된 목록, keyboard navigation, range selection, marquee selection을 hook에서 관리한다.
- Commander mode orchestration은 `useSftpCommanderOrchestration.ts`로 분리했다. active pane, remote 선택 목록, Local browser 연결을 hook에서 관리한다.
- SFTP panel publishing side-effect는 `useSftpPanelPublishing.ts`로 분리했다. sidebar state와 AI context snapshot 발행/정리를 hook에서 관리한다.
- SFTP panel remote operation orchestration은 `useSftpPanelRemoteOperations.ts`로 분리했다. transfer queue, upload drop, remote move, remote create/rename/delete/cleanup 연결을 hook에서 관리한다.
- Explorer table shell은 `SftpExplorerView.tsx`로 분리했다. `SftpFileTable` wiring과 loading overlay를 해당 파일에서 관리한다.
- `SftpFileTableProps`를 export해 Explorer wrapper가 table contract를 재사용하도록 했다.
- SFTP panel header action 분기는 `useSftpPanelHeaderActions.ts`로 분리했다. Local/Remote action 선택과 action menu close 처리를 hook에서 관리한다.
- Explorer table state는 `useSftpExplorerTable.ts`로 분리했다. visible entry filtering, table column/sorting state, responsive column visibility, scroll restoration을 hook에서 관리한다.
- SFTP header action/menu 렌더링은 `SftpPanelHeaderActions.tsx`로 분리했다. header 본체는 target 표시와 disabled 상태 계산에 집중한다.
- SFTP panel body chrome은 `SftpPanelBody.tsx`로 분리했다. restored/closed/error, operation notice, empty/loading, move overlay, transfer summary를 해당 컴포넌트에서 관리한다.
- SFTP panel host 상태는 `useSftpPanelHost.ts`로 분리했다. root focus capture, pointer activation, active ref, ResizeObserver 기반 width 측정, activation selection 후보 추적을 hook에서 관리한다.
- SFTP transfer action의 conflict decision 반복은 `sftpTransferActionHelpers.ts`로 분리했다. upload path, dropped upload, download 경로가 같은 overwrite/skip/cancel 판정을 공유한다.
- SFTP keepalive 흐름은 `useSftpKeepalive.ts`로 분리했다. preference 구독, interval 실행, keepalive 실패 시 remote state cleanup/status/error 처리까지 hook에서 관리한다.
- 다음 분리 후보는 상태/동작 역할 기준이다.
  - `SftpPanel.tsx`에는 아직 open/reconnect/credential/restore 배너 orchestration이 남아 있으므로, 더 커지면 상태별 panel action hook 분리를 검토한다.
- 위 분리는 한 번에 크게 하지 말고, 각 단계마다 `npm run build`와 Commander 수동 동작 확인을 거친다.

## 유지보수 주의

- SFTP 작업은 가능한 `src/features/sftp/**`와 `src-tauri/src/commands/sftp.rs` 안에 머무른다.
- workspace/tab/focus 공통 코드는 꼭 필요할 때만 최소 수정한다.
- in-app scrollable 영역은 native scrollbar 대신 `app-scrollbar`/`OverlayScrollArea`를 사용한다.
- selection 로직은 Explorer/Commander 양쪽에서 재사용 관점으로 보되, Commander의 Local/Remote 상태 분리는 유지한다.
- remote move와 transfer는 overwrite/collision 정책이 다르므로 무리하게 합치지 않는다.
