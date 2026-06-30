# Hermes Agent → OpenSwan / BlackSwan Integration Plan

> **Canonical plan:** [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md) is the tie-breaker. This doc captures the Hermes research + the phased adoption strategy, but the roadmap owns the current file-ownership table and phase status.

**Drafted:** 2026-04-21
**Source research:** `https://github.com/NousResearch/hermes-agent` (MIT) + `https://hermes-agent.nousresearch.com/docs`
**Why this doc exists:** Chris wants OpenSwan to be "an agent that improves and can help the user with any task." Hermes is the closest existing OSS runtime to that vision — typed tool loop, skill library that compounds, persistent memory, subagent delegation, and an offline self-evolution pipeline. This plan translates the parts worth stealing into our TypeScript stack, in the order that earns the biggest wins per hour of work.

Related docs: [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md), [`OPENSWAN_ARCHITECTURE_AUDIT_2026-04-15.md`](./OPENSWAN_ARCHITECTURE_AUDIT_2026-04-15.md), [`SOULS_SPIRITS_SKILLS_ROADMAP.md`](./SOULS_SPIRITS_SKILLS_ROADMAP.md), [`OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`](./OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md).

---

## 1. What Hermes is, in one paragraph

Hermes Agent is NousResearch's open-source, self-improving personal AI. It runs a typed OpenAI-style tool-use loop on any chat-completion model, keeps a SQLite session DB with full-text search, persists declarative memory in `MEMORY.md` + `USER.md`, auto-writes procedural memory as `SKILL.md` files when it completes a complex task successfully, and can spawn isolated sub-agents via `delegate_task`. A sibling repo (`hermes-agent-self-evolution`) reads session trajectories and uses DSPy + GEPA to evolve prompts/skills offline. License is MIT. The SKILL.md format it uses is now a shared open standard (agentskills.io) adopted by Claude Code, Cursor, Codex, Gemini CLI, OpenCode, and ~30 others.

That last point is load-bearing: **adopting SKILL.md means UC circles can import a user's existing Claude Code skills on day one.**

---

## 2. Why this matches the OpenSwan vision

