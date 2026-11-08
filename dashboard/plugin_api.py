"""Bot Dashboard REST half: per-bot profile facts, TaskNotes and project notes.

Served by the Hermes dashboard web server under ``/api/plugins/bot-dashboard``.
Reads the shared Hermes root (every profile) and the HermesBrain vault. The only
writes are TaskNotes: create a task for a bot, or flip one open/done.
"""

from __future__ import annotations

import base64
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from panel_store import Panel, PanelError  # noqa: E402

router = APIRouter()

HERMES_ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "hermes"
BRAIN = Path(os.environ.get("HERMES_BRAIN", str(Path.home() / "Desktop" / "HermesBrain")))
TASKS_DIR = BRAIN / "TaskNotes" / "Tasks"
PROJECTS_DIR = BRAIN / "02 Projects"
BOT_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
STALE_DAYS = 14


def _bot_home(bot: str) -> Path:
    if bot in ("", "default", "hermes"):
        return HERMES_ROOT
    if not BOT_ID.fullmatch(bot or ""):
        raise HTTPException(400, "Invalid bot id.")
    home = HERMES_ROOT / "profiles" / bot
    if not home.is_dir():
        raise HTTPException(404, f"No profile named {bot}.")
    return home


def _norm_bot(bot: str) -> str:
    return "hermes" if bot in ("", "default") else bot


def _read_yaml(path: Path) -> dict:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}


def _frontmatter(path: Path) -> tuple[dict, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}, ""
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    if not m:
        return {}, text
    try:
        fields = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        fields = {}
    return (fields if isinstance(fields, dict) else {}), text[m.end():]


def _day(value: Any) -> Optional[str]:
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return None


def _owned(fields: dict, bot: str) -> bool:
    owner = fields.get("bot")
    owners = owner if isinstance(owner, list) else [owner]
    return bot in [str(o).strip() for o in owners if o]


def _avatar(home: Path) -> tuple[Optional[str], bool]:
    """(data URL, is_backfill). The roster writes a 160x160 PNG snapshot of the
    drawn face as a backfill and ignores it when rendering; flag it so the pane does too."""
    for name, mime in (("avatar.svg", "image/svg+xml"), ("avatar.png", "image/png")):
        path = home / "assets" / name
        if path.is_file() and path.stat().st_size < 2_000_000:
            raw = path.read_bytes()
            backfill = mime == "image/png" and len(raw) >= 24 and raw[16:24] == b"\x00\x00\x00\xa0\x00\x00\x00\xa0"
            return f"data:{mime};base64," + base64.b64encode(raw).decode(), backfill
    return None, False


def _soul(home: Path) -> str:
    try:
        return (home / "SOUL.md").read_text(encoding="utf-8")[:6000]
    except OSError:
        return ""


def _skills(home: Path, config: dict) -> tuple[int, int]:
    """(installed, enabled) for this profile's own skills directory."""
    skills_dir = home / "skills"
    names = {p.parent.name for p in skills_dir.rglob("SKILL.md")} if skills_dir.is_dir() else set()
    cfg = config.get("skills") if isinstance(config.get("skills"), dict) else {}
    disabled = {str(s) for s in (cfg.get("disabled") or []) if s}
    return len(names), len(names - disabled)


def _tasks(bot: str) -> list[dict]:
    out = []
    if not TASKS_DIR.is_dir():
        return out
    for path in TASKS_DIR.glob("*.md"):
        fields, _ = _frontmatter(path)
        if not _owned(fields, bot):
            continue
        out.append({
            "file": path.name,
            "title": str(fields.get("title") or path.stem),
            "status": str(fields.get("status") or "open"),
            "priority": str(fields.get("priority") or "normal"),
            "due": _day(fields.get("due")),
            "completed": _day(fields.get("completedDate")),
        })
    out.sort(key=lambda t: (t["status"] == "done", t["due"] or "9999", t["title"].lower()))
    return out


