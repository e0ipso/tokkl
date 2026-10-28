---
schema_version: 1
summaries:
  api-and-data: >-
    the API's data rules: reports, writes, restore, auth and timestamps; read
    before changing a route, model, migration or import
  api-and-data/password-and-csrf-rules: >-
    password rate limits, Retry-After and the CSRF header rule; read before
    adding a route that checks or sets a password, starts a session or writes
  api-and-data/reports-and-totals: >-
    report endpoints, project and task totals, hourly rates, write-path
    reference checks and client deletion; read before changing reports, totals,
    rates or project and client writes
  api-and-data/time-handling: >-
    timestamp parsing, canonical time zone names and time-resolution snapping of
    stopped entries; read before changing how the API reads, stores or rounds
    times
  api-and-data/timer-state: >-
    the server-owned timer state (running entry, pause chain, Pomodoro session),
    its revisions and actions, and the SSE event stream; read before changing
    timer routes, writes to the running entry, or stream auth
  api-and-data/toggl-compat-and-import: >-
    Toggl v9 DELETE responses, Toggl CSV import and JSON restore; read before
    changing a v9 route or an import or restore path
  api-and-data/users-and-admin: >-
    accounts, roles, workspace membership, preferences, the admin API, invites,
    password resets and instance settings; read before changing users, admin
    routes, sign-in refusal or instance settings
  tooling-and-project: >-
    workspace layout, commit and tracker-reference rules, the Tokkl rename
    fallbacks, tests, e2e, bench, generated assets, the KDE desktop companion
    and the macOS and GNOME desktop apps; read before adding a package, script
    or test, committing, running a check or changing desktop/
  tooling-and-project/kde-companion: >-
    the KDE Plasma companion and desktop/core: layout, timer and connection
    rules, native packages, CI and release; read before changing anything under
    desktop/ or the kde release job
  tooling-and-project/kde-companion/connection-and-credentials: >-
    the KDE companion's HTTP client, access kinds, settings generations,
    credential stores and Configure page; read before changing desktop
    connection, auth, KWallet or configGeneral.qml code
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
  web-ui-behaviour/interaction-and-state: >-
    shared fields, focus, error states, refetches, clipboard and authentication
    cleanup; read before changing web interactions or account state
  web-ui-behaviour/pomodoro: >-
    pomodoro lengths, phases, the web views of the server's session and timer
    state, notifications and audio; read before changing Pomodoro behaviour
  web-ui-behaviour/time-and-timers: >-
    time parsing, account-local wall-clock math, snapped previews and the web
    timer actions (pause, resume, revisions); read before changing entry times
    or timer state
  web-ui-styling-and-layout: >-
    app shell, styles.css tokens, themes, contrast and phone and calendar
    layout; read before changing CSS, colours or page layout
  web-ui-styling-and-layout/calendar: >-
    calendar day mode, touch gestures, lanes and hour geometry; read before
    changing WeekCalendar rendering or dragging
  web-ui-styling-and-layout/shell-and-layout: >-
    app branding, navigation, PWA icons, shared controls and responsive page
    layout; read before changing the shell or page sizing
  web-ui-styling-and-layout/theme-and-tokens: >-
    colour tokens, contrast, section hues, fonts, motion and theme caching; read
    before changing shared CSS or theme behaviour
---
# kenkeep Folder Summaries

- `api-and-data`: the API's data rules: reports, writes, restore, auth and timestamps; read before changing a route, model, migration or import
- `api-and-data/password-and-csrf-rules`: password rate limits, Retry-After and the CSRF header rule; read before adding a route that checks or sets a password, starts a session or writes
- `api-and-data/reports-and-totals`: report endpoints, project and task totals, hourly rates, write-path reference checks and client deletion; read before changing reports, totals, rates or project and client writes
- `api-and-data/time-handling`: timestamp parsing, canonical time zone names and time-resolution snapping of stopped entries; read before changing how the API reads, stores or rounds times
- `api-and-data/timer-state`: the server-owned timer state (running entry, pause chain, Pomodoro session), its revisions and actions, and the SSE event stream; read before changing timer routes, writes to the running entry, or stream auth
- `api-and-data/toggl-compat-and-import`: Toggl v9 DELETE responses, Toggl CSV import and JSON restore; read before changing a v9 route or an import or restore path
- `api-and-data/users-and-admin`: accounts, roles, workspace membership, preferences, the admin API, invites, password resets and instance settings; read before changing users, admin routes, sign-in refusal or instance settings
- `tooling-and-project`: workspace layout, commit and tracker-reference rules, the Tokkl rename fallbacks, tests, e2e, bench, generated assets, the KDE desktop companion and the macOS and GNOME desktop apps; read before adding a package, script or test, committing, running a check or changing desktop/
- `tooling-and-project/kde-companion`: the KDE Plasma companion and desktop/core: layout, timer and connection rules, native packages, CI and release; read before changing anything under desktop/ or the kde release job
- `tooling-and-project/kde-companion/connection-and-credentials`: the KDE companion's HTTP client, access kinds, settings generations, credential stores and Configure page; read before changing desktop connection, auth, KWallet or configGeneral.qml code
- `tooling-and-project/kde-companion/plasma-companion`: the desktop/core and desktop/kde projects, the panel UI and the CTest suite; read before changing desktop CMake, panel QML or desktop tests
- `tooling-and-project/repo-and-scripts`: npm workspace layout, commit message rules, the Tokkl rename fallbacks, and the screenshot and icon scripts; read before adding a package or script, committing, or regenerating images
- `tooling-and-project/testing`: the Playwright e2e suite, visual baselines, what npm test and typecheck run, and the history bench; read before adding, running or debugging a test, spec or benchmark
- `tooling-and-project/testing/e2e-suite`: how the Playwright e2e suite runs, isolates workers and accounts, and how to write specs; read before running, adding or debugging an e2e spec
- `web-ui-behaviour`: web UI logic: page states, keyboard focus, time entry parsing, wall-clock math, refetch handling and clipboard; read before changing components or client-side helpers
- `web-ui-behaviour/interaction-and-state`: shared fields, focus, error states, refetches, clipboard and authentication cleanup; read before changing web interactions or account state
- `web-ui-behaviour/pomodoro`: pomodoro lengths, phases, the web views of the server's session and timer state, notifications and audio; read before changing Pomodoro behaviour
- `web-ui-behaviour/time-and-timers`: time parsing, account-local wall-clock math, snapped previews and the web timer actions (pause, resume, revisions); read before changing entry times or timer state
- `web-ui-styling-and-layout`: app shell, styles.css tokens, themes, contrast and phone and calendar layout; read before changing CSS, colours or page layout
- `web-ui-styling-and-layout/calendar`: calendar day mode, touch gestures, lanes and hour geometry; read before changing WeekCalendar rendering or dragging
- `web-ui-styling-and-layout/shell-and-layout`: app branding, navigation, PWA icons, shared controls and responsive page layout; read before changing the shell or page sizing
- `web-ui-styling-and-layout/theme-and-tokens`: colour tokens, contrast, section hues, fonts, motion and theme caching; read before changing shared CSS or theme behaviour
