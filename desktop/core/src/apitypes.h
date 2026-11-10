#pragma once

#include <QDateTime>
#include <QJsonObject>
#include <QJsonValue>
#include <QObject>
#include <QList>
#include <QString>
#include <QStringList>
#include <QStringView>
#include <QVariantMap>

#include <optional>

namespace Tokkl
{

struct HttpResponse;

// Inclusive.
struct PomodoroRange {
    int min = 0;
    int max = 0;

    constexpr bool contains(int value) const
    {
        return value >= min && value <= max;
    }

    bool operator==(const PomodoroRange &other) const = default;
};

// These defaults show only until a server answers; the server's
// pomodoro_limits name its own.
struct PomodoroConfig {
    int workMinutes = 25;
    int shortRestMinutes = 5;
    int longRestMinutes = 15;
    // A long rest follows every this many ended work phases.
    int longRestEvery = 4;

    bool operator==(const PomodoroConfig &other) const = default;
};

enum class PomodoroField {
    WorkMinutes,
    ShortRestMinutes,
    LongRestMinutes,
    LongRestEvery,
};

// From pomodoro_limits in GET /api/app/status. The server checks every saved
// length against them; the client keeps no copy of its own.
struct PomodoroLimits {
    PomodoroRange workMinutes;
    PomodoroRange shortRestMinutes;
    PomodoroRange longRestMinutes;
    PomodoroRange longRestEvery;
    PomodoroConfig defaults;

    PomodoroRange range(PomodoroField field) const;
    QVariantMap toVariantMap() const;

    // Display only, before a server announced limits: ranges 1 to 999 and
    // PomodoroConfig's defaults. Nothing is checked against it.
    static PomodoroLimits placeholder();

    bool operator==(const PomodoroLimits &other) const = default;
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

// The API's names ("work", "workToShortRest", ...); parsers return nullopt
// for anything else.
QString phaseKindName(PhaseKind kind);
std::optional<PhaseKind> parsePhaseKind(QStringView name);
QString transitionKindName(TransitionKind kind);
std::optional<TransitionKind> parseTransitionKind(QStringView name);

// True for minute counts that divide an hour evenly.
bool isTimeResolution(qint64 minutes);

// api_version and capabilities from GET /api/app/status. Never pick a route
// from a 404: a current server also sends one for a missing project.
struct ServerApi {
    qint64 version = 0;
    // As announced, including names this client does not know.
    QStringList capabilities;
    std::optional<PomodoroLimits> pomodoroLimits;

    bool isSupported() const;

    bool operator==(const ServerApi &other) const = default;
};

// The oldest supported server: api_version 1 and every capability listed.
// No account binds against an older server.
struct ServerFloor {
    static constexpr qint64 apiVersion = 1;
    static QStringList capabilities();
};

// GET /api/v9/me. Its api_token is a credential and is never decoded.
struct Me {
    qint64 id = 0;
    QString email;
    QString fullname;
    QString timezone;
    qint64 defaultWorkspaceId = 0;
    int beginningOfWeek = 1;
    // Divides an hour; a missing or invalid value reads as 1.
    int timeResolutionMinutes = 1;

    QVariantMap toVariantMap() const;
    bool operator==(const Me &other) const = default;
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
    bool operator==(const Project &other) const = default;
};

struct ProjectList {
    QList<Project> projects;
    // projects is only a prefix of the workspace's active projects.
    bool incomplete = false;
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
    bool operator==(const TimeEntry &other) const = default;
};

// GET /api/app/time_entries/latest. Both flags are false without a project.
struct ListedEntry {
    TimeEntry entry;
    bool projectActive = false;
    bool projectBillable = false;
};

// Body of POST /api/app/timer/start. The server creates tag names the
// workspace lacks.
struct StartEntry {
    QDateTime start; // sent in UTC
    QString description;
    std::optional<qint64> projectId;
    std::optional<bool> billable;
    std::optional<qint64> taskId;
    QStringList tags;
};

// Unset fields stay out of the request, so the server keeps them. An inner
// std::nullopt project or task is sent as null and clears it.
struct TimeEntryUpdate {
    std::optional<QString> description;
    std::optional<std::optional<qint64>> projectId;
    std::optional<std::optional<qint64>> taskId;
    std::optional<bool> billable;
    std::optional<QDateTime> start;
};

// Lives from Pause until Discard, a non-resume start, or a stop of the
// resumed clone. Resume starts a clone with these fields.
struct TimerPause {
    bool paused = false; // true while no clone runs
    qint64 seconds = 0; // what the chain's stopped entries stored, after snapping
    qint64 workspaceId = 0;
    QString description;
    std::optional<qint64> projectId;
    std::optional<qint64> taskId;
    QList<qint64> tagIds; // in name order
    QStringList tags; // the names of tagIds, in the same order
    bool billable = false;
    std::optional<qint64> cloneEntryId; // empty while paused
};

struct TimerPomodoroPhase {
    PhaseKind kind = PhaseKind::Work;
    QDateTime start;
    // Work phases ended since the session start or the last long rest. A rest
    // counts the work phase it follows.
    int completed = 0;
    QDateTime plannedEnd; // a client rings from here on until the phase changes
};

// The open pomodoro is the running entry.
struct TimerPomodoro {
    PomodoroConfig config; // the lengths the session started with
    TimerPomodoroPhase phase;
    PhaseKind upcomingPhase = PhaseKind::ShortRest;
    TransitionKind transition = TransitionKind::WorkToShortRest;
    int number = 1; // N of config.longRestEvery
    qint64 entryId = 0;
    QDateTime pomodoroStart;
};

// Its stop trashed it with zero length on its snapped start.
struct DiscardedPomodoro {
    qint64 entryId = 0;
    QDateTime start;
    QDateTime stop;
};

// GET /api/app/timer, every timer action and its 409, and each timer event.
// Holds at most one of a pause chain and a Pomodoro session.
struct TimerState {
    // +1 on every change from any client; 0 before the first.
    qint64 revision = 0;
    QDateTime serverTime;
    std::optional<TimeEntry> runningEntry;
    std::optional<TimerPause> pause;
    std::optional<TimerPomodoro> pomodoro;
    // Discarded by the change to this revision.
    std::optional<DiscardedPomodoro> discardedPomodoro;
};

// The session takes the account's lengths and starts on the server's clock.
struct PomodoroStart {
    QString description;
    std::optional<qint64> projectId;
    std::optional<bool> billable;
};

QString pomodoroPreferenceKey(PomodoroField field);

// The server merges the posted keys into the stored preferences, keeping
// unset ones and every other client's.
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
        RateLimited, // 429, or a cooldown from an earlier 429 or 503 (asksToWait())
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
    // Tokkl-Error-Code and Tokkl-Error-Field headers; empty from older servers.
    QString code;
    QString field;

