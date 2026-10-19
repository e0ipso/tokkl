# kenkeep Index: api-and-data / time-handling

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Stopped entries snap to the instance time resolution on write**](practice-stopped-entries-snap-to-the-time-resolution-on-write.md) to learn about: Live writes snap to time_resolution_minutes in the owner's zone: typed spans round up, timer stops go to the nearest grid point; imports stay exact. #server #time #entries #import
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) to learn about: Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'. #api #time #validation

## Components (what exists)
_None yet._

## By topic

### #time
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Durations: over 999 hours is unreadable (null), not clamped**](../../web-ui-behaviour/practice-parse-duration-returns-null-over-999-hours.md) — MAX_DURATION_SECONDS caps parseDuration on every branch; callers read null as unreadable input.
### #api
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #server
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #validation
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #entries
- Open [**Stopped entries snap to the instance time resolution on write**](practice-stopped-entries-snap-to-the-time-resolution-on-write.md) — Live writes snap to time_resolution_minutes in the owner's zone: typed spans round up, timer stops go to the nearest grid point; imports stay exact.
- Open [**Web previews and the entry editor show the snapped duration**](../../web-ui-behaviour/practice-web-previews-and-editor-show-snapped-durations.md) — Previews use snappedSeconds and snappedInstant with the /me resolution; toasts and chained starts use the server-returned entry.
### #import
- Open [**Stopped entries snap to the instance time resolution on write**](practice-stopped-entries-snap-to-the-time-resolution-on-write.md) — Live writes snap to time_resolution_minutes in the owner's zone: typed spans round up, timer stops go to the nearest grid point; imports stay exact.
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](../toggl-compat-and-import/practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.