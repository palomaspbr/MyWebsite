"""End-to-end UI test for Chacrinha Jiu-Jitsu (jiujitsu/).

Drives the real UI with Playwright (sync API) against a running dev server,
using separate browser contexts to simulate different friends (and devices).

    python -I tests/jiujitsu/test_e2e.py          # standalone
    python -m pytest tests/jiujitsu/test_e2e.py    # or via pytest

Env vars:
    JJ_BASE      app URL            (default http://localhost:8788/jiujitsu/)
    JJ_ADMIN_PW  admin password     (default test-admin-pw)
    JJ_SHOTS     screenshot folder  (default: <temp dir>/jj-shots)
    JJ_D1_SQLITE path of the local D1 .sqlite file (optional). When set (or found
                 under .wrangler/state), the test inserts a password-less "legacy"
                 profile to cover the first-login "choose a password" flow.
    JJ_HEADED=1  show the browser

The database may be shared with other runs, so the test only creates players
with unique random names, only asserts on its own players, and deletes them at
the end (admin API) even if a step fails.
"""

import collections
import glob
import io
import os
import re
import secrets
import sqlite3
import sys
import tempfile
import time

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("JJ_BASE", "http://localhost:8788/jiujitsu/")
API = BASE.rstrip("/") + "/api"
ADMIN_PW = os.environ.get("JJ_ADMIN_PW", "test-admin-pw")
SHOTS = os.environ.get("JJ_SHOTS", os.path.join(tempfile.gettempdir(), "jj-shots"))
HEADED = os.environ.get("JJ_HEADED") == "1"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DESKTOP = {"viewport": {"width": 1280, "height": 900}}
PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}

RUN = secrets.token_hex(3)  # 6 hex chars, unique per run
OWN = set()  # ids of the players this run created

expect.set_options(timeout=10_000)

# Counts AudioContext constructions and records which sounds were played.
INIT_SCRIPT = """
(() => {
  window.__ac = 0;
  window.__sounds = [];
  const Real = window.AudioContext;
  if (Real) {
    window.AudioContext = class extends Real { constructor(...a) { super(...a); window.__ac++; } };
  }
  let snd;
  Object.defineProperty(window, 'JJSound', {
    configurable: true,
    get() { return snd; },
    set(v) {
      const play = v.play.bind(v);
      v.play = (name) => { window.__sounds.push(name); return play(name); };
      snd = v;
    },
  });
})();
"""

# Reads the average color of an <img> (same-origin, so the canvas is not tainted).
IMG_COLOR = """(img) => {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
  const d = x.getImageData(2, 2, 4, 4).data; const s = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
  return s.map(v => Math.round(v / 16));
}"""


class Problems:
    """Soft-assertion collector: real bugs are recorded and the test fails at the end."""

    def __init__(self):
        self.items = []

    def check(self, cond, msg):
        if not cond:
            self.items.append(msg)
            print("  !! " + msg)
        return cond


PROBLEMS = Problems()


class Friend:
    """One browser context = one friend's phone/laptop."""

    def __init__(self, browser, label, size):
        self.label = label
        self.size = size
        opts = DESKTOP if size == "desktop" else PHONE
        self.ctx = browser.new_context(**opts)
        self.ctx.add_init_script(INIT_SCRIPT)
        self.page = self.ctx.new_page()
        self.console_errors = []
        self.page_errors = []
        self.failed = []
        self.bad_status = []
        self.dialogs = []
        self.allowed = collections.Counter()  # status -> deliberate error responses still expected
        self.allowed_seen = collections.Counter()
        p = self.page
        p.on("console", lambda m: m.type == "error" and self.console_errors.append(m.text))
        p.on("pageerror", lambda e: self.page_errors.append(str(e)))
        p.on("requestfailed", self._on_failed)
        p.on("response", self._on_response)
        p.on("dialog", self._on_dialog)

    def allow(self, status, n=1):
        """The next n responses with this status are deliberate (wrong password etc.)."""
        self.allowed[status] += n

    def _on_failed(self, req):
        err = req.failure or ""
        if "ERR_ABORTED" in err:  # navigations/reloads abort in-flight fetches
            return
        self.failed.append(f"{req.method} {req.url}: {err}")

    def _on_response(self, res):
        if res.status >= 400:
            m = re.search(r"/players/(\d+)/photo", res.url)
            if res.status == 404 and m and int(m.group(1)) not in OWN:
                # Another test run deleted its player/photo after our page drew it.
                print(f"  (ignored foreign photo 404: {res.url})")
                self.allowed_seen[404] += 1
                return
            if self.allowed[res.status] > 0:
                self.allowed[res.status] -= 1
                self.allowed_seen[res.status] += 1
                return
            self.bad_status.append(f"{res.request.method} {res.url} -> {res.status}")

    def _on_dialog(self, d):
        self.dialogs.append(f"{d.type}: {d.message}")
        d.dismiss()

    # ---- navigation ----
    def open(self):
        self.page.goto(BASE)
        self.ready()

    def reload(self):
        self.page.reload()
        self.ready()

    def ready(self):
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#welcome, #board-wrap").locator("visible=true")).to_have_count(1)

    def token(self):
        return self.page.evaluate("localStorage.getItem('jj.token')")

    def me_id(self):
        li = self.page.locator("#board li.me")
        return int(li.get_attribute("data-id")) if li.count() else None

    def shot(self, name, full=False):
        path = os.path.join(SHOTS, f"{self.size}_{name}.png")
        self.page.wait_for_timeout(500)  # entry / dialog animations
        self.page.screenshot(path=path, full_page=full)
        return path

    def check_no_hscroll(self, where):
        info = self.page.evaluate(
            """() => {
              const vw = document.documentElement.clientWidth;
              const off = [];
              for (const el of document.querySelectorAll('body *')) {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) continue;
                if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
                if (el.classList.contains('confetti') || el.closest('#toast')) continue;
                if (el.closest('.file-btn') && el.tagName === 'INPUT') continue;
                if (r.right > vw + 1 || r.left < -1) {
                  off.push(`${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
                }
              }
              return { sw: document.documentElement.scrollWidth, vw, off: off.slice(0, 8) };
            }"""
        )
        PROBLEMS.check(
            info["sw"] <= info["vw"] and not info["off"],
            f"[{self.label}/{self.size}] horizontal overflow on {where}: scrollWidth={info['sw']} "
            f"vw={info['vw']} offenders={info['off']}",
        )

    def toast(self, text):
        expect(self.page.locator("#toast")).to_contain_text(text)

    def close(self):
        self.ctx.close()


