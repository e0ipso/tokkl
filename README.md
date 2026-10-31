<h1><img src="docs/brand/tokkl-wordmark.png" alt="Tokkl" width="320"></h1>

A self-hosted time tracker modeled on Toggl Track, with private workspaces for each account and a choice of SQLite, PostgreSQL, MySQL or MariaDB. One server serves the web app and a subset of Toggl Track API v9 and Reports API v3, with no outbound requests or telemetry.

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

By default, data lives in `data/tokkl.sqlite`, with SQLite's `-wal` and `-shm` files. Select a server database or another SQLite path with `TOKKL_DATABASE_URL`. Settings → Data provides account/workspace JSON restore and CSV export; see [backups](#backups-and-restore).

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
| `TOKKL_DATA_DIR` | `./data` | Default SQLite folder |
| `TOKKL_DATABASE_URL` | absent | Database selector; absence selects `<data dir>/tokkl.sqlite`. An empty or invalid value fails startup. |
| `TOKKL_TRUST_PROXY` | `false` | Trust one proxy hop: the last `X-Forwarded-For` entry supplies the client address for login rate limiting; `X-Forwarded-Proto: https` enables Secure cookies and HSTS. Enable only if the app is reachable through that proxy alone. |
| `TOKKL_SESSION_DAYS` | `30` | New-session lifetime until overridden on the Admin page; existing expiries stay unchanged. |
| `TOKKL_SETUP_CODE` | random | Fixed first-admin setup code for scripted installs |
| `TOKKL_WEB_ROOT` | `dist/web` | Built web app folder |

## Database selection

The tested engines are SQLite 3.53.4, PostgreSQL 18.6, MySQL 8.4.13 and MariaDB 11.8.9. PostgreSQL 18, MySQL 8.4 and MariaDB 11.8 are the accepted server version lines. MySQL and MariaDB have separate selectors. The production image uses Node 24.22.0 and its built-in SQLite driver.

Set one selector before `npm start`, or supply it through the container environment. These examples use placeholder credentials and a private database hostname:

```sh
export TOKKL_DATABASE_URL='sqlite:///absolute/path/tokkl.sqlite'
export TOKKL_DATABASE_URL='postgres://tokkl:REPLACE_ME@db.example.test:5432/tokkl?sslmode=verify-full'
export TOKKL_DATABASE_URL='mysql://tokkl:REPLACE_ME@db.example.test:3306/tokkl?sslmode=verify-full'
export TOKKL_DATABASE_URL='mariadb://tokkl:REPLACE_ME@db.example.test:3306/tokkl?sslmode=verify-full'
```

Choose one line. `postgresql://` also selects PostgreSQL. SQLite paths must be absolute, without query parameters or dot segments. `sqlite::memory:` is temporary and loses all data at process exit.

Percent-encode username, password and database components separately. For example, a password `p@ss:word` becomes `p%40ss%3Aword`. Shell-quote the entire URL and keep credentials out of committed files and command logs. Supply container secrets through your deployment's protected environment configuration. The application redacts database credentials from startup errors; the first-admin setup code remains a secret printed intentionally at first startup.

Server connections verify the certificate chain and the configured hostname or IP address by default. For a private CA, append `&sslrootcert=%2Frun%2Fsecrets%2Fdatabase-ca.pem` and mount that readable PEM file in the application container. The certificate must cover the URL host, including an IP subject alternative name when using an IP. Only `sslmode=verify-full` and `sslmode=disable` are accepted. Use `disable` only for an intentionally unencrypted local/private test connection. There is no certificate-verification bypass mode.

Optional server URL parameters are:

| Parameter | Default | Accepted range or values |
|---|---|---|
| `pool_max` | `5` | `1`–`20` writer connections; the report reader has a separate one-connection pool |
| `connect_timeout_ms` | `5000` | `100`–`60000`; connection establishment and pool acquisition deadline |
| `query_timeout_ms` | `30000` | `100`–`300000`; query deadline |
| `sslmode` | `verify-full` | `verify-full` or `disable` |
| `sslrootcert` | system trust | Absolute readable CA PEM path, percent-encoded in the URL; requires `verify-full` |

