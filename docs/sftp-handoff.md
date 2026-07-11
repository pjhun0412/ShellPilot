# SFTP 현행 인계

SFTP는 SSH 세션의 보조 기능이 아니라, 워크스페이스 안에서 독립적으로 동작하는 원격 파일 탐색기입니다.

## 현재 목표

- SSH 세션에서 바로 SFTP 탭을 열 수 있습니다.
- 같은 서버에 여러 SFTP 탐색기 탭을 열 수 있습니다.
- 각 탭은 독립적인 `panelId`, 현재 경로, 선택 상태, 전송 상태를 가집니다.
- 초기 조회는 서버 home directory에서 시작합니다.
- 사용자는 breadcrumb/path edit으로 `/`, `/data` 같은 상위 경로도 직접 탐색할 수 있습니다.
- 비밀번호, key passphrase, known_hosts 검증은 SSH 보안 정책을 공유합니다.
- 파일 전송 중 기존 원격/로컬 파일은 temp/backup 방식으로 가능한 범위에서 보호합니다.

## 파일 지도

Frontend:

- `src/features/sftp/SftpPanel.tsx`: SFTP 탐색기 조정자.
- `src/features/sftp/SftpPanelHeader.tsx`: 상단 경로/액션 영역.
- `src/features/sftp/SftpFileTable.tsx`: 파일 목록 table/grid.
- `src/features/sftp/SftpTransferQueuePanel.tsx`: 하단 도킹 전송 큐.
- `src/features/sftp/SftpPanelTransferQueue.tsx`: 패널 내부 전송 큐 요약.
- `src/features/sftp/useSftpBrowserLifecycle.ts`: open/list/keepalive/close lifecycle.
- `src/features/sftp/useSftpPathActions.ts`: 경로 이동, breadcrumb, refresh.
- `src/features/sftp/useSftpSelection.ts`: 다중 선택, 범위 선택, keyboard selection.
- `src/features/sftp/useSftpFileActions.ts`: mkdir/rename/delete/download/upload 액션.
- `src/features/sftp/useSftpTransfers.ts`: 전송 상태와 progress event 반영.
- `src/features/sftp/useSftpUploadDrop.ts`: drag-and-drop 업로드.
- `src/features/sftp/sftpSidebarState.ts`: SFTP 사이드바 상태, navigation/reconnect/disconnect event bus.
- `src/features/sftp/sftpBridge.ts`: Tauri command/listen 경계.
- `src/features/sftp/sftpAiContext.ts`: bound AI에 제공할 SFTP snapshot.

Backend:

- `src-tauri/src/commands/sftp.rs`: SFTP 연결, 파일 작업, 전송, 진행 이벤트.
- `src-tauri/src/commands/ssh.rs`: 인증, known_hosts, credential resolution 등 공통 SSH 기반.
- `src-tauri/src/commands/credentials.rs`: secret 저장/조회.

## 패널 모델

- `panelId`가 백엔드 SFTP session store의 키입니다.
- 같은 `session.id`에서 여러 SFTP 탭을 열 수 있습니다.
- 탭을 닫으면 해당 `panelId`의 백엔드 SFTP 세션을 닫습니다.
- 저장된 workspace layout 복원 시 파일 목록을 즉시 복원하지 않고 reconnect 안내 상태로 시작할 수 있습니다.
- disconnect는 탭을 닫지 않고 백엔드 세션과 원격 목록/선택/이동 history를 정리합니다.

## Workspace / Sidebar 통합

SFTP sidebar:

- 열린 탐색기를 현재 경로 중심으로 표시합니다.
- 같은 서버/경로의 탐색기는 중복을 줄여 표시합니다.
- remote bookmark는 저장된 경로를 다시 여는 진입점입니다.
- 탐색기 컨텍스트 메뉴는 open, reconnect, clone explorer, add bookmark, copy path, close를 제공합니다.
- bookmark 컨텍스트 메뉴는 open, copy path, remove bookmark를 제공합니다.

Open Tabs sidebar:

- SSH, SFTP, RDP, 로컬 터미널, AI, Settings 탭을 보여줍니다.
- 서버별 그룹에서는 session name을 우선 사용하고 host/username은 보조 정보로 표시합니다.
- 연결 상태는 `connectionStatus.ts`의 publish/subscribe 상태를 사용합니다.
- 탭 메뉴의 reconnect/disconnect는 기능별 lifecycle bus로 라우팅해야 합니다.

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
  Transfer summary
