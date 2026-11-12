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

These limits apply to JSON restore and Toggl CSV import:

| Limit | Value |
| --- | --- |
| Concurrent imports per instance | 4 |
| Concurrent imports per account | 1 |
| Maximum file size | 50 MB |
| Combined file size of running imports | 64 MiB |

The combined size uses each request's `Content-Length`. An upload without that
header counts as 50 MB. Two large files cannot run together; a single file within
the limit is accepted when no other import runs.

An import exceeding those concurrency or combined-size limits is refused before
upload with 503 `Too many imports are running` and `Retry-After: 5`. Each import
runs in one transaction. If the client disconnects, it stops at the next record
and rolls back, keeping none of the imported records.