Unknown or repeated URL options are errors. MySQL/MariaDB queue at most 20 times the pool size while waiting for a checkout; late checkouts after a deadline are released. SQLite uses a five-second busy timeout and serializes writes. Recognized deadlock/serialization failures retry only after acknowledged rollback, up to three attempts by default. An uncertain commit is never replayed automatically.

Provision an empty dedicated database and grant the application user schema/migration and data access. PostgreSQL needs permission to create its tables and indexes in the selected schema. MySQL/MariaDB also need trigger creation. With MySQL binary logging enabled, the operator must configure the permissions or `log_bin_trust_function_creators` needed for trigger creation; Tokkl does not change server globals. The disposable test service enables this setting explicitly.

Startup checks the selected engine version, acquires migration ownership, initializes an empty database or validates the recognized migration ledger and schema, then starts HTTP. It refuses an unrelated, legacy, dirty or inconsistent schema. There is no automatic conversion of legacy SQLite files, no fallback to another engine and no replacement database after a connection failure. `TOKKL_DATABASE` and `TIMETRACK_DATABASE` do not select storage. Without an explicit URL, either variable or a `timetrack.sqlite` in the data directory causes startup refusal. Pointing a URL at an unsupported legacy file still refuses it. Export data with an application that can read that schema and keep an independent backup before selecting a fresh database.

`GET /healthz` probes storage. On SIGTERM/SIGINT, the server stops accepting requests, closes streams and report workers, drains storage work and closes pools. HTTP connections have a ten-second drain deadline. In-flight reports can be cancelled; clients should reconnect after a restart.

## Backups and restore

Settings → Data exports the signed-in account's accessible workspace data. JSON restore maps records into the importing account's default workspace, skips duplicates and reports records it cannot import. It preserves imported entry times. It does not restore credentials, API tokens, sessions, invites, instance settings or all accounts. It is not a lossless instance migration between database engines.

For a full instance backup, stop the application and use your database's consistent backup procedure. With SQLite, retain the database and any `-wal`/`-shm` files as one consistent set; copying only a live main file can omit committed data. With server engines, preserve the database using the engine's backup/restore tooling and retain deployment configuration and secrets separately. Restore a full backup into the same backend and a compatible schema before starting the application. Test recovery on a disposable deployment.

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
npm test             # unit, API and storage tests; Docker required for server-engine cases
npm run typecheck
npm run check:tracker-refs
npm run build
npm run test:e2e     # builds, then runs Playwright tests
npm run test:backends # complete HTTP matrix and storage/migration/concurrency suites
npm run test:backends -- --suite postgres # one CI leg: sqlite|postgres|mysql|mariadb|storage
docker buildx build --platform linux/amd64 --load -t tokkl:local .
npm run test:container -- --image tokkl:local # all four native-image lifecycle checks
npm run bench:history -- --backend sqlite --fixtures year,decade --no-browser --out /tmp/tokkl-history.json
```

The backend suites and container smoke create isolated databases with random credentials using digest-pinned service images, then remove their owned resources. They require Docker. The benchmark accepts `--backend sqlite|postgres|mysql|mariadb`, uses disposable storage and refuses operator database URL variables. It measures 3,000/30,000-entry fixtures with correctness checks and native query plans; timings are observations, not CI thresholds. Run heavy suites and benchmarks separately to avoid competing for resources. CI requires every backend leg, storage tests and both image architecture builds before release.

`packages/` contains `api` for Express and storage, `web` for React/Vite, `common` for shared helpers, and `types` for API types. Browser tests live in `e2e/` and tooling in `scripts/`. Desktop CMake builds are separate; follow the companion guides above. See [brand assets](docs/brand/README.md).

Use [Conventional Commits](https://www.conventionalcommits.org/) without co-author trailers or AI-credit lines. On main, `feat`, `fix`, `perf`, `refactor` and `revert` trigger semantic-release; `docs`, `build`, `ci`, `test`, `style` and `chore` do not.

[MIT license](LICENSE).
