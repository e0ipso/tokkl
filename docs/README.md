# Tokkl documentation

[Repository overview](../README.md)

## Use Tokkl

| I want to… | Read |
| --- | --- |
| Set up my account or understand time settings | [Using Tokkl](using-tokkl.md) |
| Import Toggl history or restore an account export | [Import and export](data.md) |
| Connect a script or Toggl-compatible client | [API clients](api.md) |
| Install a desktop companion | [KDE](../desktop/kde/README.md), [macOS](../desktop/macos/README.md), [GNOME](../desktop/gnome/README.md) |

## Run a server

Start with [installation options](hosting/README.md) if you have not installed
Tokkl yet. The native VPS guide is a sequence of commands; the configuration and
database guides are references you can consult as needed.

| I want to… | Read |
| --- | --- |
| Deploy a VPS with Node, systemd and nginx | [Native VPS installation](hosting/native-vps.md) |
| Update that VPS to a chosen version or the latest release | [VPS updater](hosting/vps-updates.md) |
| Change settings or enable public registration | [Server configuration](hosting/configuration.md) |
| Choose SQLite, PostgreSQL, MySQL or MariaDB | [Database selection](hosting/databases.md) |
| Configure a proxy, monitor health, back up, upgrade or run several instances | [Server operations](hosting/operations.md) |

## Develop Tokkl

- [Development](development.md) covers local servers, checks, benchmarks and release conventions.
- [Product requirements](PRD.md) describe features, API coverage and client behavior in detail.
- [Brand assets](brand/README.md) and [sound assets](sounds/README.md) document the shared artwork and audio.

Implementation notes live with their code under `packages/api/src/`, including
[storage](../packages/api/src/storage/README.md),
[HTTP handling](../packages/api/src/http/README.md) and
[authentication](../packages/api/src/auth/README.md).
