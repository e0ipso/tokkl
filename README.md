# Timetrack

A self-hosted, single-user time tracker modeled on Toggl Track. It runs on a server you own, keeps every entry in one SQLite file, and answers on a subset of the Toggl Track API v9 and Reports API v3. Scripts and libraries written for Toggl can switch to it by changing the base URL.

The server makes no outbound requests. No telemetry, CDN fonts or AI features.

The product requirements, the Toggl research behind them, and the status of each feature are in [docs/PRD.md](docs/PRD.md).

## What it does

- Timer with one running entry, continue, autocomplete, favorites (`1` to `9`), and Toggl's shortcuts (`N`, `S`, `C`, `M`, `?`).
- Manual mode that understands `9`, `930`, `9:30`, `4pm`, entries across midnight, and durations like `1h 30m`, `90`, `1,5h`.
- Day-grouped history with no 90-day limit, inline edits, grouping of similar entries, bulk edit, duplicate, split, undo and a trash.
- Projects (colors, clients, rates, estimates, tasks), clients, tags.
- Summary, detailed and weekly reports with filters, billable amounts, rounding, CSV export, and bookmarkable URLs.
- Import of Toggl Track's detailed CSV export (safe to repeat), CSV and JSON export, and restore from the JSON export.
- Works on phones; installable as a PWA.

## Running

Requires Node.js 24 or newer. The server is one process that serves the API and the web app and keeps its data in one SQLite file.

```sh
npm ci
npm run build
npm start
```

On first start the log prints a setup code:

```
No account yet. Open the web UI and use this setup code to create it: ABCD-EFGH-JKLM
```

Open the web app, enter the code, and create your account. Only someone who can read the server log can create the account.

All data is in `timetrack.sqlite` (plus its `-wal` and `-shm` files) inside the data folder. Settings → Data also exports everything as JSON and all entries as CSV, and restores the JSON export.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `TIMETRACK_DATA_DIR` | `./data` | Folder for the database |
| `TIMETRACK_DATABASE` | `<data dir>/timetrack.sqlite` | Database file path |
| `TIMETRACK_TRUST_PROXY` | `false` | Trust one reverse proxy hop. The client address for login rate limiting then comes from the last `X-Forwarded-For` entry, and `X-Forwarded-Proto: https` makes the session cookie `Secure` and turns on HSTS. Set it only when the app is reachable through the proxy alone. |
| `TIMETRACK_SESSION_DAYS` | `30` | Login session lifetime |
| `TIMETRACK_SETUP_CODE` | random | Fixed first-run setup code, for scripted installs |
| `TIMETRACK_WEB_ROOT` | `dist/web` | Folder with the built web app |

## Moving from Toggl Track

1. In Toggl Track open Reports → Detailed, pick a date range (a year at a time works well), and export CSV. Set your Toggl duration format to "Improved" first.
2. In Timetrack set your timezone in Settings to the one your Toggl profile uses. Times in the CSV are read in that timezone.
3. Settings → Data → Import from Toggl Track. The preview shows what would be created; then import.

Clients, projects, tasks and tags are created as needed. Rows that match an existing entry are skipped, so overlapping files or a second run do no harm. Project colors and rates are not in Toggl's CSV; set them afterwards on the Projects page.

## Using the Toggl-compatible API

Find your API token under Settings → API token. Authentication is the same as Toggl's. In these examples `$TIMETRACK_URL` is wherever the server is reachable:

```sh
curl -u "$TOKEN:api_token" $TIMETRACK_URL/api/v9/me
curl -u "$TOKEN:api_token" $TIMETRACK_URL/api/v9/me/time_entries/current

# Start a timer
curl -u "$TOKEN:api_token" -H 'Content-Type: application/json' \
  -d '{"description":"Deep work","start":"'"$(date -u +%FT%TZ)"'","duration":-1,"created_with":"curl","workspace_id":1}' \
  $TIMETRACK_URL/api/v9/workspaces/1/time_entries

# Summary report
curl -u "$TOKEN:api_token" -H 'Content-Type: application/json' \
  -d '{"start_date":"2026-10-01","end_date":"2026-10-31","grouping":"projects","sub_grouping":"time_entries"}' \
  $TIMETRACK_URL/reports/api/v3/workspace/1/summary/time_entries
```

Your workspace id is `default_workspace_id` in `GET /api/v9/me`.

Most Toggl apps hardcode `api.track.toggl.com` and cannot be redirected (Raycast, Obsidian, `toggl-cli`, Timery, Toggl's own apps). Libraries that accept a base URL work, for example `toggl-client` (`TOGGL_BASE_URL`), `toggl-track` (`baseURL`), `toggl-api` (`apiUrl`) and `toggl_python` (`base_url`). The PRD lists implemented endpoints and the behavior decisions in [section 6](docs/PRD.md#6-toggl-api-compatibility).

## Development

Requires Node.js 24 or newer.

```sh
npm install
npm run dev        # API server on :8080, restarts on change
npm run dev:web    # Vite dev server on :5173, proxies /api and /reports to :8080
npm test           # server and shared unit/API tests (node --test)
npm run typecheck
npm run build      # builds the web app into dist/web
npm run test:e2e   # builds the web app, then runs the Playwright browser tests
```

The server runs TypeScript directly through Node's type stripping, so there is no server build step. Layout:

```
server/src   Express app, Toggl v9 and Reports v3 routes, SQLite models, import/export
shared/      duration, time-of-day and timezone helpers used by server and web
web/src      React app
e2e/         Playwright tests
docs/PRD.md  product requirements
```

### End-to-end tests

`npm run test:e2e` runs `npm run build` first, so the browser tests always see the current UI. Then Playwright starts the server on a throwaway SQLite database in a temporary directory. Extra arguments go to Playwright, for example `npm run test:e2e -- --grep "keyboard shortcuts"`.

Test runs never download a browser. Install the Chromium headless shell that matches the pinned Playwright version once, after `npm install` and again after upgrading Playwright:

```sh
npm run test:e2e:install
```

To use a Chromium you already have instead, point `CHROMIUM_PATH` at its binary:

```sh
CHROMIUM_PATH=/path/to/chrome-headless-shell npm run test:e2e
```

If neither is available, the run stops before any test with a message that says which binary is missing and how to fix it. `E2E_PORT` changes the server port (default 8095).

Every scenario starts from an empty account. An automatic fixture in `e2e/fixtures.ts` deletes all entries, the trash, projects, clients and tags, and resets the preferences the scenarios change, before and after each test. A scenario that needs existing data seeds it through the fixture's `data` helper, so any test can run alone or in any order.

The same fixtures fail a scenario on any uncaught page error, console error (React logs errors that the page-level ErrorBoundary catches this way), failed request or error response. The failure lists what happened and keeps the trace. Requests sent without a session cookie may get 403, because that is how the app finds out it is logged out. A scenario that provokes a failed response on purpose declares it with `runtimeErrors.allowResponse({ status, method, path, reason })`. The rules live in `e2e/runtime-errors.ts`, and `e2e/guard.spec.ts` checks that the guard still catches each kind of error.
