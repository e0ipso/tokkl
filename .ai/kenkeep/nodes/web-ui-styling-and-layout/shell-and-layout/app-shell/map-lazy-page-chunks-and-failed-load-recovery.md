---
type: map
title: Lazy page chunks and failed-load recovery
description: >-
  Shell.tsx imports only TimerPage; other pages load from lazyPages.tsx with
  prefetch, one retry and a guarded reload on failure.
tags:
  - web
  - navigation
kk_schema_version: 3
kk_id: map-lazy-page-chunks-and-failed-load-recovery
kk_derived_from:
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0'
kk_relates_to:
  - map-nav-list-phone-more-sheet-and-nav-running-dots
kk_depends_on: []
kk_confidence: high
---
`app/Shell.tsx` imports only `TimerPage` directly. Every other page comes from `app/lazyPages.tsx`, which loads its module on first visit, so each gets its own chunk. `Routes` wraps the `Switch` in one `Suspense` whose fallback is `<div className="page"><Loading /></div>`, the same Loading state a page shows while its data loads. `NavLink` calls `prefetchPage(item.href)` on pointer enter and focus, so the chunk is usually loaded by the click. A failed load recovers through `loadPageModule` (`app/pageLoad.ts`): one retry, then, for a visit but never a prefetch, one full reload guarded by the sessionStorage flag `tokkl.pageReload`, which a later successful load clears. This covers a tab that still names the chunk files of the previous deploy. If the load still fails, the route's `ErrorBoundary` shows the error, and its Try again calls `retryFailedPages` so the import runs again. `app/pageLoad.test.ts` covers it against a fake `window`. A new page goes into `lazyPages.tsx` with its `NAV` href.

<!-- Verified against the current code on 2026-10-19. -->

<!-- kk:related:start -->
# Related

- Related: [map-nav-list-phone-more-sheet-and-nav-running-dots](map-nav-list-phone-more-sheet-and-nav-running-dots.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:map:0
<!-- kk:citations:end -->
