# SwanBot v1 → v2 Migration Plan

**Canonical rollout for moving main chat off `swanbot-ai` (hardcoded tools, ~2,800 lines) onto `swanbot-v2-ai` (typed tool loop, real agent_runs telemetry, `openswanToolRuntime` catalog).**

**Why now:** the v1 edge function has a hardcoded `BLACKSWAN_TOOLS` list. Adding the desktop automation tools (`desktop.launch_app`, `desktop.type_text`, etc.) to v1 means porting a handwritten tool dispatcher. v2 already uses the typed `ToolDef` shape matching `src/lib/agentExecutionCore.ts` — registering new tools is a single object literal.

**Authored:** 2026-04-23 · **Cross-linked from:** [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md), [`DESKTOP_AUTOMATION_PHASE_1_PLAN.md`](./DESKTOP_AUTOMATION_PHASE_1_PLAN.md).

---

## What ships in which phase

| Phase | Ships | Status |
|---|---|---|
| **M1** Flag + client router + plan doc | `uc_swanbot_v2_enabled` localStorage flag, `/v2 on|off` slash command, `callSwanBotV2`, tier-2 route switcher in `swanbot.ts` | Shipped 2026-04-23 |
| **M2** Client-delegated tool protocol | v2 returns pending `clientToolCalls`; the client first claims exact dispatch ownership, executes locally only after the echoed claim is confirmed, then posts the exact results under that same claim so the edge can claim model-resume ownership | Shipped 2026-04-23; source-hardened through 2026-07-26 with pre-handler constraint/approval enforcement, hidden proof receipts, gateway-first mutations, AES-256-GCM-sealed continuation checkpoints, value-free public events, and the two-phase `client_pending → client_dispatching → client_resuming` protocol; env/deploy/§29/live race proof remains pending |
| **M3** Full OpenSwan tool parity | Port the OpenSwan runtime-facing tool families into v2's `TOOLS: ToolDef[]` (Supabase-backed tools direct; client-delegated via M2 protocol) | Source-shipped at **82 total = 25 server-side + 57 client-delegated**, including sealed browser fill/native-select, read-only advisory locator-actionability evidence, value-stripped typed handoffs for all six legacy Computer Use mutation kinds, and the exact native semantic-press schema; focused parity smokes guard drift |
| **M4** Flip the default | Default `uc_swanbot_v2_enabled = true`; v1 becomes opt-out for regression escapes | Client default flipped 2026-07-07 with a session circuit breaker (see status log); telemetry sign-off still gates calling M4 done |
| **M5** Retire v1 tool loop | Retire the v1 **tool loop** (`BLACKSWAN_TOOLS` + `executeToolUseLoop`). **Do NOT delete the edge function** — its provider **relay** leg is still load-bearing (see M5). | After 30 days of M4 with no rollbacks |

---

## M1 — client router (this turn)

### User-facing behaviour

- At the original M1 launch, main chat routed to **v1** (`swanbot-ai`). The
  current M4 client default is v2; `/v2 off` remains the per-device rollback.
- `/v2 on` in chat flips a per-device localStorage flag. Next message routes to **v2**.
- `/v2 off` flips back. `/v2` shows current state.
- The desktop-bridge status chip + every other chat UI element is identical across v1 and v2 — the only difference is which edge function answers.

### Code touches

- **New:** `src/lib/swanbotRouting.ts` — `isSwanbotV2Enabled()` / `enableSwanbotV2()` / `disableSwanbotV2()` / `toggleSwanbotV2()`, localStorage-backed.
- **New:** `callSwanBotV2()` function in `swanbot.ts`, same signature as `callSwanBotAI`.
- **Modified:** `callSwanBotAI()` checks `isSwanbotV2Enabled()` and redirects to `callSwanBotV2()` on opt-in.
- **New:** `/v2` slash handler in ChatTab intercepting before the planner, à la `/memory-bank` / `/automation`.

### Fallback behaviour

- A v2 call may fall back to v1 only before any continuation dispatch claim or
  local tool attempt. Once dispatch ownership is attempted/confirmed, an
  ambiguous failure stops fail-closed; it never falls through to v1 or replays
  the client action.
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
- **Pending** — `{ pending: true, clientToolCalls, continuationRunId, continuationIdentity, continuationVersion, continuationNonce }` — the client must acquire an exact dispatch claim before executing any tool.

The client-side loop looks like:

```ts
let resp = await invoke({ message, circleId, userId, mode });
while (resp.pending) {
  const dispatchClaimId = crypto.randomUUID();
  const dispatch = await invoke({
    continuationRunId: resp.continuationRunId,
    continuationAction: 'claim_dispatch',
    continuationIdentity: resp.continuationIdentity,
    continuationVersion: resp.continuationVersion,
    continuationNonce: resp.continuationNonce,
    dispatchClaimId,
  });
  assertExactDispatchClaimConfirmation(dispatch, resp, dispatchClaimId);

  // No local handler may enter before the exact edge acknowledgement above.
  const toolResults = await executeClientTools(resp.clientToolCalls);
  resp = await invoke({
    continuationRunId: resp.continuationRunId,
    continuationAction: 'submit_results',
    continuationIdentity: resp.continuationIdentity,
    continuationVersion: resp.continuationVersion,
    continuationNonce: resp.continuationNonce,
    dispatchClaimId,
    toolResults,
  });
}
return resp.response;
```

Iteration cap on the client side (max 6 continuations per turn) prevents
runaway loops. The ordinary edge-continuation client path applies the same
non-erasable merged user constraints and always-confirm floor as the flag-dark
typed client loop. Before any local handler entry it evaluates hard policy and
then the live exact-call approval callback when supplied; exceptions and
rejection fail closed, and an active approval surface serializes the batch.
The non-empty always-confirm floor gates every non-read browser/desktop
mutation, including bland or opaque keypresses and unknown/future calls whose
arguments do not repeat a sensitive keyword.

### Tool marking

v2's `ToolDef` type gains a `clientOnly?: boolean` flag. Tools with that flag skip the edge-side dispatch — `runLoop` records the tool use as pending and returns control to the client instead. `handler` is still required (it can just throw "server-side dispatch not supported for clientOnly tool"). Execution is client-side, but guarded tools do not necessarily call `desktopBridge.ts` directly: the client dispatcher must first route them through their canonical approval/grounding/runtime chokepoint.

