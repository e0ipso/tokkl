#include "apitypes.h"

#include "apijson.h"

#include <QJsonArray>
#include <QJsonDocument>

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
    me.server = decodeServerApi(object);
    return me;
}

ServerApi decodeServerApi(const QJsonObject &me)
{
    // An announcement it cannot read leaves the account usable, with the
    // routes of a server from before it.
    ServerApi server;
    server.version = integer(me.value(QLatin1String("api_version"))).value_or(0);
    const QJsonArray names = me.value(QLatin1String("capabilities")).toArray();
    for (const QJsonValue &name : names) {
        const QString text = name.toString();
        if (text == QLatin1String("app-preferences")) {
            server.appPreferences = true;
        } else if (text == QLatin1String("timer-actions")) {
            server.timerActions = true;
        } else if (text == QLatin1String("timer-edit")) {
            server.timerEdit = true;
        } else if (text == QLatin1String("pomodoro-revision")) {
            server.pomodoroRevision = true;
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

QByteArray encodeStartEntry(const StartEntry &entry, qint64 workspaceId, const QString &createdWith)
{
    QJsonObject object = startEntryObject(entry, workspaceId, createdWith);
    object.insert(QStringLiteral("duration"), -1);
    return QJsonDocument(object).toJson(QJsonDocument::Compact);
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

bool isTimeResolution(qint64 minutes)
{
    return minutes >= 1 && 60 % minutes == 0;
}

}
