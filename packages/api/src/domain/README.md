# domain

Tokkl's rules: entries and their spans, timers and Pomodoro sessions, catalogs, accounts,
credentials and instance settings. Operations take typed commands (`*Commands.ts`), run on a
storage runner and throw `ApplicationError`s. Imports `storage` and `lib`, never HTTP, services or
presenters.
