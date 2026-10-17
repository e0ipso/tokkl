---
type: practice
title: Playwright gotchas in the e2e specs
description: >-
  200 is not proof a file exists; clock.install not pauseAt; phone helpers,
  expectFits, cellTexts polling, networkidle limits.
tags:
  - testing
  - playwright
kk_schema_version: 3
kk_id: practice-playwright-gotchas-in-the-e2e-specs
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
- The static server answers unknown paths with the HTML app shell and status 200, so a 200 does not prove a static file exists. Check the content type, as `e2e/pwa.spec.ts` does for the manifest icons in `packages/web/public/manifest.webmanifest`. Better, decode the image: `e2e/typography.spec.ts` calls `img.decode()` on the brand images and checks `naturalWidth`. That spec also checks that each icon decodes at its declared size and that `start_url` falls inside the scope; the manifest has no `scope` member, so the scope defaults to the directory of `start_url` (`/`).
- To assert that a control does not open the native colour picker, stub `HTMLInputElement.prototype.showPicker` in `page.addInitScript` and count the calls, as `a11y-keyboard.spec.ts` does. The real picker is outside the page and cannot be inspected.
- `getByRole`/`getByLabel` name matching is a case-insensitive substring match unless you pass `exact: true`.
- A synthetic `visibilitychange` must be dispatched with `{ bubbles: true }` when fired on `document`, because the focus listener in `packages/web/src/main.tsx` listens on `window`.
- For timer-driven behaviour use `page.clock.install()` with `fastForward`. Do not use `clock.pauseAt`: TanStack Query's notify scheduler uses `setTimeout(0)`, which then never fires and queries stop updating the UI.
- Phone specs (`mobile-timer`, `mobile-reports`, `mobile-transfer`, `mobile-manage`) call `test.use(PHONE)` from `e2e/mobile-tests-helpers.ts`: a 390x844 viewport with `isMobile` and `hasTouch`. Drive them with the helpers. `tap` runs `expectFits` first, which checks the control is fully on screen, and `expectNoPageOverflow` fails if the page scrolls sideways.
- Neither Playwright project is a phone or dark project (`desktop` and `instance` both use Desktop Chrome). A phone spec that checks dark mode calls `page.emulateMedia({ colorScheme })` inside the test, as `e2e/auth-browser.spec.ts` does for each scheme.
- `expectFits` uses `scrollIntoViewIfNeeded`, which stops about a pixel short of the bottom edge of an element taller than most of the screen, such as `.calendar-body`. Call `element.scrollIntoView({ block: 'center' })` through `evaluate` first, as `e2e/mobile-timer.spec.ts` does.
- `cellTexts(rows)` in `e2e/report-tests-helpers.ts` waits for the first row, so a loading table is not read as empty, then reads every row once. When more rows may still arrive, poll it: `expect.poll(() => cellTexts(rows))`. Treat any one-shot table read the same way.
- `page.waitForLoadState('networkidle')` resolves once the page has reached network idle, and immediately if it already has, so it cannot show that a page has no request loop. Count the requests, wait through a quiet window and check the count has not grown, as the logout test in `e2e/theme.spec.ts` does with `/api/v9/me`.
- Chromium's mobile emulation snaps a touch on bare margin to a nearby control. To close a popover the way a finger does, use `tapOutside` on plain text away from the popover, such as a heading.

<!-- Verified against the current code on 2026-10-16. -->
