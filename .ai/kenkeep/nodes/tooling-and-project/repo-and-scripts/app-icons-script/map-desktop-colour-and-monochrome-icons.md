---
type: map
title: Desktop colour and monochrome icons
description: >-
  LOGO resized to png32 for KDE, GNOME and macOS; mono logos dilate the pack
  outline to PANEL_STROKE; don't test hicolor picks.
tags:
  - icons
  - monochrome
  - tooling
  - imagemagick
kk_schema_version: 3
kk_id: map-desktop-colour-and-monochrome-icons
kk_derived_from:
  - 'b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0'
kk_relates_to:
  - map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes
  - practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them
  - map-npm-run-icons-inputs-and-web-icons
  - map-icons-test-ts-checks-and-rerunning-the-script
kk_depends_on: []
kk_confidence: high
---
Every transparent desktop icon is `LOGO` resized, with no trimming or recentring, so it keeps the pack's placement: the pack centres the clock body rather than the whole art, whose drip hangs below it, and fits the art in a centred 84% square. For the KDE widget the script writes full-colour RGBA PNGs (`png32:`): `desktop/kde/package/contents/images/tokkl.png` (96 px, the panel logo) and `desktop/kde/package/icons/tokkl-<n>.png` for 32, 48, 64, 96, 128 and 256 px. `tokkl-96.png` is a byte copy of `tokkl.png`, and both `desktop/kde/autotests/smokeloadtest.cpp` and `desktop/kde/scripts/check-package.sh` require them to match. `desktop/kde/package/CMakeLists.txt` installs each size as `hicolor/<n>x<n>/apps/<plasmoid id>.png` for the widget picker, which finds it through `KPlugin.Icon`; `icons/` stays out of the widget package, which copies only `contents/`.

The same `LOGO` resize renders the other colour desktop icons as `png32:` files. The GNOME extension's top-bar logo is `desktop/gnome/extension/tokkl.png` at 32 px (drawn at the 16 px panel size, so it stays sharp at twice that). The macOS bundle icon is `desktop/macos/resources/Tokkl.iconset/`: `icon_<n>x<n>.png` and `icon_<n>x<n>@2x.png` for 16, 32, 128, 256 and 512 points, the ten names `iconutil -c icns` expects (see `map-macos-menu-bar-app`). They are full-colour images of the logo, not template images. The 16 pt pair (`icon_16x16.png` and `icon_16x16@2x.png`) is also compiled into the `tokklmacos` library as the menu bar item's colour logo, so re-rendering the iconset changes the status item too. In monochrome mode `StatusImage` uses `desktop/macos/resources/mono_16x16.png` and `mono_16x16@2x.png` instead and fills their alpha with the menu bar's label colour. The client table in `docs/brand/README.md` has one row per client and the pack file it takes, KDE, GNOME and macOS included; a new client output gets a row there.

Every monochrome logo is the pack's outline export with thickened strokes: KDE's `contents/images/tokkl-mono-dark.png` and `tokkl-mono-light.png` (96 px, from `logo/outline-black-1024.png` and `logo/outline-white-1024.png`), GNOME's `desktop/gnome/extension/tokkl-symbolic.symbolic.png` (32 px; GNOME's symbolic loader maps its black pixels to the panel foreground) and the macOS `mono_16x16` pair. The outline's strokes are 5.7 px wide at 256 px, under half a pixel at panel size, so `panelOutline(outline, drawnSize)` resizes the outline to 256 px and dilates its alpha with a disk until each stroke is `PANEL_STROKE` (1.5) logical pixels wide at the size the panel draws it: 22 px for KDE (Kirigami's `smallMedium` in `PanelButton.qml`) and 16 px for GNOME and macOS. The script then sets every pixel's RGB to a single ink and resizes to the output size. When changing the stroke or the outline, verify that `desktop/kde/autotests/qml/tst_panel.qml` still finds more than 10 logo pixels within 2% of the panel ink at 22 px.

Do not test which file the icon theme draws for a size. hicolor's `256x256/apps` directory is `Type=Scalable` with `MinSize=64`, so the theme may draw any size from 64 px up from the 256 px file, and a lookup for 96 px can come back drawn from `tokkl-256.png`. The smokeload test therefore compares the 96 px files byte for byte and checks that `QIcon::fromTheme` lists all six sizes. The widget picker and the panel after a plasmashell restart are checked by hand.

<!-- Verified against the current code on 2026-10-28. -->

<!-- kk:related:start -->
# Related

- Related: [map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes](../../kde-companion/plasma-companion/map-kde-companion-tests-build-commands-the-ctest-suite-and-its-fakes.md)
- Related: [practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them](../practice-brand-packs-in-docs-brand-stay-as-the-owner-supplied-them.md)
- Related: [map-npm-run-icons-inputs-and-web-icons](map-npm-run-icons-inputs-and-web-icons.md)
- Related: [map-icons-test-ts-checks-and-rerunning-the-script](map-icons-test-ts-checks-and-rerunning-the-script.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:map:0
<!-- kk:citations:end -->
