"""Bot Dashboard agent half.

Gives every bot two tools — ``bot_panel`` for its own dashboard and
``group_dashboard`` for a group chat's dashboard — plus a short first-turn
context note so the bot knows the panes exist. An optional per-turn instruction
(the ``panel_rule`` setting) is off unless the user writes one. Both tools read
and write the same files the desktop panes render.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bd_settings  # noqa: E402
from panel_store import BUILTIN, Panel, PanelError  # noqa: E402

logger = logging.getLogger(__name__)
TOOL = "bot_panel"
GROUP_TOOL = "group_dashboard"
TOOLSET = "bot_dashboard"


def _home() -> Path:
    return bd_settings.hermes_home()


def _bot_id() -> str:
    return bd_settings.bot_id()


SCHEMA = {
    "name": TOOL,
    "description": (
        "Read or edit YOUR OWN Bot Panel: the dashboard the user sees beside your chat in the Hermes "
        "desktop app (tab 'Bot', next to Scheduled jobs). Built-in cards: profile, scheduled jobs, "
        "tasks, notes, projects. This tool does everything the dashboard does: read/write Markdown "
        "notes, add custom self-contained HTML widgets (sandboxed, themed with --foreground, "
        "--muted-foreground, --border, --accent, --card; no network), manage task notes and project "
        "notes, read the focused chat's todo list, and read or change the plugin's five settings. "
        "Use it when the user asks to add, change or remove anything in your panel, to pin a useful "
        "view, to plan work as tasks, or to leave them a note. Actions: view, add_widget, "
        "update_widget, remove_widget, set_layout, list_notes, get_note, add_note, update_note, "
        "delete_note, list_tasks, add_task, update_task, set_task_status, delete_task, "
        "list_projects, add_project, update_project, delete_project, get_settings, set_settings, "
        "session_todos."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["view", "add_widget", "update_widget", "remove_widget", "set_layout",
                         "list_notes", "get_note", "add_note", "update_note", "delete_note",
                         "list_tasks", "add_task", "update_task", "set_task_status", "delete_task",
                         "list_projects", "add_project", "update_project", "delete_project",
                         "get_settings", "set_settings", "session_todos"],
            },
            "widget_id": {"type": "string", "description": "Widget id (update_widget, remove_widget)."},
            "title": {"type": "string", "description": "Widget title (add_widget, update_widget)."},
            "html": {"type": "string", "description": "Full self-contained HTML for the widget body."},
            "html_file": {"type": "string", "description": "Path to an existing .html file to use instead of html."},
            "height": {"type": "integer", "description": "Optional fixed height in px; omit to auto-size."},
            "note_id": {"type": "string", "description": "Note id (get_note, update_note, delete_note)."},
            "text": {"type": "string", "description": "Note body or new item text."},
            "note_title": {"type": "string", "description": "Note title (add_note, update_note); defaults to the first heading. 'title' is for widget titles."},
            "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags without # (notes, tasks, projects)."},
            "pinned": {"type": "boolean", "description": "Pin or unpin a note (update_note)."},
            "order": {"type": "array", "items": {"type": "string"},
                      "description": "Card order (set_layout). Ids: profile, jobs, tasks, notes, projects, w:<widget_id>."},
            "hidden": {"type": "array", "items": {"type": "string"}, "description": "Card ids to hide (set_layout)."},
            "file": {"type": "string", "description": "Task or project note filename, from list_tasks/list_projects (update/delete)."},
            "status": {"type": "string", "description": "Task status (set_task_status): open, in-progress, waiting, done, cancelled."},
            "due": {"type": "string", "description": "Due date, YYYY-MM-DD (add_task, update_task, add_project)."},
            "priority": {"type": "string", "description": "low, normal, high, urgent (add_task, add_project)."},
            "project": {"type": "string", "description": "Project name to link a task to (add_task)."},
            "name": {"type": "string", "description": "Project name (add_project, update_project)."},
            "next": {"type": "string", "description": "Project next step (add_project, update_project)."},
            "path": {"type": "string", "description": "Project directory on disk (add_project, update_project)."},
            "repo": {"type": "string", "description": "Project repository URL (add_project, update_project)."},
            "description": {"type": "string", "description": "Project description (add_project, update_project)."},
            "owners": {"type": "array", "items": {"type": "string"}, "description": "Project owner profile names (add_project, update_project)."},
            "session": {"type": "string", "description": "Session id for session_todos; leave empty for the focused chat."},
            "past": {"type": "integer", "description": "How many past chats' todo lists to include in session_todos (0-30)."},
            "settings": {"type": "object", "description": "Settings map for set_settings: vault_path, tasks_folder, projects_folder, owner_field, panel_rule."},
        },
        "required": ["action"],
    },
}

GROUP_SCHEMA_NOTE = "For group dashboards use 'group' instead of a bot id."


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


def _add_note(panel, args):
    """Pass only the kwargs this Panel supports. Older profile copies of
    panel_store predate title/tags, and a stale handler can still be calling
    one after a code update — never let a note save fail because of that."""
    text = str(args.get("text") or "")
    kw = {"author": "bot"}
    try:
        import inspect
        supported = inspect.signature(panel.add_note).parameters
    except (TypeError, ValueError):
        supported = {}
    if "title" in supported and args.get("title"):
        kw["title"] = args["title"]
    if "tags" in supported and args.get("tags"):
        kw["tags"] = args["tags"]
    if "pinned" in supported and args.get("pinned") is not None:
        kw["pinned"] = bool(args["pinned"])
    return panel.add_note(text, **kw)


def _agent_actions(args: dict, bot: str):
    """Tasks, projects, settings and session todos — the parts of the panel
    that live in the REST layer. Returns a JSON string or None if the action is
    not one of ours. Imports the bridge lazily so a broken REST layer cannot
    stop notes and widgets from working."""
    action = str(args.get("action") or "")
    task_actions = {"list_tasks", "add_task", "update_task", "set_task_status", "delete_task"}
    project_actions = {"list_projects", "add_project", "update_project", "delete_project"}
    other = {"get_settings", "set_settings", "session_todos"}
    if action not in task_actions | project_actions | other:
        return None
    try:
        import agent_api as a
        if action == "list_tasks":
            return _ok(tasks=a.tasks(bot))
        if action == "add_task":
            return _ok(**a.task_add(bot, str(args.get("text") or args.get("title") or "").strip(),
                                    args.get("due"), args.get("priority") or "normal",
                                    args.get("tags") or [], str(args.get("project") or "")))
        if action == "update_task":
            fields = {k: args[k] for k in ("title", "due", "priority", "tags", "owner") if args.get(k) is not None}
            return _ok(**a.task_update(str(args.get("file") or ""), **fields))
        if action == "set_task_status":
            return _ok(**a.task_status(str(args.get("file") or ""), str(args.get("status") or "")))
        if action == "delete_task":
            return _ok(**a.task_delete(str(args.get("file") or "")))
        if action == "list_projects":
            return _ok(projects=a.projects(bot, bool(args.get("all"))))
        if action == "add_project":
            fields = {k: args[k] for k in ("name", "status", "next", "repo", "path", "description",
                                           "tags", "priority", "due", "owners") if args.get(k) is not None}
            fields["name"] = str(args.get("name") or args.get("text") or "").strip()
            return _ok(**a.project_add(bot, **fields))
        if action == "update_project":
            fields = {k: args[k] for k in ("name", "status", "next", "repo", "path", "description",
                                           "tags", "priority", "due", "owners") if args.get(k) is not None}
            return _ok(**a.project_update(str(args.get("file") or ""), **fields))
        if action == "delete_project":
            return _ok(**a.project_delete(str(args.get("file") or "")))
        if action == "get_settings":
            return _ok(**a.settings_get())
        if action == "set_settings":
            values = args.get("settings")
            if not isinstance(values, dict):
                return _err("set_settings needs a settings object.")
            return _ok(**a.settings_save(values))
        if action == "session_todos":
            return _ok(**a.session_todos(bot, str(args.get("session") or ""), int(args.get("past") or 8)))
    except Exception as exc:  # HTTPException detail or PanelError — keep the tool total
        return _err(str(exc))
    return None


def handle(args: dict, **_kw) -> str:
    extra = _agent_actions(args, _bot_id())
    if extra is not None:
        return extra
    panel = Panel(_home())
    action = str(args.get("action") or "")
    try:
        if action == "view":
            widgets = [{k: w.get(k) for k in ("id", "title", "updated", "author")} for w in panel.widgets()]
            notes = panel.notes()
            return _ok(bot=_bot_id(), layout=panel.layout(), widgets=widgets,
                       notes=[{"id": n["id"], "author": n["author"], "pinned": n.get("pinned", False),
                               "title": n.get("title", ""), "tags": n.get("tags", []),
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
            if args.get("note_title") and not args.get("title"):
                args = {**args, "title": args["note_title"]}
            return _ok(note=_add_note(panel, args))
        if action == "update_note":
            return _ok(note=panel.update_note(str(args.get("note_id") or ""), text=args.get("text"),
                                              pinned=args.get("pinned"), author="bot",
                                              title=args.get("note_title") or args.get("title"), tags=args.get("tags")))
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
        "projects from the user's notes vault (when one is set), shared notes, and custom HTML widgets. Any bot that is a member "
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
            "text": {"type": "string", "description": "Note body in Markdown, Obsidian flavour: headings, lists, - [ ] tasks, **bold**, `code`, fenced code, > quotes and > [!note] callouts, tables, [[wikilinks]] to other notes by title, and #tags (add_note, update_note). Each note is a .md file the user can open in Obsidian."},
            "title": {"type": "string", "description": "Note title (add_note, update_note); defaults to the first heading."},
            "tags": {"type": "array", "items": {"type": "string"}, "description": "Note tags without # (add_note, update_note)."},
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
                "title": nt.get("title", ""), "tags": nt.get("tags", []),
                "text": nt["text"][:300]} for nt in panel.notes(with_body=False)[:20]],
    )


def handle_group(args: dict, **_kw) -> str:
    action = str(args.get("action") or "")
    group_id = str(args.get("group") or "")
    if group_id:
        extra = _agent_actions(args, group_id)
        if extra is not None:
            return extra
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
            if args.get("note_title") and not args.get("title"):
                args = {**args, "title": args["note_title"]}
            return _ok(note=_add_note(panel, args))
        if action == "update_note":
            return _ok(note=panel.update_note(str(args.get("note_id") or ""), text=args.get("text"),
                                              pinned=args.get("pinned"), author="bot",
                                              title=args.get("note_title") or args.get("title"), tags=args.get("tags")))
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


# Narrow phrases only: bare "لوحة" also means a licence plate or a painting.
_PANEL_WORDS = ("panel", "dashboard", "widget", "sidebar", "my notes", "بانل", "البانل",
                "لوحتك", "لوحة البوت", "اللوحة الجانبية", "ويدجت")

def _first_turn_context(is_first_turn: bool = False, user_message: str = "", **_kw):
    """Tell the bot the panes exist, on the first turn or when a message asks about them.

    Plain turns get nothing, unless the user wrote an instruction into the
    ``panel_rule`` setting; that text then rides every turn in the turn's user
    message, so the cached system prompt is never disturbed. The default is empty.
    """
    parts = []
    rule = bd_settings.setting("panel_rule")
    if rule:
        parts.append(f"[Bot Panel] {rule[:600]}")
    msg = str(user_message or "").lower()
    if is_first_turn or any(w in msg for w in _PANEL_WORDS):
        try:
            panel = Panel(_home())
            widgets = ", ".join(w["title"] for w in panel.widgets()) or "none yet"
            notes = panel.notes(with_body=False)
            recent = "; ".join(str(n.get("title") or "")[:80] for n in notes[:3]) or "none"
            parts.append(
                f"The user sees this panel beside the chat (desktop tab 'Bot'): profile, scheduled jobs, "
                f"tasks, notes, projects, and custom widgets ({widgets}). Notes: {len(notes)}; latest: "
                f"{recent}. The 'Group' tab shows a group chat's dashboard: members, activity, shared "
                f"tasks and projects. Read or edit either with the bot_panel (your own) and "
                f"group_dashboard (a group) tools."
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("bot panel context skipped: %s", exc)
    return {"context": "\n".join(parts)} if parts else None


def register(ctx):
    ctx.register_tool(name=TOOL, toolset=TOOLSET, schema=SCHEMA, handler=handle,
                      description="Read and edit this bot's desktop panel.", emoji="🧩")
    ctx.register_tool(name=GROUP_TOOL, toolset=TOOLSET, schema=GROUP_SCHEMA, handler=handle_group,
                      description="Read and edit a group chat's desktop dashboard.", emoji="👥")
    ctx.register_hook("pre_llm_call", _first_turn_context)
