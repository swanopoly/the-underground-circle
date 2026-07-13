# Agent App-Automation — Deep Research + Implementation Plan

> 2026-07-12 (P69). Goal: extend the chat agent so a user can say *"open
> \<app\> and do \<task\>"* and the agent **pulls the app up and does it** — across
> the Adobe suite, AutoCAD and other CAD/engineering tools, and any pro app
> someone needs help with. This doc pairs (a) a codebase-grounded baseline +
> reusable build pattern with (b) frontier research on the best automation
> surface per app. Frontier sections tagged `[RESEARCH]` are enriched from the
> deep-research run (wf_ef1c3bc5-dd3); the baseline is authoritative now.
>
> READ-ONLY planning doc — no code changes land from this file. Build phases
> ship under the normal validate-and-gate rules.

## 1. The ask, precisely

"Chat automation with apps … that will also pull the app up and do it for
you." Three verbs, in order:

1. **Pull up** — detect installed/running, launch, focus, wait-until-ready.
2. **Do** — execute the task in the app *deterministically where possible*,
   falling back to UI-driving only when no script/API surface exists.
3. **Prove** — verify the result (file written, layer changed, export
   produced) and report a receipt; never claim done without evidence.

UC already has (1) and (3) as shared infrastructure. The frontier work is (2):
turning the ~27 apps that today only get generic UI-driving into
**deterministic, script-backed adapters** on their best surface.

## 2. Current reality (baseline — authoritative)

**The pipeline** (`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`): Route →
Contract → Loop (9 layers) → Resume → Verify, with desktop+browser parity.

**The execution substrate** — the local desktop bridge (`scripts/claude-bridge.js`,
`src/lib/desktopBridge.ts`, `desktop.*` tools) already exposes everything an
adapter needs:

- **Pull-up:** `launch_app`, `focus_app`, `wait_for_app`, `list_running_apps`,
  `list_installed_apps`, `app_reachability` (bridge→installed→running→focus→a11y
  ladder), `observe_app` (one-round-trip state + a11y Δ + next-step advisor).
- **Deterministic execution primitives:**
  - `cad_compile` — headless OpenSCAD / FreeCAD (`freecadcmd`) / Blender (`bpy`).
  - `design_export` — headless Inkscape / sketchtool.
  - `run_applescript` — **any scriptable macOS app** (underused lever).
  - Photoshop / Illustrator / InDesign **ExtendScript adapters** (~25 typed ops).
  - `convert_image`, file ops (`file_write_text`/`read`/`stat`/…​ with grants).
- **UI-driving fallback:** a11y (`read_a11y_tree`, `click_element`,
  `set_element_value`, `menu_click`) + mouse/keyboard primitives.
- **Proof:** `screenshot`, export-proof tools, `file_stat`, a11y Δ diff.

**Coverage taxonomy** (`src/lib/appAutomationDocsIndex.ts`, 33 profiles):

| Status | Apps | Execution today |
|---|---|---|
| `executable` (real adapter) | Photoshop, Illustrator, InDesign, OpenSCAD, FreeCAD, Blender | Deterministic script/compile |
| `cloud_service` | Firefly Services, Onshape | Cloud REST (documented; wiring varies) |
| `web_only` | Figma, Canva | Browser automation |
| *(generic ladder only)* | **AutoCAD, SolidWorks, Fusion 360, Revit, Rhino, Inventor, Premiere Pro, After Effects, Maya, Cinema 4D, DaVinci Resolve, MATLAB/Simulink, Lightroom, Acrobat, Affinity ×2, GIMP, Inkscape, Sketch, SketchUp, KiCad** | UI-driving via a11y + vision — slow, brittle, no deterministic proof |

**The gap in one line:** ~20 high-value pro apps have a documented profile and
a *scripting/API surface that exists in the real world* but **no UC adapter**,
so today they fall to generic UI-driving. Closing that is the plan.

## 3. Core design principle — the execution-surface ladder

For every app, pick the **highest-determinism surface that exists**, in order:

