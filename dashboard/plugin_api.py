"""Bot Dashboard REST half: per-bot profile facts, TaskNotes and project notes.

Served by the Hermes dashboard web server under ``/api/plugins/bot-dashboard``.
Reads the shared Hermes root (every profile) and, when the user has set one, a
markdown notes vault (``vault_path`` setting). The only vault writes are task notes:
create a task for a bot, or flip one open/done.
"""

from __future__ import annotations

import base64
import json
import hashlib
import os
import re
import secrets
import sqlite3
import sys
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bd_settings  # noqa: E402
from panel_store import GROUP_BUILTIN, Panel, PanelError  # noqa: E402

router = APIRouter()


def _root() -> Path:
    return bd_settings.hermes_root()


def _md_files(folder: Optional[Path]) -> list[Path]:
    if folder is None or not folder.is_dir():
        return []
    return list(folder.glob("*.md"))


BOT_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}")
STALE_DAYS = 14


def _bot_home(bot: str) -> Path:
    if bot in ("", "default", "hermes"):
        return _root()
    if not BOT_ID.fullmatch(bot or ""):
        raise HTTPException(400, "Invalid bot id.")
    home = _root() / "profiles" / bot
    if not home.is_dir():
        raise HTTPException(404, f"No profile named {bot}. It may have been deleted or renamed.")
    return home


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _safe(fn, default):
    """One unreadable section (a half-written file, a bad date, a profile deleted
    mid-read) must not take the whole dashboard down; it degrades to empty."""
    try:
        return fn()
    except Exception:  # noqa: BLE001 — every section is best-effort by design
        return default


def _norm_bot(bot: str) -> str:
    return "hermes" if bot in ("", "default") else bot


class _Loader(yaml.SafeLoader):
    """SafeLoader that keeps dates as text: PyYAML raises ValueError on an
    impossible date (2026-13-45), which would drop the whole note."""


_Loader.add_constructor("tag:yaml.org,2002:timestamp", lambda loader, node: loader.construct_scalar(node))


def _load(text: str):
    try:
        return yaml.load(text, Loader=_Loader)  # noqa: S506 — SafeLoader subclass
    except (yaml.YAMLError, ValueError, TypeError, RecursionError):
        return None


def _read_yaml(path: Path) -> dict:
    try:
        data = _load(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return {}
    return data if isinstance(data, dict) else {}


def _frontmatter(path: Path) -> tuple[dict, str]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}, ""
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    if not m:
        return {}, text
    fields = _load(m.group(1)) or {}
    return (fields if isinstance(fields, dict) else {}), text[m.end():]


def _day(value: Any) -> Optional[str]:
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return None


def _owned(fields: dict, bot: str) -> bool:
    owner = fields.get(bd_settings.owner_field())
    owners = owner if isinstance(owner, list) else [owner]
    return bot in [str(o).strip() for o in owners if o]


def _avatar(home: Path) -> tuple[Optional[str], bool]:
    """(data URL, is_backfill). The roster writes a 160x160 PNG snapshot of the
    drawn face as a backfill and ignores it when rendering; flag it so the pane does too."""
    for name, mime in (("avatar.svg", "image/svg+xml"), ("avatar.png", "image/png")):
        path = home / "assets" / name
        try:
            if not path.is_file() or path.stat().st_size >= 2_000_000:
                continue
            raw = path.read_bytes()
        except OSError:  # replaced or removed between the check and the read
            continue
        if raw:
            backfill = mime == "image/png" and len(raw) >= 24 and raw[16:24] == b"\x00\x00\x00\xa0\x00\x00\x00\xa0"
            return f"data:{mime};base64," + base64.b64encode(raw).decode(), backfill
    return None, False


def _soul(home: Path) -> str:
    try:
        return (home / "SOUL.md").read_text(encoding="utf-8", errors="replace")[:6000]
    except OSError:
        return ""


def _skills(home: Path, config: dict) -> tuple[int, int]:
    """(installed, enabled) for this profile's own skills directory."""
    skills_dir = home / "skills"
    names = {p.parent.name for p in skills_dir.rglob("SKILL.md")} if skills_dir.is_dir() else set()
    cfg = _dict(config.get("skills"))
    disabled = {str(s) for s in _list(cfg.get("disabled")) if s}
    return len(names), len(names - disabled)


