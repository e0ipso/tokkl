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
- Open [**Desktop colour and monochrome icons**](map-desktop-colour-and-monochrome-icons.md) to learn about: LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks. #icons #monochrome #tooling #imagemagick
- Open [**Wordmark crop and its four outputs**](map-wordmark-crop-and-its-four-outputs.md) to learn about: WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop. #wordmark #web #icons #imagemagick

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
- Open [**Release stages, KDE semantic-release plugin and GNOME assets**](../../kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md) — A push to main runs release-version, two kde-release legs, then release; the plugin gates on the manifests; GNOME assets upload after.
- Open [**KDE and core CI jobs**](../../kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md) — The kde job builds, tests and checks the DEB and RPM in pinned containers; core checks Qt Core-only links; baseline floors; manual checks.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../../kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet, the applet Pomodoro store and the KDE wiring; QML_FOREIGN types; version and README.
### #maskable
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
### #monochrome
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
- Open [**Desktop colour and monochrome icons**](map-desktop-colour-and-monochrome-icons.md) — LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack outline to PANEL_STROKE; don't test hicolor picks.
### #wordmark
- Open [**Wordmark crop and its four outputs**](map-wordmark-crop-and-its-four-outputs.md) — WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop.
- Open [**App shell: Brand.tsx, the wordmark image and the NAV list**](../../../web-ui-styling-and-layout/shell-and-layout/map-app-shell-brand-and-navigation.md) — One Brand component (the PNG Tokkl wordmark alone); one NAV list whose inMore pages move into the phone More dialog.
- Open [**icons.test.ts checks and rerunning the script**](map-icons-test-ts-checks-and-rerunning-the-script.md) — No test reruns icons.ts; icons.test.ts decodes committed PNGs with node:zlib; rerun the script in a temp copy of scripts/ and docs/.
### #pwa
- Open [**npm run icons inputs and web icons**](map-npm-run-icons-inputs-and-web-icons.md) — icons.ts reads the docs/brand packs with magick; copies touch icons, resizes LOGO, quantises maskables under the pwa.spec budgets.
- Open [**PWA manifest and head icon links, and what e2e/pwa.spec.ts checks**](../../../web-ui-styling-and-layout/shell-and-layout/map-pwa-manifest-and-head-icon-links.md) — The manifest pins id and scope to /, uses #291329 and five pack icons; index.html links the ICO, two PNGs and four touch icons.
### #web
- Open [**Bulk bar sticks under the timer bar through --timer-bar-height**](../../../web-ui-styling-and-layout/shell-and-layout/practice-timer-bar-height-drives-sticky-bulk-bar.md) — TimerBar writes --timer-bar-height on <html>; .bulk-bar sticks at it; phones zero it while entries are selected.
- Open [**Calendar lanes follow stored spans; zero-length markers draw on top**](../../../web-ui-styling-and-layout/calendar/practice-calendar-lanes-follow-stored-spans-and-zero-length-markers-draw-on-top.md) — assignLanes clusters on stored spans, shorter first; thin blocks, markers and drags stack 3, 4, 5; blocks under a marker are drawn taller.
- Open [**Week calendar hour height lives in three places**](../../../web-ui-styling-and-layout/calendar/practice-week-calendar-hour-height-agrees-in-three-places.md) — HOUR_HEIGHT, the 48px hour lines in styles.css and HOUR in the e2e calendar helpers must match.