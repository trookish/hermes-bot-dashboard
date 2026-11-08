"""Checks for the agent half: both tools register and answer with real data.

Run: python tests/test_tools.py
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PASS, FAIL = [], []


def check(name, fn):
    try:
        fn()
        PASS.append(name)
        print(f"PASS {name}")
    except AssertionError as exc:
        FAIL.append(name)
        print(f"FAIL {name} — {exc}")
    except Exception as exc:  # noqa: BLE001
        FAIL.append(name)
        print(f"FAIL {name} — {type(exc).__name__}: {exc}")


def load():
    spec = importlib.util.spec_from_file_location("bd_agent_half", ROOT / "__init__.py")
    assert spec and spec.loader, "cannot load the plugin's __init__.py"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MOD = load()
TOOLS = []


class Ctx:
    def register_tool(self, **kw):
        TOOLS.append(kw["name"])

    def register_hook(self, *a, **kw):
        TOOLS.append(a[0])


def _call(args):
    out = json.loads(MOD.handle_group(args))
    return out


def test_register():
    MOD.register(Ctx())
    assert "bot_panel" in TOOLS, TOOLS
    assert "group_dashboard" in TOOLS, TOOLS
    assert "pre_llm_call" in TOOLS, TOOLS


def test_schemas_match_runners():
    for schema, fn in ((MOD.SCHEMA, MOD.handle), (MOD.GROUP_SCHEMA, MOD.handle_group)):
        assert callable(fn)
        assert schema["parameters"]["required"] == ["action"]
        assert schema["description"], "a tool with no description is invisible to a model"


def test_unknown_action_answers():
    assert _call({"action": "nope"})["ok"] is False
    assert MOD.handle({"action": "nope"})  # never raises


def test_list_groups():
    out = _call({"action": "list_groups"})
    assert out["ok"] is True, out
    assert isinstance(out["groups"], list)


def test_view_and_write_path():
    groups = _call({"action": "list_groups"})["groups"]
    if not groups:
        print("SKIP view/write — no group chat on this computer")
        return
    gid = groups[0]["id"]
    view = _call({"action": "view", "group": gid, "limit": 3})
    assert view["ok"] is True, view
    assert view["group"]["name"], view
    for key in ("members", "events", "tasks", "projects", "notes", "widgets", "layout"):
        assert key in view, key

    added = _call({"action": "add_note", "group": gid, "text": "tool test"})
    assert added["ok"] is True, added
    nid = added["note"]["id"]
    notes = _call({"action": "list_notes", "group": gid})["notes"]
    assert any(n["id"] == nid for n in notes), notes
    assert _call({"action": "delete_note", "group": gid, "note_id": nid})["ok"] is True
    after = _call({"action": "list_notes", "group": gid})["notes"]
    assert not any(n["id"] == nid for n in after), after
    assert all(n.get("text") != "tool test" for n in after), "test note survived the delete"


def test_missing_group_is_a_message():
    out = _call({"action": "view", "group": "no-such-group"})
    assert out["ok"] is False
    assert "No such group" in out["error"], out["error"]
    assert "404" not in out["error"], "an HTTP code leaked into the tool answer"


def test_widget_roundtrip():
    groups = _call({"action": "list_groups"})["groups"]
    if not groups:
        print("SKIP widget — no group chat on this computer")
        return
    gid = groups[0]["id"]
    made = _call({"action": "add_widget", "group": gid, "title": "Tool test",
                  "html": "<b>hello</b>", "height": 120})
    assert made["ok"] is True, made
    wid = made["widget"]["id"]
    assert any(w["id"] == wid for w in _call({"action": "view", "group": gid})["widgets"])
    assert _call({"action": "remove_widget", "group": gid, "widget_id": wid})["ok"] is True
    left = [w["id"] for w in _call({"action": "view", "group": gid})["widgets"]]
    assert wid not in left, left


check("both tools and the hook register", test_register)
check("schemas describe themselves", test_schemas_match_runners)
check("unknown action answers instead of raising", test_unknown_action_answers)
check("list_groups answers", test_list_groups)
check("view returns the whole group picture", test_view_and_write_path)
check("missing group is a plain message", test_missing_group_is_a_message)
check("widget add/remove roundtrip", test_widget_roundtrip)

print(f"\n{len(PASS)}/{len(PASS) + len(FAIL)} passed")
sys.exit(1 if FAIL else 0)
