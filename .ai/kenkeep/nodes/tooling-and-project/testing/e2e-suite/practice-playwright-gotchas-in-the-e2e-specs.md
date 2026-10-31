---
type: practice
title: Playwright gotchas in the e2e specs
description: >-
  200 is not proof a file exists; clock.install not pauseAt; phone helpers,
  expectFits, cellTexts polling, networkidle limits; group entries on a past
  day.
tags:
  - testing
  - playwright
kk_schema_version: 3
kk_id: practice-playwright-gotchas-in-the-e2e-specs
kk_derived_from:
  - >-
    .ai/kenkeep/nodes/web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md
kk_relates_to:
  - practice-stopped-entries-snap-to-the-time-resolution-on-write
kk_depends_on: []
kk_confidence: high
---
- The static server answers unknown paths with the HTML app shell and status 200, so a 200 does not prove a static file exists. Only misses under `/assets/`, `/api` and `/reports/api` get a 404. Check the content type, as `e2e/pwa.spec.ts` does for the manifest icons, and assert `text/html` to prove a retired file is gone. Better, decode the image: `e2e/typography.spec.ts` calls `img.decode()` on the brand wordmark and checks `naturalWidth`. Express 5 serves `favicon.ico` as `image/vnd.microsoft.icon`; the spec also accepts `image/x-icon`. See [map-pwa-manifest-and-head-icon-links](../../../web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md) for what the spec checks.
- To assert that a control does not open the native colour picker, stub `HTMLInputElement.prototype.showPicker` in `page.addInitScript` and count the calls, as `a11y-keyboard.spec.ts` does. The real picker is outside the page and cannot be inspected.
- `getByRole`/`getByLabel` name matching is a case-insensitive substring match unless you pass `exact: true`.
- A synthetic `visibilitychange` must be dispatched with `{ bubbles: true }` when fired on `document`, because the focus listener in `packages/web/src/main.tsx` listens on `window`.
- For timer-driven behaviour use `page.clock.install()` with `fastForward`. Do not use `clock.pauseAt`: TanStack Query's notify scheduler uses `setTimeout(0)`, which then never fires and queries stop updating the UI.
- To expire a session on an open page, clear the cookies with `context.clearCookies()` and make `/me` refetch. `useMe` (`packages/web/src/api/hooks.ts`) stays fresh for 60 seconds, so install the clock, `fastForward` past that, and dispatch a window `focus` inside `expect(...).toPass()` until the login page shows: `main.tsx` ignores a focus less than a second after the last one (`REFOCUS_GAP_MS`). The 403 ends the session, and the spec logs in again through the form on the same page. `e2e/timer-pause.spec.ts` does this.
- Phone specs (`mobile-timer`, `mobile-reports`, `mobile-transfer`, `mobile-manage`) call `test.use(PHONE)` from `e2e/mobile-tests-helpers.ts`: a 390x844 viewport with `isMobile` and `hasTouch`. Drive them with the helpers. `tap` runs `expectFits` first, which checks the control is fully on screen, and `expectNoPageOverflow` fails if the page scrolls sideways.
- Neither Playwright project is a phone or dark project (`desktop` and `instance` both use Desktop Chrome). A phone spec that checks dark mode calls `page.emulateMedia({ colorScheme })` inside the test, as `e2e/auth-browser.spec.ts` does for each scheme. Both projects also run at `deviceScaleFactor` 1. It is a browser-context option that a test cannot change, so a check of the 2x `srcset` file sets `test.use({ deviceScaleFactor: 2 })` in a `test.describe` and reads the image's `currentSrc` after `decode()`, as `e2e/typography.spec.ts` does.
- `expectFits` uses `scrollIntoViewIfNeeded`, which stops about a pixel short of the bottom edge of an element taller than most of the screen, such as `.calendar-body`. Call `element.scrollIntoView({ block: 'center' })` through `evaluate` first, as `e2e/mobile-timer.spec.ts` does.
- `cellTexts(rows)` in `e2e/report-tests-helpers.ts` waits for the first row, so a loading table is not read as empty, then reads every row once. When more rows may still arrive, poll it: `expect.poll(() => cellTexts(rows))`. Treat any one-shot table read the same way.
- `page.waitForLoadState('networkidle')` resolves once the page has reached network idle, and immediately if it already has, so it cannot show that a page has no request loop. Count the requests, wait through a quiet window and check the count has not grown, as the logout test in `e2e/theme.spec.ts` does with `/api/v9/me`.
- Chromium's mobile emulation snaps a touch on bare margin to a nearby control. To close a popover the way a finger does, use `tapOutside` on plain text away from the popover, such as a heading.
- A spec that expects a timer entry to group with another entry "today" breaks near local midnight, and faking the browser clock does not help because the server stamps start and stop from its own clock. Midnight can pass mid-test, and a stopped timer whose start fell in the last half step of a day (2.5 minutes at the default 5-minute resolution) snaps forward to 0:00 of the next day (see `practice-stopped-entries-snap-to-the-time-resolution-on-write`). Put every entry the assertion groups on a fixed past day instead, as `e2e/features.spec.ts` does. Take the day from `madridWallClock(new Date(Date.now() - 3 * DAY_MS)).day` in `e2e/timer-tests-helpers.ts`, fill the form's `Date` field with it (`getByLabel('Date', { exact: true })`), and seed any companion entry on that day with `TimerApi.createEntry` at noon UTC, which is the same day in Europe/Madrid, then `page.reload()`.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-entry-resolution-at-dst-imports-and-reports](../../../api-and-data/time-handling/stopped-entry-resolution/practice-entry-resolution-at-dst-imports-and-reports.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-stopped-entry-grid-validation](../../../api-and-data/time-handling/stopped-entry-resolution/practice-stopped-entry-grid-validation.md)
- Related: [practice-stopped-entries-snap-to-the-time-resolution-on-write → practice-timer-stop-snapping-and-duration-limits](../../../api-and-data/time-handling/stopped-entry-resolution/practice-timer-stop-snapping-and-duration-limits.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [.ai/kenkeep/nodes/web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md](../../../web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md)
<!-- kk:citations:end -->
