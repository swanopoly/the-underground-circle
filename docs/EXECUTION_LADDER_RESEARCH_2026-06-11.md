# Desktop/App/Browser Execution Ladder — Research + Build Plan (2026-06-11)

> Second focused deep-research round (103 agents, 23/25 claims verified 3-0 —
> the round the tool-tree report deferred to) + grounded gap analysis of the
> execution stack. Build items are E-items below; statuses tracked here.
> Companion: `docs/TOOLTREE_DESKTOP_RESEARCH_2026-06-10.md` (catalog round),
> `docs/SWANBOT_OPENSWAN_CHAT_NEXT_PLAN_2026-06-08.md` (canonical backlog).

## Verified findings (primary sources; full evidence in the workflow record)

1. **No frontier vendor ships tree-grounded desktop control.** Anthropic
   computer_20251124, OpenAI Operator/CUA, Google Gemini 2.5 CU are all
   screenshot+coordinate only; Google explicitly "not yet optimized for
   desktop OS-level control". Our a11y-first bridge is ahead of vendor
   offerings; the relevant SOTA is academic/Microsoft (UFO2).
2. **UFO2 (Windows Agent Arena): hybrid tree+vision beats either alone**
   (23.4%→26.6% GPT-4o; vision-only collapses to 14.3% on OSWorld-W while
   hybrid holds 22.4%); **>62% of tree-only failures are a11y coverage
   gaps** (toolkits bypass UIA; LibreOffice-class apps fail for every
   agent). Empty/wrong trees are ROUTINE, not edge cases — the pixel
   fallback is mandatory, not optional.
3. **Typed adapters are the verified top rung**: +6.1–8.2pp success and up
   to 58.5% fewer steps vs GUI-only (UFO/UFO2 COM APIs); long GUI sequences
   "collapsed into a single API call". Validates our Adobe adapters and the
   API → a11y → pixels ladder.
4. **Raw tree dumps hurt**: thousands of tokens + 3–26s per step; raw
   trees INCREASED step counts for most OSWorld apps (Writer 21→50);
   filtered/marked hybrid (SS+A11y+SoM) was fastest (16 steps);
   A11y-Compressor-style pruning cut tokens to 22% while improving success
   +5.1pp. Trees are for TARGETING; send pruned slices, never dumps.
5. **Pixel-rung hardening, vendor-validated**: Anthropic's zoom action
   (region re-screenshot at full resolution) is the prescribed fix for
   missed small targets; keyboard shortcuts preferred when coordinate
   clicks fail; screenshots cost ~1,000–1,800 input tokens each — prune
   history in byte-identical batches (keep last 3, prune ~every 25 turns)
   for cache stability.
6. **Visual reads corrupt data**: Operator "almost always" reads complex
   strings (API keys, addresses) visually → OCR errors; compounding visual
   text-editing errors in editors; 4/10 on unfamiliar UIs (8/10 with UI
   hints). Prefer clipboard/typed value transfer (`set_element_value`,
   clipboard tools) and typed editing surfaces over GUI text editing.
7. **Confirmation floor quantified**: requiring confirmation before
   state-changing actions cut model-mistake risk ~90% (OpenAI, 607 risky
   tasks); model-discretion confirmation only hits 92% recall — a
   deterministic floor (our pay/delete/login/grant) is the right call.
8. **Anthropic runs screenshot-time prompt-injection classifiers by
   default** on the computer-use API (flag → ask-user-before-next-action).
   Our Browserbase edge loop rides that platform layer; our LOCAL
   observation channel (a11y text, DOM snapshots, OCR) is the unclassified
   surface — fence observation text as untrusted. Their
   `<robot_credentials>` guidance (secrets in model context) is WEAKER
   than our vault/takeover design — keep ours.
9. **Refuted/unresolved**: both Claude Cowork grounding claims died (0-3) —
   cite nothing about Cowork. RQ2 (macOS AX coverage rates) and RQ3
   (extension vs CDP for local browser; what Claude-in-Chrome/Atlas use)
   produced no surviving claims → NO local-browser architecture change;
   keep the Playwright bridge. macOS evidence is extrapolated from Windows
   UIA — treat magnitudes as directional.

## Gap analysis (codebase, file:line evidence in the agent record)

Foundation-solid, operationally brittle. Top impediments: (1) no
mid-execution surface escalation — failures mean manual replan; (2) empty/
stale a11y trees errored with no ladder [FIXED 2026-06-11]; (3) ambiguous
browser locators silently picked [FIXED]; (4) silent DOM truncation
[FIXED]; (5) redundant tree re-reads [FIXED — hash cache]; (6) 'partial'
capability treated as 'ready'; (7) verification gates not auto-checked
[FIXED]; (8) buildout manual-only; (9) pairing token fragility; (10)
broad file-grant scopes.

## E-items

- **E0 SHIPPED (2026-06-11) — robustness quick wins** (research-independent):
  ambiguous-locator detection w/ candidates + `nth` (bridge server-side);
  DOM truncation flag + explicit trailer; a11y empty-tree retry-once →
  structured `a11y_tree_empty` with screenshot-fallback hint; PID-staleness
  guard on element actions (`a11y_path_stale`); per-app tree hash cache
  ("[unchanged since last observation]"); pre-mutation verification-gate
  auto-check (fail-to-human, skippable, server still gates). Smokes:
  browser-locator-resolver, a11y-tree, browser-bridge + regressions.