1. **Headless native scripting** (no GUI needed): AutoCAD `accoreconsole`,
   Blender `bpy`, FreeCAD `freecadcmd`, MATLAB `-batch`, Rhino.Compute. Best —
   fast, unattended, deterministic, file-stat provable.
2. **In-app native scripting / macro** (GUI open, script injected): Adobe
   ExtendScript/UXP, SolidWorks VBA/COM, Fusion 360 Python add-in, Revit
   pyRevit, DaVinci Resolve scripting API, Office Scripts/COM. Deterministic;
   needs the app running (which the pull-up layer handles).
3. **Cloud API** (no local app at all): Firefly Services, Onshape, Office 365
   Graph, Figma REST. Best when the user's work lives in the cloud.
4. **Accessibility-tree UI-driving** (`observe_app`→`click_element`): the
   fallback for apps with no script surface. Already built.
5. **Vision-grounded computer use** (screenshot→click x,y): last resort for
   canvas-only surfaces. Already built (Sonnet-pinned loop).

The whole plan is: **move each app up this ladder** from where it sits today.

## 4. Per-app best-surface matrix `[RESEARCH]`

> Rows the deep-research run confirms/refines get a ✓; specifics (exact API
> entry points, headless capability, auth) are filled from the cited findings.

| App | Best surface (target) | Headless? | UC today | Build |
|---|---|---|---|---|
| **AutoCAD** | `accoreconsole.exe` + `.scr`/AutoLISP; .NET/COM for rich | Yes (accoreconsole) | generic | script-backed adapter |
| **Fusion 360** | Python API (add-in/script) | Partial | generic | script adapter (running app) |
| **SolidWorks** | API via VBA/COM macro | No (app open) | generic | macro adapter |
| **Revit** | pyRevit / Revit API add-in; Design Automation cloud | cloud yes | generic | pyRevit adapter |
| **Rhino/Grasshopper** | rhino3dm + Rhino.Compute; RhinoScript | Compute yes | generic | compute/script adapter |
| **Inventor** | iLogic / COM API | No | generic | macro adapter |
| **Onshape** | REST API (FeatureScript) | cloud | cloud_service (doc) | wire cloud adapter |
| **Premiere Pro** | UXP / ExtendScript; batch via AME | partial | generic | ExtendScript/UXP adapter |
| **After Effects** | ExtendScript (aerender headless) + UXP | Yes (aerender) | generic | ExtendScript adapter |
| **Lightroom Classic** | Lua SDK plugin | No | generic | plugin adapter |
| **DaVinci Resolve** | Python/Lua scripting API | partial | generic | scripting-API adapter |
| **Blender** | `bpy` (headless) | Yes | executable ✓ | extend ops |
| **Maya / Cinema 4D** | Python (`maya.cmds` / `c4dpy`) | Yes | generic | script adapter |
| **MATLAB/Simulink** | `matlab -batch` / Engine API | Yes | generic | batch adapter |
| **Excel/Office** | Office Scripts / COM / Graph API | cloud+local | generic | Graph or COM adapter |
| **Photoshop/AI/ID** | ExtendScript now → UXP next; Firefly cloud | mixed | executable ✓ | Firefly + UXP + more ops |
| **Firefly (generative)** | Firefly Services REST | cloud | cloud_service (doc) | **wire — top Adobe gap** |
| **Acrobat** | JavaScript for Acrobat / PDF Services API | cloud yes | generic | PDF Services adapter |
| **KiCad** | Python scripting (`pcbnew`) | Yes | generic | script adapter |
| **SketchUp** | Ruby API | No | generic | Ruby adapter |
| **GIMP** | Script-Fu / Python-Fu (`--batch`) | Yes | generic | batch adapter |

## 5. Frontier capabilities to prioritize

> **Research status (be honest):** the deep-research run (wf_ef1c3bc5-dd3)
> completed its search+fetch phases but its **verification phase hit the
> account session rate limit** (resets 7:10pm ET) — 0 claims got the 3-vote
> adversarial pass. The Adobe claims below are *unverified web extracts*, but
> they match well-established Adobe developer surfaces (corroborated against
> engineering knowledge → treated high-confidence, EXCEPT the recent
> "Firefly AI Assistant" item, flagged). The CAD / video / office / computer-use
> rows are from engineering knowledge (the run's non-Adobe angles didn't survive
> the rate limit). Sources in §10; **a re-verify pass can run after the reset**
> if you want cited confirmation before building.

