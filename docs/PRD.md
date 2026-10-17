# Tokkl PRD

A self-hosted time tracker that copies the parts of Toggl Track one person uses, runs on a server you own, and speaks enough of the Toggl API that scripts written for Toggl keep working. One server holds several accounts, and each account has its own private workspace.

- Owner: Tokkl contributors
- Status: v0.1 built (see the status column in each table)
- Last updated: 2026-10-17

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

- Shared workspaces, approvals, SSO, billing plans. Each account tracks its own time in its own workspace, and data is never shared between accounts.
- Native desktop or mobile apps, except the KDE Plasma panel companion (C6), the macOS menu bar companion (C7) and the GNOME companion (C8). Each is a client of the same API. The web app is a PWA and works on phones.
- Any outbound network traffic. No telemetry, no CDN fonts, no update checks, no AI.
- Public internet exposure as a default. The expected setup is LAN or VPN (Tailscale/WireGuard) access.

## 2. User and context

The person who runs the server is the first admin. They track client work and personal projects, sometimes bill hourly, use a laptop at a desk and a phone away from it. They are technical enough to run `docker compose up -d` and read a log line, and they care more about privacy than about integrations. The people they invite track their own time in their own workspaces.

Usage pattern this design optimizes for:

- Dozens of timer starts and stops per day, mostly from the laptop.
- Occasional "I forgot to start the timer" fixes from the phone.
- Weekly or monthly reporting per client, exported to CSV for invoicing.
- A few thousand entries per year. Ten years of data is well under 100,000 rows.

## 3. Research basis

The requirements come from two research passes done on 2026-10-14:

- **Toggl Track product.** 179 Toggl knowledge base articles, the 2025 Reports redesign notes, community forum threads and review sites. Each feature got a plan tier and a MUST/SHOULD/COULD/WON'T call for one person's use, which still holds for each account.
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

This is the brief every visual change is checked against.

- **Palette roles.** Light theme: sand background, ink text, sunset orange primary, aqua secondary, hot pink and lime for states. Dark theme: deep navy background with a neon counterpart for each role. The exact values are the colour tokens in `packages/web/src/styles.css`.
- **Typeface.** One display face for headings, the running clock and totals. The wordmark is the owner-supplied graffiti artwork, shipped as an image named "Tokkl", so it uses no font. Body text, controls and tables use the system font stack.
- **Texture.** CSS gradients or inline SVG only, never raster images. Texture never sits behind data tables or inputs.
- **Type effects.** Rotated or skewed type is decoration only. It never appears on controls, numbers or labels.
- **Motion.** All motion sits behind `prefers-reduced-motion`. With reduced motion set, nothing animates.
- **No outbound assets.** The display face and every texture ship with the server. This restates the non-goal on outbound traffic: no CDN fonts and no other third-party assets.
- **Contrast and signals.** Both themes meet WCAG AA: 4.5:1 for text, 3:1 for non-text elements such as borders, icons and focus rings. Colour is never the only signal for a state. Section 9 has the accessibility requirement.
- **Test and device limits.** The ARIA names and class selectors the Playwright tests use stay as they are. Every page fits a 390x844 phone screen.

## 5. Functional requirements

Priority follows MoSCoW. Status is the state of this repository on 2026-10-16: **Done** means implemented and exercised by the automated tests (server tests, Playwright browser tests) or by a scripted browser run during development, **Partial** means usable with the stated gap, **Planned** means not started.

### 5.1 Timer

