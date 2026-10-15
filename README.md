<h1><img src="docs/brand/tokkl-wordmark.png" alt="Tokkl" width="320"></h1>

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

### Upgrading from Timetrack

Tokkl used to be called Timetrack. An existing install keeps working after the upgrade:

- Each `TOKKL_*` variable falls back to its old `TIMETRACK_*` name, for example `TIMETRACK_DATA_DIR`. The server logs one deprecation line at startup listing the old names it used. Rename them when convenient, since a later release may drop the fallback.
- When `TOKKL_DATABASE` is not set, `tokkl.sqlite` does not exist and the data folder has a `timetrack.sqlite`, the server keeps using `timetrack.sqlite` and logs that. It never moves or renames the file. To switch to the new name, stop the server and rename the file, plus any `-wal` and `-shm` files, to `tokkl.sqlite`.
- Browsers stay signed in: the old `tt_session` cookie and `X-Timetrack-CSRF` header are still accepted, and the next login issues `tokkl_session`.
- JSON exports made by Timetrack still restore.

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
npm test           # unit and API tests in packages/api, packages/common and packages/web (node --test)
npm run typecheck  # tsc over the four packages, e2e (with the Playwright config), scripts and bench
npm run build      # builds the web app (packages/web) into dist/web
npm run test:e2e   # builds the web app, then runs the Playwright browser tests
npm run screenshots  # builds the web app, then rewrites docs/screenshots/*.png
npm run icons      # derives the served icons and wordmark images from docs/brand (needs ImageMagick 7)
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

`e2e/visual.spec.ts` compares screenshots of the Timer list and calendar, the Reports summary, Projects and Settings, in light and dark, at desktop and phone sizes, against the PNGs in `e2e/visual.spec.ts-snapshots/`. It restores `e2e/fixtures-data/transfer/restore-full.json` and fixes the browser clock at 16 July 2026, so the pages look the same on every run. The baselines come from the headless Chromium that matches the pinned Playwright version, and a different Chromium build or a Playwright upgrade can shift the rendering. After a change that is meant to alter how a page looks, rebuild and regenerate the baselines, check the new images, and commit them:

```sh
npm run build && npx playwright test visual --update-snapshots
```

### README screenshots

`npm run screenshots` builds the web app, then rewrites the nine images in `docs/screenshots`. Run it after a visible UI change and commit the images with the change.

It uses its own Playwright config, `scripts/screenshots.config.ts`, so `npm run test:e2e` never runs it. The server starts on a throwaway database in a temporary directory. The script loads `e2e/fixtures-data/transfer/restore-full.json` through the JSON restore, together with the extra client, projects and five weeks of entries defined in `scripts/screenshots-data.ts`. The server and browser clocks are fixed at Thursday 16 July 2026, 15:20 in Europe/Madrid, so repeated runs on the same machine write identical files. Desktop images are 1440x900 and phone images 390x844, both at device scale factor 2, in the light theme.

`CHROMIUM_PATH` works as for the e2e tests. `SCREENSHOTS_PORT` changes the server port (default 8096).

### Brand artwork and icons

The wordmark and the stopwatch icon are the owner's artwork. The full-size files live in `docs/brand/` and are not served: `tokkl-wordmark-v3.png`, `tokkl-logo-v4.png`, `tokkl-icon-v4-1024.png`, and the smaller sizes the owner supplied, `tokkl-icon-v4-512.png`, `tokkl-icon-v4-192.png` and `tokkl-favicon-v4-32.png`.

`npm run icons` (`scripts/icons.ts`) derives the files the app serves from them:

- `packages/web/public/favicon-32.png` and `icon-192.png`, copied as supplied.
- `packages/web/public/icon-512.png`, reduced to 256 colours.
- `packages/web/public/apple-touch-icon.png`, 180x180 on the light theme's `--bg`, because iOS paints transparent corners black.
- `packages/web/public/brand/icon-96.png` and `wordmark-260.png` / `wordmark-520.png` for `Brand.tsx`, and `docs/brand/tokkl-wordmark.png` for the header of this README.

It uses ImageMagick 7 (`magick`), because the larger images only stay under 100 KB each as 256-colour PNGs, which Chromium cannot write. Run it after replacing a file in `docs/brand/` and commit the outputs with it. The same ImageMagick build writes identical files on every run.

The manifest lists only the 192 and 512 PNGs. None is marked `maskable`, because the artwork does not fit the maskable safe zone.

### History-scale measurements

`npm run bench:history` builds the web app, then times the server against generated histories. Use it to compare commits on the same machine. It is not a pass/fail speed test.

```sh
npm run bench:history                                  # year and decade fixtures, 7 runs per heavy request
npm run bench:history -- --fixtures year --no-browser   # quicker
npm run bench:history -- --out results.json --end-date 2026-10-13
```

For each fixture it starts `node packages/api/src/index.ts` on its own port (`--port`, default 8190) with a new temporary data directory, which it deletes on exit. It ignores any `TOKKL_*` or `TIMETRACK_*` variables in your environment, so it never opens `./data` or another real database, and it makes no outside requests. The fixtures are generated from a fixed seed and loaded through the JSON restore:

- `year`: 3,000 entries over 365 days.
- `decade`: 30,000 entries over 3,650 days, the 30k-entry comparison fixture from the 2026-10-14 audit.

Both have 30 projects with one task each, 5 clients, 5 tags and 40 descriptions, about 8 entries a day ending yesterday (UTC) unless you pass `--end-date`.

It times the JSON restore, entry and project lists, the summary, totals-only, weekly and paged detailed reports, both CSV exports, a 1,000-row Toggl CSV import preview, entry create/update/delete, and timer start/stop on an idle server and while a whole-history CSV export runs. Unless you pass `--no-browser`, it also times the timer page and the summary report page in Chromium (`CHROMIUM_PATH` works as for the e2e tests). The output records Node, OS, CPU, memory, load average and commit, plus the fixture dates and sizes.

Every response is checked as well as timed: totals and billable totals against the generated data, per-project tracked time, group sums, page counts and the last page, the 500-row page limit, CSV row counts, that a CSV preview stores nothing, and that report payloads grow with groups and buckets rather than entries. A wrong answer makes the command exit 1. Timings never fail it. They measure the machine you run on, while the latency targets in [docs/PRD.md section 9](docs/PRD.md#9-non-functional-requirements) are for a low-power CPU.

## Font

Headings, the running clock and report totals use [Anybody](https://github.com/Etcetera-Type-Co/Anybody) by Etcetera Type Co., under the SIL Open Font License 1.1. The variable woff2 and its licence are in `packages/web/public/fonts/` and the server ships them itself. Source: https://github.com/Etcetera-Type-Co/Anybody/blob/fe7b55cf9d1563348ad95ac8e05f43b81a420c31/fonts/variable/Anybody%5Bwdth,wght%5D.woff2, renamed to `anybody-wdth-wght.woff2` and otherwise unchanged. Body text, controls and tables use the system font stack.
