# syntax=docker/dockerfile:1

# node:24.22.0-bookworm-slim, pinned by digest. Dependabot bumps both.
ARG NODE_IMAGE=node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# The web assets and the production node_modules are the same on every
# platform: Vite writes static files, and express and its dependencies are
# plain JavaScript. Both stages run on the build host, so a multi-platform
# build does not run npm or Vite under QEMU. Only the runtime stage is
# per-platform, and it only copies files.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/common/package.json packages/common/
COPY packages/types/package.json packages/types/
COPY packages/web/package.json packages/web/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY packages packages
RUN npm run build

# The tree the runtime stage copies as is: production dependencies of the API
# only, the raw TypeScript sources and the built web app.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS app
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY packages/common/package.json packages/common/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --workspace @tokkl/api
COPY packages/api/src packages/api/src
COPY packages/common packages/common
COPY packages/types packages/types
COPY --from=build /app/dist/web dist/web
RUN find packages -name '*.test.ts' -delete && rm packages/*/tsconfig.json && mkdir /data

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="Tokkl" \
      org.opencontainers.image.description="Self-hosted time tracker with a Toggl Track compatible API" \
      org.opencontainers.image.source="https://github.com/e0ipso/tokkl" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    TOKKL_DATA_DIR=/data
WORKDIR /app
# Root owns the app files, so they are read-only for whatever UID runs the
# container. Node strips types only outside node_modules, which holds here
# because node_modules/@tokkl/* are workspace symlinks into packages/.
COPY --from=app /app /app
# The MIT license asks that its notice travel with copies of the software.
COPY LICENSE /app/LICENSE
# Only /data is written. The image defaults to the non-root node user (1000);
# with another UID, such as TrueNAS's 568, mount a directory that UID owns.
# A tmpfs at /data needs mode=1777: a plain one is root-owned, so node cannot write.
# There is no RUN in this stage, so building it for another platform needs no
# emulation.
COPY --from=app --chown=node:node /data /data
VOLUME /data
USER node
EXPOSE 8080
# The slim image has no curl, so the check uses Node's fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 8080}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node runs as PID 1 and handles SIGTERM itself; npm start would sit in between.
CMD ["node", "packages/api/src/index.ts"]
