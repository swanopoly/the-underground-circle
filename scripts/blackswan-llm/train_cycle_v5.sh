#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# BlackSwan v5 — Continuous Learning Cycle (MLX edition)
#
# Single-command end-to-end retrain pulling fresh data from Supabase,
# converting it, training a new LoRA on the MLX-Community Qwen3.5-4B
# 4-bit base, fusing the adapter, and pushing the result back to
# huggingface.co/cswan801/BlackSwan-v5.
#
# This is the MLX-native v5 pipeline that actually trained the
# `lora_v2` adapter shipping today (the older train_cycle.sh used the
# Unsloth/CUDA path which doesn't run on Apple Silicon).
#
# Usage:
#   ./train_cycle_v5.sh                   # full export → train → push
#   ./train_cycle_v5.sh --skip-export     # use the raw_data already on disk
#   ./train_cycle_v5.sh --skip-train      # data prep + skip training
#   ./train_cycle_v5.sh --skip-push       # don't upload to HF
#   ./train_cycle_v5.sh --iters=2500      # override training iters
#   ./train_cycle_v5.sh --base-model=mlx-community/Qwen3.5-9B-4bit
#   ./train_cycle_v5.sh --deploy-ollama   # also deploy locally to Ollama
#
# Environment:
#   SUPABASE_URL                  required for --skip-export=false
#   SUPABASE_SERVICE_ROLE_KEY     required for --skip-export=false
#   HF_TOKEN                      required for --skip-push=false
#   ANTHROPIC_API_KEY             optional, used by synthetic generators
#   BLACKSWAN_EVAL_GATE           eval gate mode: block (default) | warn | off
#   BLACKSWAN_EVAL_TOLERANCE      allowed relative loss regression vs the
#                                 last good cycle (default 0.05 = +5%)
#   BLACKSWAN_EVAL_BATCHES        held-out batches to score, -1 = full set
#                                 (default 400)
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Defaults ──────────────────────────────────────────────────────────
SKIP_EXPORT=false
SKIP_TRAIN=false
SKIP_PUSH=false
DEPLOY_OLLAMA=false
ITERS=1500
SYNTHETIC_COUNT=0   # set >0 to call the synthetic generator
BASE_MODEL="mlx-community/Qwen3.5-4B-4bit"
DEFAULT_UPLOAD_BASE_MODEL="mlx-community/Qwen3.5-4B-4bit"
MLX_CONFIG="mlx_lora_v5_config.yaml"
LOG_DIR="${HOME}/.blackswan-train/log"
LOG_FILE="${LOG_DIR}/cycle-$(date +%Y%m%d-%H%M%S).log"

# Eval gate (Step 7.5): score the fused model on the held-out set before it
# is allowed to ship. See CONTINUOUS_TRAINING.md ("Eval gate").
EVAL_GATE_MODE="${BLACKSWAN_EVAL_GATE:-block}"       # block | warn | off
EVAL_TOLERANCE="${BLACKSWAN_EVAL_TOLERANCE:-0.05}"   # allowed relative loss increase
EVAL_BATCHES="${BLACKSWAN_EVAL_BATCHES:-400}"        # -1 = entire held-out set
EVAL_BASELINE_FILE="${HOME}/.blackswan-train/last_good_eval.json"
UPLOAD_ALLOWED=true   # flipped to false when the eval gate blocks

for arg in "$@"; do
  case $arg in
    --skip-export)        SKIP_EXPORT=true ;;
    --skip-train)         SKIP_TRAIN=true ;;
    --skip-push)          SKIP_PUSH=true ;;
    --deploy-ollama)      DEPLOY_OLLAMA=true ;;
    --iters=*)            ITERS="${arg#*=}" ;;
    --synthetic=*)        SYNTHETIC_COUNT="${arg#*=}" ;;
    --base-model=*)       BASE_MODEL="${arg#*=}" ;;
  esac
done

