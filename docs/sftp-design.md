# SFTP 구현 설계

이 문서는 ShellPilot의 SFTP 기능을 앞으로 확장하기 위한 기준 설계입니다.

SFTP는 SSH 터미널의 보조 기능이면서도, 파일 전송 작업에서는 독립적인 작업 공간이 되어야 합니다. 따라서 기본은 가볍게 열리는 원격 파일 패널로 시작하고, 필요할 때 WinSCP 스타일의 좌/우 Commander 모드로 확장합니다.

## 목표

- SSH 세션에서 바로 SFTP 탭을 열 수 있어야 합니다.
- 동일 서버에 여러 SFTP 탭을 열어도 각 탭의 경로와 상태가 섞이면 안 됩니다.
- 기본 SFTP 탭은 터미널 옆에서 빠르게 쓰는 원격 파일 탐색기 역할을 합니다.
- 파일 업로드/다운로드가 필요한 사용자는 Commander 모드에서 로컬/원격을 나란히 볼 수 있어야 합니다.
- 비밀번호, passphrase, host key 검증은 기존 SSH 보안 정책을 그대로 재사용합니다.

## 탭 모델

SFTP 탭은 워크스페이스의 일반 패널과 동일하게 FlexLayout 탭으로 관리합니다.

- `panelId`는 SFTP 백엔드 연결의 기준 키입니다.
- 같은 `sessionId`에서 여러 SFTP 탭을 열 수 있습니다.
- 각 SFTP 탭은 독립적인 current remote path, selection, transfer state를 가집니다.
- SFTP 탭을 닫으면 해당 `panelId`의 백엔드 SFTP 세션도 정리합니다.

예시:

```text
SSH - 운영서버
SFTP - 운영서버            panelId: sftp-session-a
SFTP - 운영서버 /var/log   panelId: sftp-session-a-log
```

## 액티브 SSH 탭에서 SFTP 열기

액티브 SSH 터미널에서 SFTP 버튼을 누르면 해당 SSH 세션 정보를 기반으로 SFTP 탭을 생성합니다.

기본 동작:

1. 현재 활성 SSH 패널의 `sessionId`를 확인합니다.
2. 같은 host, port, username, auth method, credential ref를 사용합니다.
3. 새 SFTP 패널을 활성 탭 옆에 엽니다.
4. 기본 remote path는 서버의 home directory 또는 `/`로 시작합니다.
5. 이미 같은 SSH 세션에서 열린 SFTP 탭이 있으면 새로 열지 않고 기존 탭으로 이동하는 옵션을 나중에 둘 수 있습니다.

SFTP 탭에서 표출할 기본 정보:

- 연결 상태: connecting, connected, failed, closed
- 현재 원격 경로
- 원격 파일/폴더 목록
- 이름, 타입, 크기, 수정일, 권한
- 선택된 항목 정보
- 새로고침, 상위 폴더, 폴더 생성, 이름 변경, 삭제
- 업로드, 다운로드
- known_hosts 확인 필요, 인증 필요, 연결 실패 메시지

## 기본 모드: Remote Only

초기 SFTP 탭은 Remote Only 모드로 구현합니다.

이 모드는 터미널 앱에 가장 자연스럽습니다. 사용자가 SSH 작업 중 서버 파일을 빠르게 확인하거나 삭제, 다운로드, 업로드할 수 있습니다.

구성:

```text
SFTP 탭
  Toolbar
    - current path breadcrumb
    - refresh
    - up
    - new folder
    - upload
    - download
  Remote file list
  Selection/action bar
  Transfer mini status
```

Remote Only 모드에서 지원할 1차 기능:

- 원격 경로 이동
- 파일/폴더 목록 조회
- 새 폴더 생성
- 이름 변경
- 파일 삭제
- 빈 폴더 삭제
- 파일 다운로드
- 파일 업로드

## 확장 모드: Commander

사용자가 WinSCP처럼 좌측 로컬, 우측 서버를 보고 싶을 때는 SFTP 탭 내부에서 Commander 모드로 전환합니다.

구성:

```text
SFTP Commander
  Left: Local file browser
  Right: Remote file browser
  Bottom or side: Transfer queue
```

Commander 모드의 방향:

- 좌측은 로컬 파일 시스템입니다.
- 우측은 현재 SFTP 서버입니다.
- 좌측에서 우측으로 복사하면 upload입니다.
- 우측에서 좌측으로 복사하면 download입니다.
- 드래그 앤 드롭은 2차 단계에서 넣습니다.
- 1차는 버튼 기반 upload/download로 시작합니다.

