---
name: file-organization
description: Find, read, and reorganize local files (rename, move, copy, sort into folders, trash) within user-approved scopes — resolving exact file identity first, gating every write/delete behind a scoped grant + approval, and proving each change with before/after file_stat. Use for "find / rename / move / organize / clean up / sort my files".
version: 1.0.0
tags: [files, local, filesystem, organize, desktop, observe-act-verify, approval, grants]
---

# File Organization

Local file changes are real, sometimes irreversible side effects (overwrite,
move, trash). Operate only inside user-approved scopes, resolve the exact file
identity before touching anything, gate every mutation behind a grant + approval,
and prove each change with `file_stat` — never assume a write/move succeeded.

## Procedure

1. **Scope + grant first** — confirm the approved root folder(s). Reads and
   especially writes require a scoped grant; if none covers the target path,
   request one (`approvals.request`) and do not operate outside it. Never widen
   scope on your own.

2. **Resolve exact identity (observe before act)** — `desktop.file_search` to
   locate candidates inside the approved root, then `desktop.file_stat` to confirm
   the precise path, basename, size, and type. Surface a no-match result instead
   of guessing a path. Use `desktop.file_read` only when the task needs file
   contents (e.g. sorting by what's inside).

3. **Plan the change explicitly** — state the concrete operation per file (rename
   to X, move to folder Y, copy, trash) and whether any destination already exists
   (an overwrite). Create destination folders with `desktop.file_mkdir` first.

4. **Approval gate every mutation** — `approvals.request` before any
   `desktop.file_write` / `file_rename` / `file_copy` / `file_trash`, and
   especially before an overwrite or a bulk operation. Show the exact paths and the
   count; do not run a destructive batch on your own authority.

5. **Act one file (or one bounded batch) at a time** — perform the move/rename/
   copy/trash, preferring non-destructive operations (copy over move, trash over
   permanent delete) when intent is ambiguous.

6. **Verify each change** — `desktop.file_stat` the destination exists with the
   expected name/size, and that the source moved/renamed as intended. For a batch,
   verify the resulting count and that no unintended file was touched.

7. **Recover, don't guess** — if a path is ambiguous or a write fails, stop and
   report with the candidates; never overwrite or trash to "make room." For a
   missing capability (e.g. an unusual archive/convert step), `research.search` or
   hand off a connected-agent buildout rather than improvising shell-like moves.

## Pitfalls

- **Operating outside the grant** — a path not covered by an approved scope is off
  limits; request a grant, don't widen silently.
- **Silent overwrite** — check whether the destination exists; an overwrite needs
  explicit approval.
- **Irreversible delete** — prefer `desktop.file_trash` over permanent removal;
  never trash to free a name.
- **Guessing a path** — resolve with `file_search` + `file_stat`; a no-match is a
  valid, reportable outcome.
- **Unverified batch** — confirm the resulting file set with `file_stat`, not the
  tool's return value.
- **Leaking contents** — don't dump file bodies/secrets into chat; read only what
  the task needs.

## Verification

- **Pre-write:** target path resolved via `file_stat`, covered by an approved
  grant, overwrite/destructive intent confirmed, approval granted.
- **Post-write:** `desktop.file_stat` proving the destination exists (path, size)
  and the source changed as intended; for a batch, the expected resulting count.
- **A file change is only "done" when file_stat confirms it.** If it can't be
  confirmed, report the blocker rather than claiming success.
