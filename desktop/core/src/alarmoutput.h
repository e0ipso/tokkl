#pragma once

#include <QString>

#include <functional>
#include <utility>

namespace Tokkl
{

// The audio a platform plays the Pomodoro alarm on. PomodoroAlarm decides
// what to play and when; an output only plays it, and says when it could
// not. Tests record the calls.
class AlarmOutput
{
public:
    // Hears why a sound did not play, in words for the user.
    using FailureHandler = std::function<void(const QString &reason)>;

    virtual ~AlarmOutput() = default;

    // Plays the file over and over until stop() or the next loop(), which
    // replaces it.
    virtual void loop(const QString &file) = 0;
    // Plays the file once, apart from the loop: a preview while the alarm
    // rings leaves the alarm ringing. A new one replaces the last.
    virtual void playOnce(const QString &file) = 0;
    // Stops the loop at once. A sound played once plays out.
    virtual void stop() = 0;

    // Who hears of a sound that did not play; PomodoroAlarm sets it. One
    // at a time: a new handler replaces the last.
    void setFailureHandler(FailureHandler handler)
    {
        m_failureHandler = std::move(handler);
    }

protected:
    // For an output whose loop() or playOnce() could not play the file,
    // whether it knew at once or only later. Call it on the thread that
    // calls loop() and playOnce().
    void reportFailure(const QString &reason) const
    {
        if (m_failureHandler) {
            m_failureHandler(reason);
        }
    }

private:
    FailureHandler m_failureHandler;
};

}
