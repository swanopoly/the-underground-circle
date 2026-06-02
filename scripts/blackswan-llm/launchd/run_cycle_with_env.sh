#!/bin/bash
# Wrapper that sources ~/.blackswan-train/env.sh (kept outside the repo
# because it holds Supabase + HF tokens) and then runs the v5 train
# cycle. Called by the launchd plist.
set -euo pipefail

ENV_FILE="${HOME}/.blackswan-train/env.sh"
if [ ! -f "${ENV_FILE}" ]; then
    echo "ERROR: ${ENV_FILE} missing." >&2
    echo "  Create it with:" >&2
    echo "    mkdir -p ~/.blackswan-train" >&2
    echo "    cat > ~/.blackswan-train/env.sh <<'EOF'" >&2
    echo "    export SUPABASE_URL=https://<project>.supabase.co" >&2
    echo "    export SUPABASE_SERVICE_ROLE_KEY=eyJ..." >&2
    echo "    export HF_TOKEN=hf_..." >&2
    echo "    EOF" >&2
    echo "    chmod 600 ~/.blackswan-train/env.sh" >&2
    exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

# Scheduled training must be cost-safe by default. Synthetic data generation
# uses Anthropic when ANTHROPIC_API_KEY is present, so strip the key from
# launchd runs unless explicitly opted in from the private env file.
case "${BLACKSWAN_TRAIN_ALLOW_ANTHROPIC:-false}" in
    1|true|TRUE|yes|YES|on|ON)
        echo "BLACKSWAN_TRAIN_ALLOW_ANTHROPIC enabled; scheduled synthetic generation may use Anthropic."
        ;;
    *)
        if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
            unset ANTHROPIC_API_KEY
            echo "ANTHROPIC_API_KEY unset for scheduled BlackSwan training. Set BLACKSWAN_TRAIN_ALLOW_ANTHROPIC=true to opt in."
        fi
        ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${SCRIPT_DIR}"

bash ./train_cycle_v5.sh
