# ShellPilot 1.0.3 릴리스 노트

작성일: 2026-07-19

## 요약

1.0.3은 Notes 패널을 Obsidian 스타일의 로컬 마크다운 노트/런북 공간으로 확장한 릴리스입니다. 노트 트리, CodeMirror 기반 마크다운 편집, 검색, wiki link, 백링크, 태그, 첨부파일 흐름을 중심으로 정리했습니다.

## 주요 변경

### Notes 패널

- Active Bar에 Notes 영역을 추가했습니다.
- 로컬 노트 저장소는 앱 데이터 디렉터리 아래 `notes/`에 저장합니다.
- 폴더/노트 트리 UI를 추가하고 폴더 접기/펼치기, 생성, rename, 삭제, 이동 흐름을 정리했습니다.
- F2 rename, Delete 삭제 확인 등 기본 키보드 조작을 지원합니다.
- 노트/폴더 우클릭 메뉴에서 파일 위치 열기 등 파일 기반 작업을 사용할 수 있습니다.

### Markdown 편집기

- `@uiw/react-codemirror`와 `@codemirror/lang-markdown` 기반 편집기로 전환했습니다.
- Edit, Live, Preview 모드를 지원합니다.
- line number 표시 토글을 지원합니다.
- Bold, Italic, heading, link, code, quote, list, checklist, table 삽입 툴바를 추가했습니다.
- 에디터 선택 색상, 커서, 하이라이트, 스크롤 스타일을 ShellPilot 다크 테마에 맞췄습니다.
- 앱 설정의 editor font family/font size 설정을 Notes 편집기에 연결했습니다.

### 검색

- 노트 제목, 경로, 태그, 본문 라인 기반 검색을 지원합니다.
- 검색 결과는 파일별로 접고 펼칠 수 있습니다.
- 각 검색 결과 라인을 클릭하면 해당 노트와 라인으로 이동합니다.
- 에디터 안의 검색어 match와 선택된 match를 구분해 표시합니다.

### Wiki link, 백링크, 멘션

- `[[노트]]`, `[[폴더/노트]]`, `[[노트#heading]]`, `[[노트|alias]]` 형태의 wiki link를 지원합니다.
- wiki link 클릭 시 대상 노트를 열고, heading이 있으면 해당 heading 라인으로 이동합니다.
- 링크 대상이 없으면 새 노트를 생성할 수 있습니다.
- 노트 rename 또는 폴더 이동 시 기존 wiki link를 새 경로로 자동 갱신합니다.
- 백링크, outgoing link, unlinked mention 패널을 추가했습니다.
- 기존 index가 오래된 경우 `notes_list` 시점에 heading/link/tag/mention 정보를 백필합니다.

### 태그

- 본문 안의 `#tag`를 추출해 노트 메타와 검색 인덱스에 반영합니다.
- Notes 사이드바에 태그 목록과 사용 횟수를 표시합니다.
- 태그 클릭 시 해당 태그로 검색 필터링합니다.

### 첨부파일

- 이미지뿐 아니라 일반 파일도 노트 첨부로 저장할 수 있습니다.
- 이미지는 Markdown 이미지 링크로, 일반 파일은 Markdown 파일 링크로 삽입합니다.
- 첨부파일은 노트별 asset 디렉터리에 저장합니다.
- 실행형/스크립트형 위험 확장자는 안전한 fallback 확장자로 저장합니다.
- 첨부파일 크기 제한은 50 MB입니다.

## 배포 산출물

Windows release 스크립트 기준 산출물:

- `ShellPilot-1.0.3-setup.exe`
- `ShellPilot-1.0.3-setup.exe.sig`
- `ShellPilot-1.0.3-portable.zip`
- `latest.json`

`latest.json`은 Windows updater용 `windows-x86_64` platform 항목을 포함합니다.

## 자동 업데이트

1.0.2 설치형 앱이 프로덕션 빌드이고 updater endpoint에 접근 가능하면, 1.0.3 릴리스의 `latest.json`을 확인한 뒤 업데이트 확인 대화상자가 뜹니다.

조건:

- GitHub Release `v1.0.3`에 `latest.json`이 업로드되어 있어야 합니다.
- `latest.json`의 version이 `1.0.3`이어야 합니다.
- `ShellPilot-1.0.3-setup.exe`와 `.sig`가 함께 업로드되어 있어야 합니다.
- 사용자가 업데이트에 동의해야 설치가 진행됩니다.

## 검증

이번 릴리스 준비 중 확인한 명령:

```powershell
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
```

릴리스 업로드 전 Windows release 스크립트가 추가로 수행하는 항목:

```powershell
cargo build --release --manifest-path src-tauri\rdp-sidecar\Cargo.toml
cargo build --release --manifest-path src-tauri\vnc-sidecar\Cargo.toml
npm run release:win:build
```

## 남은 고도화

- Notes 본문 전체 검색 인덱스 최적화와 대용량 vault 대응
- 백링크/태그 패널의 별도 사이드 패널화 검토
- Markdown extension, Mermaid, callout, task query 등 고급 문법 검토
- macOS release 업로드/자동 업데이트 자동화
