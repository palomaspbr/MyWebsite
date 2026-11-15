"""End-to-end UI test for Chacrinha Jiu-Jitsu (jiujitsu/).

Drives the real UI with Playwright (sync API) against a running dev server,
using separate browser contexts to simulate different friends.

    python -I tests/jiujitsu/test_e2e.py          # standalone
    python -m pytest tests/jiujitsu/test_e2e.py    # or via pytest

Env vars:
    JJ_BASE      app URL            (default http://localhost:8788/jiujitsu/)
    JJ_ADMIN_PW  admin password     (default test-admin-pw)
    JJ_SHOTS     screenshot folder  (default: <temp dir>/jj-shots)
    JJ_HEADED=1  show the browser

The database may be shared with other runs, so the test only creates players
with unique random names, only asserts on its own players, and deletes them at
the end (admin API) even if a step fails.
"""

import os
import re
import secrets
import sys
import tempfile
import time

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("JJ_BASE", "http://localhost:8788/jiujitsu/")
API = BASE.rstrip("/") + "/api"
ADMIN_PW = os.environ.get("JJ_ADMIN_PW", "test-admin-pw")
SHOTS = os.environ.get("JJ_SHOTS", os.path.join(tempfile.gettempdir(), "jj-shots"))
HEADED = os.environ.get("JJ_HEADED") == "1"

DESKTOP = {"viewport": {"width": 1280, "height": 900}}
PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}

