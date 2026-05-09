#!/usr/bin/env bash
# Install pi-hud extension into Pi via symlink.
# Source stays here — edits are picked up on Pi restart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/.pi/agent/extensions"

mkdir -p "$EXT_DIR"

ln -sfn "$SCRIPT_DIR/pi-hud.ts" "$EXT_DIR/pi-hud.ts"
echo "✓ Symlinked pi-hud.ts → $EXT_DIR/pi-hud.ts"

echo ""
echo "Installed pi-hud."
echo "Commands: /hud on|off|refresh|status — manage the HUD display"
echo "Shortcut: Ctrl+\` — open gitui in a Kitty overlay"
echo "Restart Pi to pick up changes."