If Anthropic returns a mixed batch of server and client-only tools, the edge
runs the server tools first, stores those server `tool_result` blocks in the
continuation, and returns only true client-only calls in `clientToolCalls`.
Resume merges the persisted server results with client results in the original
assistant tool-use order. This prevents server tools from falling through to
the browser/client dispatcher as `Unknown client tool`. Server-side
memory/task/mission/message/room/approval writers also latch before handler
entry. A later provider/runtime failure is non-retryable
`server_mutation_outcome_unknown`; the client recovers the structured non-2xx
edge body and stops before v1 fallback, so an ambiguous committed write is
verified rather than replayed under a new run. The client also generates one
UUID `turnRequestId` per fresh turn and reuses it across transport attempts;
the edge inserts it as `agent_runs.id`, so a retry collides atomically and
stops before the model. Fresh legacy/no-identity requests have the entire
server-writer set withheld.

### Continuation state

As of the 2026-07-26 source contract,
`agent_runs.metadata.continuation` no longer contains the raw resumable
`RunContinuation` JSON. The edge preserves the exact resumable
transcript/system/tool state inside an AES-256-GCM snapshot (after the
credential-result minimization already required by the tool contract). Its
256-bit key is derived only from the dedicated, minimum-32-character
`SWANBOT_CONTINUATION_ENCRYPTION_SECRET`; it does not reuse the Supabase
service-role key. The authenticated rotation label comes from
`SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION` (default `v1`) and is bound into
the snapshot's authenticated data.

The circle-visible row contains only this bounded public envelope:

```ts
{
  storageSchemaVersion: 1,
  encrypted: true,
  continuationIdentity: string, // opaque identity for this exact paused turn
  continuationVersion: number,  // CAS/storage contract version
  continuationNonce: string,    // one-time exact pending identity
  resumeState: 'pending' | 'dispatch_claimed' | 'results_claimed',
  dispatchClaimId?: string,     // client-generated; owns local dispatch
  dispatchClaimedAt?: string,
  resumeClaimId?: string,
  resumeClaimedAt?: string,
  resumeLeaseExpiresAt?: string,
  iter: number,
  pendingTools: Array<{ id: string; name: string }>, // never tool arguments
  pendingToolCount: number,
  continuationCount: number,
  pausedAt: string,
  expiresAt: string, // exactly ten minutes after pausedAt
  snapshot: {
    schemaVersion: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'SHA-256',
    keyVersion: string,
    ivB64: string,         // random 96-bit IV
    ciphertextB64: string, // transcript/system/tool state + auth tag
  },
}
```

Messages, system blocks, raw tool inputs/results, usage, model/mode, and agent
subject state are not present beside the ciphertext. The edge authenticates
and cross-checks the decrypted identity/state against the public envelope
before either claim phase. A fresh request made without a valid dedicated key
withholds every `clientOnly` tool before the model turn, so it cannot create
local work that cannot be safely checkpointed; an attempted resume without
the key fails closed and authorizes no local action.

Continuation protocol v2 has two one-way database compare-and-set phases:

1. `claim_dispatch` verifies run ownership and exact identity/version/nonce,
   then changes `resumeState='pending'` +
   `final_stop_reason='client_pending'` to
   `resumeState='dispatch_claimed'` +
   `final_stop_reason='client_dispatching'`. The app executes zero local tools
   until the response echoes every identity field and its client-generated
   `dispatchClaimId`. Only an exact retry of that winning claim is acknowledged
   idempotently; competing, mixed-version/state, or ambiguous claim paths fail
   closed.
2. `submit_results` accepts only the complete validated result set under that
   exact active dispatch claim. Before model resume, one atomic write persists
   the bounded results, generates a server-side `resumeClaimId`, and changes
   the row to `resumeState='results_claimed'` +
   `final_stop_reason='client_resuming'`. Only that exact internal result claim
   may publish the next pending snapshot or terminal result. A repeated result
   submission never re-enters the model loop.

Each later pending round gets a fresh identity and nonce. A competing claim,
mixed deployment/state, ambiguous claim or result acknowledgement, expired
dispatch/result lease, lost claim-bound transition, or post-claim loop error
becomes `outcome_unknown`; neither claimed state is reopened and neither local
actions nor model resume are automatically replayed. Readiness ignores
`client_pending`, `client_dispatching`, and `client_resuming` because all three
are active, non-terminal states.

### Timeout + cancel

- Every new sealed envelope expires exactly ten minutes after `pausedAt`. A
  stale `pending` snapshot reached through the edge closes before dispatch.
  Once §29 is applied, `sweep_unsafe_swanbot_continuations()` also closes
  malformed/unsealed, expired, or run-state-mismatched active rows, removes
  the checkpoint, and writes only a stable no-replay outcome. Its idempotent
  pg_cron job runs every three minutes when cron is available; environments
  without pg_cron must invoke the service-only sweep themselves.
- §29 also performs a one-time scrub of legacy plaintext checkpoints and all
  terminal-row checkpoints. Until §29 is actually applied in an environment,
  those historical rows can remain, including old raw JSON; source and a
  migration file alone are not cleanup proof.
- Client-side: `callSwanBotV2` caps at 6 continuation round-trips. Seventh → abort, post error to chat.
- Edge-side: a stale `pending` snapshot closes before any dispatch claim is
  issued. An expired `dispatch_claimed` lease is sealed because local actions
  may already have run. A live `results_claimed` lease reports
  `continuation_in_progress`; an expired result/model-resume claim is sealed
  `outcome_unknown`/`replayAllowed:false`. Claim-write uncertainty, result-
  consumption uncertainty, resumed-loop failure, or loss of the exact claim
  during the next-pending/terminal transition is non-retryable. Start a fresh
  run from fresh evidence rather than replaying client actions.

### Security

- Continuation request requires the same auth header as the original call — token binds to the user who started the run.
- Edge fn verifies `runId` belongs to the calling `user_id + circle_id` on `agent_runs`.
- Edge fn rejects a pending response if there is no persisted `agent_runs.id`
  to bind the continuation to.
- Client-supplied `toolResults` content is treated as untrusted text — same
  posture as any tool output. The LLM reads the projected content, never
  executes it.
- The wire result accepts `tool_use_id` + `content` + optional `is_error` and,
  for newer clients, an optional `receipt_metadata` side channel. Only complete
  allowlisted primitive mutation-dispatch/app-verification fields survive
  client and edge sanitization. The edge derives the authoritative tool name
  from the saved assistant tool-use turn, writes an idempotent
  `tool_call_result` event and bounded run aggregate, and never trusts a
  client-supplied tool name.
- The model-facing Anthropic `tool_result` projection remains exactly
  `tool_use_id` + `content` + optional `is_error`; `receipt_metadata` is
  explicitly omitted before replay and raw client error text is not copied
  into durable telemetry.
