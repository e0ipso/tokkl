#include "pomodoroalarm.h"

#include "alarmoutput.h"
#include "logging.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "soundchoices.h"

namespace Tokkl
{

PomodoroAlarm::PomodoroAlarm(PomodoroSession *session, AlarmOutput *output, SoundChoices *choices, const QString &soundsDirectory, QObject *parent)
    : QObject(parent)
    , m_session(session)
    , m_output(output)
    , m_choices(choices)
    , m_directory(soundsDirectory)
{
    if (m_session) {
        connect(m_session, &PomodoroSession::ringingChanged, this, &PomodoroAlarm::update);
    }
    if (m_choices) {
        connect(m_choices, &SoundChoices::changed, this, &PomodoroAlarm::update);
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
    return soundFile(m_directory, soundId);
}

bool PomodoroAlarm::preview(const QString &soundId)
{
    if (!m_output) {
        return false;
    }
    const QString file = locate(soundId);
    if (file.isEmpty()) {
        qCWarning(lcAlarm) << "The sound" << soundId << "is not in" << m_directory;
        return false;
    }
    m_output->playOnce(file);
    return true;
}

void PomodoroAlarm::update()
{
    QString file;
    if (m_session && m_session->isRinging()) {
        if (const std::optional<TransitionKind> kind = parseTransitionKind(m_session->ringingTransition())) {
            const QString soundId = m_choices ? m_choices->chosen(*kind) : defaultSound(*kind);
            file = locate(soundId);
            if (file.isEmpty()) {
                qCWarning(lcAlarm) << "The alarm sound" << soundId << "is not in" << m_directory;
            }
        }
    }
    if (file == m_looping) {
        return;
    }
    m_looping = file;
    if (!m_output) {
        return;
    }
    if (file.isEmpty()) {
        m_output->stop();
    } else {
        m_output->loop(file);
    }
}

}
