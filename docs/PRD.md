# Tokkl PRD

A self-hosted, single-user time tracker that copies the parts of Toggl Track one person uses, runs on a server you own, and speaks enough of the Toggl API that scripts written for Toggl keep working.

- Owner: Tokkl contributors
- Status: v0.1 built (see the status column in each table)
- Last updated: 2026-10-14

## 1. Why this exists

Toggl Track works well, but every entry, client name and billing rate sits on Toggl's servers. Its newest features send data further out: AI Insights forwards report excerpts to third-party LLM providers. For a freelancer, a time log reads like a diary of who you work for and when. I want that data on hardware I own.

The replacement has to clear a high bar. If starting a timer from my phone takes longer than it does in Toggl, I will drift back to Toggl. So the product goal is narrow: Toggl's daily-use features, the same speed, and data that never leaves the server.

### Goals

1. Start, stop and edit timers from any device on my network (laptop, phone, tablet) and see the same state everywhere within seconds.
2. Add and fix past entries quickly, including entries that cross midnight.
3. Answer "how much did I work on X last month, and what do I bill for it" without a spreadsheet.
4. Move years of Toggl history in, and get everything out again losslessly.
5. Let existing Toggl API scripts and libraries point at this server with a base URL change.
6. Run unattended as one Node process with one data folder and low idle cost.

### Non-goals

- Teams, roles, approvals, SSO, billing plans. One person uses this.
- Native desktop or mobile apps. The web app is a PWA and works on phones.
- Any outbound network traffic. No telemetry, no CDN fonts, no update checks, no AI.
- Public internet exposure as a default. The expected setup is LAN or VPN (Tailscale/WireGuard) access.

## 2. User and context

One user, who runs the server. They track client work and personal projects, sometimes bill hourly, use a laptop at a desk and a phone away from it. They are technical enough to run `docker compose up -d` and read a log line, and they care more about privacy than about integrations.

Usage pattern this design optimizes for:

- Dozens of timer starts and stops per day, mostly from the laptop.
- Occasional "I forgot to start the timer" fixes from the phone.
- Weekly or monthly reporting per client, exported to CSV for invoicing.
- A few thousand entries per year. Ten years of data is well under 100,000 rows.

## 3. Research basis

The requirements come from two research passes done on 2026-10-14:

- **Toggl Track product.** 179 Toggl knowledge base articles, the 2025 Reports redesign notes, community forum threads and review sites. Each feature got a plan tier and a MUST/SHOULD/COULD/WON'T call for a single-user clone.
- **Toggl API.** Toggl's published OpenAPI 2.0 specs for Track API v9, Reports API v3 and Webhooks, the rendered docs at engineering.toggl.com, response fixtures from the open source `toggl-go` client, and the source of 24 third-party Toggl clients.

Where Toggl's own sources disagree, this document says so and picks a behavior. Section 7 lists those calls.

## 4. Principles

1. **Data stays home.** The server makes no outbound requests. The web UI loads no third-party assets. The Content Security Policy blocks anything not served by the server.
2. **Toggl behavior by default, Toggl limits never.** Copy Toggl's semantics where users have muscle memory (one running timer, continue, grouping similar entries, `N`/`S` shortcuts). Drop the paywall and SaaS limits: no 90-day window on the timer page, no plan-gated CSV export, no capped date ranges in reports.
3. **Undo over confirm.** Deleting an entry is instant and reversible. Deleted entries go to a trash, not into the void.
4. **One timezone.** Toggl uses the browser clock on the timer page and the profile timezone in reports, so entries can jump days between the two. This app uses the account timezone everywhere.
5. **Boring infrastructure.** One process, one SQLite file. A backup is a file copy.
6. **Loud look, plain function.** The app looks like surf-shop graffiti: saturated colour, one display face, hand-made texture. Any style that costs a readable number, a reachable control or a passing test gets dropped.

### Visual direction

This is the brief every restyle ticket is checked against.