def _tasks(bot: str) -> list[dict]:
    out = []
    for path in _md_files(bd_settings.tasks_dir()):
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
    today = date.today()
    for path in _md_files(bd_settings.projects_dir()):
        fields, _ = _frontmatter(path)
        if not _owned(fields, bot):
            continue
        updated = _day(fields.get("updated"))
        try:
            age = (today - date.fromisoformat(updated)).days if updated else None
        except ValueError:  # "2026-13-40" passes the shape check but is not a date
            updated, age = None, None
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
    return {"ok": True, "vault": bd_settings.vault_state(), "root": str(_root())}


def _missing(bot: str, reason: str) -> dict:
    return {"id": bot, "missing": True, "reason": reason, "vault": bd_settings.vault_state()}


@router.get("/bot")
def bot_summary(id: str = Query("", max_length=64)) -> dict:
    bot = _norm_bot(id)
    try:
        home = _bot_home(id)
    except HTTPException as exc:
        # A deleted, renamed or unknown profile is a state the pane shows, not an error.
        if exc.status_code in (400, 404):
            return _missing(bot, "invalid" if exc.status_code == 400 else "deleted")
        raise
    profile = _read_yaml(home / "profile.yaml")
    meta = _dict(_dict(profile.get("ui_meta")).get("hermes-bots"))
    config = _read_yaml(home / "config.yaml")
    model = _dict(config.get("model"))
    terminal = _dict(config.get("terminal"))
    agent = _dict(config.get("agent"))
    plugins = _list(_dict(config.get("plugins")).get("enabled"))
    toolsets = _list(_dict(config.get("platform_toolsets")).get("cli"))
    mcp = _dict(config.get("mcp_servers"))
    skill_count, skills_on = _safe(lambda: _skills(home, config), (0, 0))
    avatar, backfill = _safe(lambda: _avatar(home), (None, False))
    cwd = str(terminal.get("cwd") or "").strip()
    max_turns = agent.get("max_turns")
    return {
        "id": bot,
        "missing": False,
        "name": str(meta.get("title") or meta.get("name") or profile.get("display_name") or profile.get("name") or bot),
        "description": str(meta.get("description") or profile.get("description") or ""),
        "section": str(meta.get("sectionName") or ""),
        "color": str(meta.get("color") or ""),
        "shape": str(meta.get("shape") or ""),
        "imageKind": str(meta.get("imageKind") or ""),
        "custom": bool(meta.get("custom")),
        "groups": [str(g) for g in _list(meta.get("groups")) if g][:20],
        "avatar": avatar,
        "avatarBackfill": backfill,
        "reasoning": str(agent.get("reasoning_effort") or ""),
        "maxTurns": max_turns if isinstance(max_turns, int) and not isinstance(max_turns, bool) else None,
        "toolsets": [str(t) for t in toolsets][:60],
        "mcp": [{"name": str(k), "enabled": bool(v.get("enabled", True)) if isinstance(v, dict) else True}
                for k, v in list(mcp.items())[:30]],
        "skillsEnabled": skills_on,
        "soul": _safe(lambda: _soul(home), ""),
        "model": str(model.get("default") or ""),
        "provider": str(model.get("provider") or ""),
        "fallback": [f"{f.get('provider', '')}/{f.get('model', '')}" for f in _list(config.get("fallback_providers")) if isinstance(f, dict)],
        "workspace": "" if cwd in ("", ".", "./") else cwd,
        "plugins": [str(p) for p in plugins][:40],
        "skillCount": skill_count,
        "tasks": _safe(lambda: _tasks(bot), []),
        "projects": _safe(lambda: _projects(bot), []),
        "vault": bd_settings.vault_state(),
        "panel": _safe(lambda: Panel(home).summary(), {"layout": None, "widgets": [], "notes": []}),
    }


