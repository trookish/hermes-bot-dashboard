"""Storage for one bot's panel: layout, custom widgets and notes.

Lives in ``<profile home>/panel/``:
  layout.json            {"order": [...], "hidden": [...]}
  widgets.json           [{"id", "title", "height", "updated", "author"}]
  widgets/<id>.html      the widget body (self-contained HTML)
  notes/<id>.md          one Markdown note per file (YAML frontmatter: title,
                         tags, pinned, author, created, updated); notes.json
                         from older versions is migrated on first use

Shared by the agent half (bot tools) and the REST half (the desktop pane), so
both always read and write the same files. Writes are atomic.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import secrets
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

try:
    import msvcrt  # Windows
except ImportError:  # pragma: no cover
    msvcrt = None
try:
    import fcntl  # POSIX
except ImportError:  # pragma: no cover
    fcntl = None

BUILTIN = ["profile", "jobs", "tasks", "notes", "projects"]
# A group dashboard has no jobs of its own; it shows the room and its members.
GROUP_BUILTIN = ["profile", "members", "activity", "tasks", "notes", "projects"]
MAX_HTML = 200_000
MAX_NOTE = 100_000
MAX_NOTES = 300
MAX_WIDGETS = 24
_SLUG = re.compile(r"[^a-z0-9]+")
_LOCK = threading.Lock()


def now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def slug(text: str) -> str:
    s = _SLUG.sub("-", text.lower()).strip("-")[:40]
    return s or "widget"


_NOTE_ID = re.compile(r"[a-z0-9]{4,32}")
_FM = re.compile(r"\A---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)
_TAG = re.compile(r"(?<![\w&/#])#([A-Za-z][\w/-]{0,39})")
_WIKI = re.compile(r"\[\[([^\]|#\n]{1,120})(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]")
_TASK_OPEN = re.compile(r"^\s*[-*+] \[ \]", re.M)
_TASK_DONE = re.compile(r"^\s*[-*+] \[[xX]\]", re.M)
_FENCE = re.compile(r"```.*?(?:```|\Z)|`[^`\n]*`", re.S)


def _as_list(value: Any) -> list:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [v for v in re.split(r"[,\s]+", value) if v]
    return list(value) if isinstance(value, (list, tuple, set)) else [value]


def _title_of(text: str) -> str:
    for line in str(text or "").splitlines():
        line = line.strip()
        if line:
            return re.sub(r"^#{1,6}\s+", "", line).strip()[:120]
    return ""


def _inline_tags(text: str) -> list[str]:
    out = []
    for t in _TAG.findall(_FENCE.sub(" ", str(text or ""))):
        if t not in out:
            out.append(t)
    return out[:20]


def _wikilinks(text: str) -> list[str]:
    out = []
    for t in _WIKI.findall(str(text or "")):
        t = t.strip()
        if t and t not in out:
            out.append(t)
    return out[:40]


def _parse_note(raw: str) -> tuple[dict, str]:
    m = _FM.match(raw or "")
    if not m:
        return {}, raw or ""
    block, body = m.group(1), raw[m.end():]
    meta: dict = {}
    try:
        import yaml  # optional; JSON-valued lines below cover the plugin's own files
        loaded = yaml.safe_load(block)
        if isinstance(loaded, dict):
            meta = {str(k): v for k, v in loaded.items()}
    except Exception:  # noqa: BLE001
        for line in block.splitlines():
            k, sep, v = line.partition(":")
            if not sep:
                continue
            v = v.strip()
            try:
                meta[k.strip()] = json.loads(v)
            except ValueError:
                meta[k.strip()] = v.strip("'\"")
    for k, v in list(meta.items()):
        if isinstance(v, datetime):
            meta[k] = v.replace(microsecond=0).isoformat()
        elif hasattr(v, "isoformat") and not isinstance(v, (str, bool)):
            meta[k] = v.isoformat()
    return meta, body.lstrip("\n").rstrip()


def _dump_note(meta: dict, body: str) -> str:
    order = ["title", "tags", "pinned", "author", "editedBy", "created", "updated"]
    keys = [k for k in order if k in meta] + [k for k in meta if k not in order]
    lines = [f"{k}: {json.dumps(meta[k], ensure_ascii=False)}" for k in keys if meta[k] is not None]
    return "---\n" + "\n".join(lines) + "\n---\n\n" + (body or "").rstrip() + "\n"


class PanelError(ValueError):
    pass


class PanelBusy(OSError):
    """The panel files stayed locked by another process; safe to retry."""


def _atomic_write(path: Path, text: str) -> None:
    """Write via a unique temp file, retrying the swap while a reader holds the target."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        for attempt in range(40):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                time.sleep(0.025 * (attempt + 1) if attempt < 10 else 0.25)
        raise PanelBusy(f"{path.name} is locked by another program.")
    finally:
        with contextlib.suppress(OSError):
            os.unlink(tmp)


