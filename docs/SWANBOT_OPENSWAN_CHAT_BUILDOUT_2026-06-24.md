# SwanBot / OpenSwan / Chat — current state + roadmap (Wave 4, 2026-06-24)

Research-driven map of the SwanBot/OpenSwan/chat agent runtime plus the
prioritized roadmap. This wave shipped ONLY additive, low-risk guard/telemetry
items (new smokes, new pure modules, two field-only edge edits). Everything
structural — the M4 v2 default flip, the Browserbase R8 migration, the chat
terminal-path cutover, the OpenSwan T2/T8 un-darkening — remains PLANNED below.

All file:line references were verified against the working tree on 2026-06-24.
2026-06-26 status addendum: WordPress admin source intelligence and REST-first
routing are now shipped through `browser.wp_admin_source_intelligence`,
`wp.update_post`, `wp.create_slide`, `wp.upload_media`, and `wp.trash_post`.
Remaining WordPress roadmap work is live E2E against managed sites,
wp-admin failover for non-REST custom post types, and deterministic admin
recipes for dashboard-only plugin/theme/settings/user/Dealer Inspire workflows.

---

## Current state (verified)

### SwanBot v1 vs v2
- v1 (`supabase/functions/swanbot-ai/index.ts`, ~4187 lines) is the DEFAULT;
  v2 typed tool-loop (`swanbot-v2-ai` + `_shared/swanbot-continuation.ts`) is
  opt-in via `/v2`. The default is hardcoded `false` in
  `src/lib/swanbotRouting.ts:21-28`; the M4 flip is deferred to telemetry +
  `canFlipDefault` readiness (`src/lib/swanbotOpenSwanReadiness.ts`).
- v2 tool parity: the edge `TOOLS` array has 73 tools, 25 server + 48
  client-delegated (`clientOnly: true`), matching the pinned constant
  `SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS = 48`
  (`swanbotOpenSwanReadiness.ts:96`).
- Client-delegated tools round-trip through `swanbotClientToolDispatcher.ts`
  (ROOT-OWNED) — 26 `desktop.*` cases — and `swanbot.ts`
  `dispatchOneClientTool` (22 inline browser/workspace/verification/credentials/
  wp cases, `swanbot.ts:905-952`). Both `default` arms return a silent
  error/`null` ("Unknown client tool"), so a v2 tool added without a handler
  would only fail at runtime. **Closed this wave (G1):** the new
  dispatcher-parity smoke asserts the v2 clientOnly name set equals the
  dispatcher+inline handler union (48 = 26 + 22).

### Stop-reason telemetry (readiness gate feed)
- The terminal v2 update writes `final_stop_reason: result.stopReason`
  (`swanbot-v2-ai/index.ts:2433`). Before this wave the PENDING update
  (~2403) and the CATCH update (~2499) omitted it — so abandoned (paused) and
  errored runs were invisible to the readiness breakdown and inflated the
  apparent `end_turn` rate. **Closed this wave (G2):** the pending update now
  writes `final_stop_reason: "client_pending"` and the catch update writes
  `final_stop_reason: "error"` (field-only, no loop/contract change).
- The shared normalization vocabulary is pinned by the new
  `src/lib/swanbotV2StopReason.ts` `classifyV2StopReason` (`end_turn |
  max_tokens | client_pending | error`) + smoke. v1 never writes `agent_runs`
  at all (it persists tasks/agent_activity/claude_api_usage/blackswan_knowledge
  only) — see roadmap `G3`. The telemetry READER that would populate the
  readiness snapshot from real `agent_runs` rows is roadmap `G4`.

### OpenSwan typed core
- `agentExecutionCore.runAgent` is the typed loop; the advertised tool set is
  additive-only — it starts as the caller's `tools` and only GROWS via
  `resolveAdditionalTools` (`agentExecutionCore.ts:319-345`). **Guarded this
  wave (OST-G3).**
- `openswanSessionRuntime.ts` (O1) and `subagentRegistry.ts` (O3) default ON via
  flags but are live-unverified (roadmap `OST-G4`). Progressive disclosure
  (T2/`resolveAdditionalTools`) and dependency-aware parallelism
  (T8/`toolParallelPolicyProvider`) are wired in the CORE but DARK in the
  session runtime: `parallelToolConcurrency: 1` (`openswanSessionRuntime.ts:699`)
  and the two seams + `getProgressiveOpenSwanTools` are commented out
  (`:535,727-728`). **Guarded this wave (OST-G1/G2):** the new invariants smoke
  fails closed if the dark seams are un-commented or the dead dual path is
  re-wired.
- The legacy dual tool path `runOpenSwanRuntimeToolLoop`
  (`openswanRuntimeToolLoop.ts:102`) has ZERO callers; only the pure
  `extractBrowserPlansFromToolActions` is still imported (by
  `openswanSessionRuntime.ts:6,1425`). Full deletion needs the helper relocated
  first (roadmap `OST-G6`).