| Chris's goal | Hermes primitive | Our current state |
|---|---|---|
| "Improves over time" | Skills + trajectory log + offline DSPy/GEPA | Run persistence exists through `agent_runs`, `agent_run_events`, `agentRunPersistence`, and SwanBot v1/v2 telemetry; remaining gap is production cohort evidence plus broader skill-loop rollout |
| "Can help with any task" | Registry of ~50 tools + MCP loader + `delegate_task` | `openswanToolRuntime.ts` exists but orphaned — runtime passes text `toolBrief` instead of calling it |
| "Remembers what it learned" | MEMORY.md + USER.md + session FTS search | `circle_memory` table (closer than Hermes' solo-user model), but no per-user `USER.md` equivalent |
| "Knows when to stop and ask" | `clarify` tool + `hitlService` equivalent | We have `hitlService.ts` already — ahead here |
| "Can split work across specialists" | `delegate_task` isolates child context | Specialists exist but share no typed session contract (see OpenSwan audit §2) |

We are ahead of Hermes on: verification pipeline, HITL approvals, multi-user circle-scoped memory, streaming chat UX, and baseline run persistence. Remaining gaps are production cohort evidence, broader skill-loop adoption, and finishing the typed-loop migration across all callers.

---

## 3. Architectural map — Hermes today, OpenSwan tomorrow

### 3.1 Hermes runtime loop (distilled)

```
user message
  → build system prompt (MEMORY.md + USER.md + skills metadata table, ~3K tokens)
  → build messages (role=system/user/assistant/tool)
  → model.chat.completions.create({ tools: tool_schemas, tool_choice: 'auto' })
  → while response.tool_calls && iter < 90:
       group tool_calls by path-scope                     (concurrency safety)
       Promise.all(group)                                 (parallel where safe)
       append each result as role='tool' message
       re-call model
       if response.content && !response.tool_calls: break
  → persist session to SQLite
```

Tools self-register on import into a singleton `ToolRegistry`. Each tool file declares schema + handler + pre-flight check. Results are always `{ok, data}` or `{error}` JSON — never thrown exceptions across the LLM boundary.

### 3.2 OpenSwan target runtime (mirror of the above, TS)

```
circle message (@blackswan or /task)
  → build system prompt
      └ frozen block (cached with Anthropic `cache_control`):
          circle snapshot, member list, mission schema, skill metadata table
      └ volatile block (uncached):
          last 30 messages, now-timestamp, active mission, current user's USER.md
  → build messages (Anthropic Messages API tool-use format)
  → while response.stop_reason === 'tool_use' && iter < MAX_ITER (start at 25):
       dispatch each tool_use via openswanToolRuntime.dispatch
       run in parallel where safe (Promise.all)
       append tool_result blocks
       stream the model's next turn back to the room via chat-stream SSE
  → persist run to agent_runs (schema already exists)
  → if run is successful AND >= 5 tool calls: offer "/promote-skill"
```

### 3.3 Component ownership

| Concern | File | Status |
|---|---|---|
| Typed loop core | `src/lib/agentExecutionCore.ts` | **NEW** — Phase 1 |
| Tool registry | `src/lib/openswanToolRuntime.ts` | Exists, orphaned — Phase 1 wires it in |
| Tool implementations | `src/lib/agentTools/*.ts` | **NEW folder** — add 5 BlackSwan tools first |
| Skill library (SKILL.md) | `src/lib/skillLibrary.ts` | Phase 2a shipped 2026-04-21 (read-only). Distinct from the pre-existing `skillRegistry.ts`, which Codex owns and uses for DB-column persona skills against `skills` + `circle_soul_skills`. See `docs/AGENTS_ROADMAP.md` §2. |
| Skill storage | Supabase table `circle_skills` (+ future `user_skills`) | **NEW SQL** — Phase 2 |
| User/circle memory | `circle_memory` + new `user_memory` | Partial; Phase 2 extends |
| Session / trajectory log | `agent_runs` (extended), `agent_run_events` | Exists; Phase 1 extends schema |
| Streaming transport | `supabase/functions/chat-stream` + Realtime | Exists — Phase 1 reuses |
| Subagent delegation | `src/lib/subagentRegistry.ts` | Exists; Phase 3 refactors onto core |
| Verification / critic | `openswanVerificationRuntime.ts` | Exists, ahead of Hermes; Phase 3 expands statuses |
| Offline evaluator | Out-of-scope until Phase 5 | — |

---

## 4. Adoption plan — 5 phases

Each phase ships independently. Each is typecheck-clean and has a user-visible improvement or unlocks the next phase.

### Phase 1 — Typed tool loop (3-5 days)

**Goal:** Replace the text `toolBrief` with a real Anthropic tool-use loop. BlackSwan gains its first 5 tools.

1. **`src/lib/agentExecutionCore.ts`** — class `AgentExecutionCore` with method `run(session, { maxIterations = 25, onEvent })`. Owns the loop above. Events emitted: `tool_call_start`, `tool_call_result`, `model_turn_start`, `model_turn_delta`, `final_response`, `max_iterations_exceeded`. Event stream plugs directly into chat-stream SSE.
2. **`src/lib/agentTools/`** — new folder. Each file self-registers against `openswanToolRuntime.ts`. Initial 5 tools for BlackSwan:
   - `getGithubActivity({ circleId, windowHours })`
   - `getMemberStatus({ circleId })`
   - `searchCircleMemory({ circleId, query })`
   - `postMissionUpdate({ missionId, body })`
   - `nudgeMember({ circleId, userId, reason })`
   Each returns `{ ok: true, data }` or `{ ok: false, error }` — never throws. Zod validates input schema at dispatch time.
3. **`supabase/functions/swanbot-ai/index.ts`** — rewrite as a thin wrapper around `AgentExecutionCore`. System prompt split into frozen (with `cache_control`) + volatile blocks per the prompt-caching memory. Stream tool-call announcements into the room ("🔧 Using searchCircleMemory…") so users see progress.
4. **Schema extension** — use `docs/RUN_THIS_SQL.sql` §9 as canonical. `agent_runs` telemetry requires `tool_calls jsonb`, `iteration_count int`, `final_stop_reason text`, `input_tokens int`, `output_tokens int`, and `cached_tokens int`. Add `agent_run_events` if not present (id, run_id, kind, payload, at).
5. **Verification** — typecheck, targeted test of the loop with a mock provider (Phase 1 exit criterion: one test in `src/lib/__tests__/agentExecutionCore.test.ts`).

**Concrete outcome:** user says `@blackswan what shipped this week?`, BlackSwan calls `getGithubActivity`, sees the real events, calls `searchCircleMemory` if context is missing, and posts a structured summary.

### Phase 2 — SKILL.md skill library (4-6 days)

**Goal:** Skills compound. Users can also import their Claude Code skills.

1. **Adopt the [agentskills.io](https://agentskills.io) `SKILL.md` format verbatim** — YAML frontmatter (`name`, `description`, `version`, optional `platform`, `tags`) + markdown body with `## When to use / ## Procedure / ## Pitfalls / ## Verification` sections. No custom fields.
2. **`circle_skills` table** (SQL in `RUN_THIS_SQL.sql` §10):
   ```sql
   CREATE TABLE circle_skills (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     circle_id     uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
     author_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
     name          text NOT NULL,
     description   text NOT NULL,
     version       text NOT NULL DEFAULT '1.0.0',
     content       text NOT NULL,
     tags          text[] DEFAULT '{}',
     usage_count   int  DEFAULT 0,
     success_count int  DEFAULT 0,
     created_at    timestamptz DEFAULT now(),
     updated_at    timestamptz DEFAULT now(),
     UNIQUE (circle_id, name)
   );
   ```
   RLS: members of the circle can read; only author or circle creator can edit/delete.
3. **`src/lib/skillLibrary.ts`** (shipped 2026-04-21 — read path) — 3-level progressive disclosure API:
   - `listLibrarySkills(circleId)` → metadata table (name, description, tags, version) only. ~20 tokens per skill; 100 skills = ~2K tokens.
   - `viewLibrarySkill(circleId, name)` → full markdown body.
   - Phase 2b: `viewLibrarySkill(circleId, name, path)` for sub-file lookups within a skill directory.

   This is a NEW file, distinct from the pre-existing Codex-owned `skillRegistry.ts` which loads DB-column persona skills via `loadPreparedSkillsForSoul` / `buildSkillsPromptBlock`. The two systems coexist; see `docs/AGENTS_ROADMAP.md` §2 "Persona skills" vs "SKILL.md library".
4. **System-prompt injection** — **inject the skills metadata table as a user-role message, not in the system prompt.** This is Hermes' trick to preserve prompt caching on the frozen system prompt when skills change. Phrase it as: `"Available skills you can consult via skill_view:\n{table}"`.
5. **New tools:** `skill_view(name)` and `skill_manage({ action: 'create'|'patch'|'delete', ... })`. Gate `skill_manage` behind HITL approval — see Phase 4.
6. **Slash command `/skill import <url>`** — fetches a SKILL.md from GitHub/gist and stages it for review.
7. **Importer for Claude Code skills** — read the user's `~/.claude/skills/` (via the bridge we already have) and let them tick the ones to copy into a circle.

### Phase 3 — Typed subagent core + verification expansion (3-4 days)

**Goal:** Parent/child specialists share one runtime. Verification surfaces real statuses.

1. **Refactor `src/lib/subagentRegistry.ts`** — spawning a specialist now instantiates `AgentExecutionCore` with a different toolset + isolated message history. Only the child's final structured summary re-enters parent context, matching Hermes' `delegate_task` contract.
2. **Cost + approval gating** — every spawn checks `agent_controls.spend_limits` and respects circle-level daily cap. Already wired through `hitlService.ts`; just connect the paths.
3. **`openswanVerificationRuntime.ts`** — expand the status enum as the audit's Phase B called for: `executed | planned | blocked | manual_required | not_applicable`. Surface in run ledger UI.

### Phase 4 — Memory upgrades + HITL around writes (2-3 days)

**Goal:** Lifetime memory that doesn't get poisoned.

1. **`user_memory` table** — per `(circle_id, user_id)`, stores the equivalent of Hermes' `USER.md`. Injected into prompt alongside `circle_memory`.
2. **`session_search` tool** — Supabase full-text search (`tsvector` column on `room_messages`) + Haiku summarization. Match Hermes' contract: returns *quoted, untrusted* snippets tagged as such to resist indirect prompt injection.
3. **Every `memory.add` / `memory.replace` / `skill_manage` tool call goes through HITL approval.** The agent proposes; a human confirms. Default cooldown: 24h before the agent can re-propose the same memory key.
4. **Memory compaction** — when `circle_memory` exceeds ~4K tokens, trigger a `consolidate_memory` flow (summarize low-recency entries into a digest). Model proposes; user approves.

### Phase 5 — Trajectory log + offline evaluator (later; preconditions: Phase 1-4 done, ≥50 skills, ≥1K persisted runs)

**Goal:** Actually get better over time.

1. **`agent_run_events` already populated** — every tool call, verification, approval decision. Export as JSONL.
2. **Eval harness** — write a small set of synthetic tasks (e.g. "summarize last week's GitHub activity", "find overdue missions") with scored outputs.
3. **DSPy + GEPA equivalent** — call out to NousResearch's `hermes-agent-self-evolution` workflow with our dataset, or build a minimal TS equivalent using Claude as the proposer. Produce candidate skill/prompt/tool-description patches; run against evals; merge winners.

Do not start Phase 5 until the preconditions are met. Without skills + volume, the optimizer has nothing to optimize against.

---

## 5. BlackSwan-specific (Swanbot) changes

BlackSwan today is Claude Haiku 4.5 via `supabase/functions/swanbot-ai/` answering `@mention`s with raw text. After Phase 1, it becomes the first consumer of `AgentExecutionCore`.

**Haiku 4.5 handles tool use well** — we just need to be disciplined about latency in an edge function. Recommendations:

- Cap `maxIterations` at 8 for Haiku in edge-function context (Opus/Sonnet can go to 25 when invoked from the client-side gateway).
- Cache the system prompt aggressively with Anthropic `cache_control`. Frozen block: circle snapshot, member list, mission schema, skill table. Volatile: last 30 messages + timestamp.
- Stream tool-call announcements so the room sees progress ("🔧 Checking GitHub activity…") — hides edge-function latency.
- Start with 5 tools. Only add more once they're measurably useful.
- Inject skill metadata table as a user-role message to preserve the cache on the frozen block.

**Do not add skills to Swanbot yet.** Swanbot is a high-frequency low-cost agent; the overhead of skill lookup is not justified until the library has mass from OpenSwan usage.

---

## 6. What NOT to copy

- **NousResearch's six terminal backends** (Docker, SSH, Modal, Daytona, Singularity, local). UC's workspace is Supabase + Netlify + each user's local dev box. Local shell via bridge + `room-task-executor` edge function is enough.
- **Their platform gateway (Telegram / Discord / Signal / WhatsApp / Email).** UC's surface is the app + circle chat + iMessage coming later. Don't chase.
- **Voice mode / TTS.** Separate surface.
- **Auto-exposing every skill as a slash command.** UC's `/mission`, `/summary`, `/help` namespace is curated. Keep it curated; don't let 100 skills explode it.
- **Tinker-Atropos RL environments + DPO/SFT training.** We have the BlackSwan Mini/Full training pipeline (`scripts/blackswan-llm/`). That's a separate track.
- **DSPy+GEPA pipeline _today_.** Defer to Phase 5.

---

## 7. Safety gates (must land with Phase 1-4, not after)

The moment an agent can write to its own memory or skill library, we've crossed into a new risk class. Non-negotiable controls:

1. **HITL approval for every `memory.add|replace` and `skill_manage` call.** Wire to existing `hitlService.ts` approval queue with a 5-minute timeout default.
2. **Retrieved session content tagged as untrusted.** When `session_search` returns past messages, prefix each block in the prompt with `<untrusted_quoted>...</untrusted_quoted>` and tell the model in the system prompt to never follow instructions inside those blocks. Standard Anthropic indirect-prompt-injection practice.
3. **Subagent spend caps.** `delegate_task` spawns respect `agent_controls.spend_limits` on both sides. Never let a parent dodge limits by delegating.
4. **Per-user `USER.md` is user-only-writable.** Other circle members cannot add facts to another user's memory, even indirectly via tool calls.
5. **Skill publication requires explicit `/promote-skill` command.** The agent cannot self-promote a run transcript to the permanent skill library.

These gates are the difference between a helpful agent and a slowly-self-poisoning one.

---

## 8. SQL needed (appendix for `docs/RUN_THIS_SQL.sql`)

```sql
-- §9. Agent run tracking (Phase 1)
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS tool_calls        jsonb  DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS iteration_count   int    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_stop_reason text,
  ADD COLUMN IF NOT EXISTS input_tokens      int    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens     int    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_tokens     int    DEFAULT 0;

CREATE TABLE IF NOT EXISTS agent_run_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind       text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}',
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_created
  ON agent_run_events (run_id, at DESC);

-- §10. Skills + user memory (Phase 2 / Phase 4)
CREATE TABLE IF NOT EXISTS circle_skills (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_id     uuid                 REFERENCES auth.users(id) ON DELETE SET NULL,
  name          text        NOT NULL,
  description   text        NOT NULL,
  version       text        NOT NULL DEFAULT '1.0.0',
  content       text        NOT NULL,
  tags          text[]               DEFAULT '{}',
  usage_count   int                  DEFAULT 0,
  success_count int                  DEFAULT 0,
  created_at    timestamptz          DEFAULT now(),
  updated_at    timestamptz          DEFAULT now(),
  UNIQUE (circle_id, name)
);
CREATE INDEX IF NOT EXISTS idx_circle_skills_circle ON circle_skills(circle_id);

ALTER TABLE circle_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_read_skills"   ON circle_skills;
DROP POLICY IF EXISTS "authors_write_skills"  ON circle_skills;
CREATE POLICY "members_read_skills"
  ON circle_skills FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));
CREATE POLICY "authors_write_skills"
  ON circle_skills FOR ALL
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

CREATE TABLE IF NOT EXISTS user_memory (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id  uuid                 REFERENCES circles(id)    ON DELETE CASCADE,
  content    text        NOT NULL,
  updated_at timestamptz          DEFAULT now(),
  UNIQUE (user_id, circle_id)
);
ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_rw_own_memory" ON user_memory;
CREATE POLICY "user_rw_own_memory"
  ON user_memory FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

When you're ready to run Phase 1/2 migrations, append the above to `docs/RUN_THIS_SQL.sql` and apply in the SQL editor.

---

## 9. Open questions

1. **Model for the loop.** Claude Opus 4.7 is the default target; Claude Sonnet 4.6 / Haiku 4.5 for cost tiers. OK to start Phase 1 on Sonnet 4.6? (Lower tool-use error rate than Haiku; ~3× cheaper than Opus for the typical circle query.)
2. **Where should agent_runs UI live?** Feed tab has "recent runs"; do we want a dedicated Run Ledger surface in Backpack for replay/debug?
3. **Skill marketplace.** Do we want public sharing / discovery (like agentskills.io), or keep skills circle-private only? Default proposal: circle-private; later a user can mark a skill `is_public` to share to a UC marketplace.
4. **Naming.** Do we keep calling this "OpenSwan" externally, or does the typed-loop rebuild warrant a new name (e.g. "SwanCore", or just "Swan Agent")? The old audit doc still reads "OpenSwan gateway"; if we rename, grep the docs.

---

## 10. What I'll do without waiting for answers

The conservative path forward — everything here is reversible and lands typecheck-clean:

- **Build `src/lib/agentExecutionCore.ts`** as a pure library (no UI, no edge-function wiring) with a mock provider, so the loop is testable in isolation.
- **Start the agent tools folder** with one trivial tool (`getMemberStatus`) and the scaffolding to register more.
- **Add Phase 1/2 SQL** to `docs/RUN_THIS_SQL.sql` (not run, just committed — Chris runs when ready).

Everything else — edge-function rewrite, skill library DB wiring, BlackSwan migration — blocks on a decision in §9 and on a reviewed commit of the core.

---

*Last updated: 2026-04-21. When Phase 1 ships, add a "Phase 1 complete" section with baselines (p50 turn latency, tool-use success rate, token spend per turn) so Phase 5's evaluator has something to beat.*
