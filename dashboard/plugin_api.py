"""Bot Dashboard REST half: per-bot profile facts, TaskNotes and project notes.

Served by the Hermes dashboard web server under ``/api/plugins/bot-dashboard``.
Reads the shared Hermes root (every profile) and, when the user has set one, a
markdown notes vault (``vault_path`` setting). Vault writes are limited to the
tasks and projects folders: create, edit, or remove (moved to the vault's
``.trash`` folder, as Obsidian does) a task or project note.
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
            "scheduled": _day(fields.get("scheduled")),
            "completed": _day(fields.get("completedDate")),
            "created": _day(fields.get("dateCreated")),
            "modified": _day(fields.get("dateModified")),
            "tags": _strs(fields.get("tags"), skip={"task"}),
            "contexts": _strs(fields.get("contexts")),
            "projects": [_link_name(p) for p in _strs(fields.get("projects"))],
        })
    out.sort(key=lambda t: (t["status"] == "done", t["due"] or "9999", t["title"].lower()))
    return out


def _strs(value: Any, skip: frozenset | set = frozenset()) -> list[str]:
    items = value if isinstance(value, list) else ([value] if value not in (None, "") else [])
    out = []
    for v in items:
        t = str(v).strip().lstrip("#")
        if t and t not in skip and t not in out:
            out.append(t[:60])
    return out[:20]


def _link_name(value: str) -> str:
    m = re.match(r"^\[\[([^\]|#]+)", value.strip())
    return (m.group(1) if m else value).strip()


def _excerpt(body: str, n: int = 240) -> str:
    text = re.sub(r"^#{1,6}\s+.*$", "", body or "", count=1, flags=re.M)
    text = " ".join(text.split())
    return text[:n]


def _projects(bot: Optional[str]) -> list[dict]:
    out = []
    today = date.today()
    for path in _md_files(bd_settings.projects_dir()):
        fields, body = _frontmatter(path)
        if bot is not None and not _owned(fields, bot):
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
            "file": path.name,
            "path": str(fields.get("path") or fields.get("dir") or fields.get("directory") or ""),
            "description": str(fields.get("description") or fields.get("summary") or "")[:300] or _excerpt(body),
            "tags": _strs(fields.get("tags"), skip={"project"}),
            "priority": str(fields.get("priority") or ""),
            "owners": _strs(fields.get(bd_settings.owner_field())),
            "due": _day(fields.get("due") or fields.get("deadline")),
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
        "folders": _folders(),
        "panel": _safe(lambda: Panel(home).summary(), {"layout": None, "widgets": [], "notes": []}),
    }


def _folders() -> dict:
    t, p = bd_settings.tasks_dir(), bd_settings.projects_dir()
    return {"tasks": str(t) if t else "", "projects": str(p) if p else "",
            "notes": "panel/notes"}


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
    parts = [_mtime(f) for f in files] + [_dir_stamp(home / "panel" / "notes"),
                                          _dir_stamp(bd_settings.tasks_dir()), _dir_stamp(bd_settings.projects_dir())]
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


def _rooms_query(sql: str, args: tuple = (), fallback: Optional[str] = None) -> list[tuple[Path, list[sqlite3.Row]]]:
    """Run one read-only query on every room database. ``fallback`` is tried on
    a database where ``sql`` fails, e.g. an older install missing a column."""
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
            for q in (sql, fallback):
                if not q:
                    continue
                try:
                    out.append((db, con.execute(q, args).fetchall()))
                    break
                except sqlite3.Error:  # table or column missing on an older install, or the file is busy
                    continue
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


def _jload(raw: Any) -> dict:
    try:
        return _dict(json.loads(raw or "{}"))
    except (TypeError, ValueError):
        return {}


def _clip(text: Any, n: int) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _event(r: sqlite3.Row, names: dict[str, str], text_len: int = 280) -> dict:
    actor = _jload(r["actor_json"])
    payload = _jload(r["payload_json"]) if "payload_json" in r.keys() else {}
    kind = str(r["kind"] or "")
    member = str(payload.get("member_id") or (actor.get("id") if actor.get("kind") == "member" else "") or "")
    who = names.get(member) or str(actor.get("display_name") or actor.get("handle") or actor.get("profile") or "")
    akind = str(actor.get("kind") or "")
    if not who:
        who = {"user": "You", "system": "Room", "gateway": "Gateway"}.get(akind, akind or "Room")
    text = payload.get("text") or payload.get("error") or payload.get("reason") or ""
    if kind == "room.renamed":
        text = f"Renamed to {payload.get('name') or '?'}"
    elif kind == "room.activity" and not text:
        text = str(payload.get("reason_code") or payload.get("status") or "").replace("_", " ")
    out = {
        "seq": r["seq"],
        "kind": kind,
        "actor": who,
        "actorKind": akind,
        "member": member,
        "at": _num(r["created_at"]),
        "text": _clip(text, text_len),
        "thread": str(payload.get("thread_id") or "")[:64],
    }
    if kind == "turn.settled" and payload.get("passed"):
        out["passed"] = True
    if payload.get("attachments"):
        out["attachments"] = len(_list(payload.get("attachments")))
    return out


def _room_names(room: Optional[dict]) -> dict[str, str]:
    names = {}
    for m in (room or {}).get("members", []):
        mid = str(m.get("member_id") or _member_profile(m) or "")
        if mid:
            names[mid] = str(m.get("display_name") or m.get("handle") or mid)
    return names


def _events(rid: str, db: Path, limit: int = 8, before: Optional[int] = None,
            room: Optional[dict] = None, text_len: int = 280) -> tuple[int, list[dict]]:
    count, events = 0, []
    names = _room_names(room)
    for src, rows in _rooms_query("SELECT COUNT(*) AS n FROM hosted_room_events WHERE room_id = ?", (rid,)):
        if src == db and rows:
            count = int(rows[0]["n"] or 0)
    if limit <= 0:
        return count, events
    sql = ("SELECT seq, kind, actor_json, payload_json, created_at FROM hosted_room_events WHERE room_id = ?"
           + (" AND seq < ?" if before else "") + " ORDER BY seq DESC LIMIT ?")
    args = (rid, int(before), limit) if before else (rid, limit)
    for src, rows in _rooms_query(sql, args, sql.replace("payload_json, ", "")):
        if src != db:
            continue
        for r in rows:
            events.append(_safe(lambda r=r: _event(r, names, text_len),
                                {"seq": r["seq"], "kind": str(r["kind"] or ""), "actor": "", "at": _num(r["created_at"])}))
    return count, events


ACTIVE_TURNS = ("queued", "running", "deferred", "stopping")


def _turn_topic(prompt: str) -> str:
    """The newest message a member was asked to answer, from its turn prompt."""
    lines = [ln.strip() for ln in str(prompt or "").splitlines() if ln.strip()]
    for ln in reversed(lines):
        m = re.match(r"^(User \(user\)|@[\w-]+):\s*(.+)$", ln)
        if m:
            who = "You" if m.group(1).startswith("User") else m.group(1)
            return _clip(f"{who}: {m.group(2)}", 160)
    return ""


def _room_live(rid: str, db: Path, room: Optional[dict] = None) -> dict:
    """Whether a gateway drives the room, which members have a turn in flight,
    and what each member did last."""
    now = time.time()
    live, active, last = False, [], {}
    for src, rows in _rooms_query("SELECT expires_at, released_at FROM hosted_room_driver_leases WHERE room_id = ?", (rid,)):
        if src == db:
            live = any((_num(r["expires_at"]) or 0) > now and not r["released_at"] for r in rows)
    for src, rows in _rooms_query(
            "SELECT task_id, thread_id, status, payload_json, created_at, started_at, updated_at, terminal_at, result_json "
            "FROM hosted_room_driver_tasks WHERE room_id = ? ORDER BY created_at DESC LIMIT 200", (rid,),
            "SELECT NULL AS task_id, NULL AS thread_id, 'running' AS status, NULL AS payload_json, NULL AS created_at, "
            "NULL AS started_at, NULL AS updated_at, terminal_at, NULL AS result_json "
            "FROM hosted_room_driver_tasks WHERE room_id = ?"):
        if src != db:
            continue
        for r in rows:
            payload = _jload(r["payload_json"])
            member = str(payload.get("target_member_id") or payload.get("target_profile") or "")
            status = str(r["status"] or "")
            if status in ACTIVE_TURNS and r["terminal_at"] is None:
                active.append({
                    "member": member,
                    "profile": str(payload.get("target_profile") or member),
                    "status": status,
                    "since": _num(r["started_at"]) or _num(r["created_at"]),
                    "topic": _turn_topic(payload.get("prompt")),
                    "thread": str(r["thread_id"] or "")[:64],
                })
            elif member and member not in last:
                result = _jload(r["result_json"])
                last[member] = {
                    "status": status,
                    "at": _num(r["terminal_at"]) or _num(r["updated_at"]),
                    "text": _clip(result.get("text") or result.get("error") or "", 160),
                }
    return {"live": live, "running": len(active), "active": active, "last": last}


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
    before room ids, ``group:name:<name>``; a bare room id or a room's name
    (what a bot usually passes) also works."""
    k = str(key or "").strip()
    k = k[len(GROUP_PREFIX):] if k.startswith(GROUP_PREFIX) else k
    rooms = _safe(_rooms, {})

    def by_name(name: str):
        name = name.strip().lower()
        hits = [r for r in rooms.values() if r["name"].strip().lower() == name and not r["disbandedAt"]]
        hits = hits or [r for r in rooms.values() if r["name"].strip().lower() == name]
        return (hits[0]["id"], hits[0]) if hits else None

    if k.startswith("name:"):
        return by_name(k[5:]) or (k, None)
    rid = k[3:] if k.startswith("id:") else k
    if ROOM_ID.fullmatch(rid or "") and rid in rooms:
        return rid, rooms[rid]
    return by_name(k) or (rid, None)


