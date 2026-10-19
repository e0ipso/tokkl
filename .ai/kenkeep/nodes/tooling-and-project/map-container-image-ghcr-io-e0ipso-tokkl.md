---
type: map
title: Container image ghcr.io/e0ipso/tokkl
description: >-
  Multi-arch image built from the root Dockerfile and pushed by the CI release
  job when semantic-release tags; writes only to /data.
tags:
  - docker
  - release
  - ci
  - deployment
kk_schema_version: 3
kk_id: map-container-image-ghcr-io-e0ipso-tokkl
kk_derived_from:
  - '5470b272-9bff-4eb0-8fe5-ffc3d686cda3:map:0'
kk_relates_to:
  - map-npm-workspaces-package-layout
  - practice-do-not-mark-commits-as-breaking-changes
kk_depends_on: []
kk_confidence: medium
---
The root `Dockerfile` builds the server image. The `build` and `app` stages run on `$BUILDPLATFORM` and the runtime stage has no `RUN`, so the amd64 and arm64 images build without emulation. The runtime stage sets `TOKKL_DATA_DIR=/data`, declares `VOLUME /data`, exposes 8080 and runs `node packages/api/src/index.ts` directly. Root owns `/app`; only `/data` is writable.

The image runs as the non-root `node` user (UID 1000) by default. Another UID works when the mounted `/data` directory is writable by that UID; otherwise SQLite cannot open the database. A tmpfs at `/data` needs `mode=1777`. The health check calls `/healthz` with Node's `fetch` because the slim base image has no curl.

The `release` job in `.github/workflows/ci.yml` runs semantic-release, reads the new tag with `git tag --points-at HEAD 'v*'`, and only when a tag exists runs `docker buildx build --push` for `linux/amd64,linux/arm64` with tags `x.y.z`, `x.y`, `x` and `latest`. Commits that cut no release (`ci:`, `build:`, `docs:`) publish no image.

<!-- kk:related:start -->
# Related

- Related: [map-npm-workspaces-package-layout](repo-and-scripts/map-npm-workspaces-package-layout.md)
- Related: [practice-do-not-mark-commits-as-breaking-changes](repo-and-scripts/practice-do-not-mark-commits-as-breaking-changes.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 5470b272-9bff-4eb0-8fe5-ffc3d686cda3:map:0
<!-- kk:citations:end -->
