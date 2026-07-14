# SFTP handoff

ShellPilot의 SFTP 영역은 SSH 세션/자격 증명 기반을 공유하면서, 각 workspace 패널 안에서 독립적으로 동작하는 원격 파일 탐색기입니다.

이 문서는 현재 구현 상태, 최근 안정화 내용, 남은 리스크를 다음 작업자가 빠르게 이어받기 위한 기준 문서입니다. `docs/sftp-design.md`는 과거 설계 내용이 섞여 있을 수 있으므로 참고용으로만 봅니다.

## 현재 목표

- SSH 세션에서 SFTP 탐색기를 열 수 있습니다.
- 같은 서버 또는 같은 session에서 여러 SFTP 패널을 열 수 있습니다.
- 각 패널은 독립적인 `panelId`, 현재 경로, 선택 상태, 전송 요약, 스크롤 위치를 가집니다.
- 초기 조회는 원격 home directory에서 시작합니다.
- 사용자는 breadcrumb/path edit으로 `/`, `/data` 같은 상위/절대 경로를 직접 탐색할 수 있습니다.
- password, key passphrase, known_hosts 검증은 SSH 공통 보안 정책을 공유합니다.
- 파일 전송 중 기존 원격/로컬 파일은 temp/backup 방식으로 가능한 범위에서 보호합니다.

## 주요 파일

Frontend:

- `src/features/sftp/SftpPanel.tsx`: SFTP 탐색기 조정자. lifecycle, selection, transfer, sidebar state를 연결합니다.
- `src/features/sftp/SftpPanelChrome.tsx`: 패널 프레임, 상태/오류/빈 상태 표시, 내부 Transfers 요약 배치.
- `src/features/sftp/SftpPanelHeader.tsx`: 상단 target/status, 경로, 탐색/액션 영역.
- `src/features/sftp/SftpFileTable.tsx`: 원격 파일 목록 table/grid.
- `src/features/sftp/SftpPanelTransferQueue.tsx`: SFTP 패널 내부의 compact transfer summary.
- `src/features/sftp/SftpTransferQueuePanel.tsx`: 하단 전역 Transfer Queue 패널.
- `src/features/sftp/useSftpBrowserLifecycle.ts`: `open/list/keepalive/close/reconnect/disconnect` lifecycle.
- `src/features/sftp/useSftpScrollRestoration.ts`: 경로별 파일 목록 스크롤 위치 복원.
- `src/features/sftp/useSftpPathActions.ts`: 경로 이동, breadcrumb, refresh.
- `src/features/sftp/useSftpFileActions.ts`: mkdir/rename/delete/download/upload 액션 연결.
- `src/features/sftp/useSftpTransfers.ts`: 전송 상태와 backend progress event 반영.
- `src/features/sftp/useSftpTransferActions.ts`: upload/download/cancel/retry 액션.
- `src/features/sftp/useSftpUploadDrop.ts`: drag-and-drop 업로드.
- `src/features/sftp/sftpTransferStore.ts`: 패널이 닫혀도 전역 queue가 참조할 수 있는 transfer event store.
- `src/features/sftp/sftpTransferQueueState.ts`: 하단 Transfer Queue 패널 open/close 상태.
- `src/features/sftp/sftpSidebarState.ts`: SFTP sidebar 상태, navigation/reconnect/disconnect event bus.
- `src/features/sftp/sftpBridge.ts`: Tauri command/listen 경계.
- `src/features/sftp/sftpAiContext.ts`: bound AI에 제공하는 SFTP snapshot.

Backend:

- `src-tauri/src/commands/sftp.rs`: SFTP 연결, 파일 작업, 전송, 진행 이벤트.
- `src-tauri/src/commands/ssh.rs`: 인증, known_hosts, credential resolution 등 공통 SSH 기반.
- `src-tauri/src/commands/credentials.rs`: secret 저장/조회.

Workspace/common:

- `src/App.tsx`: 전역 Transfer Queue 상태 연결.
- `src/features/workspace/Workspace.tsx`: 저장 레이아웃에서도 tab scrollbar 설정 보정.
- `src/features/workspace/workspaceLayout.ts`: 기본/복원 layout의 tab scrollbar 설정.
- `src/styles/flexlayout.css`: FlexLayout 탭바 overflow, overflow menu, bottom border tab 가독성 스타일.

## 패널 모델

