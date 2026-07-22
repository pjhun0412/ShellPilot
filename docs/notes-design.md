# Notes 설계 메모

> 상태: **활성 개발 / 기준 문서**
> 이 문서는 Notes의 현재 구현과 유지보수 정책을 함께 기록한다.

ShellPilot Notes는 SSH/SFTP/RDP/VNC 작업 중 필요한 메모, 런북, 서버별 작업 기록을 한 앱 안에서 관리하기 위한 Markdown 노트 기능이다. 현재 구현은 세션에 강제로 묶이지 않는 일반 노트를 기본으로 하며, 세션/그룹 연계는 추후 확장 항목으로 둔다.

## 현재 구현 범위

- Activity Bar에 `Notes` 항목을 제공한다.
- 좌측 Notes 패널은 Obsidian에 가까운 폴더/노트 트리 형태로 표시한다.
- 폴더와 노트는 inline 생성/이름 변경을 지원한다.
- 폴더와 노트는 우클릭 메뉴로 생성, 이름 변경, 삭제, 저장 위치 열기를 처리한다.
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
- wiki link, heading link, backlink/outgoing link, unlinked mention을 지원한다.
- 본문 태그를 추출해 태그 목록과 검색 필터에 반영한다.
- 이미지와 일반 파일 첨부를 지원하고 위험한 실행형 확장자는 안전한 파일명으로 바꾼다.
- 에디터/프리뷰 스타일은 GitHub Markdown Dark와 VS Code Dark 계열에 맞춘다.

## 저장 구조

Notes 데이터는 Tauri app data directory 아래에 저장한다.

```text
notes/
  index.json
  assets/
    note-*/
      image-*.png
  pages/
    운영/
      운영 점검.md
    Untitled note.md
```

`index.json`은 트리 표시, 제목/경로 검색, 본문 검색 preview를 위한 가벼운 메타데이터를 저장한다. 실제 본문은 `pages/{note.path}.md` 파일에 저장한다.
기존 버전에서 생성된 `pages/note-*.md` 파일은 읽기/검색 fallback으로 유지하고, 노트 저장/이름 변경/폴더 이동 시 `pages/{folder}/{title}.md` 형태로 자연스럽게 이동한다.
폴더 생성/이름 변경/삭제도 `pages/` 아래 실제 디렉터리와 동기화한다.
노트에 붙여넣거나 드롭한 이미지는 `assets/{noteId}/` 아래에 저장하고, Markdown 본문에는 `../assets/{noteId}/{fileName}` 상대 경로를 삽입한다.

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

`note-*` id는 노트의 안정적인 내부 식별자로 유지한다. 실제 Markdown 파일은 `pages/{folder}/{title}.md` 형태를 우선 사용하고, 각 경로 segment의 OS 금지 문자를 안전하게 치환한다. 기존 `pages/note-*.md`는 호환용 fallback으로 읽으며 다음 저장·이름 변경·이동 시 사용자 경로 기반 파일로 옮긴다.

## 백엔드 명령

파일: `src-tauri/src/commands/notes.rs`

- `notes_list()`
- `notes_create(title)` — `title`에는 정규화된 폴더 포함 경로를 전달할 수 있다.
- `notes_read(id)`
- `notes_update(id, content)`
- `notes_rename(id, title)`
- `notes_delete(id)`
- `notes_search(query)`
- `notes_save_asset(id, file_name, mime_type, data)`
- `notes_open_external_url(url)`
- `notes_reveal_root()`
- `notes_reveal_file(id)`
- `notes_reveal_assets(id)`
- `notes_create_folder(path)`
- `notes_rename_folder(old_path, new_path)`
- `notes_delete_folder(path)`

안정성 원칙:

- 노트 본문은 로그에 출력하지 않는다.
- note id는 허용된 prefix/문자만 사용한다.
- `index.json` 갱신은 임시 파일 쓰기 후 `fs::rename`으로 교체하는 atomic replace 패턴을 사용한다.
- Windows/macOS/Linux 모두 같은 저장 구조와 rename 방식을 사용한다. 파일명은 사용자가 보는 폴더/노트명을 최대한 유지하되, OS에서 사용할 수 없는 문자는 안전하게 치환한다.
- 폴더 삭제/이름 변경 후에는 앱이 관리하는 빈 디렉터리를 정리한다. 예상치 못한 사용자 파일이 남아 있는 디렉터리는 무리하게 지우지 않는다.
- 삭제 시에는 먼저 index를 정리하고, 본문 파일 삭제 실패는 사용자 메시지로 반환한다.
- 노트 삭제 또는 폴더 삭제 시 해당 노트의 asset 디렉터리도 함께 정리한다.
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
  - Notes 트리, 검색, 폴더/노트 생성, 이름 변경, 삭제, 저장 위치 열기, drag & drop 이동을 담당한다.
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
  - 이미지 paste/drop 이벤트를 처리해 asset 저장 후 Markdown 이미지 링크를 삽입한다.
  - Preview의 노트 asset 상대 경로는 Tauri asset URL로 변환한다.
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
- 폴더 우클릭의 저장 위치 열기는 논리 폴더가 아닌 실제 Notes 저장 루트를 연다.
- 노트 우클릭은 해당 Markdown 파일 위치와 노트별 asset 폴더를 열 수 있다.
- 폴더/노트 이동은 drag & drop으로 처리한다.
- 현재 열린 노트는 트리에서 활성 상태로 표시한다.
- 삭제된 노트의 열린 탭 정리는 `onClosePanel`로 연결한다.

## 자동 저장 정책

