"""Bot Dashboard agent half.

Gives every bot a ``bot_panel`` tool to read and edit its own panel in the
Hermes desktop app (custom HTML widgets, notes, layout), and a short
first-turn context note so the bot knows the panel exists.
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


# Narrow phrases only: bare "لوحة" also means licence plate (Plate Lab).
_PANEL_WORDS = ("panel", "dashboard", "widget", "sidebar", "my notes", "بانل", "البانل",
                "لوحتك", "لوحة البوت", "اللوحة الجانبية", "ويدجت")


def _first_turn_context(is_first_turn: bool = False, user_message: str = "", **_kw):
    msg = str(user_message or "").lower()
    if not is_first_turn and not any(w in msg for w in _PANEL_WORDS):
        return None
    try:
        panel = Panel(_home())
        widgets = ", ".join(w["title"] for w in panel.widgets()) or "none yet"
        notes = panel.notes()
        recent = "; ".join(n["text"].splitlines()[0][:80] for n in notes[:3]) or "none"
        return {"context": (
            f"[Bot Panel] Turki sees your own panel beside this chat (desktop tab 'Bot'): profile, "
            f"scheduled jobs, tasks, notes, projects, plus custom widgets ({widgets}). "
            f"Notes ({len(notes)}; latest: {recent}). Read or edit it with the bot_panel tool when he "
            f"asks to add or change something in the panel, or to pin a view you built there."
        )}
    except Exception as exc:  # noqa: BLE001
        logger.debug("bot panel context skipped: %s", exc)
        return None


def register(ctx):
    ctx.register_tool(name=TOOL, toolset="file", schema=SCHEMA, handler=handle,
                      description="Read and edit this bot's desktop panel.", emoji="🧩")
    ctx.register_hook("pre_llm_call", _first_turn_context)
    try:  # keep the tool eager on any model; degrade to deferred discovery if this list moves
        import toolsets
        core = getattr(toolsets, "_HERMES_CORE_TOOLS", None)
        if isinstance(core, list) and TOOL not in core:
            core.append(TOOL)
    except Exception:  # noqa: BLE001
        pass