- Circle-visible `agent_run_events` persist only value-free structural input
  summaries (field/type/shape facts, never argument values). Failed tool
  events and run aggregates use the fixed redacted failure text plus a stable
  error code, never a caught provider/bridge/model error.
- The encrypted snapshot is not an excuse to persist secrets unnecessarily:
  known credential tool results are minimized before sealing, and the
  continuation key must remain dedicated and separately rotatable.
- Raw-turn constraints are unioned with upstream context so a caller cannot
  erase a visible prohibition. The default edge client dispatcher authorizes
  each exact tool name/input before handler entry, runs hard constraints before
  review, and converts a policy exception, missing required approval surface,
  or user rejection into a non-dispatching error result.

### Desktop tools under v2

The current edge-function source registers 26 `desktop.*` tools with `clientOnly: true`:

- `desktop.launch_app`, `desktop.focus_app`, `desktop.type_text`, `desktop.paste_text`, `desktop.run_applescript`, `desktop.press_keys`, `desktop.menu_click`, `desktop.list_running_apps`, `desktop.wait_for_app`, `desktop.screenshot`, `desktop.open_url`, `desktop.open_path`, `desktop.convert_image`, `desktop.file_search`, `desktop.file_stat`, `desktop.click_at`, `desktop.mouse_move`, `desktop.mouse_click`, `desktop.mouse_down`, `desktop.mouse_up`, `desktop.mouse_drag`, `desktop.mouse_scroll`, `desktop.screen_size`, `desktop.read_a11y_tree`, `desktop.click_element`, `desktop.set_element_value`

When a v2-enabled user asks "open Terminal and type `claude`", the model sees
these tools in its catalog and plans a sequence; client-delegated calls ride the
round-trip protocol to the local runtime. `desktop.click_element` is deliberately
different from the legacy raw bridge path. Its edge/OpenSwan schema is exactly
`{ action?: 'press', appName, pid, path, expectedRole, expectedLabel }`.
`dispatchOneClientTool` intercepts it and calls the sealed OpenSwan runtime
before the generic desktop dispatcher. The raw OpenSwan dispatcher and raw
SwanBot bridge dispatcher both refuse the tool, so a caller cannot bypass fresh
observation, approval, grounding, durable identity, or exact-target proof.

The interception rule is broader than this one sealed canary: every current
client-delegated browser/desktop mutation is routed through
`executeOpenSwanRuntimeTool` before any raw bridge fallback. That includes
browser navigation, normal/protected fill, toggle/select, click/key actions and
desktop activation, text/key/menu/script/path, coordinate/pointer,
semantic-press, and value mutations. Bounded reads such as DOM/a11y snapshots
and screenshots retain their read dispatchers. Gateway-first routing is not a
claim that every mutation already has the select/semantic target-and-proof
contract; only the explicitly sealed canaries do.

`/desktop diag` is an authenticated read-only health, pairing, and running-app
probe. `/desktop diag <app>` remains read-only and never launches, focuses,
opens, clicks, or types; it returns a value-free non-executable
`desktop.launch_app` typed-runtime handoff that must acquire a fresh
authenticated run/provider-call identity, exact approval, mutation-dispatch
receipt, and post-launch focus proof.

### Browser mutation schema and legacy Computer Use handoffs

The v2 edge `browser.fill_field` definition is now the sealed draft schema, not
the older generic fill surface: optional role is `textbox|searchbox`; one
bounded non-empty `name` XOR `selector` is required; text is capped at 4,000
characters; `name`, `selector`, task context, and timeout use runtime bounds;
combobox is excluded; submit is not exposed; and additional properties fail
closed. The edge model schema, app normalizer/sealed runtime, browser client
request builders, and bridge target/perform endpoints independently enforce
`name` XOR `selector`; both-present and neither-present inputs fail before
observation or dispatch. A focused source smoke pins this edge/OpenSwan
contract so a future catalog edit cannot silently advertise a raw or
selection-capable fill.

The legacy `computerUse.ts` planner/executor deliberately executes none of its
six mutation kinds: `navigate`, `click`, `fill`, `select`, `press_key`, or
`scroll`. It cannot supply authenticated user/circle, persisted run, provider
tool-use id, iteration, durable dispatch claim, and exact OpenSwan approval
identity. Planner output, saved-plan hydration, direct execution, and plan-card
serialization instead rebuild a visible, value-stripped, structured
non-executable typed OpenSwan handoff before screenshot, Stagehand, MCP, or
bridge mutation I/O. The corresponding typed tool is named, but executable
inputs and authority are not carried. The user/task must continue through a
fresh typed OpenSwan call rather than retrying the legacy or raw path.

`/replay` preflights the whole saved plan before step one. If any
browser/desktop mutation appears, it executes zero steps and returns the typed
handoff; only the reviewed observation-only allowlist may replay locally.
Recordings are planning evidence, never side-effect authority.

### Hosted cloud Computer Use and root Chat boundary

The separate Browserbase `computer-use-agent` lane is source-hardened as of
2026-07-26. Its edge validates a bounded schema-v1 execution-policy envelope
before provider/session work. Authenticated Chat/queue calls require an
interactive envelope; scheduled watch/service calls are forced
observation-only, while authenticated legacy callers without a policy now
receive HTTP 400. All three root Chat starts—automatic browser start,
booking-session continuation, and manual approved start—preserve derived user
constraints and the opaque-target/credential/external-side-effect confirmation
floors. The single-task and queue hooks acquire synchronous start reservations
before module/credential awaits and invalidate pending reservations on
cancellation.

The cloud edge treats every left/right/double click, type, key, and saved-login
call as a mutation, and treats unknown native actions as blocked mutations.
Current coordinate/focus targets remain opaque, so each call requires durable
exact-call live confirmation even when a pre-run grant exists. Approval is
followed by a fresh pre-action screenshot, one-attempt dispatch, and a fresh
post-action screenshot. Missing pre-proof blocks without dispatch; an ambiguous
post-dispatch result becomes `mutation_outcome_unknown` and is not replayed.
Type/key/credential/question payloads are redacted or suppressed across SSE,
progress/action traces, model history, guided replay, stuck-solver inputs,
usage metadata, and errors.

Root Chat's `computerTaskRuntime` also removes its pre-agent app and attachment
mutation bypasses. It no longer calls `executeComputerAppTask`,
`bridgeOpenPath`, or `bridgeWaitForApp` before authenticated
`executeAgentRun`; read-only live observation may remain. App/hybrid tasks
therefore reach the typed agent loop. Uploaded files stay staged and emit a
value-free, non-executable `desktop.open_path` handoff with no raw path,
identity, approval, receipt, or proof. Exact staged context remains only in the
authenticated task prompt and is redacted from result, capability-buildout,
and action-trace telemetry.

