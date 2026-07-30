# CLAUDE.md - The Underground Circle

> Project context for Claude Code, OpenSwan, Codex, Gemini, and other agents.
> Last reviewed: 2026-07-27

Start with `AGENTS.md`. `docs/AGENTS_ROADMAP.md` is canonical for ownership,
phase status, SQL status, and runtime rules. This file is a current app review
and orientation guide.

## Product

The Underground Circle is a shared AI-agent accountability workspace for small
dev teams. The core loop is:

`connect repo/providers -> plan and run work in Chat/Office/Feed -> agents
execute with tools -> proof, activity, memory, and follow-up become visible`.

Priority remains:

1. GitHub/team accountability.
2. BlackSwan/OpenSwan as the shared agent layer.
3. Reliable provider routing, memory, approvals, and observability.
4. Computer Use and local desktop actions with explicit gates.

Wallet, games, training experiments, and decorative office work are secondary
unless they strengthen the accountability loop.

## Stack

| Layer | Current reality |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| Runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| LLM routing | `llm-proxy`, `swanbot-ai`, `swanbot-v2-ai`, provider marketplace, BYOK |
| Local bridges | app dev server 8081, OpenSwan proxy 18790, Claude bridge 7778 |

Core commands:

```bash
npm run web
npm run start
npm run build
npm run typecheck
npm run proxy
npm run bridge
```

## App Surfaces

- Chat: main agent surface, model picker, chat automation, computer task
  routing, memory references, artifacts, threads, and persisted bot metadata.
- Office: live agent dashboard, local bridge visibility, activity feed,
  terminal, controls, memory/run panels, approvals, and agent identity.
- Feed: goals, plans, missions, tasks, proof of work, and team operating loop.
- Rooms: project rooms, files, services, room chat, task execution, playground.
- Marketplace: user/circle integrations, provider keys, model/provider catalog,
  browser/computer providers, and billing preference.
- Computer Use: Browserbase runtime plus local desktop and browser bridge tools.

## Runtime Map

Canonical owners are in `docs/AGENTS_ROADMAP.md`; this is the practical map:

| Concern | Owner |
|---|---|
| Chat planning | `src/lib/chatAutomationPlanner.ts` |
| Chat computer/app request routing | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer/app user notices | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Chat execution | `src/lib/runChatAutomationPlan.ts`, `src/lib/chatAgentContextPack.ts` |
| BlackSwan response path | `src/lib/swanbot.ts`, `src/lib/swanbotClientToolDispatcher.ts`, `supabase/functions/swanbot-ai/index.ts` |
| v2 SwanBot tool loop | `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/functions/_shared/swanbot-continuation.ts`, `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `src/lib/swanbotV2BatchRuntime.ts`, `src/lib/swanbotV2BatchPolicy.ts`, `src/lib/swanbotV2ClientLoopFlag.ts` |
| SwanBot continuation checkpoint privacy | `supabase/functions/_shared/swanbot-continuation-crypto.ts`, `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/migrations/20260726_swanbot_continuation_privacy.sql`, `docs/RUN_THIS_SQL.sql` §29 |
| Typed model/tool loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan sessions | `src/lib/openswanSessionRuntime.ts` |
| Agent subject identity | `src/lib/agentRuntimeSubject.ts`, `src/lib/agentIdentityKey.ts`, `src/lib/agentIdentity.ts` |
| Tool catalog | `src/lib/openswanToolRuntime.ts` |
| Provider profile model choice | `src/lib/serviceProfileSouls.ts` |
| Cross-provider fallback | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan model routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime and truthful outcomes | `src/lib/computerTaskRuntime.ts`, `src/lib/computerTaskOutcome.ts` |
| Browser computer use and typed mutation handoffs | `src/lib/computerUseAgent.ts`, `src/lib/useComputerUseTask.ts`, `src/lib/useComputerUseQueue.ts`, `supabase/functions/computer-use-agent/index.ts`, `src/lib/computerUse.ts`; cloud starts require a bounded v1 policy, while all legacy recorder mutations remain value-stripped typed OpenSwan handoffs |
| Local desktop intent | `src/lib/localComputerAwarenessIntent.ts` |
| Desktop bridge authentication boundary | `scripts/desktop-bridge-security.js`, all four local agent bridge servers, `src/lib/bridgeAuth.ts`, `src/lib/desktopBridge.ts` |
| App observation epochs and mutation receipts | `src/lib/computerAppGrounding.ts` |
| Guarded browser mutation canaries | typed `browser.fill_field`, `browser.set_toggle`, and `browser.select_option` in `src/lib/openswanToolRuntime.ts`, `src/lib/browserBridge.ts`, `scripts/browser-bridge.js` |
| Narrow native semantic-press canary | typed `desktop.click_element` in `src/lib/openswanToolRuntime.ts`, `src/lib/computerAppAdapter.ts`, `src/lib/desktopBridge.ts` |
| Durable exact action-call ledger | `src/lib/agentActionCalls.ts`, `supabase/migrations/20260726_agent_action_calls.sql`, `docs/RUN_THIS_SQL.sql` §26 |
| Exact single-use approval authority | `src/lib/chatApprovalGate.ts`, `src/lib/openswanToolApprovals.ts`, `src/lib/openswanToolRuntime.ts`, `src/lib/swanbot.ts`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| Scheduled external-action authority | `src/lib/scheduledActions.ts`, `supabase/functions/scheduled-action-runner/index.ts`, `supabase/migrations/20260726_scheduled_action_mutation_guard.sql` |
| Office durable command authority | `src/lib/officeTerminal.ts`, `src/screens/circles/tabs/OfficeTab.tsx`, `supabase/migrations/20260726_database_authority_guards.sql` / `docs/RUN_THIS_SQL.sql` §28 |
| WordPress/Dealer Inspire admin automation | `src/lib/wpAdmin.ts`, `src/lib/computerAppTaskStrategy.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/userTaskPipelines.ts`, `src/lib/wordpressAdminSourceIntelligence.ts` |
| Design creative AI | `src/lib/designAppCreativeAi.ts` |
| Design execution pipeline | `src/lib/designAppExecutionPipeline.ts` |
| Photoshop ExtendScript adapters | `src/lib/photoshopExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Local CAD execution | `src/lib/cadCodeExecutor.ts`, `src/lib/cadFileInspector.ts`, `desktop.cad_compile` |
| Engine-neutral CAD drafting (DXF generation) | `src/lib/engineeringDraftingCore.ts` (pure DXF R12 writer/parser + floor-plan/schematic/grid generators), tool `engineering.draft_dxf` (pure computation, no app); the SAME neutral entity model compiles to AutoCAD `.scr` via `src/lib/autocadScriptAdapter.ts` `draft_entities` (execution gated on real-install verify). Cross-implementation proven by `scripts/dxf-verify.py` + `npm run drill:engineering-drafting`. `buildBoltCircle` adds flange/hole-pattern drawings; `engineeringDimensionCore.ts` + `annotateDrawing` add overall dimensions + title block (`titleBlock`/`autoDimension` args) — dimension TEXT is the MEASURED distance (a dim that lies = cut-the-wrong-part), asserted `text===formatDim(measured)`; verifier bbox expands CIRCLE/ARC by radius |
| Engine-neutral 3D solid modeling | `src/lib/engineeringSolidModelingCore.ts` (pure neutral CSG model → Blender bpy + OpenSCAD emitters + plate/bracket/tube/**flange** generators + `boltCirclePoints`), tool `engineering.model_3d` (pure computation); runs on the live-proven `desktop.cad_compile` blender lane → STL. Dimensionally proven end to end by `scripts/stl-verify.py` + `npm run drill:engineering-solid` (real Blender build → independent STL bbox check; flange = disc+bore+6-hole bolt circle → 2088 triangles at 120×120×12mm) |
| Engineering analysis (calculations) | `src/lib/engineeringCalcCore.ts` (pure: beam deflection/stress, section properties, bolt/thread, Ohm/LED/RC, unit conversion, materials with E + shear modulus G, spring rate k=G·d⁴/(8D³n)), tool `engineering.calc` (kinds incl. `spring_rate`). Textbook-exact — every formula asserted against a hand-computed reference in `scripts/engineering-calc-core-smoketest.ts` (the smoke IS the proof, no app). Sizes a part before `engineering.draft_dxf`/`engineering.model_3d` draw it |
| Engineering mesh inspection (measure a part) | `src/lib/engineeringMeshInspectCore.ts` (pure: binary-STL parse, bbox, volume via divergence theorem, surface area, watertight manifold check, mass), tool `engineering.inspect_mesh` (reads STL via new grant-gated `desktop.file_read_binary` base64 endpoint + `readFileBinary`). The measure-a-part partner to `engineering.model_3d`. MUTUAL-verified: `npm run drill:engineering-mesh-inspect` builds a part of known analytical volume in Blender then measures it back — plate agreed to 0.00%, flange 0.16% — so generator and inspector prove each other |
| Involute spur gears | `src/lib/engineeringGearCore.ts` (pure: exact gear geometry PD/OD/root/base, involute tooth profile, 2D `buildSpurGearDrawing`, 3D `buildSpurGearBlenderScript` via bmesh extrude + EXACT bore boolean). Wired as `engineering.draft_dxf` drawing 'gear' + `engineering.model_3d` part 'gear'. LIVE mutual-proven: `npm run drill:engineering-gear` builds Z12/Z24/Z40 gears in Blender, mesh-measures OD = m·(N+2) to 0.02%, all watertight |
| Gear pairs (assemblies) | `src/lib/engineeringGearTrainCore.ts` (pure: exact pair geometry — center distance m·(N₁+N₂)/2, ratio, TANGENT pitch circles, 0.25m clearance, mesh phase; 2D assembly `buildGearPairDrawing` with center-distance dim; 3D `buildGearPairBlenderScript` composing two positioned/phased/bored gear units). `engineering.model_3d` 'gear_pair' + `engineering.draft_dxf` 'gear_pair' + `engineering.calc` 'gear_pair' (ratio/torque/speed transform — analysis composes geometry). The suite's first ASSEMBLY. LIVE: `npm run drill:engineering-gear-train` builds 3:1 & 1:1 pairs in Blender, mesh-measures span = ra₁+C+ra₂ to 0.2%, both watertight |
| Profile solids: extrude + revolve | `src/lib/engineeringProfileSolidCore.ts` (pure: polygon area/centroid, extrudeVolume=A·h, revolveVolume=2π·R̄·A Pappus; general `buildExtrudeBlenderScript` reusing the gear extrude unit; `buildRevolveBlenderScript` via Blender Screw modifier; turnkey V-groove `buildPulley`). Completes the modeling triad (CSG + extrude + revolve). `engineering.model_3d` parts 'extrude'/'revolve'/'pulley'. LIVE Pappus cross-check `npm run drill:engineering-profile-solid`: extrude L-section 0.00%, revolve tube 0.03%, pulley 0.03% vs analytical, all watertight — a 3rd independent volume method agreeing with the mesh |
| Helical solids: compression spring | `src/lib/engineeringHelixCore.ts` (pure: `helixPoints`, developed length n·√((2πR)²+p²), `springGeometry` pitch/OD/ID/index/active-coils + wire volume π(d/2)²·L; `buildSpringBlenderScript` via a POLY helix curve with circular bevel + `use_fill_caps` → watertight mesh). The helical class beyond pure revolution — the developed-length volume is the helical analogue of Pappus. `engineering.model_3d` part 'spring'; sizes the rate k=G·d⁴/(8D³n) via `engineering.calc` 'spring_rate' (materials now carry shear modulus G). LIVE `npm run drill:engineering-helix`: two springs in Blender, mesh-measured wire volume within 1.0% of developed-length (faceting-limited, converges up with bevel resolution), OD=D+d exact, free length exact, both watertight |
| ISO metric threaded fasteners | `src/lib/engineeringThreadCore.ts` (pure: `isoMetricThread` exact ISO diameters d2=d−0.6495P/d3=d−1.2269P, `ISO_COARSE_PITCH` M-series table, `threadedRodGeometry` turns/developed-length + minor/pitch/major cylinder volumes; `buildThreadedRodBlenderScript` builds the thread as a radial HEIGHTFIELD r(θ,z)=minor+threadHeight·tooth((z−θP/2π)/P) on ONE swept fan-capped tube — NO boolean). The second helical solid; composes with `engineering.calc` bolt/tap-drill (size an M8 → model the M8). `engineering.model_3d` part 'thread'. Verified by a rigorous BRACKET not a point: measured STL volume must lie in [minorCyl, majorCyl] and near pitchCyl. LIVE `npm run drill:engineering-thread`: M8×1.25 & M12×1.75 in Blender — watertight, volume in-bracket at −1% of pitch cylinder, OD=d and length exact. KEY: in-Blender manifold ≠ STL manifold (a boolean union of a separate rib read watertight in-memory but left non-manifold edges on the re-welded STL; the single swept heightfield has no union boundary) |
| Sheet-metal bending | `src/lib/engineeringSheetMetalCore.ts` (pure: `bendAllowance` BA=θ(R+K·t), `sheetMetalGeometry` folds a flange/bend sequence into TWO developed lengths — fabrication flat blank Σflanges+ΣBA (uses K) and geometric mid-surface Σflanges+Σθ(R+t/2) — plus area/volume/bbox; `bentProfilePolygon` thickens the folded centreline into a ±t/2 ribbon; `buildBentPartBlenderScript` EXTRUDES that ribbon by the width, reusing the profile-solid extruder — NO boolean). A new class beyond solids of revolution. `engineering.model_3d` part 'sheet_metal'. The two lengths differ by exactly Σθ·t·(0.5−K) — the shop cuts the K length, the solid weighs the mid-surface length. LIVE `npm run drill:engineering-sheet-metal`: 90° L-bracket & U-channel in Blender — volume = t·L_geo·width to 0.01%, watertight, predicted bbox exact |
| Structural steel sections + beams | `src/lib/engineeringStructuralSectionCore.ts` (pure: ONE verified primitive `sectionProperties(rects)` — A, centroid, Iₓ/Iy via parallel-axis over signed rectangles (holes = negative), Sₓ/Sy, rₓ/ry; named `iBeamSection`/`channelSection`/`angleSection` (doubly-sym / singly-sym / asymmetric) each a rectangle decomposition + outline polygon; `buildBeamBlenderScript` EXTRUDES the outline by length via the profile-solid extruder — NO boolean). The structural arm; composes `engineering.calc` beam (feed Iₓ/Sₓ → deflection δ=PL³/48EI, stress). `engineering.model_3d` part 'beam'. Independent area cross-check: outline shoelace = rectangle-sum A. LIVE `npm run drill:engineering-structural-section`: I-beam/channel/angle in Blender — volume = A·length to 0.000%, watertight, predicted bbox exact; section props textbook-pinned in smoke |
| A11y action verification diff | `src/lib/a11yTreeDiff.ts` |
| Illustrator ExtendScript adapters | `src/lib/illustratorExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Per-app automation profiles | `docs/apps/*.md` + `src/lib/appAutomationDocsIndex.ts` (status lockstep smoke) |
| App reachability (live ladder) | `src/lib/appReachability.ts`, `src/lib/appReachabilityProbe.ts`, tool `desktop.app_reachability`, `/apps` command |
| App screen observe/next-step | `src/lib/appScreenNextStep.ts`, tool `desktop.observe_app` (one-round-trip observe + Δ diff + suggestion) |
| Unknown-app menu discovery | tool `desktop.menu_inventory` (read-only System Events menu-bar catalog: names/enabled/submenus; never clicks/focuses/launches; feeds exact labels to `desktop.menu_click`); apps that draw menus in their own window (Blender-style) come back with only Apple/Window menus, which routes the agent to `observe_app`/a11y instead |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |
| Codebase index/search + @mentions + conventions (coding-agent P4) | `src/lib/codebaseIndexRuntime.ts`, `src/lib/projectConventions.ts`, pure cores `codebaseIndexCore/codebaseSymbolCore/codebaseMentionsCore` |
| Live TODO + tool-result summarization + run-and-fix gate (coding-agent P6) | `src/lib/agentTodoCore.ts` + `agentTodoStore.ts`, `src/lib/toolResultSummaryCore.ts` (in `agentExecutionCore.ts`), `src/lib/runAndFixGateCore.ts` (in `openswanSessionRuntime.ts`) |
| Google Workspace tools (Gmail/Docs/Sheets/Drive/Calendar) | `src/lib/googleWorkspaceOps.ts` (pure contracts), `src/lib/googleWorkspaceRuntime.ts` (token+fetch), `gmail.*`/`gdocs.*`/`gsheets.*`/`gdrive.*`/`gcal.*` in `openswanToolRuntime.ts`; OAuth Phase A: `supabase/functions/google-oauth/index.ts` + `src/lib/googleCreds.ts` |
| Cross-dashboard awareness (what's connected: marketplace/vault/Google/keys) | `src/lib/connectedResourcesDigest.ts` (pure, secret-safe) + `src/lib/connectedResourcesRuntime.ts` → `connected_resources` prompt section in `swanbot.ts` |
| Vault credential → browser login | `browser.fill_credential_field` (`credentialId` = circle vault via `vaultAgentAccess`, or `item` = 1Password) in `openswanToolRuntime.ts`; remote `fill_saved_login` in `supabase/functions/computer-use-agent/index.ts`; login-wall recovery pointer in `src/lib/computerTaskEvidenceRecovery.ts` |
| Local diagnostics + connected coding execution | `local.run_shell` + `git.run` remain compatibility names in `openswanToolRuntime.ts`, but now expose only fixed read-only git diagnostics and `node --check/--version` through `POST /desktop/exec_file` with an exact read grant. Shells, package scripts, tests/builds, and mutations are refused and must delegate through a paired Codex/Claude/Cursor/Gemini structured spawn/launch handoff with its normal approval/file-coordination boundary. |
| Context dial + receipt (`/context` lean/standard/max) | `src/lib/contextDepthPolicy.ts` (pure: depth transform — 'standard' is identity — floor compose, receipt, storage); wired at the complexity-floor + policy chokepoints in `swanbot.ts buildSystemPromptAsync`; command handled in `ChatTab.tsx`, registered in `chatCommandRegistry.ts` |

Rule: new routing behavior goes into the relevant owner above. Do not extend
legacy one-off routers when the planner/runtime owner already exists.

## Provider Routing

Provider routing is now a first-class app system, not a side list.

Current provider set includes Anthropic, OpenAI, OpenRouter, Hugging Face,
Groq, Google AI, Mistral AI, Cohere, Perplexity, Together AI, Fireworks AI,
DeepSeek, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave Search, and
browser/computer providers such as Browserbase and Stagehand.

When adding or changing a provider, keep these files aligned:

- `src/lib/llmProviders.ts`
- `src/lib/circleIntegrations.ts`
- `src/lib/serviceProfileSouls.ts`
- `src/lib/crossProviderRouter.ts`
- `src/lib/billingPriority.ts`
- `src/lib/swanbot.ts`
- `supabase/functions/llm-proxy/index.ts`
- `supabase/functions/swanbot-ai/index.ts`
- provider CHECK constraints in migrations

Model IDs may be provider-prefixed, such as `openrouter/auto`,
`google_ai/gemini-2.5-pro`, `deepseek/deepseek-reasoner`, or
`huggingface_endpoint/cswan801/BlackSwan-v5`. Normalize aliases carefully:
`hugging_face` -> `huggingface`, `z_ai` -> `zai`.

## BlackSwan And OpenSwan

- BlackSwan-v5 lives at `cswan801/BlackSwan-v5`.
- Public HF path: `huggingface/cswan801/BlackSwan-v5`.
- Dedicated endpoint path: `huggingface_endpoint/cswan801/BlackSwan-v5`.
- Tool-heavy BlackSwan requests use a reliable tool executor model —
  `BLACKSWAN_TOOL_EXECUTOR_MODEL_ID` in `src/lib/blackswanRouting.ts`
  (currently `claude-haiku-4-5`) — while BlackSwan remains app-grounding
  context.
- Training/auto-update: weekly launchd job on the dev Mac (Sunday 03:00,
  `scripts/blackswan-llm/launchd/`), full cycle in
  `scripts/blackswan-llm/train_cycle_v5.sh` — see
  `scripts/blackswan-llm/CONTINUOUS_TRAINING.md`.
- `buildBlackSwanGroundingBlock` injects app-state rules and safe memory
  references without exposing secrets.

OpenSwan remains the in-app shared agent/runtime brand. The internal default
agent id `default::blackswan` should not be renamed without a migration plan.

## Computer Use

For the end-to-end app/browser/desktop task pipeline (route -> contract -> loop
-> resume -> verify), the nine tool-loop reliability layers, cross-surface
parity, and the rules for extending it, see
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`.

Browser computer use is split into:

- planning and preview in `src/lib/computerUse.ts`
- run state in `src/lib/useComputerUseTask.ts` and
  `src/lib/useComputerUseQueue.ts`
- edge execution in `supabase/functions/computer-use-agent/index.ts`

`computerUse.ts` does not have the genuine authenticated user/circle/persisted
run, provider `toolUseId`/iteration, durable claim, and exact OpenSwan approval
identity required for mutation. Its planned `navigate`, `click`, `fill`,
`select`, `press_key`, and `scroll` actions therefore become visible,
value-stripped, structured non-executable typed OpenSwan handoffs before
screenshot, Stagehand, MCP, or bridge mutation I/O. Continue through a fresh
typed Chat/OpenSwan call; never retry a mutation through the legacy/raw lane.
Saved-plan replay preflights the whole plan and permits only the reviewed
observation allowlist.

Native Anthropic computer use currently requires a Sonnet-capable model in the
edge loop. If a user selects an unsupported model, the edge function falls back
to the default Sonnet computer-use model. Text-only planner/validator work may
use marketplace models, but the native screenshot/action loop must stay on a
computer-use-capable model.

Local computer awareness goes through `src/lib/localComputerAwarenessIntent.ts`
and bridge tools. Reads such as tabs, running apps, clipboard inspection,
screen state, file list/read/search, and accessibility tree are lower risk.
Actions such as launch/focus app, open URL/path, clipboard write/clear,
shortcut run, and window management need the risk/approval path described in
the runtime docs.

Before executing a chat request that asks to operate another app, browser,
local file, CAD tool, Adobe design file, or unfamiliar desktop program,
`src/lib/chatComputerRequestRouter.ts` builds the hidden best path: computer
preview, selected pipeline, app/browser strategy, surface order, approvals,
fallback pipelines, recommended tools, and proof requirements. Keep this route
quiet in chat; show the user only approval, proof, or actionable blockers.
The route also carries the typed app automation decision from
`src/lib/appAutomationControlSurfaces.ts`, so app/browser tasks can stop for
fresh observation, approval, user action, or connected-agent buildout before
mutating another surface.
Use `src/lib/chatComputerRequestUx.ts` for that visible/hidden notice decision
so app/browser/desktop routes share the same user-friendly wording and actions.
Live computer handoff metadata and persisted chat rows should carry that notice
and the compact route-decision summary through
`src/lib/chatComputerHandoffContext.ts` instead of inventing new copy.
`src/lib/computerTaskEvidenceContract.ts` owns observe-before, actionability,
approval, proof-after, fail-closed, retry-evidence, and source-reference
requirements for those routes. `src/lib/computerTaskEvidenceRecovery.ts` owns
failure-time contract diagnosis so chat recovery can choose fresh-evidence
retry, user unblock, connected-agent adapter repair, or stop/report. It also
emits required evidence tools plus readiness state so retries can fail closed
when observations are missing or stale. Pass the compact app route decision into
that recovery path so route-level missing confirmations, approvals,
user-action blockers, and connected-agent buildout decisions shape the recovery
options instead of being lost after preflight.

The first enforced-action foundation lives in
`src/lib/computerAppGrounding.ts`: short-lived observation epochs bind a
proposed mutation to the exact app/process/window/document or browser
session/tab. A deterministic secret-safe fingerprint of canonical normalized
handler args is bound into the sealed contract and runtime-issued exact-call
policy. Conservative unknown-mutator risk, fail-closed process-local
idempotency, single-use authorization expiry, and a sealed handler-entry
receipt guard the foundation. A task can complete only from a newer
runtime-issued same-target after-state.

Typed OpenSwan `browser.fill_field` is one of three integrated browser mutation
routes. The shared loop validates each provider `toolUseId` as a bounded run-wide-unique
capability, rejects a malformed/reused round before any handler enters, and
passes the exact `toolName`, `toolUseId`, and iteration into a fresh call
context. The runtime normalizes one exact non-secret draft, takes a DOM
observation, then calls `POST /browser/fill_target` to resolve and inspect
exactly one field before approval. That read-only step returns a short-lived,
single-use `targetId` backed by the exact ElementHandle and an HMAC privacy-safe
v2 `targetFingerprint` over all inspected semantics plus keyed
document/node/frame structure. The target id is dispatch-only and excluded from
durable approval, receipts, and model output. Durable approval stores SHA-256
bindings for the exact normalized intent and page URL plus bounded safe
origin/length and opaque process/context/page/fingerprint metadata. It does not
persist raw draft text, URL path/query/fragment, locator, or task context, and
accepts only a genuine receipt backed by an `agent_run_approvals` row. Category auto-approval creates
an exact durable `auto_approved` row first; run-scoped and consumed cross-run
approvals preserve their real row id/source. Missing ids and lookup failures
block.

The source-default SwanBot v2 edge `browser.fill_field` schema matches this
sealed non-secret/non-submit contract: it requires bounded `text` plus exactly
one accessible `name` or CSS `selector`, permits only an optional
textbox/searchbox role and bounded exactness/timeout/task context, and rejects
extra fields. There is no submit field or combobox role. Dropdown selection and
saved credentials stay in their dedicated tools. Exactly one locator is not
merely a model-schema hint: the edge schema, app normalizer/sealed runtime,
browser client request builders, and bridge target/perform endpoints each
enforce `name` XOR `selector`; both-present and neither-present inputs stop
before observation or dispatch.

The local browser bridge issues opaque process/context/live-document identity;
the page id changes on main-frame navigation or reload, including a same-URL
reload. Guarded handler entry consumes the target id once, rechecks live
identity and the target fingerprint, and inspects direct attributes, associated
labels, `aria-labelledby`/`aria-describedby`, and the containing form for
credential/recovery/seed/private-key/payment/CVV signals. It reads the same
handle before mutation and skips `fill()` when the approved draft is already
present, avoiding duplicate input/change handlers after an outcome-unknown
attempt. Both the app normalizer and the bridge reject obvious secret-bearing
draft values without reflecting them. The mutation action SHA-256-binds the
exact transient handler args; the dispatcher recomputes the digest from a
deep-frozen clone, revokes the observation epoch at handler entry, and passes
only sealed args to the handler. Proof then uses one exact-handle renderer
capture of value, semantics, document, node, and frame state bracketed by
stable browser identity checks. It contains only fingerprint, server-side
value equality, bounded lengths, a mutation/no-op flag, timestamp, and evidence
identity; it never echoes the requested/observed value or ephemeral target id. Navigation, close, bridge
restart, capability expiry/replay, detachment, or target drift fails closed and
requires a fresh observation. Completion requires that redacted proof to
produce an accepted same-target verification receipt.

`browser.set_toggle` is the second sealed route. It sets one exact checkbox,
switch, or radio to an explicit boolean through the same provider-issued call
identity, genuine exact-call approval, single-use ElementHandle capability,
keyed target fingerprint, verify-before-replay, and redacted after-state proof.
Both model and bridge boundaries require positive local presentation or
accessibility semantics; consequential and unknown settings fail closed. The
approval card includes a bounded secret-redacted target summary but not the raw
selector, task context, exact URL, or one-shot id. Generic `browser.click_role`
inspects its resolved handle and refuses native/ARIA state controls, labels,
and descendants so it cannot bypass this route.

`browser.select_option` is the third sealed browser route. It accepts one native
single-value select and one exact option value or label, takes a dedicated
fresh target/option observation, selects at most once, and proves the exact
option on the same live handle without submitting or navigating. Multi-select,
ambiguous options, protected/unknown settings, stale handles, and target drift
fail closed. Generic click refuses select/combobox/listbox/option targets,
labels, and descendants, so it cannot bypass the dedicated select lane.

`src/lib/agentActionCalls.ts` plus §26 owns durable cross-process claim/start/
finish for fill, toggle, select, the narrow native semantic press,
`desktop.open_path`, manual automation file writes, and approval-gated
external edge mutations. An
authenticated claim binds user, circle, persisted run, exact tool, provider
`toolUseId`, action id, tool-argument fingerprint, authorization-contract
fingerprint, and idempotency key without storing raw args, selectors, URLs,
content, or unrestricted metadata. The state machine is `claimed → dispatched
→ verified / outcome_unknown`; `failed` is valid only while a row is still
undispatched `claimed`. Handler entry atomically records `dispatched`, and
duplicate or terminal calls never re-enter the bridge handler.

Concurrent claimers may receive the same token. A worker that loses before its
callback therefore leaves the claim unfinalized/reclaimable instead of
overwriting another worker's dispatched action. Any error after confirmed
handler start maps only to `outcome_unknown`; the TypeScript parser rejects a
forged failed-after-dispatch payload. If fresh proof verifies the task but the
final database acknowledgement is unavailable, the user-facing result remains
truthful `ok: true` while warning that the exact call is replay-blocked.

Native `desktop.click_element` is a narrow semantic-press canary. It requires a
fresh indexed accessibility observation, exact app/PID/path/role/label/
fingerprint agreement, genuine exact approval, one target-bound press, and a
refreshed exact-target semantic diff. It does not authorize arbitrary desktop
coordinates, consequential controls, or general native-app mutations.

SwanBot v2 routes every browser/desktop mutation currently registered as
client-delegated through the canonical OpenSwan runtime before any raw
dispatcher, preserving provider tool name/id/iteration. The four guarded
canaries additionally keep their sealed proof, durable action-call, and
sanitized receipt contract; hidden receipt subsets never enter model content,
are re-sanitized at the edge, and persist as correlated client result events.
This current-catalog interception is not a universal guarantee for future tools,
other callers, or mutation families without a sealed verifier.

The default edge continuation client unions hard constraints parsed from the
raw turn with richer upstream constraints. Before handler entry it executes the
constraint/always-confirm floor and then, when supplied, the live exact-call
review callback. Missing required approval, rejection, or callback failure
blocks without dispatch. A live review surface serializes the batch so approval
prompts cannot race or reorder decisions. A non-empty always-confirm floor
forces every non-read browser/desktop call through that gate, including bland
or opaque keypresses and unknown/future mutation names whose arguments do not
repeat the floor.

Continuation resume is encrypted, bounded, and single-consumer. The exact
paused model/tool snapshot is minimized and sealed with AES-256-GCM by
`swanbot-continuation-crypto.ts`; it is never stored as plaintext. Public
`agent_runs.metadata.continuation` contains only a value-free CAS envelope:
opaque identity, protocol/storage versions, one-time nonce, resume/claim state,
bounded counters/tool identities/timestamps, an `expiresAt` exactly ten minutes
after `pausedAt`, and the authenticated ciphertext envelope. Public tool-event
inputs are structural value-free schemas and persisted failures use stable
redacted codes/copy. Exact arguments and errors remain transient for live
approval, dispatch, proof, and model-loop work.

Deployments must explicitly configure a dedicated
`SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and
`SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`; do not derive or reuse the
service-role key or another shared credential. The source fallback key version
`v1` is not a key-rotation configuration. With no continuation encryption key,
SwanBot withholds every `clientOnly` tool before the model turn and dispatches
no local action instead of creating a plaintext or unresumable checkpoint.
AES-GCM additional authenticated data also binds the canonical lowercase
`runId`, `userId`, and `circleId` for the persisted row. Those identifiers are
not copied into the six-field public ciphertext envelope, and moving ciphertext
to another row fails through the same unreadable-close/no-replay path.

The client must first present a client-generated exact claim: an edge CAS
changes `pending` / `client_pending` to `dispatch_claimed` /
`client_dispatching` before any local tool handler runs. Only the exact echoed
claim may dispatch. Exact result submission then atomically rotates that state
to `results_claimed` / `client_resuming` before the model loop resumes, and that
claim gates every later next-pending or terminal update. Competing or non-exact
duplicate claims, ambiguous acknowledgements, expired leases, failed
claim-bound writes, and post-claim loop failures become `outcome_unknown` with
no reopen or automatic replay. Only an exact same-claim dispatch retry carrying
the already-winning claim is idempotently acknowledged; a different claim or
mixed protocol/state never is. Readiness ignores all three active stop-reason
rows: `client_pending`, `client_dispatching`, and `client_resuming`.

Terminal integrity is independent of the model's final prose. Once a
client-delegated mutation is durably recorded as dispatched but returns
`ok: false`, lacks accepted verification, or reports outcome-unknown, that
condition latches across continuation rounds. A later model `end_turn` cannot
convert it to completion: the edge persists a replay-blocked failed terminal,
publishes no completed Feed card, and returns a structured non-fallback 409.
Fresh terminal writes also check the compare-and-set result and exact reread;
a late user cancellation wins, while any other ambiguous write stops before
publication. The client preserves `cancelled: true` as a neutral reached-edge
terminal for empty or nonempty model tails, so STOP never trips the transport
breaker or falls through to v1. Any other authenticated/reached-edge empty
terminal is likewise non-fallback and surfaces a stable missing-payload stop.
Direct WordPress and workspace mutations now stamp a value-free receipt at the
exact provider/database/UI dispatch boundary; only concrete returned identity
and state can add accepted completion proof, while `workspace.open_preview`
and ambiguous trash responses remain outcome-unknown. The original
`turnRequestId` is preserved in every fresh pending, terminal, cancellation,
and failure metadata replacement, so a lost-response retry collides before
another model or Feed run.

The edge also latches before every server-side memory/task/mission/message/
room/approval writer enters its handler. If a later model or runtime failure
makes that turn ambiguous, the run closes as
`server_mutation_outcome_unknown` with `replayAllowed: false` and a
verify-before-new-action marker. The client reads that structured non-2xx
response and stops before v1 fallback, rather than retrying the whole turn
under a new run identity. A modern fresh call generates one UUID
`turnRequestId`, reuses it across transport attempts, and the edge inserts it
as `agent_runs.id`; a duplicate primary-key attempt stops before the model.
Legacy/no-identity fresh calls retain read-only/text work but have every
server-side writer withheld.

Section 29 adds a service-role-only, atomic continuation privacy sweep. When
installed, its named `pg_cron` job runs every three minutes (or emits a stable
NOTICE when cron is unavailable) and closes active missing, legacy/plaintext,
malformed, state-mismatched, or expired checkpoints with a value-free
`continuationResumeOutcome` and `replayAllowed: false`. `client_pending` closes
as `failed_before_dispatch`; claimed `client_dispatching`/`client_resuming`
work closes as `outcome_unknown`. The migration separately performs a one-time
scrub of terminal/non-active checkpoints. Its protected-row trigger also
rejects authenticated INSERT/UPDATE/DELETE attempts for active SwanBot v2
continuations, preventing row cloning or protected-field rewrites while
preserving existing reads, service-role/Postgres maintenance writes, and the
exact owner-only `running → cancelled` STOP transition followed by one bounded
write-once cancellation-provenance merge.

The legacy `computerUse.ts` planner/executor is observation-only. All six legacy
Computer Use mutation kinds—`navigate`, `click`, `fill`, `select`, `press_key`,
and `scroll`—return structured non-executable OpenSwan handoffs before
screenshot, Stagehand, MCP, or bridge I/O; saved-plan hydration and persisted
session projections strip mutation values. `/replay` likewise preflights the
complete recording and runs zero steps when any browser/desktop mutation is
present. Only its explicit observation allowlist can replay locally.

The hosted Browserbase Computer Use lane is separately source-hardened as of
2026-07-26. `computerUseAgent` sends a bounded schema-v1 execution-policy
envelope that the edge validates before provider/session work. Authenticated
Chat/queue calls require an interactive envelope; watch/service calls are
forced to scheduled observation-only execution. Authenticated legacy callers
without a policy receive HTTP 400. All three root Chat cloud starts—automatic
browser launch, booking-session continuation, and manual approved launch—use
`buildChatComputerUsePolicyInputs` to preserve derived user constraints plus
the opaque-target, credential, and external-side-effect confirmation floors.
The single-task and queue hooks acquire synchronous start reservations before
imports or credential lookup, count pending starts against capacity, and
invalidate those reservations on cancel/clear.

The edge classifies left/right/double click, type, key, and saved-login filling
as mutations; unknown native actions fail closed. Because current coordinate
and focused targets are opaque, every such mutation requires durable exact-call
live confirmation even when a pre-run grant exists. An approved call is
bracketed by fresh pre/post screenshots and uses one-attempt dispatch.
Missing pre-action proof blocks before dispatch; a dispatched but unverified
result becomes `mutation_outcome_unknown` with no automatic replay.
Secret-bearing type/key/credential/question data is redacted or omitted across
SSE actions, progress/action traces, model history, guided replay, stuck-solver
payloads, usage metadata, and errors.

`computerTaskRuntime` no longer performs a deterministic app mutation or
attachment open/wait before the authenticated typed agent loop. Read-only live
observation may still precede `executeAgentRun`; app/hybrid work itself does
not. This removes the pre-agent app-adapter and attachment-open bypasses.
Uploaded files remain staged and return a value-free, non-executable
`desktop.open_path` handoff with no raw path or fabricated identity, approval,
receipt, or proof. The exact staged context remains in the authenticated task
prompt and is redacted from result, capability-buildout, and action-trace
telemetry.

Approval authority is exact and single-use across the audited Chat,
OpenSwan, and SwanBot lanes. Chat hashes the complete normalized plan and
user/circle/thread/room scope, then consumes `agent_approvals.applied_at`
before one transport dispatch. OpenSwan hashes canonical tool arguments plus
authenticated persisted-run/provider-call identity and atomically stamps one
dispatch binding. SwanBot WordPress writes and the generic risk floor use that
same schema-v2 digest/claim model. Durable and model-visible payloads keep only
bounded structural labels and safe digests; raw commands, paths, values,
credentials, and canonical approval keys remain transient.

Durable OpenSwan/subagent tool-call telemetry is also value-free:
`eventBoundCore` persists only bounded field/type/shape summaries. Unknown
tool-result success payloads collapse to a value-free result schema, while
receipt metadata survives only through namespace/field/type/value allowlists.
`agentRunSystem.addStep` applies the same fresh summary at the final
`agent_run_steps` insert boundary: tool input, tool output, tool-bound
metadata/title/body, and malformed tool names are reduced to controlled
structural labels. The Run History drawer projects each whole tool step and
suppresses legacy raw name/title/body/output fields. Exact arguments and
arbitrary results remain in-memory solely for approval, dispatch, proof, and
model work; ordinary non-tool message/plan metadata/title/body keeps its
compatible shape.
`event-bound-core` is a readiness requirement and runs once in both release
gates (it was already present once in `smoke:all`).

Legacy direct local-file, image-conversion, and diagnostic launch paths return
only value-free, non-executable typed-tool handoffs. Executable
`desktop.open_path` work instead requires fresh stat/path digests, authenticated
run/provider-call identity, exact approval, a §26 claim/start, one bridge
attempt, and fresh exact frontmost-app proof; ambiguity is `outcome_unknown`
with no replay.

Typed OpenSwan and SwanBot v2 generic native input calls now share a guarded
dispatch boundary. `desktop.type_text`, `paste_text`, `press_keys`,
`menu_click`, `click_at`, the mouse move/click/down/up/drag family, and scroll
require an exact `appName` copied from `desktop.window_state` or
`desktop.observe_app`. The runtime observes the frontmost app before approval,
SHA-binds the exact args/app/PID/surface using a digest stable across a later
fresh observation of that same target, then rechecks a private one-shot guard
at handler entry before the §26 claim/start/one-attempt bridge dispatch.
Coordinate and mouse actions additionally require fresh screen bounds and a
visible exact-app window. PID, surface, bounds/window, args, TTL, clone, or
replay drift fails before mutation. These legacy endpoints return only bridge
acknowledgement, so an attempted call returns `ok: false`,
`completionVerified: false`, and `outcomeUnknown: true`, then seals
replay-blocked `outcome_unknown`; it is never reported as independently
verified completion. `desktop.set_element_value` requires `appName` in its
schema but stops before approval until a fresh accessibility generation and
dotted-path identity can be sealed through handler entry.

`automation-executor` keeps service/scheduled invocation read-only and permits
a manual room-file write only with fresh exact one-use authority plus §26.
Every scheduled external action needs a fresh approval for its exact
occurrence, one durable claim, and one dispatch. Timeout/post-dispatch failure
persists `outcome_unknown`; Pending Actions shows a redacted verify-first state
without retry. Office Realtime is likewise not authority. After client
authentication/shape checks, §28 `invoke_agent` locks the exact durable
message/circle/expected command, checks membership and owned target/scope, and
returns canonical command/sender/targets/model. Claims are idempotent per
message/agent subject (including synthetic `blackswan`); stream/completion
writes require the same claimant, membership, live state, bounded payload, CAS,
and multi-target completion coverage. Section 28 also validates and freezes
protected schema-v2 Chat/OpenSwan approval bindings, with server-stamped
resolution and requester-only expiry/one-shot consume.

Source catalog parity is pinned at **25 server-side + 57 client-delegated = 82
total**. The added `browser.locator_actionability` lane is read-only advisory
evidence for one fresh exact browser target; it does not authorize or bind a
later mutation. `browser.dom_snapshot` redacts every editable value inside the
bridge walker, excludes hidden/inert/script/style/template/noscript descendants
from ancestor text, canonicalizes bounded roles, and exposes only controlled
field kind/state/value length. One entry/capture/exit check binds tree and title
to the same process/context/page/exact URL. Model-visible URLs are HTTP(S)
origin-only; an opaque process-HMAC URL identity lets actionability reject
exact URL or document drift without revealing userinfo, path, query, or
fragment. The identity rotates on bridge restart; every raw/forged legacy URL
identity and non-HTTP snapshot fails closed. The typed client loop remains device-local opt-in/default-off, current
SwanBot v2 edge source has not been deployed/re-verified, and production
telemetry still gates a default flip. Section 29 is authored/mirrored but has
not been applied or live-DB verified. Consequently there is no live proof yet
for encrypted resume/key rotation, claim races, three-minute cron expiry, or
historical checkpoint scrubbing. Pre-deployment plaintext/legacy continuations
fail closed or are scrubbed only after the edge is deployed and §29 is applied.
The updated `computer-use-agent` edge is also source-only and has not been
deployed/re-verified. No live Browserbase/DB confirmation integration or
native-app GUI run was performed. Its HTTP 400 response for authenticated
legacy callers without a v1 policy is intentional.

Native `desktop.launch_app` and `desktop.focus_app` also converge on one
proof-bearing helper across the app adapter, typed OpenSwan, and SwanBot v2:
fresh before/after observations, exact-or-explicit-alias resolution, positive
PID identity for running targets, no-op detection, dispatch-target checks, and
outcome-unknown/no-replay when verification is missing. A bridge
acknowledgement by itself never completes launch/focus.

`/desktop diag` is a read-only bridge health/pairing/running-app probe.
`/desktop diag <app>` remains read-only too: it does not launch, focus, open,
click, or type. It returns a value-free non-executable `desktop.launch_app`
typed-runtime handoff so a fresh authenticated run can obtain exact provider
call identity, approval, dispatch receipt, and post-launch focus proof.

The verified boundary remains narrow. It covers non-submit/non-credential fill,
clearly local presentation/accessibility toggle, one exact option in a native
HTML single-value select, and one exact low-consequence native semantic press.
Eleven generic native typing, paste, keypress, menu, bounded
coordinate/mouse/scroll actions now share observe-before-approval, stable
args/app/PID/surface binding, one-shot handler-entry recheck, and §26
claim/start/one-attempt dispatch; coordinates also require live screen bounds
and a visible target-app window. SwanBot v2 no longer raw-dispatches those
browser/desktop mutations in its current client catalog. The bridge endpoints
still return only an acknowledgement, so completion is now decided by a fresh
before/after accessibility diff of the exact target app
(`src/lib/nativeUiVerificationCore.ts`) rather than by the acknowledgement:

- `verified` requires attribution, not movement. Text entry
  (`type_text`/`paste_text`/`set_element_value`) verifies only when a changed
  field value contains the exact text sent — or, when the snapshot truncated at
  `A11Y_SNAPSHOT_MAX_STRING_LENGTH`, when the sent text contains that truncated
  value. `menu_click` verifies only when a node labelled like the invoked leaf
  item appears. Unattributable tree movement never promotes to `verified`.
- `no_effect` is new and is a *proven* no-op: for the four tools that must move
  the tree, a byte-identical before/after is positive evidence the action
  missed. This replaces a blanket "unknown" that could never be improved.
- Everything else — mouse move/down/up, scroll, bare clicks, keypresses —
  stays `unknown`, because those routinely land without an accessibility-visible
  change and calling them `no_effect` would manufacture a failure.
- A missing or failed snapshot is always `unknown`; absence of evidence is never
  evidence of absence.

§26 forbids `failed` after dispatch, so a proven `no_effect` still seals
durable `outcome_unknown` and stays replay-blocked; only the user-facing text
carries the sharper truth.

The attribution requirement is not theoretical. A read-only live probe against
Google Chrome on 2026-07-29 read the same window's accessibility tree twice
back-to-back with no action performed and observed **8 changes** (+4/-4) from
ordinary background churn — a live feed plus a window title carrying memory
usage. A "the tree moved, so it worked" rule would have reported verified for
an action that was never dispatched. Repeat samples on the same idle window
produced 0 changes, so the churn is intermittent and app-dependent: the naive
rule passes local testing and then fabricates completions against any app with
live content. Both regimes produced the correct verdict (`unknown` when the
tree moved unattributably, `no_effect` when it did not move at all).

The pure policy and its runtime wiring are source/contract-verified
(`native-ui-verification-core` incl. integration cases over the real
`snapshotA11ySummary`/`diffA11ySummaries`, plus
`openswan-generic-native-ui-runtime`). The bridge read path is live-verified
read-only. No live native-app MUTATION has been executed end to end. Accessibility value-setting requires `appName`
but fails closed before approval pending exact generation/path sealing. The
separately vault/origin-gated credential tool retains its own compatibility
boundary. Submit, upload, browser navigation/close, generalized native
after-state verification, future catalog additions, non-typed callers, and a
complete universal sealed gateway remain pending. Focused source/contract
smokes and app typecheck verify this slice; current edge source is not
deployed/re-verified, §29 is not applied, and pre-deployment plaintext/legacy
pending continuations do not gain the fail-closed/scrub boundary until those
steps. No live browser/native-app GUI execution or live Postgres
contention/race proof was performed. §26 is applied and live-DB verified as of
2026-07-29 (table, RLS, grants, and fail-closed unauthenticated claim); its
concurrent-claim race behavior is still not proven. §29 remains authored and
mirrored but unapplied, so checkpoint cleanup is not an operational claim.

`src/lib/computerTaskOutcome.ts` is the source of truth for non-browser task
results. Chat may adapt its richer statuses to the older transport enum, but it
must preserve the full status in metadata and must never turn response text or
a failed adapter result into completion. Successful deterministic app
mutations without explicit fresh proof remain partial; canonical read results
are their own evidence. Agent-only verified tasks are currently inconclusive
because SwanBot returns text rather than a structured terminal proof signal.
Those runs preserve the real thread,
active plugins, cancellation signal, route constraints, and always-confirm
floor in `SwanBotContext`; the opt-in typed client canary consumes them, while
the default edge route remains non-cancellable. The plan-level Chat approval is
not exact tool-call consent.

The Chat dispatcher also builds one bounded immutable `chatAgentContextPack`.
Real app/file/hybrid computer runs and both app-capability retry paths pass that
pack through `AgentRunRequest`; `agentRuntime` injects its `compactPrompt` into
model context and saves a bounded projection in run metadata. Remaining
non-computer connected-agent entrypoints still need the same migration.

Unfamiliar-app capability buildout state is provider-aware. Automatic delayed
result recovery supports dedicated bounded `APP_CAPABILITY_*` receipts from
Codex and Claude Code, with exact or unique sufficiently long session matching.
The Claude bridge reconciles its transcript JSONL id to the managed launch id
only from one anchored, unambiguous UC marker; absent or conflicting claims do
not attach.
Gemini and Cursor remain general delegation providers but are excluded from
automatic capability buildout until their bridges expose the same strict result
channel; persisted legacy records without a provider retain the former Codex
interpretation.

`agentRunPersistence` now preserves typed-loop dispatch truth and bounded,
primitive-only computer action/mutation/verification receipt subsets. The
guarded browser fill/toggle/select and native semantic-press canaries emit
issued mutation-dispatch and computer-app-verification receipts into that
durable allowlist. Approval telemetry stays hidden from the model: the canonical
approval key and args are
removed and only an issued digest-safe receipt rides the runtime side channel;
the approval row itself is the durable source. Other mutations still do not
emit the complete receipt contract, so the universal gateway, stable desktop
window/document identity, and automatic observation invalidation remain
required. The transactional cross-process ledger is live as of 2026-07-29
(§26 applied); before that every guarded mutation failed closed at the claim
with `rpc_error` and was never dispatched. Concurrent-claim races remain
unproven against a live database.

Local bridge mutation authority stays loopback-bound and is remote-accessible
only through an explicitly allowlisted tunnel. The Claude, Codex, Cursor, and
Gemini bridges share source/Host/Origin checks, challenge pairing, and bearer
token validation. The Claude desktop surface additionally enforces exact file
grants and denies shell-family launchers on its fixed read-only exec-file
route. If a bridge is intentionally tunneled, the server must also be restarted
with `UC_BRIDGE_ALLOWED_HOSTS` set to the exact tunnel Host value and
`UC_BRIDGE_ALLOWED_ORIGINS` set to the exact browser origin; a public client URL
alone never authorizes the tunnel.

Photoshop/InDesign creative-AI work uses `src/lib/designAppCreativeAi.ts` for
text-to-image, generative fill/remove, generative expand, creative variants, and
InDesign data-merge variant planning. It also turns those capabilities into
reusable recipes such as Photoshop generated background packs, variant contact
sheets, localized cleanup, canvas expansion, InDesign frame placement, placed
image expansion, and data-merge campaign variants. It requires prompt/data
approval, target-layer/frame/selection evidence, generated-output receipts,
proof verification, and connected-agent adapter buildout when the exact Firefly
or app bridge tool is missing.

Photoshop/InDesign task execution order lives in
`src/lib/designAppExecutionPipeline.ts`. That file combines automation plans,
operation runbooks, creative-AI recipes, and adapter-gap contracts into the
shared resolve -> observe -> approve -> mutate -> export/package -> verify ->
recover pipeline used by SwanBot/OpenSwan prompts, chat handoff metadata,
persisted chat rows, and connected-agent buildout prompts.

## Memory, Skills, And Approvals

- User memory: `src/lib/userMemory.ts`.
- Agent memory/run identity: `src/lib/agentRuntimeSubject.ts` resolves stable
  subject keys and legacy aliases across Office, Chat, SwanBot, and OpenSwan;
  Office-originated SwanBot calls and v2 batch telemetry preserve the same
  subject metadata. Automation proposals, `/automation run/test`, OpenSwan
  saved automations, specialized Chat/OpenSwan mode runs, `automation-executor`,
  the Automations dashboard, Office terminal, `AgentMemoryPanel`, and
  `AgentRunsPanel` preserve or display that metadata. Pure key normalization
  lives in `src/lib/agentIdentityKey.ts`.
- Circle memory bank: `src/lib/memoryBankKinds.ts`,
  `src/lib/memoryBankChatCommands.ts`, `src/services/sharedMemory.ts`.
- Skill library: `src/lib/skillLibrary.ts`, `src/lib/skillLibraryWrite.ts`,
  `src/lib/skillPromptInjection.ts`, `circle_skills`, `circle_skill_files`.
- Checkpoints: `src/lib/chatCheckpoints.ts` and
  `src/components/ToolCallCheckpointStrip.tsx`.
- Run persistence: `src/lib/agentRunPersistence.ts`, `agent_runs`,
  `agent_run_events`, `claude_api_usage`. Tool-event persistence distinguishes
  dispatched, skipped, and legacy-unknown calls and drops arbitrary hidden
  result metadata outside bounded receipt allowlists.

Memory writes, skill writes, credential access, and destructive automation
changes must follow the HITL/approval rules in the roadmap.

## SQL And Schema

- Local migration files live in `supabase/migrations/`.
- Consolidated agent-runtime helper SQL lives in `docs/RUN_THIS_SQL.sql`.
- The roadmap SQL checklist owns applied/pending status. Do not treat a local
  migration file as proof that production has it.
- `20260726_agent_action_calls.sql` (§26) is **APPLIED and live-DB verified
  (2026-07-29)**: `agent_action_calls` exists with RLS on, one owner-read
  policy, `SELECT` to `authenticated`, and the three `claim`/`start`/`finish`
  RPCs granted to `authenticated`. A live unauthenticated claim probe returns
  structured `not_authenticated` rather than a row, so the fail-closed identity
  binding is proven against Postgres. Cross-process CONTENTION (two real
  workers racing one claim) is still unproven.
- `20260726_scheduled_action_mutation_guard.sql` is mirrored as §27 but is
  **not applied or live-DB verified**. Apply it before relying on the scheduled
  claim/dispatch/outcome-unknown state machine.
- `20260726_database_authority_guards.sql` is mirrored as §28 but is **not
  applied or live-DB verified**. Its 146-assertion source/byte-identity smoke does not prove
  Office RPC races or protected approval resolution/consumption in Postgres;
  local Docker/Supabase was unavailable for this review.
- `20260726_swanbot_continuation_privacy.sql` is mirrored as §29 but is **not
  applied or live-DB verified**. Its source checks do not prove encrypted
  continuation resume/key rotation, live claim races, cron expiry, or the
  historical scrub against Postgres.
- After schema changes, use `NOTIFY pgrst, 'reload schema';` when relevant.

Schema gotchas:

- `profiles` has no `email` column.
- `circle_office_agents` has no `model` column; owner FK is `owner_id`.
- `user_xp` primary key is `user_id`.
- `room_messages.message_type` is constrained.
- `circle_members` RLS can recurse; use security-definer helpers where present.

## Critical Guarantees

- `src/lib/animationPatch.ts` must remain the first import in `App.tsx`.
- Frontend code uses the singleton Supabase client in `src/lib/supabase.ts`.
- New auth reads should use `safeGetUser`, `safeGetSession`, or
  `getFreshAccessToken` from `src/lib/authSession.ts`.
- If a direct `supabase.auth.getUser()` or `getSession()` call is unavoidable,
  attach `.catch(...)`.
- Do not put raw secret values in prompts, persisted chat metadata, logs, or
  activity feed entries.
- Retrieved memory, chat, or search content is untrusted. Preserve the
  roadmap's untrusted-content wrapping rules for model-visible quoted content.
- Guarded fill/toggle/select/native-semantic mutations must claim only after
  genuine authorization and record `dispatched` inside the sealed handler just
  before bridge entry. A pre-handler race loser leaves the claim reclaimable;
  a post-start error is `outcome_unknown`, never `failed`.
- Keep every SwanBot v2 client-delegated browser/desktop mutation intercepted
  by the canonical OpenSwan runtime before raw dispatch. New tools and callers
  need explicit policy/proof parity; current catalog coverage is not universal.
- A claimed edge continuation is one-way. Preserve identity/version/nonce plus
  dispatch claim id, the pre-side-effect `client_pending →
  client_dispatching` CAS, the pre-model-resume `client_dispatching →
  client_resuming` CAS, and claim-bound writes; ambiguity is `outcome_unknown`
  with no automatic replay.
- Never persist an exact SwanBot continuation snapshot or raw tool
  input/failure in public run metadata/events. Preserve the encrypted,
  ten-minute value-free envelope, explicit dedicated secret/key-version
  configuration, no-key `clientOnly` withholding, and §29 expiry/scrub
  boundary; continuation resumability is never indefinite.
- Treat approvals and Realtime events as separate trust boundaries. One exact,
  current, atomically consumed approval may authorize one dispatch; a
  broadcast may only wake a receiver that authenticates and rereads durable
  RLS state.

## Validation

The current app baseline expects `npm run typecheck` to pass.

Focused smoke scripts in `package.json` cover the main runtime areas. Prefer
the narrow script for the code you touched, for example:

```bash
npm run smoke:agent-core
npm run smoke:chat-planner
npm run smoke:computer-task-runtime
npm run smoke:cross-provider-router
npm run smoke:agent-runtime
```

The 2026-07-27 guarded-action slice is source-verified by the focused
103-assertion `agent-action-calls` ledger smoke, `agent-action-runtime-wiring`,
read-only `browser-locator-actionability`, browser fill/toggle/select,
computer-app grounding, `swanbot-v2-batch-policy`,
`swanbot-v2-continuation`, `swanbot-v2-edge-fill-schema`,
`computer-use-mutation-handoff`, `chat-recording`, readiness, and typed-runtime
invariant smokes plus app typecheck. Locator actionability remains advisory and
cannot authorize or bind a later mutation. That is not a current-edge deployment,
live Postgres migration/contention check, or live browser/native GUI proof.
`openswan-generic-native-ui-runtime`, `browser-dom-snapshot-privacy`, and
`swanbot-v2-terminal-integrity` each run exactly once in both Chat/SwanBot daily
and release chains and in `smoke:all`; these are source/contract gates, not live
database, Browserbase, native-GUI, or deployed-edge proof.
The 2026-07-26 cloud/root-Chat slice is source-verified by
`computer-use-cloud-policy`, `chat-computer-request-router`, and
`computer-task-runtime-context`. The cloud-policy and runtime-context guards
run exactly once in all Chat/SwanBot daily and release gates, `smoke:all`, and
canonical readiness. Exact approval, direct-handoff, open-path, automation,
scheduled-action, Office broadcast, and database-authority guards share that
same exactly-once gate contract. This is not evidence of a deployed edge, live
Browserbase/confirmation-database integration, or live native-app execution.
It also does not prove §26/§27/§28/§29 application, live Realtime/RLS behavior,
encrypted continuation/key-rotation or cron-expiry behavior, concurrent claims,
external provider dispatch, or updated edge deployment.

## Known Risk Areas

- Older code still has many direct Supabase auth calls. Do not add new unsafe
  ones; migrate to `authSession` helpers when already touching the file.
- Provider routing is multi-surface. A provider added only to the model picker
  but not `llm-proxy` or `swanbot-ai` will look selectable but fail at runtime.
- `swanbot-ai` v1 still has legacy tool-loop code. `swanbot-v2-ai` is the
  typed-loop migration target tracked in the roadmap.
- Chat persistence now stores compact metadata for source, routing, usage,
  browser plans, artifacts, memories, and execution stream. Keep payloads
  bounded to avoid oversized message rows.
- Browser and desktop actions must stay explicit about risk and approval.
- The universal browser/desktop mutation gateway remains incomplete; the four
  guarded canaries and unapplied §26 ledger must not be generalized into a
  claim that arbitrary apps can already be operated safely end to end.
- Current SwanBot v2 encrypted-continuation edge changes are source-only until
  deployed and re-verified; §29 is source-only until applied and live-DB
  verified. Old plaintext/legacy pending continuations fail closed or are
  scrubbed only after those steps, so deployment must account for in-flight
  turns and explicitly provision the dedicated encryption secret/key version.
