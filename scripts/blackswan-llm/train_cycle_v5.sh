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
#   ./train_cycle_v5.sh --deploy-ollama   # also deploy locally to Ollama
#
# Environment:
#   SUPABASE_URL                  required for --skip-export=false
#   SUPABASE_SERVICE_ROLE_KEY     required for --skip-export=false
#   HF_TOKEN                      required for --skip-push=false
#   ANTHROPIC_API_KEY             optional, used by synthetic generators
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
LOG_DIR="${HOME}/.blackswan-train/log"
LOG_FILE="${LOG_DIR}/cycle-$(date +%Y%m%d-%H%M%S).log"

for arg in "$@"; do
  case $arg in
    --skip-export)        SKIP_EXPORT=true ;;
    --skip-train)         SKIP_TRAIN=true ;;
    --skip-push)          SKIP_PUSH=true ;;
    --deploy-ollama)      DEPLOY_OLLAMA=true ;;
    --iters=*)            ITERS="${arg#*=}" ;;
    --synthetic=*)        SYNTHETIC_COUNT="${arg#*=}" ;;
  esac
done

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
echo

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

# ─── Step 5: Convert to MLX format ─────────────────────────────────────
# The latest lora_v2 trained from training_data/mlx_format/ — we need
# to keep that directory in sync with whatever prepare_dataset_v4
# emitted into train_v4.jsonl / eval_v4.jsonl.
echo "═══ Step 5: Build MLX training shards ═══════════════════════"
mkdir -p training_data/mlx_format
# mlx-lm.lora expects {prompt, completion} or chat-format JSONL.
# prepare_dataset_v4.py writes chat format already, so we just symlink
# (or copy if symlinks don't survive train run).
cp -f training_data/train_v4.jsonl training_data/mlx_format/train.jsonl
cp -f training_data/eval_v4.jsonl  training_data/mlx_format/valid.jsonl
echo "  train: $(wc -l < training_data/mlx_format/train.jsonl) lines"
echo "  valid: $(wc -l < training_data/mlx_format/valid.jsonl) lines"
echo

# ─── Step 6: Train the LoRA ────────────────────────────────────────────
if [ "${SKIP_TRAIN}" = false ]; then
    echo "═══ Step 6: Train LoRA on Qwen3.5-4B-4bit ═══════════════════"
    BASE_MODEL="mlx-community/Qwen3.5-4B-4bit"
    ADAPTER_OUT="models/v5/lora_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "${ADAPTER_OUT}"

    "${PYTHON}" -m mlx_lm lora \
        --model "${BASE_MODEL}" \
        --train \
        --data training_data/mlx_format \
        --fine-tune-type lora \
        --num-layers 16 \
        --batch-size 1 \
        --iters "${ITERS}" \
        --learning-rate 1e-4 \
        --max-seq-length 512 \
        --steps-per-report 25 \
        --steps-per-eval 100 \
        --grad-checkpoint \
        --lora-parameters '{"rank": 16, "scale": 1.0, "dropout": 0.0}' \
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
        --model "mlx-community/Qwen3.5-4B-4bit" \
        --adapter-path models/v5/lora_v2 \
        --save-path models/v5/fused \
        --hf-path models/v5/fused_hf
    echo
fi

# ─── Step 8: Push to Hugging Face ──────────────────────────────────────
if [ "${SKIP_PUSH}" = false ]; then
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

# ─── Done ──────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✅  BlackSwan retrain cycle complete                   ║"
echo "║   $(date -u +%Y-%m-%dT%H:%M:%SZ)                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "Full log: ${LOG_FILE}"