def _projects(bot: str) -> list[dict]:
    out = []
    if not PROJECTS_DIR.is_dir():
        return out
    today = date.today()
    for path in PROJECTS_DIR.glob("*.md"):
        fields, _ = _frontmatter(path)
        if not _owned(fields, bot):
            continue
        updated = _day(fields.get("updated"))
        age = (today - date.fromisoformat(updated)).days if updated else None
        out.append({
            "name": path.stem,
            "status": str(fields.get("status") or "unknown"),
            "next": str(fields.get("next") or ""),
            "updated": updated,
            "ageDays": age,
            "stale": age is not None and age >= STALE_DAYS,
            "repo": str(fields.get("repo") or ""),
        })
    out.sort(key=lambda p: (p["status"] != "active", p["name"].lower()))
    return out


@router.get("/health")
def health() -> dict:
    return {"ok": True, "brain": BRAIN.is_dir(), "root": str(HERMES_ROOT)}


@router.get("/bot")
def bot_summary(id: str = Query("", max_length=64)) -> dict:
    home = _bot_home(id)
    bot = _norm_bot(id)
    profile = _read_yaml(home / "profile.yaml")
    meta = ((profile.get("ui_meta") or {}).get("hermes-bots") or {}) if isinstance(profile.get("ui_meta"), dict) else {}
    config = _read_yaml(home / "config.yaml")
    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    fallbacks = config.get("fallback_providers") if isinstance(config.get("fallback_providers"), list) else []
    terminal = config.get("terminal") if isinstance(config.get("terminal"), dict) else {}
    plugins = (config.get("plugins") or {}).get("enabled") if isinstance(config.get("plugins"), dict) else []
    skill_count, skills_on = _skills(home, config)
    agent = config.get("agent") if isinstance(config.get("agent"), dict) else {}
    toolsets = (config.get("platform_toolsets") or {}).get("cli") if isinstance(config.get("platform_toolsets"), dict) else None
    mcp = config.get("mcp_servers") if isinstance(config.get("mcp_servers"), dict) else {}
    avatar, backfill = _avatar(home)
    cwd = str(terminal.get("cwd") or "").strip()
    return {
        "id": bot,
        "name": str(meta.get("title") or meta.get("name") or profile.get("display_name") or profile.get("name") or bot),
        "description": str(meta.get("description") or profile.get("description") or ""),
        "section": str(meta.get("sectionName") or ""),
        "color": str(meta.get("color") or ""),
        "shape": str(meta.get("shape") or ""),
        "imageKind": str(meta.get("imageKind") or ""),
        "custom": bool(meta.get("custom")),
        "avatar": avatar,
        "avatarBackfill": backfill,
        "reasoning": str(agent.get("reasoning_effort") or ""),
        "maxTurns": agent.get("max_turns") if isinstance(agent.get("max_turns"), int) else None,
        "toolsets": [str(t) for t in toolsets][:60] if isinstance(toolsets, list) else [],
        "mcp": [{"name": str(k), "enabled": bool((v or {}).get("enabled", True)) if isinstance(v, dict) else True} for k, v in list(mcp.items())[:30]],
        "skillsEnabled": skills_on,
        "soul": _soul(home),
        "model": str(model.get("default") or ""),
        "provider": str(model.get("provider") or ""),
        "fallback": [f"{f.get('provider', '')}/{f.get('model', '')}" for f in fallbacks if isinstance(f, dict)],
        "workspace": "" if cwd in ("", ".", "./") else cwd,
        "plugins": [str(p) for p in (plugins or [])][:40],
        "skillCount": skill_count,
        "tasks": _tasks(bot),
        "projects": _projects(bot),
        "brain": BRAIN.is_dir(),
        "panel": Panel(home).summary(),
    }


def _panel(bot: str) -> Panel:
    return Panel(_bot_home(bot))


def _guard(fn):
    try:
        return fn()
    except PanelError as exc:
        raise HTTPException(400, str(exc)) from exc
    except OSError as exc:  # PanelBusy or a file held open by another program
        raise HTTPException(503, f"The panel files are busy. Try again. ({exc})") from exc


class LayoutBody(BaseModel):
    bot: str
    order: Optional[list[str]] = None
    hidden: Optional[list[str]] = None


@router.post("/panel/layout")
def panel_layout(body: LayoutBody) -> dict:
    return {"ok": True, "layout": _guard(lambda: _panel(body.bot).set_layout(body.order, body.hidden))}


