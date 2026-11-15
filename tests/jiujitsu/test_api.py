"""API tests for the Chacrinha Jiu-Jitsu API (worker/index.js).

Run against a local `wrangler dev` server:
    python -I -W ignore tests/jiujitsu/test_api.py
Env overrides: JJ_BASE (default http://127.0.0.1:8788/jiujitsu/api; "localhost" costs ~2 s per
               request on Windows because Python tries IPv6 first),
               JJ_ADMIN_PW (default test-admin-pw),
               JJ_NODE / JJ_WRANGLER / JJ_PERSIST: node.exe, wrangler.js and the --persist-to folder
               of the running `wrangler dev`. With all three set, the legacy-profile (claim) tests
               insert passwordless players with `wrangler d1 execute --local`; otherwise they skip.

The DB may be shared with other clients, so every player created here uses a random prefix
and is deleted (as admin) in tearDownModule. Nothing else is deleted. Wrong-password tests
only target throwaway players (plus at most one wrong attempt on Paloma, followed by a good login).
"""
import datetime
import io
import json
import os
import random
import string
import subprocess
import threading
import unittest
import urllib.error
import urllib.request
from collections import namedtuple
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("JJ_BASE", "http://127.0.0.1:8788/jiujitsu/api").rstrip("/")
ADMIN_PW = os.environ.get("JJ_ADMIN_PW", "test-admin-pw")
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NODE = os.environ.get("JJ_NODE", "")
WRANGLER = os.environ.get("JJ_WRANGLER", "")
PERSIST = os.environ.get("JJ_PERSIST", "")

PREFIX = "t_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6)) + "_"
PW = "pw-" + "".join(random.choices(string.ascii_letters, k=8))
CREATED = []  # player ids created by this run
_counter = [0]
_lock = threading.Lock()
_admin = {}

Resp = namedtuple("Resp", "status data text ctype headers body")


def call(method, path, body=None, token=None, raw=None, headers=None, ctype="application/json"):
    if raw is not None:
        data = raw if isinstance(raw, bytes) else raw.encode()
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    h = {"content-type": ctype}
    if token:
        h["authorization"] = "Bearer " + token
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, b, hd = r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        status, b, hd = e.code, e.read(), e.headers
    text = b.decode("utf-8", "replace")
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = None
    return Resp(status, parsed, text, hd.get("content-type", ""), hd, b)


def uname(tag=""):
    with _lock:
        _counter[0] += 1
        n = _counter[0]
    return f"{PREFIX}{tag}{n}"[:24]


def utc_today():
    return datetime.datetime.now(datetime.timezone.utc).date()


def today():
    return utc_today().isoformat()


def state(token=None):
    r = call("GET", "/state", token=token)
    assert r.status == 200, r.text
    return r.data


def paloma():
    for p in state()["players"]:
        if p["name"].lower() == "paloma":
            return p
    raise AssertionError("admin profile Paloma missing")


def admin_token():
    if "t" not in _admin:
        r = call("POST", "/login", {"id": paloma()["id"], "password": ADMIN_PW})
        assert r.status == 200, r.text
        _admin["t"] = r.data["token"]
    return _admin["t"]


def roll_by_id(rid):
    return next((r for r in state()["rolls"] if r["id"] == rid), None)


def player_by_id(pid):
    return next((p for p in state()["players"] if p["id"] == pid), None)


def create_player(tag="", password=None, **kw):
    """Returns (player, token)."""
    body = {"name": uname(tag), "belt": "white", "password": password or PW}
    body.update(kw)
    r = call("POST", "/players", body)
    if r.status != 201:
        raise AssertionError(f"create player failed: {r.status} {r.text}")
    with _lock:
        CREATED.append(r.data["player"]["id"])
    return r.data["player"], r.data["token"]


def login(pid, password=PW):
    return call("POST", "/login", {"id": pid, "password": password})


def track(r):
    """Record a player created by a raw POST /players call."""
    if r.status == 201 and r.data and "player" in r.data:
        with _lock:
            CREATED.append(r.data["player"]["id"])
    return r


def tiny_image(fmt, size=(8, 8), color=(200, 30, 30)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, fmt)
    return buf.getvalue()


def insert_legacy(names):
    """Insert passwordless players straight into the local D1. Returns {name: id} or None."""
    if not (NODE and WRANGLER and PERSIST):
        return None
    values = ", ".join(f"('{n}')" for n in names)  # names are generated here, no quotes in them
    cmd = [NODE, WRANGLER, "d1", "execute", "JJ_DB", "--local", "--persist-to", PERSIST,
           "--command", f"INSERT INTO players (name) VALUES {values}"]
    try:
        subprocess.run(cmd, cwd=REPO, check=True, capture_output=True, timeout=120)
    except Exception:
        return None
    ids = {p["name"]: p["id"] for p in state()["players"] if p["name"] in names}
    with _lock:
        CREATED.extend(ids.values())
    return ids if len(ids) == len(names) else None


class Base(unittest.TestCase):
    def mk(self, tag="", **kw):
        return create_player(tag, **kw)

    def mkroll(self, a, b, winner=None, token=None, **kw):
        body = {"a": a, "b": b, "winner": winner, "date": today()}
        body.update(kw)
        r = call("POST", "/rolls", body, token or admin_token())
        self.assertEqual(r.status, 201, r.text)
        return r.data["roll"]

    def err(self, resp, status):
        self.assertEqual(resp.status, status, resp.text)
        self.assertIn("application/json", resp.ctype)
        self.assertIsInstance(resp.data, dict, resp.text)
        self.assertIsInstance(resp.data.get("error"), str, resp.text)
        self.assertTrue(resp.data["error"])
        return resp.data["error"]

    def bad(self, resp):
        return self.err(resp, 400)

    def ok(self, resp, status=200):
        self.assertEqual(resp.status, status, resp.text)
        return resp.data

    def no500(self, resp):
        self.assertLess(resp.status, 500, resp.text)
        if resp.status >= 400:
            self.assertIsInstance(resp.data, dict, resp.text)
            self.assertIn("error", resp.data, resp.text)

    def me(self, token):
        return state(token)["me"]


PLAYER_KEYS = {"id", "name", "belt", "stripes", "bio", "photo_v", "has_pw", "created_at"}
ROLL_KEYS = {"id", "a", "b", "winner", "method", "note", "date", "by", "status", "created_at"}


