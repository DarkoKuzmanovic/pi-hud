#!/usr/bin/env bash
# Install pi-hud extension into Pi via symlink.
# Source stays here — edits are picked up on Pi restart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$HOME/.pi/agent/extensions"

mkdir -p "$EXT_DIR"

# Clean up any stale single-file or backup symlinks from previous installs.
rm -f "$EXT_DIR/pi-hud.ts" "$EXT_DIR/pi-hud.ts.bak"

# pi-coding-agent's loader picks up extensions/<name>/index.ts automatically,
# so symlink the whole project directory.
ln -sfn "$SCRIPT_DIR" "$EXT_DIR/pi-hud"
echo "✓ Symlinked pi-hud → $EXT_DIR/pi-hud"

echo ""
echo "Installed pi-hud."
echo "Commands: /hud on|off|refresh|status — manage the HUD display"
echo "Shortcut: Ctrl+\` — open gitui in a Kitty overlay"
echo "Restart Pi to pick up changes."
