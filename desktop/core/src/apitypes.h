#pragma once

#include "pomodorocycle.h"

#include <QDateTime>
#include <QJsonValue>
#include <QList>
#include <QString>
#include <QStringList>
#include <QVariantMap>

#include <optional>

namespace Tokkl
{

struct HttpResponse;

// GET /api/v9/me. The response also carries api_token, which is a credential
// and is deliberately not decoded.
struct Me {
    qint64 id = 0;
    QString email;
    QString fullname;
    QString timezone;
    qint64 defaultWorkspaceId = 0;
    int beginningOfWeek = 1;
    // The step, in minutes, of the clock grid entries snap to. It divides an
    // hour; a missing or invalid value reads as 1.
    int timeResolutionMinutes = 1;

    QVariantMap toVariantMap() const;
};

struct Project {
    qint64 id = 0;
    qint64 workspaceId = 0;
    std::optional<qint64> clientId;
    QString clientName;
    QString name;
    QString color;
    bool active = true;
    bool billable = false;

    QVariantMap toVariantMap() const;
};

struct TimeEntry {
    qint64 id = 0;
    qint64 workspaceId = 0;
    std::optional<qint64> projectId;
    std::optional<qint64> taskId;
    bool billable = false;
    QDateTime start;
    std::optional<QDateTime> stop; // empty while running
    qint64 duration = 0; // negative while running, as in Toggl
    QString description;
    QStringList tags;

    bool isRunning() const
    {
        return !stop.has_value();
    }

    QVariantMap toVariantMap() const;
};

// An entry of GET /me/time_entries?meta=true with the project flags the meta
// parameter adds. Both are false for an entry without a project.
struct ListedEntry {
    TimeEntry entry;
    bool projectActive = false;
    bool projectBillable = false;
};

// Body of POST /workspaces/{wid}/time_entries for a running entry. A task and
// tags are sent only when set. Tags go by name, and the server creates a name
// the workspace lacks.
struct StartEntry {
    QDateTime start; // sent in UTC
    QString description;
    std::optional<qint64> projectId;
    std::optional<bool> billable;
    std::optional<qint64> taskId;
    QStringList tags;
};

// Fields to change with PUT /workspaces/{wid}/time_entries/{id}. Unset fields
// are left out of the request, so the server keeps them. A project or task of
// std::nullopt inside the outer optional is sent as null and clears it.
struct TimeEntryUpdate {
    std::optional<QString> description;
    std::optional<std::optional<qint64>> projectId;
    std::optional<std::optional<qint64>> taskId;
    std::optional<bool> billable;
    std::optional<QDateTime> start;
};

// The PomodoroConfig fields that GET and POST /api/v9/me/preferences hold,
// one key each.
enum class PomodoroField {
    WorkMinutes,
    ShortRestMinutes,
    LongRestMinutes,
    LongRestEvery,
};

// The preference key of field, such as "pomodoro_focus_interval_in_minutes".
QString pomodoroPreferenceKey(PomodoroField field);

// Pomodoro lengths to change with POST /api/v9/me/preferences. Unset fields
// are left out of the request. The server merges the posted keys into the
// stored preferences, so it keeps the unset ones and every other client's.
struct PomodoroConfigUpdate {
    std::optional<int> workMinutes;
    std::optional<int> shortRestMinutes;
    std::optional<int> longRestMinutes;
    std::optional<int> longRestEvery;

    bool isEmpty() const
    {
        return !workMinutes && !shortRestMinutes && !longRestMinutes && !longRestEvery;
    }
};

struct ApiError {
    enum class Kind {
        None,
        Network, // no HTTP answer
        Timeout,
        Server, // 5xx
        RateLimited, // 429, or a cooldown from an earlier 429
        Forbidden, // 403
        Unauthorized, // 401
        Redirect, // 3xx; redirects are not followed
        Client, // other 4xx
        InvalidResponse, // the body did not have the expected shape
        NotConnected, // no validated account for this request
        AuthenticationPaused, // an earlier /me 403 paused authentication
    };

    Kind kind = Kind::None;
    int status = 0;
    QString message; // for the user; never contains credentials

    // Connectivity problems, timeouts and server errors: the account may be
    // fine and cached data is only stale.
    bool isTransient() const
    {
        return kind == Kind::Network || kind == Kind::Timeout || kind == Kind::Server;
    }
};

template<typename T>
struct ApiResult {
    std::optional<T> value;
    ApiError error;

    bool ok() const
    {
        return value.has_value();
    }

    static ApiResult success(T v)
    {
        return ApiResult{std::move(v), ApiError()};
    }

    static ApiResult failure(ApiError e)
    {
        return ApiResult{std::nullopt, std::move(e)};
    }
};

// Decoders for the API's bare JSON bodies. Each returns nullopt when the
// value does not have the expected shape.
std::optional<Me> decodeMe(const QJsonValue &value);
std::optional<Project> decodeProject(const QJsonValue &value);
std::optional<QList<Project>> decodeProjects(const QJsonValue &value);
std::optional<TimeEntry> decodeTimeEntry(const QJsonValue &value);
// null for no running entry.
std::optional<std::optional<TimeEntry>> decodeCurrentEntry(const QJsonValue &value);
std::optional<QList<ListedEntry>> decodeListedEntries(const QJsonValue &value);
// The Pomodoro lengths in a preferences object. As on the server, a value
// that is missing, not an integer or out of its range reads as its default,
// one key at a time. nullopt only for a value that is not an object.
std::optional<PomodoroConfig> decodePomodoroPreferences(const QJsonValue &value);

// Parses a whole body as one JSON value, including bare null, strings and
// numbers that QJsonDocument alone rejects.
std::optional<QJsonValue> parseJsonBody(const QByteArray &body);

// The error a non-2xx or failed response stands for. The API sends errors as
// a bare JSON string.
ApiError errorFromResponse(const HttpResponse &response);

// createdWith names the client that starts the entry.
QByteArray encodeStartEntry(const StartEntry &entry, qint64 workspaceId, const QString &createdWith);
QByteArray encodeTimeEntryUpdate(const TimeEntryUpdate &update);
QByteArray encodePomodoroConfigUpdate(const PomodoroConfigUpdate &update);

}