# ---------------------------------------------------------------- state
class StateTests(Base):
    def test_shape(self):
        r = call("GET", "/state")
        self.assertEqual(r.status, 200)
        self.assertIn("application/json", r.ctype)
        self.assertEqual(r.headers.get("cache-control"), "no-store")
        d = r.data
        self.assertEqual(set(d), {"players", "rolls", "admin", "adminConfigured", "me"})
        self.assertEqual(d["admin"], "Paloma")
        self.assertIs(d["adminConfigured"], True)
        self.assertIsNone(d["me"])
        for p in d["players"]:
            self.assertEqual(set(p), PLAYER_KEYS)
            self.assertIn(p["has_pw"], (True, False))
            self.assertNotIn("pw_hash", p)
        for x in d["rolls"]:
            self.assertEqual(set(x), ROLL_KEYS)
            self.assertIn(x["status"], ("pending", "confirmed"))

    def test_no_secrets_in_state(self):
        p, _ = self.mk()
        t = call("GET", "/state").text
        self.assertNotIn("pbkdf2", t)
        self.assertNotIn("lock_until", t)
        self.assertNotIn("fails", t)

    def test_paloma_seeded(self):
        p = paloma()
        self.assertEqual(p["name"], "Paloma")
        self.assertIs(p["has_pw"], True)  # admin password configured

    def test_me(self):
        p, tok = self.mk()
        self.assertEqual(self.me(tok), {"id": p["id"], "admin": False})
        self.assertEqual(self.me(admin_token()), {"id": paloma()["id"], "admin": True})
        for bad in ["x" * 43, "", "Bearer", tok[:-1] + ("A" if tok[-1] != "A" else "B")]:
            self.assertIsNone(self.me(bad))
        # malformed headers are ignored, never an error
        for h in ["bearer " + tok, "Bearer  " + tok, "Basic " + tok, "Bearer " + tok + "!", "Bearer " + "a" * 200]:
            r = call("GET", "/state", headers={"authorization": h})
            self.assertEqual(r.status, 200)
            self.assertIsNone(r.data["me"], h[:20])

    def test_trailing_slash_ok(self):
        self.assertEqual(call("GET", "/state/").status, 200)

    def test_rolls_sorted_newest_first(self):
        (a, _), (b, _) = self.mk(), self.mk()
        old = self.mkroll(a["id"], b["id"], date="2024-01-01")
        new = self.mkroll(a["id"], b["id"], date=today())
        ids = [x["id"] for x in state()["rolls"]]
        self.assertLess(ids.index(new["id"]), ids.index(old["id"]))


# ---------------------------------------------------------------- login / logout / sessions
class LoginTests(Base):
    def test_login_ok(self):
        p, _ = self.mk()
        d = self.ok(login(p["id"]))
        self.assertEqual(set(d), {"token", "player", "admin", "claimed"})
        self.assertEqual((d["admin"], d["claimed"]), (False, False))
        self.assertEqual(d["player"]["id"], p["id"])
        self.assertRegex(d["token"], r"^[A-Za-z0-9_-]{40,}$")
        self.assertEqual(self.me(d["token"]), {"id": p["id"], "admin": False})
        d2 = self.ok(login(str(p["id"])))  # string id accepted
        self.assertNotEqual(d["token"], d2["token"])

    def test_login_errors(self):
        p, _ = self.mk()
        self.err(login(p["id"], "wrong-pw"), 401)
        self.err(call("POST", "/login", {"id": p["id"]}), 401)
        self.err(call("POST", "/login", {"id": p["id"], "password": 12345}), 401)
        self.err(login(999999999), 404)
        for bad in [None, 0, -1, "abc", 1.5, True, [1]]:
            self.bad(call("POST", "/login", {"id": bad, "password": PW}))
        for raw in ["", "null", "[]", "x", "{bad"]:
            self.bad(call("POST", "/login", raw=raw))
        self.ok(login(p["id"]))  # resets the fail counter

    def test_paloma_login(self):
        pid = paloma()["id"]
        self.err(login(pid, "nope-" + ADMIN_PW), 401)
        d = self.ok(login(pid, ADMIN_PW))  # also resets the fail counter
        self.assertIs(d["admin"], True)
        self.assertEqual(self.me(d["token"]), {"id": pid, "admin": True})
        call("POST", "/logout", token=d["token"])

    def test_old_admin_mechanisms_gone(self):
        self.err(call("POST", "/admin/login", {"password": ADMIN_PW}), 404)
        p, _ = self.mk()
        r = call("PATCH", f"/players/{p['id']}", {"name": uname("x")}, headers={"X-Admin-Password": ADMIN_PW})
        self.err(r, 401)
        self.err(call("DELETE", f"/players/{p['id']}", headers={"X-Admin-Password": ADMIN_PW}), 401)

    def test_logout(self):
        p, t1 = self.mk()
        t2 = self.ok(login(p["id"]))["token"]
        self.assertEqual(self.ok(call("POST", "/logout", token=t1)), {"ok": True})
        self.assertIsNone(self.me(t1))
        self.assertEqual(self.me(t2)["id"], p["id"])  # other sessions survive
        self.err(call("PATCH", f"/players/{p['id']}", {"belt": "blue"}, t1), 401)
        self.ok(call("POST", "/logout", token=t1))  # idempotent
        self.ok(call("POST", "/logout"))  # anonymous is fine too
        self.err(call("GET", "/logout"), 404)

    def test_token_of_other_player_cannot_act_as_them(self):
        (a, ta), (b, tb) = self.mk(), self.mk()
        self.err(call("PATCH", f"/players/{b['id']}", {"belt": "blue"}, ta), 403)
        self.assertEqual(player_by_id(b["id"])["belt"], "white")


# ---------------------------------------------------------------- lockout
class LockoutTests(Base):
    def test_lock_after_10_wrong(self):
        p, _ = self.mk("L")
        for i in range(10):
            self.err(login(p["id"], f"wrong{i}"), 401)
        msg = self.err(login(p["id"]), 429)  # even the right password is refused now
        self.assertIn("minute", msg)
        self.err(login(p["id"], "wrong"), 429)
        # admin touching the profile (e.g. a password reset) unlocks it
        self.ok(call("PATCH", f"/players/{p['id']}", {"password": PW}, admin_token()))
        self.ok(login(p["id"]))

    def test_success_resets_counter(self):
        p, _ = self.mk("L")
        for i in range(9):
            self.err(login(p["id"], f"wrong{i}"), 401)
        self.ok(login(p["id"]))
        for i in range(9):
            self.err(login(p["id"], f"wrong{i}"), 401)
        self.ok(login(p["id"]))

    def test_lockout_is_per_player(self):
        (p, _), (q, _) = self.mk("L"), self.mk("L")
        for i in range(10):
            login(p["id"], "x" * 6)
        self.err(login(p["id"]), 429)
        self.ok(login(q["id"]))
        self.ok(call("PATCH", f"/players/{p['id']}", {"belt": "white"}, admin_token()))  # unlock

    def test_parallel_wrong_passwords_still_lock(self):
        # Bug probe: the fail counter is read-modify-write (fails = p.fails + 1), so parallel
        # guesses all read the same value and the lock never triggers.
        p, _ = self.mk("L")
        with ThreadPoolExecutor(20) as ex:
            res = list(ex.map(lambda i: login(p["id"], f"guess{i}").status, range(40)))
        self.assertTrue(set(res) <= {401, 429}, res)
        self.assertEqual(login(p["id"]).status, 429,
                         f"40 parallel wrong passwords did not lock the profile (statuses: {sorted(res)})")
        self.ok(call("PATCH", f"/players/{p['id']}", {"belt": "white"}, admin_token()))


