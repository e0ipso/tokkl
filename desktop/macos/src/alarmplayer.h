#pragma once

#include <QObject>
#include <QString>

namespace Tokkl
{

// The platform's audio output for the Pomodoro alarm: a WAV file looped
// while the session rings, and a sound played once from the settings.
// PomodoroAlarm decides what to play and when; this only plays it.
//
// macalarmplayer.mm plays through AppKit's NSSound, not Qt Multimedia. The
// WAVs need no decoder NSSound lacks, and NSSound loops a sound with one
// property. Qt Multimedia would add a module to the CI install, its backend
// plugin and the FFmpeg libraries it links to the DMG, and macdeployqt's
// handling of those to the things only the macos job can check. Its
// development files are also absent from the Linux hosts, so a QSoundEffect
// player could not be compiled where the tests run, while the NSSound shim
// is on the same footing as the other three .mm files. Tests use a fake.
class AlarmPlayer : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    // Plays file over and over until stop() or another loop(). A loop of the
    // same file that already loops keeps playing.
    virtual void loop(const QString &file) = 0;
    virtual void stop() = 0;
    // Plays file once, replacing an earlier preview still playing. It does
    // not touch the loop.
    virtual void preview(const QString &file) = 0;
};

}
