# Tool-Tree Build — Session Handoff (2026-06-10)

> Where the tool-tree build-out (T-items) stopped. Companion to the research
> record `docs/TOOLTREE_DESKTOP_RESEARCH_2026-06-10.md` and the canonical plan
> `docs/SWANBOT_OPENSWAN_CHAT_NEXT_PLAN_2026-06-08.md` (T-items section).
> All shipped work below is in the working tree, **typecheck clean**, smokes
> green. Nothing here is committed yet.
>
> **UPDATE 2026-06-11 — build-out finished.** The session resumed and
> completed the remaining items: **T2** (progressive disclosure, dark —
> measured -82–89% advertised schema per surface), **T8 wiring**
> (`toolParallelPolicyProvider` on `runAgent` + catalog
> `TOOL_DEPENDENCY_DOMAINS` + bridge provider, dark), **T10** (composable
> `toolResultFormatters.ts` + `response_format` on 10 observation tools),
> **T1** (full description audit: 426 lint violations → 0 across 158 tools +
> permanent `smoke:tool-description-lint`), plus stale-docs cleanup
> (AGENTS_ROADMAP §4/§6). Still deferred by design: T3 (consolidation —
> name-migration pass), T7 UX half (sticky allow scopes UI), T6/T2/T8
> un-darking (each needs a live-verified flip; checklist in the plan doc's
> T-item status section). Authoritative per-item status now lives in the
> plan doc; the sections below are the original mid-session snapshot.

## Done this session (5 of 10 T-items + parts of two more)

Built in two parallel waves of subagents on disjoint files, each verified.

### T4 — Registry unification (O2 finished) ✅
- **Key finding:** the legacy `src/lib/agentTools/` registry was *fully
  orphaned* — zero non-folder importers. The "some callers still merge the
  local registry" comment was stale.
- 3 duplicate tools retired (mapped to existing catalog `list_circle_members`,
  `search_memories`, `github.activity`); 7 snake_case `desktop_*` dupes
  retired (catalog `desktop.*` already covered them).
- 4 genuinely-unique tools migrated INTO the catalog as proper
  `OpenSwanToolDefinition`s with policies: `skills.view` (auto, read-only),
  `skills.manage` (HITL, `plan_approval`), `user_memory.manage` (memory,
  `tool_use`; append immediate, replace/delete HITL), `messages.search`
  (auto, read-only, untrusted-fenced excerpts). Catalog versions take
  circleId/userId from trusted runtime context instead of model-supplied args
  (security improvement).
- `agentTools/openswanBridge.ts` → `src/lib/openswanBridge.ts` (now the single
  tool path for `runAgent` callers). `src/lib/agentTools/` **deleted** (10
  files).
- **Approval-grant compat:** no grants lost — the legacy desktop names were
  never reachable, and the `desktop_action` chatAutoApprove category is
  untouched (separate from catalog `agent_run_approvals` keys).
- **Left for follow-up:** `supabase/functions/swanbot-v2-ai/index.ts`
  reimplements 4 camelCase tools Deno-side (independent code, not imports) —
  align names during the v2 typed-loop migration. Docs (AGENTS_ROADMAP §4,
  CLAUDE.md runtime map) still mention a "coexisting local registry" caveat
  that's now obsolete.

### T5 — One approval framework + approvalKind completeness ✅
- Every `mutatesState: true` policy now carries an `approvalKind` (was ~20
  mutating-auto coordination tools missing it). Used existing kinds only —
  **`ApprovalKind` union was NOT extended** (it's mirrored in
  `agentRunSystem.ts`, `runApprovalsService.ts`, a *total* Record in
  `RunApprovalBanner.tsx`, and a DB CHECK constraint in
  `20260408_unified_agent_runs.sql:158` — a new kind needs a migration).
  Added a `COORDINATION_APPROVAL_KINDS` map (writes→`tool_use`,
  posts→`publish`, file ops→`file_write`, settings→`privileged_action`
  default).
