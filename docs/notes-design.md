# Notes 설계 메모

ShellPilot Notes는 SSH/SFTP/RDP/VNC 작업 중 외부 메모 도구를 오가지 않도록 앱 내부에서 Markdown 작업 노트를 관리하는 기능이다. 현재 구현은 세션에 강제 연결하지 않는 일반 노트를 기본으로 하며, 세션/그룹 연결과 백링크는 후속 확장으로 둔다.

## 현재 1차 범위

- Active Bar에 `Notes` 항목 추가
- 좌측 Notes 패널에서 Obsidian식 path 기반 트리, 폴더/노트 inline 생성, 메타데이터/본문 검색 제공
- 폴더/노트 rename, delete, drag/drop 이동 제공
- 폴더는 비어 있어도 `index.json`에 별도 메타데이터로 저장
- 노트는 중앙 Workspace 탭에서 Markdown으로 편집
- CodeMirror 기반 Markdown 편집기와 `@uiw/react-markdown-preview` 기반 미리보기 제공
- Edit / Live / Preview 보기 모드 제공
- Bold/Italic/Link/Table/List/Checklist/Quote/Heading/Inline code 툴바 제공
- `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+K` 단축키 제공
- 라인 넘버 표시/숨김 토글 제공
- 입력 후 debounce 자동 저장
- Preview 전환, blur, 탭 unmount 시 pending 저장 flush
- `index.json`은 atomic replace 방식으로 저장

## 저장 구조

노트는 Tauri app data directory 아래에 저장한다.

```text
notes/
  index.json
  pages/
    note-*.md
```

`index.json`은 트리/검색에 필요한 가벼운 메타데이터와 본문 검색용 축약 인덱스를 보관한다.

```json
{
  "notes": [
    {
      "id": "note-20260717-...",
      "title": "고성스마트시티",
      "path": "운영/고성스마트시티",
      "tags": ["운영", "tomcat"],
      "createdAt": 1784282400000,
      "updatedAt": 1784283600000
    }
  ],
  "search": [
    {
      "id": "note-20260717-...",
      "text": "normalized searchable body text",
      "preview": "검색 결과 스니펫에 사용할 축약 본문",
      "updatedAt": 1784283600000
    }
  ],
  "folders": [
    {
      "path": "운영",
      "createdAt": 1784282400000,
      "updatedAt": 1784282400000
    }
  ]
}
```

본문은 `{id}.md` 파일로 저장한다. 파일명은 사용자 입력값을 사용하지 않고 내부 id만 사용해 path traversal과 파일명 충돌을 피한다.

## 백엔드 명령

`src-tauri/src/commands/notes.rs`

- `notes_list()`
- `notes_create(title)`
- `notes_read(id)`
- `notes_search(query)`
- `notes_update(id, content)`
- `notes_rename(id, title)`
- `notes_delete(id)`
- `notes_create_folder(path)`
- `notes_rename_folder(old_path, new_path)`
- `notes_delete_folder(path)`

보안/안정화 원칙:

- 노트 본문은 로그로 출력하지 않는다.
- id는 `note-` prefix와 안전한 문자만 허용한다.
- `index.json` 갱신은 `index.json.tmp` 작성 후 `fs::rename`으로 교체한다.
- Windows/macOS/Linux 모두 같은 디렉터리 내 rename을 사용한다.
- 삭제 시에도 index를 먼저 정리하고 본문 파일 삭제 실패는 사용자 메시지로 반환한다.

## 프론트 구조

```text
src/features/notes/
  notesBridge.ts
  notesTypes.ts
  NotesSidebar.tsx
  NotesPanel.tsx
  NotesPanelHeader.tsx
  NotesEditorToolbar.tsx
  NotesMarkdownEditor.tsx
  notesEditorCommands.ts
  notesEditorTheme.ts
```

