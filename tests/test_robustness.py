"""Run: python tests/test_robustness.py (needs fastapi, pyyaml, httpx).

Robustness checks for the Bot Dashboard REST half against a throwaway Hermes root."""
import os, sys, shutil, tempfile, json
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="bdrobust-"))
root = tmp / "hermes"
brain = tmp / "brain"
(root / "profiles").mkdir(parents=True)
(brain / "TaskNotes" / "Tasks").mkdir(parents=True)
(brain / "Projects").mkdir(parents=True)
# Paths come from hermes_constants only: no LOCALAPPDATA, no home-folder guess.
os.environ.pop("LOCALAPPDATA", None)
os.environ["HERMES_HOME"] = str(root)
os.environ["BOT_DASHBOARD_VAULT_PATH"] = str(brain)

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
(brain / "Projects" / "P.md").write_text("---\nbot: broken\nupdated: 2026-13-45\nstatus: active\n---\n", encoding="utf-8")
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

# 7. a real room database (path with % and # to test URI escaping)
import sqlite3 as _sq
odd = tmp / "odd%41#dir" / "hermes"
(odd / "profiles" / "alpha").mkdir(parents=True)
(odd / "profiles" / "alpha" / "profile.yaml").write_text("ui_meta:\n  hermes-bots:\n    title: Alpha\n    color: '#22c55e'\n", encoding="utf-8")
db = _sq.connect(odd / "state.db")
db.executescript("""
CREATE TABLE hosted_rooms(room_id TEXT PRIMARY KEY, name TEXT, members_json TEXT, revision INT, created_at REAL, updated_at REAL, disbanded_at REAL);
CREATE TABLE hosted_room_events(room_id TEXT, seq INT, kind TEXT, actor_json TEXT, created_at REAL);
CREATE TABLE hosted_room_driver_leases(room_id TEXT, expires_at REAL, released_at REAL);
CREATE TABLE hosted_room_driver_tasks(room_id TEXT, terminal_at REAL);
""")
now = time.time()
members = json.dumps([{"profile": "alpha", "handle": "alpha", "display_name": "A"},
                      {"target": {"kind": "local", "profile": "deadbot"}, "handle": "deadbot"}])
for rid in ("room.1", "room_1", "room:1"):
    db.execute("INSERT INTO hosted_rooms VALUES(?,?,?,?,?,?,NULL)", (rid, "Team " + rid, members, 1, now - 100, now))
db.execute("INSERT INTO hosted_room_events VALUES('room.1',1,'message.posted','{\"display_name\":\"User\"}',?)", (now,))
db.execute("INSERT INTO hosted_room_driver_leases VALUES('room.1',?,NULL)", (now + 60,))
db.execute("INSERT INTO hosted_room_driver_tasks VALUES('room.1',NULL)")
db.commit(); db.close()
os.environ["HERMES_HOME"] = str(odd)
g = c.get("/groups").json()["groups"]
check("rooms read through an escaped URI", len(g) == 3, g)
s = c.get("/group", params={"id": "group:id:room.1"}).json()
check("group: members resolved", [m["missing"] for m in s.get("members", [])] == [False, True], s.get("members"))
check("group: target.profile member is the deleted bot", s["members"][1]["id"] == "deadbot")
check("group: live lease and running task", s.get("live") is True and s.get("running") == 1, s)
check("group: event listed", s.get("eventCount") == 1 and s["events"][0]["actor"] == "User", s.get("events"))
r = c.post("/panel/note", json={"bot": "group:id:room.1", "text": "only room.1"})
check("note on a real group -> 200", r.status_code == 200, r.text[:160])
others = [c.get("/group", params={"id": f"group:id:{x}"}).json()["panel"]["notes"] for x in ("room_1", "room:1")]
check("similar room ids keep separate panels", others == [[], []], others)
s1 = c.get("/group/stamp", params={"id": "group:id:room.1"}).json()["stamp"]
time.sleep(0.05)
(odd / "profiles" / "alpha" / "profile.yaml").write_text("ui_meta:\n  hermes-bots:\n    title: Alpha 2\n", encoding="utf-8")
check("group stamp changes when a member is edited", c.get("/group/stamp", params={"id": "group:id:room.1"}).json()["stamp"] != s1)