# ---------------------------------------------------------------- signup
class SignupTests(Base):
    def test_create(self):
        n = uname()
        r = track(call("POST", "/players", {"name": n, "password": PW}))
        d = self.ok(r, 201)
        self.assertEqual(set(d), {"token", "player"})
        self.assertEqual(set(d["player"]), PLAYER_KEYS)
        p = d["player"]
        self.assertEqual((p["name"], p["belt"], p["stripes"], p["bio"], p["photo_v"], p["has_pw"]),
                         (n, "white", 0, "", 0, True))
        self.assertEqual(self.me(d["token"]), {"id": p["id"], "admin": False})
        self.ok(login(p["id"]))

    def test_password_rules(self):
        for pw in [None, "", "abc", 1234, ["abcd"], {"p": 1}, "x" * 73]:
            with self.subTest(pw=pw):
                self.bad(track(call("POST", "/players", {"name": uname(), "password": pw})))
        self.bad(track(call("POST", "/players", {"name": uname()})))
        for pw in ["abcd", "x" * 72, "    ", "ção😀"]:
            with self.subTest(pw=pw):
                p, _ = self.mk(password=pw)
                self.ok(login(p["id"], pw))

    def test_password_not_trimmed(self):
        p, _ = self.mk(password=" abcd ")
        self.err(login(p["id"], "abcd"), 401)
        self.ok(login(p["id"], " abcd "))

    def test_all_belts(self):
        for belt in ["white", "blue", "purple", "brown", "black"]:
            self.assertEqual(self.mk(belt=belt)[0]["belt"], belt)

    def test_empty_names(self):
        for n in ["", "   ", "\t\n", None, "\u0000\u0001", "​‍"]:
            self.bad(track(call("POST", "/players", {"name": n, "password": PW})))
        self.bad(call("POST", "/players", {"password": PW}))

    def test_name_length(self):
        p, _ = self.mk()
        n = (PREFIX + "x" * 30)[:24]
        self.ok(track(call("POST", "/players", {"name": n, "password": PW})), 201)
        self.bad(track(call("POST", "/players", {"name": (PREFIX + "y" * 30)[:25], "password": PW})))

    def test_whitespace_and_control_chars_collapsed(self):
        base = uname()
        d = self.ok(track(call("POST", "/players", {"name": "  " + base[:10] + "\t\n\u0007  " + base[10:] + "  ",
                                                    "password": PW})), 201)
        self.assertEqual(d["player"]["name"], base[:10] + " " + base[10:])

    def test_name_wrong_types(self):
        for n in [123, True, ["a"], {"x": 1}]:
            self.bad(track(call("POST", "/players", {"name": n, "password": PW})))

    def test_duplicates_case_insensitive(self):
        p, _ = self.mk()
        for n in [p["name"], p["name"].upper(), "  " + p["name"].upper() + " ",
                  "Paloma", "paloma", "PALOMA", " pAlOmA "]:
            self.err(track(call("POST", "/players", {"name": n, "password": PW})), 409)

    def test_bad_belts(self):
        for b in ["red", "White", "BLACK", " blue", 1, ["blue"], {"b": 1}, "coral", None]:
            self.bad(track(call("POST", "/players", {"name": uname(), "belt": b, "password": PW})))

    def test_bad_stripes(self):
        for st in [-1, 5, 1.5, "abc", "2.5", 100, "-1", True, [3], " ", "0x3", "1e0"]:
            self.bad(track(call("POST", "/players", {"name": uname(), "stripes": st, "password": PW})))

    def test_non_object_bodies(self):
        for raw in ["", "null", "[]", "[1]", '"x"', "42", "true", "{bad json", "{'name':'x'}"]:
            self.bad(call("POST", "/players", raw=raw))

    def test_xss_payload_stored_verbatim(self):
        # The API stores HTML as-is; the frontend must escape it.
        n = PREFIX[:8] + "<img src=x>"
        d = self.ok(track(call("POST", "/players", {"name": n, "password": PW, "bio": "<script>x</script>"})), 201)
        self.assertEqual((d["player"]["name"], d["player"]["bio"]), (n, "<script>x</script>"))

    def test_signup_ignores_privileged_fields(self):
        d = self.ok(track(call("POST", "/players", {"name": uname(), "password": PW, "photo_v": 9, "has_pw": False,
                                                    "pw_hash": "pbkdf2$1$AA==$AA==", "id": 1, "admin": True})), 201)
        self.assertEqual((d["player"]["photo_v"], d["player"]["has_pw"]), (0, True))
        self.assertNotEqual(d["player"]["id"], 1)
        self.assertIs(self.me(d["token"])["admin"], False)


# ---------------------------------------------------------------- bio
class BioTests(Base):
    def test_bio_on_signup_and_patch(self):
        p, t = self.mk(bio="  hi  there ")
        self.assertEqual(p["bio"], "hi there")
        d = self.ok(call("PATCH", f"/players/{p['id']}", {"bio": "line1\nline2"}, t))
        self.assertEqual(d["player"]["bio"], "line1\nline2")
        self.assertEqual(player_by_id(p["id"])["bio"], "line1\nline2")
        self.assertEqual(self.ok(call("PATCH", f"/players/{p['id']}", {"bio": ""}, t))["player"]["bio"], "")
        self.assertEqual(self.ok(call("PATCH", f"/players/{p['id']}", {"bio": None}, t))["player"]["bio"], "")

    def test_normalization(self):
        p, t = self.mk()
        cases = [
            ("  a  \r\n\r\n\r\n\r\n b\t\tc  ", "a\n\nb c"),
            ("a\n\n\nb", "a\n\nb"),
            ("a\n\nb", "a\n\nb"),
            ("a\rb", "a\nb"),
            ("a \n b", "a\nb"),
            ("\n\n a \n\n", "a"),
            ("x​y‮z", "xyz"),
            ("a\u0007b", "a b"),
            ("a\u0085b", "a b"),
        ]
        for raw, want in cases:
            with self.subTest(raw=ascii(raw)):
                d = self.ok(call("PATCH", f"/players/{p['id']}", {"bio": raw}, t))
                self.assertEqual(d["player"]["bio"], want)

    def test_limit(self):
        p, t = self.mk()
        self.ok(call("PATCH", f"/players/{p['id']}", {"bio": "b" * 280}, t))
        self.ok(call("PATCH", f"/players/{p['id']}", {"bio": "  " + "b" * 280 + "\n\n\n"}, t))  # measured after cleanup
        self.bad(call("PATCH", f"/players/{p['id']}", {"bio": "b" * 281}, t))
        self.bad(track(call("POST", "/players", {"name": uname(), "password": PW, "bio": "b" * 281})))
        for v in [5, True, ["x"], {"x": 1}]:
            self.bad(call("PATCH", f"/players/{p['id']}", {"bio": v}, t))
        self.assertEqual(len(player_by_id(p["id"])["bio"]), 280)

    def test_bio_permissions(self):
        (p, tp), (q, tq) = self.mk(), self.mk()
        self.err(call("PATCH", f"/players/{p['id']}", {"bio": "hacked"}), 401)
        self.err(call("PATCH", f"/players/{p['id']}", {"bio": "hacked"}, tq), 403)
        self.ok(call("PATCH", f"/players/{p['id']}", {"bio": "by admin"}, admin_token()))
        self.assertEqual(player_by_id(p["id"])["bio"], "by admin")


