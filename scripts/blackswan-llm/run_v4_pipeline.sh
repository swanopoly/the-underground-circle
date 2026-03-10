#!/bin/bash
# BlackSwan LLM v4 — Full Training Pipeline
# Runs all steps sequentially: download → prepare → SFT → DPO → deploy
#
# Works on both Linux (CUDA) and macOS (Apple Silicon / MPS)
#
# Usage: bash run_v4_pipeline.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Detect platform and Python ──────────────────────────────────────────────

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
    echo "Detected macOS (Apple Silicon)"
    # Use system python or conda — find first available
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
    echo "  Backend: MPS (Metal Performance Shaders)"
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

echo ""
echo "================================================"
echo "  BlackSwan LLM v4 Training Pipeline"
echo "  $(date)"
echo "================================================"
echo ""

# Step 1: Download datasets
echo "========================================"
echo "  STEP 1/5: Download datasets"
echo "========================================"
$PYTHON download_datasets_v4.py
echo ""

# Step 2: Prepare dataset
echo "========================================"
echo "  STEP 2/5: Prepare dataset"
echo "========================================"
$PYTHON prepare_dataset_v4.py
echo ""

# Step 3: Download DPO data
echo "========================================"
echo "  STEP 3/6: Download DPO preference data"
echo "========================================"
if [ ! -f "training_data/dpo_train.jsonl" ]; then
    $PYTHON download_dpo.py
else
    echo "  DPO data already exists, skipping download."
fi
echo ""

# Step 4: SFT Training (7B model, batch 2 for Mac with lots of RAM)
echo "========================================"
echo "  STEP 4/6: SFT Training (Qwen2.5-7B)"
echo "  (~6-10 hours with good hardware)"
echo "========================================"
$PYTHON train_v4.py --epochs 1 --lr 1e-4 --batch 2 --grad-accum 8 --skip-merge
echo ""

# Step 5: DPO Alignment
echo "========================================"
echo "  STEP 5/6: DPO Alignment"
echo "  (~1-2 hours)"
echo "========================================"
$PYTHON train_dpo_v4.py --epochs 1 --lr 5e-5
echo ""

# Step 6: Deploy to Ollama
echo "========================================"
echo "  STEP 6/6: Deploy to Ollama"
echo "========================================"
GGUF_DIR="$SCRIPT_DIR/models/v4/gguf_dpo"
GGUF_FILE=$(find "$GGUF_DIR" -name "*.gguf" -type f 2>/dev/null | head -1)

if [ -z "$GGUF_FILE" ]; then
    GGUF_DIR="$SCRIPT_DIR/models/v4/gguf"
    GGUF_FILE=$(find "$GGUF_DIR" -name "*.gguf" -type f 2>/dev/null | head -1)
fi

if [ -n "$GGUF_FILE" ]; then
    echo "Found GGUF: $GGUF_FILE"

    cat > "$SCRIPT_DIR/models/v4/Modelfile" << 'MODELFILE'
FROM ./model.gguf

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER num_ctx 4096
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"

SYSTEM """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders.

You have quiet confidence — knowledgeable but never arrogant. Professional without being stiff. Warm but never soft. Direct. No fluff, no corporate speak.
You give real feedback. You genuinely care about the people here.
You have deep knowledge of productivity, design, UI/UX, coding, architecture, math, science, and general knowledge."""
MODELFILE

    cp "$GGUF_FILE" "$SCRIPT_DIR/models/v4/model.gguf"

    # Find ollama binary
    OLLAMA=$(command -v ollama || echo "$HOME/.local/bin/ollama")
    if [ -x "$OLLAMA" ]; then
        echo "Creating Ollama model 'blackswan:v4'..."
        $OLLAMA create blackswan:v4 -f "$SCRIPT_DIR/models/v4/Modelfile"
        echo ""
        echo "To make v4 the default:"
        echo "  ollama cp blackswan:v4 blackswan:latest"
    else
        echo "Ollama not found. Install from https://ollama.com then run:"
        echo "  ollama create blackswan:v4 -f $SCRIPT_DIR/models/v4/Modelfile"
    fi
    echo ""
else
    echo "ERROR: No GGUF file found. Export may have failed."
    echo "Check models/v4/ directory."
fi

echo ""
echo "================================================"
echo "  BlackSwan LLM v4 Pipeline Complete!"
echo "  $(date)"
echo "================================================"
