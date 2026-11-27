"""Renders tools/mydrive/card.html to the home-page card images (light + dark twin).
    python tools/mydrive/render_card.py [C:/GITHUB/MyWebsite]
Output: static/media/mydrive/card.png and card-dark.png (800x600)."""
import sys, pathlib
from playwright.sync_api import sync_playwright

site = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'C:/GITHUB/MyWebsite')
out = site / 'static' / 'media' / 'mydrive'
out.mkdir(parents=True, exist_ok=True)
src = (site / 'tools' / 'mydrive' / 'card.html').resolve().as_uri()

with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for name, hash_ in (('card.png', ''), ('card-dark.png', '#dark')):
        p = b.new_page(viewport={'width': 800, 'height': 600})
        p.goto(src + hash_)
        p.evaluate('document.fonts.ready')
        p.wait_for_timeout(300)
        p.screenshot(path=str(out / name), clip={'x': 0, 'y': 0, 'width': 800, 'height': 600})
        print('wrote', out / name)
        p.close()
    b.close()
