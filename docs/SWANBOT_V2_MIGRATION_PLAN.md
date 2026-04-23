# SwanBot v1 → v2 Migration Plan

**Canonical rollout for moving main chat off `swanbot-ai` (hardcoded tools, ~2,800 lines) onto `swanbot-v2-ai` (typed tool loop, real agent_runs telemetry, `openswanToolRuntime` catalog).**

**Why now:** the v1 edge function has a hardcoded `BLACKSWAN_TOOLS` list. Adding the desktop automation tools (`desktop.launch_app`, `desktop.type_text`, etc.) to v1 means porting a handwritten tool dispatcher. v2 already uses the typed `ToolDef` shape matching `src/lib/agentExecutionCore.ts` — registering new tools is a single object literal.

**Authored:** 2026-04-23 · **Cross-linked from:** [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md), [`DESKTOP_AUTOMATION_PHASE_1_PLAN.md`](./DESKTOP_AUTOMATION_PHASE_1_PLAN.md).

---

## What ships in which phase

| Phase | Ships | Status |
|---|---|---|
| **M1** Flag + client router + plan doc | `uc_swanbot_v2_enabled` localStorage flag, `/v2 on|off` slash command, `callSwanBotV2`, tier-2 route switcher in `swanbot.ts` | **Shipping this turn** |
| **M2** Client-delegated tool protocol | v2 emits `event: client_tool_call` SSE frames for `desktop.*` tools; client executes via bridge + POSTs result back to `/continue`; desktop tools registered in v2 as `clientOnly: true` | Next turn |
| **M3** Full OpenSwan tool parity | Port the 30+ tools from `openswanToolRuntime` into v2's `TOOLS: ToolDef[]` (Supabase-backed tools direct; client-delegated via M2 protocol) | After M2 |
| **M4** Flip the default | Default `uc_swanbot_v2_enabled = true`; v1 becomes opt-out for regression escapes | After M3 + 1 week of clean v2 telemetry |
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
  pausedAt: string,         // ISO timestamp
}
```

On continuation, the edge fn reads the blob, injects the supplied `tool_result` content blocks into `messages`, and re-enters the main loop at `iter+1`.

### Timeout + cancel

- If the client never sends a continuation and the user's chat session ends, the row sits with `status: 'running'` indefinitely. A cron sweeper (`sweep_stale_agent_runs`) every 5 min marks any run with `status='running'` + last event > 10 min as `final_stop_reason: 'client_timeout'`.
- Client-side: `callSwanBotV2` caps at 6 continuation round-trips. Seventh → abort, post error to chat.

### Security

- Continuation request requires the same auth header as the original call — token binds to the user who started the run.
- Edge fn verifies `runId` belongs to the calling `user_id + circle_id` on `agent_runs`.
- Client-supplied `toolResults` are treated as untrusted text — same posture as any tool output. The LLM reads the result, never executes it.
- The content-block `tool_result` schema is enforced: only `tool_use_id` + `content` + optional `is_error` are accepted.

### Desktop tools under v2

All 11 desktop tools from Phase 1d are registered in the edge fn's `TOOLS: ToolDef[]` with `clientOnly: true`:

- `desktop.launch_app`, `desktop.focus_app`, `desktop.type_text`, `desktop.press_keys`, `desktop.list_running_apps`, `desktop.wait_for_app`, `desktop.screenshot`, `desktop.open_url`, `desktop.open_path`, `desktop.click_at`, `desktop.screen_size`

When a v2-enabled user asks "open Terminal and type `claude`", the model sees these tools in its catalog, plans a sequence, and each `desktop.*` call rides the round-trip protocol to the local bridge.

---

## M3 — Full OpenSwan tool parity

`openswanToolRuntime.ts` has ~35 tool definitions. Port them into v2's `TOOLS` array in sub-phases:

- **M3a — read-only Supabase tools (SHIPPED 2026-04-23).** 7 new tools added to `swanbot-v2-ai/index.ts` TOOLS: `fetch_url`, `tasks.list`, `missions.list` (with mission_tasks roll-up for progress %), `check_ins.list`, `integrations.list`, `rooms.list`, `office.list_agents`. Handlers reimplemented inline against the edge-side Supabase client — can't import from `src/` (RN-flavoured). Includes v1's `getMemberStatus`, `searchCircleMemory`, `getGithubActivity`, `listLibrarySkills`, `viewLibrarySkill` — v2 total: **12 server-side + 11 client-delegated desktop = 23 tools**.
- **M3b — writers (server-side mutations, SHIPPED 2026-04-23).** 8 new writer tools added: `save_memory`, `tasks.create`, `tasks.update_status`, `tasks.assign`, `missions.create_task`, `messages.create`, `rooms.create`, `rooms.send_message`. Handlers reimplemented inline against the edge Supabase service-role client. Because service-role bypasses RLS, every writer explicitly scopes by `circle_id = circleId` on `insert` and re-verifies parent rows (task / mission / room) belong to the caller's circle before mutation. Cross-circle attempts return `"X not found in this circle"`. Status aliases ("in progress", "open") normalised via `normalizeTaskStatus()` helper. 52 smoke assertions in `scripts/swanbot-v2-writers-smoketest.ts` cover scope guards + validation + shape. Approval gating stays on the client side via `chatApprovalGate` — server is scope-enforcement only.
- **M3c — workspace / verification via client-delegation (SHIPPED 2026-04-23).** 6 new `clientOnly` tools: `workspace.create_room`, `workspace.apply_artifacts`, `workspace.open_preview`, `verification.typecheck`, `verification.tests`, `verification.lint`. Edge fn declares them with defensive-throw handlers; client dispatcher in `src/lib/swanbot.ts` routes the tool names to `createWorkspaceFromArtifact` / `createFilesInRoomFromArtifact` (chatWorkspace.ts), `primeRoomWorkspaceLaunch` / `focusRoomWorkspaceFile` (roomWorkspaceLauncher.ts), and `detectClaudeCodeBridge` + `execBridgeCommand` (claudeCodeDetector.ts). Verification output stdout/stderr clipped at 8KB to cap context cost. `normalizeArtifact` helper enforces artifact `{ kind, title }` shape before any write. 47 smoke assertions in `scripts/swanbot-v2-workspace-smoketest.ts`.
- **M3d — approvals + credentials (SHIPPED 2026-04-23).** 4 new tools. Server-side: `approvals.list` (scoped to circle, filter by status, default `pending`), `approvals.request` (auto-attaches to ctx.runId when caller omits runId; scope-guards against cross-circle run ids; clamps timeoutSeconds to [30, 86400]), `approvals.resolve` (scope-guards; rejects already-resolved). ToolContext gained `runId?: string | null` so the approval handlers can attach to the current run without duplicating state. Client-only: `credentials.get` proxies to the bridge `/secrets` endpoint (1Password CLI via OP_SERVICE_ACCOUNT_TOKEN) via `dispatchCredentialsGet` in `src/lib/swanbot.ts` — returns the raw `{ field: value }` map, since callers like `wp.create_slide` need plaintext. Tool description explicitly warns the model not to echo. 35 smoke assertions in `scripts/swanbot-v2-approvals-smoketest.ts`.
- **Production deploy (SHIPPED 2026-04-23).** `supabase functions deploy swanbot-v2-ai` pushed `index.ts` + `_claude/anthropic.ts` + `_shared/edge.ts` to project `rjkniqiqdtroeholxacg`. Endpoint at `https://rjkniqiqdtroeholxacg.supabase.co/functions/v1/swanbot-v2-ai` returns structured `missing_fields` 400 on empty body (smoke-verified). Every `/v2 on` device now talks to the live 45-tool catalog.
- **M3e — WordPress + publishing (SHIPPED 2026-04-23).** 4 new `clientOnly` tools: `wp.discover_types`, `wp.list_posts`, `wp.upload_media`, `wp.create_slide`. Must be client-delegated because they need 1P credentials resolved via the local bridge + write to the user's WordPress install. Client dispatchers in `src/lib/swanbot.ts` validate `siteUrl` must start with `http(s)://` (rejects `javascript:`, `ftp:`, etc.), require `onePasswordItem`, default sane mimeTypes, clamp `perPage` to [1, 50], and narrow WP API responses to `{ id, title, status, link }` tuples (title.rendered flattened from object-or-string) so the model sees small payloads. 33 smoke assertions in `scripts/swanbot-v2-wp-smoketest.ts`. Tool descriptions tell the model to pair with `approvals.request` first. **v2 tool migration complete.** v2 total: **23 server-side + 22 client-delegated = 45 tools**. Next: M4 (flip default after telemetry).

### Smoke-test strategy

After every M3 sub-phase:
1. `npm run smoke:all` still passes.
2. Send a one-shot prompt against v2 that exercises the newly-ported tool (hand-crafted per tool).
3. Verify `agent_runs` metadata captures the full tool trace.

---

## M4 — Flip the default

- After M3e, watch a week of mixed v1/v2 telemetry from the opt-in cohort.
- When v2's `final_stop_reason === 'end_turn'` rate is ≥ v1's, flip the default in `isSwanbotV2Enabled()` from `false` to `true` with `!== 'false'` semantics. v1 becomes opt-out.
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
| M2 | `desktop.launch_app` succeeds under v2 with flag on · SSE `client_tool_call` + `/continue` round-trip works · Timeout test fires after 2 min · Rollback flag works |
| M3 | All 35 tools from `openswanToolRuntime` reachable under v2 · smoke tests cover the contract for at least 10 representative tools · `agent_runs.metadata` captures the full trace |
| M4 | Default flipped · one week of v1/v2 telemetry shows v2 ≥ v1 on completion rate · no regressions reported |
| M5 | `swanbot-ai/` directory deleted · no imports remain · roadmap doc updated |
