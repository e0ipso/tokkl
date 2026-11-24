# kenkeep Index: web-ui-styling-and-layout / shell-and-layout / app-shell

↑ Parent: [shell-and-layout](../index.md)

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

> This index only orients you; leaves hold the durable guidance. Open at least one relevant leaf before acting.

## Subfolders
_None._

## Conventions (how we build)
_None yet._

## Components (what exists)
- Open [**NAV list, phone More sheet and nav running dots**](map-nav-list-phone-more-sheet-and-nav-running-dots.md) to learn about: NAV in app/nav.ts is the only page list; inMore items move into the phone More dialog; adminOnly hides Admin; running dots. #web #navigation #mobile
- Open [**Brand component and the PNG wordmark image**](map-brand-component-and-the-png-wordmark-image.md) to learn about: Brand.tsx renders only the PNG Tokkl wordmark in sm, md and lg sizes; the app icon is only the browser and OS icon. #web #brand #wordmark
- Open [**Lazy page chunks and failed-load recovery**](map-lazy-page-chunks-and-failed-load-recovery.md) to learn about: Shell.tsx imports only TimerPage; other pages load from lazyPages.tsx with prefetch, one retry and a guarded reload on failure. #web #navigation
- Open [**Phone e2e navigation helpers tapNav and openMore**](map-phone-e2e-navigation-helpers-tapnav-and-openmore.md) to learn about: Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the inMore items and omits Admin. #web #navigation #mobile
- Open [**Wordmark dark-mode halo and its e2e checks**](map-wordmark-dark-mode-halo-and-its-e2e-checks.md) to learn about: The --wordmark-halo drop-shadows trace the navy wordmark outline in dark; e2e/typography.spec.ts checks the wordmark and halo. #web #brand #wordmark

## By topic

### #web
- Open [**Route timer writes through timerWrite and reconcile after an unknown outcome**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-route-timer-writes-through-timerwrite-and-reconcile-after-an-unknown-outcome.md) — After an unknown write outcome, the next timer write reads GET /api/app/timer first; a guarded write fails as a conflict if it moved.
- Open [**Post running-entry edits to the timer edit endpoint with the entry id**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-post-running-entry-edits-to-the-timer-edit-endpoint-with-the-entry-id.md) — Running-entry edits post to /api/app/timer/edit with entry_id and no revision; a 409 is adopted and fails the edit as a conflict.
- Open [**Mark every write that can move the timer revision with MOVES_TIMER**](../../../web-ui-behaviour/time-and-timers/web-timer-actions/practice-mark-every-write-that-can-move-the-timer-revision-with-moves-timer.md) — currentRevision waits for writes marked MOVES_TIMER before a timer action; mark any write that changes the running entry, session or pause.
### #navigation
- Open [**NAV list, phone More sheet and nav running dots**](map-nav-list-phone-more-sheet-and-nav-running-dots.md) — NAV in app/nav.ts is the only page list; inMore items move into the phone More dialog; adminOnly hides Admin; running dots.
- Open [**Phone e2e navigation helpers tapNav and openMore**](map-phone-e2e-navigation-helpers-tapnav-and-openmore.md) — Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the inMore items and omits Admin.
- Open [**Lazy page chunks and failed-load recovery**](map-lazy-page-chunks-and-failed-load-recovery.md) — Shell.tsx imports only TimerPage; other pages load from lazyPages.tsx with prefetch, one retry and a guarded reload on failure.
### #brand
- Open [**Brand component and the PNG wordmark image**](map-brand-component-and-the-png-wordmark-image.md) — Brand.tsx renders only the PNG Tokkl wordmark in sm, md and lg sizes; the app icon is only the browser and OS icon.
- Open [**Wordmark dark-mode halo and its e2e checks**](map-wordmark-dark-mode-halo-and-its-e2e-checks.md) — The --wordmark-halo drop-shadows trace the navy wordmark outline in dark; e2e/typography.spec.ts checks the wordmark and halo.
- Open [**docs/brand packs stay as the owner supplied them; never run their rebuilds**](../../../tooling-and-project/repo-and-scripts/practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md) — icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
### #mobile
- Open [**NAV list, phone More sheet and nav running dots**](map-nav-list-phone-more-sheet-and-nav-running-dots.md) — NAV in app/nav.ts is the only page list; inMore items move into the phone More dialog; adminOnly hides Admin; running dots.
- Open [**Phone e2e navigation helpers tapNav and openMore**](map-phone-e2e-navigation-helpers-tapnav-and-openmore.md) — Phone e2e specs navigate with tapNav and openMore; MORE_PAGES repeats the inMore items and omits Admin.
- Open [**Phone layout CSS: position scroll wrappers, min-width: 0, nowrap table identity cells**](../practice-phone-layout-css-gotchas.md) — Absolute children escape unpositioned scroll wrappers, grid or flex items without min-width: 0 stretch past a phone screen, and wide auto tables wrap every cell.
### #wordmark
- Open [**Brand component and the PNG wordmark image**](map-brand-component-and-the-png-wordmark-image.md) — Brand.tsx renders only the PNG Tokkl wordmark in sm, md and lg sizes; the app icon is only the browser and OS icon.
- Open [**Wordmark dark-mode halo and its e2e checks**](map-wordmark-dark-mode-halo-and-its-e2e-checks.md) — The --wordmark-halo drop-shadows trace the navy wordmark outline in dark; e2e/typography.spec.ts checks the wordmark and halo.
- Open [**Wordmark crop and its four outputs**](../../../tooling-and-project/repo-and-scripts/app-icons-script/map-wordmark-crop-and-its-four-outputs.md) — WORDMARK_CROP trims the master to 2059x769; four palette PNGs for srcset and README; WORDMARK_RATIO tracks the crop.