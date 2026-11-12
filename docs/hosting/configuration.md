# Server configuration

[Documentation](../README.md) · [Hosting](README.md)

Set environment variables before starting Tokkl. With Docker, pass them with
`-e`; with the native systemd installation, edit `/etc/tokkl/tokkl.env` and restart
`tokkl.service`. Keep credentials out of committed files and command logs.

## Network and storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8080` | HTTP port |
| `TOKKL_DATA_DIR` | `./data` | Default SQLite folder |
| `TOKKL_DATABASE_URL` | absent | Database selector; absence selects `<data dir>/tokkl.sqlite`. An empty or invalid value fails startup. |
| `TOKKL_WEB_ROOT` | `dist/web` | Built web app folder |

The [database guide](databases.md) covers connection URLs, supported engines and
storage constraints.

## Reverse proxies and logs

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOKKL_TRUST_PROXY` | absent | Proxies whose forwarded headers are trusted; see the accepted values below. |
| `TOKKL_LOG_LEVEL` | `info` | Least severe log line written: `debug`, `info`, `warn`, `error` or `silent`, in any letter case. Any other value fails startup. |

`TOKKL_TRUST_PROXY` accepts an empty value or `0` to trust no proxy, a positive
number to trust that many proxy hops, or a comma-separated list of trusted IP
addresses or CIDR ranges. Any other value fails startup. Trust only proxies the
app is reachable through.

The client address for login rate limiting is the `X-Forwarded-For` entry the
outermost trusted proxy added. `X-Forwarded-Proto: https` enables Secure cookies
and HSTS.

Logs are JSON lines. `warn` and `error` go to stderr; the rest go to stdout.

See [reverse proxy requirements](operations.md#behind-a-reverse-proxy) for timer
streams, buffering and timeouts. The native nginx setup uses
`TOKKL_TRUST_PROXY=127.0.0.1` and binds Tokkl to loopback.

## Accounts and sessions

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOKKL_SESSION_DAYS` | `30` | New-session lifetime until overridden on the Admin page; existing expiries stay unchanged. |
| `TOKKL_SETUP_CODE` | random | Fixed first-admin setup code for scripted installs. Several instances need the same value on each; see [Running several instances](operations.md#running-several-instances). |

Create the [first administrator](../using-tokkl.md#create-the-first-administrator)
with the setup code. The Admin page manages accounts and can override the
new-session lifetime.

## Email

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOKKL_PUBLIC_URL` | absent | Public HTTP(S) origin for emailed links; no credentials, path, query or fragment. |
| `TOKKL_SMTP_HOST` | absent | SMTP server host. |
| `TOKKL_SMTP_PORT` | `587` | SMTP server port. |
| `TOKKL_SMTP_TLS` | `starttls` | Transport security: `starttls`, `tls` or `none`. |
| `TOKKL_SMTP_FROM` | absent | Sender address for sign-up email. |
| `TOKKL_SMTP_USER` | absent | SMTP username. |
| `TOKKL_SMTP_PASSWORD` | absent | SMTP password. |

### Enable public sign-up

Sign-up is off by default. To allow anyone to register:

1. Set `TOKKL_PUBLIC_URL` to the HTTPS origin users will visit.
2. Set the SMTP host and sender, plus the port, transport and credentials your
   provider requires. Use a sender verified with that provider.
3. Restart the application, then enable sign-up on the Admin page.
4. Register a separate account and follow its verification email to test delivery.

Sign-up is available only when mail is configured and the setting is enabled.
SMTP connection, greeting and socket timeouts are ten seconds. Invite and
password-reset links are still shared manually by an administrator.
