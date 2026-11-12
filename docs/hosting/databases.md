# Database selection

[Documentation](../README.md) · [Hosting](README.md)

Use SQLite for one process with local storage. Use a server database when you
need several application instances.

| Engine | Accepted version line | Tested version |
| --- | --- | --- |
| SQLite | Built into the Node runtime | 3.53.4 |
| PostgreSQL | 18 | 18.6 |
| MySQL | 8.4 | 8.4.13 |
| MariaDB | 11.8 | 11.8.9 |

MySQL and MariaDB have separate selectors. The production image uses Node
24.22.0 and its built-in SQLite driver.

## Choose a database

Set one selector before `npm start`, or supply it through the container
environment. Choose one of these lines. The examples use placeholder credentials
and a private database hostname:

```sh
export TOKKL_DATABASE_URL='sqlite:///absolute/path/tokkl.sqlite'
export TOKKL_DATABASE_URL='postgres://tokkl:REPLACE_ME@db.example.test:5432/tokkl?sslmode=verify-full'
export TOKKL_DATABASE_URL='mysql://tokkl:REPLACE_ME@db.example.test:3306/tokkl?sslmode=verify-full'
export TOKKL_DATABASE_URL='mariadb://tokkl:REPLACE_ME@db.example.test:3306/tokkl?sslmode=verify-full'
```

`postgresql://` also selects PostgreSQL. SQLite paths must be absolute, without
query parameters or dot segments. `sqlite::memory:` is temporary and loses all
data at process exit.

SQLite, including `sqlite::memory:`, supports one process only. Hosts can't share a SQLite file, because file locking isn't reliable over network filesystems, and each `sqlite::memory:` process has its own empty database. Several instances need PostgreSQL, MySQL or MariaDB; see [Running several instances](operations.md#running-several-instances).

## Connection credentials and TLS

Percent-encode username, password and database components separately. For example, a password `p@ss:word` becomes `p%40ss%3Aword`. Shell-quote the entire URL and keep credentials out of committed files and command logs. Supply container secrets through your deployment's protected environment configuration. The application redacts database credentials from startup errors; the first-admin setup code remains a secret printed intentionally at first startup.

Server connections verify the certificate chain and the configured hostname or IP address by default. For a private CA, append `&sslrootcert=%2Frun%2Fsecrets%2Fdatabase-ca.pem` and mount that readable PEM file in the application container. The certificate must cover the URL host, including an IP subject alternative name when using an IP. Only `sslmode=verify-full` and `sslmode=disable` are accepted. Use `disable` only for an intentionally unencrypted local/private test connection. There is no certificate-verification bypass mode.

## Connection options

Optional server URL parameters are:

| Parameter | Default | Accepted range or values |
|---|---|---|
| `pool_max` | `5` | `1`–`20` writer connections; the report reader has a separate one-connection pool |
| `connect_timeout_ms` | `5000` | `100`–`60000`; connection establishment and pool acquisition deadline |
| `query_timeout_ms` | `30000` | `100`–`300000`; query deadline |
| `sslmode` | `verify-full` | `verify-full` or `disable` |
| `sslrootcert` | system trust | Absolute readable CA PEM path, percent-encoded in the URL; requires `verify-full` |

Unknown or repeated URL options are errors. MySQL/MariaDB queue at most 20 times the pool size while waiting for a checkout; late checkouts after a deadline are released. SQLite uses a five-second busy timeout and serializes writes. Recognized deadlock/serialization failures retry only after acknowledged rollback, up to three attempts by default. An uncertain commit is never replayed automatically.

## Provisioning and startup checks

Provision an empty dedicated database and grant the application user schema/migration and data access. PostgreSQL needs permission to create its tables and indexes in the selected schema. MySQL/MariaDB also need trigger creation. With MySQL binary logging enabled, the operator must configure the permissions or `log_bin_trust_function_creators` needed for trigger creation; Tokkl does not change server globals. The disposable test service enables this setting explicitly.

Startup checks the selected engine version, acquires migration ownership,
initializes an empty database or validates the recognized migration ledger and
schema, then starts HTTP. It refuses an unrelated, legacy, dirty or inconsistent
schema. There is no automatic conversion of legacy SQLite files, no fallback to
another engine and no replacement database after a connection failure.

`TOKKL_DATABASE` and `TIMETRACK_DATABASE` do not select storage. Without an
explicit URL, either variable or a `timetrack.sqlite` in the data directory causes
startup refusal. Pointing a URL at an unsupported legacy file still refuses it.
Export data with an application that can read that schema and keep an independent
backup before selecting a fresh database.

See [health checks and shutdown](operations.md#health-checks-and-shutdown) for runtime behavior.