- **Palette roles.** Light theme: sand background, ink text, sunset orange primary, aqua secondary, hot pink and lime for states. Dark theme: deep navy background with a neon counterpart for each role. The design tokens ticket (TT-0067) picks the exact values.
- **Typeface.** One display face for headings, the running clock and totals. The wordmark is the owner-supplied graffiti artwork, shipped as an image named "Tokkl", so it uses no font. Body text, controls and tables use the system font stack.
- **Texture.** CSS gradients or inline SVG only, never raster images. Texture never sits behind data tables or inputs.
- **Type effects.** Rotated or skewed type is decoration only. It never appears on controls, numbers or labels.
- **Motion.** All motion sits behind `prefers-reduced-motion`. With reduced motion set, nothing animates.
- **No outbound assets.** The display face and every texture ship with the server. This restates the non-goal on outbound traffic: no CDN fonts and no other third-party assets.
- **Contrast and signals.** Both themes meet WCAG AA: 4.5:1 for text, 3:1 for non-text elements such as borders, icons and focus rings. Colour is never the only signal for a state. Section 9 has the accessibility requirement.
- **Test and device limits.** The ARIA names and class selectors the Playwright tests use stay as they are. Every page fits a 390x844 phone screen.

## 5. Functional requirements

Priority follows MoSCoW. Status is the state of this repository on 2026-10-14: **Done** means implemented and exercised by the automated tests (server tests, Playwright browser tests) or by a scripted browser run during development, **Partial** means usable with the stated gap, **Planned** means not started.

### 5.1 Timer

| ID | Requirement | Priority | Status |
|---|---|---|---|
| T1 | Start a timer from an empty bar; fill description, project, tags and billable before or after starting. | MUST | Done |
| T2 | Exactly one running entry. Starting a new one stops the old one at the new start time. Enforced by a partial unique index in SQLite, not only in code. | MUST | Done |
| T3 | Stop from the bar, with `S`, or through the API. Stopping a stopped entry returns 409 like Toggl. | MUST | Done |
| T4 | Continue: a play button on any past entry, and `C` for the latest one, creates a new entry with the same description, project, task, tags and billable flag. | MUST | Done |
| T5 | Description autocomplete from recent entries; picking one copies project, task, tags and billable. | MUST | Done |
| T6 | Edit the running entry in place, including its start time. | MUST | Done |
| T7 | Typing a duration into the idle timer and confirming saves a finished entry that ends now. | SHOULD | Done |
| T8 | `@` and `#` in an empty description open the project and tag pickers. | SHOULD | Partial: only when the description is empty; Toggl also parses them mid-text. |
| T9 | Running time in the browser tab title. | SHOULD | Done |
| T10 | Discard a running entry, with undo. | SHOULD | Done |
| T11 | Favorites: pin up to 9 entries, start them by click or number keys `1` to `9`. | SHOULD | Done (stored in preferences) |
| T12 | Pause and resume. Toggl has none; continue plus grouping covers it. | COULD | Planned |
| T13 | Idle detection, reminders, Pomodoro. These need a native app or notifications permission. | COULD | Planned |
| T14 | Start links (a URL that starts a specific timer, for iOS Shortcuts and bookmarks). | COULD | Planned |

### 5.2 Manual entry and parsing

| ID | Requirement | Priority | Status |
|---|---|---|---|
| M1 | Manual mode toggled by a button or `M`, persisted per user (`manualMode` preference, same name as Toggl). | MUST | Done |
| M2 | Start and end time fields accept `9`, `930`, `9:30`, `17.45`, `9a`, `4pm`. 12-hour users get Toggl's AM/PM guess (closest to now for the start, always after the start for the end). | MUST | Done |
| M3 | An end time earlier than the start rolls to the next day. The entry counts toward its start date, as in Toggl. | MUST | Done |
| M4 | One duration grammar everywhere: bare integer = minutes, `h:mm[:ss]`, unit suffixes (`1h 30m`, `90m`, `45s`), decimal hours with `.` or `,`. Toggl's timer and timesheet disagree on a bare `5`; this app does not. | MUST | Done |
| M5 | After adding a manual entry, the next start time defaults to the previous end, so a day can be logged in sequence. | SHOULD | Done |
| M6 | Overlapping entries are allowed, as in Toggl, and flagged with a marker in the list. | SHOULD | Done |

