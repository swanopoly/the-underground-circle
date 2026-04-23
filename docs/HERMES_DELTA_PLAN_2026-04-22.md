# Hermes Agent — Delta Plan for Underground Circle

_Research date: 2026-04-22. Supersedes the "what's missing" section of `HERMES_INTEGRATION_PLAN.md` (2026-04-21) as of today. The phased adoption plan in that doc is still the source of truth for shipped phases._

Sources checked: `hermes-agent.nousresearch.com/docs/` landing, `getting-started/quickstart`, `user-guide/configuration`, `user-guide/features/overview`, `user-guide/features/tools`, `user-guide/features/skills`, `user-guide/features/memory`, `user-guide/features/context-files`, `developer-guide/architecture`, `developer-guide/contributing`, `reference/cli-commands`, `guides/tips`, `github.com/NousResearch/hermes-agent` README + tree, `github.com/NousResearch/hermes-agent-self-evolution` README + PLAN.md (via web search summary). Also re-read UC docs: `AGENTS_ROADMAP.md` §2 file-ownership table + Phase 1/1c/1d status; `HERMES_INTEGRATION_PLAN.md` phase status; `OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md` §§1-8; `CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md` Phases CA-1..CA-7; `CLINE_RESEARCH_AND_MAPPING_2026-04-22.md` for shape precedent.

---

## Part 1 — What Hermes actually is

Hermes Agent is NousResearch's open-source (MIT) autonomous AI agent built as a Python CLI (`hermes`) with an SQLite-backed session store and a ~10,700-line `AIAgent` orchestrator in `run_agent.py`. The runtime is provider-agnostic — users point it at Anthropic, OpenAI, OpenRouter, Nous Portal, or local Ollama — and the conversation loop normalizes three API modes (OpenAI chat completions, Codex responses, Anthropic Messages) through `anthropic_adapter.py`. It runs as a classic CLI (`hermes`), a TUI (`hermes --tui`), or a gateway that hosts sessions for Telegram / Discord / Signal / WhatsApp / Email. Everything on disk lives under `~/.hermes/` — `config.yaml` (non-secret), `.env` (secrets), `skills/`, `memories/MEMORY.md` + `memories/USER.md`, `sessions/`, `cron/`, `SOUL.md`, `logs/`.

Mechanically it does six things UC cares about: (1) a typed tool loop where tools self-register into a central registry (`tools/registry.py`) and the model drives them via function-calling-style dispatch, with cancellation at any step; (2) a three-level skill progressive-disclosure flow — `skills_list()` metadata (~3K tokens) → `skill_view(name)` full body → `skill_view(name, path)` sub-file — where skills are also auto-exposed as `/slash-name` commands; (3) two bounded memory files (MEMORY.md 2,200 chars, USER.md 1,375 chars) injected as a frozen system-prompt block per session and written via a three-action `memory` tool (`add` / `replace` / `remove`) with substring matching; (4) `delegate_task` that spawns up to 3 concurrent subagent children with isolated context, narrow toolsets, and their own terminal sessions; (5) `execute_code` that lets the agent write Python that calls other Hermes tools via sandboxed RPC; (6) auto-discovered project context files (`.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`, first match wins; `SOUL.md` always loaded independently) rendered into a `# Project Context` header with 20K-char cap and 70%-head/20%-tail truncation.

The "self-improving" tagline is a separate repo — `NousResearch/hermes-agent-self-evolution` (ICLR 2026 Oral, MIT) — that runs DSPy + GEPA (Genetic-Pareto Prompt Evolution) offline against hermes-agent. It is **not** part of the hermes-agent runtime. It reads execution traces, generates evaluation datasets, mutates skill text / tool descriptions / the 5 "evolvable" prompt sections, and opens PRs against hermes-agent with the best variants. No GPU training; costs ~$2-10 per optimization run because everything is API-call-driven text mutation. Benchmarks show +6% average (and +20% on some tasks) over GRPO using 35× fewer rollouts, and +12% over MIPROv2 on AIME-2025.

---

## Part 2 — The 8 mechanisms

