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
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
Tokkl is self-hosted and often reached over plain HTTP on the LAN, where `navigator.clipboard` does not exist. The browser can also refuse the Clipboard API when the user blocked clipboard access. The copy helper in `packages/web/src/pages/manage/settings/ApiTokenSection.tsx` uses `navigator.clipboard.writeText` only in a secure context, falls back to a hidden textarea with `document.execCommand('copy')` when it is missing or refused, and tells the user to copy by hand if both fail. Any new copy-to-clipboard feature needs the same fallback.