1. **Adobe cloud Photoshop + Firefly Services API is the single biggest lever
   — bigger than "generative only".** The research surfaced that the cloud
   **Photoshop API (v2, GA; v1 EOL 2026-07-31)** does far more than image gen,
   with **no local Photoshop needed**:
   - Generative Fill / Generative Expand, AI **background removal**
     (`sensei/cutout`), smart-object create/replace, product-crop, autocrop.
   - **PSD document operations against templates** (`psdService/documentOperations`)
     — real layered-PSD edits server-side.
   - Apply **Photoshop Actions** (`.atn`) via ActionJSON with a dynamic payload.
   - **Cloud UXP scripting** — run arbitrary JS in Photoshop on Adobe's servers.
   - Firefly REST: `firefly-api.adobe.io/v3/images/generate` (text-to-image),
     `…/v3/images/expand` (generative expand).
   - Auth: OAuth **bearer via Adobe IMS** (`client_id`+`client_secret`) — fits
     the guarded-proxy secret pattern exactly.
   ⇒ This makes cloud-first (P1) able to do most still-image work — including
   template PSD edits — without opening the desktop app. Highest ROI.
2. **A generalized `desktop.run_app_script` bridge primitive** — generalize
   `cad_compile` into a whitelisted headless-script runner (engine → fixed
   binary → argv allowlist → output file) so a new app = a new engine entry + a
   script generator, not a bespoke endpoint. Covers AutoCAD `accoreconsole`,
   MATLAB `-batch`, Blender/Maya/GIMP/KiCad, After Effects `aerender` in one
   substrate.
3. **UXP vs ExtendScript — scope it correctly.** Research: UXP covers **only
   Photoshop, InDesign (+XD)** as of 2026; **Illustrator, After Effects,
   Premiere Pro, Acrobat, Bridge STILL require ExtendScript** — so UC's
   ExtendScript adapters for those are *correct and necessary*, not legacy debt.
   `batchPlay` reaches PS's full feature surface under UXP. UXP migration (P7)
   therefore applies to the **Photoshop/InDesign adapters only**; leave the
   others on ExtendScript.
4. **Computer-use model tier** — the a11y/vision fallback improves with newer
   computer-use models; keep the Sonnet-pinned loop current and measure. *(No
   fresh reliability numbers survived the rate limit — revisit on re-verify.)*
5. **Multi-app orchestration** — "generate a hero image via Firefly → drop into
   an InDesign template → export proof → post to WordPress" chains through the
   existing plan/approval economy + receipts.

## 6a. TWO runner substrates (refined P72 — a wave of 5 generators surfaced this)

A build wave (AutoCAD/Fusion/Revit/SolidWorks/DaVinci pure generators) proved
the "script generator" half is uniform, but the RUNNER splits in two — the
plan's original "one substrate" was too optimistic:

- **Substrate A — headless-CLI execFile** (`appScriptRunner` / `desktop.run_app_script`):
  spawn a fixed-path binary with argv. Fits: OpenSCAD, FreeCAD, Blender (shipped
  in cadCodeExecutor), **AutoCAD** (`accoreconsole /i /s`), MATLAB (`-batch`),
  KiCad (`kicad-cli`), GIMP (`--batch`), After Effects (`aerender`).