# ---------------------------------------------------------------- helpers

def api_state(request, token=None):
    r = request.get(API + "/state", headers={"authorization": f"Bearer {token}"} if token else {})
    assert r.ok, r.status
    return r.json()


def api_player(request, pid):
    return next((x for x in api_state(request)["players"] if x["id"] == pid), None)


def signup(f, name, belt, pw):
    p = f.page
    expect(p.locator("#welcome")).to_be_visible()
    p.fill("#signup-name", name)
    p.click(f'.belt-picker[data-for=signup] [data-v="{belt}"]')
    p.fill("#signup-pw", pw)
    p.fill("#signup-pw2", pw)
    p.click("#signup-form button[type=submit]")
    expect(p.locator("#board-wrap")).to_be_visible()
    expect(p.locator("#me-chip .who")).to_have_text(name)
    assert f.token(), "signup did not store jj.token"
    expect(p.locator("#board li.me")).to_have_count(1)
    return f.me_id()


def open_login(f, pid, name):
    p = f.page
    expect(p.locator("#welcome")).to_be_visible()
    p.fill("#who-search", name)
    p.click(f'#who-list .who-btn[data-id="{pid}"]')
    expect(p.locator("#login-dlg")).to_have_attribute("open", "")
    expect(p.locator("#login-pw")).to_be_focused()


def login(f, pid, name, pw):
    p = f.page
    open_login(f, pid, name)
    p.fill("#login-pw", pw)
    p.click("#login-submit")
    expect(p.locator("#login-dlg")).not_to_have_attribute("open", "")
    expect(p.locator("#board-wrap")).to_be_visible()
    expect(p.locator("#me-chip .who")).to_have_text(name)


def logout(f):
    p = f.page
    p.click("#me-chip [data-act=logout]")
    expect(p.locator("#welcome")).to_be_visible()
    expect(p.locator("#me-chip")).to_be_hidden()
    PROBLEMS.check(f.token() is None, f"[{f.label}] log out did not clear jj.token")


def feed_item(p, roll_id):
    """Locate a feed entry, paging through 'Show more' if other runs pushed it down."""
    li = p.locator(f'#feed li[data-id="{roll_id}"]')
    for _ in range(20):
        if li.count():
            return li
        more = p.locator("#more-btn")
        if not more.is_visible():
            break
        more.click()
    expect(li).to_have_count(1)
    return li


def find_roll(request, note):
    rolls = [r for r in api_state(request)["rolls"] if r["note"] == note]
    assert len(rolls) == 1, f"expected exactly one roll with note {note!r}, got {rolls}"
    return rolls[0]


def log_roll(f, opp_id, result, method, note, a_id=None, shot=None):
    """result: 'a' (A won), 'b' (B won), 'draw'. a_id is only for the admin."""
    p = f.page
    p.click("#log-btn")
    expect(p.locator("#roll-dlg")).to_have_attribute("open", "")
    expect(p.locator("#roll-title")).to_have_text("Log a roll")
    if a_id is None:
        expect(p.locator("#roll-a")).to_be_disabled()
        expect(p.locator("#roll-submit")).to_have_text("Send for confirmation")
    else:
        expect(p.locator("#roll-a")).to_be_enabled()
        expect(p.locator("#roll-submit")).to_have_text("Save roll")
        p.select_option("#roll-a", value=str(a_id))
    p.select_option("#roll-b", value=str(opp_id))
    p.click(f'#roll-dlg .result-pick label:has(input[value="{result}"])')
    if method:
        p.fill("#roll-method", method)
    p.fill("#roll-note", note)
    if shot:
        f.check_no_hscroll("log-roll dialog")
        f.shot(shot)
    p.click("#roll-submit")
    expect(p.locator("#roll-dlg")).not_to_have_attribute("open", "")


def pending_li(p, rid):
    return p.locator(f'#pending li[data-id="{rid}"]')


class Model:
    """Expected leaderboard numbers for the players this test owns (confirmed rolls only)."""

    def __init__(self):
        self.players = {}  # id -> name
        self.rolls = {}  # id -> (a, b, winner)

    def stats(self, pid):
        pts = w = d = l = 0
        for a, b, win in self.rolls.values():
            if pid not in (a, b):
                continue
            if win is None:
                d += 1
                pts += 1
            elif win == pid:
                w += 1
                pts += 3
            else:
                l += 1
        return pts, w, d, l


def check_board(f, model, where):
    p = f.page
    for pid, name in model.players.items():
        pts, w, d, l = model.stats(pid)
        li = p.locator(f'#board li[data-id="{pid}"]')
        expect(li.locator(".pts b"), f"{where}: points of {name}").to_have_text(str(pts))
        expect(li.locator(".meta"), f"{where}: record of {name}").to_contain_text(f"{w}W {d}D {l}L")
        if w + d + l == 0:
            expect(li.locator(".rank"), f"{where}: rank of {name} (no rolls)").to_have_text("–")
    pts_seq = p.evaluate("[...document.querySelectorAll('#board li .pts b')].map(b => Number(b.textContent))")
    PROBLEMS.check(pts_seq == sorted(pts_seq, reverse=True), f"{where}: board not sorted by points: {pts_seq}")


def wait_img(p, sel):
    """Wait until the <img> at sel has loaded; return its natural size."""
    p.wait_for_function(
        "(s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }", arg=sel
    )
    return p.evaluate("(s) => { const i = document.querySelector(s); return [i.naturalWidth, i.naturalHeight]; }", sel)


def img_color(p, sel):
    wait_img(p, sel)
    return p.locator(sel).evaluate(IMG_COLOR)


def is_color(rgb, name):
    r, g, b = rgb
    return {
        "green": g > r + 60 and g > b + 60,
        "red": r > g + 60 and r > b + 60,
        "blue": b > r + 60 and b > g + 30,
        "orange": r > b + 80 and g > b + 20,
    }[name]


