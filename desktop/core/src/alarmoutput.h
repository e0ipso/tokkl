#pragma once

#include <QString>

namespace Tokkl
{

// The audio a platform plays the Pomodoro alarm on. PomodoroAlarm decides
// what to play and when; an output only plays it. Tests record the calls.
class AlarmOutput
{
public:
    virtual ~AlarmOutput() = default;

    // Plays the file over and over until stop() or the next loop(), which
    // replaces it.
    virtual void loop(const QString &file) = 0;
    // Plays the file once, apart from the loop: a preview while the alarm
    // rings leaves the alarm ringing. A new one replaces the last.
    virtual void playOnce(const QString &file) = 0;
    // Stops the loop at once. A sound played once plays out.
    virtual void stop() = 0;
};

}