This is source/focused-smoke evidence. The updated `computer-use-agent` edge
has not been deployed/re-verified. No live Browserbase/DB confirmation
integration or native-app GUI run was performed. The new HTTP 400 for
authenticated legacy cloud callers without the v1 policy is an intentional
compatibility boundary.

---

## M3 — Full OpenSwan tool parity

M3 is source-complete. The v2 edge catalog is derived from
`supabase/functions/swanbot-v2-ai/index.ts` and currently pins **82 tools:
25 server-side + 57 client-delegated** (coding-agent client tools — edit_file,
run_shell, git.run, codebase.search, todo.write, coordination.file_status —
  added 2026-07-14; guarded `browser.set_toggle` added 2026-07-25; sealed native
  HTML-select `browser.select_option` added 2026-07-26; read-only advisory
  `browser.locator_actionability` added 2026-07-27). The narrowed
`desktop.click_element` semantic-press contract was hardened in place and is
  included within the same 82/57 catalog; its hardening did not change counts. The
historical sub-phases below record how parity was reached. New catalog or schema
growth must be re-pinned by `smoke:swanbot-openswan-readiness`, dispatcher
parity, and the focused semantic-action runtime smoke before it is treated as
ready.

- **M3a — read-only Supabase tools (SHIPPED 2026-04-23).** 7 new tools added to `swanbot-v2-ai/index.ts` TOOLS: `fetch_url`, `tasks.list`, `missions.list` (with mission_tasks roll-up for progress %), `check_ins.list`, `integrations.list`, `rooms.list`, `office.list_agents`. Handlers reimplemented inline against the edge-side Supabase client — can't import from `src/` (RN-flavoured). Includes v1's `getMemberStatus`, `searchCircleMemory`, `getGithubActivity`, `listLibrarySkills`, `viewLibrarySkill` — v2 total: **12 server-side + 11 client-delegated desktop = 23 tools**.
- **M3b — writers (server-side mutations, SHIPPED 2026-04-23).** 8 new writer tools added: `save_memory`, `tasks.create`, `tasks.update_status`, `tasks.assign`, `missions.create_task`, `messages.create`, `rooms.create`, `rooms.send_message`. Handlers reimplemented inline against the edge Supabase service-role client. Because service-role bypasses RLS, every writer explicitly scopes by `circle_id = circleId` on `insert` and re-verifies parent rows (task / mission / room) belong to the caller's circle before mutation. Cross-circle attempts return `"X not found in this circle"`. Status aliases ("in progress", "open") normalised via `normalizeTaskStatus()` helper. 52 smoke assertions in `scripts/swanbot-v2-writers-smoketest.ts` cover scope guards + validation + shape. Approval gating stays on the client side via `chatApprovalGate` — server is scope-enforcement only.
- **M3c — workspace / verification via client-delegation (SHIPPED 2026-04-23).** 6 new `clientOnly` tools: `workspace.create_room`, `workspace.apply_artifacts`, `workspace.open_preview`, `verification.typecheck`, `verification.tests`, `verification.lint`. Edge fn declares them with defensive-throw handlers; client dispatcher in `src/lib/swanbot.ts` routes the tool names to `createWorkspaceFromArtifact` / `createFilesInRoomFromArtifact` (chatWorkspace.ts), `primeRoomWorkspaceLaunch` / `focusRoomWorkspaceFile` (roomWorkspaceLauncher.ts), and `detectClaudeCodeBridge` + `execBridgeCommand` (claudeCodeDetector.ts). Verification output stdout/stderr clipped at 8KB to cap context cost. `normalizeArtifact` helper enforces artifact `{ kind, title }` shape before any write. 47 smoke assertions in `scripts/swanbot-v2-workspace-smoketest.ts`.
- **M3d — approvals + credentials (SHIPPED 2026-04-23; self-approval blocked 2026-06-29).** Server-side model tools: `approvals.list` (scoped to circle, filter by status, default `pending`) and `approvals.request` (auto-attaches to ctx.runId when caller omits runId; scope-guards against cross-circle run ids; clamps timeoutSeconds to [30, 86400]). `approvals.resolve` is deliberately not selected for model-facing tools and its edge handler fails closed; approval resolution must come from the signed UI or another out-of-band operator flow. ToolContext gained `runId?: string | null` so request handlers can attach to the current run without duplicating state. Client-only: `credentials.get` proxies to the bridge `/secrets` endpoint (1Password CLI via OP_SERVICE_ACCOUNT_TOKEN) via `dispatchCredentialsGet` in `src/lib/swanbot.ts` — returns the raw `{ field: value }` map, since callers like `wp.create_slide` need plaintext. Tool description explicitly warns the model not to echo. `scripts/swanbot-v2-approvals-smoketest.ts` now guards the fail-closed resolve path.
- **Production deploy (SHIPPED 2026-04-23; re-verify before S1).** `supabase functions deploy swanbot-v2-ai` pushed the then-current `index.ts` + `_claude/anthropic.ts` + `_shared/edge.ts` to project `rjkniqiqdtroeholxacg`. The worktree has since expanded the catalog, so S1 must verify the deployed function matches the source-derived readiness snapshot before flipping defaults.
- **M3e — WordPress + publishing (SHIPPED 2026-04-23).** Client-only WordPress tools: `wp.discover_types`, `wp.list_posts`, `wp.upload_media`, `wp.create_slide`, `wp.update_post`, and `wp.trash_post`, plus the companion browser tool `browser.wp_admin_source_intelligence` for bounded/redacted wp-admin and Dealer Inspire page understanding. Must be client-delegated because they need 1P credentials resolved via the local bridge, local browser state, and/or writes to the user's WordPress install. Client dispatchers in `src/lib/swanbot.ts` validate `siteUrl` must start with `http(s)://` (rejects `javascript:`, `ftp:`, etc.), require `onePasswordItem`, default sane mimeTypes, clamp `perPage` to [1, 50], and narrow WP API responses to `{ id, title, status, link }` tuples (title.rendered flattened from object-or-string) so the model sees small payloads. Tool descriptions tell the model to pair with `approvals.request` first. **v2 tool migration complete for this phase; current readiness parity is source-derived and pinned by `smoke:swanbot-openswan-readiness` at 25 server-side + 57 client-delegated = 82 tools.** Next: M4 (flip default after telemetry).
- **M3e hardening (2026-06-23).** OpenSwan runtime policy now has an explicit `wp.*` branch: `wp.discover_types` and `wp.list_posts` are read-only/auto, while `wp.upload_media` and `wp.create_slide` are publish-class writes requiring approval. Chat-side WordPress schedule now posts `status: future` plus the requested ISO date through `wordpressRestPayload`, so scheduled posts no longer degrade to draft-only behavior.
- **M3e Dealer Inspire hardening (2026-06-23; expanded 2026-06-26).** `wp.discover_types`, `wp.list_posts`, `wp.upload_media`, `wp.create_slide`, `wp.update_post`, `wp.trash_post`, and `browser.wp_admin_source_intelligence` are in the OpenSwan/SwanBot model-facing safe-name catalog so typed tool disclosure can actually expose them when WordPress/DI tasks need them. `wp.create_slide` now accepts `slideType` for Dealer Inspire/DI Slides flows, and its schema/description tells the model to discover `di_slide` / `flavor_di_slides`, create drafts first, and request approval before media, slider, expiration, order, cache, or public-status changes. Chat routes and OpenSwan planner ordering now inspect bounded WordPress admin source facts before using dashboard-only DI fields.
- **M3e update hardening (2026-06-24).** Added `wp.update_post` as a client-delegated WordPress write for known post/page/custom-post-type IDs. It supports bounded fields only (`title`, `content`, `status`, `slug`, `excerpt`, `date`, `featuredMedia`, `menuOrder`, `meta`), validates `siteUrl`/`onePasswordItem`/`postId`, returns a slim post receipt, and is publish-class approval-gated like media upload and slide creation. Chat/strategy/planner routes now recommend it for existing WordPress/Dealer Inspire updates before falling back to wp-admin browser control.
- **M3 browser/native mutation hardening (SOURCE-VERIFIED 2026-07-27; live proof pending).** `browser.locator_actionability` now supplies bounded read-only advisory evidence for one fresh exact browser target; it never authorizes or binds a later mutation, which must use its own approval/proof gate. `browser.select_option` seals one exact option on one native single-value HTML `<select>`, restricts it to low-consequence local presentation/accessibility preferences, and verifies the same control without submit/navigation; custom ARIA comboboxes, multi-selects, consequential settings, and unknown state fail closed. The existing `desktop.click_element` catalog entry is narrowed to a press-only semantic contract. Its adapter re-observes the exact frontmost app/PID/path/role/label/accessibility generation, seals a one-shot target, emits only privacy-safe bounded approval metadata, and accepts completion only when that exact target disappears or changes fingerprint. Text/state/value controls, modals, unknown semantics, destructive/payment/auth/permission/send/publish targets, and automatic replay are rejected. OpenSwan builds a `computerAppGrounding` observation epoch, hashes transient arguments, authorizes the exact contract, then calls `dispatchDurableComputerAppMutation`; the `agent_action_calls` claim/start/finish wrapper marks dispatch before one bridge perform and prevents duplicate execution. Ambiguous handler or after-state results end as outcome-unknown rather than replay. SwanBot intercepts the tool into this same runtime, while both raw dispatchers fail closed. Focused smokes pin the public and edge schemas, interception order, raw-bypass closure, grounding/ledger order, exact-target proof, and no-replay behavior. This is source/test evidence only: latest edge deployment, live database migration/RPC execution, production telemetry, and a real native GUI run remain unverified.
- **M3 authority and unattended-dispatch consolidation (SOURCE-VERIFIED
  2026-07-26; deployment/live DB proof pending).** Chat approval is SHA-256
  authority over the complete normalized plan plus user/circle/thread/room and
  one atomic `agent_approvals.applied_at` claim. OpenSwan approval is
  schema-v2 authority over exact canonical args plus authenticated
  run/provider-call identity and one atomic dispatch binding. SwanBot
  WordPress writes and the generic risk floor share the same digest-safe,
  single-use machinery. Approval audit/model payloads keep only bounded labels
  and digests. Durable OpenSwan/subagent tool-call telemetry similarly keeps
  only bounded field/type/shape summaries; exact arguments remain in-memory
  for approval, dispatch, and proof. `event-bound-core` guards this boundary
  in readiness and both release gates. `custom_api.request` and
  `messaging.notify` independently
  verify the consumed receipt and use `agent_action_calls` around one external
  attempt.

  Legacy direct file, image conversion, and diagnostic launch paths now return
  value-free non-executable handoffs. Executable `desktop.open_path` requires
  fresh stat/path digests, exact identity and approval, a §26 ledger claim,
  one bridge attempt, and fresh exact frontmost proof. The automation executor
  keeps service/scheduled runs read-only; a manual file write needs one exact
  approval and the ledger. Every scheduled action requires fresh
  per-occurrence approval, one durable claim/dispatch, no retry, and persistent
  `outcome_unknown` after ambiguity; the outbox exposes a redacted verify-first
  state with no retry. Office Realtime is only a wakeup: after client
  authentication/shape checks, §28 `invoke_agent` locks the exact durable
  message/circle/expected command, verifies membership and target ownership,
  and returns canonical executable fields. Its per-message/agent-subject claim
  is idempotent (including synthetic `blackswan`), while response stream/done
  transitions are claimant-bound, membership/live-state checked, bounded, and
  CAS-protected through multi-target completion. Section 28 also validates
  allowlisted immutable schema-v2 payloads for protected Chat/OpenSwan
  approvals, server-stamps pending resolution, and restricts expiry/one-use
  consumption to the requester without changing unrelated legacy/scheduled
  rows. Sections 26, 27, and 28, current edges, live scheduler/Realtime
  contention, external providers, and native GUI behavior remain unverified.
  Local Docker/Supabase was unavailable for §28 execution.