@router.get("/group")
def group_summary(id: str = Query("", max_length=200)) -> dict:
    rid, room = _resolve_room(id)
    if room is None:
        return {"id": GROUP_PREFIX + rid, "kind": "group", "missing": True,
                "reason": "deleted" if rid else "invalid"}
    members = [_safe(lambda m=m: _member(m), {"id": "?", "name": "Unknown member", "missing": True}) for m in room["members"][:40]]
    local = [m["id"] for m in members if not m.get("missing") and not m.get("remote")]
    count, events = _safe(lambda: _events(rid, room["db"], 12, room=room, text_len=200), (0, []))
    live = _safe(lambda: _room_live(rid, room["db"], room), {"live": False, "running": 0, "active": [], "last": {}})
    mids = {_member_profile(raw) or "hermes": str(raw.get("member_id") or "") for raw in room["members"][:40]}
    for m in members:
        keys = {m.get("id"), mids.get(m.get("id"), "")} - {""}
        turn = next((a for a in live["active"] if a["member"] in keys or a["profile"] in keys), None)
        done = next((live["last"][k] for k in keys if k in live["last"]), None)
        m["state"] = ("missing" if m.get("missing") else "remote" if m.get("remote")
                      else turn["status"] if turn else "idle")
        if turn:
            m["doing"] = turn["topic"] or "Working on a turn"
            m["since"] = turn["since"]
        if done:
            m["lastStatus"], m["lastAt"], m["lastText"] = done["status"], done["at"], done["text"]
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
        "live": live["live"],
        "running": live["running"],
        "active": live["active"],
        "tasks": _group_tasks(local),
        "projects": projects,
        "vault": bd_settings.vault_state(),
        "folders": _folders(),
        "panel": _safe(lambda: Panel(home, create_home=True, builtin=GROUP_BUILTIN).summary(), {"layout": None, "widgets": [], "notes": []}),
    }


