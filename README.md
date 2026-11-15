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
functions/jiujitsu/api/        Its API (Cloudflare Pages Function + D1 database)
_routes.json                   Only /jiujitsu/api/* runs the Function; everything else stays static
tests/jiujitsu/                Its API, stats and browser tests
static/style.css               Styles
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

## Chacrinha Jiu-Jitsu (/jiujitsu): one-time Cloudflare setup (free plan)

The leaderboard needs a small database. Everything below is on Cloudflare's free plan; on the free plan, going over a limit makes requests fail for the day, it never bills you. Just don't upgrade to Workers Paid.

1. **Create the database:** Cloudflare dashboard → **Storage & Databases** → **D1 SQL Database** → **Create** → name it `chacrinha-jiujitsu`. (No SQL needed: the tables are created automatically on first use.)
2. **Connect it:** **Workers & Pages** → the site's Pages project → **Settings** → **Bindings** → **Add** → **D1 database**. Variable name `JJ_DB`, database `chacrinha-jiujitsu`. Do it for **Production** (and **Preview** if you want branch previews to work).
3. **Admin password:** same project → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `JJ_ADMIN_PASSWORD`, value = the password for the Paloma admin profile.
4. **Redeploy:** **Deployments** → latest production deployment → **⋯** → **Retry deployment** (bindings only apply to new deployments).

Free plan limits that matter here: 100,000 Function requests/day (only `/jiujitsu/api/*` counts, thanks to `_routes.json`), D1 5 million rows read/day and 100,000 rows written/day.

### Run it locally

Plain `python -m http.server` serves the page but not the API. For the full app use Wrangler (needs Node):

```
npx wrangler pages dev . --port 8788 --d1 JJ_DB=local-jj --binding JJ_ADMIN_PASSWORD=test-admin-pw
```

Then open http://localhost:8788/jiujitsu/. Tests: see `tests/jiujitsu/README.md`.
