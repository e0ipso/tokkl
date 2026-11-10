#pragma once

#include <QString>

#include <functional>
#include <utility>

namespace Tokkl
{

// PomodoroAlarm decides what plays and when; an output only plays it and
// reports when it could not.
class AlarmOutput
{
public:
    // reason is in words for the user.
    using FailureHandler = std::function<void(const QString &reason)>;

    virtual ~AlarmOutput() = default;

    // Repeats until stop() or the next loop().
    virtual void loop(const QString &file) = 0;
    // Independent of the loop, so a preview leaves the alarm ringing. A new one
    // replaces the last.
    virtual void playOnce(const QString &file) = 0;
    // A sound played once plays out.
    virtual void stop() = 0;

    void setFailureHandler(FailureHandler handler)
    {
        m_failureHandler = std::move(handler);
    }

protected:
    // Call on the thread that calls loop() and playOnce().
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
