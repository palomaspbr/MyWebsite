# Chacrinha Jiu-Jitsu tests

Start the full app locally first (needs Node; from the repo root):

```
npx wrangler dev --port 8788 --var JJ_ADMIN_PASSWORD:test-admin-pw
```

| Test | What it covers | Run |
|---|---|---|
| `stats.test.js` | Leaderboard math: points, tie-breaks, shared ranks, streaks, favorite finish, head-to-head | `node --test tests/jiujitsu/stats.test.js` (no server needed) |
| `test_api.py` | Every API route: validation, login/sessions/lockout, permission matrix, pending/accept/reject, bios, photos, legacy-profile claim, cascades, error format | `python -I -W ignore tests/jiujitsu/test_api.py` (~20 s; uses `127.0.0.1`, since `localhost` costs ~2 s per request from Python on Windows) |
| `test_e2e.py` | Real browser (Playwright): several friends sign up, log rolls, promotions, admin edit/delete, XSS, keyboard, sound toggle, phone layout, screenshots | `python -I tests/jiujitsu/test_e2e.py` (~25 s) |

Environment variables: `JJ_BASE` (default `http://localhost:8788`), `JJ_ADMIN_PW` (default `test-admin-pw`), `JJ_SHOTS` (screenshot folder, default `<temp>/jj-shots`). `test_api.py` takes `JJ_BASE` as the full API URL (default `http://127.0.0.1:8788/jiujitsu/api`); its legacy-profile tests need `JJ_NODE` (node.exe), `JJ_WRANGLER` (wrangler's `bin/wrangler.js`) and `JJ_PERSIST` (the `--persist-to` folder of the running `wrangler dev`) to insert passwordless players, and skip otherwise.

Tests use random name prefixes and delete the players they create, so they can run against a database that already has data. Don't point them at production.