# --- BEGIN eval-gate decision logic (self-contained so it can be extracted
# --- and tested standalone; no globals, no side effects) ---------------------
# Compare a freshly measured eval loss against the last-good baseline file.
#   usage:  blackswan_eval_gate_decision <mode> <new_loss> <baseline_file> <tolerance>
#   stdout: "OFF" | "BOOTSTRAP baseline=none" | "PASS baseline=<x>"
#           | "WARN baseline=<x>" | "BLOCK baseline=<x>"
#   exit:   1 only for BLOCK, 0 otherwise.
# Verdicts (lower loss = better):
#   OFF        mode=off — caller should skip eval entirely
#   BOOTSTRAP  no readable baseline — record this run's metric and allow upload
#   PASS       new_loss <= baseline * (1 + tolerance) — allow upload, update baseline
#   WARN       regression, but mode=warn — allow upload, keep the old baseline
#   BLOCK      regression and mode=block — skip upload + endpoint refresh
blackswan_eval_gate_decision() {
    local mode="$1" new_loss="$2" baseline_file="$3" tolerance="$4"
    if [ "${mode}" = "off" ]; then
        echo "OFF"
        return 0
    fi
    local baseline=""
    if [ -f "${baseline_file}" ]; then
        baseline="$(sed -n 's/.*"metric"[[:space:]]*:[[:space:]]*\([0-9][0-9.eE+-]*\).*/\1/p' "${baseline_file}" | head -n1)"
    fi
    if [ -z "${baseline}" ]; then
        echo "BOOTSTRAP baseline=none"
        return 0
    fi
    if awk -v n="${new_loss}" -v b="${baseline}" -v t="${tolerance}" \
        'BEGIN { exit !(n + 0 <= b * (1 + t)) }'; then
        echo "PASS baseline=${baseline}"
        return 0
    fi
    if [ "${mode}" = "warn" ]; then
        echo "WARN baseline=${baseline}"
        return 0
    fi
    echo "BLOCK baseline=${baseline}"
    return 1
}
# --- END eval-gate decision logic --------------------------------------------

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   🦢  BlackSwan v5 — Continuous Learning Cycle          ║"
echo "║   $(date -u +%Y-%m-%dT%H:%M:%SZ)                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "Log: ${LOG_FILE}"
echo
echo "Config:"
echo "  skip-export:    ${SKIP_EXPORT}"
echo "  skip-train:     ${SKIP_TRAIN}"
echo "  skip-push:      ${SKIP_PUSH}"
echo "  deploy-ollama:  ${DEPLOY_OLLAMA}"
echo "  iters:          ${ITERS}"
echo "  synthetic:      ${SYNTHETIC_COUNT}"
echo "  base-model:     ${BASE_MODEL}"
echo "  eval-gate:      ${EVAL_GATE_MODE} (tolerance=${EVAL_TOLERANCE}, batches=${EVAL_BATCHES})"
echo

if [ "${BASE_MODEL}" != "${DEFAULT_UPLOAD_BASE_MODEL}" ] && [ "${SKIP_PUSH}" = false ]; then
    echo "ERROR: Push/upload conversion currently supports ${DEFAULT_UPLOAD_BASE_MODEL} only."
    echo "  Re-run with --skip-push for ${BASE_MODEL}, then update fuse_and_upload_v5.py before publishing."
    exit 1
fi

# ─── Python env ────────────────────────────────────────────────────────
if [ ! -d "${SCRIPT_DIR}/.venv" ]; then
    echo "ERROR: ${SCRIPT_DIR}/.venv missing. Run setup first:"
    echo "  /opt/homebrew/bin/python3.12 -m venv .venv"
    echo "  source .venv/bin/activate && pip install -r requirements.txt mlx mlx-lm"
    exit 1
fi
PYTHON="${SCRIPT_DIR}/.venv/bin/python"

# Quick sanity check that the deps that matter are present.
"${PYTHON}" -c "import mlx_lm, datasets, huggingface_hub, requests" \
    || { echo "ERROR: Python deps missing. Re-run pip install."; exit 1; }

# ─── Step 1: Export from Supabase ──────────────────────────────────────
if [ "${SKIP_EXPORT}" = false ]; then
    echo "═══ Step 1: Export from Supabase ════════════════════════════"
    if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
        echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
        echo "  export SUPABASE_URL=https://<project>.supabase.co"
        echo "  export SUPABASE_SERVICE_ROLE_KEY=eyJ..."
        exit 1
    fi
    "${PYTHON}" export_training_data.py
    echo
else
    echo "═══ Step 1: Skipped (--skip-export) ═════════════════════════"
    echo "  Using raw_data/ as-is."
    echo
fi

# ─── Step 2: Convert app data to ShareGPT ──────────────────────────────
echo "═══ Step 2: Convert app data → ShareGPT ═════════════════════"
"${PYTHON}" convert_app_data.py
echo

# ─── Step 3: (Optional) synthetic generation ───────────────────────────
if [ "${SYNTHETIC_COUNT}" -gt 0 ]; then
    echo "═══ Step 3: Generate ${SYNTHETIC_COUNT} synthetic examples ══"
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
        echo "  ANTHROPIC_API_KEY missing — skipping synthetic generation."
    else
        "${PYTHON}" generate_multiturn_fast.py --count "${SYNTHETIC_COUNT}" || true
    fi
    echo
