# Bot Dashboard

Two desktop panes for [Hermes](https://hermes-agent.nousresearch.com), in one plugin.

| Pane | Shows |
| --- | --- |
| **Bot** | The bot behind the chat you are looking at: profile and model, scheduled jobs, TaskNotes tasks, saved notes, projects, and any custom widgets that bot pinned for you. |
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
- The **Group** pane lists the group chats recorded in your Hermes profile. Rooms
  that a member bot hosts are opened read-only; nothing is written to them.

## Agent tool

The plugin registers one tool, `bot_panel`, so a bot can read and edit its own
panel when you ask: add or update a widget, pin an HTML view it built, write a
note, or reorder and hide cards. It also registers a `pre_llm_call` hook that
tells the bot its panel exists — on the first turn only, or when your message
mentions the panel, so it costs nothing the rest of the time.

Custom widgets render in a sandboxed iframe (`sandbox="allow-scripts"`, no
same-origin access) with the live theme injected. A widget taller than its frame
scrolls inside it; **Open large** gives it the full window.

## Privacy

Everything stays on this machine. The plugin reads Hermes' own profile data and
serves it to the pane over the local plugin host (`/api/plugins/bot-dashboard/`).
It makes no outbound network calls, has no telemetry, and stores one preference:
the last group chat you looked at.

## Accessibility

Dark and light themes are followed through the app's own CSS variables. Every
control is reachable by keyboard with a visible focus ring, member rows are
links you can open with Enter, and status is never colour-only.

## Requirements

- Hermes Desktop 0.20.0 or newer (plugin SDK: contributed panes, `revealPane`,
  `openSession`, per-plugin REST).
- Python half for the group endpoints; no extra dependencies.

## Development

```bash
hermes plugins validate .          # manifest, capabilities, surface checks
python tests/test_robustness.py    # 39 backend checks
```

Layout:

```
plugin.yaml               manifest (name, version, declared tools and hooks)
__init__.py               agent half: bot_panel tool + pre_llm_call hook
panel_store.py            per-bot panel storage (shared by the tool and the REST half)
dashboard/plugin_api.py   REST half: /bot, /stamp, /groups, /group, /group/stamp
desktop/plugin.js         desktop half: the Bot and Group panes
deploy.sh                 copy into the Hermes home and every profile, then enable
```

Edit the source, never the installed copy, and run `./deploy.sh` afterwards. In the
running app, reload the renderer half with the command palette ▸
**Reload desktop plugins**; REST changes need a full restart.

## License

MIT — see [LICENSE](LICENSE).
