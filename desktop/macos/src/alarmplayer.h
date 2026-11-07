#pragma once

#include "alarmoutput.h"

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
//
// The core's AlarmOutput gives the calls: a loop of the same file that
// already loops keeps playing, and playOnce() replaces an earlier preview
// still playing without touching the loop.
class AlarmPlayer : public QObject, public AlarmOutput
{
    Q_OBJECT

public:
    using QObject::QObject;
};

}
