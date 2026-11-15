# Chacrinha Jiu-Jitsu tests

Start the full app locally first (needs Node; from the repo root):

```
npx wrangler pages dev . --port 8788 --d1 JJ_DB=local-jj --binding JJ_ADMIN_PASSWORD=test-admin-pw
```

| Test | What it covers | Run |
|---|---|---|
| `stats.test.js` | Leaderboard math: points, tie-breaks, shared ranks, streaks, favorite finish, head-to-head | `node --test tests/jiujitsu/stats.test.js` (no server needed) |
| `test_api.py` | Every API route: validation, admin auth, cascades, error format, regression tests | `python -I tests/jiujitsu/test_api.py` (slow locally, ~12 min) |
| `test_e2e.py` | Real browser (Playwright): several friends sign up, log rolls, promotions, admin edit/delete, XSS, keyboard, sound toggle, phone layout, screenshots | `python -I tests/jiujitsu/test_e2e.py` (~25 s) |

Environment variables: `JJ_BASE` (default `http://localhost:8788`), `JJ_ADMIN_PW` (default `test-admin-pw`), `JJ_SHOTS` (screenshot folder, default `<temp>/jj-shots`).

Tests use random name prefixes and delete the players they create, so they can run against a database that already has data. Don't point them at production.