BELTS = ["white", "blue", "purple", "brown", "black"]
RUN = secrets.token_hex(3)  # 6 hex chars, unique per run

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
        self.expected_401 = 0
        p = self.page
        p.on("console", self._on_console)
        p.on("pageerror", lambda e: self.page_errors.append(str(e)))
        p.on("requestfailed", self._on_failed)
        p.on("response", self._on_response)
        p.on("dialog", self._on_dialog)

    def _on_console(self, msg):
        if msg.type == "error":
            self.console_errors.append(msg.text)

    def _on_failed(self, req):
        err = req.failure or ""
        # Navigations/reloads abort in-flight fetches; that is not an app bug.
        if "ERR_ABORTED" in err:
            return
        self.failed.append(f"{req.method} {req.url}: {err}")

    def _on_response(self, res):
        if res.status >= 400:
            if res.status == 401 and res.url.endswith("/admin/login") and self.expected_401 > 0:
                self.expected_401 -= 1
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

    def me_id(self):
        v = self.page.evaluate("localStorage.getItem('jj.me')")
        return int(v) if v else None

    def shot(self, name, full=False):
        path = os.path.join(SHOTS, f"{self.size}_{name}.png")
        # Let entry animations and the dialog "sheet" animation finish.
        self.page.wait_for_timeout(500)
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
                // Transient overlays: confetti, and the toast (its entry animation is
                // checked deterministically by check_toast_entry instead).
                if (el.classList.contains('confetti') || el.closest('#toast')) continue;
                if (r.right > vw + 1 || r.left < -1) {
                  off.push(`${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')} [${Math.round(r.left)}..${Math.round(r.right)}]`);
                }
              }
              return { sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth, vw, off: off.slice(0, 8) };
            }"""
        )
        PROBLEMS.check(
            info["sw"] <= info["vw"] and not info["off"],
            f"[{self.label}/{self.size}] horizontal overflow on {where}: scrollWidth={info['sw']} "
            f"vw={info['vw']} offenders={info['off']}",
        )

    def check_toast_entry(self):
        """Replay the toast entry animation, freeze it at t=0, and check it is centered.

        The .toast base transform is translateX(-50%); if the keyframes override
        transform, the toast starts half its width to the right and slides in."""
        info = self.page.evaluate(
            """() => {
              const t = document.querySelector('#toast');
              t.hidden = false;
              t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
              const anims = t.getAnimations();
              anims.forEach(a => { a.pause(); a.currentTime = 0; });
              const r = t.getBoundingClientRect();
              anims.forEach(a => a.finish());
              const r2 = t.getBoundingClientRect();
              return { n: anims.length, start: (r.left + r.right) / 2, end: (r2.left + r2.right) / 2,
                       right: r.right, vw: document.documentElement.clientWidth };
            }"""
        )
        PROBLEMS.check(
            abs(info["start"] - info["end"]) < 8 and info["right"] <= info["vw"],
            f"[{self.label}/{self.size}] toast entry animation drops translateX(-50%): starts centered at "
            f"x={info['start']:.0f} (right edge {info['right']:.0f}, viewport {info['vw']}), ends at x={info['end']:.0f}",
        )

    def close(self):
        self.ctx.close()


# ---------------------------------------------------------------- helpers

def api_state(request):
    r = request.get(API + "/state")
    assert r.ok, r.status
    return r.json()


def signup(f, name, belt="white", stripes=0):
    p = f.page
    expect(p.locator("#welcome")).to_be_visible()
    p.fill("#signup-name", name)
    p.click(f'.belt-picker[data-for=signup] [data-v="{belt}"]')
    p.click(f'.stripe-picker[data-for=signup] [data-v="{stripes}"]')
    p.click("#signup-form button[type=submit]")
    expect(p.locator("#board-wrap")).to_be_visible()
    expect(p.locator("#me-chip .who")).to_have_text(name)
    pid = f.me_id()
    assert pid, "signup did not store jj.me"
    expect(p.locator(f'#board li[data-id="{pid}"]')).to_be_visible()
    return pid


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


def find_roll_id(request, note):
    rolls = [r for r in api_state(request)["rolls"] if r["note"] == note]
    return [r["id"] for r in rolls]


def log_roll(f, opp_id, result, method="", note="", submit="click", shot=None):
    """result: 'a' (I won), 'b' (they won), 'draw'."""
    p = f.page
    p.click("#log-btn")
    dlg = p.locator("#roll-dlg")
    expect(dlg).to_have_attribute("open", "")
    expect(p.locator("#roll-title")).to_have_text("Log a roll")
    expect(p.locator("#roll-a")).to_be_disabled()
    expect(p.locator("#roll-a")).to_have_value(str(f.me_id()))
    p.select_option("#roll-b", value=str(opp_id))
    p.click(f'#roll-dlg .result-pick label:has(input[value="{result}"])')
    expect(p.locator(f'#roll-dlg input[name=result][value="{result}"]')).to_be_checked()
    if method:
        p.fill("#roll-method", method)
    if note:
        p.fill("#roll-note", note)
    if shot:
        f.check_no_hscroll("log-roll dialog")
        f.shot(shot)
    if submit == "click":
        p.click("#roll-submit")
    elif submit == "dblclick":
        p.dblclick("#roll-submit")
    elif submit == "enter2":
        p.focus("#roll-note")
        p.keyboard.press("Enter")
        p.keyboard.press("Enter")
    expect(dlg).not_to_have_attribute("open", "")
    if note:
        expect(p.locator("#feed li", has_text=note).first).to_be_visible()


class Model:
    """Expected leaderboard numbers for the players this test owns."""

    def __init__(self):
        self.players = {}  # id -> name
        self.rolls = {}  # id -> (a, b, winner)

    def add_roll(self, rid, a, b, winner):
        self.rolls[rid] = (a, b, winner)

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
    for pid in model.players:
        pts, w, d, l = model.stats(pid)
        li = p.locator(f'#board li[data-id="{pid}"]')
        expect(li.locator(".pts b"), f"{where}: points of {model.players[pid]}").to_have_text(str(pts))
        expect(li.locator(".meta"), f"{where}: record of {model.players[pid]}").to_contain_text(f"{w}W {d}D {l}L")
    board = p.evaluate(
        """() => [...document.querySelectorAll('#board li')].map(li => ({
             id: Number(li.dataset.id), pts: Number(li.querySelector('.pts b').textContent) }))"""
    )
    pts_seq = [r["pts"] for r in board]
    PROBLEMS.check(pts_seq == sorted(pts_seq, reverse=True), f"{where}: board not sorted by points: {pts_seq}")
    mine = [r["id"] for r in board if r["id"] in model.players]
    exp = sorted(model.players, key=lambda i: (-model.stats(i)[0], -model.stats(i)[1], model.stats(i)[3]))
    # Only compare when there are no ties on the first three keys.
    keys = [(model.stats(i)[0], model.stats(i)[1], model.stats(i)[3]) for i in exp]
    if len(set(keys)) == len(keys):
        PROBLEMS.check(mine == exp, f"{where}: board order of test players {mine} != expected {exp}")


def check_clean(friends):
    for f in friends:
        PROBLEMS.check(not f.page_errors, f"[{f.label}] page errors: {f.page_errors}")
        PROBLEMS.check(not f.console_errors, f"[{f.label}] console errors: {f.console_errors}")
        PROBLEMS.check(not f.failed, f"[{f.label}] failed requests: {f.failed}")
        PROBLEMS.check(not f.bad_status, f"[{f.label}] HTTP errors: {f.bad_status}")
        PROBLEMS.check(not f.dialogs, f"[{f.label}] unexpected JS dialogs (XSS?): {f.dialogs}")


# ---------------------------------------------------------------- the test

def run(pw):
    os.makedirs(SHOTS, exist_ok=True)
    browser = pw.chromium.launch(headless=not HEADED)
    request = pw.request.new_context()
    model = Model()
    friends = []
    created = []

    def friend(label, size):
        f = Friend(browser, label, size)
        friends.append(f)
        return f

    names = {
        "ana": f"Ana {RUN}",
        "bia": f"Bia {RUN}",
        "caio": f"Caio {RUN}",
        # 24 chars max on the server; this is the longest alert payload that fits.
        "xss": f"<svg/onload=alert(1)>{RUN[:3]}",
        "long": f"Wwwwwwwwwwwwwwwwww{RUN}",  # 24 wide chars, layout stress
    }
    try:
        # ---- welcome screen + sound toggle persistence --------------------
        print("welcome + sound toggle")
        ana = friend("Ana", "desktop")
        ana.open()
        expect(ana.page.locator("#welcome")).to_be_visible()
        expect(ana.page.locator('#who-list .who-btn:has-text("Paloma")')).to_be_visible()
        PROBLEMS.check(
            ana.page.evaluate("document.fonts.check('20px \"Caveat Brush\"') && document.fonts.check('20px \"Patrick Hand\"')"),
            "hand-drawn fonts not loaded",
        )
        sb = ana.page.locator("#sound-btn")
        expect(sb).to_have_attribute("aria-pressed", "true")
        sb.click()
        expect(sb).to_have_attribute("aria-pressed", "false")
        ana.reload()
        expect(sb).to_have_attribute("aria-pressed", "false")
        expect(sb).to_have_attribute("aria-label", "Sound off")
        # With sound off, interacting must not even create an AudioContext.
        ana.page.click('.belt-picker[data-for=signup] [data-v="purple"]')
        ana.page.click('.belt-picker[data-for=signup] [data-v="white"]')
        PROBLEMS.check(ana.page.evaluate("window.__ac") == 0, "AudioContext created while sound is off")
        sb.click()
        expect(sb).to_have_attribute("aria-pressed", "true")
        ana.reload()
        expect(sb).to_have_attribute("aria-pressed", "true")
        ana.check_no_hscroll("welcome")
        ana.shot("welcome", full=True)

        # ---- three friends sign up in separate contexts --------------------
        print("signups")
        a = signup(ana, names["ana"], "blue", 2)
        model.players[a] = names["ana"]
        created.append(a)

        bia = friend("Bia", "phone")
        bia.open()
        bia.check_no_hscroll("welcome")
        bia.shot("welcome", full=True)
        caio = friend("Caio", "desktop")
        caio.open()  # loaded before Bia exists: Caio's player list is now stale
        b = signup(bia, names["bia"], "white", 0)
        model.players[b] = names["bia"]
        created.append(b)
        bia.check_toast_entry()

        # Stale page + taken name -> server 409 "Pick that name from the list instead."
        # The list should then actually contain that name.
        cp = caio.page
        cp.fill("#signup-name", names["bia"])
        cp.click("#signup-form button[type=submit]")
        expect(cp.locator("#toast")).to_contain_text("already on the board")
        caio.bad_status = [s for s in caio.bad_status if not (s.startswith("POST") and s.endswith("-> 409"))]
        caio.console_errors = [e for e in caio.console_errors if "409" not in e]
        cp.wait_for_timeout(1000)
        PROBLEMS.check(
            cp.locator(f'#who-list .who-btn[data-id="{b}"]').count() == 1,
            "after a 409 'already on the board, pick it from the list' the who-list is not refreshed, "
            "so the name is not there to pick",
        )
        cp.fill("#signup-name", "")
        c = signup(caio, names["caio"], "purple", 1)
        model.players[c] = names["caio"]
        created.append(c)

        # Signing up with an existing name (different case) logs you in as that player.
        caio.page.click("#me-chip [data-act=switch]")
        expect(caio.page.locator("#welcome")).to_be_visible()
        caio.page.fill("#signup-name", names["caio"].upper())
        caio.page.click("#signup-form button[type=submit]")
        expect(caio.page.locator("#me-chip .who")).to_have_text(names["caio"])
        PROBLEMS.check(caio.me_id() == c, "re-signup with existing name did not pick the existing player")

        # ---- log rolls ------------------------------------------------------
        print("log rolls")
        ana.reload()
        n1, n2, n3, n4, n5 = (f"e2e {RUN} r{i}" for i in range(1, 6))
        log_roll(ana, b, "a", "Armbar", n1, shot="dlg_log_roll")
        expect(ana.page.locator("#toast")).to_contain_text("Victory")
        r1 = find_roll_id(request, n1)
        assert len(r1) == 1, r1
        model.add_roll(r1[0], a, b, a)
        check_board(ana, model, "after r1")

        log_roll(ana, c, "draw", "", n2)
        expect(ana.page.locator("#toast")).to_contain_text("draw")
        r2 = find_roll_id(request, n2)
        model.add_roll(r2[0], a, c, None)

        log_roll(ana, c, "b", "Triangle", n3)
        expect(ana.page.locator("#toast")).to_contain_text("Tapping is learning")
        r3 = find_roll_id(request, n3)
        model.add_roll(r3[0], a, c, c)
        check_board(ana, model, "after r3")
        sounds = ana.page.evaluate("window.__sounds")
        PROBLEMS.check({"tap", "win", "draw", "lose"} <= set(sounds), f"expected roll sounds, got {sounds}")

        # Bia (phone) logs by pressing Enter twice in the note field.
        bia.reload()
        log_roll(bia, c, "a", "Rear naked choke", n4, submit="enter2", shot="dlg_log_roll")
        r4 = find_roll_id(request, n4)
        PROBLEMS.check(len(r4) == 1, f"pressing Enter twice created {len(r4)} rolls")
        for rid in r4:
            model.add_roll(rid, b, c, b)

        # Caio double-clicks Save.
        caio.reload()
        log_roll(caio, b, "a", "Kimura", n5, submit="dblclick")
        caio.page.wait_for_timeout(1500)  # give a duplicate request time to land
        r5 = find_roll_id(request, n5)
        PROBLEMS.check(len(r5) == 1, f"double-clicking Save created {len(r5)} rolls")
        for rid in r5:
            model.add_roll(rid, c, b, c)

        # Expected: Caio 7 (2W 1D 1L) > Ana 4 (1W 1D 1L) > Bia 3 (1W 0D 2L)
        for f in (ana, bia, caio):
            f.reload()
            check_board(f, model, f"board seen by {f.label}")
            expect(f.page.locator(f'#board li[data-id="{f.me_id()}"]')).to_have_class(re.compile(r"\bme\b"))
        ana.check_no_hscroll("leaderboard")
        bia.check_no_hscroll("leaderboard")
        ana.shot("leaderboard", full=True)
        bia.shot("leaderboard", full=True)

        # ---- keyboard: Enter on a board row opens the profile ----------------
        print("keyboard + profiles")
        p = ana.page
        row = p.locator(f'#board li[data-id="{c}"]')
        row.focus()
        p.keyboard.press("Enter")
        expect(p.locator("#player-dlg")).to_have_attribute("open", "")
        expect(p.locator("#player-body h2")).to_have_text(names["caio"])
        stats = p.locator("#player-body .statgrid .stat b").all_text_contents()
        PROBLEMS.check(stats == [str(x) for x in model.stats(c)], f"Caio profile stats {stats} != {model.stats(c)}")
        expect(p.locator("#player-body")).to_contain_text("You vs " + names["caio"] + ": 0W 1D 1L")
        expect(p.locator("#player-body")).to_contain_text("Favorite finish: triangle")
        expect(p.locator("#player-body .mini-feed li")).to_have_count(4)
        expect(p.locator("#player-body [data-act=edit-me]")).to_have_count(0)
        expect(p.locator("#player-body [data-act=del-player]")).to_have_count(0)
        ana.shot("dlg_profile")
        p.keyboard.press("Escape")
        expect(p.locator("#player-dlg")).not_to_have_attribute("open", "")
        # Space works too, and focus returns to the row after closing.
        row.focus()
        p.keyboard.press("Space")
        expect(p.locator("#player-dlg")).to_have_attribute("open", "")
        p.click("#player-dlg [data-close]")
        expect(p.locator("#player-dlg")).not_to_have_attribute("open", "")
        # Tab reachability: tabbing from the log button reaches a board row.
        p.focus("#log-btn")
        reached = False
        for _ in range(60):
            p.keyboard.press("Tab")
            if p.evaluate("document.activeElement.matches('#board li[data-id]')"):
                reached = True
                break
        PROBLEMS.check(reached, "board rows not reachable with Tab")

        # ---- promotion: Bia changes her belt from her own profile (phone) ----
        print("promotion")
        p = bia.page
        p.click(f'#board li[data-id="{b}"]')
        expect(p.locator("#player-dlg")).to_have_attribute("open", "")
        expect(p.locator("#player-body h2")).to_have_text(names["bia"])
        bia.check_no_hscroll("profile dialog")
        bia.shot("dlg_profile")
        p.click("#player-body [data-act=edit-me]")
        expect(p.locator("#edit-player-dlg")).to_have_attribute("open", "")
        expect(p.locator("#rename-wrap")).to_be_hidden()
        p.click('.belt-picker[data-for=edit] [data-v="blue"]')
        p.click('.stripe-picker[data-for=edit] [data-v="1"]')
        p.click("#edit-player-form button[type=submit]")
        expect(p.locator("#edit-player-dlg")).not_to_have_attribute("open", "")
        expect(p.locator("#toast")).to_contain_text("Promoted")
        expect(p.locator(f'#board li[data-id="{b}"] svg.belt')).to_have_attribute("aria-label", "Blue belt, 1 stripe")
        expect(p.locator("#me-chip svg.belt")).to_have_attribute("aria-label", "Blue belt, 1 stripe")
        st = [x for x in api_state(request)["players"] if x["id"] == b][0]
        PROBLEMS.check((st["belt"], st["stripes"]) == ("blue", 1), f"promotion not saved: {st}")

        # ---- switch user ------------------------------------------------------
        print("switch user")
        p = caio.page
        p.click("#me-chip [data-act=switch]")
        expect(p.locator("#welcome")).to_be_visible()
        PROBLEMS.check(caio.me_id() is None, "switch did not clear jj.me")
        p.fill("#who-search", names["ana"])
        expect(p.locator("#who-list .who-btn")).to_have_count(1)
        p.click(f'#who-list .who-btn[data-id="{a}"]')
        expect(p.locator("#me-chip .who")).to_have_text(names["ana"])
        caio.reload()
        expect(p.locator("#me-chip .who")).to_have_text(names["ana"])
        p.click("#me-chip [data-act=switch]")
        p.fill("#who-search", "")
        p.click(f'#who-list .who-btn[data-id="{c}"]')
        expect(p.locator("#me-chip .who")).to_have_text(names["caio"])

        # ---- XSS: a name / method / note full of HTML -------------------------
        print("xss")
        xss = friend("Xss", "desktop")
        xss.open()
        x = signup(xss, names["xss"], "brown", 4)
        model.players[x] = names["xss"]
        created.append(x)
        nx = f"e2e {RUN} \"><img src=x onerror=alert(3)>"
        log_roll(xss, b, "b", "<img src=x onerror=alert(2)>", nx)
        rx = find_roll_id(request, nx)
        model.add_roll(rx[0], x, b, b)
        p = xss.page
        expect(p.locator("#me-chip .who")).to_have_text(names["xss"])
        expect(p.locator(f'#board li[data-id="{x}"] .name')).to_have_text(names["xss"])
        expect(p.locator(f'#feed li[data-id="{rx[0]}"]')).to_contain_text("<img src=x onerror=alert(2)>".lower())
        p.click(f'#board li[data-id="{x}"]')
        expect(p.locator("#player-body h2")).to_have_text(names["xss"])
        p.keyboard.press("Escape")
        p.click("#log-btn")
        expect(p.locator("#res-a")).to_have_text("I won")
        p.select_option("#roll-b", value=str(b))
        p.keyboard.press("Escape")
        injected = p.evaluate("document.querySelectorAll('img[src=\"x\"], #board svg[onload], svg[onload]').length")
        PROBLEMS.check(injected == 0, f"XSS: {injected} injected elements in the DOM")
        bia.reload()
        expect(bia.page.locator(f'#feed li[data-id="{rx[0]}"]')).to_contain_text(names["xss"])
        bia.page.wait_for_timeout(300)
        for f in (xss, bia):
            PROBLEMS.check(not f.dialogs, f"XSS fired a dialog in {f.label}: {f.dialogs}")

        # ---- admin: Paloma with wrong, then right password --------------------
        print("admin")
        adm = friend("Admin", "desktop")
        adm.open()
        st = api_state(request)
        paloma = [x_ for x_ in st["players"] if x_["name"] == "Paloma"][0]["id"]
        p = adm.page
        p.click(f'#who-list .who-btn[data-id="{paloma}"]')
        expect(p.locator("#admin-dlg")).to_have_attribute("open", "")
        expect(p.locator("#admin-pw")).to_be_focused()
        p.fill("#admin-pw", "definitely-wrong")
        adm.expected_401 += 1
        p.click("#admin-form button[type=submit]")
        expect(p.locator("#admin-err")).to_have_text("Wrong password.")
        expect(p.locator("#admin-dlg")).to_have_attribute("open", "")
        expect(p.locator("#welcome")).to_be_visible()
        PROBLEMS.check(adm.me_id() is None, "wrong admin password still logged in")
        # Chrome logs a console error for the expected 401; drop exactly that one.
        p.wait_for_timeout(200)
        adm.console_errors = [e for e in adm.console_errors if "401" not in e]
        p.fill("#admin-pw", ADMIN_PW)
        p.click("#admin-form button[type=submit]")
        expect(p.locator("#admin-dlg")).not_to_have_attribute("open", "")
        expect(p.locator("#me-chip .who")).to_have_text("Paloma")
        expect(p.locator("#admin-tag")).to_be_visible()
        adm.reload()
        expect(p.locator("#admin-tag")).to_be_visible()
        expect(feed_item(p, r1[0]).locator("[data-act=edit-roll]")).to_be_visible()
        expect(feed_item(p, r1[0]).locator("[data-act=del-roll]")).to_be_visible()
        # Non-admins see no tools.
        expect(ana.page.locator("#feed [data-act]")).to_have_count(0)
        check_board(adm, model, "admin board before edits")
        p.locator("#feed").scroll_into_view_if_needed()
        adm.check_no_hscroll("admin feed")
        adm.shot("admin_feed")

        # Edit r1: Ana beat Bia -> Bia beat Ana.
        print("admin edit roll")
        feed_item(p, r1[0]).locator("[data-act=edit-roll]").click()
        expect(p.locator("#roll-dlg")).to_have_attribute("open", "")
        expect(p.locator("#roll-title")).to_have_text("Fix this roll")
        expect(p.locator("#roll-a")).to_be_enabled()
        expect(p.locator("#roll-a")).to_have_value(str(a))
        expect(p.locator("#roll-b")).to_have_value(str(b))
        expect(p.locator('#roll-dlg input[name=result][value="a"]')).to_be_checked()
        expect(p.locator("#roll-method")).to_have_value("Armbar")
        expect(p.locator("#roll-note")).to_have_value(n1)
        expect(p.locator("#res-b")).to_have_text(f"{names['bia']} won")
        p.click('#roll-dlg .result-pick label:has(input[value="b"])')
        p.click("#roll-submit")
        expect(p.locator("#roll-dlg")).not_to_have_attribute("open", "")
        expect(p.locator("#toast")).to_contain_text("Roll fixed")
        model.add_roll(r1[0], a, b, b)
        expect(feed_item(p, r1[0])).to_contain_text(f"{names['bia']} beat {names['ana']}")
        check_board(adm, model, "after admin edit")

        # Delete r2 (Ana/Caio draw).
        print("admin delete roll")
        feed_item(p, r2[0]).locator("[data-act=del-roll]").click()
        expect(p.locator("#confirm-dlg")).to_have_attribute("open", "")
        expect(p.locator("#confirm-text")).to_contain_text("drew")
        # "Nope" keeps it.
        p.click('#confirm-dlg button[value="no"]')
        expect(p.locator("#confirm-dlg")).not_to_have_attribute("open", "")
        expect(p.locator(f'#feed li[data-id="{r2[0]}"]')).to_have_count(1)
        feed_item(p, r2[0]).locator("[data-act=del-roll]").click()
        p.click("#confirm-yes")
        expect(p.locator(f'#feed li[data-id="{r2[0]}"]')).to_have_count(0)
        del model.rolls[r2[0]]
        check_board(adm, model, "after admin delete roll")

        # Rename Ana via admin "Edit name / belt".
        print("admin rename")
        new_ana = f"Ana2 {RUN}"
        p.click(f'#board li[data-id="{a}"]')
        expect(p.locator("#player-body h2")).to_have_text(names["ana"])
        p.click("#player-body [data-act=admin-edit-player]")
        expect(p.locator("#rename-wrap")).to_be_visible()
        p.fill("#edit-name", new_ana)
        p.click("#edit-player-form button[type=submit]")
        expect(p.locator("#edit-player-dlg")).not_to_have_attribute("open", "")
        expect(p.locator(f'#board li[data-id="{a}"] .name')).to_have_text(new_ana)
        model.players[a] = new_ana

        # Delete the XSS player (and their roll).
        print("admin delete player")
        p.click(f'#board li[data-id="{x}"]')
        expect(p.locator("#player-body h2")).to_have_text(names["xss"])
        p.click("#player-body [data-act=del-player]")
        expect(p.locator("#confirm-dlg")).to_have_attribute("open", "")
        expect(p.locator("#confirm-text")).to_contain_text("1 roll.")
        p.click("#confirm-yes")
        expect(p.locator(f'#board li[data-id="{x}"]')).to_have_count(0)
        expect(p.locator(f'#feed li[data-id="{rx[0]}"]')).to_have_count(0)
        del model.players[x]
        del model.rolls[rx[0]]
        created.remove(x)
        # Expected now: Caio 4 (1W 0D 1L... see model) etc. Verify from model everywhere.
        check_board(adm, model, "after admin delete player")
        st = api_state(request)
        PROBLEMS.check(all(r["a"] != x and r["b"] != x for r in st["rolls"]), "deleted player's rolls still in DB")

        # Other friends see the recomputed board after a refresh.
        for f in (ana, bia, caio):
            f.reload()
            check_board(f, model, f"recomputed board seen by {f.label}")
        expect(ana.page.locator("#me-chip .who")).to_have_text(new_ana)
        # The deleted player's device falls back to the welcome screen.
        xss.reload()
        expect(xss.page.locator("#welcome")).to_be_visible()
        PROBLEMS.check(xss.me_id() is None, "deleted player still remembered on their device")

        # ---- phone screenshots of admin feed --------------------------------
        print("admin on phone")
        admp = friend("AdminPhone", "phone")
        admp.open()
        admp.page.click(f'#who-list .who-btn[data-id="{paloma}"]')
        admp.page.fill("#admin-pw", ADMIN_PW)
        admp.page.click("#admin-form button[type=submit]")
        expect(admp.page.locator("#admin-tag")).to_be_visible()
        admp.page.locator("#feed").scroll_into_view_if_needed()
        admp.check_no_hscroll("admin feed")
        admp.shot("admin_feed")
        admp.shot("admin_full", full=True)

        # ---- layout stress: a 24-char wide name on the phone -----------------
        print("long name on phone")
        lng = friend("Long", "phone")
        lng.open()
        ln = signup(lng, names["long"], "black", 4)
        created.append(ln)
        model.players[ln] = names["long"]
        lng.check_no_hscroll("board with a long name")
        log_roll(lng, c, "a", "Bow and arrow choke", f"e2e {RUN} long", shot="dlg_log_roll_longname")
        lng.check_no_hscroll("board with a long name after roll")
        lng.page.click(f'#board li[data-id="{ln}"]')
        lng.check_no_hscroll("long-name profile")
        lng.shot("dlg_profile_longname")
        lng.page.keyboard.press("Escape")
        lng.shot("leaderboard_longname", full=True)

        check_clean(friends)
    finally:
        # Clean up everything this run created, even after a failure.
        for pid in created:
            request.delete(f"{API}/players/{pid}", headers={"x-admin-password": ADMIN_PW})
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