# ---------------------------------------------------------------- player PATCH / DELETE
class PlayerPatchTests(Base):
    def test_belt_permissions(self):
        (p, tp), (q, tq) = self.mk(), self.mk()
        self.err(call("PATCH", f"/players/{p['id']}", {"belt": "blue"}), 401)
        self.err(call("PATCH", f"/players/{p['id']}", {"belt": "blue"}, tq), 403)
        d = self.ok(call("PATCH", f"/players/{p['id']}", {"belt": "blue", "stripes": 3}, tp))
        self.assertEqual((d["player"]["belt"], d["player"]["stripes"]), ("blue", 3))
        self.assertIsNone(d["token"])  # no password change -> no new token
        self.assertEqual(self.me(tp)["id"], p["id"])  # session still valid
        d = self.ok(call("PATCH", f"/players/{p['id']}", {"belt": "purple"}, admin_token()))
        self.assertEqual((d["player"]["belt"], d["player"]["stripes"]), ("purple", 3))

    def test_patch_validation(self):
        p, t = self.mk()
        self.bad(call("PATCH", f"/players/{p['id']}", {"belt": "red"}, t))
        self.bad(call("PATCH", f"/players/{p['id']}", {"stripes": 5}, t))
        self.bad(call("PATCH", f"/players/{p['id']}", raw="[]", token=t))
        self.bad(call("PATCH", f"/players/{p['id']}", raw="x", token=t))
        self.bad(call("PATCH", "/players/abc", {"belt": "blue"}, t))
        self.bad(call("PATCH", "/players/0", {"belt": "blue"}, t))
        self.err(call("PATCH", "/players/999999999", {"belt": "blue"}, admin_token()), 404)
        self.ok(call("PATCH", f"/players/{p['id']}", {}, t))  # no-op

    def test_rename_needs_admin(self):
        p, t = self.mk()
        new = uname("r")
        self.err(call("PATCH", f"/players/{p['id']}", {"name": new}), 401)
        self.err(call("PATCH", f"/players/{p['id']}", {"name": new}, t), 403)  # not even yourself
        self.err(call("PATCH", f"/players/{p['id']}", {"name": new, "belt": "blue"}, t), 403)
        self.assertEqual(player_by_id(p["id"])["belt"], "white")  # nothing applied
        d = self.ok(call("PATCH", f"/players/{p['id']}", {"name": new}, admin_token()))
        self.assertEqual(d["player"]["name"], new)
        self.assertEqual(self.me(t)["id"], p["id"])  # rename keeps the player's sessions

    def test_rename_validation(self):
        (p, _), (q, _) = self.mk(), self.mk()
        at = admin_token()
        self.err(call("PATCH", f"/players/{p['id']}", {"name": q["name"].upper()}, at), 409)
        self.err(call("PATCH", f"/players/{p['id']}", {"name": "paloma"}, at), 409)
        self.err(call("PATCH", f"/players/{p['id']}", {"name": "Paloma​"}, at), 409)
        self.bad(call("PATCH", f"/players/{p['id']}", {"name": ""}, at))
        self.bad(call("PATCH", f"/players/{p['id']}", {"name": "x" * 25}, at))
        self.ok(call("PATCH", f"/players/{p['id']}", {"name": p["name"].upper()}, at))  # case-only rename

    def test_paloma_profile(self):
        pal = paloma()
        _, t = self.mk()
        self.err(call("PATCH", f"/players/{pal['id']}", {"belt": "blue"}), 401)
        self.err(call("PATCH", f"/players/{pal['id']}", {"belt": "blue"}, t), 403)
        self.err(call("PATCH", f"/players/{pal['id']}", {"bio": "x"}, t), 403)
        self.err(call("PATCH", f"/players/{pal['id']}", {"password": "abcdef"}, t), 403)
        self.assertEqual(paloma()["belt"], pal["belt"])
        at = admin_token()
        self.ok(call("PATCH", f"/players/{pal['id']}", {"belt": pal["belt"], "bio": pal["bio"]}, at))
        self.bad(call("PATCH", f"/players/{pal['id']}", {"name": "Someone Else"}, at))
        self.bad(call("PATCH", f"/players/{pal['id']}", {"name": "PALOMA"}, at))
        self.bad(call("PATCH", f"/players/{pal['id']}", {"password": "abcdef"}, at))
        self.bad(call("PATCH", f"/players/{pal['id']}", {"password": "abcdef", "currentPassword": ADMIN_PW}, at))
        self.bad(call("DELETE", f"/players/{pal['id']}", token=at))
        self.err(call("DELETE", f"/players/{pal['id']}", token=t), 403)
        self.err(call("DELETE", f"/players/{pal['id']}"), 401)
        self.assertEqual(paloma()["name"], "Paloma")
        self.assertEqual(self.me(at)["admin"], True)

    def test_delete_player_needs_admin_and_cascades(self):
        (a, ta), (b, tb), (c, tc) = self.mk(), self.mk(), self.mk()
        r1 = self.mkroll(a["id"], b["id"], a["id"])
        r2 = self.mkroll(c["id"], a["id"], None, token=tc)  # pending, a involved
        r3 = self.mkroll(b["id"], c["id"], c["id"])
        self.ok(call("PUT", f"/players/{a['id']}/photo", raw=tiny_image("PNG"), token=ta, ctype="image/png"))
        self.err(call("DELETE", f"/players/{a['id']}"), 401)
        self.err(call("DELETE", f"/players/{a['id']}", token=ta), 403)  # not even yourself
        self.err(call("DELETE", f"/players/{a['id']}", token=tb), 403)
        d = self.ok(call("DELETE", f"/players/{a['id']}", token=admin_token()))
        self.assertEqual(d, {"ok": True})
        st = state()
        self.assertNotIn(a["id"], [p["id"] for p in st["players"]])
        rids = [r["id"] for r in st["rolls"]]
        self.assertNotIn(r1["id"], rids)
        self.assertNotIn(r2["id"], rids)
        self.assertIn(r3["id"], rids)
        self.assertIsNone(self.me(ta))  # sessions gone
        self.err(call("GET", f"/players/{a['id']}/photo"), 404)  # photo gone
        self.err(login(a["id"]), 404)
        self.err(call("DELETE", f"/players/{a['id']}", token=admin_token()), 404)


