---
type: map
title: "Old Timetrack names still accepted after the Tokkl rename"
description: "Old Timetrack env vars, database file, cookie, CSRF header, theme key and export format still work."
tags:
  - server
  - web
  - config
  - rename
kk_schema_version: 3
kk_id: map-tokkl-rename-legacy-name-fallbacks
kk_derived_from: []
kk_relates_to:
  - practice-cookie-writes-and-session-starting-routes-need-the-csrf-header
  - practice-theme-tokens-data-theme-and-cached-theme
  - practice-json-restore-rules
  - map-npm-workspaces-package-layout
kk_depends_on: []
kk_confidence: high
---
The project is Tokkl. Existing installs keep working because each place that used the old Timetrack name also accepts it. Every fallback sits beside the current name in a `LEGACY_*` constant or a `TIMETRACK_` lookup:

- Environment: `loadConfig` in `packages/api/src/config.ts` reads `TOKKL_DATA_DIR`, `TOKKL_DATABASE`, `TOKKL_WEB_ROOT`, `TOKKL_TRUST_PROXY`, `TOKKL_SESSION_DAYS` and `TOKKL_SETUP_CODE`, and falls back to the `TIMETRACK_*` name for each. Any fallback adds one deprecation notice, which `packages/api/src/index.ts` prints with `console.warn` at startup.
- Database: with no database path set, the default is `data/tokkl.sqlite` (`DATABASE_FILE`). When that file does not exist and `timetrack.sqlite` (`LEGACY_DATABASE_FILE`) does, the server uses the old file and prints a notice on how to rename it. It never moves or renames the file itself.
- Session cookie: `SESSION_COOKIE` is `tokkl_session`; `LEGACY_SESSION_COOKIE` (`tt_session`, `packages/api/src/auth/sessions.ts`) is still read by `sessionTokens` in `auth/middleware.ts`. Setup, invite accept and login (all through `startSession`) and logout in `routes/app.ts` clear the old cookie and never issue it.
- CSRF header: `hasCsrfHeader` accepts `X-Tokkl-CSRF: 1` or `X-Timetrack-CSRF: 1` (`CSRF_HEADER`, `LEGACY_CSRF_HEADER`).
- Theme cache: `timetrack.theme` in localStorage moves to `tokkl.theme`, in both `packages/web/public/theme-boot.js` and `packages/web/src/lib/theme.ts`.
- JSON restore: `importJsonExport` accepts `format` `tokkl-export` or `timetrack-export` (`EXPORT_FORMAT`, `LEGACY_EXPORT_FORMAT` in `services/export.ts`). Exports are written as `tokkl-export`.

Dev and test variables have no fallback: `TOKKL_BACKEND` (Vite proxy target in `packages/web/vite.config.ts`), `TOKKL_E2E_DATA_DIR` (`playwright.config.ts`) and `TOKKL_SCREENSHOTS_DATA_DIR` (`scripts/screenshots.config.ts`). New settings get a `TOKKL_` name only.

<!-- kk:related:start -->
# Related

- Related: [practice-cookie-writes-and-session-starting-routes-need-the-csrf-header](../../api-and-data/password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md)
- Related: [practice-theme-tokens-data-theme-and-cached-theme](../../web-ui-styling-and-layout/practice-theme-tokens-data-theme-and-cached-theme.md)
- Related: [practice-json-restore-rules](../../api-and-data/toggl-compat-and-import/practice-json-restore-rules.md)
- Related: [map-npm-workspaces-package-layout](map-npm-workspaces-package-layout.md)
<!-- kk:related:end -->
