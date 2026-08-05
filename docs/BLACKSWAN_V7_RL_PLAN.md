# BlackSwan v7 — RL Inside a Shadow of the Production Harness

> Created: 2026-07-02. The concrete v7 training plan: Cursor's published
> Composer 2 recipe (verified in `docs/BLACKSWAN_COMPOSER_PATTERN.md` — read
> that first) translated onto this repo's actual runtime, eval, and deploy
> infrastructure. Companion to the v6 SFT pipe
> (`scripts/blackswan-llm/export_tool_traces.py`). Nothing here relaxes the
> approval floor or the Sonnet screen-loop pin — see Non-Goals.

## What maps to what

| Plan component | Owner in this repo |
|---|---|
| The loop the policy drives | `src/lib/agentExecutionCore.ts` (`runAgent`, injected `AgentProvider.turn`) |
| Tool catalog + policy + chokepoint | `src/lib/openswanToolRuntime.ts` (`executeOpenSwanRuntimeTool`, `getOpenSwanToolPolicy`, `TOOL_LOOP_SAFE_NAMES`) |
| Pass/fail reward ingredient | `src/lib/openswanVerificationRuntime.ts` (per-check `passed/failed/blocked/manual_required`) |
| Quality reward ingredient | `src/lib/openswanObservedEvals.ts` (`buildOpenSwanObservedEvalSummary`, 0–100 score) |
| Browser/GUI rollout environment | `supabase/functions/computer-use-agent/index.ts` + Browserbase test sessions |
| Trajectory shape + usage mirror | `scripts/blackswan-llm/export_tool_traces.py` (`raw_data/tool_traces.jsonl`) |
| Offline reward scorer (the reward's executable spec) | `scripts/blackswan-llm/score_trajectories.py` (`score_trajectory`, `concave_length_cost`, `--top-fraction` rejection slice) |
| Train/deploy loop v7 slots into | `train_cycle_v5.sh` → `prepare_dataset_v4.py` → `fuse_and_upload_v5.py` → `update_hf_endpoint.py` |
| Executor swap being challenged | `src/lib/blackswanRouting.ts` (`shouldUseToolExecutorInsteadOfBlackSwan` → `claude-haiku-4-5`) |

## 1. Objective + success gates

Objective: make BlackSwan a **native tool-calling executor on the OpenSwan
catalog** for its own lanes — so `resolveOpenSwanToolLoopModel` can stop
swapping every tool-bearing BlackSwan turn onto `claude-haiku-4-5` — without
touching any safety rail. RL is the *means*; the executor-swap relaxation is
the only routing change on the table, and it relaxes per tool family, never
wholesale.

Gates, in order. Each gate is a hard stop — failing it means v7 does not ship
and the swap stays as-is:

| Gate | Where it runs | Pass criteria |
|---|---|---|
| **A — offline tool-calling** | Frozen offline suite: held-out `tool_traces.jsonl` runs + synthetic app tasks | ≥95% syntactically valid tool-call JSON; ≥85% top-1 tool selection vs reference; ≥90% argument-shape validity against `inputSchema`; **zero** floored (pay/delete/login/grant) calls emitted without a preceding `approvals.request`; beats the v6 SFT checkpoint on all four |
| **B — shadow A/B vs the executor** | Shadow harness (§2), same seeded tasks, v7 vs `claude-haiku-4-5` driving the identical `runAgent` loop | v7 completion rate ≥ executor's on the app-task eval suite (§3 families), at ≤ executor's median tokens **and** turns; policy-block + floor-violation count ≤ executor's; no `retry-after-policy-block` regressions |
| **C — production shadow** | Real Auto-lane turns mirrored into the shadow harness for ≥1 week (no user impact) | `buildOpenSwanObservedEvalAggregate` parity: averageScore within 2 pts of the executor baseline, blockerRate not worse |

Only after A+B+C does `shouldUseToolExecutorInsteadOfBlackSwan` gain a
per-family allowlist (e.g. relax for `tasks.*`/`goals.*`/`memory` reads first),
flag-gated exactly like `DEPLOY_AGENTS_TOOL_ENABLED` so one revert restores
today's behavior. Explicit model picks and the screen loop are untouched at
every stage.

## 2. Shadow harness

Cursor's defining move is a **shadow deployment of the production backend**
with the real tool library invoked over RPC. Our translation is cheap because
the runtime is already factored for it:

- **Staging Supabase project** (separate project ref, same migrations) with
  seeded test circles: members, missions, goals, tasks, rooms + files, memory
  bank entries, a throwaway WordPress sandbox site, and vault rows pointing
  only at sandbox credentials. Each rollout episode clones a fresh circle
  (one circle's rows, not a project reset) so parallel rollouts never collide;
  reset = re-seed, keyed by a fixed seed for determinism.
- **The tool library is the production code, verbatim.** A Node rollout
  worker builds the loop with `runAgent` and registers handlers that call
  `executeOpenSwanRuntimeTool(tool, args, { circleId: <test circle>, userId:
  <seeded bot>, surface: 'task_run' })` — the same chokepoint production uses,
  pointed at the staging project. That keeps the QW1 constraint guard and the
  R11 approval gate **live inside training**: the policy learns against the
  same fail-closed policy blocks it will see in production ("Do not retry the
  same call…" tool_results), which is the whole point of unifying RL and prod
  environments. Memory/semantic search stays what it already is — an external
  RPC dependency (`search_memories` → staging Supabase RPC) — mirroring
  Cursor's externally hosted semantic search.
- **Context reality**: the serving endpoint pins
  `max_position_embeddings = 8192` (`fuse_and_upload_v5.py`, L4 GPU compat),
  and the full catalog is ~157 advertised schemas — it does not fit. Rollouts
  therefore run with **progressive disclosure exactly as production does**:
  `listPinnedOpenSwanToolsForSurface` for the pinned core + `tools.search`
  unlocking deferred tools via `runAgent`'s `resolveAdditionalTools` seam.
  v7 must be trained to search the catalog; training with the full schema
  dump would be training a model we cannot serve.

### Allowed vs mocked in rollouts

| Class | Tools (examples) | Treatment |
|---|---|---|
| Read-only, `approvalMode: 'auto'` | `tasks.list/get`, `goals.list`, `missions.list`, `rooms.list*/read_file`, `messages.list/search`, `check_ins.list`, `search_memories`, `context.search`, `tools.search`, `integrations.list`, `wp.discover_types/list_posts`, `vault.list/find/grants/runbook` (redacted), `browser.dom_snapshot/screenshot/verification_state`, `github.*` (against a test repo), `fetch_url` (allowlisted hosts) | **Live** against staging |
| Reversible mutations on test circles | `tasks.create/update_status/assign/comment`, `goals.create/update_*`, `missions.create*/update_*`, `rooms.create/rename/send_message/create_file/update_file`, `memory.pin/unpin`, `save_memory`, `check_ins.log`, `messages.create`, `skills.view` | **Live** — reversible by episode re-seed |
| WordPress sandbox writes | `wp.upload_media/create_slide/update_post` + `browser.*` fills against the sandbox wp-admin | **Live on the sandbox only**; origin-pinned |
| Approval-floor + irreversible + spend | anything hitting the pay/delete/login/grant floor, `credentials.get`, `vault.grant/revoke`, `wp.trash_post`, `memory.forget`, `team.deploy_agents`, `custom_api.request` to third parties, `agent.codex_*`, `schedule_action` side effects | **NEVER real. Hard rule.** Mock at the dispatcher seam: the gate still fires, the "approval pending / confirmation required, not performed" tool_result is returned deterministically (or a scripted approval grants a *mocked* execution result). The policy learns the request-approval choreography without a single real floored action |
| Desktop bridge | all `desktop.*` | Mocked — rollout workers have no local bridge; return deterministic canned observations (`window_state`, `list_running_apps`, a11y trees) recorded from real bridge sessions |

- **Browser/GUI environment analog**: where Cursor uses Firecracker VMs with
  a browser, we use **Browserbase test sessions** driven through the same
  action vocabulary as `computer-use-agent`. Budget per rollout reuses the
  production rails from `_shared/booking-edge-contract.ts`: default 12
  iterations / 75k tokens / 5-minute wall clock, hard ceilings 40 iterations /
  200k tokens for the few booking-shaped eval tasks, plus a per-rollout dollar
  cap and a daily Browserbase session cap. A browser rollout that exhausts its
  budget is a failed trajectory, not a retried one.

## 3. Task distribution

Cursor: "the task distribution mirrors real usage." Ours is derived, not
invented: `export_tool_traces.py` already exports every run's
`surface`/`mode`/`model` and per-step tool names — re-run each cycle and take
the surface × mode × tool-family histogram as the sampling prior. Starting
weights (until the first histogram refresh), over the app's actual task
families:

| Family | Example rollout tasks | Environment | Init weight |
|---|---|---|---|
| Missions/tasks | list → create → assign → complete loops; follow-up comments; artifact attach | staging RPC | 25% |
| Memory | `search_memories`/`save_memory`/pin/unpin + grounded status answers | staging RPC | 15% |
| Rooms/workspace | create room, write/update/read files, room tasks, `workspace.apply_artifacts` | staging RPC | 15% |
| WordPress | `wp.discover_types`/`list_posts` reads; sandbox slide/media/post edits with proof | staging RPC + Browserbase sandbox | 15% |
| Watches | `/watch` create/list/stop (`computer_use_schedules`), change-only re-check summaries | staging RPC (+ Browserbase for the check) | 10% |
| Research/browse | `fetch_url`, `research.search/save`, browse-with-proof tasks | Browserbase | 10% |
| Fast paths | status/casual/social lanes — zero-or-one tool, answer quickly | staging RPC | 10% |

Every family includes deliberately *blocked* variants (missing access, floored
action, stale page) so the policy earns reward for stopping and asking — the
`support`-mode behavior `openswanObservedEvals` already scores as "unblock
path".

## 4. Reward design

The reward's executable spec is `scripts/blackswan-llm/score_trajectories.py`
— already running offline against `tool_traces.jsonl` for the rejection-
sampling rung. As implemented:

```
reward = base + evidence − efficiency − tool_quality + parallel

base       = +1.0 if run.status == "completed", −1.0 if "failed"
evidence   = +0.1 if the final message is non-empty AND ≥1 step has ok=true
efficiency = 0.03 · C(x)                 (EFFICIENCY_WEIGHT · concave cost)
  C(x) = ((1 + k·x)^(1−q) − 1) / (k·(1−q))    k = 0.1, q = 1.5 to start
  x    = 1.0·len(steps) + 1.0·(total_duration_ms / 10_000)
tool_quality = 0.05 per failed call (ok is not true), capped at 0.30
parallel     = +0.05 if any iteration carries ≥2 tool calls
```

- **The concave length/turn penalty** is Cursor's published form. `C(0)=0`,
  `C'(0)=1`: the first extra steps/seconds cost the most marginal reward —
  hard pressure to finish easy tasks in 1–2 turns — while `q>1` bounds the
  whole penalty at `weight/(k·(q−1)) = 0.6` with the defaults, so **length
  alone can never flip a completed run negative** (and a fast failure still
  scores −1.0, so efficiency can't be farmed by quitting early). The
  `parallel` bonus is the same lever from the other side: it pays the policy
  to batch reads in one round, which `runAgent` dispatches concurrently.
- **v7 shadow-harness enrichment** (same constants, richer terms — extend
  `score_trajectories.py`, don't fork it):
  - `base` upgrades from binary run status to graded task completion:
    `base = 2·(0.6·V + 0.4·E) − 1`, where `V` = passed/required verification
    checks from `executeOpenSwanVerificationPlan` (any required check
    `blocked` or unexecuted caps `V` at 0.5 — unverified ≠ verified), and
    `E` = `buildOpenSwanObservedEvalSummary().score / 100` with the
    regex-heuristic `responseQuality` component's share capped at 25%
    (anti-stuffing, below). Offline traces lack these fields, hence the
    status-based base today; shadow rollouts have both.
  - `x` gains a token term (`tokens/T_ref` with per-family reference medians
    from the trace histogram) alongside steps + duration — Cursor penalizes
    tokens *and* turns.
  - `tool_quality` adds −0.10 per abandoned step (created task/mission left
    dangling at episode end, or the same failing call repeated ≥2× — our
    "abandoned to-dos") and −0.15 per retry-after-policy-block (the
    tool_result explicitly said "Do not retry the same call").
  - `evidence` tightens from "any ok call before a non-empty final" to
    proof-aware: task families whose evidence contract requires proof earn
    the bonus only when a durable artifact of the right kind exists
    (`browser_proof`, `test_result`, `diff`, `report` — the
    `DURABLE_ARTIFACT_KINDS` set); missing required proof also caps `base`
    at 0.
- **Anti-reward-hacking checks**:
  - *Verification-gaming*: structurally blocked already — `verification.*`
    pins its commands server-side and ignores any model-supplied `command`
    (`DEFAULT_VERIFICATION_COMMANDS`, security note in
    `executeOpenSwanTool`). Keep it that way in the shadow harness; the
    policy can run checks, never redefine them.
  - *Heuristic-stuffing*: `observedEvals.responseQuality` is regex-based
    ("recommend", "trade-off", bullets…) and therefore gameable. Cap its
    share of `E` at 25%, and LLM-judge a random 10% of high-reward
    trajectories each batch; a judge/heuristic divergence > threshold quarantines
    the batch and the offending prompts.
  - *Proof fabrication*: `B_evidence` counts only harness-observed artifacts
    (the rollout worker records them from `runAgent` events), never
    model-asserted ones.
  - *Holdout*: Gate A's eval suite is frozen and never used for reward
    tuning or sampling.

## 5. Rollout mechanics

- **Trajectory format** extends the `export_tool_traces.py` row so v6 SFT
  data, RL rollouts, and eval replays share one shape:

  ```
  { "run":   {surface, mode, model, status, title, goal},
    "steps": [{iteration, tool, input, ok, duration_ms, error?}, ...],
    "final": "...",
    "meta":  {run_id, circle_id, created_at, chain_id?, segment?},
    "usage": {tokens, turns},
    "reward": <float>,                      ← keys as score_trajectories.py
    "reward_breakdown": {base, evidence_bonus, efficiency_penalty,
                         tool_quality_penalty, parallelism_bonus, ...} }
  ```

  The rollout worker materializes `steps` directly from `runAgent`'s
  `tool_call_start`/`tool_call_result`/`final_response` events — the same
  events `agent_run_events` persists in production, so mirrored production
  runs (Gate C) and synthetic rollouts are byte-compatible.
- **Self-summarization chains** (Cursor's long-horizon trick, mandatory for
  us because of the 8192-token serving window): when a rollout's context
  approaches ~6k tokens, the harness forces a summarize-and-continue turn
  through `runAgent`'s `compaction` seam — with the **policy itself as the
  summariser**, so it learns to write state summaries it can act on. Each
  segment becomes a trajectory row sharing `chain_id`; reward is computed on
  the chain, then attributed to segments (completion reward on the final
  segment, penalties where incurred).
- **Parallelism**: rollout workers are stateless Node processes (one cloned
  circle each); 16–32 concurrent RPC rollouts is ample at our scale. Browser
  rollouts are additionally capped by Browserbase concurrent-session limits
  and the per-rollout budget. Policy inference serves from a local `mlx_lm`
  server during RFT sampling, or vLLM on the rented node during GRPO (§6).
- **Failed rollouts feed negatives** — the exporter already keeps failed runs
  "as negatives", and the pipeline already has consumers:
  `score_trajectories.py --top-fraction` splits completed rows into a
  top slice (`tool_traces_top.jsonl`, the accepted side) and a remainder;
  failed-status rows (base −1.0), bottom-ranked completions, and Gate-A
  format violations become the rejected side of preference pairs for
  `merge_dpo.py` → `train_dpo_v5.py`, and hard negatives for the next RFT
  round's filters. Nothing is thrown away; a policy-block violation is the
  most valuable row in the batch.

## 6. Compute + base-model reality check

Honest paragraph first: **BlackSwan is a Qwen3.5-4B LoRA fine-tune trained on
a Mac with MLX and served on a single L4 at 8k context. Cursor RL-trained a
1.04T-parameter MoE inside a Firecracker fleet with a dedicated RL platform.**
We are not going to teach a 4B model long-horizon novel reasoning, robust
recovery from arbitrary tool errors, or frontier coding with any amount of
RL. What a 4B *can* credibly learn from RL-shaped training — and what Gates
A/B actually measure — is narrow and valuable: emitting syntactically valid
tool calls every time, picking the right tool from a searched catalog,
correct argument shapes, stopping early on easy tasks, requesting approval
instead of attempting floored actions, and citing evidence before claiming.
Those are habit-shaped behaviors, exactly the kind small models pick up from
RFT/GRPO on in-distribution tasks — and exactly what the executor swap
currently exists to compensate for.

The pragmatic ladder, with go/no-go at each rung:

| Rung | What | Compute | Go/no-go |
|---|---|---|---|
| **1. v6 SFT** (prereq, already unblocked) | Add `tool_traces.jsonl` as a source in `prepare_dataset_v4`/`convert_app_data`; retrain via `train_cycle_v5.sh` | Existing Mac/MLX weekly cycle | **Go to rung 2** only if Gate A's format metrics reach ≥90/80/85 (valid/selection/args). If SFT can't get close, RL will not save it — stop and fix the data |
| **2. RFT / rejection sampling** (the default win path) | Sample k=8 rollouts per task in the shadow harness, score with `score_trajectories.py` (§4), keep the top slice per task (`--top-fraction` → `tool_traces_top.jsonl`) as SFT rows; rejected siblings → DPO pairs | Existing MLX pipeline + rollout workers; no new hardware | **Go to rung 3** only if RFT beats v6 by ≥5 pts on the frozen suite *and* plateaus across two consecutive cycles *and* chat-lane quality (BlackSwan Auto lanes) shows no regression. If RFT keeps improving, stay here — it is most of Composer's benefit at ~5% of the complexity |
| **3. Small-scale GRPO** | GRPO on tool-call tasks only: groups of 8–16 rollouts/prompt, group-normalized advantage, LoRA-only updates, ~5–10k prompts, KL-anchored to the RFT checkpoint | One rented A100/H100 node (TRL or verl + vLLM); the only rung needing non-Mac compute | Ship only via Gates A→B→C. **Abandon** if reward hacking appears (judge/heuristic divergence), if chat lanes regress, or if it can't beat the rung-2 checkpoint within two runs |

Rung 3 is explicitly optional. The plan succeeds if rung 2 alone passes Gate B
— "GRPO" is not the goal, beating `claude-haiku-4-5` on our app-task suite is.

## 7. Deployment loop

A v7 candidate is a LoRA adapter, so it rides the existing weekly path
unchanged:

1. Adapter lands in `models/v5/lora_v2/` (train_cycle keeps the last 3
   timestamped adapter dirs — that's the weight-level rollback pool).
2. `fuse_and_upload_v5.py`: fuse on `mlx-community/Qwen3.5-4B-4bit`,
   dequantize to bf16, MLX→HF tensor remap, upload to
   **`cswan801/BlackSwan-v5`** — the repo name does not change (app model IDs
   `huggingface/…` and `huggingface_endpoint/cswan801/BlackSwan-v5` are baked
   into routing and CHECK constraints); *versions are HF commit SHAs*, so
   record the pre-push SHA as last-known-good before every upload.
3. `update_hf_endpoint.py` pins the dedicated endpoint to the new revision and
   polls to `running`/`scaledToZero`.
4. **Runtime proof before any flip** (CLAUDE.md rule: selectable ≠ working):
   after the endpoint settles, run a probe suite through the *real* runtime
   path — `llm-proxy` → `huggingface_endpoint/cswan801/BlackSwan-v5` — that
   exercises a native tool-call round trip plus a Gate-A eval subset. Only a
   green probe permits touching the executor-swap allowlist flag, and the flag
   flips for the proven tool families only.

Rollback story, in decreasing order of blast radius:

| Failure | Rollback | Cost |
|---|---|---|
| v7 misbehaves in routing | Revert the executor-swap allowlist flag → every tool-bearing BlackSwan turn swaps back to `claude-haiku-4-5` (today's behavior) | Instant, no redeploy |
| Bad weights on the endpoint | Re-run `update_hf_endpoint.py` pinned to the recorded last-known-good SHA (it already pins by explicit `revision`) | ~minutes (endpoint reload) |
| Bad adapter lineage | Re-fuse from a retained `models/v5/lora_<ts>/` dir and re-upload | One fuse+upload cycle |

## 8. Explicit non-goals

- **No approval-floor relaxation, ever, from this initiative.** The
  pay/delete/login/grant always-confirm floor, the QW1 constraint guard, and
  fail-closed gate errors stay exactly as implemented in
  `agentExecutionCore.ts` / `openswanToolRuntime.ts`, regardless of how well
  v7 scores. Training *against* the gates is the design; weakening them is
  not.
- **The native screenshot/action loop stays Sonnet-pinned.**
  `computer-use-agent`'s `resolveComputerUseModel` keeps coercing to
  `claude-sonnet-4-6`; v7 may plan browser tasks (that's live P9 behavior),
  it never drives the screen.
- Explicit model picks stay authoritative; v7 enters only Auto lanes and the
  executor seam behind its gates.
- No renaming `default::blackswan`, no new HF repo, no local Ollama revival —
  only the dedicated-endpoint `cswan801/BlackSwan-v5` path is BlackSwan.
- No real `desktop.*` execution in rollouts, no training rows containing
  secrets (the exporter's PII/secret scrub is a precondition, not an option),
  and no `team.deploy_agents` spend from training infrastructure.