# ---------------------------------------------------------------- passwords
class PasswordTests(Base):
    def test_self_change(self):
        p, t1 = self.mk()
        t2 = self.ok(login(p["id"]))["token"]
        d = self.ok(call("PATCH", f"/players/{p['id']}", {"password": "new-pass-1", "currentPassword": PW}, t1))
        t3 = d["token"]
        self.assertTrue(t3)
        self.assertEqual(self.me(t3), {"id": p["id"], "admin": False})
        self.assertIsNone(self.me(t1))  # the session that made the change is replaced
        self.assertIsNone(self.me(t2))  # other sessions die
        self.err(call("PATCH", f"/players/{p['id']}", {"belt": "blue"}, t2), 401)
        self.err(login(p["id"], PW), 401)
        self.ok(login(p["id"], "new-pass-1"))

    def test_self_change_errors(self):
        p, t = self.mk()
        self.err(call("PATCH", f"/players/{p['id']}", {"password": "new-pass-1"}, t), 401)
        self.err(call("PATCH", f"/players/{p['id']}", {"password": "new-pass-1", "currentPassword": "wrong"}, t), 401)
        self.err(call("PATCH", f"/players/{p['id']}", {"password": "new-pass-1", "currentPassword": 5}, t), 401)
        self.bad(call("PATCH", f"/players/{p['id']}", {"password": "abc", "currentPassword": PW}, t))
        self.bad(call("PATCH", f"/players/{p['id']}", {"password": "x" * 73, "currentPassword": PW}, t))
        self.bad(call("PATCH", f"/players/{p['id']}", {"password": 12345, "currentPassword": PW}, t))
        # a failed change applies nothing (not even other fields) and keeps the session
        self.err(call("PATCH", f"/players/{p['id']}", {"belt": "black", "password": "new-pass-1",
                                                       "currentPassword": "wrong"}, t), 401)
        self.assertEqual(player_by_id(p["id"])["belt"], "white")
        self.assertEqual(self.me(t)["id"], p["id"])
        self.ok(login(p["id"], PW))

    def test_admin_reset(self):
        p, t = self.mk()
        d = self.ok(call("PATCH", f"/players/{p['id']}", {"password": "reset-pw"}, admin_token()))
        self.assertIsNone(d["token"])  # admin keeps its own session, gets no token for p
        self.assertIsNone(self.me(t))
        self.err(login(p["id"], PW), 401)
        self.ok(login(p["id"], "reset-pw"))
        self.assertEqual(self.me(admin_token())["admin"], True)

    def test_reset_by_non_admin_forbidden(self):
        (p, tp), (q, tq) = self.mk(), self.mk()
        self.err(call("PATCH", f"/players/{p['id']}", {"password": "hijack-pw"}, tq), 403)
        self.err(call("PATCH", f"/players/{p['id']}", {"password": "hijack-pw", "currentPassword": PW}, tq), 403)
        self.err(call("PATCH", f"/players/{p['id']}", {"password": "hijack-pw"}), 401)
        self.ok(login(p["id"], PW))
        self.assertEqual(self.me(tp)["id"], p["id"])


# ---------------------------------------------------------------- legacy (passwordless) profiles
class LegacyClaimTests(Base):
    @classmethod
    def setUpClass(cls):
        cls.names = [uname("lg") for _ in range(4)]
        cls.ids = insert_legacy(cls.names)

    def setUp(self):
        if not self.ids:
            self.skipTest("set JJ_NODE, JJ_WRANGLER and JJ_PERSIST to insert legacy players")

    def test_claim(self):
        pid = self.ids[self.names[0]]
        p = player_by_id(pid)
        self.assertIs(p["has_pw"], False)
        self.bad(login(pid, "abc"))  # too short: nothing claimed
        self.bad(login(pid, None))
        self.assertIs(player_by_id(pid)["has_pw"], False)
        d = self.ok(login(pid, "claimed-pw"))
        self.assertIs(d["claimed"], True)
        self.assertIs(d["player"]["has_pw"], True)
        self.assertEqual(self.me(d["token"])["id"], pid)
        self.err(login(pid, "other-pw"), 401)  # second "claim" is just a wrong password
        d = self.ok(login(pid, "claimed-pw"))
        self.assertIs(d["claimed"], False)

    def test_legacy_profile_actions_need_claim(self):
        pid = self.ids[self.names[1]]
        self.err(call("PATCH", f"/players/{pid}", {"belt": "blue"}), 401)
        self.ok(call("PATCH", f"/players/{pid}", {"belt": "blue"}, admin_token()))  # admin can still edit
        self.assertIs(player_by_id(pid)["has_pw"], False)

    def test_admin_can_set_legacy_password(self):
        pid = self.ids[self.names[2]]
        self.ok(call("PATCH", f"/players/{pid}", {"password": "set-by-admin"}, admin_token()))
        self.assertIs(player_by_id(pid)["has_pw"], True)
        self.err(login(pid, "attacker-pw"), 401)
        self.assertIs(self.ok(login(pid, "set-by-admin"))["claimed"], False)

    def test_parallel_claims_one_winner(self):
        pid = self.ids[self.names[3]]
        with ThreadPoolExecutor(8) as ex:
            res = list(ex.map(lambda i: login(pid, f"racer-{i}"), range(8)))
        winners = [i for i, r in enumerate(res) if r.status == 200]
        self.assertEqual(len(winners), 1, [r.status for r in res])
        self.assertTrue(all(r.status == 401 for i, r in enumerate(res) if i not in winners), [r.text for r in res])
        self.ok(login(pid, f"racer-{winners[0]}"))


