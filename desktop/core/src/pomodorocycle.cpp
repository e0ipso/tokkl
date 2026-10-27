#include "pomodorocycle.h"

#include <algorithm>
#include <limits>

namespace Tokkl
{

namespace
{
constexpr qint64 minuteMs = 60'000;

// A known kind, a valid start and a whole count of 0 or more. The count
// leaves room for the work phase that ends next.
bool isValid(const SessionPhase &phase)
{
    const bool knownKind = phase.kind == PhaseKind::Work || phase.kind == PhaseKind::ShortRest || phase.kind == PhaseKind::LongRest;
    return knownKind && phase.completed >= 0 && phase.completed < std::numeric_limits<int>::max() && phase.startedAt.isValid();
}

int phaseMinutes(PhaseKind kind, const PomodoroConfig &config)
{
    if (kind == PhaseKind::Work) {
        return config.workMinutes;
    }
    return kind == PhaseKind::ShortRest ? config.shortRestMinutes : config.longRestMinutes;
}
}

bool PomodoroConfig::isValid() const
{
    return workMinutesRange.contains(workMinutes) && shortRestMinutesRange.contains(shortRestMinutes) && longRestMinutesRange.contains(longRestMinutes)
        && longRestEveryRange.contains(longRestEvery);
}

QString phaseKindName(PhaseKind kind)
{
    switch (kind) {
    case PhaseKind::Work:
        return QStringLiteral("work");
    case PhaseKind::ShortRest:
        return QStringLiteral("shortRest");
    case PhaseKind::LongRest:
        return QStringLiteral("longRest");
    }
    return QString();
}

std::optional<PhaseKind> parsePhaseKind(QStringView name)
{
    for (const PhaseKind kind : {PhaseKind::Work, PhaseKind::ShortRest, PhaseKind::LongRest}) {
        if (name == phaseKindName(kind)) {
            return kind;
        }
    }
    return std::nullopt;
}

QString transitionKindName(TransitionKind kind)
{
    switch (kind) {
    case TransitionKind::WorkToShortRest:
        return QStringLiteral("workToShortRest");
    case TransitionKind::ShortRestToWork:
        return QStringLiteral("shortRestToWork");
    case TransitionKind::WorkToLongRest:
        return QStringLiteral("workToLongRest");
    case TransitionKind::LongRestToWork:
        return QStringLiteral("longRestToWork");
    }
    return QString();
}

std::optional<TransitionKind> parseTransitionKind(QStringView name)
{
    for (const TransitionKind kind :
         {TransitionKind::WorkToShortRest, TransitionKind::ShortRestToWork, TransitionKind::WorkToLongRest, TransitionKind::LongRestToWork}) {
        if (name == transitionKindName(kind)) {
            return kind;
        }
    }
    return std::nullopt;
}

std::optional<SessionPhase> startSession(const QDateTime &at)
{
    if (!at.isValid()) {
        return std::nullopt;
    }
    return SessionPhase{PhaseKind::Work, at, 0};
}

std::optional<QDateTime> plannedEnd(const SessionPhase &phase, const PomodoroConfig &config)
{
    if (!config.isValid() || !isValid(phase)) {
        return std::nullopt;
    }
    return phase.startedAt.addMSecs(phaseMinutes(phase.kind, config) * minuteMs);
}

std::optional<double> overtimeSeconds(const SessionPhase &phase, const QDateTime &at, const PomodoroConfig &config)
{
    const std::optional<QDateTime> end = plannedEnd(phase, config);
    if (!at.isValid() || !end) {
        return std::nullopt;
    }
    return std::max(0.0, double(end->msecsTo(at)) / 1000.0);
}

std::optional<TransitionKind> transitionKind(const SessionPhase &phase, const PomodoroConfig &config)
{
    if (!config.isValid() || !isValid(phase)) {
        return std::nullopt;
    }
    switch (phase.kind) {
    case PhaseKind::Work:
        return phase.completed + 1 >= config.longRestEvery ? TransitionKind::WorkToLongRest : TransitionKind::WorkToShortRest;
    case PhaseKind::ShortRest:
        return TransitionKind::ShortRestToWork;
    case PhaseKind::LongRest:
        return TransitionKind::LongRestToWork;
    }
    return std::nullopt;
}

std::optional<PhaseChange> nextPhase(const SessionPhase &phase, const QDateTime &at, const PomodoroConfig &config)
{
    const std::optional<TransitionKind> transition = transitionKind(phase, config);
    const std::optional<QDateTime> end = plannedEnd(phase, config);
    if (!transition || !end || !at.isValid() || at < phase.startedAt) {
        return std::nullopt;
    }
    const bool skipped = at < *end;
    SessionPhase next;
    if (*transition == TransitionKind::WorkToShortRest) {
        next = {PhaseKind::ShortRest, at, phase.completed + 1};
    } else if (*transition == TransitionKind::WorkToLongRest) {
        next = {PhaseKind::LongRest, at, phase.completed + 1};
    } else {
        next = {PhaseKind::Work, at, *transition == TransitionKind::LongRestToWork ? 0 : phase.completed};
    }
    return PhaseChange{next, *transition, skipped};
}

std::optional<std::optional<SnappedSpan>> pomodoroEntrySpan(const QDateTime &start, const QDateTime &end, int minutes, const QString &timeZone)
{
    return snapSpan(start, end, minutes, timeZone);
}

}
