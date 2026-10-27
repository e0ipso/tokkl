#pragma once

// The alarm on the sound server, through libpulse's simple API. PipeWire
// serves that protocol on GNOME (pipewire-pulse), as PulseAudio does, so
// the service needs one small library, libpulse-simple, that every GNOME
// desktop has. It works from the user service with no display, and the
// package needs no Qt library beyond Core, Network and DBus.
//
// The other candidates were ruled out for this service. Qt Multimedia's
// QSoundEffect links Qt Gui (and on Debian Qt Quick, EGL and X11), which
// the headless service may not load; ci/check.sh fails the build on it. A
// GStreamer pipeline needs the core plus the base and good plugin sets for
// a WAV, several packages for what is one buffer of samples.
//
// Each stream is a thread that reads the WAV (wavfile.h), opens a playback
// stream with a short buffer and writes the samples in small pieces, so a
// stop takes effect within a fraction of a second and the loop has no gap:
// the same buffer is written again as soon as the last piece is in. The
// alarm loop and the preview are two streams, so a preview does not
// silence a ringing alarm. The stream connects when a sound starts and
// disconnects when it ends, so a silent service holds no connection and a
// sound server restarted in between is found again. A server that refuses,
// or a file that cannot be read, is reported through errorOccurred and
// leaves the service running without sound.

#include "alarmbackend.h"

#include <QObject>
#include <QString>

namespace Tokkl
{
class PulseStream;

class PulseAlarmBackend : public QObject, public AlarmBackend
{
    Q_OBJECT

public:
    // applicationName is what the server lists the streams under.
    explicit PulseAlarmBackend(const QString &applicationName, QObject *parent = nullptr);
    ~PulseAlarmBackend() override;

    void loop(const QString &file) override;
    void playOnce(const QString &file) override;
    void stop() override;

Q_SIGNALS:
    // A file that could not be read, or a server that refused the stream.
    // The sound is not playing.
    void errorOccurred(const QString &message);

private:
    void play(PulseStream *stream, const QString &file);

    PulseStream *m_alarm;
    PulseStream *m_preview;
};

}
