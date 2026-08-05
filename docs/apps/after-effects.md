# Adobe After Effects

> App automation profile. Status: buildout-only
> Owner code: `src/lib/adobeCreativeCloudApps.ts` (`adobe_after_effects` profile) — no app-native executors yet. Last reviewed: 2026-07-06.

## What chat can do today

Nothing app-native yet — generic desktop ladder only (a11y/vision) plus the
buildout path:

- Observe: `desktop.file_stat` (the .aep), `desktop.window_state`, `desktop.read_a11y_tree`, `desktop.screenshot`.
- Route: `agent.build_app_capability` for any composition edit, expression change, or render.

There is no `desktop.after_effects_*` or aerender wrapper tool in
`openswanToolRuntime.ts` today. Timeline/keyframe mutation through blind
clicks is refused.

## Control surfaces (ranked)

| Surface | External drive? | 2025-2026 reality |
|---|---|---|
| ExtendScript (`.jsx`/`.jsxbin`) | Yes (not built) | AE scripting is still ExtendScript in 2026 — there is no UXP scripting for AE. Externally launchable via the documented command line (`afterfx -r` on Windows) and the app's AppleScript `DoScript`/`DoScriptFile` hook on macOS. |
| `aerender` CLI | Yes (not built) | Headless render of a project/comp/render queue; the natural first adapter for "render this comp" — deterministic, no UI. |
| Dynamic Link / Media Encoder | Partial | Render handoff into the AME queue; UI-driven today. |
| CEP/ScriptUI panels | No | In-app panels; not an external drive. |
| Generic desktop ladder (a11y/vision) | Yes | Reads and screenshots only; comp edits refused blind. |

## Recipes

Honest routing today (no executors):

1. "Render comp 'Main' from project.aep to MP4" — `file_stat` the .aep → confirm app/window state → stop → `agent.build_app_capability` proposing an `aerender` wrapper adapter (project path, comp name, output module, output path, rendered-file `file_stat` proof). No blind Render Queue clicking.
2. "Change the title text in this comp" — observe (window/a11y/screenshot) → stop → buildout proposing an ExtendScript `DoScriptFile` adapter with comp/layer targeting and document-identity fail-closed checks.
3. "What comps are in this project?" — best-effort `read_a11y_tree` + `screenshot` of the Project panel today; a reliable inventory needs the scripting adapter.
4. "Kick the render queue and tell me when it's done" — buildout-only; the adapter should prefer `aerender` over driving the in-app queue.

## Approval & evidence rules

- Approval gates (app profile): composition edits, expression/script changes, render/export, overwrite project/media.
- Verification signals: active comp/layer inventory, render queue state, exported render `file_stat`.
- Any future adapter follows the shared pipeline: observe before, approve before mutating/rendering, proof after (rendered file `file_stat` + screenshot), fail closed on project/comp mismatch, and never save the project as a side effect.

## Gaps & buildout

No gap contract filed yet — `designAppAdapterGaps.ts` covers only
Photoshop/InDesign, so AE requests stop at the generic
`agent.build_app_capability` route from the `adobeCreativeCloudApps.ts` plan.

A connected-agent buildout must produce, following the P15/CAD pattern:

- An `aerender` executor (fixed binary path resolution, execFile argv, no shell, honest `engine_not_installed`-style error when AE is absent) returning output receipts — mirror `cadCodeExecutor.ts`.
- An ExtendScript lane (macOS `DoScriptFile`) for project/comp inventory and targeted text/property edits, with document-identity fail-closed and no auto-save.
- Bridge endpoints + client fns + `openswanToolRuntime.ts` registration (mutations approval-gated) + focused smokes.

## Source refs

- https://helpx.adobe.com/after-effects/using/scripts.html
- https://helpx.adobe.com/after-effects/using/automated-rendering-network-rendering.html
- https://helpx.adobe.com/ae_en/after-effects/using/automation.html