else
    echo "═══ Step 3: Skipped (no --synthetic= flag) ══════════════════"
    echo
fi

# ─── Step 4: Prepare merged dataset ────────────────────────────────────
echo "═══ Step 4: Prepare merged training dataset ═════════════════"
"${PYTHON}" prepare_dataset_v4.py
echo

# ─── Step 5: Convert to current MLX message format ─────────────────────
# Current mlx-lm expects OpenAI-style {"messages": [...]} records, not
# ShareGPT {"conversations": [...]} turns.
echo "═══ Step 5: Build MLX message training shards ═══════════════"
"${PYTHON}" convert_mlx_messages.py
echo "  train: $(wc -l < training_data/mlx_messages/train.jsonl) lines"
echo "  valid: $(wc -l < training_data/mlx_messages/valid.jsonl) lines"
echo

# ─── Step 6: Train the LoRA ────────────────────────────────────────────
if [ "${SKIP_TRAIN}" = false ]; then
    echo "═══ Step 6: Train LoRA on ${BASE_MODEL} ═══════════════════"
    ADAPTER_OUT="models/v5/lora_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "${ADAPTER_OUT}"

    "${PYTHON}" -m mlx_lm lora \
        -c "${MLX_CONFIG}" \
        --model "${BASE_MODEL}" \
        --data training_data/mlx_messages \
        --iters "${ITERS}" \
        --adapter-path "${ADAPTER_OUT}"
    echo "  Adapter saved to ${ADAPTER_OUT}"

    # Always also copy to the canonical lora_v2/ location so the fuser
    # picks it up.
    cp -f "${ADAPTER_OUT}/adapters.safetensors" models/v5/lora_v2/adapters.safetensors
    cp -f "${ADAPTER_OUT}/adapter_config.json"  models/v5/lora_v2/adapter_config.json
    echo
else
    echo "═══ Step 6: Skipped (--skip-train) ══════════════════════════"
    echo
fi

# ─── Step 7: Fuse adapter into base ────────────────────────────────────
if [ "${SKIP_TRAIN}" = false ] || [ "${SKIP_PUSH}" = false ]; then
    echo "═══ Step 7: Fuse adapter → fused HF model ═══════════════════"
    "${PYTHON}" -m mlx_lm fuse \
        --model "${BASE_MODEL}" \
        --adapter-path models/v5/lora_v2 \
        --save-path models/v5/fused \
        --dequantize
    echo
fi

# ─── Step 7.5: Eval gate — score the fused model before it can ship ────
# Measures held-out test loss on the freshly fused model and compares it
# against the last shipped-good cycle (~/.blackswan-train/last_good_eval.json).
# A regression beyond EVAL_TOLERANCE blocks Steps 8/8.5 when the mode is
# 'block'. Infrastructure problems (missing eval data, missing fused model,
# eval crash, unparseable output) FAIL OPEN with a loud warning so a broken
# gate can never wedge the weekly cycle. See CONTINUOUS_TRAINING.md.
if [ "${SKIP_PUSH}" = true ]; then
    echo "═══ Step 7.5: Eval gate skipped (--skip-push: nothing to protect) ═"
    echo
elif [ "${EVAL_GATE_MODE}" = "off" ]; then
    echo "═══ Step 7.5: Eval gate disabled (BLACKSWAN_EVAL_GATE=off) ══"
    echo