def make_images(tmp):
    """Test pictures: a big non-square JPEG (green center, red sides), a portrait PNG,
    a blue PNG, and a text file pretending to be a JPEG."""
    paths = {}
    # 4000x2400 landscape, noisy so the file is a few MB. Center square is green.
    w, h = 4000, 2400
    im = Image.new("RGB", (w, h), (200, 40, 40))
    ImageDraw.Draw(im).rectangle([(w - h) // 2, 0, (w + h) // 2, h], fill=(40, 170, 70))
    noise = Image.effect_noise((w, h), 60).convert("RGB")
    im = Image.blend(im, noise, 0.12)
    paths["big"] = os.path.join(tmp, "big-landscape.jpg")
    im.save(paths["big"], "JPEG", quality=95)
    # Portrait PNG: warm sunset with a "face" circle in the middle.
    im = Image.new("RGB", (900, 1400), (240, 150, 60))
    d = ImageDraw.Draw(im)
    for y in range(1400):
        d.line([(0, y), (900, y)], fill=(240, 150 - y // 20, 60 + y // 12))
    d.ellipse([250, 450, 650, 950], fill=(250, 210, 160), outline=(60, 40, 30), width=12)
    paths["portrait"] = os.path.join(tmp, "portrait.png")
    im.save(paths["portrait"], "PNG")
    # Small blue square PNG.
    im = Image.new("RGB", (300, 300), (40, 80, 200))
    ImageDraw.Draw(im).ellipse([90, 90, 210, 210], fill=(50, 90, 220), outline=(255, 255, 255), width=8)
    paths["blue"] = os.path.join(tmp, "blue.png")
    im.save(paths["blue"], "PNG")
    paths["fake"] = os.path.join(tmp, "not-an-image.jpg")
    with open(paths["fake"], "w") as fh:
        fh.write("this is not a picture")
    return paths


def find_d1_sqlite():
    path = os.environ.get("JJ_D1_SQLITE")
    if path:
        return path if os.path.exists(path) else None
    hits = glob.glob(os.path.join(REPO, ".wrangler", "state", "v3", "d1", "*", "*.sqlite"))
    hits = [h for h in hits if not h.endswith("metadata.sqlite")]
    return hits[0] if len(hits) == 1 else None


def insert_legacy_player(name):
    """Profiles created before passwords existed have pw_hash NULL. The API cannot create
    one any more, so write it straight into the local D1 file."""
    path = find_d1_sqlite()
    if not path:
        return None
    con = sqlite3.connect(path, timeout=10)
    try:
        cur = con.execute("INSERT INTO players (name, belt) VALUES (?, 'brown')", (name,))
        con.commit()
        return cur.lastrowid
    finally:
        con.close()


def check_clean(friends):
    for f in friends:
        # Chrome logs one console error per failed fetch; drop those for deliberate errors.
        seen = collections.Counter(f.allowed_seen)
        errs = []
        for e in f.console_errors:
            m = re.search(r"status of (\d+)", e)
            if m and seen[int(m.group(1))] > 0:
                seen[int(m.group(1))] -= 1
                continue
            errs.append(e)
        PROBLEMS.check(not f.page_errors, f"[{f.label}] page errors: {f.page_errors}")
        PROBLEMS.check(not errs, f"[{f.label}] console errors: {errs}")
        PROBLEMS.check(not f.failed, f"[{f.label}] failed requests: {f.failed}")
        PROBLEMS.check(not f.bad_status, f"[{f.label}] HTTP errors: {f.bad_status}")
        PROBLEMS.check(not f.dialogs, f"[{f.label}] unexpected JS dialogs (XSS?): {f.dialogs}")


# ---------------------------------------------------------------- the test

def run(pw):
    os.makedirs(SHOTS, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="jj-e2e-")
    imgs = make_images(tmp)
    browser = pw.chromium.launch(headless=not HEADED)
    request = pw.request.new_context()
    model = Model()
    friends = []
    created = []
    OWN.clear()

    def friend(label, size):
        f = Friend(browser, label, size)
        friends.append(f)
        return f

    names = {
        "ana": f"Ana {RUN}",
        "bia": f"Bia {RUN}",
        "caio": f"Caio {RUN}",
        "leo": f"Leo {RUN}",
        "dan": f"Dan {RUN}",
    }
    pws = {"ana": "ana-pass-1", "bia": "bia-pass-1", "caio": "caio-pass-1"}
    paloma = next(x["id"] for x in api_state(request)["players"] if x["name"].lower() == "paloma")
    try:
        # ---- welcome --------------------------------------------------------
        print("welcome")
        ana = friend("Ana", "desktop")
        ana.open()
        p = ana.page
        expect(p.locator(f'#who-list .who-btn[data-id="{paloma}"]')).to_be_visible()
        PROBLEMS.check(
            p.evaluate("document.fonts.check('20px \"Caveat Brush\"') && document.fonts.check('20px \"Patrick Hand\"')"),
            "hand-drawn fonts not loaded",
        )
        # Sound toggle persists; with sound off no AudioContext is created.
        sb = p.locator("#sound-btn")
        sb.click()
        expect(sb).to_have_attribute("aria-pressed", "false")
        ana.reload()
        expect(sb).to_have_attribute("aria-pressed", "false")
        p.click('.belt-picker[data-for=signup] [data-v="purple"]')
        PROBLEMS.check(p.evaluate("window.__ac") == 0, "AudioContext created while sound is off")
        sb.click()
        expect(sb).to_have_attribute("aria-pressed", "true")

        # ---- signup validation + keyboard belt picker -----------------------
        print("signup errors")
        p.fill("#signup-name", names["ana"])
        p.fill("#signup-pw", "abc")
        p.fill("#signup-pw2", "abc")
        p.click("#signup-form button[type=submit]")
        expect(p.locator("#signup-err")).to_contain_text("at least 4 characters")
        p.fill("#signup-pw", "ana-pass-1")
        p.fill("#signup-pw2", "ana-pass-X")
        p.click("#signup-form button[type=submit]")
        expect(p.locator("#signup-err")).to_have_text("The two passwords don't match.")
        expect(p.locator("#welcome")).to_be_visible()
        PROBLEMS.check(not any(x["name"] == names["ana"] for x in api_state(request)["players"]),
                       "signup with bad password still created the player")
        # Arrow keys move the belt choice (roving tabindex).
        p.locator('.belt-picker[data-for=signup] [aria-checked="true"]').focus()
        p.keyboard.press("ArrowLeft")
        p.keyboard.press("ArrowLeft")
        expect(p.locator(".belt-picker[data-for=signup]")).to_have_attribute("data-value", "white")
        p.keyboard.press("ArrowRight")
        expect(p.locator(".belt-picker[data-for=signup]")).to_have_attribute("data-value", "blue")
        expect(p.locator('.belt-picker[data-for=signup] [data-v="blue"]')).to_be_focused()
        ana.check_no_hscroll("welcome")

        a = signup(ana, names["ana"], "blue", pws["ana"])
        model.players[a] = names["ana"]
        created.append(a)
        OWN.add(a)
        ana.toast("Welcome to the mat")
        expect(p.locator("#me-chip .avatar.letter")).to_have_text("A")

        bia = friend("Bia", "phone")
        bia.open()
        bia.check_no_hscroll("welcome")
        b = signup(bia, names["bia"], "white", pws["bia"])
        model.players[b] = names["bia"]
        created.append(b)
        OWN.add(b)

        caio = friend("Caio", "desktop")
        caio.open()
        c = signup(caio, names["caio"], "purple", pws["caio"])
        model.players[c] = names["caio"]
        created.append(c)
        OWN.add(c)
        check_board(caio, model, "after signups")

        # ---- logout / login -------------------------------------------------
        print("logout + login")
        p = caio.page
        old_token = caio.token()
        logout(caio)
        PROBLEMS.check(api_state(request, old_token)["me"] is None, "logout did not end the session on the server")
        # Signing up with an existing name (other case) opens that player's login.
        p.fill("#signup-name", names["caio"].upper())
        p.click("#signup-form button[type=submit]")
        expect(p.locator("#login-dlg")).to_have_attribute("open", "")
        expect(p.locator("#login-title")).to_have_text(f"Hi, {names['caio']}!")
        p.keyboard.press("Escape")
        expect(p.locator("#login-dlg")).not_to_have_attribute("open", "")
        p.fill("#signup-name", "")
        # Keyboard-only login: focus the name, Enter, type, Enter. Wrong password first.
        p.fill("#who-search", names["caio"])
        p.locator(f'#who-list .who-btn[data-id="{c}"]').focus()
        p.keyboard.press("Enter")
        expect(p.locator("#login-dlg")).to_have_attribute("open", "")
        expect(p.locator("#login-pw")).to_be_focused()
        expect(p.locator("#login-pw2-wrap")).to_be_hidden()
        p.keyboard.press("Enter")
        expect(p.locator("#login-err")).to_have_text("Type your password.")
        caio.allow(401)
        p.keyboard.type("wrong-password")
        p.keyboard.press("Enter")
        expect(p.locator("#login-err")).to_have_text("Wrong password.")
        expect(p.locator("#login-dlg")).to_have_attribute("open", "")
        PROBLEMS.check(caio.token() is None, "wrong password still stored a token")
        caio.check_no_hscroll("login dialog")
        caio.shot("dlg_login")
        p.fill("#login-pw", pws["caio"])
        p.keyboard.press("Enter")
        expect(p.locator("#login-dlg")).not_to_have_attribute("open", "")
        expect(p.locator("#me-chip .who")).to_have_text(names["caio"])
        caio.toast(f"Oss, {names['caio']}!")
        caio.reload()
        expect(p.locator("#me-chip .who")).to_have_text(names["caio"])

        # Bia on the phone: log out and back in (phone login screenshot).
        logout(bia)
        open_login(bia, b, names["bia"])
        bia.check_no_hscroll("login dialog")
        bia.shot("dlg_login")
        bia.page.fill("#login-pw", pws["bia"])
        bia.page.click("#login-submit")
        expect(bia.page.locator("#me-chip .who")).to_have_text(names["bia"])

        # ---- pending roll -> other player accepts ----------------------------
        print("pending roll, accept")
        n = {k: f"e2e {RUN} {k}" for k in ("r1", "r2", "r3", "r4", "r5", "r6", "r7", "dead")}
        ana.reload()
        log_roll(ana, b, "a", "Armbar", n["r1"], shot="dlg_log_roll")
        ana.toast(f"Sent! It counts once {names['bia']} accepts.")
        r1 = find_roll(request, n["r1"])
        PROBLEMS.check(r1["status"] == "pending" and r1["by"] == a, f"new roll should be pending: {r1}")
        p = ana.page
        li = pending_li(p, r1["id"])
        expect(p.locator("#pending-card")).to_be_visible()
        expect(li).to_contain_text(f"Waiting for {names['bia']} to confirm")
        expect(li.locator("[data-act=accept]")).to_have_count(0)
        expect(li.locator("[data-act=reject]")).to_have_text("Cancel")
        expect(p.locator(f'#feed li[data-id="{r1["id"]}"]')).to_have_count(0)
        check_board(ana, model, "pending roll does not count")
        ana.check_no_hscroll("pending card")
        ana.page.locator("#pending-card").scroll_into_view_if_needed()
        ana.shot("pending_card")

        bia.reload()
        p = bia.page
        li = pending_li(p, r1["id"])
        expect(li).to_contain_text(f"{names['ana']} says:")
        expect(li).to_contain_text(f"{names['ana']} beat {names['bia']}")
        expect(li.locator("[data-act=accept]")).to_be_visible()
        expect(li.locator("[data-act=reject]")).to_have_text("Reject")
        check_board(bia, model, "Bia sees pending roll not counted")
        bia.check_no_hscroll("pending card")
        bia.shot("pending_card")
        li.locator("[data-act=accept]").click()
        bia.toast("Tapping is learning")
        model.rolls[r1["id"]] = (a, b, a)
        expect(pending_li(p, r1["id"])).to_have_count(0)
        expect(feed_item(p, r1["id"])).to_contain_text(f"{names['ana']} beat {names['bia']}")
        check_board(bia, model, "after Bia accepts r1")
        ana.reload()
        check_board(ana, model, "Ana sees r1 accepted")
        expect(ana.page.locator("#pending-card")).to_be_hidden()

        # ---- reject flow ----------------------------------------------------
        print("reject")
        log_roll(caio, a, "draw", "", n["r2"])
        r2 = find_roll(request, n["r2"])
        ana.reload()
        p = ana.page
        pending_li(p, r2["id"]).locator("[data-act=reject]").click()
        expect(p.locator("#confirm-dlg")).to_have_attribute("open", "")
        expect(p.locator("#confirm-title")).to_have_text("Reject this roll?")
        p.click('#confirm-dlg button[value="no"]')
        expect(pending_li(p, r2["id"])).to_have_count(1)
        pending_li(p, r2["id"]).locator("[data-act=reject]").click()
        p.click("#confirm-yes")
        ana.toast("Roll rejected.")
        expect(pending_li(p, r2["id"])).to_have_count(0)
        caio.reload()
        expect(pending_li(caio.page, r2["id"])).to_have_count(0)
        PROBLEMS.check(not [r for r in api_state(request)["rolls"] if r["id"] == r2["id"]], "rejected roll still in DB")

        # ---- cancel flow (the logger takes it back) ---------------------------
        print("cancel")
        log_roll(bia, c, "b", "Triangle", n["r3"])
        r3 = find_roll(request, n["r3"])
        p = bia.page
        pending_li(p, r3["id"]).locator("[data-act=reject]").click()
        expect(p.locator("#confirm-title")).to_have_text("Cancel this roll?")
        p.click("#confirm-yes")
        bia.toast("Roll cancelled.")
        expect(pending_li(p, r3["id"])).to_have_count(0)
        expect(p.locator("#pending-card")).to_be_hidden()

        # ---- admin: wrong then right password, accepts someone else's roll ----
        print("admin")
        log_roll(caio, b, "a", "Kimura", n["r4"])
        r4 = find_roll(request, n["r4"])
        adm = friend("Admin", "desktop")
        adm.open()
        p = adm.page
        open_login(adm, paloma, "Paloma")
        expect(p.locator("#login-hint")).to_have_text("Admin profile: use the admin password.")
        adm.allow(401)
        p.fill("#login-pw", "definitely-wrong")
        p.click("#login-submit")
        expect(p.locator("#login-err")).to_have_text("Wrong password.")
        p.fill("#login-pw", ADMIN_PW)
        p.click("#login-submit")
        expect(p.locator("#login-dlg")).not_to_have_attribute("open", "")
        expect(p.locator("#me-chip .who")).to_have_text("Paloma")
        expect(p.locator("#admin-tag")).to_be_visible()
        adm.toast("Admin mode on")
        li = pending_li(p, r4["id"])
        expect(li).to_contain_text(f"{names['caio']} says:")
        li.locator("[data-act=accept]").click()
        adm.toast("Roll confirmed.")
        model.rolls[r4["id"]] = (c, b, c)
        expect(pending_li(p, r4["id"])).to_have_count(0)
        check_board(adm, model, "after admin accepts r4")

        # Admin-logged rolls count immediately.
        log_roll(adm, c, "a", "Guillotine", n["r5"], a_id=a)
        adm.toast("Roll logged.")
        r5 = find_roll(request, n["r5"])
        PROBLEMS.check(r5["status"] == "confirmed", f"admin roll should be confirmed: {r5}")
        model.rolls[r5["id"]] = (a, c, a)
        expect(pending_li(p, r5["id"])).to_have_count(0)
        check_board(adm, model, "after admin logs r5")

        # Admin edits r5 (Ana beat Caio -> Caio beat Ana).
        print("admin edit/delete roll")
        feed_item(p, r5["id"]).locator("[data-act=edit-roll]").click()
        expect(p.locator("#roll-title")).to_have_text("Fix this roll")
        expect(p.locator("#roll-a")).to_have_value(str(a))
        expect(p.locator("#roll-b")).to_have_value(str(c))
        expect(p.locator('#roll-dlg input[name=result][value="a"]')).to_be_checked()
        expect(p.locator("#roll-method")).to_have_value("Guillotine")
        p.click('#roll-dlg .result-pick label:has(input[value="b"])')
        p.click("#roll-submit")
        adm.toast("Roll fixed.")
        model.rolls[r5["id"]] = (a, c, c)
        expect(feed_item(p, r5["id"])).to_contain_text(f"{names['caio']} beat {names['ana']}")
        check_board(adm, model, "after admin edit")
        # Admin deletes r1 ("Nope" first keeps it).
        feed_item(p, r1["id"]).locator("[data-act=del-roll]").click()
        expect(p.locator("#confirm-text")).to_contain_text(f"{names['ana']} beat {names['bia']}")
        p.click('#confirm-dlg button[value="no"]')
        expect(p.locator(f'#feed li[data-id="{r1["id"]}"]')).to_have_count(1)
        feed_item(p, r1["id"]).locator("[data-act=del-roll]").click()
        p.click("#confirm-yes")
        adm.toast("Roll erased.")
        expect(p.locator(f'#feed li[data-id="{r1["id"]}"]')).to_have_count(0)
        del model.rolls[r1["id"]]
        check_board(adm, model, "after admin delete")
        expect(ana.page.locator("#feed [data-act]")).to_have_count(0)  # no admin tools for others
        adm.check_no_hscroll("admin board")

        # ---- keyboard on the board ------------------------------------------
        print("keyboard")
        ana.reload()
        p = ana.page
        check_board(ana, model, "Ana after admin changes")
        row = p.locator(f'#board li[data-id="{c}"]')
        row.focus()
        p.keyboard.press("Enter")
        expect(p.locator("#player-dlg")).to_have_attribute("open", "")
        expect(p.locator("#player-body h2")).to_have_text(names["caio"])
        stats = p.locator("#player-body .statgrid .stat b").all_text_contents()
        PROBLEMS.check(stats == [str(x) for x in model.stats(c)], f"Caio profile stats {stats} != {model.stats(c)}")
        expect(p.locator("#player-body")).to_contain_text(f"You vs {names['caio']}: 0W 0D 1L")
        expect(p.locator("#player-body [data-act]")).to_have_count(0)  # no edit/delete on others
        p.keyboard.press("Escape")
        expect(p.locator("#player-dlg")).not_to_have_attribute("open", "")
        row.focus()
        p.keyboard.press("Space")
        expect(p.locator("#player-dlg")).to_have_attribute("open", "")
        p.click("#player-dlg [data-close]")
        p.focus("#log-btn")
        reached = False
        for _ in range(60):
            p.keyboard.press("Tab")
            if p.evaluate("document.activeElement.matches('#board li[data-id]')"):
                reached = True
                break
        PROBLEMS.check(reached, "board rows not reachable with Tab")

        # ---- photo + bio (desktop, Ana) --------------------------------------
        print("photo + bio")
        p.click("#me-chip .who")
        expect(p.locator("#player-dlg")).to_have_attribute("open", "")
        expect(p.locator("#player-body h2")).to_have_text(names["ana"])
        expect(p.locator("#player-body .bio.muted")).to_contain_text("No bio yet")
        expect(p.locator("#player-body .polaroid")).to_have_count(0)
        p.click("#player-body [data-act=edit-me]")
        expect(p.locator("#edit-player-dlg")).to_have_attribute("open", "")
        expect(p.locator("#player-dlg")).not_to_have_attribute("open", "")
        expect(p.locator("#rename-wrap")).to_be_hidden()
        expect(p.locator("#edit-photo-preview .avatar.letter")).to_have_text("A")
        expect(p.locator("#edit-photo-remove")).to_be_hidden()
        # A non-image is refused in the browser.
        p.set_input_files("#edit-photo", imgs["fake"])
        expect(p.locator("#edit-player-err")).to_contain_text("Couldn't read that image")
        expect(p.locator("#edit-photo-remove")).to_be_hidden()
        # A big landscape JPEG: cropped to the center square, shrunk to 256 px.
        big_kb = os.path.getsize(imgs["big"]) // 1024
        p.set_input_files("#edit-photo", imgs["big"])
        expect(p.locator("#edit-photo-preview img")).to_have_attribute("src", re.compile(r"^blob:"))
        expect(p.locator("#edit-player-err")).to_have_text("")
        expect(p.locator("#edit-photo-remove")).to_be_visible()
        bio_in = "Line one <b>bold?</b>\n\n\n\nLine   <img src=x onerror=alert(5)> two\nOss!"
        p.fill("#edit-bio", bio_in)
        expect(p.locator("#edit-bio-count")).to_have_text(f"{len(bio_in)}/280")
        ana.shot("dlg_edit_profile")
        p.click("#edit-player-form button[type=submit]")
        expect(p.locator("#edit-player-dlg")).not_to_have_attribute("open", "")
        ana.toast("Profile saved.")
        st = api_player(request, a)
        PROBLEMS.check(st["photo_v"] > 0, f"photo not saved: {st}")
        res = request.get(f"{API}/players/{a}/photo?v={st['photo_v']}")
        PROBLEMS.check(res.ok, f"GET photo -> {res.status}")
        if res.ok:
            im = Image.open(io.BytesIO(res.body()))
            PROBLEMS.check(im.format == "JPEG" and im.size == (256, 256),
                           f"stored photo should be a 256x256 JPEG, got {im.format} {im.size}")
            px = im.convert("RGB")
            corners = [px.getpixel(xy) for xy in ((5, 5), (250, 5), (5, 250), (250, 250), (128, 128))]
            PROBLEMS.check(all(is_color(cpx, "green") for cpx in corners),
                           f"photo was not center-cropped (expected all green): {corners}")
            print(f"  big photo {big_kb} KB -> stored {len(res.body()) // 1024} KB")
        # Shows on the board, the chip and the profile polaroid.
        sel_board = f'#board li[data-id="{a}"] .avatar img'
        expect(p.locator(sel_board)).to_have_attribute("src", re.compile(rf"/players/{a}/photo\?v=\d+"))
        PROBLEMS.check(is_color(img_color(p, sel_board), "green"), "board avatar is not the new photo")
        PROBLEMS.check(wait_img(p, "#me-chip .avatar img") == [256, 256], "chip avatar photo did not load")
        p.click("#me-chip .who")
        expect(p.locator("#player-body .polaroid img")).to_have_attribute("alt", f"Photo of {names['ana']}")
        wait_img(p, "#player-body .polaroid img")
        bio = p.locator("#player-body .bio")
        expect(bio).not_to_have_class(re.compile("muted"))
        bio_text = bio.inner_text()
        PROBLEMS.check(bio_text == "Line one <b>bold?</b>\n\nLine <img src=x onerror=alert(5)> two\nOss!",
                       f"bio not rendered as plain text with line breaks: {bio_text!r}")
        PROBLEMS.check(bio.locator("b, img").count() == 0, "bio HTML was not escaped")
        PROBLEMS.check(bio.locator("br").count() == 3, f"bio should have 3 <br>, has {bio.locator('br').count()}")
        ana.shot("dlg_profile_photo_bio")
        # Edit again: the current photo is shown; remove it.
        p.click("#player-body [data-act=edit-me]")
        expect(p.locator("#edit-photo-preview img")).to_have_attribute("src", re.compile(r"/photo\?v="))
        expect(p.locator("#edit-bio")).to_have_value("Line one <b>bold?</b>\n\nLine <img src=x onerror=alert(5)> two\nOss!")
        p.click("#edit-photo-remove")
        expect(p.locator("#edit-photo-remove")).to_be_hidden()
        p.wait_for_timeout(200)
        PROBLEMS.check(
            p.locator("#edit-photo-preview img").count() == 0
            and p.locator("#edit-photo-preview .avatar.letter").count() == 1,
            "after 'Remove photo' the edit preview still shows the current photo (paintPhotoPreview calls "
            "avatar(p) which uses p.photo_v > 0) instead of the letter avatar",
        )
        ana.shot("dlg_edit_profile_after_remove")
        p.click("#edit-player-form button[type=submit]")
        ana.toast("Profile saved.")
        expect(p.locator(f'#board li[data-id="{a}"] .avatar.letter')).to_have_text("A")
        expect(p.locator("#me-chip .avatar.letter")).to_have_text("A")
        PROBLEMS.check(api_player(request, a)["photo_v"] <= 0, "photo_v still positive after removing the photo")
        PROBLEMS.check(request.get(f"{API}/players/{a}/photo?v=1").status == 404, "removed photo still served")
        # A different photo afterwards must really show (not the cached old one).
        p.click("#me-chip .who")
        p.click("#player-body [data-act=edit-me]")
        p.set_input_files("#edit-photo", imgs["blue"])
        expect(p.locator("#edit-photo-preview img")).to_have_attribute("src", re.compile(r"^blob:"))
        p.click("#edit-player-form button[type=submit]")
        ana.toast("Profile saved.")
        col = img_color(p, sel_board)
        PROBLEMS.check(
            is_color(col, "blue"),
            f"after remove + new upload the board still shows the OLD photo (avg rgb {col}): photo_v restarts "
            f"at 1 so the URL ?v=1 is the same and the browser serves its immutable cached copy",
        )
        ana.check_no_hscroll("board with photo")

        # ---- promotion + photo + bio on the phone (Bia) -----------------------
        print("promotion + phone photo")
        bia.reload()
        p = bia.page
        p.click(f'#board li[data-id="{b}"]')
        expect(p.locator("#player-body h2")).to_have_text(names["bia"])
        p.click("#player-body [data-act=edit-me]")
        p.click('.belt-picker[data-for=edit] [data-v="blue"]')
        p.click("#edit-player-form button[type=submit]")
        bia.toast("Promoted")
        expect(p.locator(f'#board li[data-id="{b}"] svg.belt')).to_have_attribute("aria-label", "Blue belt")
        PROBLEMS.check(api_player(request, b)["belt"] == "blue", "promotion not saved")
        # Demotion is quiet (no "Promoted" toast); then promote back.
        p.click("#me-chip .who")
        p.click("#player-body [data-act=edit-me]")
        p.click('.belt-picker[data-for=edit] [data-v="white"]')
        p.click("#edit-player-form button[type=submit]")
        bia.toast("Profile saved.")
        p.click("#me-chip .who")
        p.click("#player-body [data-act=edit-me]")
        p.click('.belt-picker[data-for=edit] [data-v="blue"]')
        p.set_input_files("#edit-photo", imgs["portrait"])
        expect(p.locator("#edit-photo-preview img")).to_have_attribute("src", re.compile(r"^blob:"))
        p.fill("#edit-bio", "Half guard enjoyer.\nTrains Tue/Thu at Chacrinha. Loves a good omoplata.")
        bia.check_no_hscroll("edit profile dialog")
        bia.shot("dlg_edit_profile")
        p.click("#edit-player-form button[type=submit]")
        bia.toast("Promoted")
        PROBLEMS.check(is_color(img_color(p, f'#board li[data-id="{b}"] .avatar img'), "orange"),
                       "Bia's board avatar is not her portrait")
        p.click("#me-chip .who")
        wait_img(p, "#player-body .polaroid img")
        expect(p.locator("#player-body .bio")).to_contain_text("Half guard enjoyer.")
        bia.check_no_hscroll("profile with photo")
        bia.shot("dlg_profile_photo_bio")
        p.keyboard.press("Escape")
        # Board screenshots with avatars (letters + photos).
        for f in (ana, bia):
            f.reload()
            for pid in (a, b):
                wait_img(f.page, f'#board li[data-id="{pid}"] .avatar img')
            f.check_no_hscroll("board with avatars")
            f.shot("board_avatars", full=True)
        # Caio sees others' profiles with photo + bio; no "No bio yet" hint for others.
        caio.reload()
        caio.page.click(f'#board li[data-id="{a}"]')
        wait_img(caio.page, "#player-body .polaroid img")
        expect(caio.page.locator("#player-body .bio")).to_contain_text("Line one")
        caio.page.keyboard.press("Escape")
        caio.page.click(f'#board li[data-id="{c}"]')
        expect(caio.page.locator("#player-body .bio")).to_contain_text("No bio yet")
        caio.page.keyboard.press("Escape")

        # ---- change password; the other device gets logged out ---------------
        print("change password")
        bia2 = friend("Bia2", "desktop")
        bia2.open()
        login(bia2, b, names["bia"], pws["bia"])
        p = bia.page
        p.click("#me-chip .who")
        p.click("#player-body [data-act=change-pw]")
        expect(p.locator("#pw-dlg")).to_have_attribute("open", "")
        expect(p.locator("#pw-current-wrap")).to_be_visible()
        expect(p.locator("#pw-current")).to_be_focused()
        p.fill("#pw-current", "not-my-password")
        p.fill("#pw-new", "bia-pass-2")
        p.fill("#pw-new2", "bia-pass-2")
        bia.allow(401)
        p.click("#pw-form button[type=submit]")
        expect(p.locator("#pw-err")).to_have_text("Your current password is wrong.")
        expect(p.locator("#pw-dlg")).to_have_attribute("open", "")
        PROBLEMS.check(bia.token() is not None, "a wrong current password logged Bia out")
        p.fill("#pw-current", pws["bia"])
        p.fill("#pw-new", "abc")
        p.fill("#pw-new2", "abc")
        p.click("#pw-form button[type=submit]")
        expect(p.locator("#pw-err")).to_have_text("Use at least 4 characters.")
        p.fill("#pw-new", "bia-pass-2")
        p.fill("#pw-new2", "bia-pass-3")
        p.click("#pw-form button[type=submit]")
        expect(p.locator("#pw-err")).to_have_text("The two passwords don't match.")
        bia.check_no_hscroll("password dialog")
        p.fill("#pw-new2", "bia-pass-2")
        p.click("#pw-form button[type=submit]")
        expect(p.locator("#pw-dlg")).not_to_have_attribute("open", "")
        bia.toast("Password changed.")
        pws["bia"] = "bia-pass-2"
        bia.reload()
        expect(p.locator("#me-chip .who")).to_have_text(names["bia"])  # this device stays logged in
        # Bia's laptop still shows the board; its next action must log it out.
        p2 = bia2.page
        p2.click("#log-btn")
        p2.select_option("#roll-b", value=str(a))
        p2.click('#roll-dlg .result-pick label:has(input[value="draw"])')
        p2.fill("#roll-note", n["dead"])
        bia2.allow(401)
        p2.click("#roll-submit")
        try:
            expect(p2.locator("#welcome")).to_be_visible(timeout=4000)
            logged_out = True
        except AssertionError:
            logged_out = False
        PROBLEMS.check(
            logged_out,
            "stale session (password changed on another device): submitting a roll shows "
            f"{p2.locator('#roll-err').text_content()!r} inside the dialog instead of logging out "
            "(handleErr skips the 401 logout when given an error element)",
        )
        if p2.locator("#roll-dlg[open]").count():
            p2.keyboard.press("Escape")
        PROBLEMS.check(not [r for r in api_state(request)["rolls"] if r["note"] == n["dead"]],
                       "stale session could still log a roll")
        bia2.reload()
        expect(p2.locator("#welcome")).to_be_visible()
        PROBLEMS.check(bia2.token() is None, "dead token kept in localStorage after reload")
        open_login(bia2, b, names["bia"])
        bia2.allow(401)
        p2.fill("#login-pw", "bia-pass-1")
        p2.click("#login-submit")
        expect(p2.locator("#login-err")).to_have_text("Wrong password.")
        p2.fill("#login-pw", pws["bia"])
        p2.click("#login-submit")
        expect(p2.locator("#me-chip .who")).to_have_text(names["bia"])

        # ---- admin reset password; stale session's next action logs out -------
        print("admin reset password")
        log_roll(ana, c, "b", "Rear naked choke", n["r6"])
        r6 = find_roll(request, n["r6"])
        caio.reload()
        expect(pending_li(caio.page, r6["id"])).to_be_visible()
        adm.reload()
        p = adm.page
        p.click(f'#board li[data-id="{c}"]')
        expect(p.locator("#player-body h2")).to_have_text(names["caio"])
        expect(p.locator("#player-body [data-act=change-pw]")).to_have_count(0)
        p.click("#player-body [data-act=reset-pw]")
        expect(p.locator("#pw-title")).to_have_text(f"New password for {names['caio']}")
        expect(p.locator("#pw-current-wrap")).to_be_hidden()
        expect(p.locator("#pw-new")).to_be_focused()
        p.fill("#pw-new", "caio-new-9")
        p.fill("#pw-new2", "caio-new-9")
        p.click("#pw-form button[type=submit]")
        adm.toast("password was reset")
        expect(p.locator("#me-chip .who")).to_have_text("Paloma")  # admin stays logged in
        pws["caio"] = "caio-new-9"
        p = caio.page
        caio.allow(401)
        pending_li(p, r6["id"]).locator("[data-act=accept]").click()
        caio.toast("Please log in again.")
        expect(p.locator("#welcome")).to_be_visible()
        PROBLEMS.check(caio.token() is None, "dead token kept after 401")
        open_login(caio, c, names["caio"])
        caio.allow(401)
        p.fill("#login-pw", "caio-pass-1")
        p.click("#login-submit")
        expect(p.locator("#login-err")).to_have_text("Wrong password.")
        p.fill("#login-pw", pws["caio"])
        p.click("#login-submit")
        expect(p.locator("#me-chip .who")).to_have_text(names["caio"])
        pending_li(p, r6["id"]).locator("[data-act=accept]").click()
        caio.toast("Victory")
        model.rolls[r6["id"]] = (a, c, c)
        check_board(caio, model, "after Caio accepts r6")

        # ---- legacy profile without a password: choose one on first login ----
        print("legacy profile")
        leo_id = insert_legacy_player(names["leo"])
        if leo_id is None:
            print("  (skipped: local D1 file not found; set JJ_D1_SQLITE)")
        else:
            created.append(leo_id)
            leo = friend("Leo", "phone")
            leo.open()
            p = leo.page
            open_login(leo, leo_id, names["leo"])
            expect(p.locator("#login-pw2-wrap")).to_be_visible()
            expect(p.locator("#login-hint")).to_contain_text("You don't have a password yet")
            expect(p.locator("#login-submit")).to_have_text("Save and log in")
            p.fill("#login-pw", "abc")
            p.fill("#login-pw2", "abc")
            p.click("#login-submit")
            expect(p.locator("#login-err")).to_have_text("Use at least 4 characters.")
            p.fill("#login-pw", "leo-pass-1")
            p.fill("#login-pw2", "leo-pass-2")
            p.click("#login-submit")
            expect(p.locator("#login-err")).to_have_text("The two passwords don't match.")
            p.fill("#login-pw2", "leo-pass-1")
            leo.check_no_hscroll("first-login dialog")
            leo.shot("dlg_login_first_time")
            p.click("#login-submit")
            expect(p.locator("#me-chip .who")).to_have_text(names["leo"])
            leo.toast("Password saved.")
            PROBLEMS.check(api_player(request, leo_id)["has_pw"], "claimed password not saved")
            logout(leo)
            open_login(leo, leo_id, names["leo"])
            expect(p.locator("#login-pw2-wrap")).to_be_hidden()
            p.fill("#login-pw", "leo-pass-1")
            p.click("#login-submit")
            expect(p.locator("#me-chip .who")).to_have_text(names["leo"])

        # ---- admin: rename + delete a player ---------------------------------
        print("admin rename + delete player")
        r = request.post(f"{API}/players", data={"name": names["dan"], "belt": "black", "password": "dan-pass-1"})
        assert r.ok, r.text()
        d = r.json()["player"]["id"]
        created.append(d)
        adm.reload()
        p = adm.page
        p.click(f'#board li[data-id="{d}"]')
        p.click("#player-body [data-act=admin-edit-player]")
        expect(p.locator("#edit-player-title")).to_have_text(f"Edit {names['dan']}")
        expect(p.locator("#rename-wrap")).to_be_visible()
        new_dan = f"Danny {RUN}"
        p.fill("#edit-name", new_dan)
        p.click("#edit-player-form button[type=submit]")
        adm.toast("Profile saved.")
        expect(p.locator(f'#board li[data-id="{d}"] .name')).to_have_text(new_dan)
        p.click(f'#board li[data-id="{d}"]')
        p.click("#player-body [data-act=del-player]")
        expect(p.locator("#confirm-title")).to_have_text(f"Delete {new_dan}?")
        p.click("#confirm-yes")
        adm.toast("erased from the board")
        expect(p.locator(f'#board li[data-id="{d}"]')).to_have_count(0)
        created.remove(d)
        # Admin's own profile: edit allowed, no password change, no delete.
        p.click("#me-chip .who")
        expect(p.locator("#player-body [data-act=edit-me]")).to_be_visible()
        expect(p.locator("#player-body [data-act=change-pw]")).to_have_count(0)
        expect(p.locator("#player-body [data-act=del-player]")).to_have_count(0)
        p.keyboard.press("Escape")

        # ---- final welcome screens (avatars in the list) ----------------------
        print("welcome screenshots")
        for size in ("desktop", "phone"):
            g = friend(f"Guest-{size}", size)
            g.open()
            g.page.fill("#who-search", RUN)
            for pid in (a, b):
                wait_img(g.page, f'#who-list .who-btn[data-id="{pid}"] .avatar img')
            g.page.fill("#who-search", "")
            g.check_no_hscroll("welcome")
            g.shot("welcome", full=True)

        check_clean(friends)
    finally:
        # Clean up everything this run created, even after a failure.
        try:
            tok = request.post(f"{API}/login", data={"id": paloma, "password": ADMIN_PW}).json().get("token")
            for pid in created:
                request.delete(f"{API}/players/{pid}", headers={"authorization": f"Bearer {tok}"})
            left = [x["name"] for x in api_state(request)["players"] if RUN in x["name"]]
            if left:
                print(f"  cleanup left players behind: {left}")
        except Exception as ex:  # noqa: BLE001 - cleanup must not hide the real failure
            print(f"  cleanup failed: {ex}")
        for f in friends:
            f.close()
        request.dispose()
        browser.close()


def test_e2e():
    with sync_playwright() as pw:
        run(pw)
    assert not PROBLEMS.items, "Problems found:\n- " + "\n- ".join(PROBLEMS.items)


if __name__ == "__main__":
    t0 = time.time()
    try:
        test_e2e()
    except AssertionError as e:
        print(f"\nFAIL ({time.time() - t0:.1f}s)\n{e}")
        sys.exit(1)
    print(f"\nPASS ({time.time() - t0:.1f}s), screenshots in {SHOTS}")
