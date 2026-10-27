#pragma once

#include "pomodorocycle.h"

#include <QByteArray>
#include <QDateTime>
#include <QList>
#include <QString>
#include <QTimeZone>

#include <optional>

namespace Tokkl
{

// What a device keeps for one owner (instance, account and workspace) in
// Pomodoro mode: the lengths last read from the server, the session, and the
// ended pomodoros not saved yet. A PomodoroStore holds it as JSON text with
// "version": 1, and instants in it are milliseconds since the epoch.
//
// Reading follows the web app's session storage: a record of another version
// or that is not JSON holds nothing, a broken session or cached config is
// none, and a broken queue item is skipped without dropping the others.

// A running session. Entries carry no description, tags or task.
struct PomodoroSessionRecord {
    QString id;
    // Counts the changes to the session.
    qint64 revision = 0;
    // The lengths the session started with.
    PomodoroConfig config;
    std::optional<qint64> projectId;
    bool billable = false;
    SessionPhase phase;
    // The exact start of the open pomodoro's work phase, kept through its
    // rest. It equals the phase start during work.
    QDateTime pomodoroStart;
    // The session has ended and its last pomodoro is in the queue.
    bool ending = false;

    bool operator==(const PomodoroSessionRecord &other) const = default;
};

// An ended pomodoro waiting to be saved as a stopped time entry.
struct UnsavedPomodoro {
    QString id;
    // The owner and workspace the entry belongs to.
    QString owner;
    qint64 workspaceId = 0;
    QDateTime start;
    QDateTime stop;
    // Whole seconds from start to stop.
    qint64 duration = 0;
    std::optional<qint64> projectId;
    bool billable = false;
    // Attempts made so far, and the earliest instant of the next one.
    int attempts = 0;
    QDateTime retryAt = QDateTime::fromMSecsSinceEpoch(0, QTimeZone::UTC);

    bool operator==(const UnsavedPomodoro &other) const = default;
};

struct PomodoroRecord {
    // The lengths last read from or saved to the server.
    std::optional<PomodoroConfig> config;
    std::optional<PomodoroSessionRecord> session;
    QList<UnsavedPomodoro> unsaved;

    bool isEmpty() const
    {
        return !config && !session && unsaved.isEmpty();
    }

    // Empty for an empty record, so saving it removes the stored one.
    QByteArray toJson() const;
    static PomodoroRecord fromJson(const QByteArray &json);

    bool operator==(const PomodoroRecord &other) const = default;
};

}