    // The account may be fine; cached data is only stale.
    bool isTransient() const
    {
        return kind == Kind::Network || kind == Kind::Timeout || kind == Kind::Server;
    }

    // The server may or may not have acted on the request.
    bool outcomeUnknown() const
    {
        return isTransient() || kind == Kind::InvalidResponse;
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

struct TimerActionResult {
    Q_GADGET

public:
    enum class Outcome {
        Applied, // the server made the change; state is the result
        Conflict, // a 409: the server refused it, and state is its current state
        Refused, // nothing changed: refused before sending, or an answer without a state
        Unknown, // no answer, a timeout, a 5xx or an unreadable answer; it may have happened
    };
    Q_ENUM(Outcome)

    Outcome outcome = Outcome::Unknown;
    std::optional<TimerState> state; // for Applied and Conflict
    ApiError error; // Kind::None for Applied
};

// Decoders return nullopt when the value does not have the expected shape.
std::optional<Me> decodeMe(const QJsonValue &value);
// Never fails: a missing or unreadable field reads as not announced. A limit
// reads only with integers where 1 <= min <= default <= max.
ServerApi decodeServerApi(const QJsonObject &status);
std::optional<Project> decodeProject(const QJsonValue &value);
std::optional<QList<Project>> decodeProjects(const QJsonValue &value);
std::optional<qint64> decodeCatalogRevision(const QJsonValue &value);
std::optional<TimeEntry> decodeTimeEntry(const QJsonValue &value);
std::optional<QList<TimeEntry>> decodeTimeEntries(const QJsonValue &value);
// null for no running entry.
std::optional<std::optional<TimeEntry>> decodeCurrentEntry(const QJsonValue &value);
// null for none.
std::optional<std::optional<ListedEntry>> decodeLatestEntry(const QJsonValue &value);
// As on the server, a missing, non-integer or out-of-range value reads as its
// default, key by key. nullopt only for a non-object.
std::optional<PomodoroConfig> decodePomodoroPreferences(const QJsonValue &value, const PomodoroLimits &limits);
// Every field must be present with its type (null means none), and a running
// entry must run.
std::optional<TimerState> decodeTimerState(const QJsonValue &value);

// Also accepts bare null, strings and numbers, which QJsonDocument rejects.
std::optional<QJsonValue> parseJsonBody(const QByteArray &body);

// The API sends errors as a bare JSON string.
ApiError errorFromResponse(const HttpResponse &response);

// A 429, or a 503 with Retry-After. A 503 without the header is a plain
// server error.
bool asksToWait(const HttpResponse &response);

// A 2xx that is not an account is InvalidResponse, with a message pointing at
// the instance URL.
ApiResult<Me> meFromResponse(const HttpResponse &response);

// Anything but a 2xx JSON object, such as an older server's 404, announces
// nothing.
ServerApi serverApiFromResponse(const HttpResponse &response);

QByteArray encodeTimerStart(qint64 revision, const StartEntry &entry, qint64 workspaceId, const QString &createdWith);
QByteArray encodeTimeEntryUpdate(const TimeEntryUpdate &update);
// Ignores update.start. The server refuses it with a 409 only once entryId
// has stopped, whatever else changed since.
QByteArray encodeTimerEdit(qint64 entryId, const TimeEntryUpdate &update);
QByteArray encodePomodoroConfigUpdate(const PomodoroConfigUpdate &update);
QByteArray encodeRevision(qint64 revision);
QByteArray encodePomodoroStart(const PomodoroStart &start, qint64 workspaceId, const QString &createdWith, qint64 revision);

}
