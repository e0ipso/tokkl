<h1><img src="docs/brand/tokkl-wordmark.png" alt="Tokkl" width="320"></h1>

A self-hosted time tracker modeled on Toggl Track, with private workspaces for each account and one SQLite database. One server serves the web app and a subset of Toggl Track API v9 and Reports API v3, with no outbound requests or telemetry.

## What it does

- Timer, pause/resume, favorites, shortcuts and Pomodoro sessions.
- Manual entries, history, calendar, bulk edits and trash.
- Projects, clients, tasks and tags; summary, detailed and weekly reports with billable amounts.
- Repeat-safe Toggl CSV import, CSV export and JSON backup/restore.
- Mobile PWA; KDE, macOS and GNOME companions.

[Product requirements and feature status](docs/PRD.md).

![Timer with a running entry and day-grouped history](docs/screenshots/desktop-timer.png)

<img src="docs/screenshots/mobile-calendar.png" alt="Calendar on a phone" width="260">

## Running

Requires Node.js 24 or newer. Run from the repository root:

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:8080` and create the first admin with the setup code from the server log. Admins share one-use invite and password-reset links manually; no email is sent. Admins cannot access other accounts' workspaces.

The Admin page manages accounts, session and invite lifetimes, and time resolution. Stopped entries snap to a five-minute grid by default, so saved timestamps can differ from those submitted. Entries that round to zero are refused or trashed. CSV imports and JSON restores keep entry times from the file without snapping. See [time-resolution behavior](docs/PRD.md#63-behavior-details-that-clients-depend-on).

By default, data lives in `data/tokkl.sqlite`, with SQLite's `-wal` and `-shm` files. Settings → Data provides JSON backup/restore and CSV export.

## Running with Docker

The image supports amd64 and arm64, with version tags `X.Y.Z`, `X.Y`, `X` and `latest`. Mount `/data` for persistence:

```sh
docker run -d --name tokkl -p 8080:8080 -v tokkl-data:/data ghcr.io/e0ipso/tokkl:1
docker logs tokkl    # first-admin setup code
```

The container runs as UID 1000 and writes only to `/data`, its default `TOKKL_DATA_DIR`. With `--user`, mount a directory owned by that UID. Pass configuration with `-e`. Disposable storage needs `--tmpfs /data:mode=1777`; plain tmpfs is unwritable. Its data disappears when the container stops.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `TOKKL_DATA_DIR` | `./data` | Database folder |
| `TOKKL_DATABASE` | `<data dir>/tokkl.sqlite` | Database file path |
| `TOKKL_TRUST_PROXY` | `false` | Trust one proxy hop: the last `X-Forwarded-For` entry supplies the client address for login rate limiting; `X-Forwarded-Proto: https` enables Secure cookies and HSTS. Enable only if the app is reachable through that proxy alone. |
| `TOKKL_SESSION_DAYS` | `30` | New-session lifetime until overridden on the Admin page; existing expiries stay unchanged. |
| `TOKKL_SETUP_CODE` | random | Fixed first-admin setup code for scripted installs |
| `TOKKL_WEB_ROOT` | `dist/web` | Built web app folder |

## Behind a reverse proxy

The apps follow the timer through a Server-Sent Events stream at `GET /api/app/timer/events`. The server sends a `keep-alive` event every 25 seconds and sets `X-Accel-Buffering: no`. A proxy must not buffer that response, and its read timeout must be well above 25 seconds. Otherwise the stream drops, or goes a minute without a keep-alive, and the clients fall back to polling every 30 seconds. nginx honours the header, and this location block sets both explicitly:

```nginx
location /api/app/timer/events {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Each user may hold 10 streams. Opening an 11th closes the oldest.

## Moving from Toggl Track

1. Set Toggl's duration format to "Improved", then export Reports → Detailed as CSV.
2. Set Tokkl's timezone in Settings to match your Toggl profile.
3. Use Settings → Data → Import from Toggl Track to preview and import.

Imports create clients, projects, tasks and tags as needed and skip matching entries, so overlapping files are safe. Set project colors and rates afterwards; Toggl's CSV omits them.

## Using the Toggl-compatible API

Tokkl implements a [subset of Track API v9 and Reports API v3](docs/PRD.md#6-toggl-api-compatibility). Clients must accept a custom base URL and stay within supported endpoints and parameters. Many Toggl apps hardcode Toggl's hostname; see [client compatibility and limits](docs/PRD.md#64-honest-limits).

Find your token under Settings → API token. HTTP Basic auth accepts `<token>:api_token` or `<email>:<password>`. Password changes and resets replace the token; update saved credentials. Fetch `default_workspace_id` before making workspace requests:

```sh
curl -u "$TOKEN:api_token" "$TOKKL_URL/api/v9/me"
```

Track and Reports base URLs are `$TOKKL_URL/api/v9` and `$TOKKL_URL/reports/api/v3`. Stopped-entry rounding applies to API writes too.

## Desktop companions

Desktop timer companions ship separately on [GitHub releases](https://github.com/e0ipso/tokkl/releases). See installation, supported systems and builds:

- [KDE Plasma panel widget](desktop/kde/README.md)
- [macOS menu bar app](desktop/macos/README.md)
- [GNOME Shell extension and timer service](desktop/gnome/README.md)

## Development

Run scripts from the root of this npm workspaces monorepo:

```sh
npm ci
npm run dev          # API on :8080, restarts on change
npm run dev:web      # Vite on :5173, proxies API requests; use a second terminal
npm test             # unit and API tests
npm run typecheck
npm run check:tracker-refs
npm run build
npm run test:e2e     # builds, then runs Playwright tests
```

`packages/` contains `api` for Express/SQLite, `web` for React/Vite, `common` for shared helpers, and `types` for API types. Browser tests live in `e2e/` and tooling in `scripts/`. Desktop CMake builds are separate; follow the companion guides above. See [brand assets](docs/brand/README.md).

Use [Conventional Commits](https://www.conventionalcommits.org/) without co-author trailers or AI-credit lines. On main, `feat`, `fix`, `perf`, `refactor` and `revert` trigger semantic-release; `docs`, `build`, `ci`, `test`, `style` and `chore` do not.

[MIT license](LICENSE).
