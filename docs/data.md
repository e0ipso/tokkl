# Importing and exporting data

[Documentation](README.md) · [Using Tokkl](using-tokkl.md)

## Import from Toggl Track

1. Set Toggl's duration format to "Improved", then export Reports → Detailed as CSV.
2. Set Tokkl's timezone in Settings to match your Toggl profile.
3. Use Settings → Data → Import from Toggl Track to preview and import.

Imports create clients, projects, tasks and tags as needed and skip matching entries, so overlapping files are safe. Set project colors and rates afterwards; Toggl's CSV omits them.

## Export or restore a Tokkl account

Use Settings → Data to export the signed-in account's accessible workspace data
or restore a Tokkl JSON export. Restore maps records into the importing account's
default workspace, skips duplicates and reports records it cannot import. It
preserves imported entry times.

Account exports do not restore credentials, API tokens, sessions, invites,
instance settings or all accounts. They are not a lossless instance migration
between database engines.

To move to a fresh instance, export from the old account, create an account on
the new instance and import that file. Create fresh API tokens there.
Full instance recovery belongs to the server operator;
see [database backups and restore](hosting/operations.md#backups-and-restore).

## Download limits

Account exports and detailed CSV reports use a separate download queue, so a
slow download does not hold up interactive reports. This covers the web app's
detailed CSV and the Reports API v3 `search/time_entries.csv` endpoint.

| Limit | Value |
| --- | --- |
| Concurrent downloads per instance | 8 |
| Concurrent downloads per account | 2 |
| Maximum download duration | 15 minutes |
| Client inactivity timeout | 30 seconds without reading |
| Data buffered ahead of the client | About 1 MB |

A full queue returns 503 `Report queue is full` with `Retry-After: 2`. A download
that exceeds its duration before sending anything returns 503
`Download took too long` with `Retry-After: 60`.

Downloads stream in batches. A failure or timeout after streaming starts cuts
the connection, so a partial file is not presented as complete.

## Import limits

These limits apply to JSON restore and Toggl CSV import. Every API route accepts
only unencoded request bodies: a body with any `Content-Encoding` other than
`identity` gets 415 before the server reads it.

| Limit | Value |
| --- | --- |
| Maximum file size | 8 MiB |
| Combined size of running imports, per instance | 8 MiB |
| Concurrent imports per instance | 4 |
| Concurrent imports per account | 1 |
| Records per file | 10,000 |
| JSON values or CSV cells per file | 250,000 |
| JSON nesting depth | 32 |
| Import starts per account | 5 per 15 minutes |
| Upload time, from admission | 60 seconds |
| Processing time, from the last byte | 5 seconds |

A record is a JSON record in `clients`, `projects`, `tasks`, `tags` or
`time_entries`, or a CSV data row. A CSV file counts the rows of users you did
not select. The cell count includes the header, and a Tags cell counts once per
tag name.

A body without a length counts as 8 MiB against the combined size.

| Status | Cause |
| --- | --- |
| 413 | The declared or received body is over 8 MiB. |
| 400 | The file passes the record, value or depth limit. |
| 408 | The upload is not complete 60 seconds after admission. |
| 429 | The account used its five starts. `Retry-After` gives the seconds left. |
| 503 | Too many imports run (`Retry-After: 5`), or processing passed five seconds (`Retry-After: 60`). |

Previews count as starts. The CSV page sends one preview when you choose a file.
For a file with several Toggl users, it sends one more each time you click Check
selection, not when you tick a user. A typical import uses three starts. A
failed or refused import also counts, and a success does not reset the count.
The count is stored in the database, so every instance that shares it applies
one limit. When you reach it, wait for the time in `Retry-After`.

Each import runs in one transaction. If the client disconnects, or processing
passes five seconds, the import stops at the next record and rolls back, keeping
none of the imported records. The deadline is cooperative: a query or a rollback
that is already running finishes, so a reply can arrive later than five seconds,
but work that ends after the deadline never commits. An import keeps its place
until the rollback ends.

### Split a large export

Split the file offline, then import the parts one at a time. Wait for
`Retry-After` when you reach the start limit.

- A Toggl CSV: keep the header row in every part and split the data rows. Each
  part can hold at most 10,000 rows and 8 MiB.
- A Tokkl JSON export: keep `format` and the other top-level fields, and split
  `time_entries` across parts. Repeat in every part the `clients`, `projects`,
  `tasks` and `tags` that its entries reference. An entry whose project is not in
  the same file is skipped. Restoring matches catalogs by name, so repeated
  catalogs create nothing twice.

For limits that your server applies in front of Tokkl, see the
[nginx import location](hosting/native-vps.md#enable-https)
and [Check the limits before you open public access](hosting/native-vps.md#check-the-limits-before-you-open-public-access).