- `panelId`가 backend SFTP session store의 key입니다.
- 같은 `session.id`에서도 여러 SFTP 패널을 열 수 있습니다.
- 패널을 닫으면 해당 `panelId`의 backend SFTP 세션을 닫습니다.
- 저장된 workspace layout 복원 시 파일 목록은 즉시 복원하지 않고 `restored` 상태에서 사용자가 reconnect할 수 있게 합니다.
- disconnect는 패널을 닫지 않고 backend 세션, 원격 목록, 선택, 이동 history를 정리합니다.
- reconnect는 같은 `panelId`에 새 backend SFTP 연결을 만들고 현재 UI를 다시 활성화합니다.

## Lifecycle 안정화 상태

현재 lifecycle은 다음 원칙으로 동작합니다.

- `sftp_open`은 backend에서 새 연결을 먼저 만든 뒤 session store에 교체합니다. 새 연결 실패 시 기존 연결을 먼저 끊지 않습니다.
- 기존 연결 교체 후 이전 connection과 해당 패널의 stream upload 잔여 상태를 정리합니다.
- frontend `useSftpBrowserLifecycle`은 directory request id를 사용해 늦게 끝난 `sftp_list` 결과가 최신 경로를 덮어쓰지 않도록 합니다.
- reconnect/disconnect/unmount 중 늦게 끝난 `sftp_open`이 닫힌 패널 상태를 되살리지 않도록 lifecycle generation을 비교합니다.
- 같은 패널에서 `openSftpSession` 요청이 겹치면 queue로 직렬화합니다.
- stale generation에서 open이 완료되면 backend `sftp_close`로 즉시 정리합니다.
- `sftp session is not open` 또는 유사한 session closed 오류는 list 단계에서 자동 reconnect 후 동일 경로 list를 한 번 재시도합니다.
- keepalive 실패는 현재 자동 reconnect하지 않고 `failed` 상태로 전환한 뒤 backend session을 닫습니다. 자동 복구 정책은 별도 결정이 필요합니다.

## Workspace / Sidebar 통합

SFTP sidebar:

- 열린 SFTP 탐색기를 현재 경로 중심으로 표시합니다.
- 같은 서버/경로의 탐색기는 중복을 줄여 표시합니다.
- remote bookmark는 저장된 경로를 다시 여는 진입점입니다.
- 탐색기 context menu는 open/reconnect/clone explorer/add bookmark/copy path/close를 제공합니다.
- bookmark context menu는 open/copy path/remove bookmark를 제공합니다.

Open Tabs sidebar:

- SSH, SFTP, RDP, VNC, Local, AI, Settings 탭을 보여줍니다.
- 서버별 그룹에서는 session name을 우선 사용하고 host/username은 보조 정보로 표시합니다.
- 연결 상태는 `connectionStatus.ts`의 publish/subscribe 상태를 사용합니다.
- 탭 context menu의 reconnect/disconnect는 기능별 lifecycle bus로 라우팅합니다.

## 탐색기 UI

현재 모드는 Remote Only 탐색기입니다.

```text
SFTP Panel
  Header
    - target/status
    - back / forward / refresh
    - new folder
    - upload / download
    - rename / delete
  Path bar
    - breadcrumb
    - direct path edit
    - copy path
  Remote file table
    - parent directory row
    - name / type / modified / permissions / owner / size
  Compact Transfers
    - latest/running/failed transfers for this panel
```

지원 기능:

- 원격 경로 이동
- breadcrumb 기반 탐색
- direct path edit
- 현재 경로 복사
- back/forward/refresh
- parent directory row
- 파일/디렉터리 목록 조회
- 정렬 및 컬럼 리사이즈
- 반응형 컬럼 표시
- 다중 선택, 범위 선택, Ctrl+A
- keyboard navigation과 scroll tracking
- 경로별 스크롤 위치 복원
- 새 폴더 생성
- 이름 변경
- 파일/폴더 삭제
- 잔여 temp/backup 파일 감지와 정리 액션

UI 주의:

- in-app scrollable 영역은 native-looking scrollbar 대신 `app-scrollbar`/`OverlayScrollArea` 기준을 유지합니다.
- FlexLayout 탭바 scrollbar는 FlexLayout mini scrollbar를 사용하되 ShellPilot 색상/두께로 맞춥니다.
- SFTP 패널 내부 compact Transfers는 빠른 확인용이고, 전체 관리/재시도/정리는 하단 전역 Transfer Queue가 담당합니다.

## 파일 전송

지원 범위:

- 파일 업로드
- 폴더 업로드
- drag-and-drop 파일/폴더 업로드
- 파일 다운로드
- 폴더 다운로드
- 다중 선택 업로드/다운로드
- 전송 취소
- 실패 항목 재시도
- 완료 항목 정리
- 다운로드 완료 후 로컬 폴더 열기

전송 queue는 frontend에서 상태를 병합하고, backend는 `shellpilot-sftp-transfer` 이벤트로 `started/progress/completed/failed/canceled`를 보냅니다.

전송 event payload의 핵심 필드:

```ts
interface SftpTransferEvent {
  panelId: string;
  transferId: string;
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  totalBytes: number;
  transferredBytes: number;
  status: 'started' | 'progress' | 'completed' | 'failed' | 'canceled';
  message?: string;
}
```

### 내부 queue와 전역 queue 역할

- SFTP 패널 내부 compact Transfers
  - 해당 패널에서 방금 발생한 전송의 빠른 상태 확인용입니다.
  - 좁은 패널에서도 보이도록 압축된 정보만 표시합니다.
  - 자세한 경로/오류/재시도는 전역 queue로 넘기는 UX가 적합합니다.

- 하단 전역 Transfer Queue
  - 여러 SFTP 패널/여러 서버의 전송을 한 곳에서 관리합니다.
  - 패널이 닫혀도 전송 이벤트 상태를 유지할 수 있도록 frontend transfer store를 사용합니다.
  - 향후 command mode 또는 여러 서버 동시 다운로드 시 중심 queue 역할을 합니다.

## 업로드 방식

### OS 경로 기반 업로드

업로드 버튼에서 파일/폴더를 선택하면 로컬 OS 경로를 Rust backend에 전달합니다.

- backend가 로컬 파일을 직접 읽습니다.
- 대용량 파일에 적합합니다.
- 폴더 업로드는 로컬 디렉터리를 재귀 순회합니다.
- 각 파일은 원격 temp 파일에 먼저 쓰고 finalize 단계에서 교체합니다.

### Drag-and-drop stream upload

WebView의 HTML5 drop `File` 객체에는 안정적인 OS 경로가 없을 수 있습니다. 그래서 drag-and-drop은 frontend가 파일 chunk를 읽고 Rust backend의 stream command로 전달합니다.

- `webkitGetAsEntry()`로 파일/폴더를 구분합니다.
- 폴더는 frontend에서 재귀 순회합니다.
- 파일 내용은 chunk 단위로 전달합니다.
- 임시 로컬 파일을 만들지 않습니다.
- 실패/취소 시 원격 temp 파일 정리를 시도합니다.

## 충돌 처리와 안전한 파일 교체

업로드 대상에 같은 이름의 원격 파일이 있으면 사용자에게 처리 방식을 묻습니다.

- Overwrite
- Overwrite All
- Skip
- Skip All
- Cancel

업로드 흐름:

```text
remotePath.tmp-shellpilot-{transferId} 에 기록
기록 성공
기존 remotePath가 있으면 remotePath.bak-shellpilot-{transferId} 로 rename
temp를 remotePath로 rename
성공하면 backup 삭제
실패하면 backup을 remotePath로 복구 시도
```

다운로드 흐름:

```text
localPath.tmp-shellpilot-{transferId} 에 기록
기록 성공
기존 localPath가 있으면 localPath.bak-shellpilot-{transferId} 로 rename
temp를 localPath로 rename
성공하면 backup 삭제
실패하면 backup을 localPath로 복구 시도
```

복구까지 실패하면 temp 또는 backup이 남을 수 있습니다. SFTP 탐색기는 현재 디렉터리에서 `.tmp-shellpilot-*`, `.bak-shellpilot-*` 패턴을 감지하고 사용자가 정리할 수 있게 합니다.

## Backend command

기본 command:

```text
sftp_open(target)
sftp_list(panelId, path)
sftp_keepalive(panelId)
sftp_mkdir(panelId, path)
sftp_rename(panelId, oldPath, newPath)
sftp_remove_file(panelId, path)
sftp_remove_dir(panelId, path)
sftp_close(panelId)
```

전송 command:

```text
sftp_upload(panelId, localPath, remotePath, transferId)
sftp_upload_stream_open(panelId, localPath, remotePath, transferId, totalBytes)
sftp_upload_stream_chunk(transferId, chunk)
sftp_upload_stream_close(transferId)
sftp_download(panelId, remotePath, localPath, transferId)
sftp_cancel_transfer(transferId)
```

로컬 helper:

```text
reveal_local_path(path)
```

## 보안 정책

- password와 key passphrase는 session data/localStorage에 저장하지 않습니다.
- credential ref만 session 데이터에 저장합니다.
- 실제 secret은 Tauri credential store에서 조회합니다.
- unknown host key는 fingerprint 확인 후 저장합니다.
- host key mismatch는 차단합니다.
- SFTP 실패 메시지는 host key, 인증, 네트워크, 권한 문제를 가능한 범위에서 구분합니다.
- 파일 전송 로그에는 secret, private key passphrase, password를 남기지 않습니다.
- `sftp.rs`에서 사용자/그룹 이름 조회는 `getent passwd/group` 또는 `/etc/passwd`, `/etc/group` fallback을 사용합니다. 이 명령 결과는 소유자 표시용 metadata이며 secret을 포함하지 않는 전제로 사용합니다.

## AI 연동

SFTP-bound AI 패널은 현재 SFTP 패널 snapshot을 받을 수 있습니다.

포함 정보:

- 현재 원격 경로
- 연결 상태
- visible entries
- selected entries
- session target metadata

AI는 SFTP context를 읽기 전용 참고 자료로 사용합니다. mutating file action은 별도의 승인 gate가 생기기 전까지 자동 실행하지 않습니다.

## 구현 완료 상태

- SSH 탭에서 SFTP 열기
- SFTP 연결 열기/닫기
- home directory 초기 조회
- 원격 목록 조회
- 경로 이동, breadcrumb, path edit, path copy
- back/forward/refresh
- parent directory row
- grid 정렬, 컬럼 리사이즈, 반응형 컬럼
- 다중 선택, 범위 선택, keyboard navigation
- 경로별 scroll restoration
- 새 폴더 생성
- 이름 변경
- 파일/폴더 삭제
- 파일/폴더 업로드
- drag-and-drop 파일/폴더 업로드
- 파일/폴더 다운로드
- 충돌 처리
- 전송 queue progress, 속도, cancel, retry, completed clear
- 패널 내부 compact Transfers
- 하단 전역 Transfer Queue
- 다운로드 완료 후 로컬 폴더 열기
- temp/backup 기반 안전 교체
- 잔여 temp/backup 감지 및 정리
- SFTP sidebar 열린 탐색기/북마크/경로 복사/clone/reconnect/disconnect
- Open Tabs 연결 상태 표시와 group action
- Bound AI context snapshot
- SFTP lifecycle request/generation guard
- SFTP open request serialization
- 저장/복원 workspace tabbar overflow 이동 지원

## 남은 검증/확장 항목

- Transfer Queue 실사용 장기 테스트
  - upload/download 진행률
  - 실패/취소/재시도 UX
  - 패널 닫힘 상태에서 전역 queue event/state 보존
  - 여러 서버 동시 다운로드
- keepalive 실패 후 자동 reconnect 여부 정책 결정
- Commander mode: WinSCP 스타일의 좌측 로컬/우측 원격 패널
- Pinned / Recent paths: 서버별 자주 가는 경로와 최근 경로
- 전송 고도화: 일시정지, 이어받기, 병렬 전송 수 설정
- 권한/소유자 고도화: uid/gid를 username/group name으로 변환하는 cache 전략
- backend `sftp.rs` 분리 검토
  - 현재는 안정화 중이라 단일 파일 유지
  - 분리한다면 `session/lifecycle/file_ops/transfer/errors` 정도의 의미 있는 단위로만 분리

## 유지보수 주의점

- SFTP 작업은 가능한 `src/features/sftp/**`와 `src-tauri/src/commands/sftp.rs` 안에 머무릅니다.
- workspace/sidebar 변경은 SFTP lifecycle route나 tab overflow처럼 공통 코드 수정이 꼭 필요한 경우에만 작게 수정합니다.
- 전송 취소/실패 경로에서는 temp/backup 정리를 항상 고려합니다.
- `OverlayScrollArea`/`app-scrollbar` 공통 스크롤 정책을 유지합니다.
- 대용량 drag-and-drop은 브라우저 memory를 많이 쓸 수 있으므로 chunk 흐름을 끊지 않게 합니다.
- `sftp_open` 앞뒤로 무조건 기존 session을 먼저 닫지 않습니다. 새 연결 성공 후 교체해야 reconnect 실패 시 기존 세션을 보존할 수 있습니다.
- 같은 패널의 open 요청이 겹치지 않도록 frontend queue/generation guard를 유지합니다.