# ---------------------------------------------------------------- rolls POST
class RollPostTests(Base):
    @classmethod
    def setUpClass(cls):
        cls.a, cls.ta = create_player("A")
        cls.b, cls.tb = create_player("B")
        cls.c, cls.tc = create_player("C")

    def post(self, token=None, **kw):
        body = {"a": self.a["id"], "b": self.b["id"], "winner": self.a["id"], "date": today()}
        body.update(kw)
        return call("POST", "/rolls", body, token or self.ta)

    def test_auth(self):
        self.err(call("POST", "/rolls", {"a": self.a["id"], "b": self.b["id"], "date": today()}), 401)
        self.err(self.post(token=self.tc), 403)  # c was not in the roll
        self.err(self.post(token="x" * 43), 401)

    def test_create_pending(self):
        d = self.ok(self.post(method="  Armbar ", note="nice\n roll"), 201)
        r = d["roll"]
        self.assertEqual(set(r), ROLL_KEYS)
        self.assertEqual((r["a"], r["b"], r["winner"], r["method"], r["note"], r["date"], r["by"], r["status"]),
                         (self.a["id"], self.b["id"], self.a["id"], "Armbar", "nice roll", today(), self.a["id"], "pending"))
        self.assertEqual(roll_by_id(r["id"])["status"], "pending")
        # the other side of the roll can log it too
        d = self.ok(self.post(token=self.tb), 201)
        self.assertEqual((d["roll"]["by"], d["roll"]["status"]), (self.b["id"], "pending"))

    def test_admin_rolls_confirmed(self):
        d = self.ok(self.post(token=admin_token()), 201)  # admin not in the roll
        self.assertEqual((d["roll"]["status"], d["roll"]["by"]), ("confirmed", paloma()["id"]))

    def test_body_cannot_forge_status_or_logger(self):
        d = self.ok(self.post(status="confirmed", by=self.c["id"], created_by=self.b["id"]), 201)
        self.assertEqual((d["roll"]["status"], d["roll"]["by"]), ("pending", self.a["id"]))

    def test_draw_variants(self):
        for w in [None, "", "draw"]:
            self.assertIsNone(self.ok(self.post(winner=w), 201)["roll"]["winner"])
        d = self.ok(call("POST", "/rolls", {"a": self.a["id"], "b": self.b["id"], "date": today()}, self.ta), 201)
        self.assertIsNone(d["roll"]["winner"])

    def test_string_ids_accepted(self):
        d = self.ok(self.post(a=str(self.a["id"]), b=str(self.b["id"]), winner=str(self.b["id"])), 201)
        self.assertEqual(d["roll"]["winner"], self.b["id"])

    def test_self_roll(self):
        self.bad(self.post(b=self.a["id"]))
        self.bad(self.post(b=str(self.a["id"])))

    def test_unknown_players(self):
        self.err(self.post(b=999999999, winner=None), 404)
        self.err(self.post(a=999999998, b=999999999, winner=None, token=admin_token()), 404)

    def test_winner_not_in_roll(self):
        self.bad(self.post(winner=self.c["id"]))
        self.bad(self.post(winner=999999999))
        for w in [0, -1, False, True, 1.5, "abc", [self.a["id"]]]:
            self.bad(self.post(winner=w))

    def test_bad_dates(self):
        for dt in ["", None, 20240101, "2024/01/01", "24-01-01", "2024-1-1", "2024-02-30",
                   "2023-02-29", "2024-13-01", "2024-00-10", "1999-12-31", "2024-01-01T00:00",
                   "3000-01-01", "abcd-ef-gh"]:
            with self.subTest(dt=dt):
                self.bad(self.post(date=dt))
        self.bad(call("POST", "/rolls", {"a": self.a["id"], "b": self.b["id"]}, self.ta))

    def test_good_dates(self):
        for dt in ["2000-01-01", "2024-02-29", (utc_today() - datetime.timedelta(days=1)).isoformat()]:
            self.assertEqual(self.post(date=dt).status, 201, dt)

    def test_future_dates(self):
        self.bad(self.post(date=(utc_today() + datetime.timedelta(days=5)).isoformat()))
        latest = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=14)).date()
        self.bad(self.post(date=(latest + datetime.timedelta(days=1)).isoformat()))

    def test_method_note_limits(self):
        self.assertEqual(self.post(method="m" * 40).status, 201)
        self.assertEqual(self.post(note="n" * 140).status, 201)
        self.bad(self.post(method="m" * 41))
        self.bad(self.post(note="n" * 141))
        self.assertEqual(self.post(method="  " + "m" * 40 + "   ").status, 201)

    def test_wrong_types(self):
        for k, v in [("a", True), ("a", [1]), ("a", {"id": 1}), ("a", 1.5), ("a", None), ("a", -3),
                     ("b", "x"), ("method", 5), ("method", ["x"]), ("note", {"x": 1}), ("note", True),
                     ("date", ["2024-01-01"])]:
            with self.subTest(k=k, v=v):
                self.bad(self.post(**{k: v}))

    def test_non_object_bodies(self):
        for raw in ["", "null", "[]", '"x"', "1", "false", "{nope"]:
            self.bad(call("POST", "/rolls", raw=raw, token=self.ta))


# ---------------------------------------------------------------- pending / accept / reject
class PendingTests(Base):
    @classmethod
    def setUpClass(cls):
        cls.a, cls.ta = create_player("A")
        cls.b, cls.tb = create_player("B")
        cls.c, cls.tc = create_player("C")

    def pending(self, token=None):
        r = self.mkroll(self.a["id"], self.b["id"], self.a["id"], token=token or self.ta)
        self.assertEqual(r["status"], "pending")
        return r["id"]

    def act(self, rid, what, token):
        return call("POST", f"/rolls/{rid}/{what}", token=token)

    def test_accept_matrix(self):
        rid = self.pending()
        self.err(self.act(rid, "accept", None), 401)
        self.err(self.act(rid, "accept", self.ta), 403)  # the logger can't confirm their own roll
        self.err(self.act(rid, "accept", self.tc), 403)  # outsider
        self.assertEqual(roll_by_id(rid)["status"], "pending")
        d = self.ok(self.act(rid, "accept", self.tb))
        self.assertEqual(d["roll"]["status"], "confirmed")
        self.assertEqual(roll_by_id(rid)["status"], "confirmed")
        self.err(self.act(rid, "accept", self.tb), 409)
        self.err(self.act(rid, "accept", admin_token()), 409)

    def test_accept_when_b_logged(self):
        rid = self.pending(self.tb)
        self.err(self.act(rid, "accept", self.tb), 403)
        self.assertEqual(self.ok(self.act(rid, "accept", self.ta))["roll"]["status"], "confirmed")

    def test_admin_accepts(self):
        rid = self.pending()
        self.assertEqual(self.ok(self.act(rid, "accept", admin_token()))["roll"]["status"], "confirmed")

    def test_reject_matrix(self):
        rid = self.pending()
        self.err(self.act(rid, "reject", None), 401)
        self.err(self.act(rid, "reject", self.tc), 403)
        self.assertIsNotNone(roll_by_id(rid))
        self.assertEqual(self.ok(self.act(rid, "reject", self.tb)), {"ok": True})  # other player rejects
        self.assertIsNone(roll_by_id(rid))
        self.err(self.act(rid, "reject", self.tb), 404)
        self.err(self.act(rid, "accept", self.tb), 404)

        rid = self.pending()
        self.ok(self.act(rid, "reject", self.ta))  # logger cancels
        self.assertIsNone(roll_by_id(rid))

        rid = self.pending()
        self.ok(self.act(rid, "reject", admin_token()))
        self.assertIsNone(roll_by_id(rid))

    def test_confirmed_cannot_be_rejected_by_players(self):
        rid = self.pending()
        self.ok(self.act(rid, "accept", self.tb))
        self.err(self.act(rid, "reject", self.ta), 409)
        self.err(self.act(rid, "reject", self.tb), 409)
        self.err(self.act(rid, "reject", self.tc), 409)
        self.assertIsNotNone(roll_by_id(rid))
        self.ok(self.act(rid, "reject", admin_token()))  # admin may delete it this way
        self.assertIsNone(roll_by_id(rid))

    def test_admin_logged_roll_needs_no_accept(self):
        r = self.mkroll(self.a["id"], self.b["id"], None)
        self.assertEqual(r["status"], "confirmed")
        self.err(self.act(r["id"], "accept", self.tb), 409)
        self.err(self.act(r["id"], "reject", self.tb), 409)

    def test_routing_and_ids(self):
        rid = self.pending()
        self.bad(self.act("abc", "accept", self.tb))
        self.bad(self.act("0", "reject", self.tb))
        self.err(self.act(999999999, "accept", self.tb), 404)
        for m in ["GET", "PATCH", "DELETE", "PUT"]:
            self.err(call(m, f"/rolls/{rid}/accept", token=admin_token()), 404)
        self.err(call("POST", f"/rolls/{rid}/approve", token=admin_token()), 404)
        self.err(call("POST", f"/rolls/{rid}/accept/x", token=admin_token()), 404)
        self.assertEqual(roll_by_id(rid)["status"], "pending")