### 5.3 Entry list and editing

| ID | Requirement | Priority | Status |
|---|---|---|---|
| L1 | Entries grouped by day in the account timezone, with day totals and today/this-week totals. | MUST | Done |
| L2 | Inline edit of description, project/task, tags, billable and duration. Full editor for date, start, end. | MUST | Done |
| L3 | Group similar entries (same description, project, task, tags, billable) with a count badge; editing the group edits every member through the bulk API. Toggle in settings (`collapseTimeEntries`). | SHOULD | Done |
| L4 | Duplicate an entry. | MUST | Done |
| L5 | Split an entry at a time. | SHOULD | Done |
| L6 | Delete with an undo toast. | MUST | Done |
| L7 | Trash page: list deleted entries, restore, delete forever, empty trash. Toggl has no trash. | SHOULD | Done |
| L8 | Bulk select across days: set project, add tags, set billable, delete. Toggl limits bulk edit to one day on the timer page. | SHOULD | Done |
| L9 | History without a 90-day cap: "show 14 more days" keeps loading older entries. | MUST | Done |
| L10 | Calendar (week) view with drag to create, move and resize; `T` jumps to this week. | SHOULD | Done |
| L11 | Timesheet grid view (projects by weekdays, type hours into cells). | COULD | Planned |
| L12 | Free-text notes on an entry. Toggl lacks this. | COULD | Planned |

### 5.4 Projects, clients, tags, tasks