def _mtime(path: Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


def _dir_stamp(folder: Optional[Path]) -> int:
    """Newest change inside one folder (adds, deletes and edits), 0 when absent."""
    if folder is None:
        return 0
    try:
        return max([_mtime(folder)] + [_mtime(p) for p in folder.glob("*.md")])
    except OSError:
        return 0


@router.get("/stamp")
def bot_stamp(id: str = Query("", max_length=64)) -> dict:
    """A cheap change marker the pane polls, so edits, deletes and renames show
    within seconds instead of waiting for the full refresh."""
    try:
        home = _bot_home(id)
    except HTTPException:
        return {"stamp": "missing"}
    files = [home / "profile.yaml", home / "config.yaml", home / "SOUL.md",
             home / "assets" / "avatar.svg", home / "assets" / "avatar.png",
             home / "panel" / "layout.json", home / "panel" / "widgets.json", home / "panel" / "notes.json"]
    parts = [_mtime(f) for f in files] + [_dir_stamp(bd_settings.tasks_dir()), _dir_stamp(bd_settings.projects_dir())]
    return {"stamp": "-".join(str(p) for p in parts)}


# ---------------------------------------------------------------- groups
# Gateway group rooms live in the hosted_room* tables. Profile gateways write the
# root shared-state.db; older installs kept them in state.db. Both are read
# read-only, never written, and a room present in both keeps the newer copy.
def _room_dbs() -> tuple[Path, Path]:
    root = _root()
    return root / "shared-state.db", root / "state.db"
ROOM_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")
GROUP_PREFIX = "group:"
AVATAR_CAP = 400_000


def _rooms_query(sql: str, args: tuple = ()) -> list[tuple[Path, list[sqlite3.Row]]]:
    out = []
    for db in _room_dbs():
        if not db.is_file():
            continue
        try:
            con = sqlite3.connect(f"file:{urllib.request.pathname2url(str(db))}?mode=ro", uri=True, timeout=1.5)
        except sqlite3.Error:
            continue
        try:
            con.row_factory = sqlite3.Row
            out.append((db, con.execute(sql, args).fetchall()))
        except sqlite3.Error:  # table missing on an older install, or the file is busy
            pass
        finally:
            con.close()
    return out


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _rooms() -> dict[str, dict]:
    rooms: dict[str, dict] = {}
    for db, rows in _rooms_query("SELECT room_id, name, members_json, revision, created_at, updated_at, disbanded_at FROM hosted_rooms"):
        for r in rows:
            rid = str(r["room_id"] or "")
            if not ROOM_ID.fullmatch(rid):
                continue
            try:
                members = json.loads(r["members_json"] or "[]")
            except (TypeError, ValueError):
                members = []
            room = {
                "id": rid,
                "name": str(r["name"] or "Group chat"),
                "members": [m for m in _list(members) if isinstance(m, dict)],
                "revision": r["revision"],
                "createdAt": _num(r["created_at"]),
                "updatedAt": _num(r["updated_at"]),
                "disbandedAt": _num(r["disbanded_at"]),
                "db": db,
            }
            old = rooms.get(rid)
            if old is None or (room["updatedAt"] or 0) >= (old["updatedAt"] or 0):
                rooms[rid] = room
    return rooms


def _group_home(rid: str) -> Path:
    # The slug keeps folders readable; the hash keeps ids that differ only in
    # punctuation or letter case (room.1, room_1, Room:1) in separate folders.
    slug = re.sub(r"[^a-z0-9_-]", "_", rid.lower())[:60]
    digest = hashlib.sha1(rid.encode("utf-8")).hexdigest()[:10]
    return _root() / "plugin-data" / bd_settings.PLUGIN_ID / "groups" / f"{slug}-{digest}"


def _member_profile(m: dict) -> str:
    return str(m.get("profile") or _dict(m.get("target")).get("profile") or "").strip()


def _member(m: dict) -> dict:
    target = _dict(m.get("target"))
    profile = _member_profile(m)
    pid = "hermes" if profile in ("", "default") else profile
    remote = str(target.get("kind") or "local") != "local"
    out = {
        "id": pid,
        "handle": str(m.get("handle") or pid),
        "name": str(m.get("display_name") or pid),
        "remote": remote,
        "missing": False,
    }
    if remote:
        return out
    try:
        home = _bot_home(profile)
    except HTTPException:
        out["missing"] = True
        return out
    meta = _dict(_dict(_read_yaml(home / "profile.yaml").get("ui_meta")).get("hermes-bots"))
    config = _read_yaml(home / "config.yaml")
    avatar, backfill = _safe(lambda: _avatar(home), (None, False))
    if avatar and len(avatar) > AVATAR_CAP:
        avatar = None
    out.update({
        "name": str(meta.get("title") or meta.get("name") or out["name"]),
        "description": str(meta.get("description") or ""),
        "color": str(meta.get("color") or ""),
        "shape": str(meta.get("shape") or ""),
        "imageKind": str(meta.get("imageKind") or ""),
        "avatar": avatar,
        "avatarBackfill": backfill,
        "model": str(_dict(config.get("model")).get("default") or ""),
    })
    return out


def _events(rid: str, db: Path, limit: int = 8) -> tuple[int, list[dict]]:
    count, events = 0, []
    for src, rows in _rooms_query("SELECT COUNT(*) AS n FROM hosted_room_events WHERE room_id = ?", (rid,)):
        if src == db and rows:
            count = int(rows[0]["n"] or 0)
    for src, rows in _rooms_query(
            "SELECT seq, kind, actor_json, created_at FROM hosted_room_events WHERE room_id = ? ORDER BY seq DESC LIMIT ?",
            (rid, limit)):
        if src != db:
            continue
        for r in rows:
            try:
                actor = _dict(json.loads(r["actor_json"] or "{}"))
            except (TypeError, ValueError):
                actor = {}
            events.append({
                "seq": r["seq"],
                "kind": str(r["kind"] or ""),
                "actor": str(actor.get("display_name") or actor.get("handle") or actor.get("profile") or actor.get("kind") or ""),
                "at": _num(r["created_at"]),
            })
    return count, events


def _room_live(rid: str, db: Path) -> dict:
    """Whether a gateway currently drives the room, and how much work is queued."""
    now = time.time()
    live, running = False, 0
    for src, rows in _rooms_query("SELECT expires_at, released_at FROM hosted_room_driver_leases WHERE room_id = ?", (rid,)):
        if src == db:
            live = any((_num(r["expires_at"]) or 0) > now and not r["released_at"] for r in rows)
    for src, rows in _rooms_query(
            "SELECT COUNT(*) AS n FROM hosted_room_driver_tasks WHERE room_id = ? AND terminal_at IS NULL", (rid,)):
        if src == db and rows:
            running = int(rows[0]["n"] or 0)
    return {"live": live, "running": running}


def _group_tasks(ids: list[str]) -> list[dict]:
    """Every member's tasks once each; a task shared by several members lists them all."""
    by_file: dict[str, dict] = {}
    for pid in ids:
        for t in _safe(lambda pid=pid: _tasks(pid), []):
            cur = by_file.setdefault(t["file"], {**t, "owners": []})
            cur["owners"].append(pid)
    out = list(by_file.values())
    out.sort(key=lambda t: (t["status"] == "done", t["due"] or "9999", t["title"].lower()))
    return out


@router.get("/groups")
def groups_list() -> dict:
    rooms = _safe(_rooms, {})
    return {"groups": [
        {"id": r["id"], "name": r["name"], "members": len(r["members"]),
         "disbanded": bool(r["disbandedAt"]), "updatedAt": r["updatedAt"]}
        for r in sorted(rooms.values(), key=lambda r: -(r["updatedAt"] or 0))
    ]}


def _resolve_room(key: str) -> tuple[str, Optional[dict]]:
    """Desktop owner keys look like ``group:id:<roomId>`` or, for rooms made
    before room ids, ``group:name:<name>``; a bare room id also works."""
    k = key[len(GROUP_PREFIX):] if key.startswith(GROUP_PREFIX) else key
    rooms = _safe(_rooms, {})
    if k.startswith("name:"):
        name = k[5:].strip().lower()
        hits = [r for r in rooms.values() if r["name"].strip().lower() == name and not r["disbandedAt"]]
        hits = hits or [r for r in rooms.values() if r["name"].strip().lower() == name]
        return (hits[0]["id"], hits[0]) if hits else (k, None)
    rid = k[3:] if k.startswith("id:") else k
    if not ROOM_ID.fullmatch(rid or ""):
        return rid, None
    return rid, rooms.get(rid)


@router.get("/group")
def group_summary(id: str = Query("", max_length=200)) -> dict:
    rid, room = _resolve_room(id)
    if room is None:
        return {"id": GROUP_PREFIX + rid, "kind": "group", "missing": True,
                "reason": "deleted" if rid else "invalid"}
    members = [_safe(lambda m=m: _member(m), {"id": "?", "name": "Unknown member", "missing": True}) for m in room["members"][:40]]
    local = [m["id"] for m in members if not m.get("missing") and not m.get("remote")]
    count, events = _safe(lambda: _events(rid, room["db"]), (0, []))
    projects, seen = [], set()
    for pid in local:
        for p in _safe(lambda pid=pid: _projects(pid), []):
            if p["name"] not in seen:
                seen.add(p["name"])
                projects.append({**p, "owner": pid})
    home = _group_home(rid)
    return {
        "id": GROUP_PREFIX + rid,
        "roomId": rid,
        "kind": "group",
        "missing": False,
        "name": room["name"],
        "members": members,
        "createdAt": room["createdAt"],
        "updatedAt": room["updatedAt"],
        "disbanded": bool(room["disbandedAt"]),
        "disbandedAt": room["disbandedAt"],
        "eventCount": count,
        "events": events,
        **_safe(lambda: _room_live(rid, room["db"]), {"live": False, "running": 0}),
        "tasks": _group_tasks(local),
        "projects": projects,
        "vault": bd_settings.vault_state(),
        "panel": _safe(lambda: Panel(home, create_home=True, builtin=GROUP_BUILTIN).summary(), {"layout": None, "widgets": [], "notes": []}),
    }


@router.get("/group/stamp")
def group_stamp(id: str = Query("", max_length=200)) -> dict:
    rid, room = _resolve_room(id)
    if room is None:
        return {"stamp": "missing"}
    count = _safe(lambda: _events(rid, room["db"], 0)[0], 0)
    homes = []
    for m in room["members"]:
        try:
            homes.append(_bot_home(_member_profile(_dict(m))))
        except HTTPException:
            homes.append(None)
    parts = [room["updatedAt"], room["revision"], room["disbandedAt"], count,
             *[_mtime(h / "profile.yaml") if h else "x" for h in homes],
             *[_mtime(_group_home(rid) / "panel" / f) for f in ("layout.json", "widgets.json", "notes.json")],
             _dir_stamp(bd_settings.tasks_dir()), _dir_stamp(bd_settings.projects_dir())]
    return {"stamp": "-".join(str(p) for p in parts)}


def _panel(bot: str) -> Panel:
    if bot.startswith(GROUP_PREFIX):
        rid, room = _resolve_room(bot)  # same key forms as GET /group
        if room is None:
            raise HTTPException(404, "This group no longer exists. It was deleted or disbanded.")
        return Panel(_group_home(rid), create_home=True, builtin=GROUP_BUILTIN)
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
    return {"ok": True, "note": _guard(lambda: _panel(body.bot).add_note(body.text or "", author="user"))}


@router.post("/panel/note/update")
def panel_note_update(body: NoteBody) -> dict:
    return {"ok": True, "note": _guard(lambda: _panel(body.bot).update_note(
        body.id or "", text=body.text, pinned=body.pinned, author="user"))}


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
        wid=body.id, height=body.height, author="user"))
    return {"ok": True, "widget": entry}


