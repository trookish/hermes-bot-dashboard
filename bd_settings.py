"""Where Bot Dashboard looks: the Hermes home, the Hermes root, and the user's settings.

Every path comes from ``hermes_constants`` so the plugin follows the active profile on
Windows, macOS and Linux alike. The notes vault is optional and has no default: until the
user sets ``vault_path`` (Settings > Plugins > Bot Dashboard, or ``hermes config``), the
Tasks and Projects cards say so instead of guessing a folder.

Settings live in ``config.yaml`` under ``plugins.entries.bot-dashboard.settings``. The
active profile's value wins; the root profile's value is the fallback, so one setting
covers every bot.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import yaml

PLUGIN_ID = "bot-dashboard"

DEFAULTS: dict[str, str] = {
    "vault_path": "",
    "tasks_folder": "TaskNotes/Tasks",
    "projects_folder": "Projects",
    "owner_field": "bot",
    "panel_rule": "",
}

# Environment overrides for headless use and tests (BOT_DASHBOARD_VAULT_PATH, ...).
_ENV_PREFIX = "BOT_DASHBOARD_"

_cache: dict[str, tuple[int, dict]] = {}


def hermes_home() -> Path:
    """The active profile's home."""
    from hermes_constants import get_hermes_home

    return Path(get_hermes_home())


def hermes_root() -> Path:
    """The root that holds ``profiles/`` and the shared state."""
    from hermes_constants import get_default_hermes_root

    return Path(get_default_hermes_root())


def bot_id() -> str:
    """This process's bot: the profile name, or ``hermes`` for the root profile."""
    try:
        from hermes_constants import profile_name_for_home

        name = profile_name_for_home(hermes_home())
        # The root profile is the desktop's "hermes" bot.
        return "hermes" if not name or name == "default" else name
    except Exception:  # noqa: BLE001
        return "hermes"


def _settings_in(config_path: Path) -> dict:
    try:
        mtime = config_path.stat().st_mtime_ns
    except OSError:
        return {}
    key = str(config_path)
    hit = _cache.get(key)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        data = yaml.safe_load(config_path.read_text(encoding="utf-8", errors="replace")) or {}
    except (OSError, yaml.YAMLError, ValueError):
        data = {}
    plugins = data.get("plugins") if isinstance(data, dict) else None
    entries = plugins.get("entries") if isinstance(plugins, dict) else None
    entry = entries.get(PLUGIN_ID) if isinstance(entries, dict) else None
    settings = entry.get("settings") if isinstance(entry, dict) else None
    out = settings if isinstance(settings, dict) else {}
    _cache[key] = (mtime, out)
    return out


def setting(key: str) -> str:
    env = os.environ.get(_ENV_PREFIX + key.upper())
    if env is not None and env.strip():
        return env.strip()
    homes = []
    for getter in (hermes_home, hermes_root):
        try:
            homes.append(getter())
        except Exception:  # noqa: BLE001
            continue
    for home in dict.fromkeys(homes):
        value = _settings_in(home / "config.yaml").get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return DEFAULTS.get(key, "")


def vault() -> Optional[Path]:
    raw = setting("vault_path")
    return Path(raw).expanduser() if raw else None


def _folder(key: str) -> Optional[Path]:
    root = vault()
    if root is None:
        return None
    sub = setting(key).replace("\\", "/").strip("/")
    return root / sub if sub else root


def tasks_dir() -> Optional[Path]:
    return _folder("tasks_folder")


def projects_dir() -> Optional[Path]:
    return _folder("projects_folder")


def owner_field() -> str:
    return setting("owner_field") or "bot"


def vault_state() -> dict[str, Any]:
    """What the panes show about the vault: set or not, found or not."""
    root = vault()
    return {
        "set": root is not None,
        "found": bool(root and root.is_dir()),
        "tasks": setting("tasks_folder"),
        "projects": setting("projects_folder"),
        "owner": owner_field(),
    }
