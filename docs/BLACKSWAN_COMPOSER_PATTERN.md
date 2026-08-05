# BlackSwan as Our Composer

> Created: 2026-07-02. Research-driven architecture: how Cursor deploys its
> Composer model, mapped onto BlackSwan + SwanBot/OpenSwan — for coding AND
> browser/app automation. Every Cursor claim below survived 3-vote
> adversarial verification against primary sources (deep-research run
> wf_5d5f690d-491; 102 agents, cursor.com blogs/docs/changelogs + the
> Composer 2 technical report / arXiv:2603.24477).

## What Cursor actually does (verified, mid-2026)

1. **The model is a specialization, not a from-scratch frontier.**
   Composer 2 = continued pretraining on a code-heavy mix + large-scale RL
   on top of the open Kimi K2.5 MoE (1.04T/32B-active). Positioning:
   61.3% CursorBench-3 — between Opus 4.6 High and GPT-5.4 — at ~10x lower
   cost ($0.50/$2.50 per M tokens). Composer 1's pitch: "frontier coding
   results at 4x the generation speed of similarly intelligent models,"
   most agent turns under 30s. Frontier models still win the hardest tasks;
   Composer wins the loop.
2. **The defining move: train INSIDE the production harness.** RL rollouts
   call the same real tools users get (read/edit, terminal, grep, semantic
   search, web search), "unifying RL environments with production
   environments." Composer 2 runs a shadow deployment of the production
   backend for dataset prep + rollouts, in Firecracker VMs that each carry
   a full dev environment **including a browser and GUI for computer use**.
   Semantic search is an externally hosted dependency invoked over RPC —
   the tool library is shared between training and prod.
3. **Reward design teaches the product behaviors:** base reward for
   correctness/succinctness/SWE principles; auxiliary rewards for style,
   communication, and tool-call quality (penalizing abandoned to-dos);
   a concave length penalty over thinking/tool/output tokens **and turns**
   — which is what made it fast on easy tasks and taught parallel tool
   calls; "minimizing unnecessary responses and claims made without
   evidence." Long horizons train via self-summarization chains. The task
   distribution mirrors real usage.
4. **The harness deploys it asymmetrically:**
   - **Plan Mode**: "create your plan with one model and build the plan
     with another" — stronger model plans, faster model executes.
   - **Best-of-N**: up to 8 worktree-isolated agents race one prompt
     (`/best-of-n sonnet,gpt,composer …`), winner applied; automated
     judging since 2.2.
   - **Subagents**: Explore / Bash / Browser, each in its own context
     window; Explore uses "a faster model by default" (~10 parallel
     searches in the time of one main-agent search); on legacy plan tiers
     **all subagents are forced onto Composer** — the small model is the
     subagent-layer workhorse.
   - **Browser automation is a dedicated, tool-scoped subagent** — Cursor
     3.0 *reduced* its tool surface to browser tools only "helping it stay
     more focused," with screenshot-coordinate fallback when DOM
     interaction is unreliable.
   - **Semantic search is harness infrastructure**: custom embedding model
     trained on agent-session traces with LLM-ranked relevance; semantic +
     grep beats grep alone for agent accuracy.
   - Cursor 3.0's primary interface is agents-first parallel orchestration.

## The mapping (what BlackSwan is in this pattern)

BlackSwan-v5 (Qwen3.5-4B fine-tune, retrained weekly on the app's own
conversations, missions, check-ins, proof-of-work, XP/streaks) is our
Composer **for the app domain**: not the strongest model in the room, but
the fastest-to-correct one wherever app knowledge dominates — and it gets
better every week from real usage, exactly like Composer's flywheel.

| Cursor | Underground Circle | Status |
|---|---|---|
| Composer default for agent loops in its domain | BlackSwan Auto lanes: status/memory/casual/social + app-grounded light questions (`looksLikeAppGroundedMessage`) | LIVE (P8) |
| Plan Mode: strong plans / fast executes | **Inverted for automation**: app-native BlackSwan PLANS browser/app tasks (`resolveComputerTaskPlannerModel` → `describeComputerUsePlan`), Sonnet-pinned loop executes the screen | LIVE (P9) |
| Browser = dedicated tool-scoped subagent | `computer-use-agent` edge loop: separate, Sonnet-pinned, hard-railed (iterations/tokens/wall-clock), reduced tool surface | Already our shape |
| Composer forced as subagent/tool workhorse | Tool executor swap: BlackSwan turns run tools on `claude-haiku-4-5` while BlackSwan grounds (`resolveOpenSwanToolLoopModel` + grounding block) | LIVE (P8) |
| Grounding context rides the harness | `buildBlackSwanGroundingBlock` on swanbot extras + typed-loop context slot | LIVE (P8) |
| Worktree-isolated parallel agents / best-of-N | `.openswan-worktrees` isolation + deploy orchestrator (50-agent/$10 caps) exist; no `/best-of-n` race-and-judge yet | Partial — roadmap |
| Embeddings trained on agent traces | `memoryService` embeddings exist; not trained on our traces | Roadmap |
| **Train in the production harness on real tool traces** | `scripts/blackswan-llm/export_tool_traces.py` exports `agent_runs`/`agent_run_events` trajectories (tool, input, ok, duration, error, final; failed runs kept as negatives; PII-scrubbed) | NEW (P9) — feeds v6 SFT |

## The BlackSwan training roadmap this implies (v6 → v7)

Cursor's verified sequence, translated:

1. **v6 — SFT on harness tool traces** (now unblocked): train on
   `tool_traces.jsonl` so BlackSwan learns the OpenSwan tool vocabulary
   (names, input shapes, when tools succeed/fail, turn structure). Weekly
   retraining already exists; add this source to `prepare_dataset_*`.
   Success gate: reliable structured tool-calling on app tools in evals —
   the precondition for ever relaxing the executor swap.
2. **v7 — RL in a shadow harness** (Composer 2's formula, scaled to us):
   rollouts against a staging Supabase + the real `openswanToolRuntime`
   catalog (semantic/memory search stays an external RPC tool, exactly as
   Cursor does), reward = task completion + efficiency (length/turn
   penalty) + evidence-before-claims + tool-call quality penalties.
   Browser/GUI rollout environments are what Firecracker gave Cursor —
   our analog is Browserbase sessions against test circles.
3. **Embedding flywheel**: train the memory/semantic-search embedding on
   agent-session traces with LLM-ranked relevance (Cursor's semsearch
   recipe) — improves every model in the harness, not just BlackSwan.

## Hard rules carried over (unchanged by any of this)

- The native screenshot/action loop stays on the Sonnet pin — planning
  models never drive the screen (Cursor scopes its browser subagent the
  same way).
- Explicit model picks stay authoritative; BlackSwan enters only Auto
  lanes and planning seams.
- The approval floor (pay/delete/login/grant), evidence contract, and
  fail-visible marketplace errors are untouched by model routing.
- Only `cswan801/BlackSwan-v5` (dedicated endpoint) is BlackSwan — the
  local Ollama variant is retired (P8 addendum).

## Wired in this pass (P9)

- `resolveComputerTaskPlannerModel` (blackswanRouting) + ChatTab: Auto
  browser/app tasks plan with BlackSwan when the integration is connected;
  runtime + screen loop unchanged. Explicit picks plan with the pick.
- `scripts/blackswan-llm/export_tool_traces.py`: the training flywheel's
  first pipe (SFT-ready trajectories, failed-run negatives, PII scrub).
- Smoke: planner-model cases in `smoke:blackswan-auto-routing`.

## Flywheel first-run findings (2026-07-02)

Running the v6 flywheel against production surfaced and fixed two real
breaks in the pipe:
1. **Schema drift**: `agent_run_events` columns are `kind`/`at`, not
   `event_type`/`created_at` — exporter corrected.
2. **The telemetry adapter was never wired**: `agent_run_events` sat
   EMPTY in production (39 runs, 0 events) because
   `agentRunPersistence.createPersistedRun` has no live callers. Fixed by
   persisting `tool_call_start` / `tool_call_result` / `final_response`
   fire-and-forget from the typed loop's `onEvent`
   (openswanSessionRuntime), payload shapes in lockstep with the exporter.
   **Trace data accumulates from real usage from this fix onward** — the
   first meaningful SFT export needs a few days of normal OpenSwan use.
Ops note: the nightly launchd training job runs as ROOT and re-creates
`scripts/blackswan-llm/raw_data/` root-owned each night (interactive
exports hit EACCES). `export_tool_traces.py` gained `--output` as the
escape hatch; the durable fix is reinstalling the job as a user
LaunchAgent (launchd/setup.sh was presumably run with sudo).

## Roadmap completion (P10, 2026-07-02)

Everything deferred above is now built (four parallel subagent builders):

- **v6 SFT pipeline wired end-to-end**:
  `export_tool_traces.py` → `score_trajectories.py` (Cursor's concave
  length penalty C(x)=((1+kx)^(1−q)−1)/(k(1−q)), k=0.1 q=1.5, bounded so
  length never flips a completed run negative; `--top-fraction` emits the
  rejection-sampled slice) → `convert_tool_traces.py` (ShareGPT with
  Qwen-native `<tool_call>` turns; same-iteration steps grouped into ONE
  gpt turn = parallel-call behavior taught; failed runs → separate
  negatives file) → registered in `prepare_dataset_v4.py` at 2x oversample
  (deliberately NOT the 12x app factor — comment explains format-overfit
  risk; `is_app_example` carved out so traces can't silently inherit 12x).
- **Best-of-N race-and-judge**: `src/lib/bestOfNRace.ts` +
  `/bestof model1,model2 <task>` in chat (aliases auto/sonnet/haiku/opus/
  gpt/blackswan; 2–4 candidates; parallel race via `universalInvoke`;
  Sonnet judge with strict-JSON rubric, fastest-successful fallback;
  text-only — no tools, no side effects). Smoke `npm run
  smoke:best-of-n-race`.
- **Embedding flywheel phase 1**: `export_embedding_pairs.py` — (query,
  memory, relevance) pairs from FOUR sources: main-chat persisted
  `memoryRefs` (recovered from the `[[UC_CHAT_META]]` content marker —
  scores survive every byte-cap tier), `room_messages.metadata`
  memory_references, `memory_access_log` joins, and `memory_entries`
  self-pairs as contrastive fallback. Honest gap it prints loudly:
  `retrieveForTurn` callers never pass `runId`, so `memory_access_log`
  rows can't join to their triggering query — the writer fix is one
  threading change (documented in the V7 plan).
- **v7 RL plan**: `docs/BLACKSWAN_V7_RL_PLAN.md` — shadow staging harness
  driving the REAL `executeOpenSwanRuntimeTool` + `runAgent` gates (floor
  tools mocked, never real), reward = score_trajectories.py as executable
  spec + verification/observedEvals enrichment + anti-reward-hacking
  checks, the candid 4B-vs-1T ladder (v6 SFT → RFT → optional GRPO with
  go/no-go per rung), the 8192-token serving pin as a training-shape
  constraint, and per-tool-family executor-swap relaxation gates.
