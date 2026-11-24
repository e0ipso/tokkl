# kenkeep Index: api-and-data / reports-and-totals / app-report-pipeline

↑ Parent: [reports-and-totals](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**Report route admission to the ReportRunner report lane**](map-report-route-admission-to-the-reportrunner-report-lane.md) to learn about: Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob. #server #reports #api
- Open [**Download lane for account exports and detailed CSVs**](map-download-lane-for-account-exports-and-detailed-csvs.md) to learn about: Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min. #server #reports #api
- Open [**Report job reads in SQL batches and golden report answers**](map-report-job-reads-in-sql-batches-and-golden-report-answers.md) to learn about: runReportJob reads in one snapshot, pages and sorts in SQL, aggregates in 500-entry batches; goldens pin output on every backend. #server #reports #storage
- Open [**Reports page query body, caching and cancellation**](map-reports-page-query-body-caching-and-cancellation.md) to learn about: reportQuery sends groupings only for the summary tab; useReport caches 60 s and forwards the abort signal to free report places. #web #reports
- Open [**Web app report routes, range limits and rounding**](map-web-app-report-routes-range-limits-and-rounding.md) to learn about: /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders. #server #reports #api
- Open [**ReportRunner lanes, worker placement and crash handling**](map-reportrunner-lanes-worker-placement-and-crash-handling.md) to learn about: createReportRunner places jobs on worker threads or inline; each lane runs concurrent workers, owns admission, FIFO and crash recovery. #server #reports
- Open [**Reports page filter state in URL params**](map-reports-page-filter-state-in-url-params.md) to learn about: Report filters live in URL params as dot-separated ids with none and a not. prefix; a bare not. filters nothing. #web #reports

## By topic

### #reports
- Open [**Report route admission to the ReportRunner report lane**](map-report-route-admission-to-the-reportrunner-report-lane.md) — Report routes reserve a per-account place in the report lane, answer 503 when full, free it on abort, then submit a typed ReportJob.
- Open [**Download lane for account exports and detailed CSVs**](map-download-lane-for-account-exports-and-detailed-csvs.md) — Account exports and detailed CSVs run in the download lane, stream acknowledged pieces through streamDownload and time out at 15 min.
- Open [**Web app report routes, range limits and rounding**](map-web-app-report-routes-range-limits-and-rounding.md) — /api/app/report routes build every web report server-side with workspace rounding and a 3660-day range; Toggl v3 shares builders.
### #server
- Open [**Recheck credentials inside the guarded account transaction**](../../password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../../password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../../password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #api
- Open [**Asynchronous ordered timer delivery after commit**](../../timer-state/timer-event-stream/map-asynchronous-ordered-timer-delivery-after-commit.md) — A timer write enqueues its state on an ordered per-user queue after commit and never waits for stream delivery.
- Open [**Timer event stream protocol, keep-alive and proxy requirements**](../../timer-state/timer-event-stream/map-timer-event-stream-protocol-keep-alive-and-proxy-requirements.md) — GET /api/app/timer/events sends full state on connect and change, a keep-alive event every 25 s, and needs unbuffered proxies.
- Open [**Timer stream backpressure for slow clients**](../../timer-state/timer-event-stream/map-timer-stream-backpressure-for-slow-clients.md) — A full socket makes a timer stream wait up to 30 s for drain; more than 64 KiB unsent ends the stream.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #storage
- Open [**Report job reads in SQL batches and golden report answers**](map-report-job-reads-in-sql-batches-and-golden-report-answers.md) — runReportJob reads in one snapshot, pages and sorts in SQL, aggregates in 500-entry batches; goldens pin output on every backend.
- Open [**Share password rate limits through database counters and reservations**](../../password-and-csrf-rules/password-attempt-limits/practice-share-password-rate-limits-through-database-counters-and-reservations.md) — Limiter counters and reservation leases live in the database, keyed by hash; attempt refuses with retryAfter and never queues.