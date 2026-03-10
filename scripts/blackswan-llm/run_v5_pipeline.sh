#!/bin/bash
# BlackSwan LLM v5 — "The Big Boy" Training Pipeline
# Qwen3.5-27B base model with QLoRA fine-tuning
#
# Requirements: 64GB+ unified memory (Apple Silicon) or multi-GPU Linux
#
# Usage: bash run_v5_pipeline.sh
#        bash run_v5_pipeline.sh --small   # Use 9B fallback

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SMALL_MODE=false
if [ "$1" = "--small" ]; then
    SMALL_MODE=true
fi

# ─── Detect platform and Python ──────────────────────────────────────────────

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
    echo "Detected macOS (Apple Silicon)"
    if command -v conda &>/dev/null && conda env list | grep -q blackswan; then
        PYTHON="$(conda run -n blackswan which python)"
    elif [ -f "$HOME/miniforge3/envs/blackswan/bin/python" ]; then
        PYTHON="$HOME/miniforge3/envs/blackswan/bin/python"
    elif [ -f "$HOME/miniconda3/envs/blackswan/bin/python" ]; then
        PYTHON="$HOME/miniconda3/envs/blackswan/bin/python"
    else
        PYTHON="python3"
    fi
    echo "  Python: $PYTHON"

    # Check memory
    MEM_GB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1073741824}')
    echo "  Memory: ${MEM_GB}GB unified"
    if [ "$MEM_GB" -lt 64 ] && [ "$SMALL_MODE" = false ]; then
        echo ""
        echo "  WARNING: 27B model needs ~56GB VRAM."
        echo "  Your system has ${MEM_GB}GB. Consider using --small for 9B model."
        echo "  Continuing anyway in 5 seconds... (Ctrl+C to abort)"
        sleep 5
    fi
else
    echo "Detected Linux"
    if [ -f "/home/swan/miniforge/envs/blackswan/bin/python" ]; then
        PYTHON="/home/swan/miniforge/envs/blackswan/bin/python"
        export CC=/home/swan/miniforge/envs/blackswan/bin/x86_64-conda-linux-gnu-gcc
    else
        PYTHON="python3"
    fi
    echo "  Python: $PYTHON"
    nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader 2>/dev/null || echo "  No NVIDIA GPU detected"
fi

# ─── Determine model ─────────────────────────────────────────────────────────

if [ "$SMALL_MODE" = true ]; then
    BASE_MODEL="unsloth/Qwen3.5-9B-bnb-4bit"
    MODEL_DESC="Qwen3.5-9B (small fallback)"
else
    BASE_MODEL="unsloth/Qwen3.5-27B-bnb-4bit"
    MODEL_DESC="Qwen3.5-27B (full)"
fi

echo ""
echo "================================================"
echo "  BlackSwan LLM v5 — The Big Boy"
echo "  Base: $MODEL_DESC"
echo "  $(date)"
echo "================================================"
echo ""

# Step 1: Ensure datasets exist (reuses v4 data)
echo "========================================"
echo "  STEP 1/5: Check datasets"
echo "========================================"
if [ ! -f "training_data/train_v4.jsonl" ]; then
    echo "  Dataset not found. Running v4 data pipeline..."
    $PYTHON download_datasets_v4.py
    $PYTHON prepare_dataset_v4.py
else
    TRAIN_COUNT=$(wc -l < "training_data/train_v4.jsonl")
    echo "  Found train_v4.jsonl: ${TRAIN_COUNT} examples"
fi
echo ""

# Step 2: Ensure DPO data exists
echo "========================================"
echo "  STEP 2/5: Check DPO data"
echo "========================================"
if [ ! -f "training_data/dpo_train.jsonl" ]; then
    $PYTHON download_dpo.py
else
    DPO_COUNT=$(wc -l < "training_data/dpo_train.jsonl")
    echo "  Found dpo_train.jsonl: ${DPO_COUNT} examples"
fi
echo ""

# Step 3: SFT Training
echo "========================================"
echo "  STEP 3/5: SFT Training ($MODEL_DESC)"
echo "  (~12-24 hours depending on hardware)"
echo "========================================"
SFT_ARGS="--epochs 1 --lr 5e-5 --batch 1 --grad-accum 16 --skip-merge"
if [ "$SMALL_MODE" = true ]; then
    SFT_ARGS="--epochs 1 --lr 1e-4 --batch 2 --grad-accum 8 --skip-merge --base-model $BASE_MODEL"
else
    SFT_ARGS="$SFT_ARGS --base-model $BASE_MODEL"
fi
$PYTHON train_v5.py $SFT_ARGS
echo ""

# Step 4: DPO Alignment
echo "========================================"
echo "  STEP 4/5: DPO Alignment"
echo "  (~2-4 hours)"
echo "========================================"
$PYTHON train_dpo_v5.py --epochs 1 --lr 5e-5
echo ""

# Step 5: Deploy to Ollama
echo "========================================"
echo "  STEP 5/5: Deploy to Ollama"
echo "========================================"
GGUF_DIR="$SCRIPT_DIR/models/v5/gguf_dpo"
GGUF_FILE=$(find "$GGUF_DIR" -name "*.gguf" -type f 2>/dev/null | head -1)

if [ -z "$GGUF_FILE" ]; then
    GGUF_DIR="$SCRIPT_DIR/models/v5/gguf"
    GGUF_FILE=$(find "$GGUF_DIR" -name "*.gguf" -type f 2>/dev/null | head -1)
fi

if [ -n "$GGUF_FILE" ]; then
    echo "Found GGUF: $GGUF_FILE"

    cat > "$SCRIPT_DIR/models/v5/Modelfile" << 'MODELFILE'
FROM ./model.gguf

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"

SYSTEM """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

You have quiet confidence — knowledgeable but never arrogant. Professional without being stiff. Warm but never soft. Direct. No fluff, no corporate speak.
You give real feedback. You genuinely care about the people here.
You have deep knowledge of productivity, design, UI/UX, coding, architecture, math, science, and general knowledge.

This is the full BlackSwan model — powered by a 27B parameter foundation with fine-tuned expertise."""
MODELFILE

    cp "$GGUF_FILE" "$SCRIPT_DIR/models/v5/model.gguf"

    OLLAMA=$(command -v ollama || echo "$HOME/.local/bin/ollama")
    if [ -x "$OLLAMA" ]; then
        echo "Creating Ollama model 'blackswan:v5'..."
        $OLLAMA create blackswan:v5 -f "$SCRIPT_DIR/models/v5/Modelfile"
        echo ""
        echo "To make v5 the default:"
        echo "  ollama cp blackswan:v5 blackswan:latest"
        echo ""
        echo "Both models available:"
        echo "  blackswan:v4  — Mini (7B, fast)"
        echo "  blackswan:v5  — Full (27B, powerful)"
    else
        echo "Ollama not found. Install from https://ollama.com then run:"
        echo "  ollama create blackswan:v5 -f $SCRIPT_DIR/models/v5/Modelfile"
    fi
    echo ""
else
    echo "ERROR: No GGUF file found. Export may have failed."
    echo "Check models/v5/ directory."
fi

echo ""
echo "================================================"
echo "  BlackSwan LLM v5 Pipeline Complete!"
echo "  $(date)"
echo "================================================"