### 2.1 Runtime / tool loop
- Core orchestrator is `AIAgent.run_conversation()` in `run_agent.py`; pipeline is `HermesCLI.process_input()` → `prompt_builder.build_system_prompt()` → `runtime_provider.resolve_runtime_provider()` → API call (chat_completions / codex_responses / anthropic_messages) → tool dispatch → loop → persist to `SessionDB`.
- Tools self-register into `tools/registry.py` via import; `model_tools.py` handles "Tool discovery, schema collection, dispatch, availability checking, and error wrapping." Registry is code-derived — schemas travel with the tool file.
- API format is normalized under the hood — the same tool loop works against OpenAI chat-completion function-calling, the Codex Responses API, and Anthropic Messages `tool_use`/`tool_result` blocks. `anthropic_adapter.py` does the translation so tool authors don't see the difference.
- Turn cap is `agent.max_turns: 90` by default, tunable in `config.yaml`. "API calls and tool execution can be cancelled mid-flight by user input or signals" — signal-level interrupt, not just UI stop.
- Tool output re-enters the loop as the next model turn with the tool result attached; loop exits when the model emits a final assistant message with no tool calls.
- Reasoning effort is a per-agent knob — `agent.reasoning_effort: none | minimal | low | medium | high | xhigh` — so the same loop runs in fast or deliberate modes without changing the client.

### 2.2 Skill library (SKILL.md)
- Primary directory: `~/.hermes/skills/` with layout `~/.hermes/skills/<category>/<skill-name>/SKILL.md` plus optional `references/`, `templates/`, `scripts/`, `assets/` sibling dirs. External dirs added via `skills.external_dirs` in `config.yaml`.
- Frontmatter fields (quoted verbatim from the docs): `name`, `description`, `version`, optional `platforms: [macos, linux, windows]`, `metadata.hermes.tags`, `metadata.hermes.category`, `metadata.hermes.fallback_for_toolsets` (hide when those tools are active), `metadata.hermes.requires_toolsets` (show only when those tools are active), `metadata.hermes.config` (declarable settings written into `config.yaml` under `skills.config.<name>`), `required_environment_variables` (secure prompting on load).
- Retrieval is **progressive disclosure in 3 levels**: `skills_list()` returns `[{name, description, category}, …]` (~3K tokens), `skill_view(name)` returns full content + metadata, `skill_view(name, path)` returns a specific file within the skill's directory (a reference/template/script).
- Every skill also auto-registers as a `/skill-name` slash command. The docs pair natural-conversation retrieval with explicit invocation.
- Skill writes go through a single `skill_manage` tool with actions `create | patch | edit | delete | write_file | remove_file`. `patch` is preferred ("targeted fixes") over `edit` ("major rewrites") for efficiency.
- `hermes skills` subcommands: `browse, search, install, inspect, list, check, update, audit, uninstall, publish, snapshot, tap, config`. `audit` + `publish` + `snapshot` imply there is an ecosystem around sharing / versioning skills via `agentskills.io`.

