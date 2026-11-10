#pragma once

#include <QObject>

#include <optional>

namespace Tokkl
{

// Panels name the click from primaryActionKey(), so the label always says
// what the click does.
enum class PrimaryAction {
    Start,
    Pause,
    Resume,
    StartSession,
    // Confirms Next phase while the alarm rings, otherwise opens the menu.
    Session,
};

// The part of the timer a Pomodoro session works with. The session reads
// the server's state through the same SessionState as the timer.
class TimerActions : public QObject
{
    Q_OBJECT

public:
    struct Selection {
        std::optional<qint64> projectId;
        bool billable = false;

        bool operator==(const Selection &other) const = default;
    };

    using QObject::QObject;

    virtual bool holdsEntry() const = 0;
    // A timer write is on its way, or its outcome is not known yet.
    virtual bool isBusy() const = 0;
    virtual bool canStartNew() const = 0;
    virtual Selection selection() const = 0;
    virtual PrimaryAction toggleAction() const = 0;
    // True when a request was sent.
    virtual bool toggle() = 0;

Q_SIGNALS:
    void changed();
};

}