- **M3 adversarial closure (SOURCE-VERIFIED 2026-07-26; live races pending).**
  The v2 `browser.fill_field` model schema exposes only the sealed
  textbox/searchbox, bounded, no-submit, no-extra-properties contract, with
  `name` XOR `selector` enforced independently at the edge schema, app
  normalizer/runtime, client request, and bridge target/perform layers. All six
  legacy Computer Use mutations stop as value-stripped structured
  non-executable typed-runtime handoffs before screenshot, Stagehand, MCP, or
  bridge mutation I/O; whole-plan replay permits only the reviewed observation
  allowlist. Every current client-delegated browser/desktop mutation enters the
  canonical OpenSwan runtime before raw bridge fallback, while the sealed
  semantic path retains its explicit raw-dispatch refusal. The default edge
  client path enforces merged raw-turn/upstream constraints, the non-read
  always-confirm floor, and the exact-call approval callback before handler
  entry. Continuation protocol v2 first changes `pending` / `client_pending` to
  `dispatch_claimed` / `client_dispatching` before local execution, then
  persists exact results and changes to `results_claimed` /
  `client_resuming` before model resume. Only an exact same-claim dispatch
  retry is acknowledged; competing/mixed/ambiguous/expired paths seal
  outcome-unknown without reopening or replay. Readiness ignores all three
  active stop reasons. Focused smokes pin schema shape, policy ordering,
  gateway-first routing, structured mutation handoffs, exact two-phase claim
  ownership, and no-replay behavior. This does not replace deploy or live
  proof: latest edge deployment, production continuation-key configuration,
  §29 application/scrub/cron operation, the `agent_action_calls`
  migration/RPCs, real browser/native GUI behavior, and live-database
  action/continuation/sweeper concurrency plus failure injection remain
  unverified. Hosted cloud Computer Use source hardening has the separate
  deployment/live-integration limits documented above.