- **Substrate B — in-process app scripting** (needs a connected-agent host on
  the app's OS; NOT execFile): the script runs *inside a live app* via an
  add-in / COM / scripting-module. Fits: **Fusion 360** (Scripts & Add-Ins,
  no headless mode), **Revit** (pyRevit / RevitPythonShell, Windows-only),
  **SolidWorks** (COM `RunMacro2`, Windows-only), **DaVinci Resolve** (a Python
  child importing `DaVinciResolveScript`, `RESOLVE_SCRIPT_*` env, connecting to
  the running app).

The pure GENERATORS (all shipped P72, smoke-tested) are runner-agnostic — the
same validated-script + safe-embed output feeds either substrate. Wiring
diverges: Substrate A → `desktop.run_app_script`; Substrate B → a
`desktop.<app>_run_script` connected-agent-host tool per app (the buildout path
the design profiles already name). Of the 5, only AutoCAD is Substrate A.

**Substrate A itself has THREE invocation modes** (P73 wave — GIMP/AE/Maya
generators surfaced this; `appScriptRunner` today only models the first):

1. **script-file**: binary runs a generated file by path — `matlab -batch
   run('f.m')`, `mayapy f.py`, `accoreconsole /s f.scr`, blender/freecad/openscad.
   ✅ fits the current `AppScriptRunRequest.sourcePath` contract.
2. **inline-program**: the program is an argv token, not a file — GIMP
   `-b "<python-fu>"`. Needs an inline-program engine mode (the generator emits
   the program string; `buildArgs` places it as the `-b` token). The
   already-enforced per-token control-char/newline reject keeps it one token.
3. **render-job**: no script at all — a project + selection flags — aerender
   `-project X -comp Y -output Z`. Needs a render-job request variant (the
   generator already emits the validated argv vector directly).

Action for the P2 wiring increment: extend `AppScriptRunRequest` with a
`mode: 'script_file' | 'inline_program' | 'render_job'` (default `script_file`,
back-compatible) before adding the gimp/aerender engines; `maya_python` and
`autocad_core` land as plain script-file engines now.

**DONE (P76, 2026-07-13, committed):** `appScriptRunner` now carries `mode` on
every engine descriptor and branches validation on it — `programText` (bounds +
the single-line/no-control-char token check) for inline_program, and
sanitized/allowlisted `jobParams` (int or bounded metachar-free BMP token, with
`requiredJobParams`) for render_job. Six engines registered: **matlab /
autocad_core / maya_python** (script_file), **gimp** (inline_program), **kicad_cli
/ aerender** (render_job). `AppScriptRunSpec` now exposes `mode` so the bridge
knows whether to write a generated script first. Smoke: app-script-runner (107,
was 51). All still `verifiedInvocation:false`. **Remaining to make it usable:**
(1) `desktop.run_app_script` tool in openswanToolRuntime (approval-gated, refuses
when `verifiedInvocation:false`); (2) the bridge LOCKSTEP runner in
`scripts/claude-bridge.js` (fixed per-engine binary paths, execFile array, no
shell); (3) adapter→runner glue (generate → write/embed → run → stat-verify).
Steps 1-2 need a live install to flip the gate per engine.

## 6. The reusable build pattern — "scriptable app adapter"

Every new `executable` app follows the shipped ExtendScript / cad_compile
LOCKSTEP shape, so the marginal cost of app N+1 is small:

1. **Script generator** (pure lib, e.g. `<app>ScriptAdapters.ts`): task → a
   validated, bounded native script string. Pure + smoke-tested (no bridge).
2. **Bridge runner** (LOCKSTEP with the generator): `run_app_script` engine
   entry — fixed binary path, strict arg allowlist, timeout clamp, output-file
   stat as the receipt. Never shells arbitrary input.
3. **Tool registration** — one `desktop.<app>_<op>` (or the generic
   `desktop.run_app_script`) across the 8 openswanToolRuntime seams; policy
   `approvalMode:'ask'` for any mutation/export, `mutatesState`, `writes`.
4. **Profile update** — flip `docs/apps/<app>.md` status → `executable`, list
   the executable ops, and the index entry in `appAutomationDocsIndex.ts`.
5. **Strategy wire** — `computerAppTaskStrategy.ts` routes the app's tasks to
   the adapter first, generic ladder as fallback.
6. **Smoke** — script generator + arg-allowlist + LOCKSTEP byte-identity check.

## 7. Phased build plan

- **P1 — Adobe cloud Photoshop + Firefly Services (no local app).**
  **◐ IN PROGRESS.** Increment 1 SHIPPED (2026-07-12): pure
  `src/lib/adobeCloudService.ts` — validate / auth-free request-builder /
  async-job receipt parser / secret-scrub / approval-describe for
  `text_to_image` (→ gap `desktop.firefly_generate_image_asset`),
  `generative_expand`, `background_remove`. Endpoints isolated in one
  VERIFY-marked constant; reuses the canonical `scrubSecrets`; enterprise-gating
  documented in the header. Smoke: `adobe-cloud-service` (50). NOT wired live.
  Next increments: (2) guarded edge proxy `adobe-cloud-proxy` — Adobe IMS OAuth
  bearer + `x-api-key` injected server-side, no-secret return, approval
  re-verification (mirrors custom-api-proxy); (3) register `desktop.firefly_*`
  tools across the 8 seams + route satisfied gaps in
  designAppAdapterGaps/creativeAi to the adapter; (4) endpoint verification
  (resume the P69 research after the rate-limit reset) + a real Adobe
  enterprise integration in Marketplace before deploy. Wire the
  documented `firefly-services` cloud_service into a real adapter via the
  guarded proxy (OAuth bearer from Adobe IMS, `client_id`/`secret` server-side,
  never in prompts): text-to-image + generative expand (Firefly v3), background
  removal (`sensei/cutout`), and — the sleeper win — **PSD template document
  operations** + Photoshop **Actions (ActionJSON)** so layered edits run
  server-side. Async job-polling, approval-gated, secret-scrubbed, receipts
  (output asset URL). Highest ROI, no desktop Photoshop needed. Target v2
  (v1 EOL 2026-07-31).
- **P2 — `desktop.run_app_script` generalized runner. ◐ IN PROGRESS.**
  Increment 1 SHIPPED (2026-07-12): pure `src/lib/appScriptRunner.ts` — the
  generalized substrate (engine registry + engine-AGNOSTIC security core:
  LOCKSTEP path validation, source/output extension allowlists, strict
  per-engine extraArg allowlist, timeout clamp; `validateAppScriptRunRequest` /
  `buildAppScriptRunSpec` / `describeAppScriptRun`). Seeded engines
  `matlab` (`-batch`), `kicad_cli`, `autocad_core` (`accoreconsole`) — each
  `verifiedInvocation:false` + `// VERIFY` until a live bridge run confirms the
  CLI contract (so nothing wires live prematurely). Smoke: `app-script-runner`
  (51, security-heavy). Next: (2) bridge LOCKSTEP runner in claude-bridge.js
  (fixed binary paths, execFile argv, file-access grants) + `desktopBridge.ts`
  fn; (3) `desktop.run_app_script` tool across the 8 seams (approval-gated
  local execution) + per-engine script generators; (4) verify each engine on a
  real install → flip `verifiedInvocation`. Generalizes the shipped
  `cad_compile` (blender/freecad/openscad); +matlab/gimp/maya/aerender are then
  new descriptors, not new endpoints.
- **P3 — AutoCAD adapter.** `accoreconsole` + AutoLISP/`.scr` generator (the
  headline CAD ask). Headless draw/convert/extract; app-native for edits.
- **P4 — Fusion 360 + Revit (pyRevit) + SolidWorks macro.** The pro-CAD trio,
  each a script adapter on its native surface.
- **P5 — Adobe video (After Effects `aerender`, Premiere ExtendScript) +
  DaVinci Resolve scripting API.** Motion/video lane.
- **P6 — Office/Excel (Graph or Office Scripts) + Acrobat PDF Services.**
  Everyday-doc automation.
- **P7 — UXP migration (Photoshop + InDesign ONLY).** Migrate those two
  adapters to UXP/`batchPlay` (V8/ES6, headless single-file scripts); leave
  Illustrator/AE/Premiere/Acrobat on ExtendScript (UXP doesn't cover them in
  2026). Future-proofing, not a rewrite.
- **Continuous:** keep the computer-use fallback model current; each phase adds
  its app profile flip + smokes; full `smoke:all` gate per phase.

Ordering rationale: cloud-API wins first (no install, immediate), then the
generalized runner (leverage), then the highest-demand local CAD/creative apps.

## 8. Invariants carried through every phase

- **Approval floor never waivable** — any mutation/export/save/publish is
  `approvalMode:'ask'`; pay/delete/login/grant stay sticky. Adapters *never*
  auto-save (mirrors the Photoshop adapter's "never saves" rule).
- **Proof before done** — every executable op returns a receipt (output-file
  stat, export path, layer Δ); the evidence contract fails closed on missing
  proof.
- **Fixed-path + allowlist execution** — bridge runners resolve binaries from
  fixed install paths only, strict arg allowlists, timeout clamps, path grants
  (the `cadCodeExecutor` security model — no arbitrary shell).
- **Secrets** — cloud-API keys (Firefly/Graph/etc.) via the guarded proxy
  pattern (server-side injection, no key in prompts/logs/metadata).
- **Untrusted content** — app-read content (a11y text, file contents, API
  responses) fenced as data before it reaches a model.
- **Honesty** — an app with no adapter says so and offers the generic ladder /
  install hint; never pretends.
- **LOCKSTEP** — generator ↔ bridge runner kept byte-identical with a smoke.

## 9. Validation gates

Per phase: `npm run typecheck` (app + 43 functions) + the phase's new smoke(s)
+ full `smoke:all` exit 0 before it's considered shipped. Pure script
generators are smoke-tested without the bridge (the tsx-loadable rule).

## 10. Research provenance & verification status

Deep-research run `wf_ef1c3bc5-dd3` (2026-07-12): search+fetch completed;
**verification failed on the account session rate limit** (resets 7:10pm ET),
so no claim received the 3-vote adversarial pass. The Adobe facts in §5 are
UNVERIFIED web extracts, corroborated against known Adobe developer surfaces
(high confidence). Sources fetched (Adobe angle):

- `developer.adobe.com/firefly-services/docs/photoshop/` — cloud Photoshop API
  (v2 GA, v1 EOL 2026-07-31; generative fill/expand, cutout, PSD ops, cloud UXP).
- `developer.adobe.com/firefly-services/docs/guides/tutorials/create-product-images-with-ff`
  — Firefly v3 generate/expand endpoints; `sensei/cutout`;
  `psdService/documentOperations`; server-side batch pattern; IMS OAuth.
- `developer.adobe.com/photoshop/uxp/2022/scripting/` — UXP scripting, headless
  single-file, `batchPlay`.
- `mapsoft.com/posts/extendscript.html` — ExtendScript still supported;
  ESTK deprecated 2020; UXP scope = PS/InDesign/XD; ExtendScript remains the
  only surface for AI/AE/Premiere/Acrobat/Bridge.
- `blog.adobe.com/…/introducing-firefly-ai-assistant…` (2026-04) — **FLAGGED
  UNCONFIRMED** (post-knowledge-cutoff, unverified): a first-party Firefly AI
  Assistant creative agent; app-to-app context (not headless); no disclosed
  developer/automation API; reportedly exploring Claude integration. Do NOT
  plan against this until confirmed.

**NOT covered by that run** (rate limit killed the non-Adobe angles): AutoCAD /
Fusion / Revit / SolidWorks / Rhino / DaVinci / MATLAB / Office / Figma API
specifics, and computer-use model reliability numbers. §4/§7 rows for those were
engineering-knowledge best-estimates — see the verification ledger below, which
resolved most of them.

### 10a. Verification ledger — READ-ONLY doc-verification wave (2026-07-13)

Seven agents (5 read-only verify + resulting corrections) confirmed each shipped
adapter's invocation/endpoint against **current official docs** (the pass that
had failed on rate-limit above). Each contract stays `verifiedInvocation:false`
until a *live install run* confirms it — doc-verification raises confidence and
fixes wrong guesses, it does not flip the install gate.

| Contract | Verdict | Action |
|---|---|---|
| MATLAB `matlab -batch "run('f.m')"` | ✅ CONFIRMED (no `-nodisplay`/`-nosplash`) | none |
| Maya `mayapy` + `standalone.initialize/uninitialize`, `cmds.file` export | ✅ CONFIRMED (`'FBX export'` string fragile — prefer `FBXExport` MEL) | note kept |
| Blender `-b <file> -P <script>`, `wm.obj_export`, `export_scene.fbx/gltf`, `wm.save_as_mainfile` | ✅ CONFIRMED — code already 4.x-correct in `cadCodeExecutor` | none |
| GIMP 2.10 `-i -d -f --batch-interpreter=python-fu-eval -b` + `pdb.*` names | ✅ CONFIRMED for 2.10 | — |
| GIMP **3.0** | ⚠️ CONFIRMED BREAKING — `pdb.<proc>()` attribute API removed → `Gimp.get_pdb().lookup_procedure('gimp-image-flatten')`+config/run or object methods; hyphenated names; `Gimp.*` GI namespace. Needs a separate 3.0 shape. | file header already predicts this |
| AE `aerender -project -comp -output -s -e` | ✅ CONFIRMED (only nuance: `-sound` takes `on/off`; not in emitted argv) | — |
| AE ExtendScript (`renderQueue`, `outputModule().applyTemplate`, 1-indexed) | ✅ CONFIRMED (re-fetch OutputModule handle after each mutation) | — |
| DaVinci scripting API + env vars + `AddRenderJob/StartRendering` | ✅ CONFIRMED; **external scripting effectively Studio-only** (free = console-typed only) | file's fail-closed blockers already handle it |
| Substrate A/B split for **Fusion / Revit / SolidWorks** | ✅ CONFIRMED — none has a headless CLI; all need an in-process/COM host (Substrate B). Revit desktop = IronPython 2.7-only (pin engine or add Py3 mode before wiring; `pyrevit run` is a GUI wrapper, not headless). | note in-file |
| **AutoCAD** `EXPORTPDF` / `DXFOUT` order / `-PURGE Regapps` | ❌ CONFIRMED WRONG → `-EXPORT _PDF _C _N`; precision-then-`V`-version; `-PURGE` uses `R` + repeat-until-0. | annotated in `autocadScriptAdapter.ts`, fix at wiring |
| **KiCad** generic `['export','--output',out,src]` | ❌ CONFIRMED WRONG → per-kind `<domain> export <fmt> --output <out> <in-last>`; gerbers/drill out = dir. | annotated in `appScriptRunner.ts`, fix with `mode` work |
| **Adobe** `background_remove` `sensei/cutout` | ❌ CONFIRMED EOL (2025-10-15) → **`https://image.adobe.io/v2/remove-background`**, body `{image:{source},mode,output}`. | **FIXED in `adobeCloudService.ts`** + pinned in smoke |
| **Adobe** `generative_expand` `/v3/images/expand` | ⚠️ Adobe documents the async path `/v3/images/expand-async`. | **FIXED** (receipt parser already polls) |
| Adobe `text_to_image` `/v3/images/generate`, IMS S2S OAuth `ims/token/v3` + `client_credentials` | ✅ CONFIRMED (JWT flow deprecated → S2S OAuth; output URLs valid ~1h) | none |

**Rule going forward:** doc-verified ≠ install-verified. A contract's
`verifiedInvocation` flips to `true` only after a live run on a real install
through the bridge. The Adobe endpoint fix is the exception worth applying
immediately because the old endpoint is *confirmed dead*, not merely unverified.

### 10b. Adapter inventory (pure foundations, all gated `verifiedInvocation:false`)

Adobe cloud (Firefly/PS REST) · OpenSCAD/FreeCAD/Blender (`cadCodeExecutor`) ·
AutoCAD · Fusion 360 · Revit · SolidWorks · DaVinci Resolve · GIMP · After
Effects · Maya · **Acrobat** (JS via osascript `do script`) · **Premiere Pro**
(ExtendScript; UXP is the forward target) · **Rhino** (`rhinocode` CLI, drives a
running Rhino — not headless on macOS). Each ships a self-contained pure
generator + smoke (safe-embed + per-field allowlist + ≥1 blocked injection) and
a named operation-gap tool for the buildout layer. None is wired to the bridge.
