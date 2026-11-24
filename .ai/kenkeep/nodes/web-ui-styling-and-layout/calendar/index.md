# kenkeep Index: web-ui-styling-and-layout / calendar

↑ Parent: [web-ui-styling-and-layout](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) to learn about: HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match. #web #calendar #css #e2e
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) to learn about: assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller. #web #calendar #css

## Components (what exists)
- Open [**Web calendar day view and touch gestures in WeekCalendar**](map-web-calendar-day-view-and-touch-gestures-in-weekcalendar.md) to learn about: Below 760px WeekCalendar shows one day under a week strip; touch drags start after a 500 ms long press, mouse drags at once. #web #calendar #touch #mobile #e2e

## By topic

### #calendar
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Section hues: data-section maps each NAV section to a hue and its text colour**](../theme-and-tokens/practice-section-hues-data-section-maps-each-nav-section-to-a-hue.md) — Timer orange, Pomodoro cyan, Reports sky, Projects violet, Settings yellow, More pink. Text on a hue is on-section-hue; fills draw an edge.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #css
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../shell-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #e2e
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](../../tooling-and-project/testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](../../tooling-and-project/testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.
### #mobile
- Open [**NAV list, phone More sheet and nav running dots**](../shell-and-layout/app-shell/map-nav-list-phone-more-sheet-and-nav-running-dots.md) — NAV in app/nav.ts is the only page list; inMore items move into the phone More dialog; adminOnly hides Admin; running dots.
- Open [**Phone e2e navigation helpers tapNav and openMore**](../shell-and-layout/app-shell/map-phone-e2e-navigation-helpers-tapnav-and-openmore.md) — Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the inMore items and omits Admin.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../shell-and-layout/practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #touch
- Open [**Web calendar day view and touch gestures in WeekCalendar**](map-web-calendar-day-view-and-touch-gestures-in-weekcalendar.md) — Below 760px WeekCalendar shows one day under a week strip; touch drags start after a 500 ms long press, mouse drags at once.