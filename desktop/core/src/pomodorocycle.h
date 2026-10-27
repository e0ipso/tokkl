#pragma once

#include "snap.h"

#include <QDateTime>
#include <QString>
#include <QStringView>

#include <optional>

namespace Tokkl
{

// The Pomodoro cycle: work phases separated by short rests, with a long rest
// after every few work phases. A phase changes only when the user confirms
// Next phase. Confirming before the planned end skips the rest of the phase;
// a phase confirmed after it has run overtime. The rules match
// packages/common/pomodoroSession.ts and its shared fixtures.
//
// These functions read no clock and keep no state; the caller passes every
// instant. Each returns nullopt for an argument outside its domain.
//
// A pomodoro is a work phase plus the rest after it. Its time entry runs from
// the work start to the next confirmed work start, or to the instant the
// session ends. The next pomodoro starts at the previous one's exact,
// unsnapped end, so their snapped entries share a boundary.

// The inclusive range of whole numbers a config value accepts.
struct PomodoroRange {
    int min = 0;
    int max = 0;

    constexpr bool contains(int value) const
    {
        return value >= min && value <= max;
    }
};

struct PomodoroConfig {
    static constexpr PomodoroRange workMinutesRange{1, 180};
    static constexpr PomodoroRange shortRestMinutesRange{1, 60};
    static constexpr PomodoroRange longRestMinutesRange{1, 60};
    static constexpr PomodoroRange longRestEveryRange{1, 12};

    // Phase lengths in whole minutes.
    int workMinutes = 25;
    int shortRestMinutes = 5;
    int longRestMinutes = 15;
    // A long rest follows every this many ended work phases.
    int longRestEvery = 4;

    // True when every value is inside its range.
    bool isValid() const;

    bool operator==(const PomodoroConfig &other) const = default;
};

enum class PhaseKind {
    Work,
    ShortRest,
    LongRest,
};

enum class TransitionKind {
    WorkToShortRest,
    ShortRestToWork,
    WorkToLongRest,
    LongRestToWork,
};

// The names the web app and the fixtures use: "work", "shortRest",
// "workToShortRest" and so on. The parsers return nullopt for any other text.
QString phaseKindName(PhaseKind kind);
std::optional<PhaseKind> parsePhaseKind(QStringView name);
QString transitionKindName(TransitionKind kind);
std::optional<TransitionKind> parseTransitionKind(QStringView name);

struct SessionPhase {
    PhaseKind kind = PhaseKind::Work;
    // The session start or the instant the previous phase was confirmed.
    QDateTime startedAt;
    // Work phases ended since the session started or the last long rest
    // ended. A work phase counts the ones before it; a rest counts the work
    // phase it follows.
    int completed = 0;

    bool operator==(const SessionPhase &other) const = default;
};

struct PhaseChange {
    SessionPhase next;
    TransitionKind transition = TransitionKind::WorkToShortRest;
    // True when the phase was confirmed before its planned end.
    bool skipped = false;

    bool operator==(const PhaseChange &other) const = default;
};

// The first phase of a session started at at: a work phase with no ended
// work phases before it.
std::optional<SessionPhase> startSession(const QDateTime &at);

// The instant phase reaches its planned length.
std::optional<QDateTime> plannedEnd(const SessionPhase &phase, const PomodoroConfig &config = {});

// Seconds phase has run past its planned end at at, or zero until then.
// Fractional when the instants carry milliseconds.
std::optional<double> overtimeSeconds(const SessionPhase &phase, const QDateTime &at, const PomodoroConfig &config = {});

// The transition that ends phase. A work phase that brings the count up to
// longRestEvery, or past it after the setting was lowered, is followed by a
// long rest; any other by a short rest. Every rest is followed by work.
std::optional<TransitionKind> transitionKind(const SessionPhase &phase, const PomodoroConfig &config = {});

// The phase that starts when the user confirms Next phase at at, which must
// not be before the phase start. An ended work phase counts toward the long
// rest whether skipped or not, and the count starts again from zero after a
// long rest.
std::optional<PhaseChange> nextPhase(const SessionPhase &phase, const QDateTime &at, const PomodoroConfig &config = {});

// The time entry of a pomodoro from start to end, snapped as snapSpan does,
// with the same inner nullopt for a span too short to keep.
std::optional<std::optional<SnappedSpan>> pomodoroEntrySpan(const QDateTime &start, const QDateTime &end, int minutes, const QString &timeZone);

}
