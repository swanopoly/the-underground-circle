#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
# BlackSwan Continuous Learning Cycle
#
# Run weekly or after significant app data growth to retrain BlackSwan.
# Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
#
# Usage:
#   chmod +x train_cycle.sh
#   ./train_cycle.sh                    # Full cycle
#   ./train_cycle.sh --skip-synthetic   # Skip synthetic generation (faster)
#   ./train_cycle.sh --skip-train       # Export + format only (data prep)
# ─────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_SYNTHETIC=false
SKIP_TRAIN=false
SYNTHETIC_COUNT=500

for arg in "$@"; do
  case $arg in
    --skip-synthetic) SKIP_SYNTHETIC=true ;;
    --skip-train)     SKIP_TRAIN=true ;;
    --count=*)        SYNTHETIC_COUNT="${arg#*=}" ;;
  esac
done

echo "╔══════════════════════════════════════════════════╗"
echo "║   🦢 BlackSwan Continuous Learning Cycle        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Config:"
echo "  Synthetic: ${SKIP_SYNTHETIC} (skip=${SKIP_SYNTHETIC})"
echo "  Training:  ${SKIP_TRAIN} (skip=${SKIP_TRAIN})"
echo "  Count:     ${SYNTHETIC_COUNT}"
echo ""

# Step 1: Export real data from Supabase (respects user opt-out via safe views)
echo "═══ Step 1: Export data from Supabase ═══"
python export_training_data.py
echo ""

# Step 2: Convert raw data to ShareGPT format
echo "═══ Step 2: Format to ShareGPT ═══"
python format_sharegpt.py
echo ""

# Step 3: Generate synthetic data via Claude (optional)
if [ "$SKIP_SYNTHETIC" = false ]; then
  echo "═══ Step 3: Generate synthetic data (${SYNTHETIC_COUNT} examples) ═══"
  python generate_synthetic.py --count "$SYNTHETIC_COUNT"
  echo ""
else
  echo "═══ Step 3: Skipped (--skip-synthetic) ═══"
  echo ""
fi

# Step 4: Prepare final dataset (quality filter + dedup + split)
echo "═══ Step 4: Prepare dataset ═══"
python prepare_dataset.py
echo ""

# Step 5: Train the model (optional)
if [ "$SKIP_TRAIN" = false ]; then
  echo "═══ Step 5: Train model ═══"
  python train.py --epochs 3
  echo ""

  # Step 6: Evaluate
  echo "═══ Step 6: Evaluate ═══"
  python evaluate.py --skip-perplexity
  echo ""
else
  echo "═══ Step 5-6: Skipped (--skip-train) ═══"
  echo ""
fi

echo "╔══════════════════════════════════════════════════╗"
echo "║   ✅ Training cycle complete!                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Review eval results: cat eval_results/eval_results.json"
echo "  2. Deploy to Ollama:    ollama create blackswan -f Modelfile"
echo "  3. Restart bridge:      node blackswan-bridge.js"
echo ""