# 8. tasks are written by the plugin itself, into the configured folder only
os.environ["HERMES_HOME"] = str(root)
(root / "profiles" / "worker").mkdir()
r = c.post("/task", json={"bot": "worker", "title": 'Ship: the "v2" build/notes?'})
check("POST /task with a vault -> 200", r.status_code == 200, r.text[:160])
made = brain / "TaskNotes" / "Tasks" / r.json().get("file", "none")
import yaml as _y
front = _y.safe_load(made.read_text(encoding="utf-8").split("---")[1]) if made.is_file() else {}
check("task note: owner, status, tag", front.get("bot") == "worker" and front.get("status") == "open" and front.get("tags") == ["task"], front)
check("task shows in the bot's tasks", any(x.get("title") == 'Ship: the "v2" build/notes?' for x in c.get("/bot", params={"id": "worker"}).json().get("tasks", [])))
r2 = c.post("/task", json={"bot": "worker", "title": 'Ship: the "v2" build/notes?'})
check("same title twice -> two files", r2.status_code == 200 and r2.json()["file"] != r.json()["file"], r2.text[:160])
os.environ["BOT_DASHBOARD_OWNER_FIELD"] = "assignee"
(brain / "TaskNotes" / "Tasks" / "Mine.md").write_text("---\nassignee: worker\ntitle: custom owner\nstatus: open\n---\n", encoding="utf-8")
check("owner_field setting is honoured", [x["title"] for x in c.get("/bot", params={"id": "worker"}).json()["tasks"]] == ["custom owner"])
os.environ.pop("BOT_DASHBOARD_OWNER_FIELD")
os.environ["BOT_DASHBOARD_VAULT_PATH"] = ""
j = c.get("/bot", params={"id": "worker"}).json()
check("no vault set: says so, empty cards", j.get("vault", {}).get("set") is False and j["tasks"] == [] and j["projects"] == [], j.get("vault"))
r = c.post("/task", json={"bot": "worker", "title": "t"})
check("no vault set: /task -> 409 with a reason", r.status_code == 409 and "vault_path" in r.text, r.text[:160])
os.environ["BOT_DASHBOARD_VAULT_PATH"] = str(tmp / "nowhere")
check("vault missing on disk: found False", c.get("/bot", params={"id": "worker"}).json()["vault"] == {**j["vault"], "set": True, "found": False})
check("missing vault folder not created", c.post("/task", json={"bot": "worker", "title": "t"}).status_code == 409 and not (tmp / "nowhere").exists())
os.environ["BOT_DASHBOARD_VAULT_PATH"] = str(brain)
# a settings value in config.yaml is read too
(root / "config.yaml").write_text("plugins:\n  entries:\n    bot-dashboard:\n      settings:\n        projects_folder: Work\n", encoding="utf-8")
import bd_settings as _bs  # noqa: E402
check("config.yaml plugin settings are read", _bs.setting("projects_folder") == "Work" and _bs.projects_dir() == brain / "Work")
(root / "config.yaml").unlink()
os.environ["HERMES_HOME"] = str(odd)

# 9. a profile deleted between the existence check and the write is not recreated
import panel_store as _ps
home = odd / "profiles" / "racer"
home.mkdir()
pn = Panel(home)
real = Path.is_dir
def flaky(self):
    ok = real(self)
    if self == home and ok:
        shutil.rmtree(home)
    return ok
Path.is_dir = flaky
try:
    pn.add_note("x", author="t")
    raced = "no error"
except PanelError:
    raced = "PanelError"
finally:
    Path.is_dir = real
check("delete mid-write -> PanelError, no folder", raced == "PanelError" and not home.exists(), raced)