| ID | Requirement | Priority | Status |
|---|---|---|---|
| P1 | Projects with name, color (Toggl's 14-color palette plus custom hex), client, billable default, hourly rate, currency, estimate, active/archived. | MUST | Done |
| P2 | Create a project inline from the picker (`Ctrl/Cmd+Enter`). | MUST | Done |
| P3 | Picking a billable project marks the entry billable. | SHOULD | Done |
| P4 | Delete a project and choose: keep its entries without a project, or delete them. | MUST | Done |
| P5 | Clients: create, rename, notes, archive (archives its projects too, like Toggl), restore, delete. | MUST | Done |
| P6 | Tags: create inline, rename, delete (removed from entries). | MUST | Done |
| P7 | Tasks under projects, with estimates and done state. Free in this app; Toggl charges for them. | SHOULD | Done |
| P8 | Tracked time and estimate progress per project. | SHOULD | Done |
| P9 | Project templates, recurring projects, fixed fees beyond storing the value. | COULD | Planned |

### 5.5 Reports

| ID | Requirement | Priority | Status |
|---|---|---|---|
| R1 | Date presets: today, yesterday, this/last week (honoring first day of week), this/last month, last 30 days, this/last year, custom. Previous/next stepping with buttons and arrow keys. | MUST | Done |
| R2 | Filters: projects, clients, tags (each with a "without" option), billable, description contains. | MUST | Done |
| R3 | Negated filters ("tag is not paid"), with an Is / Is not switch per filter. The research marks these MUST because "not yet invoiced" depends on them. Exposed in the API as `exclude_project_ids`, `exclude_client_ids`, `exclude_tag_ids` (an extension; Toggl's API has no negation). | MUST | Done |
| R4 | Summary: total, billable, amounts per currency, bar chart over time (day/week/month buckets by range length), breakdown table with group and sub-group by project, client, tag, description or task. | MUST | Done |
| R5 | Detailed: one row per entry, sortable, editable by click. | MUST | Done |
| R6 | Weekly grid: projects by days with row and column totals. | SHOULD | Done |
| R7 | Billable amounts from project rate, falling back to the workspace default rate. | SHOULD | Done |
| R8 | Rounding per entry (up, nearest, down; 1 to 240 minutes), as a report setting that never changes stored data. The app's reports always apply the workspace setting; Toggl API report calls round only when asked, as in Toggl. | SHOULD | Done |
| R9 | CSV export of detailed and summary reports, never plan-gated. | MUST | Done |
| R10 | Report state in the URL so a report can be bookmarked. Toggl removed this in 2025. | MUST | Done |
| R11 | "All time" preset, from the first entry to today (up to ten years). | MUST | Done |
| R12 | PDF export. | SHOULD | Planned |
| R13 | Saved report definitions. | SHOULD | Planned |
| R14 | Goals (e.g. at least 30 h per week on client work) shown on the timer page. | COULD | Planned |
| R15 | Invoices generated from a report. | COULD | Planned |

### 5.6 Import, export, backup

| ID | Requirement | Priority | Status |
|---|---|---|---|
| D1 | Import Toggl's Detailed report CSV. Match columns by header name, accept both header variants, a BOM, quoted or unquoted cells, end time or duration. Create missing clients, projects, tasks and tags. Read times in the account timezone. | MUST | Done |
| D2 | Import is idempotent: rows that match an existing entry (start, stop, description, project) are skipped, so re-importing a file or overlapping yearly files is safe. | MUST | Done |
| D3 | Dry run that reports what an import would create before writing anything. | SHOULD | Done |
| D4 | Detailed CSV export in Toggl's column layout, so existing spreadsheets keep working. Cells that start with `=`, `+`, `-` or `@` are prefixed to stop spreadsheet formula injection, and the importer strips that prefix again. | MUST | Done |
| D5 | Full JSON export of every entity in Toggl v9 shapes. Never includes the password hash or API token. | MUST | Done |
| D6 | Re-import of the JSON export into this or another instance, with a preview. Clients, projects (colors, rates), tasks, tags and entries come back; preferences do not. Safe to repeat. | MUST | Done |
| D7 | Import Toggl's workspace data ZIP for project colors, rates and client links. | SHOULD | Planned |

### 5.7 Account and preferences

| ID | Requirement | Priority | Status |
|---|---|---|---|
| A1 | First-run setup protected by a one-time setup code printed in the server log, so whoever reaches the server first cannot claim the account. | MUST | Done |
| A2 | Email and password login; session cookie (HttpOnly, SameSite=Lax, Secure behind HTTPS). | MUST | Done |
| A3 | Change password (signs out other sessions), email, name. | MUST | Done |
| A4 | Timezone, first day of week, date format, 12/24-hour time, duration format (improved, classic, decimal). | MUST | Done |
| A5 | Theme: system, light, dark. | SHOULD | Done |
| A6 | API token: view, copy, reset. | SHOULD | Done |
| A7 | Keyboard shortcuts toggle and `?` help overlay. | SHOULD | Done |
| A8 | TOTP two-factor login. | SHOULD | Planned |

### 5.8 Clients and devices

| ID | Requirement | Priority | Status |
|---|---|---|---|
| C1 | Responsive web app usable on a phone: bottom navigation, timer and list on small screens. | MUST | Done |
| C2 | Installable PWA (manifest, icons). | SHOULD | Partial: the manifest ships the owner-supplied stopwatch icon as 192 and 512 pixel PNGs, with a 32 pixel PNG favicon and an opaque 180 pixel apple-touch-icon; installing on a phone is untested. |
| C3 | Cross-device freshness: the running timer refreshes every 30 s and on window focus, entries every 60 s. | MUST | Done |
| C4 | Offline outbox for timer start/stop/edit in the PWA, with an unsynced marker. Matters more here than for Toggl because a phone off the home network loses the server. | SHOULD | Planned |
| C5 | Browser extension, desktop tray app. | WON'T (v1) | n/a |

## 6. Toggl API compatibility

### 6.1 What compatible means here

A client that lets you change the base URL can talk to this server with no other change. The server implements the Track API v9 endpoints a single user touches and the Reports API v3 endpoints that clients call most.

Base URLs:

- Track API: `https://<server>/api/v9`
- Reports API: `https://<server>/reports/api/v3`

Authentication matches Toggl: HTTP Basic with `<api_token>:api_token` or `<email>:<password>`. Failures return 403.

### 6.2 Endpoints

| Area | Endpoints | Status |
|---|---|---|
| Me | `GET/PUT /me` (incl. `with_related_data`), `POST /me/reset_token`, `GET/POST /me/preferences[/{client}]`, `GET /me/workspaces`, `/me/organizations`, `/me/features`, `/me/projects`, `/me/clients`, `/me/tags`, `/me/tasks` | Done |
| Time entries (read) | `GET /me/time_entries` with `since` (includes deleted entries with `server_deleted_at`), `before`, `start_date`/`end_date`, `meta`; `GET /me/time_entries/current`; `GET /me/time_entries/{id}` | Done |
| Time entries (write) | `POST /workspaces/{wid}/time_entries`, `PUT .../{id}`, `PATCH .../{id}/stop`, `PATCH .../{ids}` (bulk JSON Patch, partial success), `DELETE .../{id}` | Done |
| Workspace | `GET/PUT /workspaces/{wid}`, `GET /workspaces/{wid}/users` | Done |
| Projects | `GET/POST /workspaces/{wid}/projects`, `GET/PUT/DELETE .../{pid}` (`teDeletionMode`) | Done |
| Tasks | `GET /workspaces/{wid}/tasks` (paged envelope, like Toggl), `GET/POST /workspaces/{wid}/projects/{pid}/tasks` (plain array), `GET/PUT/DELETE .../{tid}` | Done |
| Clients | `GET/POST /workspaces/{wid}/clients` (`status`, `name`), `GET/PUT/DELETE .../{cid}`, `POST .../{cid}/archive`, `POST .../{cid}/restore` | Done |
| Tags | `GET/POST /workspaces/{wid}/tags`, `PUT/DELETE .../{tid}` | Done |
| Reports v3 | `POST /workspace/{wid}/search/time_entries` (paging via `X-Next-ID`/`X-Next-Row-Number`), `.../search/time_entries/totals`, `.../search/time_entries.csv`, `/summary/time_entries`, `/summary/time_entries.csv`, `/weekly/time_entries` | Done |
| Reports v2 (legacy) | `details`, `summary`, `weekly` | Planned. Several older clients still call v2. |
| Webhooks | n/a | WON'T (v1) |
| Organizations, groups, invitations, approvals, SSO, billing | n/a | WON'T |

### 6.3 Behavior details that clients depend on

- Responses are bare JSON objects or arrays with explicit `null`s. No `{"data": ...}` envelope (that was v8).
- Errors are JSON-encoded strings, e.g. `"Time entry already stopped"`, with 400, 403, 404 or 409.
- Timestamps go out as RFC 3339 UTC with `+00:00`; any RFC 3339 offset is accepted on input. Times are stored with second precision.
- Legacy field aliases are emitted and accepted: `wid`/`workspace_id`, `pid`/`project_id`, `tid`/`task_id`, `uid`/`user_id`, `cid`/`client_id`.
- A running entry has `stop: null` and `duration` equal to minus its start in Unix seconds. That satisfies clients computing `now + duration` (the documented v8-era rule) and clients that only test `duration < 0`.
- Any negative `duration` on create means "running". `created_with` is accepted but optional (Toggl requires it).
- `tags` on create accepts names; unknown names are created. `tag_action: "add" | "delete"` on update modifies instead of replacing.
- `/me/time_entries` with no parameters returns entries that started in the last 9 days (Toggl v8's documented default; v9 leaves it undocumented). Date-only `end_date` is exclusive.
- Report bodies also accept `exclude_project_ids`, `exclude_client_ids` and `exclude_tag_ids` (not in Toggl).
- `/me/time_entries/current` returns `200 null` when nothing runs, as Toggl's fixtures show.
- Project and tag lists honor `page`/`per_page` when sent and return everything otherwise. Toggl pages by default (151 projects per page); one person's lists fit in one response.
- Task `tracked_seconds` is in milliseconds, because Toggl documents it that way.

### 6.4 Honest limits

Most end-user Toggl apps hardcode `api.track.toggl.com`. Of 24 clients checked, these let you change the base URL:

- `toggl-client` (npm), through `TOGGL_BASE_URL` and `TOGGL_REPORTS_URL`
- `toggl-track` (npm), through a `baseURL` option
- `toggl-api` (npm), through an `apiUrl` option
- `toggl_python`, through `base_url=` (Track API only)

The Raycast extension, the Obsidian plugin, both `toggl-cli` projects, the Alfred workflow, n8n, Timery and Toggl's own apps do not. Pointing them at the server would need DNS overrides plus a certificate they trust for `api.track.toggl.com`. That is untested and out of scope. The realistic value of compatibility is: your own scripts, the libraries above, Home Assistant or iOS Shortcuts built against Toggl's documented API, and a migration path that keeps those working.

## 7. Decisions on ambiguous Toggl behavior

| Topic | Toggl sources say | This app does | Why |
|---|---|---|---|
| Running `duration` | Docs: `-start_epoch`. Spec: "preferable -1". | Reads return `-start_epoch`; writes accept any negative. | Works for both client styles. |
| Bulk PATCH paths | Forum list includes `/start`; Toggl support says start/stop/duration are not supported. | Accepts `/description`, `/project_id`, `/task_id`, `/billable`, `/tags`, `/tag_ids`, `/start`, `/stop`, `/duration`. | A superset breaks nobody. |
| Tag create response | Spec says array, fixtures show an object. | Object. | Matches real responses. |
| Editing a stopped entry's start | Desktop has a preference; web keeps the end. | Keeps the stop, so the duration changes. | Same as the web app. |
| Midnight-crossing entries | Belong to their start date. | Same. | Imported data reconciles with Toggl reports. |
| Timezone | Timer uses device clock, reports use profile. | Account timezone everywhere. | One answer per question. |
| Bare `5` in a duration field | Timer: minutes. Timesheet: hours. | Minutes everywhere. | One grammar. |
| Autocomplete and tags | The KB says tags are not copied (unverified). | Tags are copied. | Fewer clicks; easy to change. |

## 8. Architecture

### 8.1 Overview

```
 browser / phone (PWA)          scripts, Toggl-API libraries
          |  session cookie                  |  HTTP Basic (token or password)
          v                                  v
 +------------------------- tokkl (Node 24) -----------------------------+
 |  Express 5 HTTP server                                                |
 |   /api/v9/*            Toggl Track API v9 subset                      |
 |   /reports/api/v3/*    Toggl Reports API v3 subset                    |
 |   /api/app/*           setup, login, trash, report, import, export    |
 |   /*                   built React app (static files)                 |
 |  services: time entries, reports engine, CSV import/export            |
 |  node:sqlite  -->  <data dir>/tokkl.sqlite (WAL)                      |
 +-----------------------------------------------------------------------+
```

The web UI is a client of the same Toggl-compatible API it exposes. Every timer action in the UI goes through `/api/v9`, so the compatibility layer is exercised daily, not only by tests.

### 8.2 Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 24, TypeScript run directly via type stripping | No build step for the server; one language across server, UI and shared code. |
| HTTP | Express 5 | The most widely known Node server framework. Version 5 sends rejected promises from async handlers to the error handler, so routes need no wrappers. `trust proxy` handles a reverse proxy's forwarded headers. |
| Database | SQLite through the built-in `node:sqlite` | No native module to compile, on amd64 or arm64; a single file to back up. WAL mode, foreign keys on. |
| UI | React 19, Vite, TanStack Query, wouter | Query caching and refetch-on-focus give cross-device freshness for free. |
| Shared | `packages/common` (`@tokkl/common`) modules for duration parsing, time-of-day parsing, timezone math, with their types in `packages/types` (`@tokkl/types`) | Server and UI parse `1h 30m` and midnight the same way. |

### 8.3 Data model

All instants are UTC ISO 8601 strings with second precision; calendar days are computed in the user's timezone at query time.

- `users`: email, name, scrypt password hash, API token, timezone, first day of week, preferences JSON (Toggl preference keys plus favorites).
- `sessions`: SHA-256 of the session token, expiry. The raw token exists only in the cookie.
- `workspaces`: one per account. Default currency, default rate, report rounding.
- `clients`, `projects`, `tasks`, `tags`: unique names per scope, case-insensitive.
- `time_entries`: project, task, description, start, stop (null while running), billable, `created_with`, `deleted_at` for the trash and for `since` sync.
- `time_entry_tags`: join table.

Migrations are append-only SQL, versioned with `PRAGMA user_version`, applied at startup.

### 8.4 Security

- Passwords: scrypt (N=2^15, r=8, p=1), constant-time comparison.
- API token: 128 random bits, shown in settings, resettable.
- Sessions: 256-bit random token, only its hash stored, 30-day expiry, HttpOnly and SameSite=Lax cookie, `Secure` when served over HTTPS.
- CSRF: cookie-authenticated writes must send `X-Tokkl-CSRF: 1` (the pre-rename `X-Timetrack-CSRF: 1` is still accepted), which a cross-site form cannot set and which needs a CORS preflight this server never grants.
- Brute force: 10 failed password attempts per client address per 15 minutes, across the login form, Basic auth, setup code and password change. Behind a trusted proxy the address is the last `X-Forwarded-For` hop, which the client cannot forge. Unknown emails still run a scrypt check, so response time does not reveal whether an account exists.
- Headers: strict Content Security Policy (`default-src 'self'`), `frame-ancestors 'none'`, `nosniff`, no-store on API responses. Hashed assets are cached for a year; a missing asset is a 404, never the HTML page.
- Input: request bodies capped at 1 MB (50 MB for imports), id lists in report filters capped at 1000; every field validated with Toggl-style error messages.
- First run: the account can only be created with a setup code from the server log.
- Exports never contain the password hash or API token.

## 9. Non-functional requirements

| Area | Requirement | Status |
|---|---|---|
| Latency | Timer start/stop under 100 ms server time on a low-power CPU. Reports over a year of data under 500 ms. | Not measured on low-power hardware yet |
| Reliability | Writes are transactional; one running entry guaranteed by the database. Graceful shutdown on SIGTERM. | Done |
| Privacy | Zero outbound requests from server and UI. | Done (verify with the CSP and a network log) |
| Portability | Any Linux host with Node 24 (amd64 or arm64). No native modules. | Tested on amd64 only |
| Accessibility | Keyboard reachable controls, labeled inputs, visible focus, color never the only signal. | Partial: labels, focus rings, non-colour cues (hatched non-billable bars, check marks on colour swatches, a labelled running dot), reduced motion, inline field errors, loading and error states and keyboard navigation are covered by Playwright specs; no screen reader audit |
| Tests | 117 `node --test` tests (85 api, 13 common, 19 web) and 163 Playwright browser tests in 41 files, counted on 2026-10-15. | Done |

## 10. Release plan

**v0.1 (this build).** Everything marked Done above.

**v0.2.** Offline outbox for the PWA (C4), import of Toggl's workspace data ZIP (D7), mid-text `@`/`#` parsing (T8).

**v0.3.** Reports API v2 compatibility, saved reports (R13), PDF export (R12), TOTP (A8), start links (T14).

**Later.** Goals, invoices, timesheet grid, overlap markers, notes on entries, ICS feed of entries.

## 11. Risks and open questions

1. **Third-party app support is thin.** Most Toggl apps cannot change their base URL (section 6.4). If phone-widget convenience matters, the PWA and iOS Shortcuts against the API are the path, not Timery.
2. **Toggl's CSV header may drift.** Toggl does not document its export columns, and the 2025 reports redesign lets users pick visible columns. The importer matches by name and reports per-row errors, but an export with missing start or end columns will be rejected with a message saying which columns it needs.
3. **Phone off the home network.** Without the offline outbox (C4), starting a timer from a phone that cannot reach the server fails.
4. **Single process, single file.** Fine for one user, but a bad disk loses everything unless the data folder is backed up.
5. **Mixed currencies in one group.** Amounts are summed per group without converting currencies. The web UI hides per-row amounts when a report spans several currencies; the API still returns the raw sum.
6. **`node:sqlite` stability.** It ships in Node 24 without a flag. If its API changes in a later Node major, the database layer is about 40 lines to port to `better-sqlite3`.
