# Developing Tokkl

[Documentation](README.md) · [Repository](../README.md)

Use Node.js 24 or newer and run scripts from the repository root. The API and
web development server run in separate terminals:

```sh
npm ci
npm run dev          # API on :8080, restarts on change
npm run dev:web      # Vite on :5173, proxies API requests; use a second terminal
```

## Checks and production build

Before the first browser test run, install Playwright's browser:

```sh
npm run test:e2e:install
```

Then run the checks and production build:

```sh
npm test             # unit, API and storage tests; Docker required for server-engine cases
npm run typecheck
npm run lint
npm run check:tracker-refs
npm run build
npm run test:e2e     # builds, then runs Playwright tests
```

## Database and container checks

```sh
npm run test:backends # complete HTTP matrix and storage/migration/concurrency suites
npm run test:backends -- --suite postgres # one CI leg: sqlite|postgres|mysql|mariadb|storage
docker buildx build --platform linux/amd64 --load -t tokkl:local .
npm run test:container -- --image tokkl:local # all four native-image lifecycle checks
```

The backend suites and container smoke create isolated databases with random credentials using digest-pinned service images, then remove their owned resources. They require Docker.

CI requires every backend leg, storage tests and both image architecture builds
before release. Run heavy suites and benchmarks separately to avoid competing
for resources.

## History benchmark

```sh
npm run bench:history -- --backend sqlite --fixtures year,decade --no-browser --out /tmp/tokkl-history.json
```

The benchmark accepts `--backend sqlite|postgres|mysql|mariadb`, uses disposable
storage and refuses operator database URL variables. It measures 3,000/30,000-entry
fixtures with correctness checks and native query plans; timings are observations,
not CI thresholds.

## VPS updater tests

The updater's Linux tests use isolated fixtures and do not need root access, a
live VPS or network requests:

```bash
node --test scripts/update-vps.test.ts
```

See [the updater guide](hosting/vps-updates.md) for the supported installation
layout and update behavior.

## Repository layout

`packages/` contains `api` for Express and storage, `web` for React/Vite, `common`
for shared helpers, and `types` for API types. Browser tests live in `e2e/` and
tooling in `scripts/`. Desktop CMake builds are separate; follow the
[companion guides](using-tokkl.md#connect-other-clients). See
[brand assets](brand/README.md) and [sound assets](sounds/README.md).

## Commits and releases

Use [Conventional Commits](https://www.conventionalcommits.org/) without co-author trailers or AI-credit lines. On main, `feat`, `fix`, `perf`, `refactor` and `revert` trigger semantic-release; `docs`, `build`, `ci`, `test`, `style` and `chore` do not.
