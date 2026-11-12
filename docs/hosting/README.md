# Hosting Tokkl

[Documentation](../README.md)

## Choose an installation method

| Installation | Start here |
| --- | --- |
| Ubuntu or Debian VPS with systemd and nginx | [Native VPS installation](native-vps.md) |
| Container host | [Docker](#docker) |
| Run directly from a source checkout | [Node.js](#nodejs) |

A single process uses SQLite by default. Keep its data on local persistent
storage. Several processes require a shared PostgreSQL, MySQL or MariaDB database;
see [database selection](databases.md).

## Docker

The image supports amd64 and arm64, with version tags `X.Y.Z`, `X.Y`, `X` and `latest`. Mount `/data` for persistence:

```sh
docker run -d --name tokkl -p 8080:8080 -v tokkl-data:/data ghcr.io/e0ipso/tokkl:latest
docker logs tokkl    # first-admin setup code
```

The container runs as UID 1000 and writes only to `/data`, its default `TOKKL_DATA_DIR`. With `--user`, mount a directory owned by that UID. Pass configuration with `-e`. Disposable storage needs `--tmpfs /data:mode=1777`; plain tmpfs is unwritable. Its data disappears when the container stops.

Choose a version tag when you want to pin a release. See
[upgrading](operations.md#upgrading) before changing it.

## Node.js

Requires Node.js 24 or newer. Run from the repository root:

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:8080`. The default SQLite database is
`data/tokkl.sqlite`, alongside its `-wal` and `-shm` files. Keep that directory
when replacing the application checkout, or set `TOKKL_DATA_DIR` to a persistent
location outside it. The [configuration reference](configuration.md) lists all
environment settings.

## After installation

1. [Create the first administrator](../using-tokkl.md#create-the-first-administrator).
2. For a public server, configure HTTPS and trusted forwarding headers. The
   [native VPS guide](native-vps.md#3-configure-dns-and-https) gives an nginx setup;
   [reverse proxy requirements](operations.md#behind-a-reverse-proxy) apply to
   other setups too.
3. If anyone should be able to register,
   [configure email and enable public sign-up](configuration.md#enable-public-sign-up).
4. Follow the [operations guide](operations.md) for health checks, backups,
   upgrades and running several instances.
