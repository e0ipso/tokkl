#pragma once

#include <QObject>

#include <optional>

namespace Tokkl
{

// The part of the timer a Pomodoro session works with: whether the timer
// holds an entry or could start something new, the project and billable
// flag a session starts with, and the click's toggle. TimerCoordinator
// implements it. The session reads the server's state through a
// SessionState of its own, the one the timer reads.
class TimerActions : public QObject
{
    Q_OBJECT

public:
    // What a new session starts with: the timer's chosen project, none for
    // no project, and billable flag.
    struct Selection {
        std::optional<qint64> projectId;
        bool billable = false;

        bool operator==(const Selection &other) const = default;
    };

    using QObject::QObject;

    // An entry runs or a chain is paused.
    virtual bool holdsEntry() const = 0;
    // A timer write is on its way, or its outcome is not known yet.
    virtual bool isBusy() const = 0;
    // The timer could start something new now; see TimerModel::canStartNew().
    virtual bool canStartNew() const = 0;
    virtual Selection selection() const = 0;
    // Pauses a running entry, resumes a paused chain, otherwise starts.
    // True when a request was sent.
    virtual bool toggle() = 0;

Q_SIGNALS:
    // Any of the answers above may have changed.
    void changed();
};

}