class Panel:
    def __init__(self, home: Path, create_home: bool = False, builtin: Optional[list] = None):
        self.builtin = list(builtin or BUILTIN)
        self.home = Path(home)
        self.dir = self.home / "panel"
        # A bot's profile folder must already exist: writing into a deleted (or
        # renamed) profile would silently recreate it as an empty shell.
        self.create_home = create_home

    @contextlib.contextmanager
    def _locked(self):
        """Serialize writers across threads AND processes (agent + dashboard)."""
        gone = PanelError("This bot no longer exists. It was deleted or renamed.")
        if not self.create_home and not self.home.is_dir():
            raise gone
        try:
            # Without parents=True a profile deleted after the check above is
            # not recreated: mkdir fails instead of rebuilding the whole path.
            self.dir.mkdir(parents=self.create_home, exist_ok=True)
        except FileNotFoundError:
            raise gone from None
        with _LOCK:
            try:
                fh = open(self.dir / ".lock", "a+b")
            except FileNotFoundError:
                raise gone from None
            try:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        if msvcrt:
                            fh.seek(0)
                            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
                        elif fcntl:
                            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except OSError:
                        if time.monotonic() > deadline:
                            raise PanelBusy("The panel is busy; try again.")
                        time.sleep(0.02)
                try:
                    yield
                finally:
                    with contextlib.suppress(OSError):
                        if msvcrt:
                            fh.seek(0)
                            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
                        elif fcntl:
                            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            finally:
                fh.close()

    # ------------------------------------------------------------ io
    def _read(self, name: str, default: Any) -> Any:
        path = self.dir / name
        for attempt in range(20):
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return default
            except PermissionError:
                time.sleep(0.02 * (attempt + 1))
            except (OSError, ValueError):
                return default
        raise PanelBusy(f"{name} is locked by another program.")

    def _write(self, name: str, data: Any) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        _atomic_write(self.dir / name, json.dumps(data, ensure_ascii=False, indent=1))

    # ------------------------------------------------------------ widgets
    def widgets(self, with_html: bool = False) -> list[dict]:
        items = [w for w in self._read("widgets.json", []) if isinstance(w, dict) and w.get("id")]
        if with_html:
            for w in items:
                try:
                    w["html"] = (self.dir / "widgets" / f"{w['id']}.html").read_text(encoding="utf-8")
                except OSError:
                    w["html"] = ""
        return items

    def _widget_path(self, wid: str) -> Path:
        if not re.fullmatch(r"[a-z0-9-]{1,40}", wid or ""):
            raise PanelError("Invalid widget id.")
        return self.dir / "widgets" / f"{wid}.html"

    def save_widget(self, *, title: str, html: str, wid: Optional[str] = None,
                    height: Optional[int] = None, author: str = "bot") -> dict:
        title = " ".join(str(title or "").split())[:80]
        if not title:
            raise PanelError("A widget needs a title.")
        html = str(html or "")
        if not html.strip():
            raise PanelError("A widget needs HTML content.")
        if len(html) > MAX_HTML:
            raise PanelError(f"Widget HTML is over {MAX_HTML} characters.")
        if height not in (None, "", 0):
            try:
                height = max(80, min(int(height), 2000))
            except (TypeError, ValueError):
                raise PanelError("Height must be a whole number of pixels.") from None
        else:
            height = None
        with self._locked():
            items = self.widgets()
            ids = {w["id"] for w in items}
            if wid:  # explicit update: must exist, never silently create
                existing = next((w for w in items if w["id"] == wid), None)
                if existing is None:
                    raise PanelError("Widget not found.")
            else:  # new widget: never overwrite one that shares a title
                existing = None
                base = slug(title)
                wid = base
                while wid in ids:
                    wid = f"{base[:33]}-{secrets.token_hex(3)}"
                if len(items) >= MAX_WIDGETS:
                    raise PanelError(f"This panel already has {MAX_WIDGETS} custom widgets.")
            path = self._widget_path(wid)
            path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write(path, html)
            entry = existing or {"id": wid, "created": now()}
            entry.update({"title": title, "updated": now(), "author": author})
            if height:
                entry["height"] = height
            if existing is None:
                items.append(entry)
                layout = self.layout()
                key = f"w:{wid}"
                if key not in layout["order"]:
                    layout["order"].insert(1, key)  # right under the profile card
                    self._write("layout.json", layout)
            self._write("widgets.json", items)
            return entry

    def remove_widget(self, wid: str) -> bool:
        with self._locked():
            items = self.widgets()
            keep = [w for w in items if w["id"] != wid]
            if len(keep) == len(items):
                return False
            self._write("widgets.json", keep)
            try:
                self._widget_path(wid).unlink()
            except OSError:
                pass
            layout = self.layout()
            layout["order"] = [k for k in layout["order"] if k != f"w:{wid}"]
            layout["hidden"] = [k for k in layout["hidden"] if k != f"w:{wid}"]
            self._write("layout.json", layout)
            return True

    # ------------------------------------------------------------ layout
    def layout(self) -> dict:
        raw = self._read("layout.json", {})
        order = [k for k in raw.get("order", []) if isinstance(k, str)] if isinstance(raw, dict) else []
        hidden = [k for k in raw.get("hidden", []) if isinstance(k, str)] if isinstance(raw, dict) else []
        known = set(self.builtin) | {f"w:{w['id']}" for w in self.widgets()}
        order = [k for k in dict.fromkeys(order) if k in known]
        for k in self.builtin + [f"w:{w['id']}" for w in self.widgets()]:
            if k not in order:
                order.append(k)
        return {"order": order, "hidden": [k for k in hidden if k in known and k != "profile"]}

    def set_layout(self, order: Optional[list] = None, hidden: Optional[list] = None) -> dict:
        with self._locked():
            cur = self.layout()
            if order is not None:
                cur["order"] = [str(k) for k in order]
            if hidden is not None:
                cur["hidden"] = [str(k) for k in hidden]
            self._write("layout.json", cur)
        return self.layout()

    # ------------------------------------------------------------ notes
    # A note is a Markdown file, ``notes/<id>.md``, with a small YAML
    # frontmatter block (title, tags, pinned, author, dates). Obsidian opens
    # the folder as-is. Older panels kept notes in ``notes.json``; they are
    # migrated to files on first use and the JSON is kept as a backup.
    def _notes_dir(self) -> Path:
        return self.dir / "notes"

    def _note_path(self, nid: str) -> Path:
        if not _NOTE_ID.fullmatch(nid or ""):
            raise PanelError("Invalid note id.")
        return self._notes_dir() / f"{nid}.md"

    def _migrate_notes(self) -> None:
        legacy = self.dir / "notes.json"
        if not legacy.is_file():
            return
        items = self._read("notes.json", [])
        folder = self._notes_dir()
        folder.mkdir(parents=True, exist_ok=True)
        for n in items if isinstance(items, list) else []:
            if not isinstance(n, dict) or not _NOTE_ID.fullmatch(str(n.get("id") or "")):
                continue
            path = folder / f"{n['id']}.md"
            if path.exists():
                continue
            text = str(n.get("text") or "")
            meta = {"title": _title_of(text), "tags": _inline_tags(text), "pinned": bool(n.get("pinned")),
                    "author": n.get("author") or "user", "created": n.get("created") or now(),
                    "updated": n.get("updated") or now()}
            if n.get("editedBy"):
                meta["editedBy"] = n["editedBy"]
            _atomic_write(path, _dump_note(meta, text))
        try:
            os.replace(legacy, self.dir / "notes.json.migrated")
        except OSError:
            pass

    def _read_note(self, path: Path, with_body: bool = True) -> Optional[dict]:
        try:
            raw = path.read_text(encoding="utf-8-sig")
        except OSError:
            return None
        meta, body = _parse_note(raw)
        tags = [str(t).lstrip("#") for t in _as_list(meta.get("tags")) if str(t).strip()]
        for t in _inline_tags(body):
            if t not in tags:
                tags.append(t)
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime).replace(microsecond=0).isoformat()
        except OSError:
            mtime = now()
        note = {
            "id": path.stem,
            "title": str(meta.get("title") or "").strip() or _title_of(body) or "Untitled",
            "tags": tags,
            "pinned": bool(meta.get("pinned")),
            "author": str(meta.get("author") or "user"),
            "created": str(meta.get("created") or mtime),
            "updated": str(meta.get("updated") or mtime),
            "words": len(body.split()),
            "links": _wikilinks(body),
            "tasks": [len(_TASK_OPEN.findall(body)), len(_TASK_DONE.findall(body))],
        }
        if meta.get("editedBy"):
            note["editedBy"] = str(meta["editedBy"])
        note["text"] = body if with_body or len(body) <= 600 else body[:600]
        note["partial"] = len(note["text"]) < len(body)
        return note

    def notes(self, with_body: bool = True) -> list[dict]:
        if (self.dir / "notes.json").is_file() and self.home.is_dir():
            with contextlib.suppress(PanelError, PanelBusy, OSError):
                with self._locked():
                    self._migrate_notes()
        folder = self._notes_dir()
        items = []
        if folder.is_dir():
            for path in folder.glob("*.md"):
                if _NOTE_ID.fullmatch(path.stem):
                    n = self._read_note(path, with_body)
                    if n:
                        items.append(n)
        pinned = sorted([n for n in items if n["pinned"]], key=lambda n: n["updated"], reverse=True)
        rest = sorted([n for n in items if not n["pinned"]], key=lambda n: n["updated"], reverse=True)
        return pinned + rest

    def note(self, nid: str) -> dict:
        n = self._read_note(self._note_path(nid))
        if n is None:
            raise PanelError("Note not found.")
        return n

    @staticmethod
    def _clean_text(text: Any) -> str:
        text = str(text or "").replace("\r\n", "\n").strip("\n")
        if len(text) > MAX_NOTE:
            raise PanelError(f"A note is limited to {MAX_NOTE} characters.")
        return text

    @staticmethod
    def _clean_tags(tags: Any) -> list[str]:
        out = []
        for t in _as_list(tags):
            t = re.sub(r"[^\w/-]+", "-", str(t).strip().lstrip("#")).strip("-")[:40]
            if t and t not in out:
                out.append(t)
        return out[:20]

    def add_note(self, text: str, author: str, *, title: Optional[str] = None,
                 tags: Any = None, pinned: bool = False) -> dict:
        text = self._clean_text(text)
        title = " ".join(str(title or "").split())[:120]
        if not text.strip() and not title:
            raise PanelError("A note needs a title or text.")
        with self._locked():
            self._migrate_notes()
            folder = self._notes_dir()
            folder.mkdir(parents=True, exist_ok=True)
            if sum(1 for _ in folder.glob("*.md")) >= MAX_NOTES:
                raise PanelError(f"This panel already holds {MAX_NOTES} notes.")
            nid = secrets.token_hex(4)
            while (folder / f"{nid}.md").exists():
                nid = secrets.token_hex(4)
            meta = {"title": title or _title_of(text) or "Untitled", "tags": self._clean_tags(tags),
                    "pinned": bool(pinned), "author": author, "created": now(), "updated": now()}
            _atomic_write(folder / f"{nid}.md", _dump_note(meta, text))
        return self.note(nid)

    def update_note(self, nid: str, *, text: Optional[str] = None, pinned: Optional[bool] = None,
                    author: Optional[str] = None, title: Optional[str] = None, tags: Any = None) -> dict:
        with self._locked():
            self._migrate_notes()
            path = self._note_path(nid)
            try:
                raw = path.read_text(encoding="utf-8-sig")
            except FileNotFoundError:
                raise PanelError("Note not found.") from None
            meta, body = _parse_note(raw)
            if text is not None:
                body = self._clean_text(text)
                if author:
                    meta["editedBy"] = author
            if title is not None:
                meta["title"] = " ".join(str(title).split())[:120] or _title_of(body) or "Untitled"
            if tags is not None:
                meta["tags"] = self._clean_tags(tags)
            if pinned is not None:
                meta["pinned"] = bool(pinned)
            if not body.strip() and not str(meta.get("title") or "").strip():
                raise PanelError("A note needs a title or text.")
            meta.setdefault("created", now())
            meta["updated"] = now()
            _atomic_write(path, _dump_note(meta, body))
        return self.note(nid)

    def delete_note(self, nid: str) -> bool:
        with self._locked():
            self._migrate_notes()
            path = self._note_path(nid)
            try:
                path.unlink()
                return True
            except FileNotFoundError:
                return False

    # ------------------------------------------------------------ summary
    def summary(self) -> dict:
        return {
            "layout": self.layout(),
            "widgets": self.widgets(with_html=True),
            "notes": self.notes(with_body=False),
        }
