# https://palomaliz.com.br/

My personal website, built with plain HTML / CSS and JavaScript (no framework, no build step).

## Structure

```
index.html                     Home page (project cards + filter)
customprojects/<slug>/index.html  One page per project
cookie.html                    Easter egg (/cookie)
curriculum.html                Curriculum (EN / PT)
404.html                       Not found page
loaf_tower/                    Loaf Tower, a cat-stacking browser game (/loaf_tower)
jiujitsu/                      Chacrinha Jiu-Jitsu, leaderboard for casual BJJ rolls (/jiujitsu)
worker/index.js                Its API (Cloudflare Worker + D1 database)
karaoke/                       Karaoke Night: online karaoke parties (/karaoke)
                               pages: index (create/join), sing (guests), player (TV), control (DJ), jukebox, print
worker/karaoke/                Its API: rooms (Durable Objects), catalog (D1), YouTube search, metadata
tests/karaoke/                 Its unit tests (node --test) and API smoke test
wrangler.jsonc                 Cloudflare config: static assets + the Worker only on /jiujitsu/api/*
.assetsignore                  Repo files that are not published (tests, worker source, READMEs...)
tests/jiujitsu/                Its API, stats and browser tests
customprojects/remotedesktop/  Remote Desktop project page; download zip in static/files/
                               (built and copied by the remote-desktop repo's tools/release.ps1)
static/style.css               Styles (hand-drawn notebook look, same as Loaf Tower / Jiu-Jitsu)
static/fonts/                  Caveat Brush + Patrick Hand (OFL)
static/script.js               Project filter + language toggle
static/media/, static/files/   Images and the PDF curriculum
```

To add a project: create `customprojects/<slug>/index.html` (copy an existing one) and add a card to the `projects-grid` in `index.html`.

## Run locally

```
python -m http.server 8000
```

Then open http://localhost:8000. Paths start with `/`, so open the site through a server and not by double-clicking the files.

## Hosting (Cloudflare Pages, free)

The domain's DNS is already on Cloudflare, so the site is hosted on Cloudflare Pages, which redeploys on every push to `master`.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick `palomaspbr/MyWebsite`.
2. Build settings: framework preset **None**, build command empty, build output directory `/`. Production branch: `master`.
3. After the first deploy, open the project → **Custom domains** → add `palomaliz.com.br` (and `www.palomaliz.com.br`). Cloudflare creates the DNS records and the HTTPS certificate.
4. In **DNS** → **Records**, delete any old `A`/`AAAA`/`CNAME` records for `palomaliz.com.br` / `www` that pointed to the old DigitalOcean app if Cloudflare reports a conflict.

## Chacrinha Jiu-Jitsu (/jiujitsu): Cloudflare setup (free plan)

The site is deployed by **Workers Builds** (Worker `paloma-website`) from `wrangler.jsonc` on every push to `master`. Static files are served directly and are free and unlimited; only `/jiujitsu/api/*` runs the Worker (free plan: 100,000 requests/day). Its data lives in the D1 database `jiujitsu` (bound as `JJ_DB` in `wrangler.jsonc`; tables are created automatically on first use) (free plan: 5M rows read and 100k rows written per day). On the free plan, going over a limit makes requests fail for the day; it never bills you. Just don't upgrade to Workers Paid.

One manual step: set the admin password for the Paloma profile.
Cloudflare dashboard → **Workers & Pages** → `paloma-website` → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `JJ_ADMIN_PASSWORD`, value = the password → **Deploy**. Secrets survive later deploys.

### Run it locally

Plain `python -m http.server` serves the page but not the API. For the full app use Wrangler (needs Node):

```
npx wrangler dev --port 8788 --var JJ_ADMIN_PASSWORD:test-admin-pw
```

Then open http://localhost:8788/jiujitsu/. Tests: see `tests/jiujitsu/README.md`.

## Karaoke Night (/karaoke): Cloudflare setup (free plan)

Full docs live outside this repo, in `C:\karaoke` (ARCHITECTURE.md, DEPLOY.md, TESTING.md, FEATURES.md).
Only `/karaoke/api/*` runs the Worker. Each party is a Durable Object (`KaraokeRoom`, SQLite-backed, free plan);
the shared songbook is the D1 database `karaoke` (binding `KARAOKE_DB`).

Before the first deploy: create the D1 database `karaoke` in the dashboard and paste its ID into `wrangler.jsonc`
(replace `REPLACE_WITH_KARAOKE_D1_DATABASE_ID`). Secrets: `KARAOKE_ADMIN_PASSWORD` (catalog admin, recommended)
and `YOUTUBE_API_KEY` (optional, YouTube Data API v3 for search).

Locally: `npx wrangler dev --port 8788 --var KARAOKE_ADMIN_PASSWORD:test-catalog-pw`, then open
http://localhost:8788/karaoke/. Tests: `node --test tests/karaoke/` and `node tests/karaoke/api_smoke.mjs http://127.0.0.1:8788`.