@router.get("/group/activity")
def group_activity(id: str = Query("", max_length=200), limit: int = Query(60, ge=1, le=200),
                   before: Optional[int] = Query(None, ge=1)) -> dict:
    """A page of room events, newest first, for the activity window."""
    rid, room = _resolve_room(id)
    if room is None:
        raise HTTPException(404, "This group no longer exists. It was deleted or disbanded.")
    count, events = _safe(lambda: _events(rid, room["db"], limit, before, room, 1200), (0, []))
    live = _safe(lambda: _room_live(rid, room["db"], room), {"live": False, "running": 0, "active": [], "last": {}})
    return {"count": count, "events": events, "active": live["active"], "live": live["live"],
            "more": bool(events) and (events[-1].get("seq") or 0) > 1}


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
             _dir_stamp(_group_home(rid) / "panel" / "notes"), _safe(lambda: _turn_stamp(rid, room["db"]), 0),
             _dir_stamp(bd_settings.tasks_dir()), _dir_stamp(bd_settings.projects_dir())]
    return {"stamp": "-".join(str(p) for p in parts)}


def _turn_stamp(rid: str, db: Path) -> str:
    for src, rows in _rooms_query(
            "SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM hosted_room_driver_tasks WHERE room_id = ?", (rid,),
            "SELECT COUNT(*) AS n, MAX(terminal_at) AS u FROM hosted_room_driver_tasks WHERE room_id = ?"):
        if src == db and rows:
            return f"{rows[0]['n']}.{rows[0]['u']}"
    return "0"


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
    title: Optional[str] = None
    tags: Optional[list[str]] = None


