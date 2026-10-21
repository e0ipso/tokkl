# Sounds

## Pomodoro transition sounds

Four alarms mark the move from one Pomodoro phase to the next. Each one loops until the user confirms the next phase or ends the session, so each file holds one phrase followed by its own rest, and the phrase starts again straight after. They differ in pitch and rhythm, so the user can tell which phase comes next without looking. Rising notes call the user back to work and falling notes send them to a rest.

Tokkl generated all four with FFmpeg and records no outside audio, so they are under the MIT license, like the rest of the project (see [LICENSE](../../LICENSE)). Each note is a sine wave with a quieter octave above it, a 5 ms attack, an exponential decay and a 20 ms fade to silence before the next note.

The files are 16-bit mono PCM WAV at 22,050 Hz. Browsers play WAV in an `<audio>` element and Android plays it with `MediaPlayer`, so the web app and Tokkl for Android use the same files. The app serves them from its own origin, because the Content Security Policy allows media only from `'self'`. MP3 does not loop cleanly: the encoder pads the stream to whole frames, and a player that ignores the LAME gapless header plays that padding as silence at every loop. Encoded with libmp3lame at 64 kbit/s, the work to short rest phrase grew from 44,100 to 45,504 samples, which is 64 ms of extra silence per loop. A WAV file has no encoder delay or padding, so its samples are the loop.

Run each command from the repository root. The bitexact flags leave out encoder versions and metadata, so the same FFmpeg build writes the same file every time. FFmpeg 6.1.1 (Ubuntu build `6.1.1-3ubuntu5`) wrote the committed files.

### Work to short rest

`packages/web/public/sounds/pomodoro-work-to-short-rest.wav` plays when a work phase ends and a short rest is next. Two falling notes, G5 (784 Hz) then C5 (523 Hz), half a second each, then a second of rest. It loops every 2 seconds.

```sh
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='st(0,mod(t,0.5));st(1,if(lt(t,0.5),784,523));lt(t,1)*min(ld(0)/0.005,1)*min((0.5-ld(0))/0.02,1)*exp(-5*ld(0))*(0.5*sin(2*PI*ld(1)*ld(0))+0.15*sin(4*PI*ld(1)*ld(0)))':s=22050:d=2" \
  -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  packages/web/public/sounds/pomodoro-work-to-short-rest.wav
```

The committed file is 88,244 bytes with SHA-256 `8958a9ec1b1ec3ba501e4a6200fe1cdc9293ee4cfea58c4e34683a5342f036c9`.

### Short rest to work

`packages/web/public/sounds/pomodoro-short-rest-to-work.wav` plays when a short rest ends and work is next. Three quick rising notes, C5 (523 Hz), E5 (659 Hz) and G5 (784 Hz), 0.15 seconds each, then 1.05 seconds of rest. It loops every 1.5 seconds.

```sh
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='st(0,mod(t,0.15));st(1,if(lt(t,0.15),523,if(lt(t,0.3),659,784)));lt(t,0.45)*min(ld(0)/0.005,1)*min((0.15-ld(0))/0.02,1)*exp(-8*ld(0))*(0.5*sin(2*PI*ld(1)*ld(0))+0.15*sin(4*PI*ld(1)*ld(0)))':s=22050:d=1.5" \
  -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  packages/web/public/sounds/pomodoro-short-rest-to-work.wav
```

The committed file is 66,194 bytes with SHA-256 `8647f3aed53043c5f4ca0b3742ee661fa8cd0eb9dd8687fb3b37de2a3a81e098`.

### Work to long rest

`packages/web/public/sounds/pomodoro-work-to-long-rest.wav` plays when a work phase ends and a long rest is next. Four slow falling notes in a lower register, E5 (659 Hz), C5 (523 Hz), A4 (440 Hz) and E4 (330 Hz), 0.45 seconds each, then 1.2 seconds of rest. It loops every 3 seconds.

```sh
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='st(0,mod(t,0.45));st(1,if(lt(t,0.45),659,if(lt(t,0.9),523,if(lt(t,1.35),440,330))));lt(t,1.8)*min(ld(0)/0.005,1)*min((0.45-ld(0))/0.02,1)*exp(-4*ld(0))*(0.5*sin(2*PI*ld(1)*ld(0))+0.15*sin(4*PI*ld(1)*ld(0)))':s=22050:d=3" \
  -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  packages/web/public/sounds/pomodoro-work-to-long-rest.wav
```

The committed file is 132,344 bytes with SHA-256 `1a5e6e63fb35f46ce0760ee2a3d5c0d4ab073ecd3bd323c42d7c47657063fc2a`.

### Long rest to work

`packages/web/public/sounds/pomodoro-long-rest-to-work.wav` plays when a long rest ends and work is next. A fast high rising run, A5 (880 Hz), C#6 (1109 Hz) and E6 (1319 Hz) at 0.1 seconds a note, played twice with 0.1 seconds between the runs, then 0.9 seconds of rest. It loops every 1.6 seconds.

```sh
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='st(0,mod(t,0.1));st(2,mod(t,0.4));st(1,if(lt(ld(2),0.1),880,if(lt(ld(2),0.2),1109,1319)));lt(t,0.8)*lt(ld(2),0.3)*min(ld(0)/0.005,1)*min((0.1-ld(0))/0.02,1)*exp(-10*ld(0))*(0.5*sin(2*PI*ld(1)*ld(0))+0.15*sin(4*PI*ld(1)*ld(0)))':s=22050:d=1.6" \
  -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact \
  packages/web/public/sounds/pomodoro-long-rest-to-work.wav
```

The committed file is 70,604 bytes with SHA-256 `9da85ce5043763176511b74b7781754294ad959b8309b7524bbc48b590a5ce66`.

### Loop check

Each file was checked for a gap or a click at the loop point:

- `ffprobe -v error -show_entries stream=duration_ts -of csv=p=0 FILE` reports exactly the phrase length in samples: 44,100, 33,075, 66,150 and 35,280. Nothing pads the end.
- The PCM data starts straight after the 44-byte header, with no metadata chunk.
- The first and last samples of every file are 0, and the last note fades to silence before the rest. Where the loop wraps, silence meets the start of a 5 ms attack, so there is no step in the waveform to click.
- The only silence at the loop point is the phrase's own rest: 1.0, 1.05, 1.2 and 0.9 seconds.
