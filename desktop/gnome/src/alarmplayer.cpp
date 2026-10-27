#include "alarmplayer.h"

#include "pomodorosounds.h"
#include "timerservice.h"

#include <QFileInfo>

namespace Tokkl
{

QString soundFile(const QString &directory, const QString &soundId)
{
    const std::optional<PomodoroSound> sound = pomodoroSound(soundId);
    if (!sound) {
        return QString();
    }
    QString path = directory;
    if (!path.endsWith(QLatin1Char('/'))) {
        path += QLatin1Char('/');
    }
    path += sound->fileName;
    return QFileInfo::exists(path) ? path : QString();
}

AlarmPlayer::AlarmPlayer(TimerService *service, AlarmBackend *backend, const QString &soundsDirectory, QObject *parent)
    : QObject(parent)
    , m_backend(backend)
    , m_directory(soundsDirectory)
{
    connect(service, &TimerService::alarmChanged, this, &AlarmPlayer::alarmChanged);
    connect(service, &TimerService::previewRequested, this, &AlarmPlayer::preview);
    if (service->ringing()) {
        alarmChanged(true, service->soundFor(service->ringingTransition()));
    }
}

void AlarmPlayer::alarmChanged(bool ringing, const QString &soundId)
{
    const QString file = ringing ? soundFile(m_directory, soundId) : QString();
    if (file.isEmpty()) {
        if (ringing) {
            qWarning("tokkl-timerd: the alarm sound %s is not in %s", qPrintable(soundId), qPrintable(m_directory));
        }
        m_backend->stop();
        return;
    }
    m_backend->loop(file);
}

void AlarmPlayer::preview(const QString &soundId)
{
    const QString file = soundFile(m_directory, soundId);
    if (file.isEmpty()) {
        qWarning("tokkl-timerd: the sound %s is not in %s", qPrintable(soundId), qPrintable(m_directory));
        return;
    }
    m_backend->playOnce(file);
}

}