### Chat unification (C1)
- `chatTransportHandlers` dispatches some intents; the conversational-intent
  families are wired in lockstep across the planner union
  (`chatAutomationPlanner.ts:29-40`, 9 actionable + `build_webpage` +
  `none`), the executor (`conversationalRouter.ts`
  `executeDetectedConversationalIntent`, 9 cases), and the ChatTab allowlist
  (`ChatTab.tsx:7156-7164`, 9 literals). **Locked this wave (C1-G1):** the new
  cutover-parity smoke asserts all three sets equal the canonical 9.
- `build_webpage` is a documented DEAD branch (C1-G2): it is in the planner
  union but has no executor case (the flow moved to `run_build_discovery`); the
  parity smoke asserts this so a future fix flips the assertion deliberately.
- The terminal plain-chat send path (`ChatTab.tsx` ~8185) still picks transport
  directly rather than via `dispatchChatAutomationPlan`, and
  `conversationalRouter` remains the live fallback — both structural (roadmap
  `C1-G3`, `C1-G4`).

---

## Shipped this wave (additive, low-risk)

| ID | What | Files |
|---|---|---|
| AR1 | Chained `smoke:progressive-tool-disclosure` + `smoke:tool-batch-parallelism` into `smoke:all` | `package.json` |
| AR2 | `classifyV2StopReason` pure module + smoke | `src/lib/swanbotV2StopReason.ts`, `scripts/swanbot-v2-stop-reason-smoketest.ts` |
| AR3 | Dispatcher↔v2 clientOnly tool-name parity smoke (closes G1) | `src/lib/swanbotV2DispatcherParity.ts`, `scripts/swanbot-v2-dispatcher-parity-smoketest.ts` |
| AR4 | Emit `final_stop_reason` on v2 pending (`client_pending`) + catch (`error`) (closes G2) | `supabase/functions/swanbot-v2-ai/index.ts` |
| AR5 | OpenSwan typed-runtime invariants smoke (dead dual-path + T2/T8 darkness + additive tool set; guards OST-G1/G2/G3) | `scripts/openswan-typed-runtime-invariants-smoketest.ts` |
| AR6 | Conversational intent-type cutover parity smoke (closes C1-G1, documents C1-G2) | `src/lib/chatConversationalCutoverParity.ts`, `scripts/chat-conversational-cutover-parity-smoketest.ts` |
| WP1/WP3 | Raw-binary media-upload helper + adoption in both writable upload paths | `src/lib/wordpressMediaUpload.ts`, `scripts/wordpress-media-upload-smoketest.ts`, `src/lib/wpAdmin.ts`, `src/lib/siteAutomation.ts` |
| WP2 | CPT `rest_base` resolver + publishability classifier (pure) | `src/lib/wordpressPostTypeResolver.ts`, `scripts/wordpress-post-type-resolver-smoketest.ts` |

All eight new/chained smokes are wired into `smoke:all`. `npm run typecheck`
passes. No approval fingerprints, tool names, or behavior contracts changed; the
v2 default was NOT flipped; no live-verification-gated work was performed.

---

## Roadmap (prioritized, by area)

Value/effort/risk as graded. PLANNED items are explicitly out of scope until
their gating conditions (telemetry, live verification, structural prerequisites)
are met.

### SwanBot
| ID | Title | Value | Effort | Risk | Note |
|---|---|---|---|---|---|
| G3-v1-agent-runs | v1 `swanbot-ai` writes an `agent_runs` row with `final_stop_reason` for a real M4 baseline | high | L | medium | v1 computes `stopReason` (`index.ts:2486-2496`) but never persists `agent_runs`; the readiness v1-vs-v2 comparison has no real v1 feed. Editing the 4187-line v1 fn is structural; gate on telemetry + readiness. |
| G4-telemetry-reader | `agent_runs` `final_stop_reason` telemetry reader to populate the readiness snapshot | high | M | medium | `buildSwanBotOpenSwanReadinessSnapshot` is fed only synthetic numbers by its smoke. Needs a surface querying `agent_runs` grouped by version + `final_stop_reason`. Depends on AR4 (done) + G3 for complete data. |
| G6-m4-flip | M4 default flip: `isSwanbotV2Enabled` default true + kill switch | high | M | high | `swanbotRouting.ts:21-28` hardcodes false. Gated on real telemetry (G3, G4) + `canFlipDefault`. Needs AR3 (done) + complete stop-reason telemetry green first. Out of scope per wave constraints. |
| G5-failed-feed-stopreason | Carry `stopReason` in the v2 failed-path feed + usage logging | low | S | low | The terminal run logs `metadata.stopReason` (`index.ts:2461`); the catch-block `logFeedActivity` logs `task_failed` with no `stopReason`. AR4 already covers the `agent_runs` side. |

