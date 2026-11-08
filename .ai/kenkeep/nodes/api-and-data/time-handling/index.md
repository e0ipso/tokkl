# kenkeep Index: api-and-data / time-handling

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`stopped-entry-resolution/`](stopped-entry-resolution/index.md) for more information on stopped-entry grid validation, timer stop limits, DST and exact import behavior; read before changing entry rounding or fixture times.

## Conventions (how we build)
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) to learn about: Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)). #server #validation #time #api
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) to learn about: Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'. #api #time #validation

## Components (what exists)
- Open [**No-time manual entries (all_day)**](map-no-time-manual-entries-all-day.md) to learn about: Entries with all_day log a duration on a day: stored from local midnight, never running, re-anchored on a timezone change. #time-entries #api #web #timezones

## By topic

### #api
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #time
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Stopped entry grid validation**](stopped-entry-resolution/practice-stopped-entry-grid-validation.md) — Stopped live entries use snapSpan and the instance grid; typed zero spans fail while unchanged spans remain editable.
- Open [**Timer stop snapping and duration limits**](stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md) — Timer stops can trash zero spans, preserve switching boundaries and clamp the maximum duration.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](../toggl-compat-and-import/practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.
### #server
- Open [**Admin user management API and the last-active-admin rule**](../users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Parse incoming timestamps with parseInstant**](practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Entry resolution at DST imports and reports**](stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md) — DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage.
### #time-entries
- Open [**No-time manual entries (all_day)**](map-no-time-manual-entries-all-day.md) — Entries with all_day log a duration on a day: stored from local midnight, never running, re-anchored on a timezone change.
### #timezones
- Open [**No-time manual entries (all_day)**](map-no-time-manual-entries-all-day.md) — Entries with all_day log a duration on a day: stored from local midnight, never running, re-anchored on a timezone change.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.