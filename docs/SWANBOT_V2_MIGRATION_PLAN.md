# SwanBot v1 → v2 Migration Plan

**Canonical rollout for moving main chat off `swanbot-ai` (hardcoded tools, ~2,800 lines) onto `swanbot-v2-ai` (typed tool loop, real agent_runs telemetry, `openswanToolRuntime` catalog).**

**Why now:** the v1 edge function has a hardcoded `BLACKSWAN_TOOLS` list. Adding the desktop automation tools (`desktop.launch_app`, `desktop.type_text`, etc.) to v1 means porting a handwritten tool dispatcher. v2 already uses the typed `ToolDef` shape matching `src/lib/agentExecutionCore.ts` — registering new tools is a single object literal.

**Authored:** 2026-04-23 · **Cross-linked from:** [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md), [`DESKTOP_AUTOMATION_PHASE_1_PLAN.md`](./DESKTOP_AUTOMATION_PHASE_1_PLAN.md).

---

## What ships in which phase

| Phase | Ships | Status |
|---|---|---|
| **M1** Flag + client router + plan doc | `uc_swanbot_v2_enabled` localStorage flag, `/v2 on|off` slash command, `callSwanBotV2`, tier-2 route switcher in `swanbot.ts` | Shipped 2026-04-23 |
| **M2** Client-delegated tool protocol | v2 returns pending `clientToolCalls` for client-only tools; client executes via bridge + posts `{ continuationRunId, toolResults }` back to the same edge function; desktop tools registered in v2 as `clientOnly: true` | Shipped 2026-04-23; hardened with continuation validation, retry, mixed-batch handling, and stale-resume rejection |
| **M3** Full OpenSwan tool parity | Port the OpenSwan runtime-facing tool families into v2's `TOOLS: ToolDef[]` (Supabase-backed tools direct; client-delegated via M2 protocol) | Shipped for the current 73-tool source catalog; source-derived readiness smoke guards drift |
| **M4** Flip the default | Default `uc_swanbot_v2_enabled = true`; v1 becomes opt-out for regression escapes | Client default flipped 2026-07-07 with a session circuit breaker (see status log); telemetry sign-off still gates calling M4 done |
| **M5** Delete v1 | Retire `swanbot-ai` edge function + `BLACKSWAN_TOOLS` array | After 30 days of M4 with no rollbacks |

---

## M1 — client router (this turn)

### User-facing behaviour

- By default, main chat routes to **v1** (`swanbot-ai`) — no visible change for existing users.
- `/v2 on` in chat flips a per-device localStorage flag. Next message routes to **v2**.
- `/v2 off` flips back. `/v2` shows current state.
- The desktop-bridge status chip + every other chat UI element is identical across v1 and v2 — the only difference is which edge function answers.

### Code touches

- **New:** `src/lib/swanbotRouting.ts` — `isSwanbotV2Enabled()` / `enableSwanbotV2()` / `disableSwanbotV2()` / `toggleSwanbotV2()`, localStorage-backed.
- **New:** `callSwanBotV2()` function in `swanbot.ts`, same signature as `callSwanBotAI`.
- **Modified:** `callSwanBotAI()` checks `isSwanbotV2Enabled()` and redirects to `callSwanBotV2()` on opt-in.
- **New:** `/v2` slash handler in ChatTab intercepting before the planner, à la `/memory-bank` / `/automation`.

### Fallback behaviour

- v2 call fails (edge-fn 500, network error) → log + fall back to v1 automatically. Users never lose a message to a v2 bug; they may just get a v1 response.
- Flag state persists across sessions per device. No DB column needed for M1.

### Out of scope for M1

- Tool catalog expansion. v2 ships with its existing 3 tools.
- Desktop tool registration. Needs M2's client-delegated protocol.
- Per-circle flag. localStorage is fine for the opt-in cohort.

---