```

지원 기능:

- 원격 경로 이동
- breadcrumb 기반 탐색
- direct path edit
- 현재 경로 복사
- back/forward/refresh
- parent directory row
- 파일/폴더 목록 조회
- 정렬 및 컬럼 리사이즈
- 반응형 컬럼 표시
- 다중 선택, 범위 선택, Ctrl+A
- keyboard navigation과 scroll tracking
- 새 폴더 생성
- 이름 변경
- 파일/폴더 삭제
- 잔여 temp/backup 파일 감지와 정리 액션

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

전송 queue는 프론트엔드에서 상태를 병합하고, 백엔드는 `shellpilot-sftp-transfer` 이벤트로 progress/completed/failed/canceled를 보냅니다.

전송 event payload의 핵심 필드:

```ts
interface SftpTransferProgress {
  panelId: string;
  transferId: string;
  direction: 'upload' | 'download';
  sourcePath: string;
  targetPath: string;
  totalBytes: number;
  transferredBytes: number;
}
```

## 업로드 방식

### OS 경로 기반 업로드

업로드 버튼에서 파일/폴더를 선택하면 로컬 OS 경로를 Rust 백엔드에 전달합니다.

- 백엔드가 로컬 파일을 직접 읽습니다.
- 대용량 파일에 적합합니다.
- 폴더 업로드는 로컬 디렉터리를 재귀 순회합니다.
- 각 파일은 원격 temp 파일에 먼저 쓰고 finalize 단계에서 교체합니다.

### drag-and-drop stream upload

WebView의 HTML5 drop `File` 객체에는 안정적인 OS 경로가 없을 수 있습니다. 그래서 드래그 앤 드롭은 프론트엔드가 파일 chunk를 읽고 Rust 백엔드의 stream command로 전달합니다.

- `webkitGetAsEntry()`로 파일/폴더를 구분합니다.
- 폴더는 프론트엔드에서 재귀 순회합니다.
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
sftp_open(panelId, target)
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
sftp_upload_stream_open(panelId, remotePath, transferId, totalBytes)
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
- credential ref만 세션 데이터에 저장합니다.
- 실제 secret은 Tauri credential store에서 조회합니다.
- unknown host key는 fingerprint 확인 후 저장합니다.
- host key mismatch는 차단합니다.
- SFTP 실패 메시지는 host key, 인증, 네트워크, 권한 문제를 최대한 구분합니다.
- 파일 전송 로그에는 secret, private key passphrase, password를 남기지 않습니다.

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
- 새 폴더 생성
- 이름 변경
- 파일/폴더 삭제
- 파일/폴더 업로드
- drag-and-drop 파일/폴더 업로드
- 파일/폴더 다운로드
- 충돌 처리
- 전송 큐, progress, 속도/ETA, cancel, retry, completed clear
- 다운로드 완료 후 로컬 폴더 열기
- temp/backup 기반 안전 교체
- 잔여 temp/backup 감지 및 정리
- SFTP sidebar 열린 탐색기/북마크/경로 복사/clone/reconnect/disconnect
- Open Tabs 연결 상태 표시와 group action
- Bound AI context snapshot

## 남은 확장 항목

- Commander mode: WinSCP 스타일의 좌측 로컬/우측 원격 패널
- Pinned / Recent paths: 서버별 자주 가는 경로와 최근 경로
- 전송 고도화: 일시정지, 이어받기, 연결 끊김 후 부분 재시도, 병렬 전송 수 설정
- 권한/소유자 고도화: uid/gid를 username/group name으로 변환하는 cache 전략

## 유지보수 주의점

- SFTP 작업은 가능한 `src/features/sftp/**`와 `src-tauri/src/commands/sftp.rs` 안에서 끝냅니다.
- workspace/sidebar 변경은 SFTP lifecycle route가 필요한 경우에만 좁게 수정합니다.
- 전송 취소/실패 경로에서는 temp/backup 정리를 항상 고려합니다.
- `OverlayScrollArea`/`app-scrollbar` 공통 스크롤 정책을 유지합니다.
- 대용량 drag-and-drop은 브라우저 memory를 많이 쓸 수 있으므로 chunk 흐름을 깨지 않게 합니다.