Commander 모드는 별도 탭 타입으로 나누지 않고, SFTP 탭의 view mode로 관리합니다.

```ts
type SftpViewMode = 'remote-only' | 'commander';
```

## 좌측 Activity Sidebar

좌측 액티브 아이콘에서 SFTP를 선택하면 사이드바는 세션 등록 목록이 아니라 파일 작업 허브 역할을 합니다.

표출 후보:

- Open SFTP Sessions
  - 현재 열린 SFTP 탭 목록
  - 클릭 시 해당 SFTP 탭으로 이동
- Transfers
  - 업로드/다운로드 진행 중, 실패, 완료 항목
  - 재시도, 취소, 목록 비우기
- Pinned Paths
  - 서버별 자주 쓰는 원격 경로
  - 예: `/var/log`, `/opt/app`, `/home/deploy`
- Recent Paths
  - 최근 접근한 서버/경로

1차 구현은 Open SFTP Sessions와 Transfers만 넣고, Pinned Paths와 Recent Paths는 사용 흐름이 잡힌 뒤 추가합니다.

## 백엔드 명령 설계

SFTP 명령은 `sessionId`가 아니라 `panelId` 중심으로 설계합니다.

이유:

- 같은 서버를 좌/우로 여러 개 열 수 있습니다.
- 각 탭의 현재 경로와 연결 상태가 독립적이어야 합니다.
- FlexLayout의 탭 생명주기와 SFTP 연결 생명주기를 맞추기 쉽습니다.

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
sftp_cancel_transfer(transferId)
```

## 진행률 이벤트

업로드/다운로드는 Tauri command 응답만으로 처리하지 않습니다.

대용량 파일은 몇 초에서 몇 분까지 걸릴 수 있으므로, command는 전송 작업을 시작한 뒤 빠르게 반환하고 백엔드에서 비동기 작업을 실행합니다. 진행률은 Tauri event로 프론트엔드에 전달합니다.

이벤트 예시:

```text
sftp-transfer-progress
sftp-transfer-complete
sftp-transfer-failed
sftp-transfer-canceled
```

payload 예시:

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

## 보안 정책

SFTP는 SSH 보안 정책을 그대로 따릅니다.

- 비밀번호와 key passphrase는 session data/localStorage에 저장하지 않습니다.
- credential ref만 세션 데이터에 저장합니다.
- 실제 secret은 Tauri credential store에서 조회합니다.
- unknown host key는 fingerprint 확인 후 신뢰 저장합니다.
- host key mismatch는 차단합니다.
- SFTP 연결 실패 메시지는 host key, 인증, 네트워크, 권한 문제를 구분해서 표시합니다.
- 파일 전송 로그에는 secret, full credential id, private key passphrase를 남기지 않습니다.

## 구현 단계

### 1단계: Remote Only MVP

- SFTP 탭 생성
- SFTP 연결 열기/닫기
- 원격 파일 목록 조회
- 경로 이동
- 새로고침
- 새 폴더 생성
- 이름 변경
- 삭제
- 기본 에러 표시

### 2단계: 파일 전송

- 파일 업로드
- 파일 다운로드
- Tauri event 기반 진행률
- 전송 취소
- 실패 재시도
- Transfer queue UI

### 3단계: Commander 모드

- 로컬 파일 브라우저
- 좌/우 패널 레이아웃
- 버튼 기반 upload/download
- 로컬/원격 경로 기억
- 사이드바 Transfers 연동

### 4단계: 사용성 고도화

- 드래그 앤 드롭 업로드/다운로드
- Pinned Paths
- Recent Paths
- 다중 선택 작업
- 충돌 처리: 덮어쓰기, 건너뛰기, 이름 변경
- 권한/소유자 표시 개선

## 열어둔 결정 사항

- SFTP 버튼은 SSH 탭 툴바에 둘지, 탭 우클릭 메뉴에 둘지, 둘 다 둘지 결정이 필요합니다.
- 같은 SSH 세션의 SFTP 탭이 이미 있을 때 기존 탭을 활성화할지, 항상 새 탭을 만들지 결정이 필요합니다.
- Commander 모드에서 로컬 패널의 기본 경로를 어디로 둘지 결정이 필요합니다.
- transfer history를 앱 재시작 후에도 남길지, 실행 중 메모리에만 둘지 결정이 필요합니다.
