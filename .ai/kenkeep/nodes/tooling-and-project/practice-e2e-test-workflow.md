---
type: practice
title: Running the Playwright e2e suite
description: >-
  test:e2e builds first; each run gets its own data dir; auto fixtures wipe data
  and fail tests on runtime errors unless a spec allows them.
tags:
  - testing
  - e2e
  - playwright
  - workflow
kk_schema_version: 3
kk_id: practice-e2e-test-workflow
kk_derived_from: []
kk_relates_to:
  - practice-visual-screenshot-baselines
kk_depends_on: []
kk_confidence: high
---
- `npm run test:e2e` runs `npm run build` and then `playwright test`, so specs exercise the current UI. `npm run test:e2e:install` installs the Chromium headless shell explicitly; nothing installs it implicitly.
- `e2e/global-setup.ts` fails fast when the expected browser is missing or `CHROMIUM_PATH` points at nothing. Set `CHROMIUM_PATH` to use another Chromium or chrome-headless-shell binary. Leave it unset for `e2e/visual.spec.ts`: its baselines are tied to the default headless shell that Playwright 1.64.1 installs (revision 1248), and the older 1223 build in the cache renders them differently.
- `E2E_PORT` (default 8095) lets concurrent runs coexist; give each concurrent run its own port, because `webServer` sets `reuseExistingServer: false` and will not share a server already on the port. `playwright.config.ts` picks a fresh `TOKKL_E2E_DATA_DIR` under the OS temp directory per run and deletes it when the run exits, pass or fail; a preset `TOKKL_E2E_DATA_DIR` is used as is.
- The automatic fixture in `e2e/fixtures.ts` deletes entries (running or not), the trash, projects, clients and tags, and resets preferences before and after every test. Each spec must create the data it needs and cannot rely on another spec's leftovers.
- Every scenario also runs under the automatic `runtimeErrors` fixture (`RuntimeErrors` in `e2e/runtime-errors.ts`). It fails the test on uncaught page errors, console errors, responses with status 400 or higher, and failed requests. React logs errors caught by an ErrorBoundary through `console.error`, so those fail the test too. Chromium's "Failed to load resource" console lines are ignored because the response and requestfailed listeners already record the same failures.
- The guard has two exceptions. An `/api/` 403 on a request without a `tokkl_session` cookie passes, because the app probes `/api/v9/me` on load while logged out. A scenario that provokes a failure on purpose calls `runtimeErrors.allowResponse({ status, method, path, reason })` before triggering it; `path` is a RegExp and `reason` says why the failure is expected. Do not clear `runtimeErrors.issues` in scenarios. Only the canaries in `e2e/guard.spec.ts` do that.
- The static server answers unknown paths with the HTML app shell and status 200, so a 200 does not prove a static file exists. Check the content type, as `e2e/pwa.spec.ts` does for the manifest icons in `packages/web/public/manifest.webmanifest`. Better, decode the image: `e2e/typography.spec.ts` calls `img.decode()` on the brand images and checks `naturalWidth`. That spec also checks that each icon decodes at its declared size and that `start_url` falls inside the scope; the manifest has no `scope` member, so the scope defaults to the directory of `start_url` (`/`).

Writing specs:

