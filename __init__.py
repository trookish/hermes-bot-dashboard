"""Bot Dashboard agent half.

Gives every bot two tools — ``bot_panel`` for its own dashboard and
``group_dashboard`` for a group chat's dashboard — plus a short first-turn
context note so the bot knows the panes exist. Both tools read and write the
same files the desktop panes render.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from panel_store import BUILTIN, Panel, PanelError  # noqa: E402

logger = logging.getLogger(__name__)
TOOL = "bot_panel"
GROUP_TOOL = "group_dashboard"


def _home() -> Path:
    home = os.environ.get("HERMES_HOME")
    if home:
        return Path(home)
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "hermes"


def _bot_id() -> str:
    parts = Path(_home()).parts
    return parts[-1] if len(parts) >= 2 and parts[-2] == "profiles" else "hermes"


SCHEMA = {
    "name": TOOL,
    "description": (
        "Read or edit YOUR OWN Bot Panel: the dashboard Turki sees beside your chat in the Hermes "
        "desktop app (tab 'Bot', next to Scheduled jobs). Built-in cards: profile, scheduled jobs, "
        "tasks, notes, projects. You can add custom widgets (self-contained HTML, rendered in a "
        "sandboxed frame about 320px wide that scales wider content down to fit; theme with the CSS "
        "variables --foreground, --muted-foreground, --border, --accent, --card; no external "
        "network), and read or write shared notes. Use it when Turki asks to add, change or remove "
        "something in your panel, to pin a useful view (plan, tracker, grid) there, or to leave him "
        "a note. Actions: view, add_widget, update_widget, remove_widget, list_notes, add_note, "
        "update_note, delete_note, set_layout."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["view", "add_widget", "update_widget", "remove_widget", "list_notes",
                         "add_note", "update_note", "delete_note", "set_layout"],
            },
            "widget_id": {"type": "string", "description": "Widget id (update_widget, remove_widget)."},
            "title": {"type": "string", "description": "Widget title (add_widget, update_widget)."},
            "html": {"type": "string", "description": "Full self-contained HTML for the widget body."},
            "html_file": {"type": "string", "description": "Path to an existing .html file to use instead of html."},
            "height": {"type": "integer", "description": "Optional fixed height in px; omit to auto-size."},
            "note_id": {"type": "string", "description": "Note id (update_note, delete_note)."},
            "text": {"type": "string", "description": "Note text, plain text; line breaks are kept (add_note, update_note)."},
            "pinned": {"type": "boolean", "description": "Pin or unpin a note (update_note)."},
            "order": {"type": "array", "items": {"type": "string"},
                      "description": "Card order (set_layout). Ids: profile, jobs, tasks, notes, projects, w:<widget_id>."},
            "hidden": {"type": "array", "items": {"type": "string"}, "description": "Card ids to hide (set_layout)."},
        },
        "required": ["action"],
    },
}


def _ok(**data) -> str:
    return json.dumps({"ok": True, **data}, ensure_ascii=False)


def _err(msg: str) -> str:
    return json.dumps({"ok": False, "error": msg}, ensure_ascii=False)


def _html_arg(args: dict) -> str:
    if args.get("html"):
        return str(args["html"])
    path = args.get("html_file")
    if path:
        p = Path(str(path)).expanduser()
        if p.suffix.lower() not in (".html", ".htm") or not p.is_file():
            raise PanelError("html_file must be an existing .html file.")
        return p.read_text(encoding="utf-8")
    return ""


def handle(args: dict, **_kw) -> str:
    panel = Panel(_home())
    action = str(args.get("action") or "")
    try:
        if action == "view":
            widgets = [{k: w.get(k) for k in ("id", "title", "updated", "author")} for w in panel.widgets()]
            notes = panel.notes()
            return _ok(bot=_bot_id(), layout=panel.layout(), widgets=widgets,
                       notes=[{"id": n["id"], "author": n["author"], "pinned": n.get("pinned", False),
                               "text": n["text"][:300]} for n in notes[:20]],
                       note_count=len(notes), builtin=BUILTIN)
        if action in ("add_widget", "update_widget"):
            wid = args.get("widget_id") if action == "update_widget" else None
            if action == "update_widget":
                cur = next((w for w in panel.widgets(with_html=True) if w["id"] == wid), None)
                if cur is None:
                    return _err("Widget not found. Use view to list widget ids.")
                html = _html_arg(args) or cur.get("html", "")
                title = args.get("title") or cur["title"]
            else:
                html, title = _html_arg(args), args.get("title")
            entry = panel.save_widget(title=title, html=html, wid=wid, height=args.get("height"), author="bot")
            return _ok(widget=entry, message="Saved. The panel shows it within 30 seconds or on refresh.")
        if action == "remove_widget":
            return _ok(removed=panel.remove_widget(str(args.get("widget_id") or "")))
        if action == "list_notes":
            return _ok(notes=panel.notes())
        if action == "add_note":
            return _ok(note=panel.add_note(str(args.get("text") or ""), author="bot"))
        if action == "update_note":
            return _ok(note=panel.update_note(str(args.get("note_id") or ""), text=args.get("text"),
                                              pinned=args.get("pinned"), author="bot"))
        if action == "delete_note":
            return _ok(deleted=panel.delete_note(str(args.get("note_id") or "")))
        if action == "set_layout":
            return _ok(layout=panel.set_layout(args.get("order"), args.get("hidden")))
        return _err(f"Unknown action {action!r}.")
    except PanelError as exc:
        return _err(str(exc))
    except OSError as exc:
        return _err(f"The panel files are busy; try again. ({exc})")
    except Exception as exc:  # noqa: BLE001 — a tool must answer, never raise
        logger.warning("bot_panel failed: %s", exc)
        return _err(f"Panel operation failed: {exc}")


# ---------------------------------------------------------------- group dashboard

GROUP_SCHEMA = {
    "name": GROUP_TOOL,
    "description": (
        "Read or edit a GROUP chat's dashboard: the 'Group' pane in the Hermes desktop app. "
        "It shows members and their state, recent room activity, tasks owned by any member, "
        "HermesBrain projects, shared notes, and custom HTML widgets. Any bot that is a member "
        "of the group can use it to read the room's state or to leave a note, pin a widget or "
        "reorder the pane for everyone in that group. Actions: list_groups, view, add_widget, "
        "update_widget, remove_widget, list_notes, add_note, update_note, delete_note, set_layout."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list_groups", "view", "add_widget", "update_widget", "remove_widget",
                         "list_notes", "add_note", "update_note", "delete_note", "set_layout"],
            },
            "group": {"type": "string",
                      "description": "Group room id or its name. Required for every action except list_groups."},
            "widget_id": {"type": "string", "description": "Widget id (update_widget, remove_widget)."},
            "title": {"type": "string", "description": "Widget title (add_widget, update_widget)."},
            "html": {"type": "string", "description": "Full self-contained HTML for the widget body."},
            "html_file": {"type": "string", "description": "Path to an existing .html file instead of html."},
            "height": {"type": "integer", "description": "Optional fixed height in px; omit to use the widget's own height."},
            "note_id": {"type": "string", "description": "Note id (update_note, delete_note)."},
            "text": {"type": "string", "description": "Note text, plain text; line breaks are kept."},
            "pinned": {"type": "boolean", "description": "Pin or unpin a note (update_note)."},
            "order": {"type": "array", "items": {"type": "string"},
                      "description": "Card order (set_layout). Ids: hero, members, activity, tasks, projects, notes, w:<widget_id>."},
            "hidden": {"type": "array", "items": {"type": "string"}, "description": "Card ids to hide (set_layout)."},
            "limit": {"type": "integer", "description": "How many events and tasks to return on view (default 10, max 40)."},
        },
        "required": ["action"],
    },
}


def _api():
    """The REST half, imported lazily so the tool costs nothing until it is called."""
    import importlib.util

    name = "bot_dashboard_api"
    if name in sys.modules:
        return sys.modules[name]
    path = Path(__file__).resolve().parent / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _group_panel(api, key: str):
    k = key.strip()
    if not k:
        raise PanelError("Pass the group room id or its name in 'group' (list_groups shows them).")
    rid, room = api._resolve_room(k)
    if room is None:
        raise PanelError(f"No such group ({k}). Use list_groups to see the ones on this computer.")
    return api._panel(api.GROUP_PREFIX + rid)


def _group_view(api, key: str, limit: int) -> str:
    data = api.group_summary(id=key)
    if data.get("missing"):
        return _err(f"No such group ({key}). Use list_groups to see the ones on this computer.")
    panel = api._panel(api.GROUP_PREFIX + key)
    n = max(1, min(int(limit or 10), 40))
    return _ok(
        group={"id": data["roomId"], "name": data["name"], "disbanded": data["disbanded"],
               "live": data.get("live", False), "running": data.get("running", 0),
               "eventCount": data.get("eventCount", 0)},
        members=[{"id": m.get("id"), "name": m.get("name"), "model": m.get("model", ""),
                  "missing": m.get("missing", False), "remote": m.get("remote", False)}
                 for m in data.get("members", [])],
        events=data.get("events", [])[:n],
        tasks=[{"title": t.get("title"), "status": t.get("status"), "due": t.get("due"),
                "owners": t.get("owners", [])} for t in data.get("tasks", [])[:n]],
        projects=[{"name": p.get("name"), "status": p.get("status"), "next": p.get("next", "")}
                  for p in data.get("projects", [])],
        layout=panel.layout(),
        widgets=[{k: w.get(k) for k in ("id", "title", "updated", "author")} for w in panel.widgets()],
        notes=[{"id": nt["id"], "author": nt["author"], "pinned": nt.get("pinned", False),
                "text": nt["text"][:300]} for nt in panel.notes()[:20]],
    )


def handle_group(args: dict, **_kw) -> str:
    action = str(args.get("action") or "")
    try:
        api = _api()
        if action == "list_groups":
            rooms = api.groups_list().get("groups", [])
            return _ok(groups=[g for g in rooms if not g.get("disbanded")],
                       disbanded=[g for g in rooms if g.get("disbanded")],
                       hint="Pass a group's id (or its name) as 'group'.")
        panel = _group_panel(api, str(args.get("group") or ""))
        if action == "view":
            return _group_view(api, str(args.get("group") or ""), args.get("limit") or 10)
        if action in ("add_widget", "update_widget"):
            wid = args.get("widget_id") if action == "update_widget" else None
            if action == "update_widget":
                cur = next((w for w in panel.widgets(with_html=True) if w["id"] == wid), None)
                if cur is None:
                    return _err("Widget not found. Use view to list widget ids.")
                html = _html_arg(args) or cur.get("html", "")
                title = args.get("title") or cur["title"]
            else:
                html, title = _html_arg(args), args.get("title")
            entry = panel.save_widget(title=title, html=html, wid=wid, height=args.get("height"), author="bot")
            return _ok(widget=entry, message="Saved. Every member sees it within 30 seconds or on refresh.")
        if action == "remove_widget":
            return _ok(removed=panel.remove_widget(str(args.get("widget_id") or "")))
        if action == "list_notes":
            return _ok(notes=panel.notes())
        if action == "add_note":
            return _ok(note=panel.add_note(str(args.get("text") or ""), author="bot"))
        if action == "update_note":
            return _ok(note=panel.update_note(str(args.get("note_id") or ""), text=args.get("text"),
                                              pinned=args.get("pinned"), author="bot"))
        if action == "delete_note":
            return _ok(deleted=panel.delete_note(str(args.get("note_id") or "")))
        if action == "set_layout":
            return _ok(layout=panel.set_layout(args.get("order"), args.get("hidden")))
        return _err(f"Unknown action {action!r}.")
    except PanelError as exc:
        return _err(str(exc))
    except OSError as exc:
        return _err(f"The group's dashboard files are busy; try again. ({exc})")
    except Exception as exc:  # noqa: BLE001 — a tool must answer, never raise
        logger.warning("group_dashboard failed: %s", exc)
        return _err(f"Group dashboard operation failed: {exc}")


# Narrow phrases only: bare "لوحة" also means licence plate (Plate Lab).
_PANEL_WORDS = ("panel", "dashboard", "widget", "sidebar", "my notes", "بانل", "البانل",
                "لوحتك", "لوحة البوت", "اللوحة الجانبية", "ويدجت")

# Rides every turn: short, constant, and never restated by the user.
_PANEL_RULE = (
    "[Bot Panel] Standing rule: record the work in the panel unprompted — open a todo_list task per "
    "unit of work (it shows in the panel's Tasks card) and add a bot_panel note for each decision, "
    "constraint or finding. Keep both current as the work moves."
)


def _first_turn_context(is_first_turn: bool = False, user_message: str = "", **_kw):
    """Inject the panel rule on every turn, plus a live snapshot on the first.

    The rule is short and constant, so it rides in the turn's user message and
    never disturbs the cached system prompt. Only the first turn (or a mention
    of the panel) pays for the snapshot.
    """
    parts = [_PANEL_RULE]
    msg = str(user_message or "").lower()
    if is_first_turn or any(w in msg for w in _PANEL_WORDS):
        try:
            panel = Panel(_home())
            widgets = ", ".join(w["title"] for w in panel.widgets()) or "none yet"
            notes = panel.notes()
            recent = "; ".join(n["text"].splitlines()[0][:80] for n in notes[:3]) or "none"
            parts.append(
                f"Turki sees this panel beside the chat (desktop tab 'Bot'): profile, scheduled jobs, "
                f"tasks, notes, projects, and custom widgets ({widgets}). Notes: {len(notes)}; latest: "
                f"{recent}. The 'Group' tab shows a group chat's dashboard: members, activity, shared "
                f"tasks and projects. Read or edit either with the bot_panel (your own) and "
                f"group_dashboard (a group) tools."
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("bot panel context skipped: %s", exc)
    return {"context": "\n".join(parts)}


def register(ctx):
    ctx.register_tool(name=TOOL, toolset="file", schema=SCHEMA, handler=handle,
                      description="Read and edit this bot's desktop panel.", emoji="🧩")
    ctx.register_tool(name=GROUP_TOOL, toolset="file", schema=GROUP_SCHEMA, handler=handle_group,
                      description="Read and edit a group chat's desktop dashboard.", emoji="👥")
    ctx.register_hook("pre_llm_call", _first_turn_context)
    try:  # keep the tool eager on any model; degrade to deferred discovery if this list moves
        import toolsets
        core = getattr(toolsets, "_HERMES_CORE_TOOLS", None)
        if isinstance(core, list):
            for name in (TOOL, GROUP_TOOL):
                if name not in core:
                    core.append(name)
    except Exception:  # noqa: BLE001
        pass
