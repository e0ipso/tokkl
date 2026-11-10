# auth

HTTP authentication adapters: the auth middleware, the session handlers (login, logout, setup,
invites and resets) and the password failure limiter. They read requests through `http/request.ts`
and call the domain's account operations. Imports `http`, `commands`, `domain` (its records and ports
included) and `lib`; `routes` and `app.ts` use it, and `http` never imports it.
