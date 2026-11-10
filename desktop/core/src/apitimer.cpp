#include "apitypes.h"

#include "apijson.h"

#include <QJsonArray>
#include <QJsonDocument>

namespace Tokkl
{

using namespace Json;

namespace
{
std::optional<PhaseKind> phaseKind(const QJsonValue &value)
{
    return value.isString() ? parsePhaseKind(value.toString()) : std::nullopt;
}

std::optional<TimeEntry> runningEntry(const QJsonValue &value)
{
    std::optional<TimeEntry> entry = decodeTimeEntry(value);
    if (!entry || !entry->isRunning()) {
        return std::nullopt;
    }
    return entry;
}

std::optional<TimerPause> timerPause(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    TimerPause pause;
    const QJsonValue paused = object.value(QLatin1String("paused"));
    const std::optional<qint64> seconds = integer(object.value(QLatin1String("seconds")));
    const std::optional<qint64> workspace = positiveId(object.value(QLatin1String("workspace_id")));
    if (!paused.isBool() || !seconds || *seconds < 0 || !workspace) {
        return std::nullopt;
    }
    pause.paused = paused.toBool();
    pause.seconds = *seconds;
    pause.workspaceId = *workspace;
    if (!optionalString(object.value(QLatin1String("description")), pause.description)
        || !nullableId(object.value(QLatin1String("project_id")), pause.projectId) || !nullableId(object.value(QLatin1String("task_id")), pause.taskId)
        || !optionalBool(object.value(QLatin1String("billable")), pause.billable, false)
        || !nullableId(object.value(QLatin1String("clone_entry_id")), pause.cloneEntryId)) {
        return std::nullopt;
    }
    const QJsonValue tagIds = object.value(QLatin1String("tag_ids"));
    if (!tagIds.isArray()) {
        return std::nullopt;
    }
    for (const QJsonValue &item : tagIds.toArray()) {
        const std::optional<qint64> id = positiveId(item);
        if (!id) {
            return std::nullopt;
        }
        pause.tagIds.append(*id);
    }
    const QJsonValue tags = object.value(QLatin1String("tags"));
    if (!tags.isArray()) {
        return std::nullopt;
    }
    for (const QJsonValue &tag : tags.toArray()) {
        if (!tag.isString()) {
            return std::nullopt;
        }
        pause.tags.append(tag.toString());
    }
    return pause;
}

std::optional<TimerPomodoro> timerPomodoro(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    const QJsonObject phaseObject = object.value(QLatin1String("phase")).toObject();
    const std::optional<int> work = count(object.value(QLatin1String("work_minutes")), 1);
    const std::optional<int> shortRest = count(object.value(QLatin1String("short_rest_minutes")), 1);
    const std::optional<int> longRest = count(object.value(QLatin1String("long_rest_minutes")), 1);
    const std::optional<int> every = count(object.value(QLatin1String("long_rest_every")), 1);
    const std::optional<PhaseKind> kind = phaseKind(phaseObject.value(QLatin1String("kind")));
    const std::optional<QDateTime> phaseStart = timestamp(phaseObject.value(QLatin1String("start")));
    const std::optional<int> completed = count(phaseObject.value(QLatin1String("completed")), 0);
    const std::optional<QDateTime> plannedEnd = timestamp(phaseObject.value(QLatin1String("planned_end")));
    const std::optional<PhaseKind> upcoming = phaseKind(object.value(QLatin1String("upcoming_phase")));
    const QJsonValue transitionName = object.value(QLatin1String("transition"));
    const std::optional<TransitionKind> transition = transitionName.isString() ? parseTransitionKind(transitionName.toString()) : std::nullopt;
    const std::optional<int> number = count(object.value(QLatin1String("number")), 1);
    const std::optional<qint64> entry = positiveId(object.value(QLatin1String("entry_id")));
    const std::optional<QDateTime> pomodoroStart = timestamp(object.value(QLatin1String("pomodoro_start")));
    if (!work || !shortRest || !longRest || !every || !kind || !phaseStart || !completed || !plannedEnd || !upcoming || !transition || !number || !entry
        || !pomodoroStart) {
        return std::nullopt;
    }
    TimerPomodoro pomodoro;
    // Each length is at least 1; the server checked it against its own
    // limits when the session started.
    pomodoro.config = PomodoroConfig{*work, *shortRest, *longRest, *every};
    pomodoro.phase = TimerPomodoroPhase{*kind, *phaseStart, *completed, *plannedEnd};
    pomodoro.upcomingPhase = *upcoming;
    pomodoro.transition = *transition;
    pomodoro.number = *number;
    pomodoro.entryId = *entry;
    pomodoro.pomodoroStart = *pomodoroStart;
    return pomodoro;
}

std::optional<DiscardedPomodoro> discardedPomodoro(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    const std::optional<qint64> entry = positiveId(object.value(QLatin1String("entry_id")));
    const std::optional<QDateTime> start = timestamp(object.value(QLatin1String("start")));
    const std::optional<QDateTime> stop = timestamp(object.value(QLatin1String("stop")));
    if (!entry || !start || !stop) {
        return std::nullopt;
    }
    return DiscardedPomodoro{*entry, *start, *stop};
}
}

std::optional<TimerState> decodeTimerState(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    TimerState state;
    const std::optional<qint64> revision = integer(object.value(QLatin1String("revision")));
    const std::optional<QDateTime> serverTime = timestamp(object.value(QLatin1String("server_time")));
    if (!revision || *revision < 0 || !serverTime) {
        return std::nullopt;
    }
    state.revision = *revision;
    state.serverTime = *serverTime;
    if (!nullable(object, QLatin1String("running_entry"), &runningEntry, state.runningEntry)
        || !nullable(object, QLatin1String("pause"), &timerPause, state.pause)
        || !nullable(object, QLatin1String("pomodoro"), &timerPomodoro, state.pomodoro)
        || !nullable(object, QLatin1String("discarded_pomodoro"), &discardedPomodoro, state.discardedPomodoro)) {
        return std::nullopt;
    }
    return state;
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

QByteArray encodeRevision(qint64 revision)
{
    return QJsonDocument(QJsonObject{{QStringLiteral("revision"), revision}}).toJson(QJsonDocument::Compact);
}

QByteArray encodePomodoroStart(const PomodoroStart &start, qint64 workspaceId, const QString &createdWith, qint64 revision)
{
    QJsonObject object{
        {QStringLiteral("created_with"), createdWith},
        {QStringLiteral("description"), start.description},
        {QStringLiteral("workspace_id"), workspaceId},
        {QStringLiteral("project_id"), idJson(start.projectId)},
    };
    if (start.billable) {
        object.insert(QStringLiteral("billable"), *start.billable);
    }
    object.insert(QStringLiteral("revision"), revision);
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

}
