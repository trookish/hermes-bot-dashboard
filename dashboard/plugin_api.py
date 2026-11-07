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

router = APIRouter()

HERMES_ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "hermes"
BRAIN = Path(os.environ.get("HERMES_BRAIN", str(Path.home() / "Desktop" / "HermesBrain")))
TASKS_DIR = BRAIN / "TaskNotes" / "Tasks"
PROJECTS_DIR = BRAIN / "02 Projects"
BOT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
STALE_DAYS = 14


def _bot_home(bot: str) -> Path:
    if bot in ("", "default", "hermes"):
        return HERMES_ROOT
    if not BOT_ID.match(bot):
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


def _avatar(home: Path) -> Optional[str]:
    for name, mime in (("avatar.svg", "image/svg+xml"), ("avatar.png", "image/png")):
        path = home / "assets" / name
        if path.is_file() and path.stat().st_size < 2_000_000:
            return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    return None


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
    skills_dir = home / "skills"
    skill_count = sum(1 for _ in skills_dir.rglob("SKILL.md")) if skills_dir.is_dir() else 0
    return {
        "id": bot,
        "name": str(meta.get("name") or profile.get("display_name") or profile.get("name") or bot),
        "description": str(meta.get("description") or profile.get("description") or ""),
        "section": str(meta.get("sectionName") or ""),
        "color": str(meta.get("color") or ""),
        "avatar": _avatar(home),
        "model": str(model.get("default") or ""),
        "provider": str(model.get("provider") or ""),
        "fallback": [f"{f.get('provider', '')}/{f.get('model', '')}" for f in fallbacks if isinstance(f, dict)],
        "workspace": str(terminal.get("cwd") or ""),
        "plugins": [str(p) for p in (plugins or [])][:40],
        "skillCount": skill_count,
        "tasks": _tasks(bot),
        "projects": _projects(bot),
        "brain": BRAIN.is_dir(),
    }


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
