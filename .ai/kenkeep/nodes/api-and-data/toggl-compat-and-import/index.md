# kenkeep Index: api-and-data / toggl-compat-and-import

↑ Parent: [api-and-data](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) to learn about: importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import. #server #import #restore #backup
- Open [**Creates take an Idempotency-Key, recorded in the create's own transaction**](practice-creates-take-an-idempotency-key.md) to learn about: v9 entry and catalog creates, timer and Pomodoro start and entry split run once per user and key for 24 hours; a different request with the key is 422. #api #database #concurrency
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) to learn about: Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400. #server #api #import #validation
- Open [**Toggl v9 DELETE routes answer an empty 200**](practice-v9-deletes-answer-an-empty-200.md) to learn about: Time entry, project, task, client and tag DELETEs send status 200 with no body; the web client maps that to null. #api #toggl-v9

## Components (what exists)
_None yet._

## By topic

### #api
- Open [**Asynchronous ordered timer delivery after commit**](../timer-state/timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](../timer-state/timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](../timer-state/timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #import
- Open [**Entry resolution at DST imports and reports**](../time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md) — DST changes, report rounding and exact imports have distinct resolution behavior and shared fixture coverage.
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
### #server
- Open [**Recheck credentials inside the guarded account transaction**](../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #backup
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #concurrency
- Open [**Creates take an Idempotency-Key, recorded in the create's own transaction**](practice-creates-take-an-idempotency-key.md) — v9 entry and catalog creates, timer and Pomodoro start and entry split run once per user and key for 24 hours; a different request with the key is 422.
### #database
- Open [**Project and task totals rely on the live-entry partial indexes**](../reports-and-totals/practice-live-entry-indexes-back-project-and-task-totals.md) — Migration 2 adds time_entries_project_live and time_entries_task_live; totals SQL must keep using them.
- Open [**Users, roles and workspace membership**](../users-and-admin/map-users-roles-and-workspace-membership.md) — Account roles, scoped membership contracts, protected writes and neutral multi-user fixtures.
- Open [**Creates take an Idempotency-Key, recorded in the create's own transaction**](practice-creates-take-an-idempotency-key.md) — v9 entry and catalog creates, timer and Pomodoro start and entry split run once per user and key for 24 hours; a different request with the key is 422.
### #restore
- Open [**JSON restore: idempotent, skips with reasons, keeps archive state**](practice-json-restore-rules.md) — importJsonExport skips records it cannot map with a reason, never replaces a running timer, and re-archives projects after task import.
### #toggl-v9
- Open [**Toggl v9 DELETE routes answer an empty 200**](practice-v9-deletes-answer-an-empty-200.md) — Time entry, project, task, client and tag DELETEs send status 200 with no body; the web client maps that to null.
### #validation
- Open [**Parse incoming timestamps with parseInstant**](../time-handling/practice-parse-api-timestamps-with-parseinstant.md) — Server input instants go through parseInstant: RFC 3339 with seconds and a zone, real dates only. Never new Date(String(x)).
- Open [**Toggl CSV import: choose team-export users by opaque key**](practice-toggl-csv-import-selects-users-by-opaque-key.md) — Team CSVs list users by JSON key; send one user=<key> query param per user; a real multi-user import without one is a 400.
- Open [**Time zones: store canonicalTimeZone, reject offset IDs**](../time-handling/practice-time-zone-names-are-stored-in-canonical-form.md) — Account zones go through canonicalTimeZone and are stored as ICU names; bad input is a 400 'Invalid timezone'.