# Coding-Agent Upgrade Plan — chat / SwanBot / OpenSwan → Claude Code / Cursor / Composer class

> Goal: make the in-app agent a top-tier CODING agent (and stronger general
> agent) — the class of Claude Code, Cursor, and Cursor's Composer harness.
> Grounded in a 5-agent read-only exploration of the current codebase (2026-07-13).

## 1. Where we stand (honest baseline)

The **agentic loop is already strong** — this is not a from-scratch build.
`src/lib/agentExecutionCore.ts` runs a typed model→tool→result→continuation loop
with nine documented reliability layers (see
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`): parallel tool dispatch (≤4),
stuck-detection + one-shot solver consultation, context compression, live-image
pruning, resume checkpoints, approval + constraint gates, steering, prompt
caching. The v2 edge loop (`swanbot-v2-ai`) mirrors it with a client-tool
continuation protocol.

The gaps are NOT in the loop — they are in the **coding primitives, codebase
awareness, and model-split operationalization**.

## 2. Gap analysis (what a top-tier coding agent has that we lack)

### 2a. Coding tool primitives — 🔴 the defining gap
Current coding-relevant tools (via the desktop bridge): `desktop.file_read`,
`file_write_text` (whole-file blob only), `file_list`, `file_stat`,
`file_search` (basic grep), `file_rename/copy/trash/mkdir`; `github.read_file`
(read-only); `verification.typecheck/tests/lint` (invoke, no streamed output);
`code.inspect`/`code.review` (planning stubs). **Missing:**
- **No shell / bash tool** — cannot run `npm`/`git`/`pytest`/arbitrary CLI. CRITICAL.
- **No precise `str_replace` / apply-patch editor** — must read a whole file, diff
  in-context, and rewrite it wholesale. Token-heavy + error-prone. CRITICAL.
- **No git tools** — no diff/status/add/commit/log/blame.
- No ripgrep / AST / symbol search; no test-output capture/streaming.

### 2b. Codebase understanding — 🔴 blind to a repo
No repo indexing, no codebase embeddings/semantic search, no `@file` mentions, no
auto relevant-file retrieval, no project-convention loader (CLAUDE.md/.cursorrules
exist but are **not** injected per coding turn). The agent only sees code the user
pastes/attaches or names via a GitHub path. Prompt assembly
(`chatPromptAssembly.ts`, `agentPromptBuilder.ts`) injects app/team memory + skills
— never codebase structure. The only semantic layer (`memoryEmbeddings.ts`) embeds
circle memories, not code.

### 2c. Planning + model split — 🟡 architectural, not operationalized
`agentPlanMode.ts` (opt-in `/plan`) and `modelCollaborationPolicy.ts` exist, and
the planner/executor (strong-plans / fast-executes) split is **live for
computer-use** (BlackSwan plans, Sonnet/Haiku drives the screen loop) — but **not
for general coding** (the same model plans and executes). No agent-maintained live
TODO during a run (`task_run_steps` is post-hoc logging, not an
agent-callable/mutable task queue). Checkpoints exist (`chatCheckpoints.ts`) but
aren't enforced with a restore-UI for file/code mutations.

### 2d. Model routing — 🟡 Composer-shaped only for computer-use
`serviceProfileSouls.ts` picks a single model per coding intent (→ Sonnet floor).
BlackSwan-v5 is app-grounding only (never calls tools; `claude-haiku-4-5` =
`BLACKSWAN_TOOL_EXECUTOR_MODEL_ID`). `modelCapabilities.ts` has no explicit
coding-capability tier (a reasoning-only model can route to a coding intent).
Best-of-N race exists but is opt-in `/best-of-n` only.

## 3. Phased roadmap (prioritized by leverage × foundational-ness)

Primitives first — verification/plan/routing all build on them. Each pure core is
built + smoke-tested BEFORE wiring to the bridge/tool-catalog (the house pattern),
and every mutating tool stays approval-gated.

- **P1 — Precise file editor (str_replace/multi-edit).** ✅ DONE + WIRED:
  `src/lib/fileEditCore.ts` + smoke `file-edit-core` (41); wired as the
  **`desktop.edit_file`** tool in `openswanToolRuntime.ts` (reads the file via the
  bridge → `applyFileEdits` → writes via `file_write_text`, returns a fenced diff;
  `ask`-gated, `desktop_files` write family, refuses a truncated read, create via
  empty-oldString). No LOCKSTEP bridge mirror needed — it orchestrates the existing
  `file_read`/`file_write_text` endpoints with the pure core in between.
- **P2 — Shell/bash tool.** ✅ DONE + WIRED (2026-07-13). Pure cores:
  `src/lib/shellCommandPolicy.ts` (smoke `shell-command-policy`, 99 —
  classifyShellCommand → read(auto) / mutate(ask) / blocked(never), compound/
  redirection/`$(…)` escalation, catastrophic patterns refused, timeout clamp,
  secret-redacted preview) + `src/lib/localExecPlanCore.ts` (smoke
  `local-exec-plan-core`, 49 — argv validation/bounds, policy composition,
  tail-biased result formatter). Wiring: bridge `POST /desktop/exec_file`
  (execFile ARGV — never a shell; write-scoped grant on cwd, argv bounds,
  hard binary blocklist, 4MB buffer + 64KB tail-cap, non-zero exit = data
  not error) + `desktopBridge.execFileOnBridge` + the **`local.run_shell`**
  tool (pinned; static policy floor 'ask', args-aware fast path in
  `maybeRequestToolApproval` auto-passes read-classified commands and refuses
  blocked ones via the SAME core the executor re-runs). Run-and-fix gate is
  exec-aware: `classifyExecCallForGate` in `runAndFixGateCore.ts` counts a
  test/build/lint run through the shell as verification (round-hook now
  forwards tool `input`; smoke `run-and-fix-gate-core` 96). LIVE-BRIDGE pass
  pending: restart `npm run bridge` to pick up the endpoint, then exercise
  read/mutate/blocked + timeout paths end-to-end. Edge parity: CODE-SIDE DONE
  2026-07-14 — v2 catalog carries all 6 coding client tools (see below);
  awaiting `supabase functions deploy swanbot-v2-ai`.
- **P3 — Git tools.** ✅ DONE + WIRED (2026-07-13). Pure core:
  `src/lib/gitCommandPolicy.ts` + smoke `git-command-policy` (185) — read
  verbs→auto, write→ask, force-push / `reset --hard` / `-c` config-injection /
  `--upload-pack` blocked, commit message is its own argv element. Wiring:
  same `exec_file` bridge endpoint + `localExecPlanCore.planGitRunExec`
  (prepends the git binary) + the **`git.run`** tool (pinned; read auto /
  write ask via the same args-aware gate path; repoPath must sit inside the
  write-scoped grant). Gate awareness: only WORKTREE-changing verbs
  (checkout/stash/reset/…) re-dirty the run-and-fix state — commit after a
  green run stays clean. Same live-bridge + edge-parity follow-ups as P2.
- **v2 chat-path parity (2026-07-14).** The default chat loop (`swanbot-v2-ai`)
  now advertises all six coding client tools — `desktop.edit_file`,
  `local.run_shell`, `git.run`, `codebase.search`, `todo.write`,
  `coordination.file_status` — as a `clientOnly` group (new `coding`
  TOOL_GROUP; selected in build/design modes + coding-keyword turns). The
  client routes them through `dispatchCodingClientTool` in `swanbot.ts` →
  `executeOpenSwanRuntimeTool`, so the constraint floor, args-aware shell/git
  approval, and file leases apply identically to the typed loop; long output
  survives the client-tool serializer's 2k-per-string clip as chunked
  `parts[]` (head+tail preserved). Parity nets updated: dispatcher-parity
  parser recognizes the new prefixes, readiness pins re-set to 79 total / 54
  client-delegated (docs re-pinned). PENDING: `supabase functions deploy
  swanbot-v2-ai` to make it live. That same deploy also ships the pre-turn
  context compaction mirror (2026-07-21: `_shared/context-compaction.ts`
  wired into `runLoop`, `context_compaction_tier` run events; lockstep smoke
  `scripts/edge-context-compaction-smoketest.ts`) — inert until deployed.
- **P4 — Codebase index + semantic search + `@file` mentions.** ✅ DONE + WIRED
  (2026-07-13). Pure cores: `src/lib/codebaseIndexCore.ts` (smoke
  `codebase-index-core`, 78), `src/lib/codebaseSymbolCore.ts` (symbol/summary
  extraction + embed-text builder; smoke `codebase-symbol-core`, 81),
  `src/lib/codebaseMentionsCore.ts` (`@file:`/`@symbol:` parser + resolver;
  smoke `codebase-mentions-core`, 107). Wiring:
  `src/lib/codebaseIndexRuntime.ts` (bridge BFS crawl → plan → extract → embed
  via `memoryEmbeddings.embedTexts` → owner-scoped `codebase_files` upsert +
  stale sweep; semantic search via `match_codebase_files` RPC re-ranked
  lexically, lexical fallback; active-root registry; mention context block
  with untrusted-fenced file heads). SQL: `20260713_codebase_files.sql`
  (mirrored as RUN_THIS_SQL §24 — **pending apply**). Tools: `codebase.index`
  (`ask` — reads local files + sends derived text to the embedding provider)
  and `codebase.search` (`auto`, pinned). Prompt: `codebase_mentions` +
  `project_conventions` sections in `chatPromptAssembly.ts`, pushed from
  `buildSystemPromptAsync`; `src/lib/projectConventions.ts` loads the active
  repo's CLAUDE.md/AGENTS.md/.cursorrules via the desktop bridge each coding
  turn (TTL-cached; `openswanContextDiscovery` filename priority reused). NO
  raw file content is persisted server-side — only paths/symbols/summaries.
- **P5 — Operationalize plan/execute model split for coding.** ✅ DONE + WIRED
  (2026-07-13). Coding-capability tier added to `modelCapabilities.ts`
  (`ModelCodingTier` = none/basic/strong on `ModelCapabilityFlags`;
  `getModelCodingTier`; smoke `model-capabilities` case 13 — frontier coders
  strong, fast executors basic, fail-closed none). Pure decider
  `src/lib/codingModelSplitPolicy.ts` (smoke `coding-model-split-policy`, 192):
  `decideCodingModelSplit` gates a complex build/debug/review turn on a strong,
  non-user-pinned model into `plan_then_execute` (strong planner → Haiku/Sonnet
  fast executor, mirroring the live computer-use split), fail-closed to single;
  `buildCodingPlannerPrompt` / `buildCodingPlanHandoffNote`; `decideAutoBestOfN`
  (complex coding + text-only + ≥2 providers). Wired into the typed loop
  (`openswanSessionRuntime.runTypedCoreToolLoop` `codingPlanSplit` param: one
  text-only planner turn → handoff note ahead of the executor loop, executor
  drives tools; flag `uc_coding_plan_split` DEFAULT ON, fail-soft). Auto
  best-of-N wired into the chat send path (`ChatTab`, flag `uc_auto_best_of_n`
  DEFAULT OFF, cheap sync short-circuit).
- **P6 — Loop upgrades.** ✅ DONE + WIRED (2026-07-13), three parts:
  1. **Live TODO** — `todo.write` tool (NOT `tasks.*`: that namespace is the
     circle kanban; the live TODO is ephemeral run scaffolding). Pure core
     `src/lib/agentTodoCore.ts` (full-replacement TodoWrite semantics, single
     in_progress, caps; smoke `agent-todo-core`, 76) + run-scoped store
     `src/lib/agentTodoStore.ts` (keyed runId → userId+threadId, LRU-capped,
     in-memory only). Pinned, `auto`, mode-agnostic.
  2. **Deterministic tool-result summarization** — pure core
     `src/lib/toolResultSummaryCore.ts` (head + tail + error-signal lines from
     the omitted middle, >20k chars; smoke `tool-result-summary-core`, 108),
     wired into `agentExecutionCore.dispatchOne` success AND failure envelopes
     (`toolResultSummarization` option, default ON; sub-threshold results stay
     byte-identical). Edge parity note: `swanbot-continuation.ts` keeps its own
     16k hard cap for client-returned results — swapping it for this core is a
     follow-up when the edge fns next redeploy.
  3. **Run-and-fix verification gate** — pure core
     `src/lib/runAndFixGateCore.ts` (dirty-tracking fold over each round's
     calls; nudges 'verification_failed' same-round or 'dirty_unverified'
     after a round passes with unverified edits; ≤2 nudges/run; smoke
     `run-and-fix-gate-core`, 85), composed with the legacy round-nudge hook
     in `openswanSessionRuntime.ts` (legacy reliability nudges keep priority).

## 4. Guardrails carried through every phase
Mutating tools (edit/write/shell/git-write) stay approval-gated with a visible
diff/preview; execFile-array (never a shell string) for shell/git; path grants
enforced by the bridge; secrets never in prompts/logs; pure cores are
smoke-tested before wiring; `verifiedInvocation`-style gating where a live host is
required. Nothing here weakens the existing approval floor.

## 5. Provenance
Baseline from a 5-agent exploration (loop / tool catalog / planning+delegation /
codebase-context / model-routing) on 2026-07-13; findings + file:line cites in the
initiative task. Related: `docs/AGENT_APP_AUTOMATION_IMPLEMENTATION_PLAN.md`
(app-automation, same pure-core-then-wire discipline).
