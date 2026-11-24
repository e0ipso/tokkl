# kenkeep Index: tooling-and-project / kde-companion / connection-and-credentials

↑ Parent: [kde-companion](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
- Open [**KDE companion credential stores: KWallet only, message() and reportWrite**](practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md) to learn about: Secrets live only in KWallet with no plaintext fallback; store wording via message(); writes report through reportWrite; tests use fakes. #kde #desktop #auth #configuration
- Open [**KDE companion requests: Basic auth, access kinds and stale replies**](practice-kde-companion-requests-basic-auth-access-kinds-and-stale-replies.md) to learn about: Basic auth with the instance path prefix, no followed redirects; Access kinds decide what 401/403 mean; older-generation replies drop. #kde #desktop #auth
- Open [**KDE Configure page: cfg_instanceUrl and the wallet save timing**](practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing.md) to learn about: cfg_instanceUrl holds only persistedUrl(); on a failed secret save the page keeps the input and re-enables Apply; OK still closes. #kde #desktop #configuration

## Components (what exists)
_None yet._

## By topic

### #desktop
- Open [**KDE panel: button, menu and project indicator**](../plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer shows the server's timer state, derives elapsed from the server start and clock, runs one mutation at a time and never replays a write; the pause chain and sessions are the server's; the project is locked while running or paused.
- Open [**tokklkde static library, KWallet store and tokkl-kde client name**](../plasma-companion/desktop-cmake-projects/map-tokklkde-static-library-kwallet-store-and-tokkl-kde-client-name.md) — tokklkde links tokklcore plus KWallet and Plasma; KdeTimerState, AppletPomodoroStore; callers inject the store and client name.
### #kde
- Open [**tokklcore static library and its CTest suites in desktop/core**](../plasma-companion/desktop-cmake-projects/map-tokklcore-static-library-and-its-ctest-suites-in-desktop-core.md) — tokklcore is Qt-only (Core, Network, Test): API client, credential interface, state client, timer, Pomodoro, TimerStack, tests.
- Open [**KDE QML_FOREIGN types and backend module linking**](../plasma-companion/desktop-cmake-projects/map-kde-qml-foreign-types-and-backend-module-linking.md) — qmltypes.h exposes the KDE and core types to QML; main.qml wiring; backend module links and the KF6 Config workaround.
- Open [**desktop/kde CMake project, Plasma widget package and minimum versions**](../plasma-companion/desktop-cmake-projects/map-desktop-kde-cmake-project-plasma-widget-package-and-minimum-versions.md) — desktop/kde is a standalone CMake project outside npm and Docker; widget and backend module ids; Qt, KF6, Plasma minimums.
### #auth
- Open [**Recheck credentials inside the guarded account transaction**](../../../api-and-data/password-and-csrf-rules/password-attempt-limits/practice-recheck-credentials-inside-the-guarded-account-transaction.md) — Auth and PUT /me recheck the account and credential under the guarded transaction, so revocations during scrypt refuse stale credentials.
- Open [**Validate new passwords with parseNewPassword**](../../../api-and-data/password-and-csrf-rules/password-attempt-limits/practice-validate-new-passwords-with-parsenewpassword.md) — New passwords are 8-1024 characters and go through parseNewPassword; current passwords are not capped on login or rotation.
- Open [**Verify passwords only through FailureLimiter.attempt**](../../../api-and-data/password-and-csrf-rules/password-attempt-limits/practice-verify-passwords-only-through-failurelimiter-attempt.md) — Password checks run in loginLimiter.attempt over three counters; refusals answer 429 with Retry-After; never call verifyPassword directly.
### #configuration
- Open [**KDE companion credential stores: KWallet only, message() and reportWrite**](practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md) — Secrets live only in KWallet with no plaintext fallback; store wording via message(); writes report through reportWrite; tests use fakes.
- Open [**KDE Configure page: cfg_instanceUrl and the wallet save timing**](practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing.md) — cfg_instanceUrl holds only persistedUrl(); on a failed secret save the page keeps the input and re-enables Apply; OK still closes.