# 10. current room schema: what each member is doing, and the activity window
full = tmp / "full" / "hermes"
(full / "profiles" / "alpha").mkdir(parents=True)
(full / "profiles" / "beta").mkdir(parents=True)
db = _sq.connect(full / "state.db")
db.executescript("""
CREATE TABLE hosted_rooms(room_id TEXT PRIMARY KEY, name TEXT, members_json TEXT, revision INT, created_at REAL, updated_at REAL, disbanded_at REAL);
CREATE TABLE hosted_room_events(room_id TEXT, seq INT, event_id TEXT, kind TEXT, actor_json TEXT, payload_json TEXT, created_at REAL);
CREATE TABLE hosted_room_driver_leases(room_id TEXT, expires_at REAL, released_at REAL);
CREATE TABLE hosted_room_driver_tasks(room_id TEXT, task_id TEXT, thread_id TEXT, status TEXT, payload_json TEXT, result_json TEXT,
  created_at REAL, updated_at REAL, started_at REAL, terminal_at REAL);
""")
mem = json.dumps([{"member_id": "m-a", "profile": "alpha", "handle": "alpha", "display_name": "Alpha"},
                  {"member_id": "m-b", "profile": "beta", "handle": "beta", "display_name": "Beta"}])
db.execute("INSERT INTO hosted_rooms VALUES('r2','Crew',?,1,?,?,NULL)", (mem, now - 50, now))
for i in range(1, 76):
    db.execute("INSERT INTO hosted_room_events VALUES('r2',?,?,?,?,?,?)",
               (i, f"e{i}", "message.member" if i % 2 else "message.user",
                json.dumps({"kind": "member", "id": "m-a"} if i % 2 else {"kind": "user"}),
                json.dumps({"text": f"line {i}", "member_id": "m-a"} if i % 2 else {"text": f"ask {i}"}), now - 75 + i))
db.execute("INSERT INTO hosted_room_driver_tasks VALUES('r2','t1','th','running',?,NULL,?,?,?,NULL)",
           (json.dumps({"target_member_id": "m-a", "target_profile": "alpha", "prompt": "Room\nUser (user): fix the build"}), now, now, now))
db.execute("INSERT INTO hosted_room_driver_tasks VALUES('r2','t0','th','succeeded',?,?,?,?,?,?)",
           (json.dumps({"target_member_id": "m-b", "target_profile": "beta", "prompt": "x"}), json.dumps({"text": "All green."}),
            now - 9, now - 8, now - 9, now - 8))
db.commit(); db.close()
os.environ["HERMES_HOME"] = str(full)
s = c.get("/group", params={"id": "Crew"}).json()
check("group resolved by plain name", s.get("roomId") == "r2", str(s)[:200])
ms = {m["id"]: m for m in s.get("members", [])}
check("running member says what it is doing", ms.get("alpha", {}).get("state") == "running" and "fix the build" in ms["alpha"].get("doing", ""), ms.get("alpha"))
check("idle member shows its last result", ms.get("beta", {}).get("state") == "idle" and ms["beta"].get("lastText") == "All green.", ms.get("beta"))
check("events carry who and what", s["events"][0]["text"] and s["events"][0]["actor"] in ("You", "Alpha"), s["events"][:2])
a = c.get("/group/activity", params={"id": "group:id:r2", "limit": 50}).json()
check("activity window pages", len(a["events"]) == 50 and a["more"] and a["count"] == 75, {k: a[k] for k in ("count", "more")})
b = c.get("/group/activity", params={"id": "group:id:r2", "limit": 50, "before": a["events"][-1]["seq"]}).json()
check("activity second page", len(b["events"]) == 25 and not b["more"], len(b["events"]))
check("activity on unknown group -> 404", c.get("/group/activity", params={"id": "nope"}).status_code == 404)

# 11. task edit/delete, project CRUD, markdown notes
os.environ["HERMES_HOME"] = str(root)
r = c.post("/task", json={"bot": "worker", "title": "Edit me", "priority": "high", "tags": ["ui", "#x"], "due": "2026-12-01"})
f = r.json().get("file")
check("task create with priority/tags", r.status_code == 200 and any(x["title"] == "Edit me" and x["priority"] == "high" and x["tags"] == ["ui", "x"]
      for x in c.get("/bot", params={"id": "worker"}).json()["tasks"]), r.text[:160])