### 2.3 Memory scopes
- Two files, capped and named: `~/.hermes/memories/MEMORY.md` (2,200 chars / ~800 tokens, agent's own notes) and `~/.hermes/memories/USER.md` (1,375 chars / ~500 tokens, user profile). Both "injected into the system prompt as a frozen snapshot at session start."
- Writes via a single `memory` tool with actions `add` / `replace` (substring match via `old_text`) / `remove`. "When the agent adds/removes memory entries during a session, the changes are persisted to disk immediately but won't appear in the system prompt until the next session starts" — so writes are immediate-to-disk, effectively-next-session-to-prompt.
- Separate retrieval layer is `session_search` — FTS5 full-text search over `~/.hermes/state.db` returning "relevant past conversations with Gemini Flash summarization" for long-tail / out-of-window lookups.
- Capacity is bounded: hitting the limit returns an error that tells the model to consolidate. Best-practice cue is "above 80% capacity."
- No explicit declarative/episodic/procedural taxonomy; the split is by target scope: `memory` (environment facts, conventions, tool quirks, task diaries) vs `user` (preferences, communication style, workflow habits).
- Memory entries get a security scan for "injection and exfiltration patterns before being accepted, since they're injected into the system prompt."
- Optional external providers (Honcho, Mem0) configured via `hermes memory` and pluggable via the `memory_provider` plugin type.

### 2.4 Self-evolution (DSPy + GEPA — sibling repo, not runtime)
- Lives in a separate MIT repo: `github.com/NousResearch/hermes-agent-self-evolution`. Run via `pip install -e ".[dev]"` + `HERMES_AGENT=/path/to/hermes-agent` env var. Not shipped as part of the hermes-agent runtime.
- No GPU training. "Everything operates via API calls — mutating text, evaluating results, and selecting the best variants. ~$2-10 per optimization run."
- Pipeline: read current skill/prompt/tool → generate eval dataset → run GEPA optimizer with execution traces → produce candidate variants → evaluate against constraint gates (tests + size limits + benchmarks) → open a PR against hermes-agent with the winner.
- GEPA = natural-language reflection over full execution traces ("if a task took 47 tool calls when 12 would suffice, GEPA identifies that inefficiency") + genetic prompt evolution via DSPy + Pareto selection that maintains diverse strategies to avoid local optima.
- Evolvable surfaces are narrow: **(a) skills**, **(b) tool descriptions**, **(c) five specific system-prompt sections** (section-as-DSPy-parameter wrapper), and **(d) code files** via a "Darwinian Evolver" that mutates source as text.
- Benchmarks: +6% avg and +20% peak over GRPO with 35× fewer rollouts; +12% over MIPROv2 on AIME-2025.

### 2.5 Subagent delegation
- Primitive is the `delegate_task` tool. "Spawns child agent instances with isolated context, restricted toolsets, and their own terminal sessions" — the child does NOT inherit the parent's full context; only the task brief goes in, only the child's final summary comes back out.
- Config is terse: `delegation.model`, `delegation.provider`, `delegation.base_url`, `delegation.api_key` (all inherit parent if empty), `delegation.max_concurrent_children: 3`, `delegation.max_spawn_depth: 1` (clamped 1–3), `delegation.orchestrator_enabled: true`.
- Parent cannot see the child's streaming tokens by default — only the returned summary. This is explicitly framed as a token-saving mechanism ("only the final summaries come back — massively reducing your main conversation's token usage").
- Children can run on different models and providers from the parent — useful pattern is Opus parent planning, Sonnet children doing.
- Orchestrator flag toggles whether the parent can multiplex children across a task or is restricted to sequential delegation.

### 2.6 Context / environment injection
- Per-session static discovery: walk to git root, apply "first match wins" over `.hermes.md/HERMES.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`. `SOUL.md` is always loaded from `HERMES_HOME` independently. Max 20K chars, 70%-head/20%-tail truncation when oversize, rendered under a `# Project Context` header in the system prompt.
- Per-turn dynamic discovery: `SubdirectoryHintTracker` watches tool arguments for file paths, does an ancestor walk up to 5 parent dirs, and **appends discovered context to the tool result** (not the system prompt) so the model sees it "naturally in context."
- Static `SYSTEM INFORMATION` (cwd, OS, shell, timezone from `config.yaml`) is set once per session.
- The whole frozen block is designed to be cache-hot — personality (SOUL.md), memory (MEMORY.md + USER.md), skills metadata table, context files, tool-use guidance, model-specific instructions.
- No explicit `environment_details` block per-turn like Cline's recursive file tree; the per-turn detail is sparser and reactive (appended to tool results).
- `@` context references exist (`@file`, `@folder`, `@git-diff`, `@url`) and expand inline in the user message with auto-expansion.

### 2.7 Benchmarks / evals
- **Runtime has no shipped benchmark harness.** `hermes eval` does not exist as a CLI command. The `hermes skills audit` command suggests some quality checks on skills but not agent-level evals.
- Evals live entirely in the `hermes-agent-self-evolution` sibling. The PLAN.md references "behavioral test suite generator," "~60-80 behavioral test scenarios across all sections," and a "full benchmark suite (TBLite + YC-Bench)."
- No PR-gate or regression gate is documented on the hermes-agent main repo. The eval pass happens inside the evolution pipeline, not at merge time.
- Trajectory logging is implicit — sessions persist to SQLite with lineage tracking across compressions, per-platform isolation, and atomic writes — and the evolution pipeline consumes those trajectories via trace export.
- Batch processing exists: "Run agents across hundreds of prompts in parallel generating training data." This is the trace-generation side of the RL/eval pipeline.

### 2.8 Unique Hermes-only mechanisms
- **`execute_code` as a first-class tool.** The agent writes Python that calls other Hermes tools via sandboxed RPC. This is strictly stronger than tool chaining: the model can compose a loop, a `for path in paths: read_file(path)` style aggregator, or a conditional pipeline in-line without ballooning the turn count.
- **Terminal backends are pluggable.** `terminal.backend` = `local | docker | ssh | modal | daytona | singularity` with per-backend knobs (`docker_image`, `docker_volumes`, `container_cpu/memory/disk`, `persistent_shell`). The same tool surface works across six sandbox environments.
- **Per-platform toolset overrides.** `display.tool_progress_overrides: { signal: off, telegram: verbose }` — the same agent can present different tool verbosity per delivery channel, which matters for gateway-hosted sessions (SMS/Telegram vs CLI).
- **`checkpoints.enabled` + `checkpoints.max_snapshots: 50`** exist as runtime config. Not documented in the features pages we fetched but surfaced in `configuration`.
- **Clarify timeout.** `clarify.timeout: 120` — the `clarify` tool is a first-class agent primitive, not just a UX pattern. The agent can suspend and wait for a human with a configured deadline.
- **Credential pools** — `hermes` can distribute API calls across multiple keys with automatic rotation, documented under Integrations. Useful for high-volume batch runs.
- **Provider routing / fallback chains** — "Fine-grained control over which AI providers handle your requests" with sort/filter and automatic failover to backup LLMs on errors. This is a config-level concern, not something the agent has to orchestrate.

---

## Part 3 — Delta vs UC

Legend: **✓ shipped** — we have this or equivalent. **~ partial** — some of it, with gaps called out. **✗ missing** — not shipped, MVP slice below.

### 3.1 Runtime / tool loop
- **✓ shipped.** `src/lib/agentExecutionCore.ts` + `src/lib/agentProviders/anthropic.ts` cover the loop, `agentRunPersistence.ts` covers the SQLite equivalent (Postgres `agent_runs` + `agent_run_events`). Cancellation hooks exist via the session runtime. Per-turn reasoning knobs map roughly to our mode policy (`openswanModePolicy.ts`). The only Hermes mechanism we don't match: three-API normalization (OpenAI/Codex/Anthropic) — we're Anthropic-only today. **Keep Anthropic-only until we have a concrete second-provider need.**

### 3.2 Skill library (SKILL.md) — 3-level progressive disclosure
- **~ partial.** We ship Level 0 (`listLibrarySkills` metadata) and Level 1 (`viewLibrarySkill(name)` full body). Hermes' **Level 2 (`skill_view(name, path)` sub-file)** is not shipped.
- **Missing slice:** skills today are a single `content text` column on `circle_skills`. Hermes skills are a directory: `SKILL.md` + `references/` + `templates/` + `scripts/`. If a circle installs a complex Claude Code skill it gets flattened into one blob.
- **MVP:** new table `circle_skill_files (id, skill_id, relpath, content, is_primary)` — primary = `SKILL.md`, relpath = `references/api.md` / `templates/pr.md` / etc. Extend `viewLibrarySkill(name, path?)` to resolve sub-files. Extend `skillLibraryImport.ts` to split multi-file skills at import time. Extend `skillPromptInjection.ts` to only list `is_primary` rows. **Effort: S–M.** **SQL: yes — new table + migration.** No new product surface.

### 3.3 `skill_manage` action vocabulary
- **~ partial.** We ship `skill.create / patch / delete`. Hermes also has `edit` (major rewrite, distinct from patch) and `write_file / remove_file` for sub-files.
- **Missing slice:** sub-file write actions (blocked on 3.2's multi-file layout).
- **MVP:** once 3.2 lands, extend `agentTools/manageLibrarySkill.ts` with `write_file` / `remove_file` that file HITL approvals with the file path + diff. **Effort: S** (after 3.2). **SQL: none.**

### 3.4 Memory scopes — MEMORY.md vs USER.md bounded-by-char
- **~ partial.** We have `circle_memory` (shared) and `user_memory` (per-user). We do **not** enforce Hermes' bounded-char semantics (2,200 + 1,375) — memory can grow unbounded until our 4K-token compaction threshold.
- Our compaction is HITL-summarize (`circleMemoryCompaction.ts`); Hermes' is agent-driven-on-reject (the model gets an error from `memory.add` and has to consolidate itself).
- **Missing slice:** (a) publish the char cap to the agent via the system prompt so it stops trying to `memory.append` past the limit, and (b) return a structured error from `appendUserMemory` when the cap would be exceeded so the agent can self-compact without needing a human approval round-trip.
- **MVP:** add `MEMORY_SOFT_CAP` + `MEMORY_HARD_CAP` constants to `userMemory.ts` / `agentMemory.ts`; return `{ok: false, error: 'memory_cap_exceeded', suggestion: 'consolidate'}` on overflow; surface caps in the skills/memory prompt block. Keep HITL compaction as the forcing function for shared memory — the Hermes "agent consolidates itself" model is weaker for multi-user circles. **Effort: S.** **SQL: none.**

### 3.5 Self-evolution (DSPy + GEPA)
- **✗ missing.** `HERMES_INTEGRATION_PLAN.md` Phase 5 was always gated on "≥50 skills + ≥1K persisted runs." We're not there yet. Our regression-benchmark file (`openswanBenchmarks.ts`) is a test suite, not an optimizer.
- **Missing slice:** we don't have the three parts of the Hermes evolution loop — (a) trace export, (b) candidate generation, (c) constraint-gated merge.
- **MVP (preparatory only, NOT the full pipeline):** (1) add `npm run export:traces` that dumps `agent_runs` + `agent_run_events` as JSONL to `docs/traces/`, (2) seed a `docs/evals/` dir with 10 golden cases in the same shape `openswanBenchmarks.ts` already uses, (3) write a 1-page doc describing which surfaces are "evolvable" (skill bodies in `circle_skills`, tool descriptions in `openswanToolRuntime.ts`, frozen system-prompt sections in `agentPromptBuilder.ts`). **Actual optimizer stays out of scope until we hit the volume threshold.** **Effort: M** for preparation. **SQL: none.** Opens a new product surface later (Phase 5 dashboard).
- **Conflict call-out:** the Hermes evolution pipeline mutates source code via "Darwinian Evolver." Our commit policy says no autonomous code edits. **Cap evolvable surfaces to skill bodies + tool descriptions + prompt components.** Never let the optimizer touch `.ts` files.

### 3.6 Subagent delegation — isolated child, summary-only return
- **~ partial.** `src/lib/subagentRegistry.ts` exists but still calls `runOpenSwanRuntimeToolLoop`; Phase 1c pending migration to `agentExecutionCore`. The delegation boundary we ship is weaker than Hermes' — parent can see child's full stream today.
- **Missing slice:** (a) the "summary-only return" contract, (b) explicit `delegation.max_concurrent_children` + `max_spawn_depth` caps, (c) different-model-per-child (parent Opus, child Sonnet/Haiku).
- **MVP:** finish the Phase 1c-1 migration (already pending task #32), then add a `DelegationGate` that (i) enforces depth ≤ 2 and concurrency ≤ 3 per circle, (ii) strips child events from the parent's observable stream and surfaces only the child's final `AgentEvent` of kind `final_response`, (iii) lets `subagentRegistry.spawn` take an optional `provider` override so a cheap Haiku child can run under an Opus parent. **Effort: M.** **SQL: none** (agent_runs already tracks parent_run_id if not, add it — check). New product surface: a "delegations" pane in the run ledger.

### 3.7 `execute_code` — agent writes Python that calls tools via RPC
- **✗ missing (and intentional).** This is the biggest step-up-in-capability in Hermes, and it's also the biggest single-tool-risk. Our runtime is TypeScript + React Native — there's no host for "model writes a script that calls tools."
- **Missing slice (if we wanted it):** a sandboxed JS/TS snippet executor that exposes the tool catalog via an `callTool(name, args)` stub. Run in a Web Worker on web, `vm2`-equivalent on edge. Hard cap on runtime + memory. Write-through to the HITL queue for any destructive tool invoked from inside a script.
- **Recommendation: don't ship this.** Our user base is small dev teams doing accountability, not autonomous agent research. The failure modes (infinite loops, prompt-injected code paths, cost explosions) are not worth the capability gain when the user could also just ask the agent for the same sequence as N tool calls. **Defer indefinitely.**

### 3.8 Context / environment injection — first-match-wins + subdirectory tracker
- **~ partial.** Our `openswanContextDiscovery.ts` does something similar (scans messages for paths, pulls `.md` files). We don't have Hermes' "first match wins" priority rule over `AGENTS.md` / `CLAUDE.md` / `.cursorrules`, and we don't have a per-turn `SubdirectoryHintTracker` that appends context to tool results.
- **Missing slice:** (a) priority order across multiple project context files in a room, (b) per-turn discovery append (to tool results, not system prompt — preserves cache).
- **MVP:** extend `openswanContextDiscovery.ts` with a `priority` list and first-match-wins resolution inside a room; add a hook inside `executeOpenSwanTool` that, when a tool result references a file path, appends a small "discovered context" block to the tool result. **Effort: S.** **SQL: none.**

### 3.9 Checkpoints (`checkpoints.enabled: true`, `max_snapshots: 50`)
- **✓ shipped.** `chatCheckpoints.ts` + 6 tool kinds. Hermes' config is simpler (one toggle, one cap) but we ship the actual per-kind reversers they don't document. **No action.**

### 3.10 Bounded context with compression (`compression.threshold: 0.50`)
- **~ partial.** Hermes triggers compression at 50% of context limit, preserves last 20 messages, targets 20% ratio. We have chat lazy-init + 150ms follow-fetch and FlatList virtualization, but no **agent-side** context compression hooked into a percentage threshold.
- **Missing slice:** a `compressContextIfOversized(session, threshold)` helper that, before each Anthropic call, summarizes the oldest half of the message history if tokens > threshold × max_context.
- **MVP:** add `src/lib/agentContextCompression.ts` hooked into `agentExecutionCore` pre-turn. Use Haiku for the summarization (cheap). **Effort: M.** **SQL: none.** This is the single biggest cost/latency lever for long-running BlackSwan threads.

### 3.11 Provider routing / fallback / credential pools
- **✗ missing.** We're single-provider (Anthropic via `agentProviders/anthropic.ts`). Hermes supports fallback chains in config + credential pooling with automatic rotation.
- **Missing slice:** (a) fallback chain (Anthropic primary → OpenRouter Anthropic secondary on 529/overload), (b) credential pool if we ever run the llm-proxy on >1 key.
- **MVP:** add `src/lib/agentProviders/fallbackChain.ts` that wraps `anthropic.ts` with an N-retry-then-next-provider loop. Keep `llm-proxy` single-key for now. **Effort: M.** **SQL: none.** Medium value — mostly about surviving Anthropic outages.

### 3.12 Cron / scheduled tasks
- **✓ shipped.** We have `circle_automations` + `automation-executor` + `/schedule` / `/cron` slash commands. Hermes' `hermes cron` family (list/create/edit/pause/resume/run/remove/status/tick) is materially covered by `CHAT_AUTOMATION_AUDIT_PLAN` Phase CA-2 (shipped). **No action.**

### 3.13 Per-platform tool verbosity (`display.tool_progress_overrides`)
- **✗ missing.** This is the iMessage / SMS bot play — when BlackSwan answers via iMessage, we don't want the full `🔧 Using searchCircleMemory…` stream; we want the final answer. Today our tool-call streaming is uniform across surfaces.
- **Missing slice:** a `chatTransport.verbosity` field on `chatAutomationPlan` that tunes how many progress events get surfaced.
- **MVP:** add `verbosity: 'off' | 'new' | 'all' | 'verbose'` to the plan; default `new` in ChatTab, `off` when the transport is a future SMS/iMessage bridge. **Effort: S.** **SQL: none.** Low urgency until we ship iMessage.

### 3.14 Checkpoints across session lineage (`SessionStore` lineage)
- **✗ missing.** Hermes' SessionStore has "lineage tracking (parent/child across compressions)." Our chat thread is a flat list. When a thread gets compressed / rolled / split, we lose the parent-pointer.
- **Missing slice:** `room_messages.parent_thread_id` + `room_messages.lineage_root_id`. Lets the Run Ledger trace a long-running task across forks.
- **MVP:** single column add; backfill nulls. **Effort: S.** **SQL: yes — one column + index.** Low urgency; real value appears once we have Phase 5 trace export.

### 3.15 Skill marketplace / audit / publish (`hermes skills publish / audit / snapshot`)
- **✗ missing.** We ship `/skill import` (one-way, GitHub URL or Claude Code bridge) but no publish, no audit, no snapshot-and-version.
- **Missing slice:** a circle-to-marketplace flow where a skill is marked `is_public` and becomes discoverable across UC circles (the agentskills.io concept, UC-flavored).
- **MVP:** add `circle_skills.visibility enum('circle', 'public')` + a new `skills_public` read-only view. Feature-gate `/skill publish` on circle creator. **Effort: M.** **SQL: yes — column + view.** Opens a new product surface (Skill Marketplace tab). **Priority: low until we have more user-created skills.**

### 3.16 `clarify` as a first-class agent primitive (with `clarify.timeout`)
- **~ partial.** Our `ask_user` tool exists in computer-use-agent. Hermes ships `clarify` as a turn-level primitive with a config'd timeout — if the user doesn't answer in 120s, the tool returns a structured timeout and the agent can proceed with a safe default.
- **Missing slice:** timeout on our `ask_user` (today it blocks indefinitely), and a cross-surface `clarify` primitive (not just computer-use).
- **MVP:** add `timeoutMs` to the `ask_user` tool (default 120_000), surface the "still waiting — auto-continuing" message in `HitlApprovalBanner`. **Effort: S.** **SQL: none.**

---

## Part 4 — Priority-ordered implementation list (top 10 by impact ÷ effort)

| # | Item | Impact | Effort | Maps to existing phase | New SQL? | New product surface? |
|---|---|---|---|---|---|---|
| 1 | **Agent-side context compression** (§3.10) — `agentContextCompression.ts`, Haiku summarizer, 50% threshold | High | M | Extends `agentExecutionCore` (Phase 1) | No | No |
| 2 | **Memory bounded-char caps** (§3.4) — return structured errors, publish caps in prompt so agent self-consolidates | High | S | Extends `userMemory.ts` + `agentMemory.ts` (Phase 4) | No | No |
| 3 | **Skill sub-file support** (§3.2) — `circle_skill_files` table, `skill_view(name, path)`, importer split | High | M | Extends Phase 2a+2b (skill library) | **Yes** — new table | No (UI unchanged) |
| 4 | **Subagent summary-only return + depth/concurrency gate** (§3.6) — finish Phase 1c-1 + `DelegationGate` | High | M | Phase 1c-1 (already pending task #32) | Maybe — check `parent_run_id` on `agent_runs` | Yes — delegations pane in run ledger |
| 5 | **`clarify` timeout + cross-surface** (§3.16) — add `timeoutMs` to `ask_user`, bubble in HITL banner | Medium | S | Extends `chatApprovalGate` (Phase CA-4) | No | No |
| 6 | **Provider fallback chain** (§3.11) — Anthropic primary → OpenRouter secondary on 529/overload | Medium | M | Extends `agentProviders/` (Phase 1b) | No | No |
| 7 | **Trace export + evals dir scaffolding** (§3.5 preparatory only) — `npm run export:traces`, `docs/traces/`, `docs/evals/` | Medium | M | Preparation for Phase 5 (blocked on volume) | No | No (later: Phase 5 dashboard) |
| 8 | **Context file priority + per-turn discovery append** (§3.8) — first-match-wins + tool-result append | Medium | S | Extends `openswanContextDiscovery` (Phase 1b) | No | No |
| 9 | **`skill_manage` sub-file actions** (§3.3) — `write_file` / `remove_file`, HITL-gated | Medium | S | Extends `manageLibrarySkill.ts` (Phase 2b) | No (rides on #3) | No |
| 10 | **Session lineage column** (§3.14) — `parent_thread_id` + `lineage_root_id` on `room_messages` | Low–Medium | S | Preparation for Phase 5 + future compaction UX | **Yes** — one column + index | No |

**Deliberately NOT on this list** (see deltas for rationale):
- `execute_code` (§3.7) — too dangerous for our user base, not shipping.
- Terminal backends plug matrix (Hermes §2.8) — we already have `room-task-executor` + computer-use + Claude Code bridge; adding Docker/SSH/Modal is a separate "power-user" product surface, not a Hermes delta.
- Gateway-hosted SMS/iMessage tool verbosity (§3.13) — parked until we ship iMessage bridge.
- Skill marketplace (§3.15) — blocked on having 10+ user-authored skills to showcase.
- DSPy/GEPA full pipeline — blocked on #7 (trace export) + the ≥50 skills / ≥1K runs gate already in `HERMES_INTEGRATION_PLAN.md` Phase 5.

---

## Part 5 — Conflicts with existing plans

1. **Hermes self-evolution mutates source code ("Darwinian Evolver").** UC's commit policy forbids autonomous code edits. **Resolution: evolvable surfaces are skill bodies + tool descriptions + prompt components ONLY.** Never `.ts` files. Note this in the future Phase 5 plan.

2. **Hermes memory is agent-self-consolidating; UC memory is HITL-compacted.** Hermes' "add returns error; agent rewrites" model doesn't fit multi-user circles — one user's agent shouldn't compact another user's facts mid-turn. **Resolution: keep HITL compaction for shared `circle_memory` (already shipped); adopt self-consolidate for per-user `user_memory` only (§3.4 MVP).** Two memory surfaces, two policies.

3. **Hermes `delegate_task` keeps the parent blind to child streams by default.** UC's Run Ledger currently shows the full tree. **Resolution: default to Hermes' contract (summary-only in the chat transcript), but keep the Run Ledger showing full child event trees for debugging.** User-facing vs operator-facing surfaces get different verbosity — §3.6 MVP already assumes this.

4. **Hermes `execute_code` is a power primitive; we can't ship it safely.** Don't. Document in Phase 1/Section B of `OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md` as an explicit non-goal so no agent re-proposes it.

5. **Hermes "first match wins" over `AGENTS.md` / `CLAUDE.md` / `.cursorrules`.** Our current stack reads CLAUDE.md for the agent and AGENTS.md for humans. **Resolution: for the SubdirectoryHintTracker-equivalent, use priority `.openswan.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules` (first match wins), matching Hermes' semantics.** Don't merge them — Hermes deliberately picks one.

6. **Hermes bounds memory at ~800 + ~500 tokens total; our `circle_memory` compaction trigger is ~4K tokens.** These are different regimes — Hermes is a solo agent on a laptop; we're a team agent with persistent context. **Resolution: keep the 4K threshold for shared memory; adopt Hermes-like caps (2,200 / 1,375 chars) only for `user_memory`** which is 1-to-1 with the Hermes USER.md concept.

7. **Hermes has no CLI `hermes eval` / `hermes learn`; all that lives in a sibling repo.** UC's `openswanBenchmarks.ts` + `openswanEvals.ts` + `openswanObservedEvals.ts` is materially ahead of the hermes-agent runtime here (the optimizer is Nous's advantage; the in-runtime evals are ours). **No conflict — but do not re-pitch a "ship hermes-style eval CLI" item. We already out-ship them on this surface.**

---

## Sources checked

- `https://hermes-agent.nousresearch.com/docs/` (landing TOC)
- `https://hermes-agent.nousresearch.com/docs/getting-started/quickstart`
- `https://hermes-agent.nousresearch.com/docs/user-guide/configuration`
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/overview`
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/tools`
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/skills`
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/memory`
- `https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files`
- `https://hermes-agent.nousresearch.com/docs/developer-guide/architecture`
- `https://hermes-agent.nousresearch.com/docs/developer-guide/contributing`
- `https://hermes-agent.nousresearch.com/docs/reference/cli-commands`
- `https://hermes-agent.nousresearch.com/docs/guides/tips`
- `https://github.com/NousResearch/hermes-agent` (README + dir tree)
- `https://github.com/NousResearch/hermes-agent-self-evolution` (README + PLAN.md — via WebSearch summary)

UC docs re-read: `docs/AGENTS_ROADMAP.md` §§1-3 + file-ownership table, `docs/HERMES_INTEGRATION_PLAN.md` phase status, `docs/OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md` §§1-8, `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md` Phases CA-1..CA-7, `docs/CLINE_RESEARCH_AND_MAPPING_2026-04-22.md` for report shape, `src/lib/chatCheckpoints.ts` + `src/lib/memoryBankKinds.ts` to sanity-check what's shipped.

---

### Summary (≤ 200 words)

Hermes Agent is NousResearch's MIT Python CLI: a typed-tool agent loop with `~/.hermes/`-rooted state (MEMORY.md 2,200-char + USER.md 1,375-char bounded files, `skills/` 3-level progressive disclosure, `sessions/` SQLite+FTS5, auto-discovered project context). Self-evolution is a **separate repo** (`hermes-agent-self-evolution`) running DSPy+GEPA offline on traces — no GPU, ~$2-10/run, beats GRPO by 6% avg with 35× fewer rollouts. UC already ships the loop, skill library, memory scopes, checkpoints, regression benchmarks, and chat automation — we're ahead on HITL, multi-user circles, and in-runtime evals. The real deltas are: **(1) agent-side context compression at a % threshold**, **(2) bounded memory char caps with self-consolidation for per-user memory**, **(3) multi-file skills with `skill_view(name, path)` sub-file retrieval**, **(4) finish the subagent summary-only contract with depth/concurrency gates**, **(5) `clarify` with a config'd timeout**, **(6) provider fallback chain for outage resilience**. Don't ship Hermes' `execute_code` — the failure modes aren't worth the capability gain for our audience. Don't let the future DSPy optimizer mutate `.ts` source — cap evolvable surfaces to skill bodies + tool descriptions + prompt components. Full report: `docs/HERMES_DELTA_PLAN_2026-04-22.md`.