@router.get("/panel/notes")
def panel_notes(bot: str = Query("", max_length=200)) -> dict:
    """Every note with its full Markdown body, for the notes window."""
    return {"notes": _guard(lambda: _panel(bot).notes())}


@router.get("/panel/note")
def panel_note_get(bot: str = Query("", max_length=200), id: str = Query("", max_length=40)) -> dict:
    return {"note": _guard(lambda: _panel(bot).note(id))}


@router.post("/panel/note")
def panel_note_add(body: NoteBody) -> dict:
    return {"ok": True, "note": _guard(lambda: _panel(body.bot).add_note(
        body.text or "", author="user", title=body.title, tags=body.tags, pinned=bool(body.pinned)))}


@router.post("/panel/note/update")
def panel_note_update(body: NoteBody) -> dict:
    return {"ok": True, "note": _guard(lambda: _panel(body.bot).update_note(
        body.id or "", text=body.text, pinned=body.pinned, author="user", title=body.title, tags=body.tags))}


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


def _now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def _vault_root() -> Path:
    root = bd_settings.vault()
    if root is None or not root.is_dir():
        raise HTTPException(409, "The notes vault folder was not found. Check vault_path in the plugin settings.")
    return root


def _note_in(folder: Optional[Path], name: str, label: str) -> Path:
    folder = _vault_dir(folder)
    path = (folder / str(name or "")).resolve()
    if path.parent != folder.resolve() or path.suffix != ".md" or not path.is_file():
        raise HTTPException(404, f"{label} not found.")
    return path


def _fm_value(value: Any) -> str:
    if value is None:
        return "null"
    return json.dumps(value, ensure_ascii=False)  # JSON scalars and lists are valid YAML


def _set_fields(text: str, updates: dict) -> str:
    """Rewrite only the named frontmatter keys; every other line stays as written."""
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    if not m:
        raise HTTPException(422, "The note has no frontmatter.")
    lines = m.group(1).splitlines()
    for key, value in updates.items():
        new = f"{key}: {_fm_value(value)}"
        idx = next((i for i, ln in enumerate(lines) if re.match(rf"^{re.escape(key)}\s*:", ln)), None)
        if idx is None:
            lines.append(new)
            continue
        end = idx + 1
        while end < len(lines) and re.match(r"^(\s+\S|\s*-\s)", lines[end]):
            end += 1  # an indented block list or mapping under the key
        lines[idx:end] = [new]
    return "---\n" + "\n".join(lines) + "\n---" + text[m.end():]