## M2 — Client-delegated tool protocol (SHIPPED 2026-04-23)

Edge functions can't reach `localhost:7778` — the bridge runs on the user's machine. For `desktop.*` tools to execute under v2, the edge function has to ASK the client to execute them and wait for a result.

We chose a **round-trip pattern** (not SSE streaming) because `supabase.functions.invoke` doesn't stream. Each HTTP call is either:
- **Terminal** — `{ response: "...", runId }` — no more work, done.
- **Pending** — `{ pending: true, clientToolCalls: [{ id, name, input }], continuationRunId }` — client executes the tools locally, then calls the edge fn again with the results.

The client-side loop looks like:

```ts
let resp = await invoke({ message, circleId, userId, mode });
while (resp.pending) {
  const toolResults = await executeClientTools(resp.clientToolCalls);
  resp = await invoke({ continuationRunId: resp.continuationRunId, toolResults });
}
return resp.response;
```

Iteration cap on the client side (max 6 continuations per turn) to prevent runaway loops.

### Tool marking

v2's `ToolDef` type gains a `clientOnly?: boolean` flag. Tools with that flag skip the edge-side dispatch — `runLoop` records the tool use as pending and returns control to the client instead. `handler` is still required (it can just throw "server-side dispatch not supported for clientOnly tool") — actual execution happens on the client via `src/lib/desktopBridge.ts`.

If Anthropic returns a mixed batch of server and client-only tools, the edge
runs the server tools first, stores those server `tool_result` blocks in the
continuation, and returns only true client-only calls in `clientToolCalls`.
Resume merges the persisted server results with client results in the original
assistant tool-use order. This prevents server tools from falling through to
the browser/client dispatcher as `Unknown client tool`.

### Continuation state

Persisted in `agent_runs.metadata.continuation` as a JSON blob with shape:

```ts
{
  iter: number,            // next iteration to run
  messages: AgentMessage[], // full message history, assistant turn w/ tool_use appended
  toolCalls: any[],        // accumulated log for the final run record
  usage: UsageBreakdown,   // accumulated Anthropic usage
  mode: Mode,
  model: string,
  targetAgentName: string,
  pendingToolUseIds: string[], // IDs the client must report back
  serverToolResults?: SwanBotResumeToolResult[], // edge results from mixed batches
  continuationCount?: number, // server-side continuation round cap
  pausedAt: string,         // ISO timestamp
}
```

On continuation, the edge fn reads the blob, requires `status='running'` and
`final_stop_reason='client_pending'`, rejects stale snapshots older than 10
minutes, merges any saved server-side results with the supplied client
`tool_result` content blocks, injects them into `messages`, and re-enters the
main loop.

### Timeout + cancel

- If the client never sends a continuation and the user's chat session ends, the row can sit with `status: 'running'` indefinitely. Any stale-run sweeper must keep the normalized readiness vocabulary: mark stale pending rows `status='failed'` with `final_stop_reason='error'`, and put the exact timeout label such as `client_timeout` in metadata for diagnostics.
- Client-side: `callSwanBotV2` caps at 6 continuation round-trips. Seventh → abort, post error to chat.
- Edge-side: continuation resumes older than 10 minutes or runs no longer
  marked `client_pending` fail closed with a compact `continuation_stale` or
  `continuation_closed` response.

### Security

- Continuation request requires the same auth header as the original call — token binds to the user who started the run.
- Edge fn verifies `runId` belongs to the calling `user_id + circle_id` on `agent_runs`.
- Edge fn rejects a pending response if there is no persisted `agent_runs.id`
  to bind the continuation to.
- Client-supplied `toolResults` are treated as untrusted text — same posture as any tool output. The LLM reads the result, never executes it.
- The content-block `tool_result` schema is enforced: only `tool_use_id` + `content` + optional `is_error` are accepted.

### Desktop tools under v2

The current edge-function source registers 26 `desktop.*` tools with `clientOnly: true`:

- `desktop.launch_app`, `desktop.focus_app`, `desktop.type_text`, `desktop.paste_text`, `desktop.run_applescript`, `desktop.press_keys`, `desktop.menu_click`, `desktop.list_running_apps`, `desktop.wait_for_app`, `desktop.screenshot`, `desktop.open_url`, `desktop.open_path`, `desktop.convert_image`, `desktop.file_search`, `desktop.file_stat`, `desktop.click_at`, `desktop.mouse_move`, `desktop.mouse_click`, `desktop.mouse_down`, `desktop.mouse_up`, `desktop.mouse_drag`, `desktop.mouse_scroll`, `desktop.screen_size`, `desktop.read_a11y_tree`, `desktop.click_element`, `desktop.set_element_value`

When a v2-enabled user asks "open Terminal and type `claude`", the model sees these tools in its catalog, plans a sequence, and each `desktop.*` call rides the round-trip protocol to the local bridge.

---

## M3 — Full OpenSwan tool parity

M3 is complete. The v2 edge catalog is source-derived from `supabase/functions/swanbot-v2-ai/index.ts` and currently pins **73 tools**: **25 server-side** and **48 client-delegated**. The historical sub-phases below record how parity was reached; new catalog growth must be re-pinned by `smoke:swanbot-openswan-readiness` and the dispatcher-parity smoke before it is treated as ready.