| ID | Requirement | Priority | Status |
|---|---|---|---|
| T1 | Start a timer from an empty bar; fill description, project, tags and billable before or after starting. | MUST | Done |
| T2 | Exactly one running entry. Starting a new one stops the old one at the new start time, snapped to the time resolution (section 6.3). Enforced by a partial unique index in SQLite, not only in code. | MUST | Done |
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
| M5 | After adding a manual entry, the next start time defaults to the stored end of that entry, after snapping to the time resolution, so a day can be logged in sequence. | SHOULD | Done |
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
| R8 | Rounding per entry (up, nearest, down; 1 to 240 minutes), as a report setting that never changes stored data. Stored entries snap on write to the instance time resolution (A14), not to this setting, and report rounding applies on top of the stored durations. With a rounding step that is not a multiple of the resolution, a report can show durations that are not multiples of the resolution. The app's reports always apply the workspace setting; Toggl API report calls round only when asked, as in Toggl. | SHOULD | Done |
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
| A1 | First-run setup code, printed in the server log, creates the first admin. Whoever reaches the server first cannot claim it without reading the log. The code creates only the first admin. | MUST | Done |
| A2 | Email and password login; session cookie (HttpOnly, SameSite=Lax, Secure behind HTTPS). `GET /me` also returns the account's `role`, which the web app uses to show the Admin page. | MUST | Done |
| A3 | Change password (signs out other sessions), email, name. | MUST | Done |
| A4 | Timezone, first day of week, date format, 12/24-hour time, duration format (improved, classic, decimal). | MUST | Done |
| A5 | Theme: system, light, dark. | SHOULD | Done |
| A6 | API token: view, copy, reset. | SHOULD | Done |
| A7 | Keyboard shortcuts toggle and `?` help overlay. | SHOULD | Done |
| A8 | TOTP two-factor login. | SHOULD | Planned |
| A9 | Two account roles, admin and user. The first account is an admin. An admin changes any account's role, but the server always keeps at least one active admin. | MUST | Done |
| A10 | Admins create invite links, choose the new account's role, and share the link by hand. A link works once and expires after the invite lifetime (7 days by default). Opening it lets one person create an account with a private workspace. Admins list and revoke unused links. The server sends no email. | MUST | Done |
| A11 | Admins disable and re-enable accounts. A disabled account cannot sign in or use the API, its sessions end, and its data stays. Admins can also sign an account out of every browser without disabling it; its API token keeps working. | SHOULD | Done |
| A12 | Admins delete an account together with its workspace and everything in it, after typing the account's email to confirm. An admin cannot delete their own account or the last active admin. A workspace that has another member stays. | SHOULD | Done |
| A13 | Admins create password-reset links for an account and share them by hand. A link works once, expires after 24 hours, and replaces the account's earlier unused link. Using it signs the account out of every session. It does not change the account's API token, which the user resets separately (`POST /me/reset_token`). | SHOULD | Done |
| A14 | Admins edit instance settings: session lifetime (1 to 365 days), invite lifetime (1 to 90 days) and the time resolution `time_resolution_minutes` (a divisor of 60 minutes, 5 by default), which any signed-in client can read from `GET /api/v9/me`. A saved session lifetime replaces `TOKKL_SESSION_DAYS` and applies to new sessions only. A new resolution applies to entries written after the change; existing entries change only when they are next edited. | COULD | Done |
| A15 | Admins manage accounts only and cannot read other users' time data. Workspace access depends on membership, never on the instance role, so an admin gets 403 on another account's workspace. | MUST | Done |

### 5.8 Clients and devices