def _write(path: Path, text: str) -> None:
    tmp = path.with_suffix(".md.tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def _trash(path: Path) -> str:
    """Move a vault note to <vault>/.trash, the folder Obsidian itself uses."""
    trash = _vault_root() / ".trash"
    trash.mkdir(exist_ok=True)
    dest = trash / path.name
    while dest.exists():
        dest = trash / f"{path.stem} {secrets.token_hex(2)}.md"
    os.replace(path, dest)
    return dest.name


def _tag_list(tags: Optional[list[str]], base: str) -> list[str]:
    out = [base]
    for t in tags or []:
        t = re.sub(r"[^\w/-]+", "-", str(t).strip().lstrip("#")).strip("-")[:40]
        if t and t not in out:
            out.append(t)
    return out[:20]


DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PRIORITIES = ("low", "normal", "high", "urgent")
TASK_STATUSES = ("open", "in-progress", "waiting", "done", "cancelled")


def _due(value: Optional[str]) -> Optional[str]:
    return value if value and DAY.match(value) else None


def create_task(title: str, owner: str, due: Optional[str] = None, priority: str = "normal",
                tags: Optional[list[str]] = None, project: Optional[str] = None) -> Path:
    """Write one task note with TaskNotes-compatible frontmatter into the tasks folder."""
    folder = _vault_dir(bd_settings.tasks_dir())
    _vault_root()
    folder.mkdir(parents=True, exist_ok=True)
    now = _now()
    fields = {
        "title": title,
        "status": "open",
        "priority": priority if priority in PRIORITIES else "normal",
        "due": due,
        "tags": _tag_list(tags, "task"),
        bd_settings.owner_field(): owner,
        "dateCreated": now,
        "dateModified": now,
    }
    if project:
        fields["projects"] = [f"[[{project}]]"]
    path = _task_filename(title, folder)
    body = yaml.safe_dump(fields, sort_keys=False, allow_unicode=True, default_flow_style=False)
    _write(path, f"---\n{body}---\n\n# {title}\n")
    return path


class NewTask(BaseModel):
    bot: str
    title: str
    due: Optional[str] = None
    priority: Optional[str] = None
    tags: Optional[list[str]] = None
    project: Optional[str] = None


@router.post("/task")
def add_task(body: NewTask) -> dict:
    bot = _norm_bot(body.bot)
    _bot_home(body.bot)
    title = " ".join(body.title.split())[:200]
    if not title:
        raise HTTPException(400, "A task needs a title.")
    project = " ".join(str(body.project or "").split())[:120] or None
    path = create_task(title, bot, due=_due(body.due), priority=body.priority or "normal",
                       tags=body.tags, project=project)
    return {"ok": True, "file": path.name}


class TaskStatus(BaseModel):
    file: str
    status: str


@router.post("/task/status")
def set_task_status(body: TaskStatus) -> dict:
    if body.status not in TASK_STATUSES:
        raise HTTPException(400, "Unknown status.")
    path = _note_in(bd_settings.tasks_dir(), body.file, "Task")
    now = _now()
    updates: dict = {"status": body.status, "dateModified": now}
    updates["completedDate"] = now if body.status == "done" else None
    _write(path, _set_fields(path.read_text(encoding="utf-8"), updates))
    return {"ok": True}


class TaskEdit(BaseModel):
    file: str
    title: Optional[str] = None
    due: Optional[str] = None
    priority: Optional[str] = None
    tags: Optional[list[str]] = None
    owner: Optional[str] = None


@router.post("/task/update")
def update_task(body: TaskEdit) -> dict:
    path = _note_in(bd_settings.tasks_dir(), body.file, "Task")
    updates: dict = {"dateModified": _now()}
    if body.title is not None:
        title = " ".join(body.title.split())[:200]
        if not title:
            raise HTTPException(400, "A task needs a title.")
        updates["title"] = title
    if body.due is not None:
        updates["due"] = _due(body.due)
    if body.priority is not None:
        if body.priority not in PRIORITIES:
            raise HTTPException(400, "Unknown priority.")
        updates["priority"] = body.priority
    if body.tags is not None:
        updates["tags"] = _tag_list(body.tags, "task")
    if body.owner is not None:
        _bot_home(body.owner)
        updates[bd_settings.owner_field()] = _norm_bot(body.owner)
    _write(path, _set_fields(path.read_text(encoding="utf-8"), updates))
    return {"ok": True}


class NoteFile(BaseModel):
    file: str


@router.post("/task/delete")
def delete_task(body: NoteFile) -> dict:
    return {"ok": True, "trashed": _trash(_note_in(bd_settings.tasks_dir(), body.file, "Task"))}


# ---------------------------------------------------------------- projects

PROJECT_STATUSES = ("idea", "planning", "active", "paused", "blocked", "done", "archived")


class ProjectBody(BaseModel):
    bot: Optional[str] = None
    file: Optional[str] = None
    name: Optional[str] = None
    status: Optional[str] = None
    next: Optional[str] = None
    repo: Optional[str] = None
    path: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    priority: Optional[str] = None
    due: Optional[str] = None
    owners: Optional[list[str]] = None


def _project_fields(body: ProjectBody) -> dict:
    out: dict = {}
    if body.status is not None:
        status = body.status.strip().lower()
        if status not in PROJECT_STATUSES:
            raise HTTPException(400, "Unknown project status.")
        out["status"] = status
    for key in ("next", "repo", "path", "description"):
        val = getattr(body, key)
        if val is not None:
            out[key] = " ".join(val.split())[:400] if key != "path" else val.strip()[:400]
    if body.tags is not None:
        out["tags"] = _tag_list(body.tags, "project")
    if body.priority is not None:
        if body.priority and body.priority not in PRIORITIES:
            raise HTTPException(400, "Unknown priority.")
        out["priority"] = body.priority or None
    if body.due is not None:
        out["due"] = _due(body.due)
    if body.owners is not None:
        owners = []
        for o in body.owners:
            _bot_home(o)
            owners.append(_norm_bot(o))
        out[bd_settings.owner_field()] = owners
    return out


def _project_name(name: Optional[str]) -> str:
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f\[\]#^]', " ", str(name or ""))
    stem = " ".join(stem.split()).strip(". ")[:80]
    if not stem:
        raise HTTPException(400, "A project needs a name.")
    if stem.lower() in _RESERVED:
        stem = f"{stem} project"
    return stem


@router.get("/projects")
def projects_list(bot: str = Query("", max_length=64), all: bool = Query(False)) -> dict:
    return {"projects": _safe(lambda: _projects(None if all else _norm_bot(bot)), []),
            "folder": _folders()["projects"], "vault": bd_settings.vault_state()}


@router.post("/project")
def add_project(body: ProjectBody) -> dict:
    folder = _vault_dir(bd_settings.projects_dir())
    _vault_root()
    folder.mkdir(parents=True, exist_ok=True)
    stem = _project_name(body.name)
    path = folder / f"{stem}.md"
    if path.exists():
        raise HTTPException(409, f"A project named {stem} already exists.")
    owner = _norm_bot(body.bot or "")
    _bot_home(body.bot or "")
    now = _now()
    fields = {"title": stem, "status": "active", "tags": ["project"], bd_settings.owner_field(): owner,
              "next": "", "repo": "", "path": "", "updated": now[:10], "created": now[:10]}
    fields.update(_project_fields(body))
    if body.owners is None:
        fields[bd_settings.owner_field()] = owner
    head = yaml.safe_dump({k: v for k, v in fields.items() if v not in (None,)}, sort_keys=False,
                          allow_unicode=True, default_flow_style=False)
    desc = fields.get("description") or ""
    _write(path, f"---\n{head}---\n\n# {stem}\n\n{desc}\n\n## Next\n\n- [ ] {fields.get('next') or ''}\n".rstrip() + "\n")
    return {"ok": True, "file": path.name}


@router.post("/project/update")
def update_project(body: ProjectBody) -> dict:
    path = _note_in(bd_settings.projects_dir(), body.file or "", "Project")
    updates = _project_fields(body)
    updates["updated"] = _now()[:10]
    text = _set_fields(path.read_text(encoding="utf-8"), updates)
    dest = path
    if body.name is not None and _project_name(body.name) != path.stem:
        stem = _project_name(body.name)
        dest = path.with_name(f"{stem}.md")
        if dest.exists():
            raise HTTPException(409, f"A project named {stem} already exists.")
        text = _set_fields(text, {"title": stem})
    _write(path, text)
    if dest != path:
        os.replace(path, dest)
    return {"ok": True, "file": dest.name}


@router.post("/project/delete")
def delete_project(body: NoteFile) -> dict:
    return {"ok": True, "trashed": _trash(_note_in(bd_settings.projects_dir(), body.file, "Project"))}



# ---------------------------------------------------------------- session todo lists

TODO_STATUSES = ("pending", "in_progress", "completed", "cancelled")


def _todo_items(content: Any) -> list[dict]:
    try:
        data = json.loads(content) if isinstance(content, str) else content
    except (TypeError, ValueError):
        return []
    items = data.get("todos") if isinstance(data, dict) else data
    out = []
    for t in _list(items)[:100]:
        if not isinstance(t, dict):
            continue
        text = " ".join(str(t.get("content") or "").split())[:400]
        if not text:
            continue
        status = str(t.get("status") or "pending").strip().lower()
        out.append({"id": str(t.get("id") or "")[:80], "content": text,
                    "status": status if status in TODO_STATUSES else "pending"})
    return out


def _session_todos(bot: str, session: str, past: int) -> dict:
    db = _bot_home(bot) / "state.db"
    if not db.is_file():
        return {"current": None, "past": []}
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=2)
    try:
        def latest(sid: str):
            # Indexed by session; a full scan of a large state.db takes seconds.
            return con.execute(
                "SELECT content, timestamp FROM messages WHERE session_id = ? AND role = 'tool' "
                "AND tool_name = 'todo_list' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()

        current = None
        if session:
            row = latest(session)
            current = {"session": session, "at": row[1] if row else None,
                       "todos": _todo_items(row[0]) if row else []}
        hist: list[dict] = []
        if past:
            rows = con.execute(
                "SELECT id, title, COALESCE(last_activity_at, started_at) AS at FROM sessions "
                "WHERE COALESCE(archived, 0) = 0 ORDER BY at DESC LIMIT 60").fetchall()
            for sid, title, at in rows:
                if sid == session:
                    continue
                row = latest(sid)
                items = _todo_items(row[0]) if row else []
                if items:
                    hist.append({"session": sid, "title": str(title or "Untitled chat")[:120],
                                 "at": row[1] or at, "todos": items})
                if len(hist) >= past:
                    break
        return {"current": current, "past": hist}
    finally:
        con.close()


@router.get("/session/todos")
def session_todos(bot: str = Query("", max_length=64), session: str = Query("", max_length=200),
                  past: int = Query(0, ge=0, le=30)) -> dict:
    """The focused chat's todo list, and the lists left in recent chats of this bot."""
    return _safe(lambda: _session_todos(_norm_bot(bot), session.strip(), past), {"current": None, "past": []})


# ---------------------------------------------------------------- plugin settings

SETTING_KEYS = ("vault_path", "tasks_folder", "projects_folder", "owner_field", "panel_rule")


def _settings_path() -> Path:
    return bd_settings.hermes_root() / "config.yaml"


@router.get("/settings")
def settings_get() -> dict:
    """The five Bot Dashboard settings, with their live values and env overrides."""
    def read():
        values = {k: bd_settings.setting(k) for k in SETTING_KEYS}
        env = {k: k.upper() in os.environ or ("BOT_DASHBOARD_" + k.upper()) in os.environ
               for k in SETTING_KEYS}
        vault = bd_settings.vault()
        return {
            "settings": values,
            "defaults": dict(bd_settings.DEFAULTS),
            "envOverrides": env,
            "vaultFound": bool(vault and vault.is_dir()),
            "vaultState": bd_settings.vault_state(),
            "path": str(_settings_path())
        }
    return _safe(read, {"settings": {k: bd_settings.DEFAULTS[k] for k in SETTING_KEYS},
                        "defaults": dict(bd_settings.DEFAULTS), "envOverrides": {},
                        "vaultFound": False, "vaultState": {}, "path": ""})


class SettingsBody(BaseModel):
    settings: dict[str, str]


def _settings_block_lines(text: str) -> tuple[int, int, int] | None:
    """Locate plugins.entries.bot-dashboard.settings in config.yaml by line
    number, so a save touches only those lines and leaves tokens intact.
    Returns (start_line, end_line_exclusive, indent)."""
    try:
        node = yaml.compose(text)
    except yaml.YAMLError:
        return None
    def child(mapping, name):
        if not isinstance(mapping, yaml.MappingNode):
            return None
        for k, v in mapping.value:
            if getattr(k, "value", "") == name:
                return v
        return None
    try:
        settings = child(child(child(child(node, "plugins"), "entries"), "bot-dashboard"), "settings")
    except Exception:
        return None
    if settings is None or not isinstance(settings, yaml.MappingNode) or not settings.value:
        return None
    start = min(k.start_mark.line for k, _ in settings.value)
    end = max(v.end_mark.line for _, v in settings.value) + 1
    indent = settings.value[0][0].start_mark.column
    return start, end, indent


@router.post("/settings")
def settings_save(body: SettingsBody) -> dict:
    """Replace only the five allowlisted keys inside
    plugins.entries.bot-dashboard.settings. The rest of config.yaml — including
    tokens, comments and every other plugin — is never rewritten."""
    updates = body.settings if isinstance(body.settings, dict) else {}
    for key, value in updates.items():
        if key not in SETTING_KEYS:
            raise HTTPException(400, f"Unknown setting: {key}")
        if not isinstance(value, str) or len(value) > 1000:
            raise HTTPException(400, f"Invalid value for {key}.")
        if key in ("vault_path", "tasks_folder", "projects_folder") and "\x00" in value:
            raise HTTPException(400, f"Invalid path for {key}.")

    path = _settings_path()
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        text = ""
    block = _settings_block_lines(text)
    merged = {k: bd_settings.setting(k) for k in SETTING_KEYS}
    merged.update({k: v.strip() for k, v in updates.items()})
    payload = yaml.safe_dump(merged, sort_keys=False, allow_unicode=True, default_flow_style=False)
    indented = "".join(" " * block[2] + line + "\n" for line in payload.splitlines()) if block else ""
    lines = text.splitlines(keepends=True)
    if block and block[1] <= len(lines):
        lines[block[0]:block[1]] = [indented]
    else:
        # No settings block yet: append one under plugins.entries.bot-dashboard.
        lines.append("plugins:\n  entries:\n    bot-dashboard:\n      settings:\n" + indented)
    text = "".join(lines)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".yaml.tmp")
    try:
        tmp.write_text(text, encoding="utf-8", newline="")
        os.replace(tmp, path)
    except OSError as exc:
        raise HTTPException(503, f"Could not save the settings: {exc}") from exc
    # The settings cache keys on mtime; a fresh write invalidates it.
    return {"ok": True, "settings": {k: bd_settings.setting(k) for k in SETTING_KEYS}}
