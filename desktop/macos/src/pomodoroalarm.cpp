#include "pomodoroalarm.h"

#include "alarmplayer.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"

#include <QCoreApplication>
#include <QFileInfo>
#include <QSettings>

namespace Tokkl
{

QString PomodoroAlarm::soundKey(TransitionKind kind)
{
    return transitionKindName(kind) + QStringLiteral("Sound");
}

QString PomodoroAlarm::chosenSound(const QSettings *settings, TransitionKind kind)
{
    const QString stored = settings ? settings->value(soundKey(kind)).toString() : QString();
    return isSoundId(stored) ? stored : defaultSound(kind);
}

PomodoroAlarm::PomodoroAlarm(PomodoroSession *session, AlarmPlayer *player, QSettings *settings, QObject *parent)
    : QObject(parent)
    , m_session(session)
    , m_player(player)
    , m_settings(settings)
    , m_directory(QCoreApplication::applicationDirPath() + QStringLiteral("/../Resources/sounds"))
{
    if (m_session) {
        connect(m_session, &PomodoroSession::ringingChanged, this, &PomodoroAlarm::update);
    }
    update();
}

QString PomodoroAlarm::soundsDirectory() const
{
    return m_directory;
}

void PomodoroAlarm::setSoundsDirectory(const QString &directory)
{
    if (directory == m_directory) {
        return;
    }
    m_directory = directory;
    update();
}

QString PomodoroAlarm::locate(const QString &soundId) const
{
    const std::optional<PomodoroSound> sound = pomodoroSound(soundId);
    if (!sound) {
        return QString();
    }
    const QString path = m_directory + QLatin1Char('/') + sound->fileName;
    return QFileInfo::exists(path) ? path : QString();
}

void PomodoroAlarm::preview(const QString &soundId)
{
    const QString file = locate(soundId);
    if (!file.isEmpty() && m_player) {
        m_player->preview(file);
    }
}

void PomodoroAlarm::update()
{
    QString file;
    if (m_session && m_session->isRinging()) {
        if (const std::optional<TransitionKind> kind = parseTransitionKind(m_session->ringingTransition())) {
            file = locate(chosenSound(m_settings, *kind));
        }
    }
    if (file == m_looping) {
        return;
    }
    m_looping = file;
    if (!m_player) {
        return;
    }
    if (file.isEmpty()) {
        m_player->stop();
    } else {
        m_player->loop(file);
    }
}

}
