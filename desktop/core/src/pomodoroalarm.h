#pragma once

#include <QObject>
#include <QString>

namespace Tokkl
{

class AlarmOutput;
class PomodoroSession;
class SoundChoices;

// The Pomodoro alarm of a companion: while the session rings, the file of
// the sound chosen for the ringing transition loops on the output, and it
// stops the moment the ring ends. A change of choice for the ringing
// transition switches the loop. preview() plays a sound once on the same
// output.
//
// The files are the four bundled WAVs in soundsDirectory(). A sound whose
// file is not there plays nothing. That, and a sound the output reports it
// could not play, is logged and shows in failure() for the panels to tell
// the user.
class PomodoroAlarm : public QObject
{
    Q_OBJECT

public:
    // Owns none of them; all must outlive the alarm. An alarm already
    // ringing starts at once.
    PomodoroAlarm(PomodoroSession &session, AlarmOutput &output, SoundChoices &choices, const QString &soundsDirectory, QObject *parent = nullptr);
    ~PomodoroAlarm() override;

    QString soundsDirectory() const;
    void setSoundsDirectory(const QString &directory);
    // The file of a sound id in the directory, or empty when the id is not
    // in the catalogue or the file is not there.
    QString locate(const QString &soundId) const;

    // Plays the sound once. False, and nothing plays, for an id or file
    // that is not there.
    bool preview(const QString &soundId);

    // Why the last sound the alarm tried did not play, in words for the
    // user; empty when it played. It stays after the ring ends, until the
    // next ring or preview starts.
    QString failure() const;

Q_SIGNALS:
    void failureChanged();

private:
    // Starts, switches or stops the loop to match the session.
    void update();
    void setFailure(const QString &failure);
    // The file of a sound id, or empty, with the failure set, when it is
    // not there.
    QString soundToPlay(const QString &soundId);

    PomodoroSession &m_session;
    AlarmOutput &m_output;
    SoundChoices &m_choices;
    QString m_directory;
    // The file that loops; empty while nothing rings.
    QString m_looping;
    QString m_failure;
};

}
