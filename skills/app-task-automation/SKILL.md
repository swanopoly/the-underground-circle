---
name: app-task-automation
description: Reliably complete a task in any desktop or web app — even an unfamiliar one — by observing real state, finding the control through the basics every app shares, acting one bounded step at a time, and verifying each change before the next. Use for "open/use/control [app] and do X", file/menu/form work, or any computer-use request.
version: 1.0.0
tags: [app, desktop, browser, automation, computer-use, observe-act-verify, accessibility]
---

# App Task Automation

The discipline that makes multi-step app automation actually finish instead of
drifting: **observe → find → act → verify**, one bounded step at a time, never
assuming an action worked. Works on apps with no pre-built adapter by falling
back to the basics every GUI app shares, and escalates to a connected-agent
buildout (with approval) when generic control is not enough.

## Procedure

1. **Identify** the target app, the active window/document, any named file or
   output path, and the task family (read / form-entry / menu / file-save-export
   / canvas / unknown mutation).

2. **Observe before acting** — collect ground truth, do not guess:
   - `desktop.list_running_apps` / `desktop.wait_for_app` → confirm the app is up.
   - `desktop.window_state` → confirm the focused app/window/document identity.
   - `desktop.read_a11y_tree` (or `browser.dom_snapshot` for web) → enumerate the
     real controls, menus, fields, and current values.
   - `desktop.screenshot` / `browser.screenshot` only when the semantic tree is
     incomplete or the task is purely visual.
   - `desktop.file_search` / `desktop.file_stat` when the request names a file.

3. **Find the target through the basics every app shares** (the find-ladder,
   most-reliable first — stop at the first that uniquely identifies it):
   1. the accessibility / semantic tree (role + label/value);
   2. the app's command palette / search / Help-menu search (e.g. Cmd/Ctrl+K,
      Cmd/Shift+P);
   3. a menu-bar walk by name (File / Edit / View / Format / Tools / Window / Help)
      — read the shown keyboard shortcut;
   4. a standard keyboard shortcut for the intent (open, save, find, copy/paste,
      undo/redo, preferences) once focus is confirmed;
   5. toolbars / panels / inspectors / settings dialogs by their accessible labels;
   6. a fresh screenshot for purely-visual canvas targets — and only then a
      single bounded coordinate step, scoped to verified element bounds.

4. **Research when unfamiliar** — if the app/operation has no observed or
   documented control path, do not guess coordinates. Use `research.search` to
   find how this app exposes the action (scripting/automation API, CLI,
   accessibility, menu/shortcut), prefer the official vendor/OS-framework doc,
   and record the exact command/menu path/parameters so it is reproducible.

5. **Act one bounded step at a time**, preferring the most semantic surface:
   - `desktop.menu_click` for stable menu paths; `desktop.set_element_value` for
     named fields; `desktop.click_element` for uniquely-named controls;
     `browser.click_role` / `browser.fill_field` for web.
   - `desktop.press_keys` only after focus + target context are confirmed.
   - Request approval with `approvals.request` **before** any save, export,
     overwrite, delete, publish, send, purchase, upload, or running new
     scripts/macros — and before credentialed/MFA/CAPTCHA/payment steps.

6. **Verify after every mutation, before the next action.** Re-observe
   (`read_a11y_tree` / `screenshot` / `dom_snapshot`) and confirm the expected
   change actually happened. Never chain a second action on an unverified first.

7. **Recover, don't repeat.** If a step fails: re-observe fresh state, then climb
   the surface ladder (semantic → menu → shortcut → one bounded coordinate).
   Never repeat the same failed action or assume it worked. After two failed
   fresh observations of the same target, stop and report the blocker — or call
   `agent.build_app_capability` to have a connected agent build the missing
   adapter/tool (with official refs + a focused smoke), then retry once.

8. **Finish on a verified completion signal**, not on vibes — see Verification.
   When the step budget is reached mid-task, report which steps ran (✓/✗) and the
   resume point instead of claiming success.

## Pitfalls

- **Assuming success.** A returned tool call ≠ a changed app. Always re-observe.
- **Blind coordinates.** Never escalate from a missing semantic target straight
  into repeated coordinate clicks; one bounded visual step max per fresh observation.
- **Guessing on unfamiliar apps.** No observed/cited control path → research first.
- **Skipping approval** on a side effect (save/export/delete/publish/send/buy/upload).
- **Repeating a failed action.** Climb the ladder or hand off a buildout instead.
- **Stale observation.** Re-read state after focus changes, dialogs, or navigation.
- **Leaking secrets.** Use `browser.fill_credential_field` / the vault; never print
  raw credentials into results or chat.

## Verification

- **Before/after evidence:** the control/menu/command used + its source (observed
  label or cited doc), and an after-state observation proving the change.
- **Files:** `desktop.file_stat` confirming the output exists (basename, size,
  format) before reporting a save/export/download done.
- **Web:** URL/title/DOM state after the action; a screenshot only as proof, not
  as the first control surface.
- **Completion signal must be observable** — e.g. the field now reads the target
  value, the new layer/page/record appears in inventory, the exported file exists.
  If it cannot be observed, the task is not done; report the blocker.
- **On the step cap:** report the progress checkpoint (steps done ✓ / failed ✗ +
  reason, last observation, next step) so a continuation resumes with context.
