# Notes 설계 메모

ShellPilot Notes는 SSH/SFTP/RDP/VNC 작업 중 필요한 메모, 런북, 서버별 작업 기록을 한 앱 안에서 관리하기 위한 Markdown 노트 기능이다. 현재 구현은 세션에 강제로 묶이지 않는 일반 노트를 기본으로 하며, 세션/그룹 연계는 추후 확장 항목으로 둔다.

## 현재 구현 범위

- Active Bar에 `Notes` 항목을 제공한다.
- 좌측 Notes 패널은 Obsidian에 가까운 폴더/노트 트리 형태로 표시한다.
- 폴더와 노트는 inline 생성/이름 변경을 지원한다.
- 폴더와 노트는 우클릭 메뉴로 생성, 이름 변경, 삭제를 처리한다.
- 폴더/노트 drag & drop 이동을 지원한다.
- 노트는 중앙 Workspace 탭에서 Markdown으로 편집한다.
- 에디터는 CodeMirror 기반이고, Preview는 `@uiw/react-markdown-preview` 기반이다.
- 보기 모드는 `Edit`, `Live`, `Preview` 세 가지다.
- Markdown 툴바는 Bold, Italic, Heading, Link, Inline code, Quote, List, Checklist, Table 삽입을 지원한다.
- 단축키는 `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Ctrl/Cmd+K`를 지원한다.
- 라인 번호 표시/숨김을 지원한다.
- 입력은 debounce 저장하며, blur/unmount 시 pending 저장을 flush한다.
- 검색은 `index.json`의 경량 검색 인덱스를 사용하며, 파일별 검색 결과를 접고 펼칠 수 있다.
- 검색 결과 라인을 클릭하면 이미 열린 노트 탭을 재사용하고 해당 라인/검색어로 이동한다.
- 에디터/프리뷰 스타일은 GitHub Markdown Dark와 VS Code Dark 계열에 맞춘다.

## 저장 구조

Notes 데이터는 Tauri app data directory 아래에 저장한다.

```text
notes/
  index.json
  pages/
    note-*.md
```

`index.json`은 트리 표시, 제목/경로 검색, 본문 검색 preview를 위한 가벼운 메타데이터를 저장한다. 실제 본문은 `pages/{id}.md` 파일에 저장한다.

예시:

```json
{
  "notes": [
    {
      "id": "note-20260717-...",
      "title": "운영 점검",
      "path": "운영/운영 점검",
      "tags": ["운영", "tomcat"],
      "createdAt": 1784282400000,
      "updatedAt": 1784283600000
    }
  ],
  "folders": [
    {
      "path": "운영",
      "createdAt": 1784282400000,
      "updatedAt": 1784282400000
    }
  ],
  "search": [
    {
      "id": "note-20260717-...",
      "text": "normalized searchable body text",
      "preview": "검색 결과 목록에 표시할 본문 요약",
      "updatedAt": 1784283600000
    }
  ]
}
```

사용자가 입력한 노트 경로는 UI 트리와 메타데이터에서만 사용한다. 실제 파일명은 내부 `note-*` id를 사용해서 파일명 충돌, path traversal, OS별 특수문자 차이를 피한다.

## 백엔드 명령

파일: `src-tauri/src/commands/notes.rs`

- `notes_list()`
- `notes_create(title, folder_path)`
- `notes_read(id)`
- `notes_update(id, content)`
- `notes_rename(id, title)`
- `notes_delete(id)`
- `notes_search(query)`
- `notes_create_folder(path)`
- `notes_rename_folder(old_path, new_path)`
- `notes_delete_folder(path)`

안정성 원칙:

- 노트 본문은 로그에 출력하지 않는다.
- note id는 허용된 prefix/문자만 사용한다.
- `index.json` 갱신은 임시 파일 쓰기 후 `fs::rename`으로 교체하는 atomic replace 패턴을 사용한다.
- Windows/macOS/Linux 모두 같은 저장 구조와 rename 방식을 사용한다.
- 삭제 시에는 먼저 index를 정리하고, 본문 파일 삭제 실패는 사용자 메시지로 반환한다.
- 기존 검색 인덱스가 없거나 오래된 경우 검색 시 필요한 항목을 보강한다.

## 프론트 구조

```text
src/features/notes/
  notesBridge.ts
  notesTypes.ts
  notesNavigation.ts
  NotesSidebar.tsx
  NotesPanel.tsx
  NotesPanelHeader.tsx
  NotesEditorToolbar.tsx
  NotesMarkdownEditor.tsx
  notesEditorCommands.ts
  notesEditorTheme.ts
```

- `NotesSidebar`
  - Notes 트리, 검색, 폴더/노트 생성, 이름 변경, 삭제, drag & drop 이동을 담당한다.
  - 검색 결과가 있는 노트는 매칭 개수를 표시하고, 매칭 라인 목록을 접고 펼칠 수 있다.
  - 검색 결과 클릭 시 같은 노트가 이미 열려 있으면 기존 탭을 선택한다.
- `NotesPanel`
  - 노트 읽기, debounce 저장, 저장 flush, 보기 모드, 에디터 커맨드 연결을 담당한다.
  - 저장 성공 후 `notes changed` 이벤트를 보내 사이드바 검색/트리를 갱신한다.
