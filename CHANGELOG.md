# Changelog

## 1.1.2

- **The panel rule is standing.** The `pre_llm_call` hook now injects a short
  instruction on every turn — open a `todo_list` task per unit of work and record
  each decision or finding as a panel note, without being asked. The live
  snapshot (widgets, note count, latest note) still rides only the first turn, so
  the cached system prompt is untouched.
- **Both panes come back after a Close.** The palette carries "Bot dashboard:
  show the Bot pane" and "Bot dashboard: show the Group pane", each un-dismissing
  and revealing its pane, and the plugin un-dismisses both panes once per upgrade.
- The Group pane's auto-reveal now targets the registered contribution id
  `bot-dashboard:groups`; the previous `bot-dashboard:group` no-opped silently.

## 1.1.1

- The Group pane now follows a group chat by its room id — Hermes titles those
  sessions `Group: <roomId>` — as well as by name on older rooms.

## 1.1.0

- **Tool calling for both dashboards.** `bot_panel` covers the bot's own pane,
  and the new `group_dashboard` tool covers a group chat's pane — `list_groups`,
  `view` (members, activity, tasks, projects, notes, widgets), and the same
  widget, note and layout edits. Any member bot can use it.
- Unknown or disbanded groups answer with a clear message instead of an HTTP
  error.

## 1.0.0

First public release. One plugin, two panes.

- **Bot pane** — the focused bot's dashboard: profile and model card, scheduled
  jobs, TaskNotes tasks, notes, projects, custom widgets, and the panel editor
  (add, edit, reorder, hide).
- **Group pane** — group chat dashboard with members, activity, shared tasks and
  projects; follows a group chat you open, and a picker for the rest.
- Member rows open that bot's chat directly.
- Everything runs on the plugin SDK: `revealPane`, `openSession`, per-plugin
  storage and REST. No DOM reads of the app's own markup.
- Widgets render sandboxed with the live theme; frames scroll instead of
  auto-sizing so no script is injected into them.

## 0.6.1

- Selections persist across restarts; group pane named **Group**.

## 0.6.0

- Split into two panes instead of one pane that rewrote itself: **Bot** and
  **Group**.

## 0.5.0

- Group dashboards open from a click on the group chat.

## 0.4.0

- Group dashboards: members, activity, tasks, projects.
- Survives a bot being deleted, renamed or edited while the pane is open.

## 0.3.0

- Custom widgets, panel editor, notes, large view.

## 0.1.0

- First pane: profile, scheduled jobs, tasks, projects.
