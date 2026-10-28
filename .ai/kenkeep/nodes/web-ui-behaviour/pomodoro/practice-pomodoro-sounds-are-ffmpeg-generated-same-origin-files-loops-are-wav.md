---
type: practice
title: 'Pomodoro sounds: FFmpeg recipes, same-origin files, WAV for loops'
description: >-
  Sounds in public/sounds are FFmpeg-generated with recipe and SHA-256 in
  docs/sounds; looping alarms are WAV, since MP3 padding breaks loops.
tags:
  - web
  - pomodoro
  - audio
  - csp
  - e2e
kk_schema_version: 3
kk_id: practice-pomodoro-sounds-are-ffmpeg-generated-same-origin-files-loops-are-wav
kk_derived_from:
  - '6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:2'
  - '59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:3'
kk_relates_to:
  - map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider
  - practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory
kk_depends_on: []
kk_confidence: high
---
Every sound in `packages/web/public/sounds/` is generated with FFmpeg from a `lavfi` source, with no outside audio, so it is MIT like the code. `docs/sounds/README.md` holds each file's command, byte size and SHA-256, and the bitexact flags make the same FFmpeg build write the same bytes. Commit a new sound with its recipe, size and hash in the same change.

The four Pomodoro transition alarms (`pomodoro-work-to-short-rest.wav`, `pomodoro-short-rest-to-work.wav`, `pomodoro-work-to-long-rest.wav`, `pomodoro-long-rest-to-work.wav`) loop until the user confirms the next phase, so each is 16-bit mono PCM WAV at 22,050 Hz. MP3 cannot loop cleanly. The encoder pads to whole frames, and a player that ignores the LAME gapless header plays the padding as silence at each loop (the work to short rest phrase grew from 44,100 to 45,504 samples, about 64 ms). Browsers' `<audio>` and Android's `MediaPlayer` both play WAV, so the web app and Tokkl for Android share the files.

`pomodoroSessionAlarm.ts` plays the alarms. One tab per account owns the sound through a Web Lock, `tokkl.pomodoroAudio.<accountId>`. The owner loops the transition's file until Next or End and pauses it before releasing the lock, so when the owning tab closes another tab can take over without the loops overlapping. Start primes the audio synchronously inside the click, before awaiting anything, because of autoplay rules; if `play()` still rejects, the banner shows `Retry sound` for a fresh gesture.

The Content Security Policy has `default-src 'self'` and no `media-src`, so audio plays only from the app's own origin; never point at a CDN. `packages/api/test/static.test.ts` checks each WAV is served as `audio/wav` under that policy, and `e2e/timer-pomodoro-session.spec.ts` checks the built app serves each committed WAV byte for byte.

Outside `/assets`, a missing static file is not a 404. `packages/api/src/app.ts` answers any unknown GET with `index.html` as `text/html` and status 200, so a test for a shipped file must check the content type or the bytes, not the status.

<!-- kk:related:start -->
# Related

- Related: [map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider](map-web-pomodoro-driver-and-the-app-wide-pomodoroprovider.md)
- Related: [practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory](../../tooling-and-project/testing/e2e-suite/practice-running-the-e2e-suite-build-chromium-ports-and-the-data-directory.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 6f25aa82-f4d8-4d4f-8bd6-90bbec1441c7:practice:2
[2] 59dc3ffc-e25c-4710-a620-20a3ee05e3b7:practice:3
<!-- kk:citations:end -->
