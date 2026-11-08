"""Storage for one bot's panel: layout, custom widgets and notes.

Lives in ``<profile home>/panel/``:
  layout.json            {"order": [...], "hidden": [...]}
  widgets.json           [{"id", "title", "height", "updated", "author"}]
  widgets/<id>.html      the widget body (self-contained HTML)
  notes.json             [{"id", "text", "author", "created", "updated"}]

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
MAX_NOTE = 4_000
MAX_NOTES = 300
MAX_WIDGETS = 24
_SLUG = re.compile(r"[^a-z0-9]+")
_LOCK = threading.Lock()


def now() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def slug(text: str) -> str:
    s = _SLUG.sub("-", text.lower()).strip("-")[:40]
    return s or "widget"


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
        if not self.create_home and not self.home.is_dir():
            raise PanelError("This bot no longer exists. It was deleted or renamed.")
        self.dir.mkdir(parents=True, exist_ok=True)
        with _LOCK:
            fh = open(self.dir / ".lock", "a+b")
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
    def notes(self) -> list[dict]:
        items = [n for n in self._read("notes.json", []) if isinstance(n, dict) and n.get("id")]
        pinned = [n for n in items if n.get("pinned")]
        rest = sorted([n for n in items if not n.get("pinned")], key=lambda n: n.get("updated") or "", reverse=True)
        return sorted(pinned, key=lambda n: n.get("updated") or "", reverse=True) + rest

    def add_note(self, text: str, author: str) -> dict:
        text = str(text or "").strip()
        if not text:
            raise PanelError("A note needs text.")
        if len(text) > MAX_NOTE:
            raise PanelError(f"A note is limited to {MAX_NOTE} characters.")
        with self._locked():
            items = self._read("notes.json", [])
            if len(items) >= MAX_NOTES:
                raise PanelError(f"This panel already holds {MAX_NOTES} notes.")
            note = {"id": secrets.token_hex(4), "text": text, "author": author,
                    "created": now(), "updated": now(), "pinned": False}
            items.append(note)
            self._write("notes.json", items)
            return note

    def update_note(self, nid: str, *, text: Optional[str] = None, pinned: Optional[bool] = None,
                    author: Optional[str] = None) -> dict:
        with self._locked():
            items = self._read("notes.json", [])
            note = next((n for n in items if n.get("id") == nid), None)
            if note is None:
                raise PanelError("Note not found.")
            if text is not None:
                text = str(text).strip()
                if not text:
                    raise PanelError("A note needs text.")
                if len(text) > MAX_NOTE:
                    raise PanelError(f"A note is limited to {MAX_NOTE} characters.")
                note["text"] = text
                if author:
                    note["editedBy"] = author
            if pinned is not None:
                note["pinned"] = bool(pinned)
            note["updated"] = now()
            self._write("notes.json", items)
            return note

    def delete_note(self, nid: str) -> bool:
        with self._locked():
            items = self._read("notes.json", [])
            keep = [n for n in items if n.get("id") != nid]
            if len(keep) == len(items):
                return False
            self._write("notes.json", keep)
            return True

    # ------------------------------------------------------------ summary
    def summary(self) -> dict:
        return {
            "layout": self.layout(),
            "widgets": self.widgets(with_html=True),
            "notes": self.notes(),
        }