- **E1 — Mid-execution surface escalation ladder.** When the active rung
  fails (adapter error / a11y_tree_empty / a11y coverage miss), descend the
  EXISTING ranked candidates from `appAutomationControlSurfaces` within the
  run — bounded (≤2 descents), evidence-contract-respecting (fresh observe
  on the new rung), approval-aware (a rung with extra approvals stops for
  them), and reported ("escalated from X to Y because Z"). 'partial'
  capability = degraded rung, not 'ready'. (Research #2/#3; gap #1/#6.)
- **E2 — Pruned, targeting-oriented tree slices.** read_a11y_tree gains a
  task-target filter (interactive roles + label-match subtrees + ancestor
  context) and SoM-style stable node indexes for targeting; full dumps
  only on explicit detailed request. (Research #4.)
- **E3 — Region zoom primitive.** Bridge screenshot with region crop for
  the pixel rung (re-observe small targets at full resolution before
  coordinate clicks); edge loop: adopt zoom-capable tool version where
  available (deploy-gated). (Research #5.)
- **E4 — Non-visual transfer rules.** Prompt-rule pass in the canonical
  dispatch/prompt builders: read values via a11y/clipboard not OCR; prefer
  set_element_value/typed surfaces over GUI typing for precise strings;
  keyboard shortcuts before coordinate clicks. (Research #6.)
- **E5 — Edge screenshot history pruning** (keep-last-3, batch pruning)
  for cache stability in `computer-use-agent`. Deploy-gated. (Research #5.)
- **E6 — Fence local observation text as untrusted** (a11y tree text, DOM
  snapshots, clipboard reads) in result formatting, closing the
  unclassified-channel gap our edge loop gets from the platform. (Research
  #8; extends R17.)

Deferred (insufficient evidence): local-browser extension/native-messaging
move (RQ3 unresolved); macOS AX coverage instrumentation (worth measuring
ourselves later — log a11y-miss rates per app from E1 telemetry).

## E-item status (2026-06-12 — typecheck clean, smokes green)

- **E1 SHIPPED** — `planSurfaceEscalation` in appAutomationControlSurfaces
  (descend next-ranked unattempted rung; 'partial' demoted below every
  'ready'; ≤2 descents/run; approval-rejected/verification_gate/
  constraint-block NEVER descend; a11y failures skip tree-dependent rungs
  toward pixels; a11y_path_stale gets one retry_same first; descents carry
  freshObservationRequired + extraApprovalsRequired for caller gating).
  Wired in computerAppAdapter (`executeComputerAppTask` wrapper) +
  computerTaskRuntime (stop → recovery with attempted-history; descend →
  fresh-observe preamble + approval-gate block before mutation). Bounded
  breadcrumbs (≤3: from/to/reason/atIso/appName/failureCode) on
  `ComputerTaskRuntimeResult.surfaceEscalations` — the a11y-coded entries
  ARE the macOS AX-coverage dataset (RQ2). Follow-up: D6 card renders the
  breadcrumbs (field is additive-optional).
- **E2 SHIPPED** — server-side slice filter on the a11y endpoint
  (`target` + `slice: interactive|full`; actionable roles + token matches
  + ancestor chains + ±2 siblings; ~120-node cap with explicit slice
  marker) + SoM-style numbered nodes with server-held index→path maps;
  clickElement/setElementValue accept `elementIndex` with `index_stale` /
  `no_indexed_tree` structured errors; adapter requests sliced trees with
  its scoring target; sliced reads are distinct cache observations.
- **E3 SHIPPED (bridge half)** — region screenshot (`screencapture -R`,
  bounds-validated) on the bridge + client + desktop.screenshot schema
  (zoom-when-missed description); adapter coordinate-fallback takes one
  bounded region zoom around small/missed targets before re-clicking.
  Edge-loop zoom remains a precise TODO (computer_20251124 upgrade needs
  model-conditional tool versioning + Browserbase clip support — see E5
  agent record).
- **E4 SHIPPED** — 5-line "Data transfer & precision rules" block on
  desktop/app/hybrid/local_file routes (router prompt block after
  floor/grant lines) + the complexity-plan dispatch block (after the D4
  staged contract). Pure-cloud-browser routes excluded (edge loop owns
  its own rules).
- **E5 SHIPPED (needs edge deploy)** — batch screenshot pruning
  (PRUNE_HIGH_WATER=8 → keep newest 3, one-pass, byte-identical
  placeholders, pairs never split, `screenshot_history_pruned` SSE) PLUS
  the companion incremental cache breakpoint in callClaudeWithTools
  (history was previously never cached at all — this makes pruning
  actually pay). Deno check clean. `npx supabase functions deploy
  computer-use-agent` pending (joins D5/D8 deploys).
- **E6 SHIPPED** — `<untrusted_quoted>` fencing (with escape
  neutralization) on desktop.read_a11y_tree, browser.dom_snapshot,
  desktop.clipboard, desktop.file_read observation bodies; structural
  parts (counts/truncation/unchanged markers) outside the fence;
  treat-as-data description lines completed. Residual gap: local
  screenshots are images — no text fence possible; only the platform
  classifier covers the Browserbase path.
- **E0 SHIPPED** (earlier same round) — see above.
