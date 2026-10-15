<h1><img src="docs/brand/tokkl-wordmark.png" alt="Tokkl" width="320"></h1>

A self-hosted, single-user time tracker modeled on Toggl Track. It runs on a server you own, keeps every entry in one SQLite file, and answers on a subset of the Toggl Track API v9 and Reports API v3. Scripts and libraries written for Toggl can switch to it by changing the base URL.

The server makes no outbound requests. No telemetry, CDN fonts or AI features.

Product requirements and feature status are in [docs/PRD.md](docs/PRD.md).

## What it does

- Timer with one running entry, continue, autocomplete, favorites (`1` to `9`), and Toggl's shortcuts (`N`, `S`, `C`, `M`, `?`).
- Manual mode that understands `9`, `930`, `9:30`, `4pm`, entries across midnight, and durations like `1h 30m`, `90`, `1,5h`.
- Day-grouped history with no 90-day limit, inline edits, grouping of similar entries, bulk edit, duplicate, split, undo and a trash.
- Projects (colors, clients, rates, estimates, tasks), clients, tags.
- Summary, detailed and weekly reports with filters, billable amounts, rounding, CSV export, and bookmarkable URLs.
- Import of Toggl Track's detailed CSV export (safe to repeat), CSV and JSON export, and restore from the JSON export.
- Works on phones; installable as a PWA.

## Screenshots

The data is synthetic: three clients, five projects and five weeks of weekday entries, with one timer running. One client and one project are archived. `npm run screenshots` regenerates the images from that data, as [README screenshots](#readme-screenshots) explains.

**Timer.** The running entry is at the top and history is grouped by day. Favorites are bold numbered pills under the timer, and the sidebar lists Timer, Reports, Projects, Clients, Tags, Trash and Settings.

![Timer with a running entry and day-grouped history](docs/screenshots/desktop-timer.png)

**Calendar.** A week view in the account's timezone. Drag on an empty slot to add an entry, drag a block to move it, or drag its bottom edge to change the end.

![Week calendar](docs/screenshots/desktop-calendar.png)

**Summary report.** Totals, billable share, amounts, a daily chart and a project breakdown, for any range with filters.

![Summary report](docs/screenshots/desktop-reports-summary.png)

**Detailed and weekly reports.** Every matching entry, sorted and paged on the server, and a project-by-week grid.

![Detailed report](docs/screenshots/desktop-reports-detailed.png)

![Weekly report](docs/screenshots/desktop-reports-weekly.png)

**Projects.** Clients, rates, tracked time and estimate progress.

![Projects](docs/screenshots/desktop-projects.png)

**On a phone.** The same timer, calendar and reports, with a bottom bar for Timer, Reports, Projects, Settings and More.

<p>
  <img src="docs/screenshots/mobile-timer.png" alt="Timer on a phone" width="260">
  <img src="docs/screenshots/mobile-calendar.png" alt="Calendar on a phone" width="260">
  <img src="docs/screenshots/mobile-reports.png" alt="Summary report on a phone" width="260">
</p>

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

All data is in `tokkl.sqlite` (plus its `-wal` and `-shm` files) inside the data folder. Settings → Data also exports everything as JSON and all entries as CSV, and restores the JSON export.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `TOKKL_DATA_DIR` | `./data` | Folder for the database |
| `TOKKL_DATABASE` | `<data dir>/tokkl.sqlite` | Database file path |
| `TOKKL_TRUST_PROXY` | `false` | Trust one reverse proxy hop. The client address for login rate limiting then comes from the last `X-Forwarded-For` entry, and `X-Forwarded-Proto: https` makes the session cookie `Secure` and turns on HSTS. Set it only when the app is reachable through the proxy alone. |
| `TOKKL_SESSION_DAYS` | `30` | Login session lifetime |
| `TOKKL_SETUP_CODE` | random | Fixed first-run setup code, for scripted installs |
| `TOKKL_WEB_ROOT` | `dist/web` | Folder with the built web app |

## Moving from Toggl Track

1. In Toggl Track open Reports → Detailed, pick a date range (a year at a time works well), and export CSV. Set your Toggl duration format to "Improved" first.
2. In Tokkl set your timezone in Settings to the one your Toggl profile uses. Times in the CSV are read in that timezone.
3. Settings → Data → Import from Toggl Track. The preview shows what would be created; then import.

Clients, projects, tasks and tags are created as needed. Rows that match an existing entry are skipped, so overlapping files or a second run do no harm. Project colors and rates are not in Toggl's CSV; set them afterwards on the Projects page.

## Using the Toggl-compatible API

Find your API token under Settings → API token. Authentication is the same as Toggl's. In these examples `$TOKKL_URL` is wherever the server is reachable:

```sh
curl -u "$TOKEN:api_token" $TOKKL_URL/api/v9/me
curl -u "$TOKEN:api_token" $TOKKL_URL/api/v9/me/time_entries/current

# Start a timer
curl -u "$TOKEN:api_token" -H 'Content-Type: application/json' \
  -d '{"description":"Deep work","start":"'"$(date -u +%FT%TZ)"'","duration":-1,"created_with":"curl","workspace_id":1}' \
  $TOKKL_URL/api/v9/workspaces/1/time_entries

# Summary report
curl -u "$TOKEN:api_token" -H 'Content-Type: application/json' \
  -d '{"start_date":"2026-10-01","end_date":"2026-10-31","grouping":"projects","sub_grouping":"time_entries"}' \
  $TOKKL_URL/reports/api/v3/workspace/1/summary/time_entries
```

Your workspace id is `default_workspace_id` in `GET /api/v9/me`.

Most Toggl apps hardcode `api.track.toggl.com` and cannot be redirected (Raycast, Obsidian, `toggl-cli`, Timery, Toggl's own apps). Libraries that accept a base URL work, for example `toggl-client` (`TOGGL_BASE_URL`), `toggl-track` (`baseURL`), `toggl-api` (`apiUrl`) and `toggl_python` (`base_url`). The PRD lists implemented endpoints and the behavior decisions in [section 6](docs/PRD.md#6-toggl-api-compatibility).

## Development

Requires Node.js 24 or newer.

```sh
npm install
npm run dev        # API server on :8080, restarts on change
npm run dev:web    # Vite dev server on :5173, proxies /api and /reports to :8080
npm test           # unit and API tests (node --test)
npm run typecheck  # tsc over every package, e2e, scripts and bench
npm run build      # builds the web app into dist/web
npm run test:e2e   # builds, then runs the Playwright browser tests
npm run screenshots  # builds, then rewrites docs/screenshots/*.png
npm run icons      # derives the served icons from docs/brand (needs ImageMagick 7)
```

The repo is an npm workspaces monorepo. Run every script from the repo root. The server runs TypeScript directly through Node's type stripping, so only the web app has a build step. Layout:

```
packages/api     @tokkl/api: Express app, Toggl v9 and Reports v3 routes, SQLite models, import/export (src/, test/)
packages/web     @tokkl/web: React app, built by Vite into dist/web
packages/common  @tokkl/common: duration, time-of-day and timezone helpers used by the API and the web app
packages/types   @tokkl/types: type declarations for the JSON the API and the web app exchange
e2e/             Playwright tests
scripts/         README screenshot and app icon generators
bench/           history-scale measurements
docs/            PRD.md (product requirements), brand/ and screenshots/
```