class NoteBody(BaseModel):
    bot: str
    id: Optional[str] = None
    text: Optional[str] = None
    pinned: Optional[bool] = None


@router.post("/panel/note")
def panel_note_add(body: NoteBody) -> dict:
    return {"ok": True, "note": _guard(lambda: _panel(body.bot).add_note(body.text or "", author="turki"))}


@router.post("/panel/note/update")
def panel_note_update(body: NoteBody) -> dict:
    return {"ok": True, "note": _guard(lambda: _panel(body.bot).update_note(
        body.id or "", text=body.text, pinned=body.pinned, author="turki"))}


@router.post("/panel/note/delete")
def panel_note_delete(body: NoteBody) -> dict:
    if not _guard(lambda: _panel(body.bot).delete_note(body.id or "")):
        raise HTTPException(404, "Note not found.")
    return {"ok": True}


class WidgetBody(BaseModel):
    bot: str
    id: Optional[str] = None
    title: Optional[str] = None
    html: Optional[str] = None
    height: Optional[int] = None


@router.post("/panel/widget")
def panel_widget_save(body: WidgetBody) -> dict:
    panel = _panel(body.bot)
    cur = next((w for w in panel.widgets(with_html=True) if w["id"] == body.id), None) if body.id else None
    if body.id and cur is None:
        raise HTTPException(404, "Widget not found.")
    entry = _guard(lambda: panel.save_widget(
        title=body.title or (cur or {}).get("title", ""),
        html=body.html if body.html is not None else (cur or {}).get("html", ""),
        wid=body.id, height=body.height, author="turki"))
    return {"ok": True, "widget": entry}


@router.post("/panel/widget/remove")
def panel_widget_remove(body: WidgetBody) -> dict:
    if not _guard(lambda: _panel(body.bot).remove_widget(body.id or "")):
        raise HTTPException(404, "Widget not found.")
    return {"ok": True}


def _brain_tasks():
    hooks = str(HERMES_ROOT / "agent-hooks")
    if hooks not in sys.path:
        sys.path.insert(0, hooks)
    import brain_tasks  # noqa: PLC0415 — vault helper lives outside the package
    return brain_tasks


class NewTask(BaseModel):
    bot: str
    title: str
    due: Optional[str] = None


@router.post("/task")
def add_task(body: NewTask) -> dict:
    bot = _norm_bot(body.bot)
    _bot_home(body.bot)
    title = " ".join(body.title.split())[:200]
    if not title:
        raise HTTPException(400, "A task needs a title.")
    due = body.due if body.due and re.match(r"^\d{4}-\d{2}-\d{2}$", body.due) else None
    path = _brain_tasks().create(title, due=due, bot=bot)
    return {"ok": True, "file": Path(path).name}


class TaskStatus(BaseModel):
    file: str
    status: str


@router.post("/task/status")
def set_task_status(body: TaskStatus) -> dict:
    if body.status not in ("open", "in-progress", "done"):
        raise HTTPException(400, "Unknown status.")
    path = (TASKS_DIR / body.file).resolve()
    if path.parent != TASKS_DIR.resolve() or path.suffix != ".md" or not path.is_file():
        raise HTTPException(404, "Task not found.")
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    if not m:
        raise HTTPException(422, "Task has no frontmatter.")
    fm = m.group(1)
    now = datetime.now().replace(microsecond=0).isoformat()
    fm = re.sub(r'^status:.*$', f'status: "{body.status}"', fm, count=1, flags=re.M)
    completed = f'completedDate: "{now}"' if body.status == "done" else "completedDate: null"
    if re.search(r"^completedDate:", fm, re.M):
        fm = re.sub(r"^completedDate:.*$", completed, fm, count=1, flags=re.M)
    elif body.status == "done":
        fm += "\n" + completed
    if re.search(r"^dateModified:", fm, re.M):
        fm = re.sub(r"^dateModified:.*$", f'dateModified: "{now}"', fm, count=1, flags=re.M)
    tmp = path.with_suffix(".md.tmp")
    tmp.write_text("---\n" + fm + "\n---" + text[m.end():], encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return {"ok": True}