# ---------------------------------------------------------------- admin roll PATCH / DELETE
class RollAdminTests(Base):
    def setUp(self):
        (self.a, self.ta), (self.b, self.tb), (self.c, _) = self.mk("A"), self.mk("B"), self.mk("C")
        self.r = self.mkroll(self.a["id"], self.b["id"], self.a["id"], method="Choke", note="hi", date="2024-05-05")

    def test_patch_auth(self):
        path = f"/rolls/{self.r['id']}"
        self.err(call("PATCH", path, {"winner": None}), 401)
        self.err(call("PATCH", path, {"winner": None}, self.ta), 403)
        self.err(call("PATCH", path, {"winner": None}, self.tb), 403)
        self.assertEqual(roll_by_id(self.r["id"])["winner"], self.a["id"])
        d = self.ok(call("PATCH", path, {"winner": None}, admin_token()))
        self.assertIsNone(d["roll"]["winner"])
        self.assertEqual((d["roll"]["method"], d["roll"]["note"], d["roll"]["date"], d["roll"]["status"]),
                         ("Choke", "hi", "2024-05-05", "confirmed"))

    def test_patch_merge_and_validate(self):
        path = f"/rolls/{self.r['id']}"
        at = admin_token()
        self.assertEqual(self.ok(call("PATCH", path, {"b": self.c["id"]}, at))["roll"]["b"], self.c["id"])
        self.bad(call("PATCH", path, {"a": self.b["id"], "b": self.c["id"]}, at))  # old winner a not in roll
        self.bad(call("PATCH", path, {"b": self.a["id"]}, at))
        self.bad(call("PATCH", path, {"date": "2999-01-01"}, at))
        self.bad(call("PATCH", path, {"method": "x" * 41}, at))
        self.bad(call("PATCH", path, raw="[]", token=at))
        self.err(call("PATCH", path, {"b": 999999999, "winner": None}, at), 404)
        self.err(call("PATCH", "/rolls/999999999", {"winner": None}, at), 404)
        self.bad(call("PATCH", "/rolls/abc", {"winner": None}, at))
        self.ok(call("PATCH", path, {}, at))
        self.ok(call("PATCH", path, {"status": "pending"}, at))
        self.assertEqual(roll_by_id(self.r["id"])["status"], "confirmed")  # status is not editable

    def test_delete_auth(self):
        path = f"/rolls/{self.r['id']}"
        self.err(call("DELETE", path), 401)
        self.err(call("DELETE", path, token=self.ta), 403)
        self.assertIsNotNone(roll_by_id(self.r["id"]))
        self.assertEqual(self.ok(call("DELETE", path, token=admin_token())), {"ok": True})
        self.assertIsNone(roll_by_id(self.r["id"]))
        self.err(call("DELETE", path, token=admin_token()), 404)

    def test_players_cannot_delete_own_pending_via_delete(self):
        r = self.mkroll(self.a["id"], self.b["id"], None, token=self.ta)
        self.err(call("DELETE", f"/rolls/{r['id']}", token=self.ta), 403)
        self.err(call("PATCH", f"/rolls/{r['id']}", {"winner": self.a["id"]}, self.ta), 403)


# ---------------------------------------------------------------- photos
class PhotoTests(Base):
    def put(self, pid, data, token, ctype="image/png"):
        return call("PUT", f"/players/{pid}/photo", raw=data, token=token, ctype=ctype)

    def get(self, pid, v=None):
        return call("GET", f"/players/{pid}/photo" + (f"?v={v}" if v is not None else ""))

    def test_upload_get_replace_delete(self):
        p, t = self.mk()
        png = tiny_image("PNG")
        d = self.ok(self.put(p["id"], png, t))
        self.assertEqual(d["player"]["photo_v"], 1)
        self.assertEqual(player_by_id(p["id"])["photo_v"], 1)
        g = self.get(p["id"], 1)
        self.assertEqual(g.status, 200)
        self.assertEqual(g.body, png)
        self.assertEqual(g.ctype, "image/png")
        cc = g.headers.get("cache-control", "")
        self.assertIn("immutable", cc)
        self.assertIn("max-age=31536000", cc)
        self.assertIn("public", cc)
        self.assertEqual(g.headers.get("x-content-type-options"), "nosniff")

        jpg = tiny_image("JPEG")
        self.assertEqual(self.ok(self.put(p["id"], jpg, t, "image/jpeg"))["player"]["photo_v"], 2)
        g = self.get(p["id"], 2)
        self.assertEqual((g.body, g.ctype), (jpg, "image/jpeg"))

        d = self.ok(call("DELETE", f"/players/{p['id']}/photo", token=t))
        self.assertLessEqual(d["player"]["photo_v"], 0)  # <= 0 means "no photo"; the number is kept so URLs never repeat
        self.err(self.get(p["id"]), 404)
        self.ok(call("DELETE", f"/players/{p['id']}/photo", token=t))  # idempotent

    def test_webp_and_type_from_bytes_not_header(self):
        p, t = self.mk()
        from PIL import features
        webp = tiny_image("WEBP") if features.check("webp") else b"RIFF\x1a\x00\x00\x00WEBPVP8 " + b"\x00" * 20
        self.ok(self.put(p["id"], webp, t, "image/jpeg"))  # wrong declared type is ignored
        self.assertEqual(self.get(p["id"]).ctype, "image/webp")
        png = tiny_image("PNG")
        self.ok(self.put(p["id"], png, t, "application/octet-stream"))
        self.assertEqual(self.get(p["id"]).ctype, "image/png")

    def test_rejections(self):
        p, t = self.mk()
        self.bad(self.put(p["id"], b"", t))
        for data in [b"hello world, not an image", b"GIF89a" + b"\x00" * 30,
                     b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                     b"<html><script>alert(1)</script></html>", b"\xff\xd8\xff", b"RIFF\x00\x00\x00\x00WAVEfmt ",
                     b"BM" + b"\x00" * 60, tiny_image("GIF")]:
            with self.subTest(data=data[:12]):
                self.err(self.put(p["id"], data, t), 415)
        too_big = b"\x89PNG\r\n\x1a\n" + os.urandom(300 * 1024 + 1 - 8)
        self.err(self.put(p["id"], too_big, t), 413)
        self.assertEqual(player_by_id(p["id"])["photo_v"], 0)
        self.err(self.get(p["id"]), 404)
        exact = b"\x89PNG\r\n\x1a\n" + os.urandom(300 * 1024 - 8)
        self.assertEqual(self.ok(self.put(p["id"], exact, t))["player"]["photo_v"], 1)
        self.assertEqual(self.get(p["id"]).body, exact)

    def test_permissions(self):
        (p, tp), (q, tq) = self.mk(), self.mk()
        png = tiny_image("PNG")
        self.err(self.put(p["id"], png, None), 401)
        self.err(self.put(p["id"], png, tq), 403)
        self.err(self.put(paloma()["id"], png, tq), 403)
        self.err(call("DELETE", f"/players/{p['id']}/photo"), 401)
        self.err(call("DELETE", f"/players/{p['id']}/photo", token=tq), 403)
        self.err(self.put(999999999, png, admin_token()), 404)
        self.ok(self.put(p["id"], png, admin_token()))  # admin may set anyone's photo
        self.err(call("DELETE", f"/players/{p['id']}/photo", token=tq), 403)
        self.assertEqual(self.get(p["id"]).status, 200)
        self.ok(call("DELETE", f"/players/{p['id']}/photo", token=admin_token()))
        self.err(self.get(p["id"]), 404)

    def test_get_errors_and_routing(self):
        self.err(self.get(999999999), 404)
        self.bad(call("GET", "/players/abc/photo"))
        p, t = self.mk()
        self.err(call("POST", f"/players/{p['id']}/photo", raw=tiny_image("PNG"), token=t, ctype="image/png"), 404)
        self.err(call("PATCH", f"/players/{p['id']}/photo", {}, t), 404)
        self.err(call("GET", f"/players/{p['id']}/photo/x"), 404)
        self.err(call("GET", f"/players/{p['id']}/avatar"), 404)

    def test_photo_not_in_state(self):
        p, t = self.mk()
        self.ok(self.put(p["id"], b"\x89PNG\r\n\x1a\n" + b"Q" * 50000, t))
        st = call("GET", "/state").text
        self.assertNotIn("QQQQ", st)
        self.assertNotIn("UVFRU", st)  # base64 of "QQQ"

    def test_reupload_after_delete_gets_new_url(self):
        # Regression: photos are served with "immutable" caching at ?v=photo_v. Deleting used to reset
        # photo_v to 0, so the next upload is v=1 again: the same URL as the first photo, and
        # browsers that cached the old image keep showing it.
        p, t = self.mk()
        v1 = self.ok(self.put(p["id"], tiny_image("PNG", color=(255, 0, 0)), t))["player"]["photo_v"]
        self.ok(call("DELETE", f"/players/{p['id']}/photo", token=t))
        v2 = self.ok(self.put(p["id"], tiny_image("PNG", color=(0, 0, 255)), t))["player"]["photo_v"]
        self.assertNotEqual(v1, v2, "re-uploaded photo reuses an already-cached ?v= URL")


