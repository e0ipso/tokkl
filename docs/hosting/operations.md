# Operating a Tokkl server

[Documentation](../README.md) · [Hosting](README.md)

- [Health checks and shutdown](#health-checks-and-shutdown)
- [Backups and restore](#backups-and-restore)
- [Upgrading](#upgrading)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Running several instances](#running-several-instances)
- [Troubleshooting a native installation](#troubleshooting-a-native-installation)

## Health checks and shutdown

`GET /healthz` probes storage. On SIGTERM/SIGINT, the server stops accepting requests, closes streams and report workers, drains storage work and closes pools. HTTP connections have a ten-second drain deadline. In-flight reports can be cancelled; clients should reconnect after a restart.

## Backups and restore

Account JSON exports cover only the signed-in account's accessible workspace
data. They omit credentials and instance settings. See
[account export and restore](../data.md#export-or-restore-a-tokkl-account) for the
format's scope.

For a full instance backup, stop the application and use your database's consistent backup procedure. With SQLite, retain the database and any `-wal`/`-shm` files as one consistent set; copying only a live main file can omit committed data. With server engines, preserve the database using the engine's backup/restore tooling and retain deployment configuration and secrets separately. Restore a full backup into the same backend and a compatible schema before starting the application. Test recovery on a disposable deployment.

## Upgrading

For the native systemd installation at `/opt/tokkl`, use the
[VPS updater](vps-updates.md). It accepts a specific version or defaults to the
latest published stable release. Other deployments replace the application code
or container image using the same startup rules below.

Upgrades need a short outage, so stop every instance before starting the new release. Once a release adds a migration, an old instance that restarts refuses the newer migration ledger, and old instances still running query a schema they were not written for.

Start one instance of the new release first. It applies new migrations before it opens the HTTP port, so `tokkl listening` in its log means the schema is current. Then start the rest; they find nothing to apply and only validate the schema. An instance that starts while another is still migrating waits for it, and on MySQL and MariaDB it fails startup after 30 seconds of waiting.

An older release refuses a database that a newer release has migrated. To keep the option of rolling back, take a full backup as described in [Backups and restore](#backups-and-restore) before upgrading.

## Behind a reverse proxy

Configure [trusted forwarding headers](configuration.md#reverse-proxies-and-logs)
so Tokkl can identify client addresses and HTTPS connections. The
[native VPS guide](native-vps.md#3-configure-dns-and-https) provides a complete
nginx site configuration.

The apps follow the timer through a Server-Sent Events stream at `GET /api/app/timer/events`. The server sends a `keep-alive` event every 25 seconds and sets `X-Accel-Buffering: no`. A proxy must not buffer that response, and its read timeout must be well above 25 seconds. Otherwise the stream drops, or goes a minute without a keep-alive, and the clients fall back to polling every 30 seconds. nginx honours the header, and this location block sets both explicitly:

```nginx
location /api/app/timer/events {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Each user may hold 10 streams on each instance. Opening an 11th on the same instance closes the oldest there, so a user whose streams spread across several instances may hold more in total. An instance holds at most 1000 streams in all. Past that it answers a new one with a 503 and `Retry-After`, and clients poll until they reconnect.

## Running several instances

Select a [supported server database](databases.md) first. SQLite supports one
application process only.

Set `TOKKL_SETUP_CODE` to the same value on every instance before the first start. Without it, each instance makes up its own setup code and accepts only that one, so the load balancer can send the setup request to an instance that rejects the code from the log you read. Wrong codes count against the setup-code limit on every instance.

The public URL and SMTP variables must match on every instance.

Each instance needs:

- the same PostgreSQL, MySQL or MariaDB database, and the same `TOKKL_*` settings as the others;
- a load balancer idle timeout well above 25 seconds and no response buffering on `/api/app/timer/events`, as in [Behind a reverse proxy](#behind-a-reverse-proxy);
- load balancer health checks on `GET /healthz`;
- connection draining, so the load balancer stops sending it requests before it stops. After SIGTERM, open HTTP connections get ten seconds to finish;
- a clock kept in sync with NTP. Timer start and stop times come from the clock of the instance that handles the request.

Upgrade by stopping every instance, as described in [Upgrading](#upgrading). Rolling deploys are not supported.

Each instance opens up to `pool_max` writer connections and one report-reader connection. On PostgreSQL it keeps one more connection for `LISTEN`, which tells the other instances about timer changes. N instances need up to N × (`pool_max` + 1) connections on MySQL or MariaDB, and N × (`pool_max` + 2) on PostgreSQL.

Don't put PgBouncer in transaction pooling mode between Tokkl and PostgreSQL. Each instance takes a session-level `pg_advisory_lock` while it migrates at startup, and the `LISTEN` connection needs its own session. Connect directly or use session pooling.

## Troubleshooting a native installation

Check the selected release, service log and local health endpoint before
investigating nginx or DNS:

```bash
readlink -f /opt/tokkl/current
sudo systemctl status tokkl.service --no-pager
sudo journalctl -u tokkl.service -n 50 --no-pager
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
```

If local health succeeds but the public URL fails, check `sudo nginx -t`, the
site's proxy target and your DNS records. For failures during an update, follow
[updater troubleshooting](vps-updates.md#when-an-update-fails).
