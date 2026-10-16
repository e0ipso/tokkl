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

QByteArray encodeStartEntry(const StartEntry &entry, qint64 workspaceId)
{
    QJsonObject object{
        {QStringLiteral("created_with"), QStringLiteral("tokkl-kde")},
        {QStringLiteral("description"), entry.description},
        {QStringLiteral("duration"), -1},
        {QStringLiteral("start"), utcTimestamp(entry.start)},
        {QStringLiteral("workspace_id"), workspaceId},
        {QStringLiteral("project_id"), idJson(entry.projectId)},
    };
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

}