### OpenSwan
| ID | Title | Value | Effort | Risk | Note |
|---|---|---|---|---|---|
| OST-G4-live-traces | Live-verify O1/O3 typed-core loops against captured real traces | medium | M | medium | `runTypedCoreToolLoop` (`openswanSessionRuntime.ts:497`) + `runTypedCoreSubagentToolLoop` (`subagentRegistry.ts:476`) default ON via flags but rely on adapter parity, not captured live traces. Live-gated. |
| OST-G5-undark-t2t8 | Un-darken T2 `resolveAdditionalTools` + T8 `toolParallelPolicyProvider` in the live session/subagent loops | medium | L | high | Seams commented at `openswanSessionRuntime.ts:535,727-728`, `parallelToolConcurrency:1` (`:699`). Flipping changes the advertised tool surface + dispatch concurrency mid-run. AR5 guards it stays dark; un-darken after O1/O3 live verification. |
| OST-G6-delete-dual-path | Relocate `extractBrowserPlansFromToolActions` to a writable owner, then delete `openswanRuntimeToolLoop` | low | M | low | `runOpenSwanRuntimeToolLoop` has zero callers; only the pure helper is imported (`openswanSessionRuntime.ts:6,1425`). Deletion needs the helper moved first. AR5 guards against silent re-wiring meanwhile. |

### Chat
| ID | Title | Value | Effort | Risk | Note |
|---|---|---|---|---|---|
| C1-G3-terminal-cutover | Route the terminal plain-chat send path through `dispatchChatAutomationPlan` | medium | L | medium | The terminal path (`ChatTab.tsx:8185` rebuilds a plan, `:8194` `chooseChatTerminalTransport`) never calls `dispatchChatAutomationPlan` (`runChatAutomationPlan.ts:10`). Structural refactor of the ~16930-line `ChatTab`. |
| C1-G4-router-retirement | Move slash/governance families onto the dispatcher and retire the legacy `conversationalRouter` fallback | medium | L | medium | `conversationalRouter` is the live fallback at `ChatTab.tsx:7256-7283` and the only classifier for the non-slash fallback. Needs C1-G3 first + moving slash/governance families (`ChatTab.tsx:7288`). |
| C1-G2-build-webpage | Resolve the `build_webpage` dead branch (planner union member with no executor case) | low | S | low | `chatAutomationPlanner.ts:39` includes `build_webpage` but `executeDetectedConversationalIntent` has no case (the flow moved to `run_build_discovery`). Drop the orphan or wire it; the AR6 smoke documents it so a future fix flips the assertion deliberately. |

### WordPress
| ID | Title | Value | Effort | Risk | Note |
|---|---|---|---|---|---|
| R5-admin-fallover | wp-admin browser fail-over executor for `show_in_rest:false` CPTs | medium | L | medium | `browser.wp_admin_source_intelligence` now provides bounded current-page facts before DOM/UI actions, but deterministic admin recipes for non-REST CPTs and dashboard-only Dealer Inspire/plugin/settings workflows still need live E2E. `/types` does not reliably expose `show_in_rest`, so detection must probe the `rest_base` before fail-over can be trusted. |
| R6-featured-image-path | Adopt the raw-binary media-upload helper in the inline `publishToWordPress` featured-image upload | low | S | low | `siteAutomation.ts` ~1149-1158 still uses multipart with no Content-Disposition. WP3 left this as a separate sub-edit to bound risk; fold it in once WP3 is verified in production. |

### Browser (cross-reference)
| ID | Title | Value | Effort | Risk | Note |
|---|---|---|---|---|---|
| R8 | Browserbase migration (mint correct session URLs; Stagehand v3 linkage) | — | — | — | Tracked in `docs/WORDPRESS_BROWSER_AUTOMATION_BUILDOUT_2026-06-23.md`; structural, out of scope this wave. R13 (Stagehand action-mapping bridge) hard-depends on it. |

---

## Validation

- `npm run typecheck` — passes.
- New/affected smokes — all green: `smoke:swanbot-v2-stop-reason`,
  `smoke:swanbot-v2-dispatcher-parity`, `smoke:openswan-typed-runtime-invariants`,
  `smoke:chat-conversational-cutover-parity`, `smoke:wordpress-media-upload`,
  `smoke:wordpress-post-type-resolver`, plus regression checks
  `smoke:wordpress-rest-error`, `smoke:swanbot-v2-wp`,
  `smoke:swanbot-openswan-readiness`, `smoke:progressive-tool-disclosure`,
  `smoke:tool-batch-parallelism`, `smoke:agent-core`.
- AR4's edge edits are Deno-only (cannot be tsx-smoked); verify by deploying and
  exercising a `/v2` run that pauses on a client tool (`client_pending`) and one
  that throws (`error`), then reading `agent_runs.final_stop_reason`.
EOF
