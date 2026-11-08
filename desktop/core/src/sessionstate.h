#pragma once

#include "apitypes.h"

#include <QDateTime>
#include <QObject>

#include <functional>
#include <optional>

namespace Tokkl
{

// The server's timer state as a Pomodoro session reads and changes it: the
// state held, whether a write's outcome is still unknown, the server's
// clock, and the three session actions. TimerStateClient implements it on a
// connection; the session sees nothing of the network behind it.
class SessionState : public QObject
{
    Q_OBJECT

public:
    using ActionCallback = std::function<void(const TimerActionResult &)>;

    using QObject::QObject;

    // The newest state held; none before the first read and after
    // accountReset().
    virtual const std::optional<TimerState> &state() const = 0;
    // A write's outcome is unknown and no read sent since has answered.
    virtual bool settling() const = 0;
    // The server's clock minus this device's, from the state held. 0
    // without one.
    virtual qint64 serverOffsetMs() const = 0;
    // This device's clock corrected by serverOffsetMs().
    virtual QDateTime serverNow() const = 0;

    // done runs once, later, with the outcome. Next phase and End session
    // apply to the revision of the state held, and are refused without
    // sending while none is held.
    virtual void startPomodoro(const PomodoroStart &start, ActionCallback done) = 0;
    virtual void nextPhase(ActionCallback done) = 0;
    virtual void endPomodoro(ActionCallback done) = 0;

Q_SIGNALS:
    // A state at least as new as the one held arrived, or the state was
    // dropped.
    void stateChanged();
    void settlingChanged();
    // The state now belongs to another instance, account or secret, or to
    // none. The state was dropped first, and an action sent before never
    // answers.
    void accountReset();
};

}
