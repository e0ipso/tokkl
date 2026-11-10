#include "pomodoroalarm.h"

#include "alarmoutput.h"
#include "logging.h"
#include "pomodorosession.h"
#include "pomodorosounds.h"
#include "soundchoices.h"

namespace Tokkl
{

PomodoroAlarm::PomodoroAlarm(PomodoroSession &session, AlarmOutput &output, SoundChoices &choices, const QString &soundsDirectory, QObject *parent)
    : QObject(parent)
    , m_session(session)
    , m_output(output)
    , m_choices(choices)
    , m_directory(soundsDirectory)
{
    m_output.setFailureHandler([this](const QString &reason) {
        qCWarning(lcAlarm).noquote() << "The alarm sound did not play:" << reason;
        setFailure(tr("No alarm sound: %1").arg(reason));
    });
    connect(&m_session, &PomodoroSession::ringingChanged, this, &PomodoroAlarm::update);
    connect(&m_choices, &SoundChoices::changed, this, &PomodoroAlarm::update);
    update();
}

PomodoroAlarm::~PomodoroAlarm()
{
    m_output.setFailureHandler({});
}

bool PomodoroAlarm::preview(const QString &soundId)
{
    setFailure(QString());
    const QString file = soundToPlay(soundId);
    if (file.isEmpty()) {
        return false;
    }
    m_output.playOnce(file);
    return true;
}

QString PomodoroAlarm::failure() const
{
    return m_failure;
}

void PomodoroAlarm::setFailure(const QString &failure)
{
    if (failure == m_failure) {
        return;
    }
    m_failure = failure;
    Q_EMIT failureChanged();
}

QString PomodoroAlarm::soundToPlay(const QString &soundId)
{
    const QString file = soundFile(m_directory, soundId);
    if (file.isEmpty()) {
        qCWarning(lcAlarm) << "The sound" << soundId << "is not in" << m_directory;
        setFailure(tr("No alarm sound: the file for %1 is not in %2").arg(soundId, m_directory));
    }
    return file;
}

void PomodoroAlarm::update()
{
    QString soundId;
    if (m_session.isRinging()) {
        if (const std::optional<TransitionKind> kind = parseTransitionKind(m_session.ringingTransition())) {
            soundId = m_choices.chosen(*kind);
        }
    }
    // A ring whose file is missing plays nothing and says so.
    const QString file = soundId.isEmpty() ? QString() : soundToPlay(soundId);
    if (file == m_looping) {
        return;
    }
    m_looping = file;
    if (file.isEmpty()) {
        m_output.stop();
    } else {
        setFailure(QString());
        m_output.loop(file);
    }
}

}
