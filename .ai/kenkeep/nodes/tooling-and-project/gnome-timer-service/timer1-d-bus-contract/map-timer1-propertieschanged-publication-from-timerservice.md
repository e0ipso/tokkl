---
type: map
title: Timer1 PropertiesChanged publication from TimerService
description: >-
  TimerService sends one diffed PropertiesChanged per event-loop turn after
  watched core signals; how to add a property.
tags:
  - gnome
  - dbus
kk_schema_version: 3
kk_id: map-timer1-propertieschanged-publication-from-timerservice
kk_derived_from: []
kk_relates_to:
  - map-desktop-timer-state-client-stream-poll-settling-and-revisions
  - map-timer1-timer-project-and-pomodoro-limit-properties
  - map-timer1-actions-presentation-status-and-alarmerror-properties
kk_depends_on: []
kk_confidence: high
---
`PropertiesChanged` lists only the properties whose value changed since the last signal, never the whole set, and the service sends at most one per turn of the event loop. Every `Q_PROPERTY` of `TimerService` is published (`TimerService::publication()`), read through its getter. The constructor lists the core signals once with `watch()`: the model's, the session's, the preferences', the sounds', the alarm's and the state client's `offsetChanged`, because `LocalStartTime` reads the offset. `main.cpp` builds the `PomodoroAlarm` before the service and passes it in `TimerService::Parts` with the rest; none of the parts is null, and `PreviewSound` returns true for every known sound. Any of them has every property read again on the next turn, and the diff against what the bus last saw sends only what changed. There is no table of which signal changes which property, so a getter cannot fall out of step with one. The whole set is read only on a core signal, never per tick (elapsed time and the countdown are not watched). A new property is a `Q_PROPERTY` and its getter, plus a watched signal when the getter reads something no watched signal announces. A method sends what it changed before it answers, so a client's cached properties are current when the reply arrives. `changesArriveOncePerTurn` checks that one state change sends one signal with every changed value.

<!-- kk:related:start -->
# Related

- Related: [map-desktop-timer-state-client-stream-poll-settling-and-revisions](../../kde-companion/plasma-companion/map-desktop-timer-state-client-stream-poll-settling-and-revisions.md)
- Related: [map-timer1-timer-project-and-pomodoro-limit-properties](map-timer1-timer-project-and-pomodoro-limit-properties.md)
- Related: [map-timer1-actions-presentation-status-and-alarmerror-properties](map-timer1-actions-presentation-status-and-alarmerror-properties.md)
<!-- kk:related:end -->
