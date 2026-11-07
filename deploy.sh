#!/usr/bin/env bash
# Install Bot Dashboard into the root Hermes home and every profile, then enable it.
# Usage: ./deploy.sh            (all profiles)
#        ./deploy.sh health     (one profile)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$LOCALAPPDATA/hermes"
PY="$ROOT/hermes-agent/venv/Scripts/python.exe"

copy_to() {
  local dest="$1/plugins/bot-dashboard"
  rm -rf "$dest"
  mkdir -p "$dest"
  (cd "$SRC" && tar --exclude=.git --exclude=__pycache__ --exclude=deploy.sh -cf - .) | (cd "$dest" && tar -xf -)
}

copy_to "$ROOT"
"$PY" - <<EOF
import sys; sys.path.insert(0, r"$ROOT/hermes-agent")
from pathlib import Path
from hermes_cli.desktop_plugin_halves import materialize_desktop_half as m
r = Path(r"$ROOT")
print("desktop half:", m(r / "plugins" / "bot-dashboard", r / "desktop-plugins", "bot-dashboard"))
EOF
HERMES_HOME="$ROOT" hermes plugins enable bot-dashboard </dev/null >/dev/null 2>&1 || true

profiles=("$@")
[ ${#profiles[@]} -eq 0 ] && profiles=($(ls "$ROOT/profiles"))
for p in "${profiles[@]}"; do
  [ -f "$ROOT/profiles/$p/config.yaml" ] || continue
  copy_to "$ROOT/profiles/$p"
  HERMES_HOME="$ROOT/profiles/$p" hermes plugins enable bot-dashboard </dev/null >/dev/null 2>&1 || echo "enable failed: $p"
  echo "installed: $p"
done
