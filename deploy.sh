#!/usr/bin/env bash
# Developer script: copy this checkout into the root Hermes home and every profile, then
# enable it. Users install with `hermes plugins install bot-dashboard` instead.
# Usage: ./deploy.sh            (all profiles)
#        ./deploy.sh health     (one profile)
#        HERMES_ROOT=/path/to/hermes ./deploy.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${HERMES_ROOT:-}" ]; then ROOT="$HERMES_ROOT"
elif [ -n "${LOCALAPPDATA:-}" ]; then ROOT="$(cygpath -u "$LOCALAPPDATA" 2>/dev/null || echo "$LOCALAPPDATA")/hermes"
else ROOT="$HOME/.hermes"; fi
# Live runtime: the newest install environment (hermes-agent/venv goes stale after updates).
# Install envs share one fixed mtime, so pick the first one that can import the runtime.
PY=""
for cand in "$ROOT"/installs/*/environments/*/venv/Scripts/python.exe "$ROOT"/installs/*/environments/*/venv/bin/python "$ROOT"/hermes-agent/venv/bin/python; do
  [ -x "$cand" ] || continue
  if "$cand" -c "import fastapi, hermes_cli" >/dev/null 2>&1; then PY="$cand"; break; fi
done
[ -n "$PY" ] || { echo "Hermes runtime python not found" >&2; exit 1; }

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
