# Phase CA-8 — Hermes Delta Rollout

**Canonical rollout of the top-10 items from [`archive/AGENT_RUNTIME_DELTA_PLAN_2026-04-22.md`](./archive/AGENT_RUNTIME_DELTA_PLAN_2026-04-22.md) (archived — this doc is the live record).** Every agent touching UC should read this before starting Hermes-adjacent work so we don't build parallel stacks.

Cross-referenced from: [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md) · [`AGENT_RUNTIME_INTEGRATION_PLAN.md`](./AGENT_RUNTIME_INTEGRATION_PLAN.md) · [`CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`](./CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md) · [`CLINE_RESEARCH_AND_MAPPING_2026-04-22.md`](./CLINE_RESEARCH_AND_MAPPING_2026-04-22.md).

**Last synced:** 2026-04-22

---

## Non-goals — DO NOT ship these

These have been researched and explicitly rejected. If a future agent re-proposes one, point them at this section.

- **`execute_code` (Hermes §2.8).** Model writes Python/TS that calls tools via sandboxed RPC. Not worth the blast radius (prompt-injected loops, cost explosions) for our audience. Defer indefinitely.
- **Darwinian Evolver mutating `.ts` files (Hermes evolution-repo §2.4).** Conflicts with UC's no-autonomous-code-edits policy. If we ever adopt DSPy/GEPA, **cap evolvable surfaces to skill bodies + tool descriptions + prompt components.** Never source files.
- **Pluggable terminal backends (Docker/SSH/Modal/etc.).** We already ship `room-task-executor` + computer-use + Claude Code bridge. Adding Modal/Daytona/Singularity is a separate power-user surface, not a Hermes delta.
- **Skill marketplace / `/skill publish` (Hermes §3.15).** Blocked on 10+ user-authored skills. Not before.
- **Memory self-consolidation for shared `circle_memory`.** Hermes' "agent gets an error and rewrites the doc" model is unsafe across multiple users editing the same facts. Keep HITL compaction for shared memory; self-consolidate only on `user_memory`.

---

## Sub-phase list (ordered by impact ÷ effort)

Each sub-phase names its exact code paths, SQL impact, smoke-test file, and roadmap link so any agent can pick one up without additional discovery. Dependencies are called out.

### CA-8a · Agent-side context compression · **task #75 · SHIPPED 2026-04-22**

- **Problem.** Long BlackSwan threads balloon past 50K tokens, and every turn re-pays for all of it. Biggest cost / latency lever we have.
- **Files shipped.** `src/lib/agentContextCompression.ts` (pure core + `estimateMessagesTokens`), `scripts/agent-context-compression-smoketest.ts` (6 cases, 20 assertions). `npm run smoke:agent-context-compression` wired into `smoke:all`.
- **Contract shipped.** `compressContextIfOversized(messages, opts)` returns `{ compressed, messages, summary?, droppedCount, tokensBefore, tokensAfter }` with `opts = { thresholdRatio, maxContextTokens, preserveLast, summariser, countTokens? }`. Defaults: 0.50 threshold, 200K max context, preserve last 20. Summariser is injected (caller wires Haiku).
- **Safety properties.** Tail is always preserved verbatim. `tool_use` / `tool_result` pairs are never split (walks cut-index back to keep pairs together). Summariser throw → bails with original messages (never corrupts context). History shorter than `preserveLast + 4` → no-op.
- **Still to do.** Wire into `agentExecutionCore.ts` pre-turn so every `runAgent(...)` call gets it for free. That's the actual integration — the library is pure so the wiring is a 5-line edit once we pick the exact hook point (likely `runAgent` before the provider.turn loop). Deliberately left as a separate merge so the pure library can ship and be re-used by `openswanSessionRuntime` / `swanbot-v2-ai` independently.

### CA-8b · Memory bounded-char caps with self-consolidate envelope · **task #76 · SHIPPED 2026-04-22**

