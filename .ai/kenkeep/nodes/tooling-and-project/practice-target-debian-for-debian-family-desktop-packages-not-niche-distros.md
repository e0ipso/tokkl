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
- Related: [map-gnome-timerd-d-bus-timer-service → map-gnome-timer-service-activation-and-packaging](gnome-timer-service/map-gnome-timer-service-activation-and-packaging.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-org-tokkl-timer1-interface-file-members-and-interfaceversion](gnome-timer-service/timer1-d-bus-contract/map-org-tokkl-timer1-interface-file-members-and-interfaceversion.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-actions-presentation-status-and-alarmerror-properties](gnome-timer-service/timer1-d-bus-contract/map-timer1-actions-presentation-status-and-alarmerror-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-methods-requests-refreshprojects-configure-and-activate](gnome-timer-service/timer1-d-bus-contract/map-timer1-methods-requests-refreshprojects-configure-and-activate.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-propertieschanged-publication-from-timerservice](gnome-timer-service/timer1-d-bus-contract/map-timer1-propertieschanged-publication-from-timerservice.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-timer1-timer-project-and-pomodoro-limit-properties](gnome-timer-service/timer1-d-bus-contract/map-timer1-timer-project-and-pomodoro-limit-properties.md)
- Related: [map-gnome-timerd-d-bus-timer-service → map-tokkl-timerd-daemon-composition-root-and-secret-storage](gnome-timer-service/timer1-d-bus-contract/map-tokkl-timerd-daemon-composition-root-and-secret-storage.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-and-core-ci-jobs](kde-companion/kde-ci-and-release-pipeline/map-kde-and-core-ci-jobs.md)
- Related: [map-kde-ci-and-release-pipeline → map-kde-real-server-test](kde-companion/kde-ci-and-release-pipeline/map-kde-real-server-test.md)
- Related: [map-kde-ci-and-release-pipeline → map-release-stages-kde-semantic-release-plugin-and-gnome-assets](kde-companion/kde-ci-and-release-pipeline/map-release-stages-kde-semantic-release-plugin-and-gnome-assets.md)
- Related: [map-kde-ci-and-release-pipeline → map-tests-for-release-only-ci-steps](kde-companion/kde-ci-and-release-pipeline/map-tests-for-release-only-ci-steps.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 00ad724c-83fd-4010-8539-ba27d315dbc4:practice:0
<!-- kk:citations:end -->
