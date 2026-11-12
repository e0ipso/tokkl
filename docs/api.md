# Connecting to the Toggl-compatible API

[Documentation](README.md) · [Using Tokkl](using-tokkl.md)

Tokkl implements a [subset of Track API v9 and Reports API v3](PRD.md#6-toggl-api-compatibility). Clients must accept a custom base URL and stay within supported endpoints and parameters. Many Toggl apps hardcode Toggl's hostname; see [client compatibility and limits](PRD.md#64-honest-limits).

Find your token under Settings → API token. HTTP Basic auth accepts `<token>:api_token` or `<email>:<password>`. Password changes and resets replace the token; update saved credentials. Fetch `default_workspace_id` before making workspace requests:

```sh
curl -u "$TOKEN:api_token" "$TOKKL_URL/api/v9/me"
```

Track and Reports base URLs are `$TOKKL_URL/api/v9` and `$TOKKL_URL/reports/api/v3`. Stopped-entry rounding applies to API writes too.

CSV report downloads share the [download limits](data.md#download-limits) with
account exports. For the full endpoint and behavior reference, see the
[API requirements](PRD.md#6-toggl-api-compatibility).