- Desktop tools' move off the legacy `chatApprovalGate('desktop_action')`
  onto the catalog policy gate happened via T4 (the legacy names were
  unreachable, so this was free).

### T9 — Mode-tag completion ✅
- Confirmed filtering semantics first: unset/`none`/`talk` mode → everything
  passes (tools never vanish from default chat); tagged tools hide only in
  explicitly-set modes not in their list. Tagged all clearly-mutating tools
  with `execute`/`build` (+`plan`/`design`/`support` where apt); left
  read-only tools mode-agnostic. Deliberately left `tasks.comment` and
  `approvals.*` untagged (control-plane must stay reachable in every mode).

### T8 — Dependency-aware parallelism (O6) ✅
- `ToolParallelPolicy` gained optional `mutationTargets?`/`readsFrom?` (state
  domains). New rule: a batch parallelizes when no approval gate AND every
  pair has disjoint writes AND neither reads the other's writes. **Absent
  metadata preserves exact legacy behavior** (a mutating tool without targets
  is never parallel-safe; a no-metadata reader has an "unknown" read set so it
  stays sequential next to any writer). `'ask'`/externalSideEffect tools never
  parallel regardless. Added `partitionParallelSafeBatch` (greedy in-order
  safe grouping). Module stays pure. Smoke: `smoke:tool-batch-parallelism`
  (~28 asserts).
- **Not yet wired** into the live loop — this is the pure rule + metadata
  layer. Tools don't declare `mutationTargets` yet (next step: populate them
  in `getBaseOpenSwanToolPolicy` and have the runtime consult
  `partitionParallelSafeBatch`).

### T6 — MCP tool bridge adapter ✅ (dark, not wired)
- New `src/lib/mcpToolBridge.ts`: policy-safe MCP→agent-tool adapter modeled
  on `openswanBridge.ts`. Pure `deriveMcpToolPolicy` — **fail-closed**:
  untrusted server OR no annotations ⇒ mutating+destructive+`ask`
  (`privileged_action`); trusted+readOnly ⇒ auto; trusted+mutating ⇒ ask
  (`external_send` if open-world else `privileged_action`). Per the verified
  MCP spec rule that annotations MUST be treated as untrusted from untrusted
  servers. Namespacing `mcp__<slug>__<tool>` (charset-safe, ≤128, collision
  hash). Injected approval gate (no-gate `ask` ⇒ policy-block); results
  `<untrusted_quoted>`-fenced with fence-escape neutralization + ~8k cap.
  Smoke: `smoke:mcp-tool-bridge` (12 checks).
- **Not wired:** `getMcpToolsForCircle` is the only impure entry (lazy-imports
  mcpClient). `circle_mcp_servers` has no trust column — the `trusted?:
  boolean` seam exists; all current callers resolve untrusted. Live wiring
  needs: (a) register these tools in a run's tool set, (b) back the gate with
  `requestRunApproval`/`agent_run_approvals`, (c) decide the trust source (DB
  column or circle-config allowlist), (d) optional `listChanged` re-fetch.

