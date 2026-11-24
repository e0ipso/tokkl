# kenkeep Index: tooling-and-project / repo-and-scripts / app-icons-script

↑ Parent: [repo-and-scripts](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) to learn about: No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/. #tooling #icons #maskable #wordmark #monochrome
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) to learn about: icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets. #tooling #pwa #icons #imagemagick #maskable
- Open [**Wordmark crop and its four outputs**](map-wordmark-crop-and-its-four-outputs.md) to learn about: WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop. #wordmark #web #icons #imagemagick
- Open [**Desktop colour and monochrome icons**](map-desktop-colour-and-monochrome-icons.md) to learn about: LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks. #icons #monochrome #tooling #imagemagick

## By topic

### #icons
- Open [**Desktop colour and monochrome icons**](map-desktop-colour-and-monochrome-icons.md) — LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks.
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
### #imagemagick
- Open [**Desktop colour and monochrome icons**](map-desktop-colour-and-monochrome-icons.md) — LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks.
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**Wordmark crop and its four outputs**](map-wordmark-crop-and-its-four-outputs.md) — WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop.
### #tooling
- Open [**tokklcore static library and its CTest suites in desktop/core**](../../kde-companion/plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](../../kde-companion/plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](../../kde-companion/plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #maskable
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
### #monochrome
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
- Open [**Desktop colour and monochrome icons**](map-desktop-colour-and-monochrome-icons.md) — LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks.
### #wordmark
- Open [**Brand component and the PNG wordmark image**](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-brand-component-and-the-png-wordmark-image.md) — Brand.tsx renders only the PNG Tokkl wordmark in sm, md and lg sizes; the app icon is only the browser and OS icon.
- Open [**Wordmark dark-mode halo and its e2e checks**](../../../web-ui-styling-and-layout/shell-and-layout/app-shell/map-wordmark-dark-mode-halo-and-its-e2e-checks.md) — The --wordmark-halo drop-shadows trace the navy wordmark outline in dark; e2e/typography.spec.ts checks the wordmark and halo.
- Open [**Wordmark crop and its four outputs**](map-wordmark-crop-and-its-four-outputs.md) — WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop.
### #pwa
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](../../../web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.