# Bot Dashboard

Two desktop panes for [Hermes](https://hermes-agent.nousresearch.com), in one plugin.

| Pane | Shows |
| --- | --- |
| **Bot** | The bot behind the chat you are looking at: profile and model, scheduled jobs, tasks, saved notes, projects, and any custom widgets that bot pinned for you. |
| **Group** | A group chat's dashboard: members and their state, recent activity, shared tasks and projects. Pick the group from the pane, or open the group chat in the app and the pane follows it. |

Both panes live in the right sidebar as tabs next to Files and Review, and both
read only what the app already knows — no scraping, no injected UI.

## Install

From the plugin catalog (once listed):

```bash
hermes plugins install bot-dashboard
```

From a checkout:

```bash
git clone https://github.com/trookish/hermes-bot-dashboard
cd hermes-bot-dashboard
./deploy.sh            # every profile
./deploy.sh health     # one profile
```

Restart Hermes Desktop after installing. The panes appear in the right sidebar:
**Bot** and **Group**.

## What each pane needs

- The **Bot** pane needs nothing configured: it follows the focused chat and reads
  that bot's own home directory (`profiles/<id>/panel/` for widgets, notes and
  layout, `config.yaml` for the profile card).
- **Tasks and projects** are optional. They come from a folder of markdown notes
  (an Obsidian vault works), one note per task or project, with a frontmatter key
  naming the bot that owns it. Nothing is assumed: until you set a vault, those
  cards say so and everything else works.
- The **Group** pane lists the group chats recorded in your Hermes profile. Rooms
  that a member bot hosts are opened read-only; nothing is written to them.

## Settings

Settings ▸ Plugins ▸ Bot Dashboard, or `hermes config set
plugins.entries.bot-dashboard.settings.<key> <value>`:

| Key | Default | Meaning |
| --- | --- | --- |
| `vault_path` | empty | Folder of your markdown notes vault. Empty hides vault data. |
| `tasks_folder` | `TaskNotes/Tasks` | Folder inside the vault with one note per task. |
| `projects_folder` | `Projects` | Folder inside the vault with one note per project. |
| `owner_field` | `bot` | Frontmatter key that names the owning bot (profile name). |
| `panel_rule` | empty | Optional instruction added to every turn, for example "add a panel note for each decision". |

A task note looks like this; `status: open` or `done`, `due` is optional:

```markdown
---
title: Draft the release notes
status: open
bot: writer
tags: [task]
---
```

## Agent tools

Two tools in the `bot_dashboard` toolset, so any bot can work with its
dashboards when you ask (enable the toolset with `hermes tools` if your platform
does not list it):

| Tool | Scope |
| --- | --- |
| `bot_panel` | The bot's own pane: read the layout, add, update or remove a widget, write or pin a note, reorder or hide cards. |
| `group_dashboard` | A group chat's pane: `list_groups`, then `view` (members, activity, tasks, projects, notes, widgets) or edit it — add a widget, leave a note, tidy the layout. Any member bot of that group can use it. |

Both return JSON, never raise, and degrade to a plain error message when a file
is busy or a group no longer exists. The plugin also registers one
`pre_llm_call` hook that tells the bot the panes exist — on the first turn only,
or when your message mentions the panel. Plain turns get nothing, unless you
write a `panel_rule`.

Custom widgets render in a sandboxed iframe (`sandbox="allow-scripts"`, no
same-origin access) with the live theme injected, behind a Content-Security-Policy
that blocks all network access: a widget inlines its images, styles and scripts. A widget taller than its frame
scrolls inside it; **Open large** gives it the full window.

## Privacy

Everything stays on this machine. The plugin reads Hermes' own profile data and
serves it to the pane over the local plugin host (`/api/plugins/bot-dashboard/`).
It makes no outbound network calls and has no telemetry. It writes only to each
bot's own `panel/` folder and, when you set a vault and create or tick a task, to
that task's note. It stores one preference: the last group chat you looked at.

## Accessibility

Dark and light themes are followed through the app's own CSS variables. Every
control is reachable by keyboard with a visible focus ring, member rows are
links you can open with Enter, and status is never colour-only.

## Requirements

- Hermes Desktop 0.20.0 or newer (plugin SDK: contributed panes, `revealPane`,
  `openSession`, per-plugin REST).
- Python: `PyYAML>=6.0,<7` (shipped with Hermes; declared for the installer).

## Development

```bash
hermes plugins validate .          # manifest, capabilities, surface checks
python tests/test_robustness.py    # 49 backend checks
python tests/test_tools.py         # 11 agent-tool checks
```

Layout:

```
plugin.yaml               manifest (name, version, declared tools and hooks)
__init__.py               agent half: bot_panel + group_dashboard tools, pre_llm_call hook
bd_settings.py            settings and paths (hermes_constants + config.yaml)
panel_store.py            per-bot panel storage (shared by the tool and the REST half)
dashboard/plugin_api.py   REST half: /bot, /stamp, /groups, /group, /group/stamp, /task
desktop/plugin.js         desktop half: the Bot and Group panes
deploy.sh                 developer copy into the Hermes home and every profile
```

Edit the source, never the installed copy, and run `./deploy.sh` afterwards. In the
running app, reload the renderer half with the command palette ▸
**Reload desktop plugins**; REST changes need a full restart.

## License

MIT — see [LICENSE](LICENSE).
