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

- **P1 — Precise file editor (str_replace/multi-edit).** ✅ DONE (pure core):
  `src/lib/fileEditCore.ts` + smoke `file-edit-core` (41). Exact-match +
  uniqueness enforcement (non-unique fails closed) + sequential multi-edit +
  create + unified diff; literal replacement (no `$`/regex reinterpretation).
  NEXT: wire `desktop.edit_file` bridge tool (read → applyFileEdits → show diff for
  approval → write via file_write_text) + tool-catalog registration + LOCKSTEP
  bridge handler.
- **P2 — Shell/bash tool.** Bridge `execFile`-based (argv array, no shell string;
  timeout; output tail-cap; cwd within grant). Pure command-shaping/validation
  core + smoke first, then the gated bridge endpoint. Approval: `ask` for mutating
  commands. Unlocks test/build/git-via-shell/run-and-fix loops.
- **P3 — Git tools.** `git diff/status/log/show/blame` (auto) + `add/commit/branch`
  (ask), via the bridge (execFile "git"). Pairs with P2.
- **P4 — Codebase index + semantic search + `@file` mentions.** File-tree crawl +
  docstring/symbol embeddings (reuse `memoryEmbeddings`), a `codebase.search` tool,
  `@file:`/`@symbol:` resolution, and a per-turn project-conventions loader
  (CLAUDE.md/.cursorrules). Biggest context-quality lift.
- **P5 — Operationalize plan/execute model split for coding.** Route complex
  coding through `planModelCollaboration()`: strong planner turn → fast executor
  tool loop. Add a coding-capability tier to `modelCapabilities.ts`. Optional
  auto best-of-N for complex coding when ≥2 providers connected.
- **P6 — Loop upgrades.** Agent-maintained live TODO (a `tasks.*` tool family the
  model updates mid-run) + deterministic tool-result summarization for large
  outputs + a run-and-fix verification gate (auto-run tests, feed failures back).

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
