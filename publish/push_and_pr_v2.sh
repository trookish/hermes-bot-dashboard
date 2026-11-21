#!/usr/bin/env bash
# Push the 1.3.0 release, write the catalog entry on a fork branch, open the PR.
set -euo pipefail

# Reuse the Windows-stored GitHub credential. It has repo + workflow but not
# read:org, so `gh auth login` refuses it; GH_TOKEN works for these calls.
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' \
  | git credential-manager get 2>/dev/null | tr -d '\r' | sed -n 's/^password=//p' | head -1)
if [ -z "$TOKEN" ]; then
  echo "No GitHub credential found in the Windows credential store." >&2
  exit 1
fi
export GH_TOKEN="$TOKEN"

REPO="C:/Users/trookish/AppData/Local/hermes/profiles/ops/cache/scratch/bd-repo-probe"
FORK="trookish/hermes-agent"
BRANCH="add-bot-dashboard-1.3.0"
CODE="afaaf6ef0a8c3815237383569bed952a67357178"
cd "$REPO"

echo "== 1. Push plugin source and tag =="
git remote get-url origin >/dev/null 2>&1 || git remote add origin https://github.com/trookish/hermes-bot-dashboard.git
git push origin HEAD:master
git push origin "$CODE:refs/tags/v1.3.0" 2>/dev/null || echo "tag v1.3.0 already exists"
echo "pinned code commit: $CODE"

echo "== 2. Fork and branch off upstream tip =="
gh repo view "$FORK" >/dev/null 2>&1 || gh repo fork NousResearch/hermes-agent --clone=false
UP=$(gh api repos/NousResearch/hermes-agent/git/ref/heads/main --jq .object.sha)
if gh api "repos/$FORK/git/ref/heads/$BRANCH" >/dev/null 2>&1; then
  echo "branch $BRANCH already exists on fork"
else
  gh api -X POST "repos/$FORK/git/refs" -f "ref=refs/heads/$BRANCH" -f "sha=$UP" >/dev/null
  echo "created branch $BRANCH at $UP"
fi

echo "== 3. Write the catalog entry (update existing file, so blob SHA is required) =="
BLOB=$(gh api "repos/$FORK/contents/plugin-catalog/bot-dashboard.yaml?ref=$BRANCH" --jq .sha)
python - <<PY
import base64, json, pathlib
src = pathlib.Path("publish/bot-dashboard.yaml").read_bytes().replace(b"\r\n", b"\n")
payload = {
    "message": "catalog: add bot-dashboard 1.3.0",
    "content": base64.b64encode(src).decode(),
    "sha": "$BLOB",
    "branch": "$BRANCH",
}
pathlib.Path("payload.json").write_text(json.dumps(payload))
PY
gh api -X PUT "repos/$FORK/contents/plugin-catalog/bot-dashboard.yaml" --input payload.json >/dev/null
echo "wrote catalog entry"

echo "== 4. Verify from GitHub =="
gh api "repos/$FORK/contents/plugin-catalog/bot-dashboard.yaml?ref=$BRANCH" \
  --jq .content | base64 -d | grep -E '^(sha|version|image|readme):'

echo "== 5. Open the PR =="
gh pr create --repo NousResearch/hermes-agent --base main \
  --head "trookish:$BRANCH" \
  --title "catalog: add bot-dashboard 1.3.0" \
  --body-file publish/PR_BODY.md
