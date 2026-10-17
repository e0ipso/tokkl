---
schema_version: 1
summaries:
  api-and-data: >-
    the API's data rules: reports, writes, restore, auth and timestamps; read
    before changing a route, model, migration or import
  api-and-data/password-and-csrf-rules: >-
    password rate limits, Retry-After and the CSRF header rule; read before
    adding a route that checks or sets a password, starts a session or writes
  tooling-and-project: >-
    workspace layout, commit and tracker-reference rules, the Tokkl rename
    fallbacks, tests, e2e, bench, generated assets, the KDE desktop companion
    and the macOS and GNOME desktop apps; read before adding a package, script
    or test, committing, running a check or changing desktop/
  tooling-and-project/kde-companion: >-
    the KDE Plasma companion and desktop/core: layout, timer and connection
    rules, native packages, CI and release; read before changing anything under
    desktop/ or the kde release job
  tooling-and-project/kde-companion/plasma-companion: >-
    the desktop/core and desktop/kde projects, the panel UI and the CTest suite;
    read before changing desktop CMake, panel QML or desktop tests
  tooling-and-project/repo-and-scripts: >-
    npm workspace layout, commit message rules, the Tokkl rename fallbacks, and
    the screenshot and icon scripts; read before adding a package or script,
    committing, or regenerating images
  tooling-and-project/testing: >-
    the Playwright e2e suite, visual baselines, what npm test and typecheck run,
    and the history bench; read before adding, running or debugging a test, spec
    or benchmark
  tooling-and-project/testing/e2e-suite: >-
    how the Playwright e2e suite runs, isolates workers and accounts, and how to
    write specs; read before running, adding or debugging an e2e spec
  web-ui-behaviour: >-
    web UI logic: page states, keyboard focus, time entry parsing, wall-clock
    math, refetch handling and clipboard; read before changing components or
    client-side helpers
  web-ui-styling-and-layout: >-
    app shell, styles.css tokens, themes, contrast and phone and calendar
    layout; read before changing CSS, colours or page layout
---
# kenkeep Folder Summaries

- `api-and-data`: the API's data rules: reports, writes, restore, auth and timestamps; read before changing a route, model, migration or import
- `api-and-data/password-and-csrf-rules`: password rate limits, Retry-After and the CSRF header rule; read before adding a route that checks or sets a password, starts a session or writes
- `tooling-and-project`: workspace layout, commit and tracker-reference rules, the Tokkl rename fallbacks, tests, e2e, bench, generated assets, the KDE desktop companion and the macOS and GNOME desktop apps; read before adding a package, script or test, committing, running a check or changing desktop/
- `tooling-and-project/kde-companion`: the KDE Plasma companion and desktop/core: layout, timer and connection rules, native packages, CI and release; read before changing anything under desktop/ or the kde release job
- `tooling-and-project/kde-companion/plasma-companion`: the desktop/core and desktop/kde projects, the panel UI and the CTest suite; read before changing desktop CMake, panel QML or desktop tests
- `tooling-and-project/repo-and-scripts`: npm workspace layout, commit message rules, the Tokkl rename fallbacks, and the screenshot and icon scripts; read before adding a package or script, committing, or regenerating images
- `tooling-and-project/testing`: the Playwright e2e suite, visual baselines, what npm test and typecheck run, and the history bench; read before adding, running or debugging a test, spec or benchmark
- `tooling-and-project/testing/e2e-suite`: how the Playwright e2e suite runs, isolates workers and accounts, and how to write specs; read before running, adding or debugging an e2e spec
- `web-ui-behaviour`: web UI logic: page states, keyboard focus, time entry parsing, wall-clock math, refetch handling and clipboard; read before changing components or client-side helpers
- `web-ui-styling-and-layout`: app shell, styles.css tokens, themes, contrast and phone and calendar layout; read before changing CSS, colours or page layout
