#include "apitypes.h"

#include "apijson.h"

#include <QJsonArray>
#include <QJsonDocument>

#include <algorithm>

namespace Tokkl
{

using namespace Json;

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

QStringList ServerFloor::capabilities()
{
    return {
        QStringLiteral("app-preferences"),
        QStringLiteral("timer-actions"),
        QStringLiteral("pause-revision"),
        QStringLiteral("pomodoro-revision"),
        QStringLiteral("timer-edit-entry"),
        QStringLiteral("idempotency-keys"),
    };
}

bool ServerApi::isSupported() const
{
    if (version < ServerFloor::apiVersion || !pomodoroLimits) {
        return false;
    }
    const QStringList required = ServerFloor::capabilities();
    return std::all_of(required.cbegin(), required.cend(), [this](const QString &name) {
        return capabilities.contains(name);
    });
}

namespace
{
// One length of pomodoro_limits: {min, max, default}.
bool decodeLimit(const QJsonObject &limits, QLatin1String key, PomodoroRange &range, int &defaultValue)
{
    const QJsonObject limit = limits.value(key).toObject();
    const std::optional<int> min = count(limit.value(QLatin1String("min")), 1);
    const std::optional<int> max = count(limit.value(QLatin1String("max")), 1);
    const std::optional<int> value = count(limit.value(QLatin1String("default")), 1);
    if (!min || !max || !value || *min > *value || *value > *max) {
        return false;
    }
    range = PomodoroRange{*min, *max};
    defaultValue = *value;
    return true;
}

std::optional<PomodoroLimits> decodePomodoroLimits(const QJsonValue &value)
{
    const QJsonObject object = value.toObject();
    PomodoroLimits limits;
    if (!decodeLimit(object, QLatin1String("work_minutes"), limits.workMinutes, limits.defaults.workMinutes)
        || !decodeLimit(object, QLatin1String("short_rest_minutes"), limits.shortRestMinutes, limits.defaults.shortRestMinutes)
        || !decodeLimit(object, QLatin1String("long_rest_minutes"), limits.longRestMinutes, limits.defaults.longRestMinutes)
        || !decodeLimit(object, QLatin1String("long_rest_every"), limits.longRestEvery, limits.defaults.longRestEvery)) {
        return std::nullopt;
    }
    return limits;
}
}

PomodoroRange PomodoroLimits::range(PomodoroField field) const
{
    switch (field) {
    case PomodoroField::WorkMinutes:
        return workMinutes;
    case PomodoroField::ShortRestMinutes:
        return shortRestMinutes;
    case PomodoroField::LongRestMinutes:
        return longRestMinutes;
    case PomodoroField::LongRestEvery:
        return longRestEvery;
    }
    return {};
}

QVariantMap PomodoroLimits::toVariantMap() const
{
    const auto limit = [](PomodoroRange range, int value) {
        return QVariantMap{{QStringLiteral("min"), range.min}, {QStringLiteral("max"), range.max}, {QStringLiteral("default"), value}};
    };
    return {
        {QStringLiteral("workMinutes"), limit(workMinutes, defaults.workMinutes)},
        {QStringLiteral("shortRestMinutes"), limit(shortRestMinutes, defaults.shortRestMinutes)},
        {QStringLiteral("longRestMinutes"), limit(longRestMinutes, defaults.longRestMinutes)},
        {QStringLiteral("longRestEvery"), limit(longRestEvery, defaults.longRestEvery)},
    };
}

PomodoroLimits PomodoroLimits::placeholder()
{
    constexpr PomodoroRange any{1, 999};
    return PomodoroLimits{any, any, any, any, PomodoroConfig()};
}

ServerApi decodeServerApi(const QJsonObject &status)
{
    ServerApi server;
    server.pomodoroLimits = decodePomodoroLimits(status.value(QLatin1String("pomodoro_limits")));
    server.version = integer(status.value(QLatin1String("api_version"))).value_or(0);
    const QJsonArray names = status.value(QLatin1String("capabilities")).toArray();
    for (const QJsonValue &name : names) {
        if (name.isString()) {
            server.capabilities.append(name.toString());
        }
    }
    return server;
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
    // Only a delta read needs it; without it the catalog reads the whole
    // list each time.
    project.at = timestamp(object.value(QLatin1String("at"))).value_or(QDateTime());
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

namespace
{
QJsonObject startEntryObject(const StartEntry &entry, qint64 workspaceId, const QString &createdWith)
{
    QJsonObject object{
        {QStringLiteral("created_with"), createdWith},
        {QStringLiteral("description"), entry.description},
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
    return object;
}
}

QByteArray encodeTimerStart(qint64 revision, const StartEntry &entry, qint64 workspaceId, const QString &createdWith)
{
    QJsonObject object = startEntryObject(entry, workspaceId, createdWith);
    object.insert(QStringLiteral("revision"), revision);
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

QByteArray encodeTimerEdit(qint64 entryId, const TimeEntryUpdate &update)
{
    QJsonObject object = QJsonDocument::fromJson(encodeTimeEntryUpdate(update)).object();
    // The running entry's start is the timer's, not an edit's.
    object.remove(QStringLiteral("start"));
    object.insert(QStringLiteral("entry_id"), entryId);
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
}

bool isTimeResolution(qint64 minutes)
{
    return minutes >= 1 && 60 % minutes == 0;
}

}
