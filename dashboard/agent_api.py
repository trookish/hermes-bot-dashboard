"""Agents' bridge to the Bot Dashboard REST layer, without HTTP.

The desktop panes talk to ``dashboard/plugin_api.py`` over HTTP. The agent-side
``bot_panel`` tool needs the same tasks/projects/settings operations; importing
the router module in-process and calling its functions keeps one source of truth
for validation, trash behaviour and frontmatter handling.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def api():
    """Import the REST module on first use (never at plugin load)."""
    import dashboard.plugin_api as a
    return a


def tasks(bot: str) -> list[dict]:
    return api()._safe(lambda: api()._tasks(bot), [])


def task_add(bot: str, title: str, due: str | None, priority: str, tags: list, project: str) -> dict:
    a = api()
    return a.add_task(a.NewTask(bot=bot, title=title, due=due, priority=priority,
                                tags=tags, project=project))


def task_update(file: str, **fields) -> dict:
    a = api()
    return a.update_task(a.TaskEdit(file=file, **fields))


def task_status(file: str, status: str) -> dict:
    a = api()
    return a.set_task_status(a.TaskStatus(file=file, status=status))


def task_delete(file: str) -> dict:
    a = api()
    return a.delete_task(a.NoteFile(file=file))


def projects(bot: str, all_bots: bool = False) -> list[dict]:
    a = api()
    return a._safe(lambda: a._projects(None if all_bots else bot), [])


def project_add(bot: str, **fields) -> dict:
    a = api()
    return a.add_project(a.ProjectBody(bot=bot, **fields))


def project_update(file: str, **fields) -> dict:
    a = api()
    return a.update_project(a.ProjectBody(file=file, **fields))


def project_delete(file: str) -> dict:
    a = api()
    return a.delete_project(a.NoteFile(file=file))


def settings_get() -> dict:
    return api().settings_get()


def settings_save(values: dict) -> dict:
    a = api()
    return a.settings_save(a.SettingsBody(settings=values))


def session_todos(bot: str, session: str = "", past: int = 8) -> dict:
    a = api()
    return a._safe(lambda: a._session_todos(a._norm_bot(bot), session.strip(), past),
                   {"current": None, "past": []})