@router.post("/panel/widget/remove")
def panel_widget_remove(body: WidgetBody) -> dict:
    if not _guard(lambda: _panel(body.bot).remove_widget(body.id or "")):
        raise HTTPException(404, "Widget not found.")
    return {"ok": True}


def _vault_dir(folder: Optional[Path]) -> Path:
    if folder is None:
        raise HTTPException(409, "No notes vault is set. Set vault_path in the Bot Dashboard plugin settings.")
    return folder


def _task_filename(title: str, folder: Path) -> Path:
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", title)
    stem = " ".join(stem.split()).strip(". ")[:80] or "Task"
    if stem.lower() in _RESERVED:
        stem = f"{stem} task"
    path = folder / f"{stem}.md"
    while path.exists():
        path = folder / f"{stem} {secrets.token_hex(2)}.md"
    return path


_RESERVED = {"con", "prn", "aux", "nul"} | {f"com{i}" for i in range(1, 10)} | {f"lpt{i}" for i in range(1, 10)}


def create_task(title: str, owner: str, due: Optional[str] = None) -> Path:
    """Write one task note with TaskNotes-compatible frontmatter into the tasks folder."""
    folder = _vault_dir(bd_settings.tasks_dir())
    root = bd_settings.vault()
    if root is None or not root.is_dir():
        raise HTTPException(409, "The notes vault folder was not found. Check vault_path in the plugin settings.")
    folder.mkdir(parents=True, exist_ok=True)
    now = datetime.now().replace(microsecond=0).isoformat()
    fields = {
        "title": title,
        "status": "open",
        "priority": "normal",
        "due": due,
        "tags": ["task"],
        bd_settings.owner_field(): owner,
        "dateCreated": now,
        "dateModified": now,
    }
    path = _task_filename(title, folder)
    body = yaml.safe_dump(fields, sort_keys=False, allow_unicode=True, default_flow_style=False)
    tmp = path.with_suffix(".md.tmp")
    tmp.write_text(f"---\n{body}---\n\n# {title}\n", encoding="utf-8", newline="\n")
    os.replace(tmp, path)
    return path


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
    path = create_task(title, bot, due=due)
    return {"ok": True, "file": path.name}


class TaskStatus(BaseModel):
    file: str
    status: str


@router.post("/task/status")
def set_task_status(body: TaskStatus) -> dict:
    if body.status not in ("open", "in-progress", "done"):
        raise HTTPException(400, "Unknown status.")
    folder = _vault_dir(bd_settings.tasks_dir())
    path = (folder / body.file).resolve()
    if path.parent != folder.resolve() or path.suffix != ".md" or not path.is_file():
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