- **M3a — read-only Supabase tools (SHIPPED 2026-04-23).** 7 new tools added to `swanbot-v2-ai/index.ts` TOOLS: `fetch_url`, `tasks.list`, `missions.list` (with mission_tasks roll-up for progress %), `check_ins.list`, `integrations.list`, `rooms.list`, `office.list_agents`. Handlers reimplemented inline against the edge-side Supabase client — can't import from `src/` (RN-flavoured). Includes v1's `getMemberStatus`, `searchCircleMemory`, `getGithubActivity`, `listLibrarySkills`, `viewLibrarySkill` — v2 total: **12 server-side + 11 client-delegated desktop = 23 tools**.
- **M3b — writers (server-side mutations, SHIPPED 2026-04-23).** 8 new writer tools added: `save_memory`, `tasks.create`, `tasks.update_status`, `tasks.assign`, `missions.create_task`, `messages.create`, `rooms.create`, `rooms.send_message`. Handlers reimplemented inline against the edge Supabase service-role client. Because service-role bypasses RLS, every writer explicitly scopes by `circle_id = circleId` on `insert` and re-verifies parent rows (task / mission / room) belong to the caller's circle before mutation. Cross-circle attempts return `"X not found in this circle"`. Status aliases ("in progress", "open") normalised via `normalizeTaskStatus()` helper. 52 smoke assertions in `scripts/swanbot-v2-writers-smoketest.ts` cover scope guards + validation + shape. Approval gating stays on the client side via `chatApprovalGate` — server is scope-enforcement only.
- **M3c — workspace / verification via client-delegation (SHIPPED 2026-04-23).** 6 new `clientOnly` tools: `workspace.create_room`, `workspace.apply_artifacts`, `workspace.open_preview`, `verification.typecheck`, `verification.tests`, `verification.lint`. Edge fn declares them with defensive-throw handlers; client dispatcher in `src/lib/swanbot.ts` routes the tool names to `createWorkspaceFromArtifact` / `createFilesInRoomFromArtifact` (chatWorkspace.ts), `primeRoomWorkspaceLaunch` / `focusRoomWorkspaceFile` (roomWorkspaceLauncher.ts), and `detectClaudeCodeBridge` + `execBridgeCommand` (claudeCodeDetector.ts). Verification output stdout/stderr clipped at 8KB to cap context cost. `normalizeArtifact` helper enforces artifact `{ kind, title }` shape before any write. 47 smoke assertions in `scripts/swanbot-v2-workspace-smoketest.ts`.
- **M3d — approvals + credentials (SHIPPED 2026-04-23; self-approval blocked 2026-06-29).** Server-side model tools: `approvals.list` (scoped to circle, filter by status, default `pending`) and `approvals.request` (auto-attaches to ctx.runId when caller omits runId; scope-guards against cross-circle run ids; clamps timeoutSeconds to [30, 86400]). `approvals.resolve` is deliberately not selected for model-facing tools and its edge handler fails closed; approval resolution must come from the signed UI or another out-of-band operator flow. ToolContext gained `runId?: string | null` so request handlers can attach to the current run without duplicating state. Client-only: `credentials.get` proxies to the bridge `/secrets` endpoint (1Password CLI via OP_SERVICE_ACCOUNT_TOKEN) via `dispatchCredentialsGet` in `src/lib/swanbot.ts` — returns the raw `{ field: value }` map, since callers like `wp.create_slide` need plaintext. Tool description explicitly warns the model not to echo. `scripts/swanbot-v2-approvals-smoketest.ts` now guards the fail-closed resolve path.
- **Production deploy (SHIPPED 2026-04-23; re-verify before S1).** `supabase functions deploy swanbot-v2-ai` pushed the then-current `index.ts` + `_claude/anthropic.ts` + `_shared/edge.ts` to project `rjkniqiqdtroeholxacg`. The worktree has since expanded the catalog, so S1 must verify the deployed function matches the source-derived readiness snapshot before flipping defaults.
- **M3e — WordPress + publishing (SHIPPED 2026-04-23).** Client-only WordPress tools: `wp.discover_types`, `wp.list_posts`, `wp.upload_media`, `wp.create_slide`, `wp.update_post`, and `wp.trash_post`, plus the companion browser tool `browser.wp_admin_source_intelligence` for bounded/redacted wp-admin and Dealer Inspire page understanding. Must be client-delegated because they need 1P credentials resolved via the local bridge, local browser state, and/or writes to the user's WordPress install. Client dispatchers in `src/lib/swanbot.ts` validate `siteUrl` must start with `http(s)://` (rejects `javascript:`, `ftp:`, etc.), require `onePasswordItem`, default sane mimeTypes, clamp `perPage` to [1, 50], and narrow WP API responses to `{ id, title, status, link }` tuples (title.rendered flattened from object-or-string) so the model sees small payloads. Tool descriptions tell the model to pair with `approvals.request` first. **v2 tool migration complete for this phase; current readiness parity is source-derived and pinned by `smoke:swanbot-openswan-readiness` at 25 server-side + 48 client-delegated = 73 tools.** Next: M4 (flip default after telemetry).
- **M3e hardening (2026-06-23).** OpenSwan runtime policy now has an explicit `wp.*` branch: `wp.discover_types` and `wp.list_posts` are read-only/auto, while `wp.upload_media` and `wp.create_slide` are publish-class writes requiring approval. Chat-side WordPress schedule now posts `status: future` plus the requested ISO date through `wordpressRestPayload`, so scheduled posts no longer degrade to draft-only behavior.
- **M3e Dealer Inspire hardening (2026-06-23; expanded 2026-06-26).** `wp.discover_types`, `wp.list_posts`, `wp.upload_media`, `wp.create_slide`, `wp.update_post`, `wp.trash_post`, and `browser.wp_admin_source_intelligence` are in the OpenSwan/SwanBot model-facing safe-name catalog so typed tool disclosure can actually expose them when WordPress/DI tasks need them. `wp.create_slide` now accepts `slideType` for Dealer Inspire/DI Slides flows, and its schema/description tells the model to discover `di_slide` / `flavor_di_slides`, create drafts first, and request approval before media, slider, expiration, order, cache, or public-status changes. Chat routes and OpenSwan planner ordering now inspect bounded WordPress admin source facts before using dashboard-only DI fields.
- **M3e update hardening (2026-06-24).** Added `wp.update_post` as a client-delegated WordPress write for known post/page/custom-post-type IDs. It supports bounded fields only (`title`, `content`, `status`, `slug`, `excerpt`, `date`, `featuredMedia`, `menuOrder`, `meta`), validates `siteUrl`/`onePasswordItem`/`postId`, returns a slim post receipt, and is publish-class approval-gated like media upload and slide creation. Chat/strategy/planner routes now recommend it for existing WordPress/Dealer Inspire updates before falling back to wp-admin browser control.