- `NotesSidebar`: path 기반 트리/검색/새 노트·폴더 생성/rename/delete/drag-drop 이동
- `NotesPanel`: 노트 읽기, debounce 저장, 보기 모드, 에디터 커맨드 연결
- `NotesPanelHeader`: 노트 제목/path, 라인 넘버 토글, Edit/Live/Preview 모드 전환
- `NotesEditorToolbar`: Markdown 삽입 버튼
- `NotesMarkdownEditor`: CodeMirror 편집기, Markdown preview, 에디터/프리뷰 스크롤 위치 유지
- `notesEditorCommands`: Bold/Italic/Link/Table/List 등 에디터 조작 로직과 단축키 대상 커맨드
- `notesEditorTheme`: ShellPilot 다크 테마에 맞춘 CodeMirror syntax/color 설정
- `notesBridge`: Tauri command wrapper
- `notesTypes`: 공유 타입

## 에디터 정책

- 기본 모드는 `Live`이며 좌측에 Markdown 원문, 우측에 Preview를 표시한다.
- `Edit`은 편집기만, `Preview`는 렌더링 결과만 보여준다.
- Edit/Live/Preview 전환 시 가능한 범위에서 이전 스크롤 위치를 유지한다.
- Table 버튼은 선택 영역과 무관하게 테이블 템플릿을 삽입하고 첫 번째 헤더 셀을 선택한다.
- Bold/Italic/Inline code는 선택 영역을 감싸고, 선택 영역이 없으면 placeholder를 삽입한 뒤 placeholder를 선택한다.
- Link는 선택 텍스트가 있으면 URL 영역을 선택하고, 선택 텍스트가 없으면 링크 라벨 placeholder를 선택한다.
- Heading/List/Checklist/Quote는 멀티라인 선택 시 선택된 모든 줄에 prefix를 붙인다.
- CodeMirror selection layer는 끄고 브라우저 selection 색상을 VS Code 계열 파란색으로 맞춰 빈 여백까지 칠해지는 느낌을 줄인다.

## 검색 정책

검색은 `notes_search(query)` 명령을 통해 수행한다.

- title
- path
- tags
- 본문 축약 인덱스

저장 시 `index.json.search`에 정규화된 본문 텍스트와 스니펫용 preview를 갱신한다. 기존 노트처럼 검색 인덱스가 없는 항목은 첫 검색 시 누락분만 본문 파일에서 읽어 보강한 뒤 atomic replace로 저장한다. 사이드바는 입력 후 짧은 debounce를 거쳐 검색하고, 본문 매칭 결과에는 `Body · ...` 스니펫을 표시한다.

## 트리 표시 정책

- 사용자는 새 폴더/새 노트 생성/rename 시 `운영/고성스마트시티`처럼 `/`로 폴더 경로를 입력할 수 있다.
- 백엔드는 `path` 전체를 저장하고, `title`은 마지막 segment로 정규화한다.
- 프론트는 `path`를 `/` 기준으로 나눠 폴더/노트 트리로 표시하고, 폴더별 접기/펼치기를 관리한다.
- 폴더 안에서 새 폴더/새 노트를 만들 때는 이름만 입력하고, 부모 path는 프론트가 자동으로 붙인다.
- 폴더/노트 rename과 delete는 트리 항목 우클릭 메뉴에서 처리한다.
- 폴더/노트는 드래그해서 다른 폴더 아래로 이동할 수 있으며, 이동은 rename command를 재사용한다.
- 실제 본문 파일명은 여전히 내부 id만 사용하므로 사용자 path가 파일 시스템 경로가 되지 않는다.

## 자동 저장 정책

- 입력 후 약 700ms 동안 추가 입력이 없으면 저장한다.
- 저장 중/저장됨 상태는 UI에 계속 노출하지 않고, 오류만 하단 고정 영역에 표시한다.
- Preview 전환, editor blur, 컴포넌트 unmount 시 pending debounce를 flush해 마지막 입력 유실을 방지한다.
- 저장 실패 시 본문은 화면에 유지하고 오류만 표시한다.

## 후속 확장

- `[[노트명]]` 링크와 없는 노트 생성
- `#태그` 자동완성
- 검색어 하이라이트와 결과 내 위치 이동
- 세션/그룹 관련 노트 연결
- SSH 선택 텍스트를 노트에 저장
- SFTP 경로를 노트에 저장
- Obsidian vault import/export