else
    echo "═══ Step 7.5: Eval gate (mode=${EVAL_GATE_MODE}, tolerance=${EVAL_TOLERANCE}) ═"
    GATE_METRIC=""
    EVAL_SRC="training_data/mlx_messages/valid.jsonl"
    EVAL_DATA_DIR="training_data/mlx_eval_gate"
    if [ ! -f "${EVAL_SRC}" ]; then
        echo "  WARNING: ${EVAL_SRC} missing — cannot evaluate."
        echo "  EVAL GATE FAILING OPEN: upload will proceed UNVERIFIED."
    elif [ ! -d models/v5/fused ]; then
        echo "  WARNING: models/v5/fused missing — nothing to evaluate."
        echo "  EVAL GATE FAILING OPEN: upload will proceed UNVERIFIED."
    else
        # mlx_lm expects a data dir containing test.jsonl for --test mode;
        # stage the held-out set under a dedicated dir so nothing else is
        # affected. --adapter-path "" scores the fused model as-is (the
        # exact artifact Step 8 uploads), no adapter re-applied on top.
        mkdir -p "${EVAL_DATA_DIR}"
        cp -f "${EVAL_SRC}" "${EVAL_DATA_DIR}/test.jsonl"
        EVAL_LOG="$(mktemp -t blackswan-eval-gate)"
        echo "  Scoring fused model on $(wc -l < "${EVAL_DATA_DIR}/test.jsonl" | tr -d ' ') held-out examples"
        echo "  (test-batches=${EVAL_BATCHES}, batch-size=1, max-seq-length=2048)"
        if "${PYTHON}" -m mlx_lm lora \
            --model models/v5/fused \
            --adapter-path "" \
            --data "${EVAL_DATA_DIR}" \
            --test \
            --test-batches "${EVAL_BATCHES}" \
            --batch-size 1 \
            --max-seq-length 2048 2>&1 | tee "${EVAL_LOG}"; then
            GATE_METRIC="$(sed -n 's/.*Test loss \([0-9][0-9.]*\).*/\1/p' "${EVAL_LOG}" | tail -n1)"
        fi
        rm -f "${EVAL_LOG}"

        if [ -z "${GATE_METRIC}" ]; then
            echo "  WARNING: eval run failed or produced no 'Test loss' line."
            echo "  EVAL GATE FAILING OPEN: upload will proceed UNVERIFIED (this is"
            echo "  an eval-infrastructure failure, not a model verdict — fix the gate)."
        else
            VERDICT_LINE="$(blackswan_eval_gate_decision "${EVAL_GATE_MODE}" "${GATE_METRIC}" "${EVAL_BASELINE_FILE}" "${EVAL_TOLERANCE}" || true)"
            VERDICT="${VERDICT_LINE%% *}"
            echo "  held-out test loss: ${GATE_METRIC}  ->  verdict: ${VERDICT_LINE}"
            case "${VERDICT}" in
                BOOTSTRAP|PASS)
                    if [ "${VERDICT}" = "BOOTSTRAP" ]; then
                        echo "  No baseline yet — recording this cycle as the first baseline."
                    fi
                    GATE_METRIC="${GATE_METRIC}" \
                    EVAL_BASELINE_FILE="${EVAL_BASELINE_FILE}" \
                    ADAPTER_DIR="${ADAPTER_OUT:-models/v5/lora_v2}" \
                    "${PYTHON}" - <<'PYEOF'
import json, os, time
path = os.environ["EVAL_BASELINE_FILE"]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "metric": float(os.environ["GATE_METRIC"]),
    "metric_name": "fused_test_loss",
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "adapter_dir": os.environ.get("ADAPTER_DIR", ""),
    "model_dir": "models/v5/fused",
}
with open(path, "w") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
print(f"  Baseline updated: {path} (metric={payload['metric']})")
PYEOF
                    ;;
                WARN)
                    echo "  !! EVAL REGRESSION beyond tolerance, but BLACKSWAN_EVAL_GATE=warn:"
                    echo "  !! upload proceeds anyway; baseline NOT updated."
                    ;;
                BLOCK)
                    UPLOAD_ALLOWED=false
                    echo "  !! EVAL REGRESSION beyond tolerance — upload and endpoint"
                    echo "  !! refresh will be SKIPPED. Baseline NOT updated."
                    ;;
                *)
                    echo "  WARNING: unexpected gate verdict '${VERDICT_LINE}'."
                    echo "  EVAL GATE FAILING OPEN: upload will proceed UNVERIFIED."
                    ;;
            esac
        fi
    fi
    echo
fi

# ─── Step 8: Push to Hugging Face ──────────────────────────────────────
if [ "${SKIP_PUSH}" = false ] && [ "${UPLOAD_ALLOWED}" = false ]; then
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║   EVAL GATE BLOCKED THIS UPLOAD                          ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo "═══ Step 8: SKIPPED — eval gate blocked the upload ══════════"
    echo "  The fused model regressed beyond BLACKSWAN_EVAL_TOLERANCE vs"
    echo "  ${EVAL_BASELINE_FILE}."
    echo "  The HF repo and inference endpoint keep serving last week's weights."
    echo "  To inspect: see the eval numbers in Step 7.5 above."
    echo "  To ship anyway: BLACKSWAN_EVAL_GATE=warn ./train_cycle_v5.sh --skip-export --skip-train"
    echo
elif [ "${SKIP_PUSH}" = false ]; then
    echo "═══ Step 8: Push to huggingface.co/cswan801/BlackSwan-v5 ════"
    if [ -z "${HF_TOKEN:-}" ]; then
        echo "  HF_TOKEN missing — skipping push (set HF_TOKEN env var to enable)."
    else
        "${PYTHON}" fuse_and_upload_v5.py
    fi
    echo
