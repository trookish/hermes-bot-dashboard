# Catalog submission

The plugin is packaged and validation-clean. Two edits put it in front of every
Hermes user.

## 1. Entry file

`publish/bot-dashboard.yaml` is the ready entry. Its `sha` is the 40-character
pin for the 1.1.2 commit (`a1bc74c56ebc19ea0b2cb3d5c188d5f6d6cc79f2`); bump it in its own PR for every later release.

## 2. Pull request to hermes-agent

```bash
gh repo fork NousResearch/hermes-agent --clone
cd hermes-agent
cp /path/to/hermes-bot-dashboard/publish/bot-dashboard.yaml plugin-catalog/
hermes plugins validate --catalog plugin-catalog/bot-dashboard.yaml   # optional pre-check
git checkout -b add-bot-dashboard
git add plugin-catalog/bot-dashboard.yaml
git commit -m "catalog: add bot-dashboard (bot and group desktop panes)"
gh pr create --title "catalog: add bot-dashboard" \
  --body "Owner submission. Desktop panes for a bot's dashboard and a group chat's dashboard. Pin a1bc74c56ebc; validation passes."
```

Admission rules that shaped this build (see `plugin-catalog/README.md`):

- Rule 2 — the entry pins one exact commit SHA; no branches, no tags.
- Rule 8 — the desktop half stays inside the plugin SDK. No DOM reads of the app's
  own markup, no injected scripts, no `eval`, no dynamic import: group selection
  and chat opening go through `revealPane` / `openSession` / `requestProfile`.
- Rule 9 — no runtime overrides of core. One warning remains: `__init__.py`
  imports `toolsets` to keep `bot_panel` eager in the tool list. Nothing is
  rebound; the import is wrapped and the plugin works if the name moves.

## Before the PR

- [ ] `hermes plugins validate .` → Validation passed
- [ ] `python tests/test_robustness.py` → 39/39
- [ ] `git status` clean, tag the release: `git tag v1.1.2 && git push --tags`
- [ ] Screenshot of both panes added to the README (the entry's `image:` field is
      optional, but reviewers and users read the README first)
