# Tokkl KDE companion: build notes

A Plasma 6 panel widget for Tokkl. It has two parts:

- `package/`: the widget, a QML package with plugin id `com.github.e0ipso.tokkl`.
  Its entry point is `contents/ui/main.qml`.
- `src/`: the backend, a Qt/C++ QML module imported as `com.github.e0ipso.tokkl.backend`.

This is a standalone CMake project. The npm workspaces, `npm run build` and the
server image do not build or ship it.

## Requirements

| Dependency                                        | Minimum |
| ------------------------------------------------- | ------- |
| CMake                                             | 3.27    |
| Qt 6: Core, Network, Qml, Quick (Test for tests)  | 6.10    |
| Extra CMake Modules; KF6 Wallet, Package, Config  | 6.24    |
| Plasma: libplasma, PlasmaQuick                    | 6.6     |

The minimums cover the two supported targets: TUXEDO OS 24.04 (Qt 6.10.2, KDE
Frameworks 6.24.0, Plasma 6.6.6) and Fedora KDE 44 (Qt 6.11.2, KDE Frameworks
6.25.0 and libplasma 6.6.4 in October 2026). Older Plasma 6 releases are not
supported.

Packages on TUXEDO OS 24.04: `cmake extra-cmake-modules qt6-base-dev
qt6-declarative-dev libplasma-dev libkf6wallet-dev`.

## Configure, build and test

Run from the repository root. The examples build in `desktop/kde/build`, which
git ignores; any other directory works too.

```sh
cmake -S desktop/kde -B desktop/kde/build -DCMAKE_INSTALL_PREFIX=/usr
cmake --build desktop/kde/build -j"$(nproc)"
ctest --test-dir desktop/kde/build --output-on-failure
```

CTest runs these checks:

- `version`: version resolution and metadata stamping.
- `stage-install`, `smokeload`, `stage-cleanup`: install into
  `<build>/autotests/stage` with `DESTDIR`, then load the widget and the backend
  from there in an offscreen Plasma session. The test uses its own XDG
  directories, so widgets installed in your home directory do not interfere.
- `appstreamtest`: added by Extra CMake Modules when `appstreamcli` is installed.

## Version

The version comes from the `version` field of the root `package.json`. A
release build passes the resolved Tokkl version instead:

```sh
cmake -S desktop/kde -B desktop/kde/build -DTOKKL_VERSION=1.2.0
```

`package/metadata.json` has no `Version` key. The build writes the version into
the copy it installs, and configuring fails if the source file has one.
Building outside the Tokkl checkout requires `-DTOKKL_VERSION`.

## Staged install

```sh
DESTDIR="$(mktemp -d)" cmake --install desktop/kde/build
```

With `CMAKE_INSTALL_PREFIX=/usr` the staged tree uses the standard paths:

| Part    | Debian/TUXEDO                                                  | Fedora                                      |
| ------- | -------------------------------------------------------------- | ------------------------------------------- |
| Widget  | `/usr/share/plasma/plasmoids/com.github.e0ipso.tokkl/`         | same                                        |
| Backend | `/usr/lib/x86_64-linux-gnu/qt6/qml/com/github/e0ipso/tokkl/backend/` | `/usr/lib64/qt6/qml/com/github/e0ipso/tokkl/backend/` |

The backend goes to Qt's own QML directory (`KDE_INSTALL_QMLDIR`), so the
path follows the distribution's Qt layout.
