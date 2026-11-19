# auth

HTTP authentication adapters: the auth middleware, the session handlers (login, logout, setup,
invites and resets) and the password failure limiter. They read requests through `http/request.ts`
and call the domain's account operations. Imports `http`, `commands`, `domain` (its records and ports
included) and `lib`; `routes` and `app.ts` use it, and `http` never imports it.

The limiter also counts import starts per account (`IMPORT_START_LIMIT` in `rateLimit.ts`): five per 15
minutes, previews and failed or refused imports included, stored in the database so instances share it.
