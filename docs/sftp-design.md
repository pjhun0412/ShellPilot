# SFTP 구현 설계

이 문서는 ShellPilot SFTP 탭의 현재 구현 기준과 앞으로 확장할 방향을 정리합니다.

SFTP는 SSH 터미널의 보조 기능이지만 파일 작업 중에는 독립적인 원격 파일 탐색기처럼 동작해야 합니다. 현재는 Remote Only 탐색기와 전송 큐를 우선 구현했고, Commander 모드는 이후 확장 항목으로 남겨둡니다.

## 현재 목표

- SSH 세션에서 바로 SFTP 탭을 열 수 있습니다.
- 같은 서버에 여러 SFTP 탭을 열어도 각 탭의 경로, 선택 상태, 전송 상태가 섞이지 않아야 합니다.
- 초기 조회는 서버의 home directory에서 시작합니다.
- 사용자는 home 위로 이동할 수 있으며 `/`, `/data` 같은 상위 경로도 직접 탐색할 수 있습니다.
- 비밀번호, passphrase, known_hosts 검증은 SSH 보안 정책을 그대로 재사용합니다.
- 대용량 전송 중 기존 원격/로컬 파일을 가능한 한 안전하게 보호합니다.

## 탭 모델

SFTP 탭은 FlexLayout의 일반 패널과 동일하게 관리합니다.

- `panelId`는 SFTP 백엔드 연결의 기준 키입니다.
- 같은 `sessionId`에서 여러 SFTP 탭을 열 수 있습니다.
- 각 SFTP 탭은 독립적인 current remote path, selection, transfer queue를 가집니다.
- SFTP 탭을 닫으면 해당 `panelId`의 백엔드 SFTP 세션을 정리합니다.
- 앱 재시작 후 복원된 SFTP 탭은 파일 목록을 즉시 복원하지 않고 reconnect 안내를 표시합니다.
- SFTP disconnect는 탭을 유지하되 백엔드 세션을 닫고 원격 파일 목록, 선택 상태, 이동 히스토리를 비웁니다.

## 워크스페이스 네비게이션

ShellPilot은 SFTP 전용 사이드바와 공통 Open Tabs 사이드바를 함께 사용합니다.

SFTP 사이드바:

- 열린 SFTP 탐색기를 현재 경로 중심으로 표시합니다.
- 같은 서버/경로 탐색기는 중복 수를 함께 표시합니다.
- 원격 북마크를 저장하고 더블클릭 또는 Enter로 열린 SFTP 탭에 적용합니다.
- Transfer Queue 하단 패널로 진입할 수 있습니다.
- 탐색기 항목 우클릭 메뉴에서 open, reconnect, clone explorer, add bookmark, copy path, close를 제공합니다.
- 북마크 항목 우클릭 메뉴에서 open, copy path, remove bookmark를 제공합니다.

Open Tabs 사이드바:

- SSH, SFTP, Settings 등 워크스페이스 탭을 서버별 그룹 트리로 표시합니다.
- 서버 그룹명은 세션 등록 이름을 우선 사용하고, 접속 정보는 보조 정보로 표시합니다.
- SSH/SFTP 자식 탭은 그룹 아래에 들여쓰기하여 표시하고, 자식 항목에는 중복 서버 정보를 반복하지 않습니다.
- 각 탭과 그룹은 connected, connecting, failed, closed, restored, reconnect queued 상태 점을 표시합니다.
- 개별 탭 우클릭 메뉴는 reconnect, disconnect, clone, counterpart open, close others, close를 제공합니다.
- 그룹 우클릭 메뉴는 reconnect group, disconnect group, close group을 제공합니다.
- mount되지 않은 탭에 reconnect를 요청하면 pending 상태로 저장하고, 사용자는 노란 상태 점과 `Reconnect queued` 툴팁으로 대기 상태를 확인할 수 있습니다.

## 액티브 SSH 탭에서 SFTP 열기

액티브 SSH 터미널의 SFTP 버튼을 누르면 해당 SSH 세션 정보를 기반으로 SFTP 탭을 생성합니다.

기본 동작:

1. 현재 활성 SSH 패널의 세션 정보를 확인합니다.
2. 같은 host, port, username, auth method, credential ref를 사용합니다.
3. 새 SFTP 패널을 워크스페이스 탭으로 엽니다.
4. 연결 성공 후 서버 home directory를 조회합니다.
5. 탭 복원 상태에서는 reconnect 버튼으로 새 SFTP 세션을 엽니다.

## Remote Only 탐색기

현재 구현된 기본 모드는 Remote Only입니다.

구성:

```text
SFTP 탭
  Header
    - connection target
    - back / forward navigation
    - refresh
    - new folder
    - upload menu
    - download
    - rename
    - delete
  Path bar
    - breadcrumb
    - path edit
    - copy path
  Remote file grid
    - parent directory row
    - name / type / modified / permissions / owner / size
  Transfer queue
```

지원 기능:

- 원격 경로 이동
- breadcrumb 기반 경로 탐색
- 더블클릭 또는 `Ctrl+L` 경로 편집
- 현재 경로 복사
- 뒤로/앞으로 이동
- 파일/폴더 목록 조회
- parent directory 행을 통한 상위 이동
- 이름, 타입, 수정일, 권한, 소유자, 크기 표시
- 정렬 및 컬럼 리사이즈
- 좁은 패널에서 컬럼 축약 표시
- 마우스 선택, 범위 선택, 다중 선택, `Ctrl+A`
- 키보드 위/아래 이동 및 스크롤 추적
- 새 폴더 생성
- 이름 변경
- 파일 삭제
- 폴더 재귀 삭제
- 잔여 temp/backup 파일 감지 및 수동 정리

## 파일 전송

지원 범위:

- 파일 업로드
- 폴더 업로드
- 드래그 앤 드롭 파일 업로드
- 드래그 앤 드롭 폴더 업로드
- 파일 다운로드
- 폴더 다운로드
- 다중 선택 업로드/다운로드
- 전송 취소
- 실패 항목 재시도
- 완료 항목 정리
- 다운로드 완료 후 로컬 폴더 열기

전송 큐에는 다음 정보를 표시합니다.

- 방향: upload / download
- 파일명과 대상 경로
- 상태: queued, running, completed, failed, canceled
- 진행률
- 전송 속도
- ETA
- retry / cancel / reveal in explorer

현재 프론트엔드는 전송 작업을 최대 2개까지 병렬 실행합니다. 병렬 수는 네트워크와 서버 부하를 고려해 보수적으로 시작한 값입니다.

## 업로드 방식

업로드는 두 가지 경로를 사용합니다.

### OS 경로 기반 업로드

업로드 버튼에서 파일 또는 폴더를 선택하면 로컬 OS 경로를 Rust 백엔드에 넘깁니다.

- 백엔드가 로컬 파일을 직접 읽습니다.
- 대용량 파일에 적합합니다.
- 폴더 업로드는 로컬 디렉터리를 재귀 순회합니다.
- 각 파일은 원격 temp 파일에 먼저 기록한 뒤 finalize 단계에서 교체합니다.

### 드래그 앤 드롭 업로드

Tauri/WebView 환경에서는 표준 HTML5 drop의 `File` 객체에 OS 경로가 없습니다. 따라서 드래그 앤 드롭은 프론트엔드가 `File`을 청크로 읽고, Rust 백엔드의 SFTP stream command로 직접 전달합니다.

- `dataTransfer.items`와 `webkitGetAsEntry()`로 파일/폴더를 구분합니다.
- 폴더는 재귀 순회해서 상대 경로를 유지합니다.
- 파일 내용은 청크 단위로 읽어 Rust로 전달합니다.
- 임시 로컬 파일은 만들지 않습니다.
- 실패/취소 시 원격 temp 파일을 정리합니다.

## 충돌 처리

업로드 대상에 같은 이름의 원격 파일이 있을 때 사용자에게 처리 방식을 묻습니다.

- Overwrite
- Overwrite All
- Skip
- Skip All
- Cancel

폴더 업로드 중 같은 정책을 반복 적용할 수 있도록 `All` 옵션을 제공합니다. 실제 파일 교체는 파일 단위로 temp/backup finalize를 거치므로, 사용자가 덮어쓰기를 선택해도 전송 중 원본이 바로 truncate되지 않습니다.

## 안전한 파일 교체

전송 중 기존 파일 손상을 줄이기 위해 temp/backup 기반 finalize를 사용합니다.

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

최악의 경우 복구까지 실패하면 temp 또는 backup이 남을 수 있습니다. SFTP 탐색기는 현재 디렉터리에서 `.tmp-shellpilot-*`, `.bak-shellpilot-*` 패턴을 감지하고 사용자가 직접 정리할 수 있게 합니다.

## 백엔드 명령

SFTP 명령은 `sessionId`가 아니라 `panelId` 중심으로 동작합니다.

기본 command:

```text
sftp_open(panelId, target)
sftp_list(panelId, path)
sftp_mkdir(panelId, path)
sftp_rename(panelId, oldPath, newPath)
sftp_remove_file(panelId, path)
sftp_remove_dir(panelId, path)
sftp_close(panelId)
```

전송 command:

