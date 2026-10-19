---
type: practice
title: docs/brand packs stay as the owner supplied them; never run their rebuilds
description: >-
  icon-pack and wordmark-pack are the owner's files byte for byte; build.mjs and
  rebuild.sh rewrite them. Other clients follow docs/brand/README.md.
tags:
  - brand
  - assets
  - docs
kk_schema_version: 3
kk_id: practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them
kk_derived_from: []
kk_relates_to:
  - map-app-icons-script
kk_depends_on: []
kk_confidence: high
---
`docs/brand/icon-pack/` (the clock icon pack) and `docs/brand/wordmark-pack/` (the clock O wordmark pack) are committed byte-identical to the packs the owner supplied, and must stay that way. The wordmark pack holds only the detailed wordmark files and its `source/`; its clean and mono variants and `previews/` are left out on purpose, although the pack's own README recommends the clean SVG for web use.

Never edit a pack file, and do not run `docs/brand/icon-pack/scripts/build.mjs` or `docs/brand/wordmark-pack/source/rebuild.sh` (or the scripts in `source/tools/`) in the checkout. `build.mjs` rewrites the icon pack's exports, previews and `inventory.json` in place, even though `docs/brand/README.md` documents it under "Rebuild". `rebuild.sh` retraces the detailed SVG and writes the clean variants, PDFs, PNGs and previews. If a lint, format or tracker-reference check picks up a pack file, exclude the pack directory from that check.

`docs/brand/README.md` is the guide for clients other than the web app, including the Android app: browsers take `icon-pack/web/public`, the Android launcher `icon-pack/android/res`, store listings `icon-pack/store/google-play-512.png`, and the wordmark master is `wordmark-pack/source/tokkl-wordmark-clock-master.png`. The top-level `README.md` points other clients there. `npm run icons` reads the wordmark master in place. It makes the served wordmarks, the README header `docs/brand/tokkl-wordmark.png` and `docs/brand/tokkl-wordmark-full.png`, the full-width crop for other clients. Reading a pack file is fine; the rule covers editing it or running its rebuilds. The served icons do not come from `icon-pack/` yet; the script still reads the older v4 files in `docs/brand` (see map-app-icons-script).

<!-- kk:related:start -->
# Related

- Related: [map-app-icons-script](map-app-icons-script.md)
<!-- kk:related:end -->
