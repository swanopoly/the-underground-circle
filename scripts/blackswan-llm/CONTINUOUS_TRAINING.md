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
| 4 | `mlx_lm lora --train` | LoRA fine-tune on `mlx-community/Qwen3.5-4B-4bit` (rank 16, alpha 16, 1500 iters by default). |
| 5 | `mlx_lm fuse` | Bakes the adapter into the base, emits HF-format weights. |
| 6 | `fuse_and_upload_v5.py` | Pushes to `cswan801/BlackSwan-v5` on Hugging Face. |
| 7 | `ollama create` *(optional)* | Local deploy so `ollama run blackswan` works on this Mac. |

The orchestrator is `train_cycle_v5.sh` — running it once does all seven
steps. Failure at any step is logged to `~/.blackswan-train/log/cycle-*.log`
and the pipeline exits non-zero so launchd can record the retry.

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
```

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

**Why publish to a single HF repo instead of versioned tags?**
`fuse_and_upload_v5.py` overwrites the `main` branch of
`cswan801/BlackSwan-v5` each cycle, which keeps the consumer side
trivial — `from_pretrained("cswan801/BlackSwan-v5")` always pulls
the latest. HF retains commit history so any older cycle is still
fetchable via SHA when needed.
