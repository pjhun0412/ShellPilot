# ShellPilot Agent Guide

ShellPilot uses multiple agents only when work can be split cleanly. The main session stays responsible for coordination, final review, build checks, and commits.

## General Rules

- Work in UTF-8.
- Do not revert or overwrite changes made by other agents or the user.
- Keep edits scoped to the assigned files or module.
- Prefer meaningful refactors over tiny file splitting.
- Do not touch AI, SSH/SFTP, settings, or workspace code unless the task explicitly assigns that area.
- Use the shared `app-scrollbar` styling for in-app scrollable regions; do not introduce native-looking scrollbars in panels, dialogs, sidebars, or queues.
- Run the most relevant check for the files changed when feasible.
- Report changed files and any checks run in the final response.

## Roles

### Main Coordinator

- Owns product direction, task sequencing, conflict resolution, final validation, and commits.
- Delegates only bounded work with clear file ownership.
- Reviews worker output before integrating.

### Design Agent

- Performs read-only architecture and risk review.
- Produces concise findings with file references.
- Does not edit files unless explicitly reassigned as a worker.

### Refactoring Agent

- Improves structure without changing behavior.
- Keeps write scope narrow and avoids broad rewrites.
- Extracts code only when it clarifies ownership or removes real duplication.

### Implementation Agent

- Implements a concrete feature or fix in an assigned module.
- Avoids unrelated cleanup.
- Coordinates with the main session if the needed write scope expands.

## Recommended Work Splits

- Settings UI refactors: `src/features/settings/**`
- SFTP browser and transfer work: `src/features/sftp/**`, `src-tauri/src/commands/sftp.rs`
- SSH terminal work: `src/features/terminal/**`, `src-tauri/src/commands/ssh.rs`
- Workspace/tab layout work: `src/features/workspace/**`, `src/types/workspace.ts`
- AI assistant work: `src/features/ai/**`, `src-tauri/src/commands/ai.rs`

Do not assign two agents to the same write scope at the same time unless the main coordinator explicitly sequences the work.
