---
type: practice
title: Clipboard copy needs a fallback on plain HTTP
description: >-
  navigator.clipboard exists only on HTTPS or localhost; copy code falls back to
  a hidden textarea, then asks the user to copy by hand.
tags:
  - web
  - clipboard
  - self-hosting
kk_schema_version: 3
kk_id: practice-clipboard-copy-needs-http-fallback
kk_derived_from:
  - packages/web/src/pages/AdminPage.tsx
kk_relates_to:
  - map-invites-and-password-reset-links-in-account-tokens
kk_depends_on: []
kk_confidence: high
---
Tokkl is self-hosted and often reached over plain HTTP on the LAN, where `navigator.clipboard` does not exist. The browser can also refuse the Clipboard API when the user blocked clipboard access. The shared helper `copyText(text, failure)` in `packages/web/src/lib/clipboard.ts` (used by `ApiTokenSection.tsx` and the admin page's `NewLink`) uses `navigator.clipboard.writeText` only in a secure context, falls back to a hidden textarea with `document.execCommand('copy')` when it is missing or refused, and rejects with the `failure` message, which should tell the user to copy by hand, if both fail. Call `copyText` for any new copy-to-clipboard feature instead of touching `navigator.clipboard`.

<!-- kk:related:start -->
# Related

- Related: [map-invites-and-password-reset-links-in-account-tokens](../../api-and-data/users-and-admin/map-invites-and-password-reset-links-in-account-tokens.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] [packages/web/src/pages/AdminPage.tsx](../../../../../packages/web/src/pages/AdminPage.tsx)
<!-- kk:citations:end -->
