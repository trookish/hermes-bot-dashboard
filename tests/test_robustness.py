"""Run: python tests/test_robustness.py (needs fastapi, pyyaml, httpx).

Robustness checks for the Bot Dashboard REST half against a throwaway Hermes root."""
import os, sys, shutil, tempfile, json
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="bdrobust-"))
root = tmp / "hermes"
brain = tmp / "brain"
(root / "profiles").mkdir(parents=True)
(brain / "TaskNotes" / "Tasks").mkdir(parents=True)
(brain / "02 Projects").mkdir(parents=True)
os.environ["LOCALAPPDATA"] = str(tmp)
os.environ["HERMES_BRAIN"] = str(brain)

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "dashboard"))
sys.path.insert(0, str(REPO))
import plugin_api  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(plugin_api.router)
c = TestClient(app, raise_server_exceptions=False)
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if not cond else ""))


# 1. deleted / unknown / invalid ids answer 200 + missing
r = c.get("/bot", params={"id": "ghost"})
check("unknown bot -> 200 missing", r.status_code == 200 and r.json().get("missing") and r.json()["reason"] == "deleted", r.text)
r = c.get("/bot", params={"id": "Bad Id!"})
check("invalid id -> 200 missing/invalid", r.status_code == 200 and r.json().get("reason") == "invalid", r.text)

# 2. a profile full of broken files still renders
p = root / "profiles" / "broken"
(p / "assets").mkdir(parents=True)
(p / "profile.yaml").write_text("ui_meta:\n  hermes-bots: [not, a, dict]\n", encoding="utf-8")
(p / "config.yaml").write_text("model: just-a-string\nplugins: [x]\nagent: 5\nskills:\n  disabled: abc\nmcp_servers: [1,2]\nplatform_toolsets: nope\nfallback_providers: {a: 1}\n", encoding="utf-8")
(p / "SOUL.md").write_bytes(b"\xff\xfe bad utf8 \x80")
(p / "assets" / "avatar.svg").mkdir()  # a folder where a file is expected
(brain / "02 Projects" / "P.md").write_text("---\nbot: broken\nupdated: 2026-13-45\nstatus: active\n---\n", encoding="utf-8")
(brain / "TaskNotes" / "Tasks" / "T.md").write_text("---\nbot: [broken]\ntitle: x\ndue: 2026-99-99\n---\n", encoding="utf-8")
(brain / "TaskNotes" / "Tasks" / "Bad.md").write_text("---\n: : : [\n---\n", encoding="utf-8")
(p / "panel").mkdir()
(p / "panel" / "layout.json").write_text("{not json", encoding="utf-8")
r = c.get("/bot", params={"id": "broken"})
ok = r.status_code == 200
j = r.json() if ok else {}
check("broken profile -> 200", ok, r.text[:300])
check("broken profile: lists are lists", ok and all(isinstance(j.get(k), list) for k in ("tasks", "projects", "toolsets", "mcp", "plugins", "fallback")), json.dumps(j)[:300])
check("broken profile: bad project date tolerated", ok and j["projects"] and j["projects"][0]["updated"] is None)
check("broken profile: soul decoded", ok and isinstance(j.get("soul"), str))

# 3. stamp: changes on edit, 'missing' after delete
s1 = c.get("/stamp", params={"id": "broken"}).json()["stamp"]
import time; time.sleep(0.05)
(p / "profile.yaml").write_text("ui_meta:\n  hermes-bots:\n    title: Renamed\n", encoding="utf-8")
s2 = c.get("/stamp", params={"id": "broken"}).json()["stamp"]
check("stamp changes on edit", s1 != s2)
time.sleep(0.05)
(brain / "TaskNotes" / "Tasks" / "New.md").write_text("---\nbot: broken\n---\n", encoding="utf-8")
s3 = c.get("/stamp", params={"id": "broken"}).json()["stamp"]
check("stamp changes on new task", s3 != s2)
check("edited name shows", c.get("/bot", params={"id": "broken"}).json()["name"] == "Renamed")

# 4. delete the profile while the pane is open
shutil.rmtree(p)
check("stamp -> missing after delete", c.get("/stamp", params={"id": "broken"}).json()["stamp"] == "missing")
check("bot -> missing after delete", c.get("/bot", params={"id": "broken"}).json().get("missing") is True)
for path, body in [("/panel/note", {"bot": "broken", "text": "hi"}),
                   ("/panel/layout", {"bot": "broken", "order": ["profile"]}),
                   ("/panel/widget", {"bot": "broken", "title": "w", "html": "<p>x</p>"}),
                   ("/task", {"bot": "broken", "title": "t"})]:
    r = c.post(path, json=body)
    check(f"POST {path} on deleted bot -> 4xx", 400 <= r.status_code < 500, f"{r.status_code} {r.text[:120]}")
check("deleted profile was NOT recreated", not p.exists())

# 5. Panel guard directly (agent half races a delete)
from panel_store import Panel, PanelError  # noqa: E402
try:
    Panel(root / "profiles" / "gone").add_note("x", author="t")
    check("Panel refuses deleted home", False)
except PanelError:
    check("Panel refuses deleted home", not (root / "profiles" / "gone").exists())

# 6. groups: unknown / malformed keys never raise, panel writes refuse unknown rooms
for key in ["group:id:nope", "group:name:nobody", "group:", "group:id:../../etc", "x" * 150]:
    r = c.get("/group", params={"id": key})
    check(f"group {key[:20]!r} -> 200 missing", r.status_code == 200 and r.json().get("missing") is True, r.text[:160])
    r = c.get("/group/stamp", params={"id": key})
    check(f"group stamp {key[:20]!r} -> missing", r.status_code == 200 and r.json().get("stamp") == "missing", r.text[:160])
r = c.post("/panel/note", json={"bot": "group:nope", "text": "hi"})
check("note on unknown group -> 404", r.status_code == 404, r.text[:160])
check("unknown group folder not created", not (root / "plugin-data" / "bot-dashboard" / "groups" / "nope").exists())
check("/groups lists nothing on empty install", c.get("/groups").json() == {"groups": []})

print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(0 if all(ok for _, ok in results) else 1)