### Smoke-test strategy

Pre-M4 readiness:
1. Deploy/re-verify `swanbot-v2-ai` against the source-derived 82-tool snapshot
   with a dedicated `SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and explicit
   `SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`. Also verify that a deployment
   with no valid key withholds all `clientOnly` tools and creates no pending
   local-action checkpoint.
2. For focused Lane 1 work, run `npm run check:swanbot-v2:daily`; before default flips or customer release handoff, run `npm run check:swanbot-v2:release`. Cross-lane chat/computer work uses the matching `check:swanbot-chat:daily` or `check:swanbot-chat:release` gate. All four daily/release gates include `smoke:swanbot-v2-client-result-persistence` and the read-only `smoke:browser-locator-actionability`; `smoke:all` includes the latter too. These checks lock exact pending-call correlation, receipt redaction/model separation, idempotent event persistence, the bounded run aggregate, and advisory locator evidence that cannot authorize or bind a later mutation.
3. Explicitly run or confirm release-gate coverage for
   `smoke:browser-select-mutation-gateway`,
   `smoke:browser-select-runtime-gateway`, the 103-assertion
   `smoke:agent-action-calls`, `smoke:agent-action-runtime-wiring`, and
   `smoke:computer-app-semantic-action-runtime`, plus
   `smoke:swanbot-v2-batch-policy`, `smoke:swanbot-v2-continuation`,
   `smoke:swanbot-v2-edge-fill-schema`, and
   `smoke:computer-use-mutation-handoff`. The focused
   `scripts/swanbot-v2-continuation-crypto-smoketest.ts` must also prove exact
   round-trip, randomized IVs, tamper/wrong-key rejection, bounded envelope
   parsing, and secret/path absence; `smoke:event-bound-core` pins the
   value-free public input/error contract. The continuation smoke additionally
   pins the edge-side writer latch, non-retryable outcome-unknown response, and
   non-2xx-body stop before v1 fallback. The cross-lane Chat release gate also
   requires `smoke:computer-use-cloud-policy`,
   `smoke:chat-computer-request-router`, and
   `smoke:computer-task-runtime-context`. Both Chat/SwanBot daily and release
   gates, `smoke:all`, and canonical readiness execute exactly one copy of
   `chat-approval-single-use`, `openswan-runtime-approval`,
   `computer-app-open-path-runtime`, `automation-executor-mutation-guard`,
   `scheduled-action-mutation-guard`,
   `office-terminal-broadcast-authority`, `database-authority-guards`,
   `direct-local-file-runtime`, `direct-image-conversion-runtime`, and
   `computer-task-runtime-context`. Passing a generic receipt smoke is not
   proof that authorization ordering, two-phase continuation ownership, the
   cloud exact-confirmation boundary, root Chat constraint propagation, staged
   attachment handoff, sealed browser/native routes, or raw-bypass closure are
   intact.
4. Apply/re-verify `20260726_agent_action_calls.sql` in the target environment
   and exercise its claim/start/finish RPCs with real auth/run ownership before
   calling the durable ledger production-ready. A migration file and local
   source smoke are not live-database evidence. Race two workers against the
   same idempotency identity and prove only the winner enters the bridge.
   Apply `20260726_scheduled_action_mutation_guard.sql` (§27) as a separate
   requirement and prove claim/dispatch/manual-retry transitions under cron
   contention and crash-after-dispatch.
   Apply `20260726_database_authority_guards.sql` (§28) and prove Office
   invoke/stream/complete claimant races, multi-target completion, protected
   approval resolution/consume races, and unaffected legacy/scheduled rows.
   Apply `20260726_swanbot_continuation_privacy.sql` (§29), prove its one-time
   legacy/terminal scrub, and verify exactly one three-minute pg_cron job (or
   the documented manual service-role sweep where cron is unavailable).
5. After the local release gate passes, run the live production report with service-role Supabase credentials: `npm run report:swanbot-openswan-readiness -- --smokes-passed --since <iso>`. Use `npm run check:swanbot-openswan-readiness:production -- --smokes-passed --since <iso>` when the command should fail the handoff unless `can_flip_default` is yes. Do not add this live report to daily checks; it depends on production credentials and fresh telemetry.
6. Verify real `agent_runs` telemetry, not synthetic readiness input: v1 `swanbot-ai` rows must write `metadata.version='swanbot-ai'`, v2 rows must write `metadata.version='swanbot-v2-ai'`, and `src/lib/swanbotOpenSwanReadiness.ts` must load both cohorts by `metadata->>version` and `surface='main_chat'`.
7. Verify `agent_runs.final_stop_reason` telemetry is normalized to `end_turn`,
   `max_tokens`, `client_pending`, `client_dispatching`, `client_resuming`, and
   `error` before default-flip decisions. The first three client reasons are
   active/non-terminal and readiness must ignore them. The v2 edge preserves
   the raw Anthropic stop reason only in metadata as `rawStopReason`; the v1
   baseline normalizes terminal legacy turns to `end_turn`, `max_tokens`, or
   `error`.
8. Against the deployed edge and live database, race two `claim_dispatch`
   requests for one `continuationRunId`: prove only the exact winning claim can
   authorize local execution, an exact same-claim retry is idempotently
   acknowledged, and a competing claim fails closed. Then race exact result
   submissions: prove one `results_claimed` winner, no second model/server
   loop, and no reopened client-action request. Inject ambiguous post-commit
   responses plus dispatch/result lease expiry; every uncertain path must close
   as outcome-unknown without restoring `client_pending`.
9. Run live GUI proofs for sealed fill/toggle/native-select, the visible legacy
   Computer Use mutation handoffs, read-only `/desktop diag <app>` launch
   handoff, and native semantic press. Source smokes do not prove browser/AX
   behavior, focus, timing, or bridge integration.

---

## M4 — Flip the default

- After M3e, watch a week of mixed v1/v2 telemetry from the opt-in cohort.
- Build the decision from `src/lib/swanbotOpenSwanReadiness.ts`, not a manual checklist. It derives the current v2 catalog from `supabase/functions/swanbot-v2-ai/index.ts` and currently requires 82 tools total, 57 client-delegated tools, the SwanBot v2 routing/delegation/continuation/writer/workspace/approval/WordPress/dispatcher-parity smokes, browser locator-actionability smoke, WordPress admin source-intelligence smoke, OpenSwan approval/planner smokes, failure-recovery smoke, and enough real `agent_runs.final_stop_reason` telemetry from both the v1 baseline and v2 candidate cohorts. `scripts/swanbot-openswan-readiness-report.ts` is the operator-facing production report for that same logic; it first probes `agent_runs` for the late telemetry columns (`tool_calls`, `iteration_count`, `final_stop_reason`, `input_tokens`, `output_tokens`, `cached_tokens`) and reports cohort completeness before printing the readiness snapshot.
- The 82/57 readiness count proves catalog shape, not the newest guarded
  runtime. Before operational sign-off, separately confirm the deployed edge
  has the exact fill/select/semantic schemas, default-edge policy enforcement,
  gateway-first mutation routing, and both continuation CAS phases before
  local dispatch and before model resume.
  Apply and exercise `agent_action_calls` in the live database, race both the
  action and continuation CAS paths, configure the dedicated continuation key,
  apply §29 and verify its scrub/cron behavior, inject ambiguous outcomes, and
  collect real browser/native GUI proof. Until then these guarded routes and
  continuation privacy boundary are source-verified, not production-verified.
- When v2's `final_stop_reason === 'end_turn'` rate is ≥ v1's and the readiness snapshot returns `canFlipDefault: true`, flip the default in `isSwanbotV2Enabled()` from `false` to `true` with `!== 'false'` semantics. v1 becomes opt-out.
- As of 2026-07-26, v2 uses the normalized stop-reason vocabulary before writing `agent_runs.final_stop_reason`: `stop_sequence` is counted as `end_turn`, iteration cap is `max_tokens`, paused client tools are `client_pending`, dispatch-owned local work is `client_dispatching`, result/model-resume ownership is `client_resuming`, and unexpected terminal reasons are `error`. Readiness excludes all three active client states. Only `end_turn` writes `status='completed'`; `max_tokens` and `error` write `status='failed'` so readiness does not count cut-off model responses as clean completions. Pending and terminal v2 updates also write `agent_runs.input_tokens`, `agent_runs.output_tokens`, and `agent_runs.cached_tokens` from the accumulated Anthropic usage totals so the live readiness report can flag real telemetry gaps instead of source-code gaps.
- As of 2026-06-29, normal-path v1 `swanbot-ai` turns also create and close `agent_runs` rows with `metadata.version='swanbot-ai'`, token fields, tool summaries, iteration count, and normalized final stop reasons. Relay-mode v1 turns are deliberately excluded because they are client-controlled tool continuations, not terminal baseline samples.
- Announce in chat + post to `agent_activity` on every circle.

---

## M5 — Retire the v1 tool loop (NOT the edge function)

> **⚠️ Corrected 2026-07-15 (architecture review).** The original M5 said "delete the
> `swanbot-ai/` directory." That is **production-breaking** and must not be done as
> written. `swanbot-ai` plays **two** roles, and only one is superseded by v2:
>
> 1. **Legacy tool loop** — `BLACKSWAN_TOOLS` + `executeToolUseLoop`. *This* is what v2
>    replaces, and it is safe to retire once the flip is durable.
> 2. **Provider relay** — the leg that actually calls Anthropic / marketplace / BYOK /
>    the tool-less relay / the OR-key path and returns model output. This is **still
>    live** and depended on by, at minimum: `openswanSessionRuntime.ts` (:742, :1017 —
>    the OpenSwan session transport), `agentInvocation.ts` (:151 — BlackSwan invoke),
>    `computerTaskRuntime.ts` (:675 — tool-less relay leg), `subagentRegistry.ts` (:468),
>    `swanbot.ts` (:2381/:2444/:4277/:4707 relay paths), `BlockBriefEditor.tsx` (:197),
>    **and v2 itself** (`model_unsupported_on_v2` at `swanbot-v2-ai/index.ts:2919` routes
>    *back* through `swanbot-ai`/`llm-proxy`). Deleting the directory breaks all of these.

**Safe M5 (tool loop only):**

- 30 days after M4 with no rollback.
- Remove the **tool-loop** code path from `swanbot-ai` (`BLACKSWAN_TOOLS`, the
  `executeToolUseLoop` branch) — the relay leg stays.
- Leave every `supabase.functions.invoke('swanbot-ai', …)` relay caller working.
- Update `AGENTS_ROADMAP.md` to mark the *tool-loop split* retired (not the function).

**Prerequisite before the edge function could ever be deleted (separate, later work):**

- Re-home the provider relay (BlackSwan/marketplace/BYOK/tool-less) onto `llm-proxy`
  or a dedicated relay function, migrate all 8+ call sites above, and remove v2's own
  `model_unsupported_on_v2 → swanbot-ai` fallback. Only after that is `swanbot-ai/`
  genuinely orphaned. Track this as its own milestone; do not fold it into M5.

---

## Rollback contract

If v2 goes sideways at any phase:
- M1 → Any user runs `/v2 off`. Per-device. No deploy needed.
- M2/M3 → Edge fn has a hard kill switch via `swanbot-v2-ai/config.disabled`
  env var. A 503 may fall back to v1 only before dispatch ownership/local
  execution; claimed or ambiguous continuations stop without replay.
- M4 → Flip the default back (`'false'` in localStorage) — single commit.

---

## Definition of done per phase

| Phase | DoD |
|---|---|
| M1 | Flag toggle works · `/v2` command lands · v2 invocation succeeds end-to-end when enabled · v1 unchanged · typecheck + all smoke suites green |
| M2 | Client-only desktop/tool calls succeed under v2 with flag on · pending `clientToolCalls` + same-edge continuation round-trip works · exact resumable state is AES-256-GCM sealed under the dedicated versioned key while the public envelope/events remain value-free · missing-key starts withhold all `clientOnly` tools · exact `client_pending → client_dispatching` ownership is confirmed before any local execution · exact results transition `client_dispatching → client_resuming` before model resume · only same-claim dispatch retry is idempotent · invalid/duplicate/missing results and competing/mixed/ambiguous/expired claim paths fail closed outcome-unknown with no replay · raw-turn/upstream constraints plus the all-non-read always-confirm floor and exact-call approval run before handlers · trusted receipt metadata is re-sanitized, durably correlated, and absent from model content · guarded mutations enter their canonical runtime before generic dispatch and raw bypasses fail closed · rollback flag works |
| M3 | Source-derived **82 = 25 + 57** catalog and edge/OpenSwan schema parity pass · smoke tests cover representative read/write/client-delegated families plus exact Chat/OpenSwan/SwanBot approval, direct-handoff/open-path, automation/schedule/Office/database-authority, continuation privacy, read-only locator-actionability, fill/select/semantic/ledger, and all-mutation legacy-handoff invariants · deployed edge snapshot, live §26/§27/§28/§29 migration/RPC/cleanup ownership, approval/action/schedule/continuation races, cron, and GUI proofs are verified · `agent_runs.metadata` captures only the bounded public trace/envelope |
| M4 | `swanbotOpenSwanReadiness` returns ready · default flipped · v1/v2 telemetry shows v2 ≥ v1 on completion rate · no regressions reported |
| M5 | v1 **tool-loop** path removed (`BLACKSWAN_TOOLS` / `executeToolUseLoop`) · **provider relay leg kept + all invoke callers green** · roadmap doc updated. (Edge-function deletion is explicitly OUT of M5 — it needs the relay re-homed first.) |

---

## Status log

- **2026-07-26 — encrypted continuation checkpoint privacy
  (source-verified).** SwanBot v2 now seals the exact resumable
  transcript/system/tool snapshot with AES-256-GCM under the dedicated
  `SWANBOT_CONTINUATION_ENCRYPTION_SECRET` and authenticated rotation key
  version. Circle-visible `metadata.continuation` is limited to bounded
  identity/state, pending `{id,name}` entries, expiry, and ciphertext metadata;
  public events keep only value-free input summaries and fixed redacted
  failures. Without the key, fresh turns withhold all `clientOnly` tools and
  resumes fail closed. §29 atomically closes and strips active
  legacy/plaintext, malformed/unsealed, expired, or state-mismatched
  checkpoints, scrubs terminal checkpoints once, and installs an idempotent
  three-minute sweep when pg_cron exists. Claimed or ambiguous work remains
  outcome-unknown/no-replay. **Still pending:** configure and rotation-test the
  production env, deploy the edge, apply §29, prove the historical scrub and
  cron/manual sweep live, and race claim/result transitions against the
  sweeper. Until §29 is applied, old plaintext rows can remain.
- **2026-07-26 — exact approval + unattended mutation authority
  (source-verified).** Chat, OpenSwan, and audited SwanBot WP/floor mutations
  now bind full intent/scope with schema-v2 SHA-256 authority and consume one
  durable grant before one dispatch. Direct file/image/diagnostic-launch paths
  emit value-free handoffs; `desktop.open_path` uses fresh stat/path binding,
  §26, one bridge attempt, and exact frontmost proof. Manual automation writes,
  scheduled actions, and outbound custom API/messaging mutations now use
  explicit claim/dispatch/no-replay boundaries. Scheduled ambiguity is visible
  as verify-first `outcome_unknown` without retry. Office broadcast payloads
  are wakeups whose exact RLS row is the only command source. The ten focused
  authority guards run exactly once in every Chat/SwanBot daily/release gate,
  `smoke:all`, and readiness. **Still pending:** apply §26/§27/§28, deploy all
  changed edges, and prove live DB/cron/Realtime contention, external provider
  execution, and GUI behavior.
- **2026-07-26 — cloud Computer Use policy + root Chat bypass closure
  (source-verified).** The Browserbase edge now requires a bounded v1 policy
  from authenticated Chat/queue callers and forces scheduled watch/service
  work observation-only. All three root Chat starts preserve derived user
  constraints/confirmation floors. Opaque click/type/key and saved-login calls
  require exact live confirmation, fresh pre/post screenshots, and
  single-attempt dispatch; unknown actions fail closed and ambiguous attempted
  mutations end outcome-unknown/no-replay. Secret-bearing traces, replay,
  solver inputs, model history, and errors are redacted. Single-task and queue
  start reservations close async start races. `computerTaskRuntime` no longer
  runs the app adapter or attachment open/wait helpers before authenticated
  agent execution; attachments stay staged behind a non-executable
  `desktop.open_path` handoff. Chat daily/release, `smoke:all`, and canonical
  readiness include `computer-use-cloud-policy` and
  `computer-task-runtime-context` exactly once. **Still pending:** deploy the
  updated edge and prove live Browserbase/Supabase confirmation behavior plus a
  real native-app run. Authenticated legacy cloud callers without a v1 policy
  now receive HTTP 400.
- **2026-07-26 — sealed select + narrow native semantic press + durable action
  ledger (source-verified).** `browser.select_option` adds a one-shot,
  no-submit/no-navigation native HTML-select lane. The existing
  `desktop.click_element` entry is now a press-only exact app/PID/path/role/label
  contract with fresh accessibility re-observation, privacy-safe approval
  binding, exact-target verification, and no automatic replay. SwanBot
  intercepts it into `executeOpenSwanRuntimeTool`; raw OpenSwan and raw client
  dispatchers explicitly refuse direct execution. The runtime binds the sealed
  observation through `computerAppGrounding` and the
  `agent_action_calls`-backed claim/start/finish wrapper before one bridge
  perform. The edge fill schema now pins the sealed textbox/searchbox contract
  with `name` XOR `selector` at every schema/normalizer/client/bridge layer,
  and all six legacy Computer Use mutations stop as value-stripped structured
  non-executable typed-runtime handoffs with whole-plan replay preflight.
  Default-edge continuations enforce merged constraints, the all-non-read
  always-confirm floor, and exact-call approval before handler entry; every
  current client browser/desktop mutation enters OpenSwan first. Protocol v2
  changes `client_pending` to `client_dispatching` before local execution and
  `client_dispatching` to `client_resuming` after exact results but before
  model resume. Only an exact same-claim dispatch retry is acknowledged; all
  competing/mixed/ambiguous/expired paths close outcome-unknown without replay,
  and readiness ignores all three active states. Edge/OpenSwan
  schemas and focused runtime smokes pin the contract, while the catalog
  remains **82 total / 57 client-delegated / 25 server-side**. **Still
  pending:** deploy/re-verify the latest `swanbot-v2-ai` source, apply and
  exercise the ledger migration/RPCs in the live database, race continuation
  and action claims plus inject ambiguous/expired outcomes, collect live
  browser/native GUI proof, generalize beyond the narrow low-consequence
  canaries, and complete M4 production telemetry sign-off.
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
