#!/usr/bin/env bash
# Run after `gh auth login` (needs repo + workflow scopes).
set -euo pipefail
REPO="C:/Users/trookish/AppData/Local/hermes/profiles/ops/cache/scratch/bd-repo-probe"
FORK="trookish/hermes-agent"
cd "$REPO"

echo "== 1. Push plugin source + 1.3.0 release =="
git remote -v | grep -q origin || git remote add origin https://github.com/trookish/hermes-bot-dashboard.git
git push -u origin HEAD:main
git push origin 4253d8ebc7c57118a29cd89614be70c10b96e82d:refs/tags/v1.3.0
CODE=$(git rev-parse HEAD~1)
echo "pinned code commit: $CODE"

echo "== 2. Fork upstream and branch off its tip =="
gh repo view "$FORK" >/dev/null 2>&1 || gh repo fork NousResearch/hermes-agent --clone=false
UP=$(gh api repos/NousResearch/hermes-agent/git/ref/heads/main --jq .object.sha)
gh api -X POST "repos/$FORK/git/refs" \
  -f ref=refs/heads/add-bot-dashboard-1.3.0 -f sha="$UP"

echo "== 3. Write the catalog entry via the contents API =="
python - <<'PY'
import base64, json, pathlib
src = pathlib.Path("publish/bot-dashboard.yaml").read_bytes().replace(b"\r\n", b"\n")
payload = {
    "message": "catalog: add bot-dashboard 1.3.0",
    "content": base64.b64encode(src).decode(),
    "branch": "add-bot-dashboard-1.3.0",
}
pathlib.Path("payload.json").write_text(json.dumps(payload))
PY
gh api -X PUT "repos/$FORK/contents/plugin-catalog/bot-dashboard.yaml" --input payload.json

echo "== 4. Verify the entry on the branch =="
gh api "repos/$FORK/contents/plugin-catalog/bot-dashboard.yaml?ref=add-bot-dashboard-1.3.0" \
  --jq .content | base64 -d | grep -E '^(sha|version|image|readme):'

echo "== 5. Open the PR =="
gh pr create --repo NousResearch/hermes-agent --base main \
  --head trookish:add-bot-dashboard-1.3.0 \
  --title "catalog: add bot-dashboard 1.3.0" \
  --body-file publish/PR_BODY.md
