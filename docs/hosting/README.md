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

The container runs as UID 1000 and writes only to `/data`, its default `TOKKL_DATA_DIR`. Pass configuration with `-e`. Disposable storage needs `--tmpfs /data:mode=1777`; plain tmpfs is unwritable. Its data disappears when the container stops.

### Run with restrictions

Use this command on a public server. It bounds what a compromised process can do, and it matches the [native VPS limits](native-vps.md#2-install-and-configure-the-service):

```sh
docker run -d --name tokkl \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --memory 512m \
  --cpus 0.5 \
  --pids-limit 64 \
  -v tokkl-data:/data \
  -p 127.0.0.1:8080:8080 \
  -e TOKKL_TRUST_PROXY=172.17.0.1 \
  ghcr.io/e0ipso/tokkl:latest
```

| Option | Effect |
| --- | --- |
| `--cap-drop=ALL` | The process has no Linux capabilities. Tokkl needs none. |
| `--security-opt no-new-privileges` | The process cannot gain privileges. |
| `--read-only` | The root file system is read-only. The image files stay as built. |
| `--tmpfs /tmp:rw,noexec,nosuid,size=64m` | A private, bounded `/tmp` in memory. Nothing there can run as a program. |
| `-v tokkl-data:/data` | The only persistent writable path. It holds the SQLite database and its `-wal` and `-shm` files. |
| `--memory 512m`, `--cpus 0.5`, `--pids-limit 64` | At most 512 MiB of memory, half of one CPU core, and 64 processes and threads. |
| `-p 127.0.0.1:8080:8080` | Only the host can reach Tokkl. A reverse proxy on the host serves the public. |

Change the limits to fit your host. They apply to the whole container, including
the report and download worker threads. If reports of large accounts fail or the
container restarts, raise `--memory` and `--pids-limit` together.

Tokkl copies the SQLite database into `/tmp` when it starts, to check it before
it migrates. Keep the `size` of `/tmp` above the size of your database and its
`-wal` file. Raise it with the database. Files in this `/tmp` are held in memory
and count toward `--memory`, so raise `--memory` by the same amount.

The proxy reaches the container from the bridge gateway address, not from
`127.0.0.1`. Set `TOKKL_TRUST_PROXY` to that address so Tokkl reads the forwarded
headers from your proxy only. This command shows it, and `172.17.0.1` is the default:

```sh
docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'
```

If you use a user-defined network, use its gateway instead. See
[reverse proxy requirements](operations.md#behind-a-reverse-proxy).

### User and mounts

The image runs as UID 1000. Choose another UID with `--user`, for example
`--user 568:568`. Then mount a directory that this UID owns, because the
volume that Docker creates is owned by UID 1000:

```sh
sudo install -d -o 568 -g 568 -m 700 /srv/tokkl/data
docker run -d --name tokkl --user 568:568 \
  --cap-drop=ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --memory 512m --cpus 0.5 --pids-limit 64 \
  -v /srv/tokkl/data:/data -p 127.0.0.1:8080:8080 \
  ghcr.io/e0ipso/tokkl:latest
```

Mount only the data directory. Do not mount the Docker socket, host
configuration, release directories or the data of other applications into the
container. Any of them gives a compromised process control of the host or of
other services.

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