- **Problem.** `user_memory` can grow unbounded; no back-pressure to the agent. Hermes caps at 2,200 + 1,375 chars and returns an error the agent can act on.
- **Files shipped.** New pure `src/lib/userMemoryCaps.ts` (no Supabase import so smoke tests work offline) with `USER_MEMORY_SOFT_CAP` (2,200), `USER_MEMORY_HARD_CAP` (2,500), `USER_MEMORY_CAP_ERROR` ('memory_cap_exceeded'), `checkUserMemoryCap()`, `describeUserMemoryUsage()`. `src/lib/userMemory.ts` re-exports these and wires them into `appendUserMemory` + `replaceUserMemory`. Smoke: `scripts/user-memory-caps-smoketest.ts` — 6 cases / 23 assertions green.
- **Contract shipped.** Writers return `{ ok:false, error:'memory_cap_exceeded', suggestion:'consolidate', currentChars, capChars, wouldBeChars }` when the proposed content would exceed HARD_CAP. When ok, returns `{ ok:true, currentChars, capChars }` — backward-compatible for all existing `if (!result.ok)` callers. Separator-aware (the cap math matches what `appendUserMemory` actually writes).
- **Safety properties.** Whitespace-trimmed. `replaceUserMemory` also enforces the cap so the agent can't "consolidate past" the ceiling with a single overlong rewrite. Shared `circle_memory` compaction regime (4K-token / HITL) is deliberately unchanged — two regimes, two policies, per conflict-resolution §5 of this plan.
- **Still to do.** Wire `describeUserMemoryUsage()` into the system prompt's memory block so the agent sees the cap status and can self-consolidate proactively (requires a ChatTab + swanbot-ai prompt-assembly touch). Deliberately left as a follow-up merge — the pure cap layer ships first so the tool-side and agent-side work can land independently.

### CA-8c · Skill sub-file support · **task #77 · SHIPPED 2026-04-22**

