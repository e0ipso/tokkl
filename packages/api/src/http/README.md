# http

Express plumbing with no knowledge of Tokkl's records: request readers, query parameters, error
replies, request logging, security headers, the mounted router and the web root. Imports only `lib`
and Express. `auth` and `routes` build on it; nothing here imports them.

`request.ts` refuses a body with any `Content-Encoding` other than `identity` (415) before the body parser
reads a byte, so no decompression stream exists. `textBody` applies that check to every body reader,
the 1 MB reader in `app.ts` and the import reader alike, and turns off the parser's own inflation.
