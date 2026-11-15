"""API tests for the Chacrinha Jiu-Jitsu Pages Function.

Run against a local `wrangler pages dev` server:
    python -I tests/jiujitsu/test_api.py
Env overrides: JJ_BASE (default http://localhost:8788/jiujitsu/api),
               JJ_ADMIN_PW (default test-admin-pw).

The DB may be shared with other clients, so every player created here uses a
random prefix and is deleted in tearDownModule. Nothing else is deleted.
"""
import datetime
import json
import os
import random
import string
import unittest
import urllib.error
import urllib.request

BASE = os.environ.get("JJ_BASE", "http://localhost:8788/jiujitsu/api").rstrip("/")
ADMIN_PW = os.environ.get("JJ_ADMIN_PW", "test-admin-pw")
ADMIN = {"X-Admin-Password": ADMIN_PW}
WRONG = {"X-Admin-Password": "nope-" + ADMIN_PW}
PREFIX = "t_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6)) + "_"
CREATED = []  # player ids created by this run
_counter = [0]


def call(method, path, body=None, headers=None, raw=None):
    """Returns (status, parsed_json_or_None, raw_text, content_type)."""
    if raw is not None:
        data = raw if isinstance(raw, bytes) else raw.encode()
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    h = {"content-type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, text, ctype = r.status, r.read().decode("utf-8"), r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        status, text, ctype = e.code, e.read().decode("utf-8"), e.headers.get("content-type", "")
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = None
    return status, parsed, text, ctype


def uname(tag=""):
    _counter[0] += 1
    return f"{PREFIX}{tag}{_counter[0]}"[:24]


def utc_today():
    return datetime.datetime.now(datetime.timezone.utc).date()


def today():
    return utc_today().isoformat()


def state():
    s, d, _, _ = call("GET", "/state")
    assert s == 200, s
    return d


def paloma():
    for p in state()["players"]:
        if p["name"].lower() == "paloma":
            return p
    raise AssertionError("admin profile Paloma missing")


def roll_by_id(rid):
    return next((r for r in state()["rolls"] if r["id"] == rid), None)


def create_player(tag="", **kw):
    body = {"name": uname(tag), "belt": "white", "stripes": 0}
    body.update(kw)
    s, d, t, _ = call("POST", "/players", body)
    if s != 201:
        raise AssertionError(f"create player failed: {s} {t}")
    CREATED.append(d["player"]["id"])
    return d["player"]


class Base(unittest.TestCase):
    def mk(self, tag="", **kw):
        return create_player(tag, **kw)

    def mkroll(self, a, b, winner=None, **kw):
        body = {"a": a, "b": b, "winner": winner, "date": today()}
        body.update(kw)
        s, d, t, _ = call("POST", "/rolls", body)
        self.assertEqual(s, 201, t)
        return d["roll"]

    def err(self, resp, status):
        s, d, t, ctype = resp
        self.assertEqual(s, status, t)
        self.assertIn("application/json", ctype)
        self.assertIsInstance(d, dict, t)
        self.assertIsInstance(d.get("error"), str, t)
        self.assertTrue(d["error"])
        return d["error"]

    def bad(self, resp):
        return self.err(resp, 400)

    def no500(self, resp):
        s, d, t, _ = resp
        self.assertLess(s, 500, t)
        if s >= 400:
            self.assertIsInstance(d, dict, t)
            self.assertIn("error", d, t)


# ---------------------------------------------------------------- state
class StateTests(Base):
    def test_shape(self):
        s, d, _, ctype = call("GET", "/state")
        self.assertEqual(s, 200)
        self.assertIn("application/json", ctype)
        self.assertEqual(set(d), {"players", "rolls", "admin", "adminConfigured"})
        self.assertEqual(d["admin"], "Paloma")
        self.assertIs(d["adminConfigured"], True)
        self.assertIsInstance(d["players"], list)
        self.assertIsInstance(d["rolls"], list)
        for p in d["players"]:
            self.assertEqual(set(p), {"id", "name", "belt", "stripes", "created_at"})
        for r in d["rolls"]:
            self.assertEqual(set(r), {"id", "a", "b", "winner", "method", "note", "date", "by", "created_at"})

    def test_paloma_seeded_white(self):
        p = paloma()
        self.assertEqual(p["name"], "Paloma")
        self.assertIn(p["belt"], ["white", "blue", "purple", "brown", "black"])

    def test_trailing_slash_ok(self):
        self.assertEqual(call("GET", "/state/")[0], 200)

    def test_rolls_sorted_newest_first(self):
        a, b = self.mk(), self.mk()
        old = self.mkroll(a["id"], b["id"], date="2024-01-01")
        new = self.mkroll(a["id"], b["id"], date=today())
        ids = [r["id"] for r in state()["rolls"]]
        self.assertLess(ids.index(new["id"]), ids.index(old["id"]))

    def test_login(self):
        s, d, _, _ = call("POST", "/admin/login", {"password": ADMIN_PW})
        self.assertEqual(s, 200)
        self.assertEqual(d["ok"], True)
        self.assertEqual(d["playerId"], paloma()["id"])
        self.err(call("POST", "/admin/login", {"password": "wrong"}), 401)
        self.err(call("POST", "/admin/login", {}), 401)
        self.bad(call("POST", "/admin/login", raw="nope"))


# ---------------------------------------------------------------- signup
class SignupTests(Base):
    def test_create_defaults(self):
        n = uname()
        s, d, t, _ = call("POST", "/players", {"name": n})
        self.assertEqual(s, 201, t)
        CREATED.append(d["player"]["id"])
        self.assertEqual(d["player"]["name"], n)
        self.assertEqual(d["player"]["belt"], "white")
        self.assertEqual(d["player"]["stripes"], 0)
        self.assertIn(d["player"]["id"], [p["id"] for p in state()["players"]])

    def test_all_belts_and_stripes(self):
        for i, belt in enumerate(["white", "blue", "purple", "brown", "black"]):
            p = self.mk(belt=belt, stripes=i % 5)
            self.assertEqual((p["belt"], p["stripes"]), (belt, i % 5))
        self.assertEqual(self.mk(stripes=4)["stripes"], 4)
        self.assertEqual(self.mk(stripes="2")["stripes"], 2)  # numeric string accepted

    def test_empty_names(self):
        for n in ["", "   ", "\t\n", None, "\u0000\u0001"]:
            self.bad(call("POST", "/players", {"name": n}))
        self.bad(call("POST", "/players", {}))

    def test_name_length(self):
        n = (PREFIX + "x" * 30)[:24]
        s, d, t, _ = call("POST", "/players", {"name": n})
        self.assertEqual(s, 201, t)
        CREATED.append(d["player"]["id"])
        self.bad(call("POST", "/players", {"name": (PREFIX + "y" * 30)[:25]}))

    def test_whitespace_and_control_chars_collapsed(self):
        base = uname()
        s, d, t, _ = call("POST", "/players", {"name": "  " + base[:10] + "\t\n\u0007  " + base[10:] + "  "})
        self.assertEqual(s, 201, t)
        CREATED.append(d["player"]["id"])
        self.assertEqual(d["player"]["name"], base[:10] + " " + base[10:])

    def test_name_wrong_types(self):
        for n in [123, True, ["a"], {"x": 1}]:
            self.bad(call("POST", "/players", {"name": n}))

    def test_duplicates_case_insensitive(self):
        p = self.mk()
        self.err(call("POST", "/players", {"name": p["name"]}), 409)
        self.err(call("POST", "/players", {"name": p["name"].upper()}), 409)
        self.err(call("POST", "/players", {"name": "  " + p["name"].upper() + " "}), 409)
        for n in ["Paloma", "paloma", "PALOMA", " pAlOmA "]:
            self.err(call("POST", "/players", {"name": n}), 409)

    def test_bad_belts(self):
        for b in ["red", "White", "BLACK", " blue", 1, ["blue"], {"b": 1}, "coral"]:
            self.bad(call("POST", "/players", {"name": uname(), "belt": b}))

    def test_bad_stripes(self):
        for st in [-1, 5, 1.5, "abc", "2.5", 100, "-1"]:
            self.bad(call("POST", "/players", {"name": uname(), "stripes": st}))

    def test_non_object_bodies(self):
        for raw in ["", "null", "[]", "[1]", '"x"', "42", "true", "{bad json", "{'name':'x'}"]:
            self.bad(call("POST", "/players", raw=raw))

    def test_xss_payload_stored_verbatim(self):
        # The API stores HTML as-is; the frontend must escape it (app.js esc()).
        n = PREFIX[:8] + "<img src=x>"
        s, d, t, _ = call("POST", "/players", {"name": n})
        self.assertEqual(s, 201, t)
        CREATED.append(d["player"]["id"])
        self.assertEqual(d["player"]["name"], n)


# ---------------------------------------------------------------- player PATCH / DELETE
class PlayerPatchTests(Base):
    def test_anyone_changes_belt_and_stripes(self):
        p = self.mk()
        s, d, t, _ = call("PATCH", f"/players/{p['id']}", {"belt": "blue", "stripes": 3})
        self.assertEqual(s, 200, t)
        self.assertEqual((d["player"]["belt"], d["player"]["stripes"]), ("blue", 3))
        s, d, t, _ = call("PATCH", f"/players/{p['id']}", {"stripes": 1})
        self.assertEqual((d["player"]["belt"], d["player"]["stripes"]), ("blue", 1))

    def test_patch_validation(self):
        p = self.mk()
        self.bad(call("PATCH", f"/players/{p['id']}", {"belt": "red"}))
        self.bad(call("PATCH", f"/players/{p['id']}", {"stripes": 5}))
        self.bad(call("PATCH", f"/players/{p['id']}", {"stripes": 2.5}))
        self.bad(call("PATCH", f"/players/{p['id']}", raw="[]"))
        self.bad(call("PATCH", f"/players/{p['id']}", raw="x"))
        self.bad(call("PATCH", "/players/abc", {"belt": "blue"}))
        self.bad(call("PATCH", "/players/0", {"belt": "blue"}))
        self.err(call("PATCH", "/players/999999999", {"belt": "blue"}), 404)

    def test_rename_needs_admin(self):
        p = self.mk()
        new = uname("r")
        self.err(call("PATCH", f"/players/{p['id']}", {"name": new}), 401)
        self.err(call("PATCH", f"/players/{p['id']}", {"name": new}, WRONG), 401)
        s, d, t, _ = call("PATCH", f"/players/{p['id']}", {"name": new}, ADMIN)
        self.assertEqual(s, 200, t)
        self.assertEqual(d["player"]["name"], new)

    def test_rename_validation(self):
        p, q = self.mk(), self.mk()
        self.err(call("PATCH", f"/players/{p['id']}", {"name": q["name"].upper()}, ADMIN), 409)
        self.err(call("PATCH", f"/players/{p['id']}", {"name": "paloma"}, ADMIN), 409)
        self.bad(call("PATCH", f"/players/{p['id']}", {"name": ""}, ADMIN))
        self.bad(call("PATCH", f"/players/{p['id']}", {"name": "x" * 25}, ADMIN))
        # case-only rename of yourself is fine
        s, d, t, _ = call("PATCH", f"/players/{p['id']}", {"name": p["name"].upper()}, ADMIN)
        self.assertEqual(s, 200, t)

    def test_paloma_profile_needs_admin(self):
        pal = paloma()
        self.err(call("PATCH", f"/players/{pal['id']}", {"belt": "blue"}), 401)
        self.err(call("PATCH", f"/players/{pal['id']}", {"stripes": 1}, WRONG), 401)
        self.assertEqual(paloma()["belt"], pal["belt"])
        # admin may; write back the same values so shared state is unchanged
        s, d, t, _ = call("PATCH", f"/players/{pal['id']}", {"belt": pal["belt"], "stripes": pal["stripes"]}, ADMIN)
        self.assertEqual(s, 200, t)

    def test_admin_cannot_be_renamed_or_deleted(self):
        pal = paloma()
        self.bad(call("PATCH", f"/players/{pal['id']}", {"name": "Someone Else"}, ADMIN))
        self.err(call("PATCH", f"/players/{pal['id']}", {"name": "Someone Else"}), 401)
        self.bad(call("DELETE", f"/players/{pal['id']}", headers=ADMIN))
        self.err(call("DELETE", f"/players/{pal['id']}"), 401)
        self.assertEqual(paloma()["id"], pal["id"])

    def test_delete_player_needs_admin_and_cascades(self):
        a, b, c = self.mk(), self.mk(), self.mk()
        r1 = self.mkroll(a["id"], b["id"], a["id"])
        r2 = self.mkroll(c["id"], a["id"], None)
        r3 = self.mkroll(b["id"], c["id"], c["id"])
        self.err(call("DELETE", f"/players/{a['id']}"), 401)
        self.err(call("DELETE", f"/players/{a['id']}", headers=WRONG), 401)
        s, d, t, _ = call("DELETE", f"/players/{a['id']}", headers=ADMIN)
        self.assertEqual(s, 200, t)
        self.assertEqual(d, {"ok": True})
        st = state()
        self.assertNotIn(a["id"], [p["id"] for p in st["players"]])
        rids = [r["id"] for r in st["rolls"]]
        self.assertNotIn(r1["id"], rids)
        self.assertNotIn(r2["id"], rids)
        self.assertIn(r3["id"], rids)
        self.err(call("DELETE", f"/players/{a['id']}", headers=ADMIN), 404)


# ---------------------------------------------------------------- rolls POST
class RollPostTests(Base):
    @classmethod
    def setUpClass(cls):
        cls.a = create_player("A")
        cls.b = create_player("B")
        cls.c = create_player("C")

    def post(self, **kw):
        body = {"a": self.a["id"], "b": self.b["id"], "winner": self.a["id"], "date": today()}
        body.update(kw)
        return call("POST", "/rolls", body)

    def test_create_win(self):
        s, d, t, _ = self.post(method="  Armbar ", note="nice\n roll")
        self.assertEqual(s, 201, t)
        r = d["roll"]
        self.assertEqual((r["a"], r["b"], r["winner"], r["method"], r["note"], r["date"], r["by"]),
                         (self.a["id"], self.b["id"], self.a["id"], "Armbar", "nice roll", today(), None))
        self.assertIsNotNone(roll_by_id(r["id"]))

    def test_draw_variants(self):
        for w in [None, "", "draw"]:
            s, d, t, _ = self.post(winner=w)
            self.assertEqual(s, 201, t)
            self.assertIsNone(d["roll"]["winner"])
        body = {"a": self.a["id"], "b": self.b["id"], "date": today()}  # winner omitted
        s, d, t, _ = call("POST", "/rolls", body)
        self.assertEqual(s, 201, t)
        self.assertIsNone(d["roll"]["winner"])

    def test_string_ids_accepted(self):
        s, d, t, _ = self.post(a=str(self.a["id"]), b=str(self.b["id"]), winner=str(self.b["id"]))
        self.assertEqual(s, 201, t)
        self.assertEqual(d["roll"]["winner"], self.b["id"])

    def test_self_roll(self):
        self.bad(self.post(b=self.a["id"]))
        self.bad(self.post(b=str(self.a["id"])))

    def test_unknown_players(self):
        self.err(self.post(b=999999999, winner=None), 404)
        self.err(self.post(a=999999998, b=999999999, winner=None), 404)

    def test_winner_not_in_roll(self):
        self.bad(self.post(winner=self.c["id"]))
        self.bad(self.post(winner=999999999))
        for w in [0, -1, False, True, 1.5, "abc", [self.a["id"]]]:
            self.bad(self.post(winner=w))

    def test_bad_dates(self):
        for dt in ["", None, 20240101, "2024/01/01", "24-01-01", "2024-1-1", "2024-02-30",
                   "2023-02-29", "2024-13-01", "2024-00-10", "1999-12-31", "2024-01-01T00:00",
                   "3000-01-01", "abcd-ef-gh"]:
            self.bad(self.post(date=dt))
        self.bad(call("POST", "/rolls", {"a": self.a["id"], "b": self.b["id"]}))  # missing date

    def test_good_dates(self):
        for dt in ["2000-01-01", "2024-02-29", (utc_today() - datetime.timedelta(days=1)).isoformat()]:
            s, _, t, _ = self.post(date=dt)
            self.assertEqual(s, 201, (dt, t))

    def test_future_date(self):
        far = (utc_today() + datetime.timedelta(days=5)).isoformat()
        self.bad(self.post(date=far))

    def test_method_note_limits(self):
        self.assertEqual(self.post(method="m" * 40)[0], 201)
        self.assertEqual(self.post(note="n" * 140)[0], 201)
        self.bad(self.post(method="m" * 41))
        self.bad(self.post(note="n" * 141))
        # whitespace collapsed before measuring
        self.assertEqual(self.post(method="  " + "m" * 40 + "   ")[0], 201)

    def test_wrong_types(self):
        for k, v in [("a", True), ("a", [1]), ("a", {"id": 1}), ("a", 1.5), ("a", None), ("a", -3),
                     ("b", "x"), ("method", 5), ("method", ["x"]), ("note", {"x": 1}), ("note", True),
                     ("date", ["2024-01-01"])]:
            self.bad(self.post(**{k: v}))

    def test_non_object_bodies(self):
        for raw in ["", "null", "[]", '"x"', "1", "false", "{nope"]:
            self.bad(call("POST", "/rolls", raw=raw))

    def test_by_field(self):
        pal = paloma()
        # logged by a normal player is kept
        s, d, _, _ = self.post(by=self.c["id"])
        self.assertEqual(d["roll"]["by"], self.c["id"])
        # unknown player id is dropped
        self.assertIsNone(self.post(by=999999999)[1]["roll"]["by"])
        # Paloma without / with wrong admin header -> dropped
        self.assertIsNone(self.post(by=pal["id"])[1]["roll"]["by"])
        s, d, _, _ = call("POST", "/rolls", {"a": self.a["id"], "b": self.b["id"], "date": today(), "by": pal["id"]}, WRONG)
        self.assertIsNone(d["roll"]["by"])
        # with admin header it is kept
        s, d, _, _ = call("POST", "/rolls", {"a": self.a["id"], "b": self.b["id"], "date": today(), "by": pal["id"]}, ADMIN)
        self.assertEqual(d["roll"]["by"], pal["id"])
        # by null / "" -> null; garbage -> 400
        self.assertIsNone(self.post(by=None)[1]["roll"]["by"])
        self.assertIsNone(self.post(by="")[1]["roll"]["by"])
        self.bad(self.post(by="abc"))
        self.bad(self.post(by=0))


# ---------------------------------------------------------------- admin roll PATCH / DELETE
class RollAdminTests(Base):
    def setUp(self):
        self.a, self.b, self.c = self.mk("A"), self.mk("B"), self.mk("C")
        self.r = self.mkroll(self.a["id"], self.b["id"], self.a["id"], method="Choke", note="hi", date="2024-05-05")

    def test_patch_auth(self):
        path = f"/rolls/{self.r['id']}"
        self.err(call("PATCH", path, {"winner": None}), 401)
        self.err(call("PATCH", path, {"winner": None}, WRONG), 401)
        self.err(call("PATCH", path, {"winner": None}, {"X-Admin-Password": ""}), 401)
        self.assertEqual(roll_by_id(self.r["id"])["winner"], self.a["id"])
        s, d, t, _ = call("PATCH", path, {"winner": None}, ADMIN)
        self.assertEqual(s, 200, t)
        self.assertIsNone(d["roll"]["winner"])
        # untouched fields kept
        self.assertEqual((d["roll"]["method"], d["roll"]["note"], d["roll"]["date"]), ("Choke", "hi", "2024-05-05"))

    def test_patch_merge_and_validate(self):
        path = f"/rolls/{self.r['id']}"
        s, d, t, _ = call("PATCH", path, {"b": self.c["id"]}, ADMIN)  # winner a still valid
        self.assertEqual(s, 200, t)
        self.assertEqual(d["roll"]["b"], self.c["id"])
        self.bad(call("PATCH", path, {"a": self.b["id"], "b": self.c["id"]}, ADMIN))  # old winner a not in roll
        self.bad(call("PATCH", path, {"b": self.a["id"]}, ADMIN))  # self roll
        self.bad(call("PATCH", path, {"date": "2999-01-01"}, ADMIN))
        self.bad(call("PATCH", path, {"method": "x" * 41}, ADMIN))
        self.bad(call("PATCH", path, raw="[]", headers=ADMIN))
        self.err(call("PATCH", path, {"b": 999999999, "winner": None}, ADMIN), 404)
        self.err(call("PATCH", "/rolls/999999999", {"winner": None}, ADMIN), 404)
        self.bad(call("PATCH", "/rolls/abc", {"winner": None}, ADMIN))
        s, d, t, _ = call("PATCH", path, {}, ADMIN)  # no-op
        self.assertEqual(s, 200, t)

    def test_delete_auth(self):
        path = f"/rolls/{self.r['id']}"
        self.err(call("DELETE", path), 401)
        self.err(call("DELETE", path, headers=WRONG), 401)
        self.assertIsNotNone(roll_by_id(self.r["id"]))
        s, d, t, _ = call("DELETE", path, headers=ADMIN)
        self.assertEqual((s, d), (200, {"ok": True}), t)
        self.assertIsNone(roll_by_id(self.r["id"]))
        self.err(call("DELETE", path, headers=ADMIN), 404)


# ---------------------------------------------------------------- routing
class RoutingTests(Base):
    def test_unknown_routes_404(self):
        for m, p in [("GET", ""), ("GET", "/"), ("GET", "/nope"), ("GET", "/state/1"), ("GET", "/state/1/2"),
                     ("GET", "/players"), ("GET", "/rolls"), ("GET", "/admin"), ("GET", "/admin/login"),
                     ("POST", "/admin/logout"), ("GET", "/players/1/extra"), ("POST", "/state"),
                     ("PUT", "/players"), ("DELETE", "/state"), ("PUT", "/state"), ("PATCH", "/players"),
                     ("DELETE", "/rolls"), ("PATCH", "/state"), ("GET", "/players/1"),
                     ("POST", "/players/1"), ("PUT", "/players/1")]:
            with self.subTest(m=m, p=p):
                self.err(call(m, p, {} if m in ("POST", "PUT", "PATCH") else None), 404)

    def test_wrong_method_on_roll_id_admin(self):
        a, b = self.mk(), self.mk()
        r = self.mkroll(a["id"], b["id"])
        self.err(call("GET", f"/rolls/{r['id']}", headers=ADMIN), 404)
        self.err(call("PUT", f"/rolls/{r['id']}", {}, ADMIN), 404)

    def test_never_500(self):
        cases = [("GET", "/players/99999999999999999999999"), ("PATCH", "/players/99999999999999999999999"),
                 ("DELETE", "/rolls/99999999999999999999999"), ("POST", "/rolls"), ("POST", "/players")]
        bodies = [None, {"a": 1e300, "b": 2, "date": today()}, {"name": "x" * 10000},
                  {"a": 9007199254740993, "b": 1, "date": today()}, {"stripes": 1e309}]
        for m, p in cases:
            for bd in bodies:
                with self.subTest(m=m, p=p, b=bd):
                    self.no500(call(m, p, bd, ADMIN))
        self.no500(call("POST", "/players", raw=b"\xff\xfe{"))
        self.no500(call("POST", "/rolls", raw=b'{"a":' + b"[" * 5000 + b"]" * 5000 + b"}"))


# ---------------------------------------------------------------- regression tests for bugs found and fixed
class RegressionTests(Base):
    def test_future_date_two_days_ahead_rejected(self):
        # Latest legit "today" anywhere is the date at UTC+14. The day after must be rejected.
        latest = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=14)).date()
        a, b = self.mk(), self.mk()
        nxt = (latest + datetime.timedelta(days=1)).isoformat()
        self.bad(call("POST", "/rolls", {"a": a["id"], "b": b["id"], "date": nxt}))

    def test_invisible_chars_cannot_impersonate_admin(self):
        for n in ["Paloma​", "‍Paloma", "Pal­oma", "Paloma⁠", "‮Paloma"]:
            with self.subTest(n=ascii(n)):
                s, d, t, _ = call("POST", "/players", {"name": n})
                if s == 201:
                    CREATED.append(d["player"]["id"])
                self.assertNotEqual(s, 201, f"{ascii(n)} accepted as a separate player that renders as 'Paloma'")

    def test_c1_and_bidi_controls_stripped(self):
        n = uname()
        s, d, t, _ = call("POST", "/players", {"name": n[:6] + "\u0085‮" + n[6:]})
        if s == 201:
            CREATED.append(d["player"]["id"])
            self.assertNotRegex(d["player"]["name"], "[\u0080-\u009f‪-‮⁦-⁩]")

    def test_stripes_rejects_non_numbers(self):
        for st in [True, [3], " ", "0x3", "1e0", False, []]:
            with self.subTest(st=st):
                s, d, t, _ = call("POST", "/players", {"name": uname(), "stripes": st})
                if s == 201:
                    CREATED.append(d["player"]["id"])
                self.assertEqual(s, 400, f"stripes={st!r} accepted -> {t}")


def tearDownModule():
    for pid in CREATED:
        call("DELETE", f"/players/{pid}", headers=ADMIN)
    # sweep anything else with our prefix (e.g. created by an assertion path that didn't record it)
    for p in state()["players"]:
        if p["name"].startswith(PREFIX) or p["name"].upper().startswith(PREFIX.upper()):
            call("DELETE", f"/players/{p['id']}", headers=ADMIN)


if __name__ == "__main__":
    unittest.main(verbosity=2)
