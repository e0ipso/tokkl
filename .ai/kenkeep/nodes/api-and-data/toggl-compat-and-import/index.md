# kenkeep Index: api-and-data / toggl-compat-and-import

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) to learn about: importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import. #server #import #restore #backup
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) to learn about: Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400. #server #api #import #validation
- Open [**Toggl v9 DELETE routes answer an empty 200**](practice-v9-deletes-answer-an-empty-200.md) to learn about: Time entry, project, task, client and tag DELETEs send status 200 with no body; the web client maps that to null. #api #toggl-v9

## Components (what exists)
_None yet._

## By topic

### #api
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #import
- Open [**Stopped entries snap to the instance time resolution on write**](../time-handling/practice-stopped-entries-snap-to-the-time-resolution-on-write.md) — Every live write moves start and stop each to the nearest grid point; a span that rounds to zero is refused (typed) or trashed (timer stop); imports stay exact.
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #server
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
### #backup
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #restore
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #toggl-v9
- Open [**Toggl v9 DELETE routes answer an empty 200**](practice-v9-deletes-answer-an-empty-200.md) — Time entry, project, task, client and tag DELETEs send status 200 with no body; the web client maps that to null.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.