### T7 — Always-confirm floor ✅ (the floor half)
- `ALWAYS_CONFIRM_FLOOR = ['pay','delete','login','grant']` in
  `chatComputerRequestRouter.ts`. `'grant'` added to the D3
  `ChatComputerConstraintCategory` union (additive, persisted-compatible).
  Floor forces `approvalRequired: true` even under "don't ask me"/high
  autonomy — sits before every downgrade path; not user-disableable.
  Conservative verb-anchored detection (`delete` tightened to
  delete/erase/wipe/permanently-remove so "remove background" doesn't floor).
  Prompt block gains a HARD-policy line. `constraintBlocksToolCall` now
  returns a verdict distinguishing hard-block (user-forbidden) from
  floor-confirm (request approval, don't block). Fixed a latent `login`
  regex gap ("log into"/"sign into"). Smoke: `smoke:chat-computer-
  request-router` (~25 new asserts) + 6 downstream consumers green.
- **Left (T7 UX half, unbuilt):** sticky per-site/per-app "always allow"
  grants + a reviewable/revocable permissions surface with history (the
  Claude-in-Chrome pattern). This is UI work; rides the D-item surfaces.

## Not done — pending T-items

- **T1 — Description/schema audit pass** over all ~157 tools (cheapest
  verified reliability win; never started). Good standalone next task.
- **T2 — Progressive disclosure** (pinned core + `tools.search` +
  `resolveAdditionalTools` dynamic-expansion hook on `runAgent`). **Was
  launched as a subagent and interrupted/rejected before any edits — nothing
  written.** This is the single biggest token + selection-accuracy win
  (~15–20k tool-schema tokens/turn today). Design was scoped in the rejected
  agent prompt; re-spec before relaunching. Note its dependency on the
  R15/O7 prompt-cache boundary work — design the deferral and cache boundary
  together.
- **T3 — Family consolidation** (action-parameterized group tools:
  desktop.* 57→~20, missions/tasks/rooms writes). **Deliberately deferred** —
  it renames model-facing tool names, which breaks action-trace replay
  (D7c) and persisted approval fingerprints (`stableApprovalJson`), so it
  needs its own live-verified pass with migration handling, like C1. Do NOT
  batch it with the others.
- **T10 — Composable result formatters** + `response_format:
  concise|detailed` on observation-heavy tools (never started).

## Wiring still required to make shipped work live

The shipped T6/T8 (and T2 when built) are **dark** — pure layers not yet on
the live path:
1. **T8:** populate `mutationTargets`/`readsFrom` in `getBaseOpenSwanToolPolicy`
   and have the tool-dispatch loop call `partitionParallelSafeBatch`.
2. **T6:** register `getMcpToolsForCircle` output into run tool sets behind the
   approval gate + trust source.
3. **T2 (when built):** flip a caller (session runtime / v2 edge) to
   `getProgressiveOpenSwanTools` — explicitly a separate, live-verified pass.
   Mind the non-Anthropic providers in the cross-provider router (native Tool
   Search is Anthropic-only; the catalog-level `tools.search` must work for
   all).

## Validation state (as of handoff)

- `npm run typecheck` — **clean** (combined tree, all 5 agents' edits).
- `src/lib/agentTools/` confirmed deleted; `src/lib/openswanBridge.ts` +
  `src/lib/mcpToolBridge.ts` present; `smoke:tool-batch-parallelism` +
  `smoke:mcp-tool-bridge` wired in package.json.
- Smokes reported green by each agent: agent-core, agent-runtime,
  desktop-runtime-wiring, openswan-runtime-approval, run-approvals,
  openswan-task-planner, skill-subfile, mcp-tool-bridge,
  tool-batch-parallelism, chat-computer-request-router (+ux), chat-planner,
  computer-task-complexity, chat-computer-handoff-context,
  computer-task-evidence-contract/recovery, openswan-verification-runtime.
- **Not yet done:** a single consolidated re-run of the full smoke suite in
  one pass, and no commit. Recommend running the full `smoke:*` set once and
  committing as a checkpoint before T1/T2.

## Suggested next session

1. Run the full smoke suite once; commit shipped T4/T5/T6/T7-floor/T8/T9 as a
   checkpoint.
2. **T1** (description audit) — safe, standalone, high-leverage.
3. Re-spec and build **T2** (progressive disclosure) as its own pass with the
   R15 cache boundary.
4. Wire the dark layers (T8 metadata + loop; T6 live registration) when a
   live-app verification pass is available.
5. Update `docs/AGENTS_ROADMAP.md` (O2/O6 status) + CLAUDE.md runtime map
   (drop the obsolete dual-registry caveat).
