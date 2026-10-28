#pragma once

#include "apitypes.h"

#include <QObject>
#include <QPointer>
#include <QString>

class QSettings;

namespace Tokkl
{

class AlarmPlayer;
class PomodoroSession;

// The Pomodoro alarm: while the session rings, the sound chosen for the
// ringing transition loops on the player, and it stops the moment the ring
// ends. The settings window previews a sound once through the same player.
//
// The choice per transition is in the app's QSettings under soundKey(), next
// to the connection settings, as the sound's catalogue id. A missing or
// unknown id plays the catalogue's sound for the transition. The files are
// the four WAVs in soundsDirectory(): the bundle's Contents/Resources/sounds
// by default, which the build fills from TOKKL_POMODORO_SOUND_FILES. A file
// that is not there plays nothing.
class PomodoroAlarm : public QObject
{
    Q_OBJECT

public:
    // The settings key of a transition's choice: "workToShortRestSound" and
    // so on.
    static QString soundKey(TransitionKind kind);
    // The id chosen for kind in settings, or the catalogue's default when
    // none is stored, the stored one is unknown, or settings is null.
    static QString chosenSound(const QSettings *settings, TransitionKind kind);

    // Follows session and plays on player; owns neither. A null player
    // plays nothing.
    PomodoroAlarm(PomodoroSession *session, AlarmPlayer *player, QSettings *settings, QObject *parent = nullptr);

    QString soundsDirectory() const;
    void setSoundsDirectory(const QString &directory);
    // The file of a sound id in the directory, or empty when the id is not
    // in the catalogue or the file is not there.
    QString locate(const QString &soundId) const;

    // Plays the sound once; nothing for an id or file that is not there.
    void preview(const QString &soundId);

private:
    // Starts or stops the loop to match the session.
    void update();

    QPointer<PomodoroSession> m_session;
    QPointer<AlarmPlayer> m_player;
    QPointer<QSettings> m_settings;
    QString m_directory;
    // The file that loops; empty while nothing rings.
    QString m_looping;
};

}
