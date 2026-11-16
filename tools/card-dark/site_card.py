"""Screenshot the home page hero (800x600, toggle hidden) in light and dark: the "This Website" card images.
Serve the repo first (python -m http.server 8798 --bind 127.0.0.1), then:
    python tools/card-dark/site_card.py <out_dir>   ->  website-light.png / website-dark.png
Copy website-dark.png to static/media/website/card-dark.png (website-light.png matches the existing card.png)."""
import sys
from playwright.sync_api import sync_playwright
S = sys.argv[1]
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome')
    for scheme in ('light', 'dark'):
        ctx = b.new_context(viewport={'width': 800, 'height': 600}, color_scheme=scheme)
        pg = ctx.new_page()
        pg.goto('http://127.0.0.1:8798/', wait_until='networkidle')
        pg.add_style_tag(content='.theme-toggle { display: none !important; }')
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{S}/website-{scheme}.png')
        ctx.close()
    b.close()
