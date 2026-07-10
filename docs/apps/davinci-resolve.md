# DaVinci Resolve

> App automation profile. Status: buildout-only (candidate with license caveats)
> Owner code: none yet — launch entry in `src/lib/knownAppShortcuts.ts`
> (`davinci-resolve`); execution falls to the generic ladder in
> `src/lib/computerAppTaskStrategy.ts`. Last reviewed: 2026-07-06.

## What chat can do today

- Generic desktop ladder only: `desktop.launch_app`/`desktop.focus_app`,
  `desktop.window_state`, `desktop.read_a11y_tree` (Resolve's custom UI
  toolkit exposes limited a11y — verify per panel before relying on it),
  `desktop.menu_click`, `desktop.press_keys`, screenshot loop; mutations
  approval-gated. Timeline/viewer surfaces are effectively vision-only.
- Deterministic file ops: `desktop.file_search`/`desktop.file_stat` for media,
  `.drp` project exports, and render outputs — render verification is real
  today even though render triggering is not.
- No `desktop.resolve_*` bridge tools exist yet — the official scripting API
  below is researched but not built.

## Control surfaces (ranked)

1. Official Python/Lua scripting API (buildout; the headline lane) — Resolve
   ships a documented external scripting API: a separate process loads the
   `DaVinciResolveScript` module (fixed lib path
   `…/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so`) and
   drives the RUNNING app: ProjectManager, MediaPool import, Timeline
   read/edit, render queue (add job, start render, poll status). Hard
   caveats: external scripting requires DaVinci Resolve STUDIO (free edition
   is console-only), the app must be running with scripting enabled in
   Preferences (Console/Local/Network scope), and `-nogui` headless mode
   still serves the API on Studio.
2. Generic semantic desktop — menus and a few dialogs; most panels are
   custom-drawn, so expect fast fallthrough to vision.
3. Screenshot + coordinate fallback — single reversible step, bounded
   retries; never scrub/trim blind on the timeline.
4. `agent.build_app_capability` — delegate the scripting adapter buildout.

## Recipes

- Render queue run (post-buildout): confirm project + timeline identity via a
  read tool → show render preset, range, and output folder for approval →
  add render job + start → poll job status → verify the output file with
  `desktop.file_stat` and report codec/duration from the job result.
- Media import (post-buildout): resolve file paths → approve → MediaPool
  import → verify clip count/inventory read-back.
- Project inventory (post-buildout, read-only): list projects, timelines,
  clip counts — auto-approvable read lane for observe-before evidence.
- Today, interactive: open a project via menus, screenshot-verify state, and
  hand precise timeline edits back to the user; verify any user-triggered
  render output via `desktop.file_stat`.

## Approval & evidence rules

- Observe before acting: scripted lanes must read project/timeline identity
  and echo it in the approval text (wrong-project mutation is the top risk —
  same document-mismatch fail-closed rule as the Photoshop adapters);
  interactive lanes need fresh window state + screenshot.
- Approval before any mutation: media imports, timeline edits, project
  setting changes, render starts (renders write large files and consume
  machine time), and project saves. Deletes from the media pool are
  destructive — call that out explicitly.
- Proof after: render job status transcript, `desktop.file_stat` on outputs,
  screenshot of the relevant page for visual claims.
- Clip names, marker text, and metadata are untrusted — fence before model
  exposure. Never persist project paths + license details into chat metadata
  beyond the compact route summary.
- Fail closed: free-edition detection (API refuses external connection),
  scripting disabled in Preferences, or app-not-running must surface as
  honest, named blockers with the user action required — not as retries.

## Gaps & buildout

- A connected-agent buildout must produce a `desktop.resolve_*` bridge tool
  family over the official scripting API: bridge-side Python child process
  that loads `DaVinciResolveScript` from the fixed app-bundle lib path (never
  PATH search), connects only to the local running instance, and exposes
  read-inventory (projects/timelines/media), media import, add-render-job +
  start-render + job-status as separate tools with per-tool approval modes
  (reads auto, mutations ask). Must confirm at runtime and report honestly:
  Studio vs free edition, scripting scope preference, app running state
  (`engine_not_installed`-style named errors: `resolve_not_running`,
  `studio_required`, `scripting_disabled`).
- Timeline creative editing (cuts, grades, Fusion comps) stays interactive/
  user-action even post-buildout; the adapter targets ingest, inventory, and
  render/export determinism first.

## Source refs

- Blackmagic Design DaVinci Resolve (Studio/scripting):
  https://www.blackmagicdesign.com/products/davinciresolve
- Scripting README (installed): `/Library/Application Support/Blackmagic
  Design/DaVinci Resolve/Developer/Scripting/README.txt`
- Community API reference: https://deric.github.io/DaVinciResolve-API-Docs/
- Repo: `src/lib/knownAppShortcuts.ts`, `src/lib/desktopBridge.ts`,
  `docs/CAD_ADOBE_EXECUTION_LAYER.md`