| ID | Requirement | Priority | Status |
|---|---|---|---|
| C1 | Responsive web app usable on a phone: bottom navigation, timer and list on small screens. | MUST | Done |
| C2 | Installable PWA (manifest, icons). | SHOULD | Partial: the manifest ships the owner-supplied stopwatch icon as 192 and 512 pixel PNGs plus the owner's maskable 192 and 512 pixel PNGs on navy, with a 32 pixel PNG favicon and the owner's opaque navy 180 pixel apple-touch-icon; installing on a phone is untested. |
| C3 | Cross-device freshness: the running timer refreshes every 30 s and on window focus, entries every 60 s. | MUST | Done |
| C4 | Offline outbox for timer start/stop/edit in the PWA, with an unsynced marker. Matters more here than for Toggl because a phone off the home network loses the server. | SHOULD | Planned |
| C5 | Browser extension, desktop tray app. The KDE (C6), macOS (C7) and GNOME (C8) companions are the exceptions; the browser extension stays out. | WON'T (v1) | n/a |
| C6 | KDE Plasma 6 panel widget for Debian 13 (amd64) and Fedora KDE 44 (x86_64), packaged as a DEB and an RPM. It starts and stops the timer, shows the elapsed time, sets the project and billable flag, and signs in with the API token (default) or email and password, kept in KDE Wallet. It works only in the signed-in account's workspace and is released with the server under one version ([guide](../desktop/kde/README.md)). Publication to app stores is out of scope. | COULD | Partial: CTest, real-server and package checks run in CI; the manual Plasma Wayland and KWallet checklist has not been run yet |
| C7 | macOS menu bar app for Macs with Apple silicon and macOS 13 or later, shipped as a DMG signed ad hoc and not notarized. It starts and stops the timer, shows the elapsed time, sets the project and billable flag, and signs in with the API token (default) or email and password, kept in the macOS Keychain. It works only in the signed-in account's workspace and is released with the server under one version ([guide](../desktop/macos/README.md)). Publication to app stores is out of scope. | COULD | Partial: the `macos` CI job is set up to build, test and package it, but the app has not been built or run on a Mac by hand |
| C8 | GNOME top bar extension for GNOME Shell 46 to 51 and `tokkl-timerd`, the session service it drives, packaged as a DEB for Debian 13 (amd64), an RPM for Fedora 44 (x86_64) and an extension zip. It starts and stops the timer, shows the elapsed time, sets the project and billable flag, and signs in with the API token (default) or email and password, kept in the keyring. It works only in the signed-in account's workspace and is released with the server under one version ([guide](../desktop/gnome/README.md)). Publication to extensions.gnome.org is manual. | COULD | Partial: the `gnome` and `gnome-extension` CI jobs build, test and package it and drive the extension in a headless GNOME Shell per supported version; no manual check on a desktop session is recorded |

## 6. Toggl API compatibility

### 6.1 What compatible means here

A client that lets you change the base URL and uses the supported endpoints and parameters can talk to this server. The server implements a subset of Track API v9 and Reports API v3. An endpoint marked Done below does not mean every Toggl parameter or feature on that endpoint is implemented. The behavior details and limits below define the supported contract.

Base URLs:

- Track API: `https://<server>/api/v9`
- Reports API: `https://<server>/reports/api/v3`

Authentication matches Toggl: HTTP Basic with `<api_token>:api_token` or `<email>:<password>`. Failures return 403. After too many failed password attempts the server returns 429 with a `Retry-After` header (section 8.4).

### 6.2 Endpoints