### Smoke-test strategy

Pre-M4 readiness:
1. Deploy/re-verify `swanbot-v2-ai` against the source-derived 73-tool snapshot.
2. For focused Lane 1 work, run `npm run check:swanbot-v2:daily`; before default flips or customer release handoff, run `npm run check:swanbot-v2:release`. Cross-lane chat/computer releases still use `npm run check:swanbot-chat:release`.
3. After the local release gate passes, run the live production report with service-role Supabase credentials: `npm run report:swanbot-openswan-readiness -- --smokes-passed --since <iso>`. Use `npm run check:swanbot-openswan-readiness:production -- --smokes-passed --since <iso>` when the command should fail the handoff unless `can_flip_default` is yes. Do not add this live report to daily checks; it depends on production credentials and fresh telemetry.
4. Verify real `agent_runs` telemetry, not synthetic readiness input: v1 `swanbot-ai` rows must write `metadata.version='swanbot-ai'`, v2 rows must write `metadata.version='swanbot-v2-ai'`, and `src/lib/swanbotOpenSwanReadiness.ts` must load both cohorts by `metadata->>version` and `surface='main_chat'`.
4. Verify `agent_runs.final_stop_reason` telemetry is normalized to `end_turn`, `max_tokens`, `client_pending`, and `error` before default flip decisions. The v2 edge preserves the raw Anthropic stop reason only in metadata as `rawStopReason`; the v1 baseline normalizes terminal legacy turns to `end_turn`, `max_tokens`, or `error`.

---

## M4 — Flip the default

- After M3e, watch a week of mixed v1/v2 telemetry from the opt-in cohort.
- Build the decision from `src/lib/swanbotOpenSwanReadiness.ts`, not a manual checklist. It derives the current v2 catalog from `supabase/functions/swanbot-v2-ai/index.ts` and currently requires 73 tools total, 48 client-delegated tools, the SwanBot v2 routing/delegation/continuation/writer/workspace/approval/WordPress/dispatcher-parity smokes, WordPress admin source-intelligence smoke, OpenSwan approval/planner smokes, failure-recovery smoke, and enough real `agent_runs.final_stop_reason` telemetry from both the v1 baseline and v2 candidate cohorts. `scripts/swanbot-openswan-readiness-report.ts` is the operator-facing production report for that same logic; it first probes `agent_runs` for the late telemetry columns (`tool_calls`, `iteration_count`, `final_stop_reason`, `input_tokens`, `output_tokens`, `cached_tokens`) and reports cohort completeness before printing the readiness snapshot.
- When v2's `final_stop_reason === 'end_turn'` rate is ≥ v1's and the readiness snapshot returns `canFlipDefault: true`, flip the default in `isSwanbotV2Enabled()` from `false` to `true` with `!== 'false'` semantics. v1 becomes opt-out.
- As of 2026-06-29, terminal v2 rows also use the normalized stop-reason vocabulary before writing `agent_runs.final_stop_reason`: `stop_sequence` is counted as `end_turn`, iteration cap is `max_tokens`, paused client tools are `client_pending`, and unexpected terminal reasons are `error`. Only `end_turn` writes `status='completed'`; `max_tokens` and `error` write `status='failed'` so readiness does not count cut-off model responses as clean completions. Pending and terminal v2 updates now also write `agent_runs.input_tokens`, `agent_runs.output_tokens`, and `agent_runs.cached_tokens` from the accumulated Anthropic usage totals so the live readiness report can flag real telemetry gaps instead of source-code gaps.
- As of 2026-06-29, normal-path v1 `swanbot-ai` turns also create and close `agent_runs` rows with `metadata.version='swanbot-ai'`, token fields, tool summaries, iteration count, and normalized final stop reasons. Relay-mode v1 turns are deliberately excluded because they are client-controlled tool continuations, not terminal baseline samples.
- Announce in chat + post to `agent_activity` on every circle.

