# Sounds

## Pomodoro bell

`packages/web/public/sounds/pomodoro-bell.mp3` rings when a Pomodoro work phase or break ends in the web app. The app serves it from its own origin, because the Content Security Policy allows media only from `'self'`.

It is a 1.5 second chime of three decaying sine waves at 880, 1320 and 1760 Hz. Tokkl generated it with FFmpeg and records no outside audio, so it is under the MIT license, like the rest of the project (see [LICENSE](../../LICENSE)).

To regenerate it, run this from the repository root:

```sh
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='0.45*exp(-3*t)*sin(2*PI*880*t)+0.2*exp(-4*t)*sin(2*PI*1320*t)+0.1*exp(-6*t)*sin(2*PI*1760*t)':s=44100:d=1.5" \
  -ac 1 -c:a libmp3lame -b:a 64k -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  packages/web/public/sounds/pomodoro-bell.mp3
```

The bitexact flags leave out encoder versions and metadata, so the same FFmpeg build writes the same file every time. FFmpeg 6.1.1 with libmp3lame wrote the committed file, which is 12,557 bytes with SHA-256 `464558df9458ce121f24cef2fabe7554ba8a6e87e0f5849b13f6e8cc95668a18`.
