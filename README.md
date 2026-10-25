# https://palomaliz.com.br/

My personal website, built with plain HTML / CSS and JavaScript (no framework, no build step).

## Structure

```
index.html                     Home page (project cards + filter)
customprojects/<slug>/index.html  One page per project
cookie.html                    Easter egg (/cookie)
curriculum.html                Curriculum (EN / PT)
404.html                       Not found page
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