```text
sftp_upload(panelId, localPath, remotePath, transferId)
sftp_download(panelId, remotePath, localPath, transferId)
sftp_download_dir(panelId, remotePath, localPath, transferId)
sftp_cancel_transfer(transferId)
```

드래그 앤 드롭 stream upload command:

```text
sftp_upload_stream_open(panelId, remotePath, transferId, totalBytes)
sftp_upload_stream_chunk(transferId, chunk)
sftp_upload_stream_close(transferId)
```

로컬 편의 command:

```text
reveal_local_path(path)
```

## 진행률 이벤트

업로드/다운로드는 Tauri command 응답만으로 처리하지 않습니다.

대용량 파일은 오래 걸릴 수 있으므로 백엔드는 진행률을 Tauri event로 전달합니다.

이벤트:

```text
sftp-transfer-progress
sftp-transfer-complete
sftp-transfer-failed
sftp-transfer-canceled
```

payload:

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

프론트엔드는 이 이벤트를 전송 큐 상태와 병합하고, 전송 속도와 ETA는 클라이언트에서 계산합니다.

## 보안 정책

SFTP는 SSH 보안 정책을 그대로 따릅니다.

- 비밀번호와 key passphrase는 session data/localStorage에 저장하지 않습니다.
- credential ref만 세션 데이터에 저장합니다.
- 실제 secret은 Tauri credential store에서 조회합니다.
- unknown host key는 fingerprint 확인 후 신뢰 저장합니다.
- host key mismatch는 차단합니다.
- SFTP 연결 실패 메시지는 host key, 인증, 네트워크, 권한 문제를 구분해서 표시합니다.
- 파일 전송 로그에는 secret, full credential id, private key passphrase를 남기지 않습니다.
- Tauri dialog 권한은 파일/폴더 선택과 저장에 필요한 범위로만 사용합니다.

## 현재 구현 완료

- SSH 탭에서 SFTP 열기
- SFTP 연결 열기/닫기
- home directory 초기 조회
- 원격 목록 조회
- 경로 이동, breadcrumb, 경로 편집, 경로 복사
- back/forward/refresh
- parent directory row
- 그리드 정렬, 컬럼 리사이즈, 반응형 컬럼
- 다중 선택, 범위 선택, 키보드 탐색
- 새 폴더 생성
- 이름 변경
- 파일/폴더 삭제
- 파일/폴더 업로드
- 드래그 앤 드롭 파일/폴더 업로드
- 파일/폴더 다운로드
- 충돌 처리
- 전송 큐, 속도/ETA, 취소, 재시도, 완료 정리
- 다운로드 완료 후 로컬 폴더 열기
- temp/backup 기반 안전 교체
- 잔여 temp/backup 파일 감지 및 정리
- SFTP 탭 연결 상태 publish 및 Open Tabs/SFTP 사이드바 상태 표시
- SFTP 사이드바 열린 탐색기, 원격 북마크, 경로 복사, clone/reconnect/disconnect 메뉴
- Open Tabs 서버별 그룹, 연결 상태 replay, reconnect queued, 그룹 reconnect/disconnect/close 메뉴

## 남은 확장 항목

### 1. Commander 모드

WinSCP 스타일의 좌측 로컬, 우측 원격 패널입니다.

- 로컬 파일 브라우저
- 로컬/원격 양방향 복사
- 로컬 경로 기억
- 로컬 선택 항목과 원격 선택 항목의 전송 액션

### 2. Pinned / Recent Paths

서버별 자주 쓰는 원격 경로와 최근 경로를 저장합니다.

- Pinned Paths
- Recent Paths
- 사이드바 또는 path bar 메뉴 연동

### 3. 전송 고도화

- 일시정지
- 이어받기
- 연결 끊김 후 부분 재시도
- 병렬 전송 수 설정
- 대용량 전송 프로파일

### 4. 권한/소유자 고도화

현재는 SFTP attrs 기반 권한과 uid/gid 정보를 표시합니다. 서버별 `uid -> username`, `gid -> groupname` 치환은 추가 명령 또는 캐시 전략이 필요합니다.

## 열어둔 결정 사항

- 같은 SSH 세션의 SFTP 탭이 이미 있을 때 기존 탭을 활성화할지, 항상 새 탭을 만들지 결정이 필요합니다.
- Commander 모드에서 로컬 패널의 기본 경로를 어디로 둘지 결정이 필요합니다.
- transfer history를 앱 재시작 후에도 남길지, 실행 중 메모리에만 둘지 결정이 필요합니다.
- SFTP 전송 병렬 수를 고정값으로 둘지 설정값으로 노출할지 결정이 필요합니다.
