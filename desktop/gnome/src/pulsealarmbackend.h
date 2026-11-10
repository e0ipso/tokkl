#pragma once

// libpulse-simple playback, which pipewire-pulse also serves: Qt Multimedia would pull in
// Qt Gui. Alarm and preview are separate streams that connect only while playing.

#include "alarmoutput.h"
#include "wavfile.h"

#include <QHash>

#include <QObject>
#include <QString>

namespace Tokkl
{
class PulseStream;

class PulseAlarmBackend : public QObject, public AlarmOutput
{
    Q_OBJECT

public:
    explicit PulseAlarmBackend(const QString &applicationName, QObject *parent = nullptr);
    ~PulseAlarmBackend() override;

    void loop(const QString &file) override;
    void playOnce(const QString &file) override;
    void stop() override;

Q_SIGNALS:
    void errorOccurred(const QString &message);

private:
    void play(PulseStream *stream, const QString &file);

    PulseStream *m_alarm;
    PulseStream *m_preview;
    QHash<QString, WavData> m_sounds;
};

}