- `NotesPanelHeader`
  - 노트 제목/path, 라인 번호 토글, Edit/Live/Preview 전환을 담당한다.
- `NotesEditorToolbar`
  - Markdown 삽입 버튼과 단축키 힌트를 제공한다.
- `NotesMarkdownEditor`
  - CodeMirror 에디터와 Markdown preview를 렌더링한다.
  - 검색 이동 시 현재 보기 모드를 유지하고, Edit/Live에서는 에디터의 해당 라인/검색어로 이동한다.
  - 검색 클릭으로 Preview 스크롤을 강제로 동기화하지 않는다.
- `notesEditorCommands`
  - Bold/Italic/Link/Table/List/Checklist/Quote/Heading/Inline code 삽입 로직을 담당한다.
  - 멀티라인 선택이 있는 경우 라인 prefix 계열 명령은 선택된 모든 줄에 적용한다.
- `notesEditorTheme`
  - CodeMirror 색상, 선택 영역, 검색 매치, Markdown syntax 색상을 정의한다.
- `notesNavigation`
  - 노트 검색 결과에서 열린 에디터로 이동하는 이벤트와 저장 후 갱신 이벤트를 관리한다.

## 에디터/프리뷰 UX 기준

Notes는 GitHub Markdown과 VS Code Dark 계열을 기준으로 한다.

- 에디터 배경은 GitHub Dark 계열 `#0d1117`을 사용한다.
- 본문 글자는 `#c9d1d9` 계열을 사용한다.
- 링크와 heading은 GitHub blue 계열로 표시한다.
- Preview는 GitHub README Dark에 가깝게 제목, 표, 코드블록, blockquote, hr, 링크 색상을 맞춘다.
- Preview 본문은 너무 넓게 퍼지지 않도록 최대 폭을 제한한다.
- 앱 전체 폰트 설정과 연동할 수 있도록 에디터 폰트/크기/줄 간격은 설정값을 통해 전달한다.
- CodeMirror selection layer는 끄고 브라우저 selection 색을 사용한다.
- 검색 매치는 선택 영역과 구분되는 색으로 표시한다.

보기 모드 정책:

- `Edit`: 에디터만 표시한다.
- `Live`: 에디터와 Preview를 나란히 표시한다.
- `Preview`: 렌더링 결과만 표시한다.
- 검색 결과 클릭은 사용자의 현재 보기 모드를 강제로 바꾸지 않는다.
- 검색 결과 클릭은 Edit/Live 모드에서 에디터 위치만 이동한다.
- 사용자가 보기 모드를 수동 전환할 때는 가능한 범위에서 이전 스크롤 위치를 복원한다.

## 검색 UX 기준

검색은 `notes_search(query)`를 통해 수행한다.

검색 대상:

- title
- path
- tags
- 본문 검색 인덱스

좌측 트리 검색 결과:

- 검색어가 있는 동안 트리는 검색 결과 중심으로 표시한다.
- 파일별로 매칭 개수를 표시한다.
- 각 파일 아래에 매칭 라인을 개별 행으로 표시한다.
- 기본적으로 일부 결과만 보여주고 `+N more matches`로 확장할 수 있다.
- 매칭 라인을 클릭하면 해당 노트 탭을 열거나 기존 탭을 선택한 뒤 해당 위치로 이동한다.
- 사이드바의 검색어 하이라이트와 에디터의 검색 매치 색상은 서로 비슷한 계열로 맞춘다.

## 트리 UX 기준

- 폴더 안에서 폴더/노트를 만들면 부모 path는 UI가 자동으로 붙인다.
- 사용자는 이름만 입력한다.
- 최상위에서 만들면 root path에 생성한다.
- rename 중에는 아이콘/화살표/행 높이가 흔들리지 않아야 한다.
- 우클릭 메뉴를 열 때 폴더 접힘/펼침이 같이 발생하지 않아야 한다.
- 폴더/노트 이동은 drag & drop으로 처리한다.
- 현재 열린 노트는 트리에서 활성 상태로 표시한다.
- 삭제된 노트의 열린 탭 정리는 `onClosePanel`로 연결한다.

## 자동 저장 정책

- 입력 후 700ms 동안 추가 입력이 없으면 저장한다.
- blur, Preview 전환, 컴포넌트 unmount 시 pending 저장을 flush한다.
- 저장 중 상태는 레이아웃을 흔들지 않는 방식으로만 표시한다.
- 저장 실패 시 본문은 화면에 유지하고 에러만 표시한다.
- 저장 성공 후 사이드바 트리와 검색 결과를 갱신한다.

## 향후 확장 항목

- 이미지/첨부 파일 붙여넣기와 로컬 asset 관리
- `[[노트명]]` 스타일 내부 링크
- 일반 Markdown 링크 클릭 시 같은 앱 안에서 노트 열기
- `#tag` 자동 인식과 태그 탐색
- 검색 결과 다음/이전 이동
- 세션/그룹 관련 노트 연결
- SSH 선택 텍스트를 노트로 저장
- SFTP 경로를 노트로 저장
- Obsidian vault import/export
- 노트 즐겨찾기/최근 노트