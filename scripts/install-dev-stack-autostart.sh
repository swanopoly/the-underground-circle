#!/bin/bash
# Install/uninstall/status for the dev-stack LaunchAgent (user-level, NO sudo).
# Keeps scripts/dev-stack-keepalive.js alive at login, which in turn keeps the
# bridges + proxy (+ Expo web unless UC_KEEPALIVE_EXPO=0) listening.
set -euo pipefail

LABEL="com.undergroundcircle.dev-stack"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"
TEMPLATE="$REPO/scripts/launchd/$LABEL.plist.template"
UID_NUM="$(id -u)"

if [ "$UID_NUM" = "0" ]; then
  echo "Refusing to run as root — install as your normal user." >&2
  exit 1
fi

case "${1:-install}" in
  install)
    mkdir -p "$PLIST_DIR" "$HOME/Library/Logs"
    sed -e "s|__NODE__|$NODE_BIN|g" \
        -e "s|__REPO__|$REPO|g" \
        -e "s|__HOME__|$HOME|g" \
        "$TEMPLATE" > "$PLIST"
    launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$UID_NUM" "$PLIST"
    launchctl kickstart "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    echo "Installed $LABEL (node: $NODE_BIN, repo: $REPO)"
    echo "Log: $HOME/Library/Logs/uc-dev-stack.log"
    ;;
  uninstall)
    launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Uninstalled $LABEL (running services were left alone; stop them manually if wanted)"
    ;;
  status)
    launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | grep -E "state|pid|last exit" || echo "$LABEL is not loaded"
    for port in 7778 7779 7780 7781 18790 8081; do
      if nc -z 127.0.0.1 "$port" 2>/dev/null; then echo "port $port: listening"; else echo "port $port: down"; fi
    done
    ;;
  *)
    echo "usage: $0 [install|uninstall|status]" >&2
    exit 2
    ;;
esac