| Area | Endpoints | Status |
|---|---|---|
| Me | `GET/PUT /me` (incl. `with_related_data`; the `GET` response adds Tokkl's own `role` and `time_resolution_minutes` fields), `POST /me/reset_token`, `GET/POST /me/preferences[/{client}]`, `GET /me/workspaces`, `/me/organizations`, `/me/features`, `/me/projects`, `/me/clients`, `/me/tags`, `/me/tasks` | Done |
| Time entries (read) | `GET /me/time_entries` with `since` (includes deleted entries with `server_deleted_at`), `before`, `start_date`/`end_date`, `meta`; `GET /me/time_entries/current`; `GET /me/time_entries/{id}` | Done |
| Time entries (write) | `POST /workspaces/{wid}/time_entries`, `PUT .../{id}`, `PATCH .../{id}/stop`, `PATCH .../{ids}` (bulk JSON Patch, partial success), `DELETE .../{id}` | Done |
| Workspace | `GET/PUT /workspaces/{wid}`, `GET /workspaces/{wid}/users` (lists the workspace's members) | Done |
| Projects | `GET/POST /workspaces/{wid}/projects`, `GET/PUT/DELETE .../{pid}` (`teDeletionMode`) | Done |
| Tasks | `GET /workspaces/{wid}/tasks` (paged envelope, like Toggl), `GET/POST /workspaces/{wid}/projects/{pid}/tasks` (plain array), `GET/PUT/DELETE .../{tid}` | Done |
| Clients | `GET/POST /workspaces/{wid}/clients` (`status`, `name`), `GET/PUT/DELETE .../{cid}`, `POST .../{cid}/archive`, `POST .../{cid}/restore` | Done |
| Tags | `GET/POST /workspaces/{wid}/tags`, `PUT/DELETE .../{tid}` | Done |
| Reports v3 | `POST /workspace/{wid}/search/time_entries` (paging via `X-Next-ID`/`X-Next-Row-Number`), `.../search/time_entries/totals`, `.../search/time_entries.csv`, `/summary/time_entries`, `/summary/time_entries.csv`, `/weekly/time_entries` | Done |
| Reports v2 (legacy) | `details`, `summary`, `weekly` | Planned. Several older clients still call v2. |
| Webhooks | n/a | WON'T (v1) |
| Organizations, groups, invitations, approvals, SSO, billing | n/a | WON'T. The app has its own admin invite links (A10), outside the Toggl API. |
| Instance administration (Tokkl only) | `GET/PATCH/DELETE /api/app/admin/users[/{id}]`, `POST .../users/{id}/sessions/revoke`, `POST .../users/{id}/password-reset`, `GET/POST /api/app/admin/invites`, `DELETE .../invites/{id}`, `GET/PUT /api/app/admin/settings`. Active admins only, outside the Toggl API. | Done |

### 6.3 Behavior details that clients depend on

- Responses are bare JSON objects or arrays with explicit `null`s. No `{"data": ...}` envelope (that was v8).
- Errors are JSON-encoded strings, e.g. `"Time entry already stopped"`, with 400, 403, 404 or 409.
- Timestamps go out as RFC 3339 UTC with `+00:00`; any RFC 3339 offset is accepted on input.
- Every API write that stores a stopped entry (create, update, stop, bulk `PATCH`, stopping the running entry when a new one starts, and undoing the delete of a running entry while another one runs) snaps it to the instance time resolution on the clock of the owner's timezone. The duration rounds up to a multiple of the resolution, so the padding is always less than one step. The start moves to the nearest grid point, and the stop follows it by the rounded duration. The response returns the stored values, so `stop - start` equals `duration`. A running entry keeps its exact start until it stops. When a new timer stops it, its stored stop lands up to half a step before the new start or up to one and a half steps after it. A timer that has run for more than 999 hours, the longest entry the API accepts, stops at 999 hours. CSV import and JSON restore keep the times in the file, and existing entries change only when they are next edited.
- Legacy field aliases are emitted and accepted: `wid`/`workspace_id`, `pid`/`project_id`, `tid`/`task_id`, `uid`/`user_id`, `cid`/`client_id`.
- A running entry has `stop: null` and `duration` equal to minus its start in Unix seconds. That satisfies clients computing `now + duration` (the documented v8-era rule) and clients that only test `duration < 0`.
- Any negative `duration` on create means "running". `created_with` is accepted but optional (Toggl requires it).
- `tags` on create accepts names; unknown names are created. `tag_action: "add" | "delete"` on update modifies instead of replacing.
- `/me/time_entries` with no parameters returns entries that started in the last 9 days (Toggl v8's documented default; v9 leaves it undocumented). Date-only `end_date` is exclusive.
- Report bodies also accept `exclude_project_ids`, `exclude_client_ids` and `exclude_tag_ids` (not in Toggl).
- `/me/time_entries/current` returns `200 null` when nothing runs, as Toggl's fixtures show.
- Project and tag lists honor `page`/`per_page` when sent and return everything otherwise. Toggl pages by default (151 projects per page); one account's lists fit in one response.
- Task `tracked_seconds` is in milliseconds, because Toggl documents it that way.
- Workspace client lists default to active clients. `status=archived` and `status=both` select other states. Client restore accepts `projects` and `restore_all_projects`; without either, it restores the client alone.
- `since` filters retained records on `/me/clients`, `/me/projects`, `/me/tags`, `/me/tasks`, `/me/workspaces`, workspace projects and workspace tasks. The include-archived and include-done switches still apply. `/me/tasks` applies `offset` and `per_page` after filtering. Workspace tasks sort by `name` or `created_at`, in `ASC` or `DESC` order, before pagination.
- Time-entry `start_date` replaces the date in `start`. When a request supplies both `stop` and `duration`, they must agree with `start` before the span is snapped; inconsistent requests return 400 without changing data.
- Reports filter by `user_ids`, `project_ids`, `client_ids`, `task_ids`, `tag_ids`, `time_entry_ids`, `description`, `billable`, `min_duration_seconds` and `max_duration_seconds`. Duration bounds apply to stored time before report rounding. A `user_ids` selection excluding the signed-in account returns no entries. Totals accept `day`, `week` and `month` through `granularity` or `resolution`; `granularity` takes precedence.

### 6.4 Honest limits

Compatibility has these limits in addition to the unimplemented endpoint families above:

- Stopped-entry snapping is a deliberate difference from Toggl. It applies to API clients too, even at the smallest supported resolution of one minute. Running entries retain their exact start until stopped. API writes also allow a missing `start` or `created_with`, and default billable state to the project's setting.
- Catalog deletions are permanent. Catalog `since` queries cannot return deleted projects, clients, tags or tasks as tombstones, and workspace `since` does not track membership changes. Use full catalog refreshes to discover removals. Deleted time entries do have tombstones through `/me/time_entries?since=...`.
- Project listing supports `active`, `billable`, `name`/`search`, `client_ids`, `since`, `page` and `per_page`. Project-ID, status, template, assignment and sort filters are not implemented. Workspace tasks do not implement `start_date` or `end_date` filters. Client-specific preferences share the account's preference record.
- Reports return only the signed-in account's stopped entries. Detailed pagination supports `first_row_number`, as recommended by Toggl's Reports overview; `first_id` and `first_timestamp` cursors are not implemented. Detailed grouping through `grouped`, rate splitting through `distinguish_rates`, group filters, amount-hiding options and nested audit options are not implemented. Detailed rows always include metadata. Weekly reports cover at most seven days. Detailed CSV uses Toggl's column layout; summary CSV uses Tokkl's `Group`, `Sub group`, `Duration` layout. PDF and XLSX exports are not implemented.
- Integration, sharing and external-reference fields, user country, and workspace settings other than name, currency, default rate and rounding are not persisted. Unknown fields can be ignored, so callers must stay within the supported parameters.

Most end-user Toggl apps hardcode `api.track.toggl.com`. Of 24 clients checked, these let you change the base URL:

- `toggl-client` (npm), through `TOGGL_BASE_URL` and `TOGGL_REPORTS_URL`
- `toggl-track` (npm), through a `baseURL` option
- `toggl-api` (npm), through an `apiUrl` option
- `toggl_python`, through `base_url=` (Track API only)

The Raycast extension, the Obsidian plugin, both `toggl-cli` projects, the Alfred workflow, n8n, Timery and Toggl's own apps do not. Pointing them at the server would need DNS overrides plus a certificate they trust for `api.track.toggl.com`. That is untested and out of scope. The realistic value of compatibility is: your own scripts, the libraries above, Home Assistant or iOS Shortcuts built against Toggl's documented API, and a migration path that keeps those working.

### 6.5 Compatibility verification

The supported contract was compared with Toggl's official documentation on 2026-10-17: [Me](https://engineering.toggl.com/docs/track/api/me/), [preferences](https://engineering.toggl.com/docs/track/api/preferences/), [time entries](https://engineering.toggl.com/docs/track/api/time_entries/), [workspaces](https://engineering.toggl.com/docs/track/api/workspaces/), [projects](https://engineering.toggl.com/docs/track/api/projects/), [tasks](https://engineering.toggl.com/docs/track/api/tasks/), [clients](https://engineering.toggl.com/docs/track/api/clients/), [tags](https://engineering.toggl.com/docs/track/api/tags/), [detailed reports](https://engineering.toggl.com/docs/track/reports/detailed_reports/), [summary reports](https://engineering.toggl.com/docs/track/reports/summary_reports/) and [weekly reports](https://engineering.toggl.com/docs/track/reports/weekly_reports/).

`packages/api/test/togglCompatibility.test.ts` guards the defaults and request semantics corrected by that comparison. It runs through real local HTTP requests, with a second account and both inline and worker-backed report execution, alongside the existing authentication, entity, timer and report tests in `npm test`. Run just the API suite with `npm run test --workspace=@tokkl/api`.

This verifies Tokkl against the documented subset. It does not compare responses with an authenticated live Toggl account, certify third-party libraries, or automatically discover future upstream changes. When the upstream API changes or support expands, review these references and update the contract tests and limits together.

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
 |   /api/app/*           setup, login, invites, password resets, trash, |
 |                        report, import, export                         |
 |   /api/app/admin/*     accounts, invites, instance settings (admins)  |
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
| Shared | `packages/common` (`@tokkl/common`) modules for duration parsing, time-of-day parsing, timezone math, snapping entries to the time resolution, with their types in `packages/types` (`@tokkl/types`) | Server and UI parse `1h 30m` and midnight the same way. |

### 8.3 Data model

All instants are UTC ISO 8601 strings; calendar days are computed in the user's timezone at query time. A stopped entry written through the API starts on the instance time resolution grid and lasts a multiple of it (section 6.3).

- `users`: email, name, scrypt password hash, API token, timezone, first day of week, preferences JSON (Toggl preference keys plus favorites), `role` (`admin` or `user`, default `user`), `disabled_at` (null while the account is active).
- `sessions`: SHA-256 of the session token, expiry. The raw token exists only in the cookie.
- `instance_settings`: key and JSON value for the settings an admin edits (`session_days`, `invite_days`, and `time_resolution_minutes`, a divisor of 60 that defaults to 5), with who changed them. A key with no row uses its default.
- `account_tokens`: one-time invite and password-reset links. Only the SHA-256 of the token is stored, with its kind, the invited role or the target account, the creator, expiry and use time.
- `workspaces`: one private workspace per account. Default currency, default rate, report rounding.
- `workspace_users`: workspace and user, with a `role` of `owner` or `member`. The primary key is the pair. Workspace settings stay with the owner.
- `clients`, `projects`, `tasks`, `tags`: unique names per scope, case-insensitive.
- `time_entries`: project, task, description, start, stop (null while running), billable, `created_with`, `deleted_at` for the trash and for `since` sync.
- `time_entry_tags`: join table.

Migrations are append-only SQL, versioned with `PRAGMA user_version`, applied at startup.

### 8.4 Security

- Passwords: scrypt (N=2^15, r=8, p=1), constant-time comparison.
- API token: 128 random bits, shown in settings, resettable.
- Sessions: 256-bit random token, only its hash stored, 30-day default expiry (an admin can change it, A14), HttpOnly and SameSite=Lax cookie, `Secure` when served over HTTPS.
- CSRF: cookie-authenticated writes must send `X-Tokkl-CSRF: 1` (the pre-rename `X-Timetrack-CSRF: 1` is still accepted), which a cross-site form cannot set and which needs a CORS preflight this server never grants. Login, setup, invite acceptance and password-reset acceptance need it too, because they set or change credentials without a session. Logout needs it only when a session is active. Requests with HTTP Basic auth are exempt.
- Brute force: failed password attempts are counted over 15 minutes, across the login form, Basic auth and password change. The limits are 10 failures per account and client address, 50 per account and 100 per client address. A successful login resets the account-and-address and account counters, never the address counter. Setup code attempts keep their own per-address counter, limited to 10. Behind a trusted proxy the address is the last `X-Forwarded-For` hop, which the client cannot forge. Invite and password-reset links share the per-address counter: each unknown, expired, used or revoked token counts as a failure, and a blocked address gets 429 before the lookup, so tokens cannot be guessed at speed. Using a reset link also clears the account's earlier failures. Unknown emails still run a scrypt check, so response time does not reveal whether an account exists. A disabled account fails like a wrong password.
- Headers: strict Content Security Policy (`default-src 'self'`), `frame-ancestors 'none'`, `nosniff`, no-store on API responses. Hashed assets are cached for a year; a missing asset is a 404, never the HTML page.
- Input: request bodies capped at 1 MB (50 MB for imports), id lists in report filters capped at 1000; every field validated with Toggl-style error messages.
- First run: the setup code from the server log creates only the first admin. Later accounts come from invite links that an admin creates.
- Account links: invite and reset tokens are 256 random bits, shown once when an admin creates them, and stored only as a hash. An unknown, expired, used or revoked link gets one identical 404.
- Admin routes: every `/api/app/admin` route needs an active admin and returns 403 to everyone else, including a disabled admin. They return account fields only, never API tokens, password hashes, preferences or time data.
- Exports never contain the password hash or API token.

## 9. Non-functional requirements

| Area | Requirement | Status |
|---|---|---|
| Latency | Timer start/stop under 100 ms server time on a low-power CPU. Reports over a year of data under 500 ms. | Not measured on low-power hardware yet |
| Reliability | Writes are transactional; one running entry guaranteed by the database. Graceful shutdown on SIGTERM. | Done |
| Privacy | Zero outbound requests from server and UI. | Done (verify with the CSP and a network log) |
| Portability | The server runs on any Linux host with Node 24 (amd64 or arm64) and has no native modules. The KDE, macOS and GNOME companions are native code for the targets in C6, C7 and C8. | Tested on amd64 only; the macOS app has not been built on a Mac by hand |
| Accessibility | Keyboard reachable controls, labeled inputs, visible focus, color never the only signal. | Partial: labels, focus rings, non-colour cues (hatched non-billable bars, check marks on colour swatches, a labelled running dot), reduced motion, inline field errors, loading and error states and keyboard navigation are covered by Playwright specs; no screen reader audit |
| Tests | 213 `node --test` tests (177 api, 13 common, 23 web), 226 Playwright browser tests in 46 spec files and 12 KDE CTest tests, run and counted on 2026-10-16. | Done |

## 10. Release plan

**v0.1 (this build).** Everything marked Done above.

**v0.2.** Offline outbox for the PWA (C4), import of Toggl's workspace data ZIP (D7), mid-text `@`/`#` parsing (T8).

**v0.3.** Reports API v2 compatibility, saved reports (R13), PDF export (R12), TOTP (A8), start links (T14).

**Later.** Goals, invoices, timesheet grid, overlap markers, notes on entries, ICS feed of entries.

## 11. Risks and open questions

1. **Third-party app support is thin.** Most Toggl apps cannot change their base URL (section 6.4). If phone-widget convenience matters, the PWA and iOS Shortcuts against the API are the path, not Timery.
2. **Toggl's CSV header may drift.** Toggl does not document its export columns, and the 2025 reports redesign lets users pick visible columns. The importer matches by name and reports per-row errors, but an export with missing start or end columns will be rejected with a message saying which columns it needs.
3. **Phone off the home network.** Without the offline outbox (C4), starting a timer from a phone that cannot reach the server fails.
4. **Single process, single file.** Fine for a handful of accounts, but a bad disk loses every account's data unless the data folder is backed up. One copy of the data folder covers the whole instance.
5. **Mixed currencies in one group.** Amounts are summed per group without converting currencies. The web UI hides per-row amounts when a report spans several currencies; the API still returns the raw sum.
6. **`node:sqlite` stability.** It ships in Node 24 without a flag. If its API changes in a later Node major, the database layer is about 40 lines to port to `better-sqlite3`.
