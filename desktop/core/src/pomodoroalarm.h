#pragma once

#include <QObject>
#include <QString>

namespace Tokkl
{

class AlarmOutput;
class PomodoroSession;
class SoundChoices;

// Loops the chosen sound while the session rings. A missing file or a
// sound the output could not play shows in failure().
class PomodoroAlarm : public QObject
{
    Q_OBJECT

public:
    // None is owned; all must outlive the alarm. An alarm already ringing starts
    // at once.
    PomodoroAlarm(PomodoroSession &session, AlarmOutput &output, SoundChoices &choices, const QString &soundsDirectory, QObject *parent = nullptr);
    ~PomodoroAlarm() override;

    // False, and nothing plays, for an unknown id or a missing file.
    bool preview(const QString &soundId);

    // For the user; stays after the ring ends, until the next ring or preview.
    QString failure() const;

Q_SIGNALS:
    void failureChanged();

private:
    void update();
    void setFailure(const QString &failure);
    // Empty, with the failure set, when the file is missing.
    QString soundToPlay(const QString &soundId);

    PomodoroSession &m_session;
    AlarmOutput &m_output;
    SoundChoices &m_choices;
    QString m_directory;
    QString m_looping;
    QString m_failure;
};

}
