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
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start or resume, keeps a pause chain; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet and the applet chain store; QML_FOREIGN types; version and README.
### #kde
- Open [**KDE panel: button, menu and project indicator**](../plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu: clicks and keys, the Start or Stop item, the Open Tokkl URL, and the project indicator's shapes and pulse.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](../practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start or resume, keeps a pause chain; the project is locked while running or paused.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](../plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet and the applet chain store; QML_FOREIGN types; version and README.
### #auth
- Open [**Admin user management API and the last-active-admin rule**](../../../api-and-data/users-and-admin/map-admin-user-management-api-and-the-last-active-admin-rule.md) — /api/app/admin users: list, role, disable, session revoke, delete; one active admin must remain; disabled accounts are refused at sign-in.
- Open [**Invites and password-reset links in account_tokens**](../../../api-and-data/users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md) — Invite and reset tokens are hashed in account_tokens, shown once, and give one 404 for any bad link; a reset rotates the API token.
- Open [**Cookie writes and session-starting routes need the CSRF header**](../../../api-and-data/password-and-csrf-rules/practice-cookie-writes-and-session-starting-routes-need-the-csrf-header.md) — Cookie writes, login, setup, invite accept and password reset need X-Tokkl-CSRF: 1 before any lookup; callers and tests must send it.
### #configuration
- Open [**KDE companion credential stores: KWallet only, message() and reportWrite**](practice-kde-companion-credential-stores-kwallet-only-message-and-reportwrite.md) — Secrets live only in KWallet with no plaintext fallback; store wording via message(); writes report through reportWrite; tests use fakes.
- Open [**KDE Configure page: cfg_instanceUrl and the wallet save timing**](practice-kde-configure-page-cfg-instanceurl-and-the-wallet-save-timing.md) — cfg_instanceUrl holds only persistedUrl(); on a failed secret save the page keeps the input and re-enables Apply; OK still closes.