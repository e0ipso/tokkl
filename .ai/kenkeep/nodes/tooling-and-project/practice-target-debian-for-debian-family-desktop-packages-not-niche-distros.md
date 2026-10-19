---
type: practice
title: 'Target Debian for Debian-family desktop packages, not niche distros'
description: >-
  DEB builds for the desktop companions target stock Debian; niche distros like
  TUXEDO OS are not targets. Ubuntu is the fallback.
tags:
  - packaging
  - desktop
  - debian
  - linux
kk_schema_version: 3
kk_id: practice-target-debian-for-debian-family-desktop-packages-not-niche-distros
kk_derived_from:
  - '00ad724c-83fd-4010-8539-ba27d315dbc4:practice:0'
kk_relates_to:
  - map-kde-native-packaging
  - map-gnome-timerd-d-bus-timer-service
  - map-kde-ci-and-release-pipeline
kk_depends_on: []
kk_confidence: high
---
The Debian-family packages for the desktop companions (`tokkl-kde`, `tokkl-timerd`) target stock Debian (currently Debian 13). Niche Debian derivatives such as TUXEDO OS are not targets: few people run them.

When Debian's Qt, KDE Frameworks or Plasma versions are older than a build asks for, lower the version floors first. Target Ubuntu only if Debian cannot be made to work.

<!-- kk:related:start -->
# Related

- Related: [map-kde-native-packaging](kde-companion/map-kde-native-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service](map-gnome-timerd-d-bus-timer-service.md)
- Related: [map-kde-ci-and-release-pipeline](kde-companion/map-kde-ci-and-release-pipeline.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 00ad724c-83fd-4010-8539-ba27d315dbc4:practice:0
<!-- kk:citations:end -->