- 입력 후 700ms 동안 추가 입력이 없으면 저장한다.
- blur, Preview 전환, 컴포넌트 unmount 시 pending 저장을 flush한다.
- 저장 중 상태는 레이아웃을 흔들지 않는 방식으로만 표시한다.
- 저장 실패 시 본문은 화면에 유지하고 에러만 표시한다.
- 저장 성공 후 사이드바 트리와 검색 결과를 갱신한다.

## 첨부 asset 정책

- 이미지 붙여넣기와 이미지/일반 파일 drag & drop을 지원한다.
- 첨부는 노트별 `assets/{noteId}/` 디렉터리에 저장한다.
- 파일명은 원본 파일명을 기반으로 안전한 ASCII 파일명으로 정리하고 timestamp를 붙여 충돌을 피한다.
- 실행 파일 계열 확장자는 안전한 fallback 확장자로 바꾼다.
- 저장 가능한 첨부 크기는 50 MB로 제한한다.
- Markdown에는 이미지 `![alt](../assets/{noteId}/{fileName})`, 일반 파일 `[label](../assets/{noteId}/{fileName})` 형태로 삽입한다.
- Preview에서는 해당 상대 경로를 현재 노트의 asset 디렉터리 기준 파일 URL로 변환해 표시한다.
- 이미지 크기 조절, 첨부 목록 관리, 사용하지 않는 asset 정리는 추후 확장 항목이다.

## 향후 확장 항목

- 첨부 목록 관리, 이미지 크기 조절과 사용하지 않는 asset 정리
- 일반 Markdown 링크 클릭 시 같은 앱 안에서 노트 열기
- 검색 결과 다음/이전 이동
- 세션/그룹 관련 노트 연결
- SSH 선택 텍스트를 노트로 저장
- SFTP 경로를 노트로 저장
- Obsidian vault import/export
- 노트 즐겨찾기/최근 노트

## 구현 상세 기록

- Notes 사이드바의 일회성 오류 배너는 닫기 버튼을 제공하고, 5초 뒤 자동으로 사라진다.
- Notes 본문 패널의 읽기/저장 오류 배너는 닫기 버튼으로 사용자가 직접 닫을 수 있다.
- 폴더/노트 생성, 이름 변경, 삭제, drag & drop 이동, 저장 위치 열기에서 발생한 오류는 동일한 배너 흐름으로 표시한다.
- 오류 배너 타이머는 컴포넌트 unmount 시 정리해서 오래된 타이머가 다음 상태를 지우지 않도록 한다.
- Notes 로딩은 `notes_list()` 완료 여부에 따라 종료되며, 오류가 발생해도 로딩 상태가 계속 남지 않도록 `finally`에서 정리한다.
- `[[노트명]]`, `[[폴더/노트명]]`, `[[노트명|표시명]]` 형태의 1차 위키 링크를 지원한다.
- 노트 저장/검색 인덱스 갱신 시 본문에서 위키 링크를 추출해 `index.json`의 `links` 배열에 저장한다.
- Preview에서는 위키 링크를 클릭 가능한 링크로 렌더링하고, 같은 Workspace 안에서 대상 노트 탭을 열거나 기존 탭을 선택한다.
- Notes 패널 하단에는 현재 노트 기준 `Backlinks`와 `Outgoing` 링크를 표시한다.
- 없는 노트를 가리키는 링크는 unresolved 상태로 표시하고, Preview에서 클릭하면 해당 target 경로로 새 노트를 생성한 뒤 바로 연다.
- 에디터에서 `[[`를 입력하면 현재 노트 목록 기준으로 wiki 링크 자동완성을 표시한다.
- 자동완성 후보는 노트 제목과 경로를 함께 검색하고, 삽입 값은 `[[folder/note]]` 형태의 안정적인 경로를 우선 사용한다.
- 동일 제목 노트가 여러 개라 모호한 링크는 자동 생성하지 않고 `[[folder/note]]` 형태로 명확히 작성하도록 오류를 표시한다.

## Notes 2차 링크/태그/첨부 동작

- `[[노트#heading]]` 형태의 wiki 링크를 지원한다.
  - Preview 또는 Backlinks/Outgoing에서 클릭하면 대상 노트를 열고 해당 heading line으로 이동한다.
  - heading 매칭은 heading 제목과 slug를 기준으로 처리한다.
- 본문 저장/목록 재색인 시 Markdown heading, wiki link, `#tag`를 함께 추출한다.
- Notes 사이드바는 추출된 태그를 카운트와 함께 표시하고, 태그 클릭 시 `#tag` 검색으로 필터링한다.
- Unlinked mentions는 wiki link가 아니어도 다른 노트 제목이 본문에 언급된 라인을 인덱스에서 계산한다.
  - 현재 노트 하단 Links 패널에서 Mentions로 표시한다.
  - 클릭하면 언급한 노트를 열고 해당 라인으로 이동한다.
- 노트 또는 폴더 rename/move 시 다른 노트 본문의 wiki link target을 새 경로로 자동 갱신한다.
  - `[[old]]`, `[[old/path]]`를 대상으로 하며 alias(`|표시명`)와 heading(`#heading`)은 보존한다.
- 첨부파일은 이미지뿐 아니라 일반 파일도 저장할 수 있다.
  - 이미지는 `![label](../assets/...)`, 일반 파일은 `[label](../assets/...)` 형태로 삽입한다.
  - 실행 파일 계열 확장자는 저장 파일명에서 안전한 fallback 확장자로 바꾼다.
  - 첨부파일 크기는 50 MB까지 허용한다.