# ---------------------------------------------------------------- routing / robustness
class RoutingTests(Base):
    def test_unknown_routes_404(self):
        at = admin_token()
        # (bare /jiujitsu/api without a slash is not routed to the Worker: the static 404 page answers it)
        for m, p in [("GET", "/"), ("GET", "/nope"), ("GET", "/state/1"), ("GET", "/state/1/2"),
                     ("GET", "/players"), ("GET", "/rolls"), ("GET", "/admin"), ("GET", "/admin/login"),
                     ("POST", "/admin/login"), ("POST", "/admin/logout"), ("GET", "/login"), ("POST", "/login/1"),
                     ("GET", "/players/1/extra"), ("POST", "/state"), ("PUT", "/players"), ("DELETE", "/state"),
                     ("PUT", "/state"), ("PATCH", "/players"), ("DELETE", "/rolls"), ("PATCH", "/state"),
                     ("GET", "/players/1"), ("POST", "/players/1"), ("PUT", "/players/1"),
                     ("GET", "/rolls/1/accept"), ("POST", "/rolls/1"), ("GET", "/players/1/photo/2/3")]:
            with self.subTest(m=m, p=p):
                self.err(call(m, p, {} if m in ("POST", "PUT", "PATCH") else None, at), 404)

    def test_never_500(self):
        at = admin_token()
        cases = [("GET", "/players/99999999999999999999999"), ("PATCH", "/players/99999999999999999999999"),
                 ("DELETE", "/rolls/99999999999999999999999"), ("POST", "/rolls"), ("POST", "/players"),
                 ("POST", "/login"), ("POST", "/rolls/99999999999999999999999/accept"),
                 ("GET", "/players/99999999999999999999999/photo")]
        bodies = [None, {"a": 1e300, "b": 2, "date": today()}, {"name": "x" * 10000, "password": PW},
                  {"a": 9007199254740993, "b": 1, "date": today()}, {"stripes": 1e309},
                  {"id": 1e300, "password": "x"}, {"id": 9007199254740993, "password": "x" * 10000}]
        for m, p in cases:
            for bd in bodies:
                with self.subTest(m=m, p=p, b=bd):
                    self.no500(call(m, p, bd, at))
        self.no500(track(call("POST", "/players", raw=b"\xff\xfe{")))
        self.no500(call("POST", "/rolls", raw=b'{"a":' + b"[" * 5000 + b"]" * 5000 + b"}", token=at))
        self.no500(call("GET", "/players/%ZZ/photo"))
        self.no500(call("POST", "/login", {"id": paloma()["id"], "password": "x" * 100000}))
        self.ok(login(paloma()["id"], ADMIN_PW))  # reset Paloma's fail counter after that wrong attempt


# ---------------------------------------------------------------- regression tests
class RegressionTests(Base):
    def test_invisible_chars_cannot_impersonate_admin(self):
        for n in ["Paloma​", "‍Paloma", "Pal­oma", "Paloma⁠", "‮Paloma", "Paloma﻿",
                  "Pa͏loma", "Paloma᠎", "⁦Paloma⁩"]:
            with self.subTest(n=ascii(n)):
                r = track(call("POST", "/players", {"name": n, "password": PW}))
                self.assertNotEqual(r.status, 201, f"{ascii(n)} accepted as a separate player that renders as 'Paloma'")
                self.assertEqual(r.status, 409, r.text)

    def test_c1_and_bidi_controls_stripped(self):
        n = uname()
        r = track(call("POST", "/players", {"name": n[:6] + "\u0085‮" + n[6:], "password": PW}))
        if r.status == 201:
            self.assertNotRegex(r.data["player"]["name"], "[\u0080-\u009f‪-‮⁦-⁩]")


def tearDownModule():
    at = admin_token()
    for pid in CREATED:
        call("DELETE", f"/players/{pid}", token=at)
    for p in state()["players"]:
        if p["name"].upper().startswith(PREFIX.upper()):
            call("DELETE", f"/players/{p['id']}", token=at)
    call("POST", "/logout", token=at)


if __name__ == "__main__":
    unittest.main(verbosity=2)
