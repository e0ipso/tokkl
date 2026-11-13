# Install Tokkl on a VPS

[Documentation](../README.md) · [Hosting](README.md) · [Update an existing installation](vps-updates.md)

This guide installs one Tokkl process with SQLite on an Ubuntu or Debian VPS.
Node runs the API and serves the built web app. nginx terminates HTTPS and
proxies requests to `127.0.0.1:8080`.

Follow these steps in order, using the same terminal session for the build and
installation:

1. [Build a release](#1-build-a-release).
2. [Install and configure the service](#2-install-and-configure-the-service).
3. [Configure DNS and HTTPS](#3-configure-dns-and-https).
4. [Create the administrator](#4-create-the-administrator).
5. [Check the installation and clean up](#5-check-the-installation-and-clean-up).

## Before you start

Use a regular account with sudo access. Install Node 24 or newer and npm before
starting. The remaining tools are available from the distribution:

```bash
sudo apt update
sudo apt install nginx certbot curl ca-certificates tar gzip util-linux
node --version
npm --version
```

The commands use these paths, which the [updater](vps-updates.md) also expects:

| Path | Contents |
| --- | --- |
| `/opt/tokkl/releases/` | Root-owned application releases |
| `/opt/tokkl/current` | Symlink to the selected release |
| `/etc/tokkl/tokkl.env` | Root-readable configuration and SMTP credentials |
| `/var/lib/tokkl/` | SQLite database and its WAL/SHM files, owned by `tokkl` |
| `/etc/systemd/system/tokkl.service` | The single application service |
| `/var/www/letsencrypt/` | Public ACME challenge files |

Keep the database on local storage. SQLite supports one application process;
see [database selection](databases.md) for other deployments.

## 1. Build a release

Download a source archive from [Tokkl's releases](https://github.com/e0ipso/tokkl/releases)
or check out a release tag. Run these commands from that repository root as your
regular user. The build needs development dependencies, while the assembled
runtime contains API production dependencies and the built web app.

```bash
tokkl_runtime=$(mktemp -d "$HOME/tokkl-runtime.XXXXXX")
tokkl_version=$(node -p 'require("./package.json").version')

(
  set -euo pipefail
  export NODE_OPTIONS=--max-old-space-size=384
  npm ci --ignore-scripts --engine-strict --no-fund
  npm run build
  test -s dist/web/index.html

  cp package.json package-lock.json LICENSE "$tokkl_runtime/"
  for package in api common types; do
    mkdir -p "$tokkl_runtime/packages/$package"
    cp "packages/$package/package.json" "$tokkl_runtime/packages/$package/"
  done
  cp -a packages/api/src "$tokkl_runtime/packages/api/"
  cp -a packages/common/. "$tokkl_runtime/packages/common/"
  cp -a packages/types/. "$tokkl_runtime/packages/types/"
  mkdir "$tokkl_runtime/dist"
  cp -a dist/web "$tokkl_runtime/dist/"

  cd "$tokkl_runtime"
  npm ci --omit=dev --ignore-scripts --engine-strict --workspace @tokkl/api --no-fund
  npm update body-parser qs --omit=dev --ignore-scripts --engine-strict --workspace @tokkl/api --no-fund
  npm audit --omit=dev --workspace @tokkl/api --audit-level=moderate
  find packages -type f \( -name '*.test.ts' -o -name tsconfig.json \) -delete
  node --input-type=module -e 'await import("@tokkl/common/time")'
)
```

Continue only if the block succeeds. The dependency updates stay within the
packages' declared ranges; the runtime lockfile records their resolved versions.
Keep the `node_modules/@tokkl` workspace symlinks intact. Node loads shared
TypeScript through these links, including inside report workers.

## 2. Install and configure the service

These commands create a fresh installation. Keep the same shell and repository
directory so `tokkl_runtime` and `tokkl_version` still refer to the build above.
Authenticate before pasting the installation block:

```bash
sudo -v
```

```bash
tokkl_release="/opt/tokkl/releases/$tokkl_version-$(date -u +%Y%m%dT%H%M%SZ)"
(
  set -euo pipefail
  sudo -n test ! -e /opt/tokkl/current
  sudo -n useradd --system --user-group --home-dir /var/lib/tokkl --shell /usr/sbin/nologin tokkl
  sudo -n install -d -m 755 /opt/tokkl/releases "$tokkl_release"
  sudo -n install -d -m 750 /etc/tokkl
  sudo -n install -d -o tokkl -g tokkl -m 750 /var/lib/tokkl
  sudo -n cp -a "$tokkl_runtime/." "$tokkl_release/"
  sudo -n chown -R root:root "$tokkl_release"
  sudo -n chmod -R u=rwX,go=rX "$tokkl_release"
  sudo -n ln -s "$tokkl_release" /opt/tokkl/current
  sudo -n install -m 600 /dev/null /etc/tokkl/tokkl.env
  sudo -n install -m 755 scripts/update-vps.sh /usr/local/sbin/tokkl-update
)
```

Edit the environment file with `sudoedit /etc/tokkl/tokkl.env` and save:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=8080
TOKKL_DATA_DIR=/var/lib/tokkl
TOKKL_WEB_ROOT=/opt/tokkl/current/dist/web
TOKKL_TRUST_PROXY=127.0.0.1
TOKKL_PUBLIC_URL=https://tokkl.example.com
```

Replace `tokkl.example.com` with your domain everywhere in this guide. Omitting
`TOKKL_DATABASE_URL` selects `/var/lib/tokkl/tokkl.sqlite`. systemd reads the
protected environment file before it switches to the `tokkl` service account.

The unit expects Node at `/usr/bin/node`. If your system-wide installation uses
another path, change `ExecStart` accordingly. Node and npm must also be available
in sudo's PATH for the updater; a login-shell version manager alone is insufficient.

Create the unit:

```bash
sudo -n tee /etc/systemd/system/tokkl.service >/dev/null <<'UNIT'
[Unit]
Description=Tokkl time tracker
After=network.target

[Service]
Type=simple
User=tokkl
Group=tokkl
WorkingDirectory=/opt/tokkl/current
EnvironmentFile=/etc/tokkl/tokkl.env
ExecStart=/usr/bin/node packages/api/src/index.ts
Restart=on-failure
RestartSec=5s
TimeoutStopSec=30s
UMask=0077
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT

sudo -n systemctl daemon-reload
sudo -n systemctl enable --now tokkl.service
```

Once startup finishes, this must return `{"ok":true}`:

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
```

If it fails, inspect `sudo journalctl -u tokkl.service -n 50 --no-pager` before
continuing.

## 3. Configure DNS and HTTPS

### Point your domain at the VPS

Create an A record for your hostname pointing at the VPS public IPv4 address.
Publish an AAAA record only if the server also serves that address. These proxy
settings assume clients connect directly to nginx; use DNS-only mode if your DNS
provider offers an HTTP proxy. Allow inbound TCP ports 80 and 443.

### Serve the certificate challenge

Create `/etc/nginx/sites-available/tokkl` with this initial HTTP configuration:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tokkl.example.com;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }

    location / {
        return 404;
    }
}
```

Enable the site. On a shared VPS, keep the other sites in place.

```bash
sudo install -d -m 755 /var/www/letsencrypt
sudo ln -s /etc/nginx/sites-available/tokkl /etc/nginx/sites-enabled/tokkl
sudo nginx -t && sudo systemctl reload nginx
```

### Issue the certificate

Create a certificate deployment hook so renewal reloads nginx:

```bash
sudo -v
```

```bash
sudo -n tee /etc/tokkl/reload-nginx >/dev/null <<'HOOK'
#!/bin/sh
set -e
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
HOOK
sudo -n chmod 750 /etc/tokkl/reload-nginx
```

Once public DNS resolves to the VPS, request the certificate:

```bash
sudo certbot certonly --webroot --webroot-path /var/www/letsencrypt \
  --domain tokkl.example.com --cert-name tokkl.example.com \
  --deploy-hook /etc/tokkl/reload-nginx
```

### Enable HTTPS

After issuance succeeds, replace the site's HTTP `location /` block with
`location / { return 308 https://$host$request_uri; }`, then append this HTTPS
server block:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name tokkl.example.com;

    ssl_certificate /etc/letsencrypt/live/tokkl.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tokkl.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 1h;
    }
}
```

Keep the HTTP ACME challenge location so renewals can use it. Forwarded headers
come from nginx, and Tokkl trusts only this loopback proxy. Disabling response
buffering lets timer updates and report downloads stream to clients.

```bash
sudo nginx -t && sudo systemctl reload nginx
curl --fail --silent --show-error https://tokkl.example.com/healthz
sudo systemctl enable --now certbot.timer
sudo certbot renew --cert-name tokkl.example.com --dry-run --run-deploy-hooks
```

The timer command applies to the distribution's Certbot package. An existing snap
installation uses `snap.certbot.renew.timer`; keep that scheduled renewal instead.

## 4. Create the administrator

Read the first-admin setup code locally from the journal:

```bash
sudo journalctl -u tokkl.service -n 50 --no-pager
```

Open your HTTPS URL and use that code to create the administrator. The code is a
secret. Sign-up is off by default.

To let anyone register, follow [enable public sign-up](configuration.md#enable-public-sign-up).
To bring data from another instance, follow
[account export and restore](../data.md#export-or-restore-a-tokkl-account).

## 5. Check the installation and clean up

Use `sudo tokkl-update VERSION` to select a release or `sudo tokkl-update` for the
latest stable release. See the [update guide](vps-updates.md) for retention,
failure behavior and troubleshooting.

After checking login, a timer and a CSV report, remove the temporary runtime copy
from the build shell:

```bash
rm -rf -- "$tokkl_runtime"
```

Keep the repository checkout if you want to update the installed updater later.
The updater does not create database backups; configure those separately using
the [backup guidance](operations.md#backups-and-restore).
