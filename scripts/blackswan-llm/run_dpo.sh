#!/bin/bash
# run_dpo.sh — Run DPO fine-tune pass on BlackSwan after SFT completes.
#
# Usage:
#   bash run_dpo.sh
#
# Pre-requisites:
#   - SFT training must be complete (models/v1.0/lora/ must exist)
#   - Ollama must be running with blackswan model loaded
#   - conda env 'blackswan' must exist

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "🦢 BlackSwan DPO Training Pipeline"
echo "=================================="

# Activate conda
echo "→ Activating conda env..."
source ~/miniforge/etc/profile.d/conda.sh
conda activate blackswan

# Verify SFT lora exists
if [ ! -d "models/v1.0/lora" ]; then
  echo "❌ models/v1.0/lora not found — run SFT training first (train.py)"
  exit 1
fi

echo "→ SFT LoRA found ✓"
echo "→ DPO training data: $(wc -l < training_data/dpo_train.jsonl) examples"

# Run DPO
echo ""
echo "→ Starting DPO training..."
python train_dpo.py \
  --base-lora models/v1.0/lora \
  --output models/v1.0/dpo \
  --epochs 1 \
  --lr 5e-5

echo ""
echo "→ DPO complete ✓"

# Export GGUF
echo "→ Exporting GGUF..."
python -c "
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name='models/v1.0/dpo',
    max_seq_length=4096,
    dtype=None,
    load_in_4bit=True,
)
model.save_pretrained_gguf('models/v1.0/gguf-dpo', tokenizer, quantization_method='q4_k_m')
print('GGUF exported → models/v1.0/gguf-dpo')
"

# Update Ollama model
echo "→ Updating Ollama blackswan model..."
cat > /tmp/Modelfile-dpo << 'EOF'
FROM ./models/v1.0/gguf-dpo/unsloth.Q4_K_M.gguf

TEMPLATE """{{- if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{- range .Messages }}<|im_start|>{{ .Role }}
{{ .Content }}<|im_end|>
{{ end }}<|im_start|>assistant
"""

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER repeat_penalty 1.1
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|im_start|>"
PARAMETER num_ctx 4096

SYSTEM """You are BlackSwan — an AI accountability partner embedded in The Underground Circle, a productivity and accountability app for serious builders."""
EOF

ollama create blackswan -f /tmp/Modelfile-dpo
echo "→ Ollama model updated ✓"

# Quick eval
echo ""
echo "→ Running quick evaluation..."
python evaluate.py --model-path models/v1.0/dpo 2>/dev/null || python evaluate.py

echo ""
echo "✅ DPO pipeline complete!"
echo "   BlackSwan is now DPO-aligned and live in Ollama."
