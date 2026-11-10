#pragma once

#include "apitypes.h"

#include <QDateTime>
#include <QObject>

#include <functional>
#include <optional>

namespace Tokkl
{

// The server's timer state as a Pomodoro session sees it, with no network
// behind it. TimerStateClient implements it.
class SessionState : public QObject
{
    Q_OBJECT

public:
    using ActionCallback = std::function<void(const TimerActionResult &)>;

    using QObject::QObject;

    // None before the first read and after accountReset().
    virtual const std::optional<TimerState> &state() const = 0;
    virtual bool settling() const = 0;
    virtual qint64 serverOffsetMs() const = 0;
    virtual QDateTime serverNow() const = 0;

    // done runs once, later. Refused without sending while no state is held.
    virtual void startPomodoro(const PomodoroStart &start, ActionCallback done) = 0;
    virtual void nextPhase(ActionCallback done) = 0;
    virtual void endPomodoro(ActionCallback done) = 0;

Q_SIGNALS:
    // Also when the state was dropped.
    void stateChanged();
    void settlingChanged();
    // Emitted after the state was dropped; an action sent before never answers.
    void accountReset();
    // After sleep or a clock jump; once per wake.
    void woke();
};

}
