# MyDrive — /mydrive/

Paloma's private cloud: upload files from the computer, download them on the phone, byte for byte
(no compression, no resizing). Behind a login. Not published (tools/ is in `.assetsignore`).

## Files
| Path | What |
|---|---|
| `mydrive/index.html`, `mydrive/css/`, `mydrive/js/` | the page (Portuguese UI). `sketch.css` and `icons.js` are copies of the LaTeX Notebook ones (same notebook look, M2 dark palette, shared site theme key `theme`). |
| `worker/mydrive/index.js` | `/mydrive/api/*` → the Durable Object. Blocks non-GET requests without `X-MyDrive: 1` or from another Origin (CSRF). |
| `worker/mydrive/store.js` | `MyDriveStore` Durable Object (SQLite): login, sessions, brute-force limits, files in 1 MiB rows, downloads (streamed, Range supported). Route list at the top. |
| `wrangler.jsonc` | binding `MYDRIVE`, migration `mydrive-v1`, `run_worker_first` `/mydrive/api/*`. |
| `tests/mydrive/api_test.py`, `browser_test.py` | tests (below). |
| `tools/mydrive/card.html` + `render_card.py` | home-page card (`static/media/mydrive/card.png` + `card-dark.png`). |

## Login
- User **Paloma** (any case). Password = Worker secret **`MYDRIVE_PASSWORD`**, set by Paloma in the Cloudflare
  dashboard: Workers & Pages → `paloma-website` → Settings → Variables and Secrets → Add → type *Secret*.
  Without it the page says the password isn't configured. Secrets survive every deploy.
- Session cookie `md_session` (HttpOnly, Secure, SameSite=Lax, Path=/mydrive, 30 days); only its SHA-256 is
  stored. Changing the secret logs every device out. "Sair" deletes the session.
- Brute force: 5 wrong tries per IP per 15 min, 30 per hour in total → HTTP 429 (even with the right password).

## Storage (Cloudflare free plan, never billed)
- Everything is in one Durable Object ("drive"), SQLite-backed. Free plan: 5 GB of Durable Object storage per
  account, shared with Karaoke rooms and LaTeX Notebook → MyDrive caps itself at **3 GiB** (`LIMIT_BYTES`).
  Over a free limit Cloudflare refuses requests; it doesn't charge.
- Upload: the page sends 8 MiB parts (`PART`, retries 4×), the object stores 1 MiB rows (`CHUNK`, SQLite rows ≤ 2 MB),
  `/done` checks the byte count. Unfinished uploads are removed after 6 h.
- Download: `Content-Disposition: attachment` with the original name, `nosniff`, `CSP sandbox` (an uploaded HTML/SVG
  can never run on the site). Range requests work (resumable on phones).
- "Baixar tudo" clicks one download per file, 1.2 s apart (the browser may ask to allow multiple downloads).
  "Deletar tudo" asks for confirmation and deletes every file.

## Tests (2026-11-26: API 43/43, browser 19/19)
`wrangler` is installed in `C:\latex\tools\worker-dev`. Use a fresh `--persist-to` directory for the browser test
(api_test.py ends by locking the local IP out for 15 minutes):
```bash
cd /c/GITHUB/MyWebsite && export PATH="/c/Program Files/nodejs:$PATH"
/c/latex/tools/worker-dev/node_modules/.bin/wrangler dev --port 8797 --ip 127.0.0.1 --local \
  --persist-to <scratch dir> --var MYDRIVE_PASSWORD:test-pw-123
MSYS_NO_PATHCONV=1 python tests/mydrive/browser_test.py http://127.0.0.1:8797 <shots dir>
python tests/mydrive/api_test.py
```
Stopping wrangler on Windows: kill the whole node → workerd tree (a single taskkill leaves a respawning child).
