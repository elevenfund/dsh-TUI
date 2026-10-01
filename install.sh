#!/usr/bin/env bash
# One-shot installer for the elevenfund fork of dsh-tui (macOS / Linux).
# Usage:
#   curl -fsSL https://github.com/elevenfund/dsh-TUI/releases/download/v0.12.0-e1/install.sh | bash
#
# What it does:
#   1. npm install -g the pinned dsh engine plus the fork TUI tarball.
#   2. Strip nested @deepseek-ai copies npm may plant inside the TUI package
#      (stale engine-line packages that shadow the real engine).
#   3. Point the dsh-tui profile manifest at the fork tarball and sync the
#      profile-local package body from the global install, so
#      `dsh --profile dsh-tui` never falls back to the registry build of the
#      same name+version.
set -euo pipefail

RELEASE_BASE='https://github.com/elevenfund/dsh-TUI/releases/download/v0.12.0-e1'
TARBALL="$RELEASE_BASE/elevenfund-dsh-tui-0.12.0.tgz"
ENGINE_VERSION='0.2.0-rc.2'
TUI_NAME='@deepseek-harness-tui/dsh-tui'

step() { printf '\n==> %s\n' "$1"; }

step 'Installing dsh engine + fork TUI (npm install -g)'
npm install -g "@deepseek-ai/dsh@$ENGINE_VERSION" "$TARBALL"

GLOBAL_ROOT="$(npm root -g)"
GLOBAL_TUI="$GLOBAL_ROOT/@deepseek-harness-tui/dsh-tui"
[ -d "$GLOBAL_TUI/lib" ] || { echo "TUI not found at $GLOBAL_TUI" >&2; exit 1; }

step 'Removing nested engine-line packages inside the TUI install'
if [ -d "$GLOBAL_TUI/node_modules/@deepseek-ai" ]; then
  rm -rf "$GLOBAL_TUI/node_modules/@deepseek-ai"
  echo "  removed $GLOBAL_TUI/node_modules/@deepseek-ai"
else
  echo '  none present (clean)'
fi

step 'Configuring the dsh-tui profile'
PROFILE_DIR="$HOME/.dsh/profiles/dsh-tui"
PROFILE_TUI="$PROFILE_DIR/node_modules/@deepseek-harness-tui/dsh-tui"
MANIFEST="$PROFILE_DIR/package.json"
mkdir -p "$PROFILE_DIR/node_modules/@deepseek-harness-tui"

if [ -f "$MANIFEST" ]; then
  cp "$MANIFEST" "$MANIFEST.bak-pre-fork"
fi

node - "$MANIFEST" "$TARBALL" "$TUI_NAME" <<'EOF'
const fs = require('fs')
const [manifestPath, tarball, tuiName] = process.argv.slice(2)
let manifest = {}
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}
manifest.name = manifest.name || 'dsh-profile-dsh-tui'
manifest.private = true
manifest.dependencies = manifest.dependencies || {}
manifest.dependencies[tuiName] = tarball
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
manifest.dsh.profile.bundles = manifest.dsh.profile.bundles || ['@deepseek-ai/dsh-base', tuiName]
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
EOF
echo "  manifest dependency -> $TARBALL"

rm -rf "$PROFILE_TUI"
cp -R "$GLOBAL_TUI" "$PROFILE_TUI"
rm -rf "$PROFILE_TUI/node_modules/@deepseek-ai"
echo '  profile-local TUI synced from global install'

step 'Verifying fork markers'
for marker in 'lib/types/screens/chat/use-migrate.js' 'lib/types/components/TaskCenterPanel.js'; do
  [ -f "$PROFILE_TUI/$marker" ] || { echo "fork marker missing: $marker" >&2; exit 1; }
done
echo '  use-migrate + TaskCenterPanel present: fork confirmed'

printf '\nInstall complete. Start with:\n  dsh-tui            (or: dsh --profile dsh-tui)\n  Ctrl+G opens the task center; /migrate exists only in this fork.\n'