- **Problem.** A Claude Code skill with `references/` + `templates/` + `scripts/` flattens into one blob when imported. Hermes ships 3-level retrieval: list → full → sub-file.
- **Schema shipped.** `circle_skill_files` — `(id, skill_id→circle_skills, relpath, content, is_primary, mime_type, size_bytes, created_by, created_at, updated_at)` with composite unique `(skill_id, relpath)` + two indexes + RLS mirroring `circle_skills` (JOIN `circle_members` on the parent skill's `circle_id`) + updated_at trigger. Migration: `supabase/migrations/20260507_circle_skill_files.sql`, mirrored into `docs/RUN_THIS_SQL.sql` §15.
- **Read helpers shipped.** `src/lib/skillLibrary.ts` gained `listLibrarySkillFiles(circleId, name)` (manifest, no body) + `viewLibrarySkillFile(circleId, name, relpath)` (body). Both no-op on missing parent / RLS miss (never throw — matches the rest of the module's error posture).
- **Pure path validator shipped.** `src/lib/skillRelPath.ts` with `parseSkillRelPath` + `isSafeSkillRelPath`. Rejects absolute paths, `..` traversal, Windows drive letters, control chars, dotfiles, dir-refs, and > 200 chars. Normalises `\\` → `/`, `./` prefix stripped, `//` runs collapsed. Re-exported from `skillLibrary.ts` so tool-layer and importer share one rule. Smoke: `scripts/skill-relpath-smoketest.ts` — 29 cases green (9 accepts × 14 rejects + aliases + non-string inputs).
- **Primary body stays on `circle_skills.content`** for backward-compat with existing read paths and `skillPromptInjection.ts`. The new table holds sub-files only; the filter-to-primary concern from the plan is a no-op today (and remains so as long as the primary body stays on the parent row).
- **Still to do (CA-8i, task #83).** Extend `skillLibraryImport.ts` to split multi-file GitHub skill folders into `circle_skill_files` rows at import time; add `skill_manage` tool actions `write_file` / `remove_file` that file HITL approvals carrying the full relpath + diff. Read-side CA-8c is sufficient for agents that fetch already-populated sub-files.

### CA-8d · Subagent summary-only return + depth/concurrency gate · **task #78 · SHIPPED 2026-04-23 (gate library)**

- **Problem.** `subagentRegistry.ts` hands parent the child's full transcript today. Hermes contract: parent sees only summary; children have isolated context. Recursion + fan-out also have no hard caps today → cost blowout risk.
- **Files shipped.** `src/lib/delegationGate.ts` + `scripts/delegation-gate-smoketest.ts`. Pure library — no runtime wiring yet (that's the subagentRegistry → agentExecutionCore swap, still task #32).
- **Contract shipped.** `canDelegate({ proposedDepth, inFlight })` returns `{ ok, reason, detail, remainingSlots }` where `reason ∈ {ok, depth_exceeded, concurrency_exceeded, invalid_input}`. Caps: depth ≤ 2 (root→child→grandchild), concurrency ≤ 3 per circle. Finite-number checks (NaN/Infinity rejected). `redactSubagentOutput(transcript)` produces `SubagentSummaryPayload` — explicit summary > finalText > placeholder, capped at 1200 chars, ellipsis on truncation, usage carried. `serializeSubagentSummaryForParent(payload)` emits the tool_result shape parent model expects. 43 smoke assertions across all cap boundaries + usage + truncation + missing-field edge cases.
- **Still open.** Actually wiring the gate into a real subagent spawner (blocked on task #32: subagentRegistry swap to agentExecutionCore). `parent_run_id` column already exists on `agent_runs` per 20260408 migration — no schema change needed. Existing task #32 is the follow-up that closes the full CA-8d scope.

### CA-8e · `clarify` / `ask_user` timeout · **task #79 · SHIPPED 2026-04-23**

- **Problem.** `ask_user` blocks indefinitely today. Agent hangs when user wanders off.
- **Files.** `src/lib/clarifyTimeout.ts` + `scripts/clarify-timeout-smoketest.ts`.
- **Contract shipped.** `planClarifyTimeout({ createdAt, timeoutMs, now })` returns `{ expiresAtMs, msUntilExpiry, expired, urgent, elapsedFraction }` as a pure computation (client renders countdown, edge fn decides auto-resolve). Default 120_000ms; clamped to [15_000, 3_600_000]. `autoResolveOnTimeout(id, { supabase, defaultChoice })` updates the row with `choice: '__timeout__'` only when `resolved_at IS NULL` so user-won races return `{ ok: true, alreadyResolved: true }`. `formatCountdown(ms)` renders "1m 30s" / "59s" / "auto-continuing…". 41 smoke assertions. UI wiring (HitlApprovalBanner countdown) is the next follow-up — banner can consume `planClarifyTimeout` directly.
- **Effort.** S. **SQL:** none.

### CA-8f · Provider fallback chain · **task #80 · SHIPPED 2026-04-23**

- **Problem.** Single-provider (Anthropic direct). Outage = downtime.
- **Files.** `src/lib/agentProviders/fallbackChain.ts` + `scripts/fallback-chain-smoketest.ts`.
- **Contract.** `createFallbackProvider({ providers, onFallback })` returns an `AgentProvider` indistinguishable to `AgentExecutionCore`. Classifies 429/529/5xx/408/timeout/network errors as retryable → advance to next provider; 400/401/403/404/422 bubble immediately. Observer fires once per chain advance with `{ attempted, nextLabel, error, errorMessage, statusCode }`. 55+ assertions pin the classifier + routing + observer semantics.
- **Effort.** M. **SQL:** none.

### CA-8g · Trace export + evals scaffolding · **task #81 · SHIPPED 2026-04-23**

- **Problem.** DSPy/GEPA needs trace JSONL + golden eval cases. We have neither exported yet.
- **Files.** New `scripts/export-traces.ts` → `docs/traces/<date>.jsonl`. New `docs/evals/` seeded with 10 golden cases in the same shape `openswanBenchmarks.ts` already uses. New 1-page `docs/EVOLVABLE_SURFACES.md` naming exactly which surfaces the optimizer may touch (skill bodies, tool descriptions, prompt components) — and that `.ts` files are out of bounds.
- **Effort.** M. **SQL:** none.
- **Note.** This is **preparation only**. Actual optimizer stays out of scope until `≥50 skills + ≥1K persisted runs` gate (`AGENT_RUNTIME_INTEGRATION_PLAN.md` Phase 5).

### CA-8h · Context file priority + per-turn discovery append · **task #82 · SHIPPED 2026-04-23**

- **Problem.** Hermes picks exactly one project context file by priority. We used to scan `.hermes.md` / `HERMES.md` / `AGENTS.md` / `AGENT.md` / `CLAUDE.md` / `.cursorrules` but the order was Hermes-first, and the priority list wasn't a pure exported helper.
- **Files shipped.** `src/lib/openswanContextDiscovery.ts` (exported `CONTEXT_FILE_PRIORITY` const + `resolveContextFilePriority` pure helper) + `scripts/context-file-priority-smoketest.ts`.
- **Contract.** UC priority order now `.openswan.md` → `AGENTS.md` → `AGENT.md` → `CLAUDE.md` → `.cursorrules` → `.hermes.md` → `HERMES.md`. First match wins per directory. `resolveContextFilePriority(available)` returns null when nothing matches — callers use it to pick exactly one file without duplicating the comparator. 30 smoke assertions pin the order + the resolver across empty / single / multi / unrelated-entries cases. Per-turn discovered paths already ride on tool results (not the system prompt) via the existing discovered-context block design, so the cache block stays cache-hot.

### CA-8i · `skill_manage` sub-file actions · **task #83 · SHIPPED 2026-04-23**

- **Problem.** Sub-file writes (`references/api.md`, etc.) had no tool action — agents could only touch the primary SKILL.md body, not the supporting files CA-8c made addressable.
- **Files shipped.** `src/lib/agentTools/manageLibrarySkill.ts` (added `write_file` / `remove_file` actions; that module was later consolidated into the `skills.manage` tool in `src/lib/openswanToolRuntime.ts` — the actions live there now) + `src/lib/skillLibraryWrite.ts` (applies the approved mutations to `circle_skill_files`) + `scripts/skill-subfile-smoketest.ts`.
- **Contract.** Both actions require a safe `relpath` (no leading slash, no `..` segments, no null bytes, no Windows drive prefix, ≤200 chars, must contain at least one alphanumeric). `write_file` also requires non-empty `content`; MIME inferred from extension (.md→text/markdown, .json→application/json, .yml/.yaml, .sh, .ts/.tsx, .js/.jsx, else text/plain). Both file an `agent_approvals` row with `action_type: skill.write_file` / `skill.remove_file`; `applyApprovedSkillAction` re-verifies the parent skill still exists (guards against delete-between-propose-and-approve races), then upserts on `(skill_id, relpath)` or deletes by the same key. 40+ smoke assertions on the safe-relpath rejection matrix + MIME inference.

### CA-8j · Session lineage columns · **task #84 · SHIPPED 2026-04-23**

- **Problem.** When a chat thread gets compressed / split we lost the parent-pointer. Run Ledger couldn't trace long-running tasks across forks.
- **Files shipped.** `supabase/migrations/20260508_chat_threads_lineage.sql` (targets `circle_chat_threads`, not the plan's original `room_messages` — that's the real table for UC chat threads), `src/lib/chatThreadLineage.ts` (pure read-side helpers), `scripts/chat-thread-lineage-smoketest.ts`, `docs/RUN_THIS_SQL.sql` updated with the CA-8j block.
- **Schema.** `parent_thread_id uuid REFERENCES circle_chat_threads(id) ON DELETE SET NULL` + `lineage_root_id uuid` + partial indexes on both (WHERE NOT NULL — roots don't need the index rows) + `CHECK (parent_thread_id IS NULL OR parent_thread_id <> id)` self-reference guard.
- **Helpers shipped.** `resolveLineageRoot(parent)` — pure: child inherits parent's root, or becomes `parent.id` on first fork, or null when no parent. `walkLineageAncestors(startId, fetchRow, maxSteps=20)` — walks parent chain with cycle guard + 20-step cap. `orderByLineage(rows)` — BFS from root candidate with most descendants; orphans/cycles preserved (never drops rows). 29 smoke assertions.

---

## Conflicts resolved (locked)

From [archive/AGENT_RUNTIME_DELTA_PLAN_2026-04-22.md §5](./archive/AGENT_RUNTIME_DELTA_PLAN_2026-04-22.md#part-5--conflicts-with-existing-plans). Agents MUST follow these rulings.

1. **Two memory regimes.** Shared `circle_memory` keeps HITL compaction at 4K-token threshold. Per-user `user_memory` adopts Hermes caps (2,200 / 1,375 chars) and agent-self-consolidate error envelope.
2. **Subagent visibility is split.** Chat transcript → summary only (Hermes contract). Run Ledger → full child event tree (operator debugging).
3. **Evolvable surfaces are capped.** Skill bodies + tool descriptions + prompt components only. Never `.ts`/`.tsx`/`.sql` source.
4. **Context file priority.** `.openswan.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`. First match wins. Don't merge them.
5. **In-runtime evals stay ours.** `openswanBenchmarks.ts` / `openswanEvals.ts` / `openswanObservedEvals.ts` are ahead of the hermes-agent runtime. Don't re-pitch a "hermes eval" CLI.

---

## Definition of done for Phase CA-8

- All 10 sub-phases shipped OR explicitly deferred with a reason.
- Smoke tests added for each sub-phase that has pure logic (context compression, delegation gate, memory caps, fallback chain). Hooked into `npm run smoke:all`.
- `AGENTS_ROADMAP.md` Phase CA table updated with shipped dates.
- This plan doc updated with status checkmarks and shipped-date stamps.
- `RUN_THIS_SQL.sql` updated with CA-8c + CA-8j migrations.
- Codex + Gemini can work on any sub-phase without reading an extra doc — this one + the delta plan is enough.
