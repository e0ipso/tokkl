#include "apitypes.h"

#include "transport.h"

#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <limits>

namespace Tokkl
{

namespace
{
QString tr(const char *text)
{
    return QCoreApplication::translate("Tokkl::Api", text);
}

constexpr qint64 noInteger = std::numeric_limits<qint64>::min();

std::optional<qint64> integer(const QJsonValue &value)
{
    if (!value.isDouble()) {
        return std::nullopt;
    }
    const qint64 result = value.toInteger(noInteger);
    if (result == noInteger) {
        return std::nullopt;
    }
    return result;
}

std::optional<qint64> positiveId(const QJsonValue &value)
{
    const std::optional<qint64> id = integer(value);
    if (!id || *id <= 0) {
        return std::nullopt;
    }
    return id;
}

// Missing and null both mean "none"; anything else must be a positive id.
bool nullableId(const QJsonValue &value, std::optional<qint64> &out)
{
    if (value.isUndefined() || value.isNull()) {
        out.reset();
        return true;
    }
    out = positiveId(value);
    return out.has_value();
}

bool optionalString(const QJsonValue &value, QString &out)
{
    if (value.isUndefined() || value.isNull()) {
        out.clear();
        return true;
    }
    if (!value.isString()) {
        return false;
    }
    out = value.toString();
    return true;
}

bool optionalBool(const QJsonValue &value, bool &out, bool fallback)
{
    if (value.isUndefined() || value.isNull()) {
        out = fallback;
        return true;
    }
    if (!value.isBool()) {
        return false;
    }
    out = value.toBool();
    return true;
}

std::optional<QDateTime> timestamp(const QJsonValue &value)
{
    if (!value.isString()) {
        return std::nullopt;
    }
    const QDateTime result = QDateTime::fromString(value.toString(), Qt::ISODateWithMs);
    if (!result.isValid()) {
        return std::nullopt;
    }
    return result;
}

// A whole number from min up, as an int.
std::optional<int> count(const QJsonValue &value, int min)
{
    const std::optional<qint64> number = integer(value);
    if (!number || *number < min || *number > std::numeric_limits<int>::max()) {
        return std::nullopt;
    }
    return int(*number);
}

std::optional<PhaseKind> phaseKind(const QJsonValue &value)
{
    return value.isString() ? parsePhaseKind(value.toString()) : std::nullopt;
}

// A key that must be present: false when it is missing. A null value leaves
// out empty; anything else must decode.
template<typename T>
bool nullable(const QJsonObject &object, QLatin1String key, std::optional<T> (*decode)(const QJsonValue &), std::optional<T> &out)
{
    const QJsonValue value = object.value(key);
    if (value.isUndefined()) {
        return false;
    }
    if (value.isNull()) {
        out.reset();
        return true;
    }
    out = decode(value);
    return out.has_value();
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
    pomodoro.config = PomodoroConfig{*work, *shortRest, *longRest, *every};
    if (!pomodoro.config.isValid()) {
        return std::nullopt;
    }
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

QVariant idVariant(const std::optional<qint64> &id)
{
    return id ? QVariant(*id) : QVariant::fromValue(nullptr);
}

QJsonValue idJson(const std::optional<qint64> &id)
{
    return id ? QJsonValue(*id) : QJsonValue(QJsonValue::Null);
}

QString utcTimestamp(const QDateTime &time)
{
    return time.toUTC().toString(Qt::ISODate);
}

// A server message fit for display: one line, bounded length.
QString serverMessage(const QByteArray &body)
{
    const std::optional<QJsonValue> value = parseJsonBody(body);
    if (!value || !value->isString()) {
        return QString();
    }
    QString message = value->toString().simplified();
    if (message.size() > 300) {
        message = message.left(300) + QStringLiteral("…");
    }
    return message;
}

QString redirectTarget(const QByteArray &location)
{
    const QUrl url(QString::fromLatin1(location));
    if (!url.isValid() || url.isRelative() || url.host().isEmpty()) {
        return tr("another address");
    }
    return url.adjusted(QUrl::RemoveUserInfo | QUrl::RemovePath | QUrl::RemoveQuery | QUrl::RemoveFragment).toString();
}

// The preferences that hold the Pomodoro lengths: the config value each one
// fills, the range the server accepts and the change that sets it.
struct PomodoroPreference {
    PomodoroField field;
    QLatin1String key;
    int PomodoroConfig::*value;
    PomodoroRange range;
    std::optional<int> PomodoroConfigUpdate::*change;
};

const PomodoroPreference pomodoroPreferences[] = {
    {PomodoroField::WorkMinutes,
     QLatin1String("pomodoro_focus_interval_in_minutes"),
     &PomodoroConfig::workMinutes,
     PomodoroConfig::workMinutesRange,
     &PomodoroConfigUpdate::workMinutes},
    {PomodoroField::ShortRestMinutes,
     QLatin1String("pomodoro_break_interval_in_minutes"),
     &PomodoroConfig::shortRestMinutes,
     PomodoroConfig::shortRestMinutesRange,
     &PomodoroConfigUpdate::shortRestMinutes},
    {PomodoroField::LongRestMinutes,
     QLatin1String("pomodoro_long_break_interval_in_minutes"),
     &PomodoroConfig::longRestMinutes,
     PomodoroConfig::longRestMinutesRange,
     &PomodoroConfigUpdate::longRestMinutes},
    {PomodoroField::LongRestEvery,
     QLatin1String("pomodoro_long_break_every"),
     &PomodoroConfig::longRestEvery,
     PomodoroConfig::longRestEveryRange,
     &PomodoroConfigUpdate::longRestEvery},
};
}

QVariantMap Me::toVariantMap() const
{
    return {
        {QStringLiteral("id"), id},
        {QStringLiteral("email"), email},
        {QStringLiteral("fullname"), fullname},
        {QStringLiteral("timezone"), timezone},
        {QStringLiteral("defaultWorkspaceId"), defaultWorkspaceId},
        {QStringLiteral("beginningOfWeek"), beginningOfWeek},
        {QStringLiteral("timeResolutionMinutes"), timeResolutionMinutes},
    };
}

QVariantMap Project::toVariantMap() const
{
    return {
        {QStringLiteral("id"), id},
        {QStringLiteral("workspaceId"), workspaceId},
        {QStringLiteral("clientId"), idVariant(clientId)},
        {QStringLiteral("clientName"), clientName},
        {QStringLiteral("name"), name},
        {QStringLiteral("color"), color},
        {QStringLiteral("active"), active},
        {QStringLiteral("billable"), billable},
    };
}

QVariantMap TimeEntry::toVariantMap() const
{
    return {
        {QStringLiteral("id"), id},
        {QStringLiteral("workspaceId"), workspaceId},
        {QStringLiteral("projectId"), idVariant(projectId)},
        {QStringLiteral("taskId"), idVariant(taskId)},
        {QStringLiteral("billable"), billable},
        {QStringLiteral("start"), start},
        {QStringLiteral("stop"), stop ? QVariant(*stop) : QVariant::fromValue(nullptr)},
        {QStringLiteral("duration"), duration},
        {QStringLiteral("description"), description},
        {QStringLiteral("tags"), tags},
        {QStringLiteral("running"), isRunning()},
    };
}

std::optional<QJsonValue> parseJsonBody(const QByteArray &body)
{
    // QJsonDocument only accepts an object or array at the top level, so wrap
    // the body in one and require exactly one element.
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(QByteArrayLiteral("[") + body + QByteArrayLiteral("\n]"), &error);
    if (error.error != QJsonParseError::NoError || !document.isArray() || document.array().size() != 1) {
        return std::nullopt;
    }
    return document.array().first();
}

std::optional<Me> decodeMe(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    Me me;
    const std::optional<qint64> id = positiveId(object.value(QLatin1String("id")));
    const std::optional<qint64> workspace = positiveId(object.value(QLatin1String("default_workspace_id")));
    if (!id || !workspace || !object.value(QLatin1String("email")).isString()) {
        return std::nullopt;
    }
    me.id = *id;
    me.defaultWorkspaceId = *workspace;
    me.email = object.value(QLatin1String("email")).toString();
    if (!optionalString(object.value(QLatin1String("fullname")), me.fullname) || !optionalString(object.value(QLatin1String("timezone")), me.timezone)) {
        return std::nullopt;
    }
    const QJsonValue week = object.value(QLatin1String("beginning_of_week"));
    if (!week.isUndefined() && !week.isNull()) {
        const std::optional<qint64> day = integer(week);
        if (!day || *day < 0 || *day > 6) {
            return std::nullopt;
        }
        me.beginningOfWeek = int(*day);
    }
    // The server snaps on write as well, so an unusable value does not refuse
    // the account.
    const std::optional<qint64> resolution = integer(object.value(QLatin1String("time_resolution_minutes")));
    me.timeResolutionMinutes = resolution && isTimeResolution(*resolution) ? int(*resolution) : 1;
    return me;
}

std::optional<Project> decodeProject(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    Project project;
    const std::optional<qint64> id = positiveId(object.value(QLatin1String("id")));
    const std::optional<qint64> workspace = positiveId(object.value(QLatin1String("workspace_id")));
    if (!id || !workspace || !object.value(QLatin1String("name")).isString()) {
        return std::nullopt;
    }
    project.id = *id;
    project.workspaceId = *workspace;
    project.name = object.value(QLatin1String("name")).toString();
    if (!nullableId(object.value(QLatin1String("client_id")), project.clientId)
        || !optionalString(object.value(QLatin1String("client_name")), project.clientName)
        || !optionalString(object.value(QLatin1String("color")), project.color)
        || !optionalBool(object.value(QLatin1String("active")), project.active, true)
        || !optionalBool(object.value(QLatin1String("billable")), project.billable, false)) {
        return std::nullopt;
    }
    return project;
}

std::optional<QList<Project>> decodeProjects(const QJsonValue &value)
{
    if (!value.isArray()) {
        return std::nullopt;
    }
    QList<Project> projects;
    for (const QJsonValue &item : value.toArray()) {
        std::optional<Project> project = decodeProject(item);
        if (!project) {
            return std::nullopt;
        }
        projects.append(std::move(*project));
    }
    return projects;
}

std::optional<TimeEntry> decodeTimeEntry(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    TimeEntry entry;
    const std::optional<qint64> id = positiveId(object.value(QLatin1String("id")));
    const std::optional<qint64> workspace = positiveId(object.value(QLatin1String("workspace_id")));
    const std::optional<QDateTime> start = timestamp(object.value(QLatin1String("start")));
    const std::optional<qint64> duration = integer(object.value(QLatin1String("duration")));
    if (!id || !workspace || !start || !duration) {
        return std::nullopt;
    }
    entry.id = *id;
    entry.workspaceId = *workspace;
    entry.start = *start;
    entry.duration = *duration;

    const QJsonValue stop = object.value(QLatin1String("stop"));
    if (!stop.isUndefined() && !stop.isNull()) {
        entry.stop = timestamp(stop);
        if (!entry.stop) {
            return std::nullopt;
        }
    }
    if (!nullableId(object.value(QLatin1String("project_id")), entry.projectId) || !nullableId(object.value(QLatin1String("task_id")), entry.taskId)
        || !optionalString(object.value(QLatin1String("description")), entry.description)
        || !optionalBool(object.value(QLatin1String("billable")), entry.billable, false)) {
        return std::nullopt;
    }
    const QJsonValue tags = object.value(QLatin1String("tags"));
    if (tags.isArray()) {
        for (const QJsonValue &tag : tags.toArray()) {
            if (!tag.isString()) {
                return std::nullopt;
            }
            entry.tags.append(tag.toString());
        }
    } else if (!tags.isUndefined() && !tags.isNull()) {
        return std::nullopt;
    }
    return entry;
}

std::optional<QList<TimeEntry>> decodeTimeEntries(const QJsonValue &value)
{
    if (!value.isArray()) {
        return std::nullopt;
    }
    QList<TimeEntry> entries;
    for (const QJsonValue &item : value.toArray()) {
        std::optional<TimeEntry> entry = decodeTimeEntry(item);
        if (!entry) {
            return std::nullopt;
        }
        entries.append(std::move(*entry));
    }
    return entries;
}

std::optional<std::optional<TimeEntry>> decodeCurrentEntry(const QJsonValue &value)
{
    if (value.isNull()) {
        return std::optional<TimeEntry>();
    }
    std::optional<TimeEntry> entry = decodeTimeEntry(value);
    if (!entry) {
        return std::nullopt;
    }
    return entry;
}

std::optional<QList<ListedEntry>> decodeListedEntries(const QJsonValue &value)
{
    if (!value.isArray()) {
        return std::nullopt;
    }
    QList<ListedEntry> entries;
    for (const QJsonValue &item : value.toArray()) {
        ListedEntry listed;
        std::optional<TimeEntry> entry = decodeTimeEntry(item);
        const QJsonObject object = item.toObject();
        if (!entry || !optionalBool(object.value(QLatin1String("project_active")), listed.projectActive, false)
            || !optionalBool(object.value(QLatin1String("project_billable")), listed.projectBillable, false)) {
            return std::nullopt;
        }
        listed.entry = std::move(*entry);
        entries.append(std::move(listed));
    }
    return entries;
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

ApiError errorFromResponse(const HttpResponse &response)
{
    ApiError error;
    switch (response.outcome) {
    case HttpResponse::Outcome::Timeout:
        error.kind = ApiError::Kind::Timeout;
        error.message = tr("The Tokkl instance did not answer in time.");
        return error;
    case HttpResponse::Outcome::NetworkError:
    case HttpResponse::Outcome::Aborted:
        error.kind = ApiError::Kind::Network;
        error.message = response.errorString.isEmpty() ? tr("Could not reach the Tokkl instance.")
                                                        : tr("Could not reach the Tokkl instance: %1").arg(response.errorString);
        return error;
    case HttpResponse::Outcome::Finished:
        break;
    }

    error.status = response.status;
    const QString message = serverMessage(response.body);
    if (response.status >= 300 && response.status < 400) {
        error.kind = ApiError::Kind::Redirect;
        error.message = tr("The instance redirected the request to %1. Enter the final address as the instance URL.").arg(redirectTarget(response.location));
    } else if (response.status == 401) {
        error.kind = ApiError::Kind::Unauthorized;
        error.message = message.isEmpty() ? tr("The instance did not accept these credentials.") : message;
    } else if (response.status == 403) {
        error.kind = ApiError::Kind::Forbidden;
        error.message = message.isEmpty() ? tr("The instance refused the request.") : message;
    } else if (response.status == 429) {
        error.kind = ApiError::Kind::RateLimited;
        error.message = message.isEmpty() ? tr("Too many attempts. Try again later.") : message;
    } else if (response.status >= 500) {
        error.kind = ApiError::Kind::Server;
        error.message = tr("The Tokkl instance had an error (HTTP %1).").arg(response.status);
    } else if (response.status >= 400) {
        error.kind = ApiError::Kind::Client;
        error.message = message.isEmpty() ? tr("The instance rejected the request (HTTP %1).").arg(response.status) : message;
    } else {
        error.kind = ApiError::Kind::InvalidResponse;
        error.message = tr("The instance sent an unexpected response (HTTP %1).").arg(response.status);
    }
    return error;
}

QByteArray encodeStartEntry(const StartEntry &entry, qint64 workspaceId, const QString &createdWith)
{
    QJsonObject object{
        {QStringLiteral("created_with"), createdWith},
        {QStringLiteral("description"), entry.description},
        {QStringLiteral("duration"), -1},
        {QStringLiteral("start"), utcTimestamp(entry.start)},
        {QStringLiteral("workspace_id"), workspaceId},
        {QStringLiteral("project_id"), idJson(entry.projectId)},
    };
    if (entry.taskId) {
        object.insert(QStringLiteral("task_id"), *entry.taskId);
    }
    if (!entry.tags.isEmpty()) {
        object.insert(QStringLiteral("tags"), QJsonArray::fromStringList(entry.tags));
    }
    if (entry.billable) {
        object.insert(QStringLiteral("billable"), *entry.billable);
    }
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

QByteArray encodeTimeEntryUpdate(const TimeEntryUpdate &update)
{
    QJsonObject object;
    if (update.description) {
        object.insert(QStringLiteral("description"), *update.description);
    }
    if (update.projectId) {
        object.insert(QStringLiteral("project_id"), idJson(*update.projectId));
    }
    if (update.taskId) {
        object.insert(QStringLiteral("task_id"), idJson(*update.taskId));
    }
    if (update.billable) {
        object.insert(QStringLiteral("billable"), *update.billable);
    }
    if (update.start) {
        object.insert(QStringLiteral("start"), utcTimestamp(*update.start));
    }
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
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

bool isTimeResolution(qint64 minutes)
{
    return minutes >= 1 && 60 % minutes == 0;
}

QString pomodoroPreferenceKey(PomodoroField field)
{
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        if (preference.field == field) {
            return preference.key;
        }
    }
    return QString();
}

std::optional<PomodoroConfig> decodePomodoroPreferences(const QJsonValue &value)
{
    if (!value.isObject()) {
        return std::nullopt;
    }
    const QJsonObject object = value.toObject();
    PomodoroConfig config;
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        const std::optional<qint64> minutes = integer(object.value(preference.key));
        if (minutes && *minutes >= preference.range.min && *minutes <= preference.range.max) {
            config.*preference.value = int(*minutes);
        }
    }
    return config;
}

QByteArray encodePomodoroConfigUpdate(const PomodoroConfigUpdate &update)
{
    QJsonObject object;
    for (const PomodoroPreference &preference : pomodoroPreferences) {
        if (const std::optional<int> value = update.*preference.change) {
            object.insert(preference.key, *value);
        }
    }
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

QByteArray encodeRevision(qint64 revision)
{
    return QJsonDocument(QJsonObject{{QStringLiteral("revision"), revision}}).toJson(QJsonDocument::Compact);
}

QByteArray encodePomodoroStart(const PomodoroStart &start, qint64 workspaceId, const QString &createdWith)
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
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

}
