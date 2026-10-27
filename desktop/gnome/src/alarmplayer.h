#pragma once

// The Pomodoro alarm as the service plays it. The player follows
// TimerService's alarm: while the session rings, the file of the sound
// chosen for the ringing transition loops on the backend; it stops the
// moment the ring ends; a PreviewSound call plays its file once. The
// service accepts PreviewSound only while a player listens.
//
// The files are the four bundled WAVs, pomodoro-<id>.wav, installed in the
// service's data directory (TOKKL_SOUNDS_DIR, given to the program at
// build time); the tests point the player at the core's copy. A sound whose
// file is not there plays nothing and is logged.

#include "alarmbackend.h"

#include <QObject>
#include <QString>

namespace Tokkl
{
class TimerService;

// The file of a catalogue sound in the directory, or empty for an id the
// catalogue does not have or a file that is not there.
QString soundFile(const QString &directory, const QString &soundId);

class AlarmPlayer : public QObject
{
    Q_OBJECT

public:
    // Neither the service nor the backend is owned. An alarm already
    // ringing starts at once.
    AlarmPlayer(TimerService *service, AlarmBackend *backend, const QString &soundsDirectory, QObject *parent = nullptr);

private:
    void alarmChanged(bool ringing, const QString &soundId);
    void preview(const QString &soundId);

    AlarmBackend *m_backend;
    QString m_directory;
};

}
