# auth

HTTP authentication adapters: the auth middleware, the session routes (login, logout, setup,
invites and resets) and the password failure limiter. They read requests through `http/request.ts`
and call the domain's account operations.
