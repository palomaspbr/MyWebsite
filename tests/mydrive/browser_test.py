"""MyDrive page test (Playwright + installed Chrome) against `wrangler dev` on a FRESH local state
(the brute-force lock of api_test.py would block the login):
    wrangler dev --port 8797 --ip 127.0.0.1 --local --persist-to <new dir> --var MYDRIVE_PASSWORD:test-pw-123
    python tests/mydrive/browser_test.py [http://127.0.0.1:8797] [shots_dir]"""
import hashlib, os, sys, tempfile, pathlib
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8797'
SHOTS = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else 'tests/mydrive/shots')
SHOTS.mkdir(parents=True, exist_ok=True)
PW = 'test-pw-123'
results = []


def check(name, cond, extra=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{extra}]' if extra and not cond else ''))


tmp = pathlib.Path(tempfile.mkdtemp())
big = tmp / 'vídeo grande.mp4'
big.write_bytes(os.urandom(9 * 1024 * 1024 + 12345))
photo = tmp / 'foto.jpg'
photo.write_bytes(pathlib.Path('static/media/parkour/voltz2026-vault.jpg').read_bytes())
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
src = {big.name: sha(big), photo.name: sha(photo)}

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    ctx = b.new_context(viewport={'width': 1100, 'height': 900}, accept_downloads=True, locale='pt-BR')
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(BASE + '/mydrive/')
    page.wait_for_selector('#login-view:not([hidden])')
    check('login form shown first', page.is_visible('#login-form') and not page.is_visible('#drive-view'))
    page.screenshot(path=str(SHOTS / 'login.png'), full_page=True)
    page.fill('#login-user', 'Paloma'); page.fill('#login-pass', 'errada'); page.click('#login-btn')
    page.wait_for_function("document.querySelector('#login-err').textContent.length > 0")
    check('wrong password message', 'errados' in page.text_content('#login-err'), page.text_content('#login-err'))
    page.fill('#login-pass', PW); page.click('#login-btn')
    page.wait_for_selector('#drive-view:not([hidden])')
    check('drive after login', page.is_visible('#empty'))
    check('buttons disabled when empty', page.is_disabled('#all-btn') and page.is_disabled('#wipe-btn'))

    page.set_input_files('#file-input', [str(big), str(photo)])
    page.wait_for_function("document.querySelectorAll('#files li').length === 2", timeout=60000)
    check('two files listed after upload', page.locator('#files li').count() == 2)
    check('meter text', 'de 3 GB usados' in page.text_content('#meter-text'), page.text_content('#meter-text'))
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / 'drive-light.png'), full_page=True)

    # One download (icon button) -> identical bytes
    with page.expect_download() as d:
        page.locator('#files li').filter(has_text='foto.jpg').locator('.tools a').click()
    dl = d.value
    out = tmp / ('one_' + dl.suggested_filename)
    dl.save_as(out)
    check('single download keeps the name', dl.suggested_filename == 'foto.jpg', dl.suggested_filename)
    check('single download identical', sha(out) == src['foto.jpg'])

    # Baixar tudo -> one download per file, all identical
    got = []
    page.on('download', lambda x: got.append(x))
    page.click('#all-btn')
    page.wait_for_timeout(4500)
    names = sorted(x.suggested_filename for x in got)
    check('Baixar tudo downloads every file separately', names == sorted(src), names)
    ok = True
    for x in got:
        p = tmp / ('all_' + x.suggested_filename)
        x.save_as(p)
        ok = ok and sha(p) == src.get(x.suggested_filename)
    check('Baixar tudo files identical to the originals', ok)

    # Dark + phone screenshots
    page.evaluate("window.SiteTheme.set('dark')")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / 'drive-dark.png'), full_page=True)
    page.evaluate("window.SiteTheme.set('light')")
    phone = ctx.new_page()
    phone.set_viewport_size({'width': 390, 'height': 844})
    phone.goto(BASE + '/mydrive/')
    phone.wait_for_selector('#drive-view:not([hidden])')
    phone.wait_for_timeout(400)
    check('session survives a new tab (cookie)', phone.is_visible('#files'))
    check('no horizontal scroll on phone', phone.evaluate('document.documentElement.scrollWidth') <= 390, phone.evaluate('document.documentElement.scrollWidth'))
    phone.screenshot(path=str(SHOTS / 'drive-phone.png'), full_page=True)
    phone.close()

    # Delete one
    page.locator('#files li').filter(has_text='foto.jpg').locator('.del').click()
    page.wait_for_selector('.sheet')
    page.screenshot(path=str(SHOTS / 'confirm-delete.png'))
    page.click('.sheet .ok')
    page.wait_for_function("document.querySelectorAll('#files li').length === 1")
    check('delete one file', page.locator('#files li').count() == 1)

    # Deletar tudo (cancel first, then confirm)
    page.click('#wipe-btn'); page.wait_for_selector('.sheet'); page.click('.sheet .cancel')
    page.wait_for_timeout(300)
    check('cancel keeps files', page.locator('#files li').count() == 1)
    page.click('#wipe-btn'); page.wait_for_selector('.sheet')
    check('wipe dialog explains', 'para sempre' in page.text_content('.sheet .msg'))
    page.click('.sheet .ok')
    page.wait_for_selector('#empty:not([hidden])')
    check('Deletar tudo empties the drive', page.locator('#files li').count() == 0)

    page.reload(); page.wait_for_selector('#drive-view:not([hidden])')
    check('still logged in after reload', True)
    page.click('#logout-btn'); page.wait_for_selector('#login-view:not([hidden])')
    page.reload(); page.wait_for_selector('#login-view:not([hidden])')
    check('logout sticks after reload', not page.is_visible('#drive-view'))
    check('no console errors', not [e for e in errors if '401' not in e], errors)
    b.close()

print(f'\n{sum(results)}/{len(results)} passed')
sys.exit(0 if all(results) else 1)