---

## M5 — Delete v1

- 30 days after M4 with no rollback.
- Delete `supabase/functions/swanbot-ai/` directory.
- Strip v1 import paths from `swanbot.ts`.
- Update `AGENTS_ROADMAP.md` to mark the split retired.

---

## Rollback contract

If v2 goes sideways at any phase:
- M1 → Any user runs `/v2 off`. Per-device. No deploy needed.
- M2/M3 → Edge fn has a hard kill switch via `swanbot-v2-ai/config.disabled` env var. If set, v2 returns 503 and the client falls back to v1 automatically.
- M4 → Flip the default back (`'false'` in localStorage) — single commit.

---

## Definition of done per phase

| Phase | DoD |
|---|---|
| M1 | Flag toggle works · `/v2` command lands · v2 invocation succeeds end-to-end when enabled · v1 unchanged · typecheck + all smoke suites green |
| M2 | Client-only desktop/tool calls succeed under v2 with flag on · pending `clientToolCalls` + same-edge continuation round-trip works · invalid/duplicate/missing tool results are rejected · rollback flag works |
| M3 | Source-derived v2 catalog parity passes · smoke tests cover representative read/write/client-delegated tool families · `agent_runs.metadata` captures the full trace |
| M4 | `swanbotOpenSwanReadiness` returns ready · default flipped · v1/v2 telemetry shows v2 ≥ v1 on completion rate · no regressions reported |
| M5 | `swanbot-ai/` directory deleted · no imports remain · roadmap doc updated |

---

## Status log

- **2026-07-07 — M4 default flip (client side) + session circuit breaker.**
  `isSwanbotV2Enabled()` in `src/lib/swanbotRouting.ts` now returns true unless
  localStorage `uc_swanbot_v2_enabled === 'false'` — the exact `!== 'false'`
  opt-out semantics planned in the M4 section. Absent keys, garbage values, and
  localStorage-less runtimes (native) all default ON; the unchanged M1 v1
  fallback in `swanbot.ts` makes that safe. New in the same module: a session
  circuit breaker (`recordSwanbotV2Outcome` / `isSwanbotV2CircuitOpen` /
  `resetSwanbotV2Circuit` / `describeSwanbotV2Circuit`). After **2 consecutive
  v2 transport failures** (the router's null/throw signal — model-content
  issues return strings and count as success), the router in `callSwanBotAI`
  skips the v2 attempt for the rest of the session so users stop paying a
  doomed v2 round trip per message. In-memory only: any v2 success, `/v2 on`
  (`enableSwanbotV2()` resets the breaker), or a reload closes it. `/v2` status
  copy now reports "v2 typed loop (default) — `/v2 off` to use the legacy loop"
  and surfaces "v2 paused this session after repeated failures — `/v2 on` to
  retry." while the breaker is open. **Honest op note:** the deployed
  `swanbot-v2-ai` edge function must be current in production
  (`npx supabase functions deploy swanbot-v2-ai`) — if it is stale or missing,
  every fresh session pays two failed v2 attempts before the breaker opens, and
  the v1 fallback keeps chat working either way. The
  `swanbotOpenSwanReadiness` telemetry gate remains the bar for declaring M4
  *done* and starting M5's 30-day clock; rollback is one commit
  (restore `=== 'true'`) or per-device `/v2 off`.
