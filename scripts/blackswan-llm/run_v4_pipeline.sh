#!/bin/bash
# BlackSwan LLM v4 — Full Training Pipeline
# Runs all steps sequentially: download → prepare → SFT → DPO → deploy
#
# Usage: bash run_v4_pipeline.sh
# Expected time: ~12-18 hours total on RTX 4060 Laptop (8.6GB VRAM)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="/home/swan/miniforge/envs/blackswan/bin/python"
export CC=/home/swan/miniforge/envs/blackswan/bin/x86_64-conda-linux-gnu-gcc

cd "$SCRIPT_DIR"

echo "================================================"
echo "  BlackSwan LLM v4 Training Pipeline"
echo "  $(date)"
echo "================================================"
echo ""

# Check GPU
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
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

# Step 3: SFT Training
echo "========================================"
echo "  STEP 3/5: SFT Training"
echo "  (This will take 10-15 hours)"
echo "========================================"
$PYTHON train_v4.py --epochs 2 --lr 1e-4 --batch 1 --grad-accum 16 --skip-merge
echo ""

# Step 4: DPO Alignment
echo "========================================"
echo "  STEP 4/5: DPO Alignment"
echo "  (This will take 2-3 hours)"
echo "========================================"
$PYTHON train_dpo_v4.py --epochs 1 --lr 5e-5
echo ""

# Step 5: Deploy to Ollama
echo "========================================"
echo "  STEP 5/5: Deploy to Ollama"
echo "========================================"
GGUF_DIR="$SCRIPT_DIR/models/v4/gguf_dpo"
GGUF_FILE=$(find "$GGUF_DIR" -name "*.gguf" -type f | head -1)

if [ -z "$GGUF_FILE" ]; then
    # Fall back to SFT-only GGUF
    GGUF_DIR="$SCRIPT_DIR/models/v4/gguf"
    GGUF_FILE=$(find "$GGUF_DIR" -name "*.gguf" -type f | head -1)
fi

if [ -n "$GGUF_FILE" ]; then
    echo "Found GGUF: $GGUF_FILE"

    # Create Modelfile for Ollama
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

    # Copy GGUF to Modelfile location
    cp "$GGUF_FILE" "$SCRIPT_DIR/models/v4/model.gguf"

    echo "Creating Ollama model 'blackswan:v4'..."
    /home/swan/.local/bin/ollama create blackswan:v4 -f "$SCRIPT_DIR/models/v4/Modelfile"

    echo ""
    echo "To make v4 the default:"
    echo "  ollama cp blackswan:v4 blackswan:latest"
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