r = c.post("/task/update", json={"file": f, "title": "Edited", "due": "", "tags": ["done-ui"]})
fm = _y.safe_load((brain / "TaskNotes" / "Tasks" / f).read_text(encoding="utf-8").split("---")[1])
check("task update rewrites only named keys", r.status_code == 200 and fm["title"] == "Edited" and fm["due"] is None and fm["tags"] == ["task", "done-ui"] and fm["bot"] == "worker", fm)
r = c.post("/task/status", json={"file": f, "status": "done"})
check("task done sets completedDate", "completedDate" in (brain / "TaskNotes" / "Tasks" / f).read_text(encoding="utf-8"))
check("task status path escape -> 404", c.post("/task/status", json={"file": "../x.md", "status": "done"}).status_code == 404)
r = c.post("/task/delete", json={"file": f})
check("task delete moves to .trash", r.status_code == 200 and not (brain / "TaskNotes" / "Tasks" / f).exists() and (brain / ".trash" / f).exists(), r.text[:160])
r = c.post("/project", json={"bot": "worker", "name": "Site/Redo", "path": "C:/code/site", "description": "New site", "tags": ["web"]})
pf = r.json().get("file")
check("project create", r.status_code == 200 and pf == "Site Redo.md", r.text[:160])
check("project duplicate -> 409", c.post("/project", json={"bot": "worker", "name": "Site Redo"}).status_code == 409)
pj = [x for x in c.get("/bot", params={"id": "worker"}).json()["projects"] if x["name"] == "Site Redo"]
check("project listed with path and description", pj and pj[0]["path"] == "C:/code/site" and pj[0]["description"] == "New site", pj)
r = c.post("/project/update", json={"file": pf, "name": "Site v3", "status": "paused", "next": "Ship it"})
check("project rename + status", r.status_code == 200 and (brain / "Projects" / "Site v3.md").is_file() and not (brain / "Projects" / pf).exists(), r.text[:160])
check("project bad status -> 400", c.post("/project/update", json={"file": "Site v3.md", "status": "zzz"}).status_code == 400)
check("project delete", c.post("/project/delete", json={"file": "Site v3.md"}).status_code == 200 and not (brain / "Projects" / "Site v3.md").exists())
check("projects list all", isinstance(c.get("/projects", params={"all": True}).json()["projects"], list))
legacy = root / "profiles" / "worker" / "panel"
legacy.mkdir(parents=True, exist_ok=True)
(legacy / "notes.json").write_text(json.dumps([{"id": "abcd1234", "text": "# Old\nbody #legacy", "author": "bot", "pinned": True}]), encoding="utf-8")
n = c.get("/panel/notes", params={"bot": "worker"}).json()["notes"]
check("legacy notes.json migrated to markdown", n and n[0]["title"] == "Old" and "legacy" in n[0]["tags"] and (legacy / "notes" / "abcd1234.md").is_file(), n)
r = c.post("/panel/note", json={"bot": "worker", "title": "Plan", "text": "- [ ] a\n- [x] b\n[[Old]]", "tags": ["plan"]})
nid = r.json()["note"]["id"]
check("markdown note: title, tasks, links", r.json()["note"]["tasks"] == [1, 1] and r.json()["note"]["links"] == ["Old"], r.json())
r = c.post("/panel/note/update", json={"bot": "worker", "id": nid, "text": "x" * 5000})
check("long markdown note accepted", r.status_code == 200 and len(c.get("/panel/note", params={"bot": "worker", "id": nid}).json()["note"]["text"]) == 5000)
sm = c.get("/bot", params={"id": "worker"}).json()["panel"]["notes"]
check("summary notes are trimmed", all(len(x["text"]) <= 600 for x in sm) and any(x["partial"] for x in sm))
check("bad note id -> 400", c.get("/panel/note", params={"bot": "worker", "id": "../x"}).status_code == 400)
os.environ["HERMES_HOME"] = str(odd)

print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(0 if all(ok for _, ok in results) else 1)