- Spec files are named by area (`timer-*`, `history-*`, `groups-*`, `refresh-*`, `transfer-*`, `entities-*`, `report-*`, `auth-*`, `a11y-*`) and share helpers in a per-area `*-tests-helpers.ts` file (`timer-tests-helpers.ts`, `entity-tests-helpers.ts`, `report-tests-helpers.ts`, and so on). Put new scenarios in the matching area.
- The reset fixture does not touch week start, workspace rounding or rates. `report-tests-helpers.ts` exports a `test` whose `api` fixture (`ReportApi`) saves those settings before each test and restores them after; use it for anything that changes them.
- Transfer fixtures live in `e2e/fixtures-data/transfer`. `transferFixture(name, replacements)` in `transfer-tests-helpers.ts` fills `{{KEY}}` placeholders, for example with IDs created during the test.
- `auth-tests-helpers.ts` starts disposable servers on `E2E_PORT + 50` to `+ 59`. It can shift only that server's clock by passing `--import` with a `data:` URL module. Cookies are scoped by host, not port, so a disposable server on 127.0.0.1 shares `tokkl_session` with the main test server inside one browser context. Start them through the `servers` fixture (`ServerPool`), which stops them and deletes their data directories after the test. Each `DisposableServer` has `output()`, the process's stdout and stderr so far; poll it to assert on log lines such as the startup setup code, as the lifecycle scenario in `e2e/auth-browser.spec.ts` does.
- The e2e server, and each disposable server, starts with exactly one account: the only admin and the only member of its workspace, because setup creates only the first admin. A scenario that needs a second account creates an invite as the admin with `createInvite(baseURL, apiToken, role)` and accepts it with `acceptInvite(baseURL, invite, email)`, both in `auth-tests-helpers.ts`; `acceptInvite` returns the new account's API token, workspace id and session cookie. `withAuth(baseURL, authorization, use)` runs calls under a given Authorization header, and `inviteApiPath` turns an `/invite/<token>` link into its API path. Anonymous writes (login, setup, invite acceptance) must send the CSRF header, `CSRF` in the same file. Test multi-user rules (non-members, other admins, disabled accounts, deletion) in the API tests with `addUser` from `packages/api/test/helpers.ts`; `e2e/auth-access.spec.ts` covers only what one account can see. For a limiter 429, `retryAfter(response)` in `auth-tests-helpers.ts` checks that `Retry-After` is an integer from 1 to `LIMIT_WINDOW_SECONDS` (900) and returns it.
- `e2e/helpers.ts` holds `login` and `contrast(a, b)`, the WCAG 2 ratio between two computed `rgb()`/`rgba()` colours; accessibility specs import it instead of keeping their own copy. `login` finds the setup form by the heading "Create the first admin" and the button "Create admin account" in `packages/web/src/pages/AuthPage.tsx`. Rename them in both places, or `login` fails on a server with no account yet.
- Specs for loading and error states (`page-states.spec.ts`) provoke the failure on purpose, so they call `runtimeErrors.allowResponse` for each failing request. Error toasts and load errors are both `role=alert`; scope or filter `getByRole('alert')` when more than one can be on screen.
- To assert that a control does not open the native colour picker, stub `HTMLInputElement.prototype.showPicker` in `page.addInitScript` and count the calls, as `a11y-keyboard.spec.ts` does. The real picker is outside the page and cannot be inspected.
- `getByRole`/`getByLabel` name matching is a case-insensitive substring match unless you pass `exact: true`.
- A synthetic `visibilitychange` must be dispatched with `{ bubbles: true }` when fired on `document`, because the focus listener in `packages/web/src/main.tsx` listens on `window`.
- For timer-driven behaviour use `page.clock.install()` with `fastForward`. Do not use `clock.pauseAt`: TanStack Query's notify scheduler uses `setTimeout(0)`, which then never fires and queries stop updating the UI.
- Phone specs (`mobile-timer`, `mobile-reports`, `mobile-transfer`, `mobile-manage`) call `test.use(PHONE)` from `e2e/mobile-tests-helpers.ts`: a 390x844 viewport with `isMobile` and `hasTouch`. Drive them with the helpers. `tap` runs `expectFits` first, which checks the control is fully on screen, and `expectNoPageOverflow` fails if the page scrolls sideways.
- `playwright.config.ts` has a single `desktop` project, so there is no phone or dark project to rely on. A phone spec that checks dark mode calls `page.emulateMedia({ colorScheme })` inside the test, as `e2e/auth-browser.spec.ts` does for each scheme.
- `expectFits` uses `scrollIntoViewIfNeeded`, which stops about a pixel short of the bottom edge of an element taller than most of the screen, such as `.calendar-body`. Call `element.scrollIntoView({ block: 'center' })` through `evaluate` first, as `e2e/mobile-timer.spec.ts` does.
- `cellTexts(rows)` in `e2e/report-tests-helpers.ts` waits for the first row, so a loading table is not read as empty, then reads every row once. When more rows may still arrive, poll it: `expect.poll(() => cellTexts(rows))`. Treat any one-shot table read the same way.
- `page.waitForLoadState('networkidle')` resolves once the page has reached network idle, and immediately if it already has, so it cannot show that a page has no request loop. Count the requests, wait through a quiet window and check the count has not grown, as the logout test in `e2e/theme.spec.ts` does with `/api/v9/me`.
- Chromium's mobile emulation snaps a touch on bare margin to a nearby control. To close a popover the way a finger does, use `tapOutside` on plain text away from the popover, such as a heading.
- On this host 127.0.0.1:8142 and 8143 are held by `rootlesskit`, the port forward of a rootless container, so do not pick an `E2E_PORT` that lands on them (directly or through the +50 disposable range). A taken port fails with `EADDRINUSE` when `webServer` starts; check with `ss -ltnp` first, then set `E2E_PORT` to a free port such as 8191.
