# BlackSwan v5 — Continuous Learning Loop

End-to-end pipeline that exports fresh app data from Supabase, trains a
new LoRA on this Mac, fuses it into the base, and pushes the result to
[`huggingface.co/cswan801/BlackSwan-v5`](https://huggingface.co/cswan801/BlackSwan-v5)
on a weekly schedule.

## What runs

| Step | Script | What it does |
|------|--------|---|
| 1 | `export_training_data.py` | Pulls 23 Supabase tables via `training_safe_*` views (respects opt-out). Includes Wave 2: missions, proof-of-work, GitHub events, automations. |
| 2 | `convert_app_data.py` | Turns the raw exports into ShareGPT JSONL — terminal pairs, agent activity, tasks, check-ins, room conversations, **mission planning**, **proof-of-work recaps**, **GitHub shipping summaries**, **automation reports**. |
| 3 | `prepare_dataset_v4.py` | Merges app data (oversampled 12x) with the public corpus, runs PII cleaning + quality filter + Jaccard dedup, splits 95/5 train/eval. |
| 4 | `mlx_lm lora --train` | LoRA fine-tune on `mlx-community/Qwen3.5-4B-4bit` (rank 16, alpha 16, 1500 iters, max_seq_length 2048 by default). |
| 5 | `mlx_lm fuse` | Bakes the adapter into the base, emits HF-format weights. |
| 6 | **Eval gate** (`mlx_lm lora --test`) | Scores the fused model on the held-out set and blocks the upload if it regressed vs the last good cycle. See "Eval gate" below. |
| 7 | `fuse_and_upload_v5.py` | Pushes to `cswan801/BlackSwan-v5`, uploads `training_runs/<ts>.json` metadata, tags the commit `cycle-<ts>`. |
| 8 | `update_hf_endpoint.py` | Points the dedicated HF Inference Endpoint at the freshly pushed revision. |
| 9 | `ollama create` *(optional)* | Local deploy so `ollama run blackswan` works on this Mac. |

The orchestrator is `train_cycle_v5.sh` — running it once does all of these
steps. Failure at any step is logged to `~/.blackswan-train/log/cycle-*.log`
and the pipeline exits non-zero so launchd can record the retry. (Exception:
an eval-gate *block* is a successful cycle that chose not to ship — it exits
0 with loud `SKIPPED — eval gate` banners in the log.)

**Data sources — agent tool traces (P63, 2026-07-10).** Real tool-use runs
(`agent_runs` + `agent_run_events`) now flow through the pipeline: step 1
archives them as raw JSON, and the v6 tool-trace chain
(`export_tool_traces.py` → `score_trajectories.py --top-fraction` →
`convert_tool_traces.py`, merged by `prepare_dataset_v4.py` at 2x as the
`tool_traces` source) owns the ShareGPT conversion — `convert_app_data.py`
deliberately does not touch them. Both exporters prefer the opt-out-safe
`training_safe_agent_runs` / `training_safe_agent_run_events` views
(`20260710_training_safe_agent_runs.sql`, PENDING APPLY) and stay green
before the SQL lands: step 1 skips the missing views (404),
`export_tool_traces.py` falls back to the raw tables with a loud warning.
Trajectories are secret-scrubbed fail-closed (key-name drops, sk-/hf_/ghp_/
JWT/xox value drops, base64 → `[binary omitted]`), bounded (inputs ≤600
canonical chars, errors ≤400, ≤8 tool rounds — oversized runs are skipped,
never truncated), and stuck-solver recoveries are exported as gold
(`solver_consultations` + per-step `solver_note`, rewarded by the scorer).

## First-time setup

```bash
cd ~/the-underground-circle/scripts/blackswan-llm

# 1. Make sure Python deps are installed.
/opt/homebrew/bin/python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install requests datasets huggingface_hub mlx mlx-lm transformers \
            accelerate sentencepiece protobuf safetensors python-dotenv tqdm
deactivate

# 2. Run the SQL migrations (Supabase SQL Editor) so the export
#    pipeline's training_safe_* views exist for the new tables.
#    Files:
#      supabase/migrations/20260312_training_privacy.sql       (already run in prod)
#      supabase/migrations/20260506c_training_safe_wave2_tables.sql
#      supabase/migrations/20260710_training_safe_agent_runs.sql  (P63 — PENDING APPLY)

# 3. Wire the launchd schedule + secrets file.
bash launchd/setup.sh
# Then open ~/.blackswan-train/env.sh and fill in:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HF_TOKEN
```

## Manual cycle (any time)

```bash
cd ~/the-underground-circle/scripts/blackswan-llm
source ~/.blackswan-train/env.sh
./train_cycle_v5.sh
```

Useful flags:

```bash
./train_cycle_v5.sh --skip-export        # use raw_data/ on disk
./train_cycle_v5.sh --skip-train         # data prep only
./train_cycle_v5.sh --skip-push          # don't upload to HF
./train_cycle_v5.sh --iters=2500         # heavier training run
./train_cycle_v5.sh --synthetic=500      # 500 Claude-generated extras
./train_cycle_v5.sh --deploy-ollama      # also do `ollama create blackswan`

BLACKSWAN_EVAL_GATE=warn ./train_cycle_v5.sh   # log regressions but ship anyway
BLACKSWAN_EVAL_GATE=off  ./train_cycle_v5.sh   # skip the eval gate entirely
BLACKSWAN_EVAL_TOLERANCE=0.10 ./train_cycle_v5.sh  # allow up to +10% loss
```

## Eval gate

Between fuse and upload, `train_cycle_v5.sh` (Step 7.5) scores the freshly
fused model and refuses to ship a regressed one. It runs

```
.venv/bin/python -m mlx_lm lora --model models/v5/fused --adapter-path "" \
    --data training_data/mlx_eval_gate --test --test-batches 400 \
    --batch-size 1 --max-seq-length 2048
```

where `training_data/mlx_eval_gate/test.jsonl` is a copy of the cycle's
held-out split (`training_data/mlx_messages/valid.jsonl`). Evaluating the
*fused* model (not base + adapter) means the gate also covers fuse-step
mistakes, since it scores the exact artifact that gets converted and
uploaded. The parsed `Test loss` is compared against the last shipped-good
cycle.

**Knobs (environment variables):**

| Var | Default | Meaning |
|---|---|---|
| `BLACKSWAN_EVAL_GATE` | `block` | `block` = a regression skips upload + endpoint refresh (cycle still exits 0, with loud banners). `warn` = log the regression, ship anyway. `off` = don't run the eval at all. |
| `BLACKSWAN_EVAL_TOLERANCE` | `0.05` | Gate fails when `new_loss > baseline_loss * (1 + tolerance)`. |
| `BLACKSWAN_EVAL_BATCHES` | `400` | Held-out batches to score (batch size 1). `-1` = the entire eval set (~2k examples, slower but lowest variance). |

**Baseline file:** `~/.blackswan-train/last_good_eval.json` —
`{"metric": <loss>, "metric_name": "fused_test_loss", "timestamp": ...,
"adapter_dir": ..., "model_dir": ...}`. It is machine-managed:

- No baseline file → first run **bootstraps**: records the metric and passes.
- Gate **PASS** (or bootstrap) → baseline is updated to this cycle's metric.
- Gate **WARN**/**BLOCK** → baseline is left at the last good value, so a
  slow week-over-week drift can't ratchet the baseline downward.
- To force the next cycle to re-bootstrap: `rm ~/.blackswan-train/last_good_eval.json`.

**Fail-open guarantee:** the gate only blocks on a real measured regression.
Missing eval data, a missing fused model, an eval crash, or unparseable
output all *fail open* — the upload proceeds and the log carries a
`EVAL GATE FAILING OPEN` warning. A broken gate can never wedge the weekly
cycle; it just stops protecting it until fixed.

**Caveats:** the held-out split is rebuilt every cycle (seeded shuffle, but
the corpus grows weekly), so the metric drifts slightly for data reasons
alone — that's what the 5% tolerance absorbs. The legacy `evaluate.py` is
the old Unsloth/CUDA-era evaluator and is not used by the gate; it doesn't
run on this Mac's MLX stack.

## Sequence length and memory

`mlx_lora_v5_config.yaml` trains at `max_seq_length: 2048` (raised from 512
in 2026-07). The old 512 cap was silently truncating multi-turn and
agent-trace examples of up to ~3387 tokens, so the model learned chopped-off
endings for exactly the long examples that matter most.

Memory assumption: the 48GB M4 Pro machine. Measured peak was 11.3GB at
seq 512 (batch 1, grad_checkpoint on); at 2048 expect roughly 3-4x
activation growth (~25-35GB peak). `batch_size` is already 1 — if a cycle
OOMs or swaps hard, drop `max_seq_length` to 1024 or reduce `num_layers`
instead.

## Schedule

Every Sunday at 03:00 local time, launchd runs the wrapper which sources
`~/.blackswan-train/env.sh` and execs `train_cycle_v5.sh`. Logs land in
`/tmp/blackswan-train.{out,err}.log` (truncated at the next run) and a
permanent per-cycle log lives in `~/.blackswan-train/log/cycle-*.log`.

```bash
# Trigger now (don't wait for Sunday)
launchctl kickstart -k gui/$UID/com.underground.blackswan-train

# Watch live
tail -f /tmp/blackswan-train.out.log

# Disable the schedule entirely
launchctl unload ~/Library/LaunchAgents/com.underground.blackswan-train.plist
```

## Why this changed vs the previous setup

- **Was:** stale `train_cycle.sh` from the v3 era invoked
  `format_sharegpt.py`, `prepare_dataset.py`, `train.py` (the Unsloth/CUDA
  path that doesn't run on Apple Silicon). The actual `lora_v2` adapter
  was hand-built with `mlx_lm.lora` outside the script.
- **Now:** `train_cycle_v5.sh` calls the MLX-native commands the
  adapter was actually trained with, so the schedule reproduces what
  was working manually.
- **Was:** `prepare_dataset_v4.py` didn't read `app_data.jsonl` at all.
  Latest training run had 142 app examples in 41,990 total (0.34%).
- **Now:** `app_data.jsonl` is loaded and oversampled 12× before the
  merge. Same 142 base entries become ~1,700 training rows, tilting
  the loss meaningfully toward the app voice.
- **Was:** export script covered messages, terminal, tasks,
  check-ins, agent activity — but nothing about missions or shipping
  events.
- **Now:** export covers `circle_missions`, `mission_tasks`,
  `mission_agents`, `proof_of_work`, `circle_github_events`,
  `automations`. Convert script generates planning conversations
  from missions, weekly shipping recaps from GitHub events, and
  proof-of-work summaries.

## What still requires manual work

- **Validating training-safe views exist in prod.** Run
  `supabase/migrations/20260506c_training_safe_wave2_tables.sql`
  via the Supabase SQL Editor. `export_training_data.py` will fail
  with a 400 on the first weekly run otherwise.
- **HF token in `~/.blackswan-train/env.sh`.** The plist deliberately
  does not embed it.
- **Disk monitoring.** `models/v5/` already eats ~25 GB. Each retrain
  adds ~65 MB for the adapter and ~8 GB for the fused HF weights.
  Either prune older adapter directories (`models/v5/lora_*` from
  prior cycles) or extend `train_cycle_v5.sh` with a retention
  policy. 73 GB free today; comfortable for ~3 cycles before pruning
  is needed.
- **DPO preference training.** Currently SFT-only. Real preference
  pairs from `office_terminal_responses` (positive reactions vs
  follow-up corrections) are a future addition.

## Architecture decisions

**Why oversample app data 12× instead of generating 5K synthetic
examples?**
Synthetic generators (`generate_multiturn_fast.py`,
`generate_synthetic.py`) need an Anthropic key and ~$5 per run. The
12× factor lifts the app share to ~4% of the mix without a per-cycle
API spend. Once we have telemetry that the model voice is closer to
target, we can revisit.

**Why MLX 4-bit, not 27B QLoRA?**
This Mac is 48 GB unified memory. The CLAUDE.md plan called for the
27B base; in practice the `lora_v2` actually trained against
`mlx-community/Qwen3.5-4B-4bit`. 4-bit + 4B is what fits in memory
with headroom for inference + the rest of the dev environment.
Upgrading to 9B is a drop-in change (`--small` is wired in
`run_v5_pipeline.sh` for Linux; would need parallel work in
`train_cycle_v5.sh` to swap the base model).

**Why publish to a single HF repo (now with cycle tags)?**
`fuse_and_upload_v5.py` still overwrites the `main` branch of
`cswan801/BlackSwan-v5` each cycle, which keeps the consumer side
trivial — `from_pretrained("cswan801/BlackSwan-v5")` always pulls
the latest. Since 2026-07 each successful upload additionally:

- tags the resulting commit `cycle-<YYYYMMDD-HHMMSS>` (UTC), and
- uploads `training_runs/<ts>.json` + `training_runs/latest.json`
  with `base_model`, `data_export` counts, the tag name, and the
  eval-gate metric for that cycle.

Tagging is best-effort: a tag or metadata failure warns but never fails
the upload.

## Rolling back a bad cycle

Every shipped cycle is a named tag, so rollback is "point the endpoint at
an older revision":

```bash
# 1. List available rollback points (or browse the HF UI's branches/tags).
python -c "from huggingface_hub import list_repo_refs; \
  print([t.name for t in list_repo_refs('cswan801/BlackSwan-v5').tags])"

# 2. Resolve the commit sha behind a tag.
python -c "from huggingface_hub import HfApi; \
  print(HfApi().model_info('cswan801/BlackSwan-v5', revision='cycle-20260705-031500').sha)"

# 3. Pin the dedicated Inference Endpoint to that sha — either in the HF UI
#    (endpoint -> Settings -> Model Revision), or:
python -c "from huggingface_hub import HfApi; \
  HfApi(token='hf_...').update_inference_endpoint( \
    'blackswan-v5', namespace='cswan801', revision='<sha-from-step-2>')"
```

`update_hf_endpoint.py` always re-pins to the *latest* `main` sha, so a
rolled-back endpoint stays rolled back only until the next successful
weekly cycle ships a (gated, presumed-good) model. `training_runs/<ts>.json`
on the repo records which data export and eval metric each tag corresponds
to.
