# kenkeep Index: tooling-and-project

↑ Parent: [kenkeep](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
- Load [`kde-companion/`](kde-companion/index.md) for more information on the KDE Plasma companion and desktop/core: layout, timer and connection rules, native packages, CI and release; read before changing anything under desktop/ or the kde release job.
- Load [`repo-and-scripts/`](repo-and-scripts/index.md) for more information on npm workspace layout, commit message rules, the Tokkl rename fallbacks, and the screenshot and icon scripts; read before adding a package or script, committing, or regenerating images.
- Load [`testing/`](testing/index.md) for more information on the Playwright e2e suite, visual baselines, what npm test and typecheck run, and the history bench; read before adding, running or debugging a test, spec or benchmark.

## Conventions (how we build)
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) to learn about: DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback. #packaging #desktop #debian #linux

## Components (what exists)
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) to learn about: tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container. #tooling #desktop #gnome #ci
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](map-gnome-shell-extension-for-tokkl-timerd.md) to learn about: desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; check.sh mock harness, realservice.sh real service. #tooling #desktop #gnome #ci #testing
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) to learn about: Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data. #docker #release #ci #deployment
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](map-macos-menu-bar-app.md) to learn about: desktop/macos splits a Linux-testable Qt library from three macOS-only shims; why NSStatusItem; what the macos CI job covers. #tooling #desktop #macos #ci

## By topic

### #ci
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; check.sh mock harness, realservice.sh real service.
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](map-macos-menu-bar-app.md) — desktop/macos splits a Linux-testable Qt library from three macOS-only shims; why NSStatusItem; what the macos CI job covers.
### #desktop
- Open [**KDE panel: button, menu and project indicator**](kde-companion/plasma-companion/map-kde-panel-button-menu-and-project-indicator.md) — PanelButton and PanelMenu wiring, keyboard and mouse bindings, Open Tokkl URL, and the project indicator's ring, pulse and reduced motion.
- Open [**KDE timer controller: server-derived time, one mutation, no replayed starts**](kde-companion/practice-kde-timer-controller-rules.md) — TokklTimer derives elapsed from the server start, polls 30 s, runs one mutation at a time, never replays a start, gates writes on a known entry; the project is locked while running, billable edits it with a partial PUT.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #tooling
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; check.sh mock harness, realservice.sh real service.
- Open [**desktop/core and desktop/kde: CMake projects, libraries and QML types**](kde-companion/plasma-companion/map-desktop-core-and-desktop-kde-cmake-projects-libraries-and-qml-types.md) — tokklcore is Qt-only in desktop/core; tokklkde adds KWallet; QML_FOREIGN types; version from root package.json; README guide.
### #gnome
- Open [**GNOME timer service: tokkl-timerd and org.tokkl.Timer1**](map-gnome-timerd-d-bus-timer-service.md) — tokkl-timerd is a headless Qt service on the shared core; D-Bus contract rules, activation and the check.sh container.
- Open [**GNOME Shell extension: panel button, versions and the two CI harnesses**](map-gnome-shell-extension-for-tokkl-timerd.md) — desktop/gnome/extension drives tokkl-timerd; Shell 46-51; Shell 50 click gesture; check.sh mock harness, realservice.sh real service.
### #debian
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) — DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback.
### #deployment
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
- Open [**Keep TrueNAS install steps out of the repo README**](repo-and-scripts/practice-keep-truenas-install-steps-out-of-the-repo-readme.md) — The README documents generic Docker use only. Install steps for TrueNAS or other NAS admin screens stay out of the repo.
### #docker
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
### #linux
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) — DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback.
### #macos
- Open [**macOS menu bar app: portable library, Objective-C++ shims and CI**](map-macos-menu-bar-app.md) — desktop/macos splits a Linux-testable Qt library from three macOS-only shims; why NSStatusItem; what the macos CI job covers.
### #packaging
- Open [**KDE native packaging: DEB, RPM and the version mapping**](kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**Target Debian for Debian-family desktop packages, not niche distros**](practice-target-debian-for-debian-family-desktop-packages-not-niche-distros.md) — DEB builds for the desktop companions target stock Debian; niche distros like TUXEDO OS are not targets. Ubuntu is the fallback.
### #release
- Open [**KDE CI job and release: kde matrix, real-server test, semantic-release plugin**](kde-companion/map-kde-ci-and-release-pipeline.md) — The kde CI job builds, tests and checks the DEB and RPM in pinned containers; the release builds them again and attaches both to the v<version> release.
- Open [**KDE native packaging: DEB, RPM and the version mapping**](kde-companion/map-kde-native-packaging.md) — tokkl-kde DEB and RPM are built and checked only in containers; scripts/native-version.sh is the one version mapping.
- Open [**Container image ghcr.io/e0ipso/tokkl**](map-container-image-ghcr-io-e0ipso-tokkl.md) — Multi-arch image built from the root Dockerfile and pushed by the CI release job when semantic-release tags; writes only to /data.
### #testing
- Open [**E2E isolation: worker accounts, the reset fixture and the error guard**](testing/e2e-suite/practice-e2e-isolation-worker-accounts-the-reset-fixture-and-the-error-guard.md) — Each worker has its own admin; the data fixture wipes that user's data; runtimeErrors fails tests unless a spec allows the failure.
- Open [**Writing e2e specs: areas, shared helpers and extra accounts**](testing/e2e-suite/practice-writing-e2e-specs-areas-shared-helpers-and-extra-accounts.md) — Specs live by area with per-area helpers; ReportApi, transfer fixtures, disposable servers, the users fixture and login.
- Open [**Running the e2e suite: build, Chromium, ports and the data directory**](testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md) — test:e2e builds first; desktop runs in parallel and instance on one worker; E2E_PORT per run; a preset data dir is locked.