else
    echo "═══ Step 8: Skipped (--skip-push) ═══════════════════════════"
    echo
fi

# ─── Step 8.5: Refresh the HF Inference Endpoint ───────────────────────
# After the new weights land in `cswan801/BlackSwan-v5`, tell the
# dedicated HF Inference Endpoint to pull them. Without this, the
# running endpoint keeps serving the previous commit and the team
# chats with stale weights even though HF has the fresh ones. No-op
# when HF_ENDPOINT_NAME isn't set (i.e., the team hasn't paid for an
# endpoint and is fine with the public Inference API).
if [ "${SKIP_PUSH}" = false ] && [ "${UPLOAD_ALLOWED}" = false ]; then
    echo "═══ Step 8.5: SKIPPED — eval gate blocked the upload ════════"
    echo "  Endpoint keeps serving the previous (last good) revision."
    echo
elif [ "${SKIP_PUSH}" = false ]; then
    echo "═══ Step 8.5: Refresh HF Inference Endpoint ═════════════════"
    if [ -z "${HF_TOKEN:-}" ] || [ -z "${HF_ENDPOINT_NAME:-}" ]; then
        echo "  HF_ENDPOINT_NAME or HF_TOKEN missing — skipping endpoint update."
    else
        "${PYTHON}" update_hf_endpoint.py || echo "  endpoint update reported a problem — see log."
    fi
    echo
fi

# ─── Step 9: (Optional) deploy to local Ollama ─────────────────────────
if [ "${DEPLOY_OLLAMA}" = true ]; then
    echo "═══ Step 9: Deploy to local Ollama ══════════════════════════"
    if ! command -v ollama >/dev/null 2>&1; then
        echo "  ollama CLI missing — skipping. Install via brew install ollama."
    else
        # The Modelfile in the repo points at the fused weights.
        ollama create blackswan:v5 -f Modelfile || true
        ollama cp blackswan:v5 blackswan:latest || true
        echo "  Available locally as: blackswan:v5 / blackswan:latest"
    fi
    echo
fi

# ─── Step 10: Prune old adapter directories ────────────────────────────
# Each cycle drops a fresh `models/v5/lora_<timestamp>/` (~65 MB each).
# Without pruning the directory grows ~3 GB/year. Keep the last
# RETAIN_ADAPTERS so we can roll back a bad cycle without filling
# the disk. lora_v2/ is the canonical "currently-deployed" copy and
# is preserved separately.
RETAIN_ADAPTERS=3
echo "═══ Step 10: Prune old adapter dirs (keep last ${RETAIN_ADAPTERS}) ═══"
if [ -d models/v5 ]; then
    pushd models/v5 > /dev/null
    # Collect timestamped lora dirs (lora_YYYYMMDD_HHMMSS), sort newest first.
    # macOS ships bash 3.2 with no `mapfile`, so use a portable while-read loop.
    adapter_dirs=()
    while IFS= read -r d; do
        adapter_dirs+=("$d")
    done < <(ls -1d lora_2* 2>/dev/null | sort -r || true)
    total="${#adapter_dirs[@]}"
    if [ "${total}" -gt "${RETAIN_ADAPTERS}" ]; then
        i=0
        for d in "${adapter_dirs[@]}"; do
            i=$((i + 1))
            if [ "${i}" -gt "${RETAIN_ADAPTERS}" ]; then
                echo "  pruning ${d}"
                rm -rf "${d}"
            fi
        done
    else
        echo "  ${total} adapter dir(s) on disk — nothing to prune."
    fi
    popd > /dev/null
fi
echo

# ─── Done ──────────────────────────────────────────────────────────────
# NOTE: a gate-blocked cycle still exits 0 (on purpose — launchd should not
# flag it as a failed run; the SKIPPED-UPLOAD banners above are the signal).
if [ "${UPLOAD_ALLOWED}" = true ]; then
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║   ✅  BlackSwan retrain cycle complete                   ║"
    echo "║   $(date -u +%Y-%m-%dT%H:%M:%SZ)                         ║"
    echo "╚══════════════════════════════════════════════════════════╝"
else
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║   !!  CYCLE COMPLETE — UPLOAD SKIPPED BY EVAL GATE       ║"
    echo "║   $(date -u +%Y-%m-%dT%H:%M:%SZ)                         ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo "The trained adapter is on disk but was NOT published. Exit code is 0"
    echo "so launchd does not flag the run; see Step 7.5 above for the numbers."
fi
echo "Full log: ${LOG_FILE}"
