#!/bin/bash
# First-time setup helper for the BlackSwan continuous training loop.
# Run once to wire the launchd plist and install secrets.
set -euo pipefail

ENV_DIR="${HOME}/.blackswan-train"
ENV_FILE="${ENV_DIR}/env.sh"
PLIST_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/com.underground.blackswan-train.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/com.underground.blackswan-train.plist"

echo "BlackSwan continuous-train setup"
echo "════════════════════════════════"

# 1. Create the env file if it doesn't exist.
if [ ! -f "${ENV_FILE}" ]; then
    mkdir -p "${ENV_DIR}"
    cat > "${ENV_FILE}" <<'EOF'
# Edit these values, then save. The training cycle reads this file
# before each run. chmod 600 keeps it readable only by you.
export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
export HF_TOKEN="hf_..."
# Optional — used only if you opt into synthetic data generation.
# export ANTHROPIC_API_KEY="sk-ant-..."
EOF
    chmod 600 "${ENV_FILE}"
    echo "  Created ${ENV_FILE} — open it and fill in your tokens before scheduling."
else
    echo "  ${ENV_FILE} already exists — skipping."
fi

# 2. Install the launchd plist.
mkdir -p "$(dirname "${PLIST_DST}")"
if [ -f "${PLIST_DST}" ]; then
    echo "  ${PLIST_DST} exists — unloading first."
    launchctl unload "${PLIST_DST}" 2>/dev/null || true
fi
cp "${PLIST_SRC}" "${PLIST_DST}"
launchctl load "${PLIST_DST}"
echo "  Loaded ${PLIST_DST}"

# 3. Print the trigger commands so the operator knows them.
cat <<EOF

Done.

Schedule: every Sunday at 03:00 local time.

Manual trigger (run now):
  launchctl kickstart -k gui/\$UID/com.underground.blackswan-train

Watch live:
  tail -f /tmp/blackswan-train.out.log

Disable:
  launchctl unload ${PLIST_DST}

Make sure ${ENV_FILE} has real values before the next run!
EOF
