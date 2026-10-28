#pragma once

#include <QDateTime>
#include <QJsonValue>
#include <QList>
#include <QString>
#include <QStringList>
#include <QStringView>
#include <QVariantMap>

#include <optional>

namespace Tokkl
{

struct HttpResponse;

// The inclusive range of whole numbers a Pomodoro length accepts.
struct PomodoroRange {
    int min = 0;
    int max = 0;

    constexpr bool contains(int value) const
    {
        return value >= min && value <= max;
    }
};

// The account's Pomodoro lengths, which a session keeps from its start.
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

// The change Next phase makes, which picks the sound that rings.
enum class TransitionKind {
    WorkToShortRest,
    ShortRestToWork,
    WorkToLongRest,
    LongRestToWork,
};

// The names the API and the web app use: "work", "shortRest",
// "workToShortRest" and so on. The parsers return nullopt for any other text.
QString phaseKindName(PhaseKind kind);
std::optional<PhaseKind> parsePhaseKind(QStringView name);
QString transitionKindName(TransitionKind kind);
std::optional<TransitionKind> parseTransitionKind(QStringView name);

// True for the time resolutions, in minutes, that divide an hour evenly: 1,
// 2, 3, 4, 5, 6, 10, 12, 15, 20, 30 and 60.
bool isTimeResolution(qint64 minutes);

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

// The pause chain of a timer state, from Pause until Discard, a start that is
// not a resume, or a stop of the resumed clone. Resume starts a clone with
// these fields.
struct TimerPause {
    bool paused = false; // true while no clone runs
    qint64 seconds = 0; // what the chain's stopped entries stored, after snapping
    qint64 workspaceId = 0;
    QString description;
    std::optional<qint64> projectId;
    std::optional<qint64> taskId;
    QList<qint64> tagIds; // the tags a resumed clone gets, in name order
    QStringList tags; // the names of tagIds, in the same order
    bool billable = false;
    std::optional<qint64> cloneEntryId; // the running clone; empty while paused
};

struct TimerPomodoroPhase {
    PhaseKind kind = PhaseKind::Work;
    QDateTime start; // the session start or the instant Next phase was confirmed
    // Work phases ended since the session started or the last long rest
    // ended. A rest counts the work phase it follows.
    int completed = 0;
    QDateTime plannedEnd; // a client rings from here on until the phase changes
};

// A Pomodoro session. Its open pomodoro is the running entry.
struct TimerPomodoro {
    PomodoroConfig config; // the lengths the session started with
    TimerPomodoroPhase phase;
    PhaseKind upcomingPhase = PhaseKind::ShortRest; // the phase Next phase starts
    TransitionKind transition = TransitionKind::WorkToShortRest; // the change Next phase makes
    int number = 1; // the pomodoro's place in the cycle, N of config.longRestEvery
    qint64 entryId = 0; // the open pomodoro, the running entry
    QDateTime pomodoroStart; // the running entry's start
};

// A pomodoro too short to keep. Its stop sent it to the trash with zero
// length on its snapped start.
struct DiscardedPomodoro {
    qint64 entryId = 0;
    QDateTime start;
    QDateTime stop;
};

// The account's timer: the body of GET /api/app/timer, of every timer action
// and of a 409 refusing one, and the data of each timer event. It holds at
// most one of a pause chain and a Pomodoro session.
struct TimerState {
    // Goes up by one on every change to the running entry, the pause chain or
    // the session, from any client. 0 before the first.
    qint64 revision = 0;
    QDateTime serverTime; // the server's clock when it built the state
    std::optional<TimeEntry> runningEntry;
    std::optional<TimerPause> pause;
    std::optional<TimerPomodoro> pomodoro;
    // The pomodoro that the change to this revision discarded, if any.
    std::optional<DiscardedPomodoro> discardedPomodoro;
};

// Body of POST /api/app/pomodoro. The session takes the account's Pomodoro
// lengths, and its first pomodoro starts on the server's clock.
struct PomodoroStart {
    QString description;
    std::optional<qint64> projectId;
    std::optional<bool> billable;
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

// How a timer action ended.
struct TimerActionResult {
    enum class Outcome {
        Applied, // the server made the change; state is the result
        Conflict, // a 409: the server refused it, and state is its current state
        Refused, // nothing changed: refused before sending, or an answer without a state
        Unknown, // no answer, a timeout, a 5xx or an unreadable answer; it may have happened
    };

    Outcome outcome = Outcome::Unknown;
    std::optional<TimerState> state; // for Applied and Conflict
    ApiError error; // Kind::None for Applied
};

// Decoders for the API's bare JSON bodies. Each returns nullopt when the
// value does not have the expected shape.
std::optional<Me> decodeMe(const QJsonValue &value);
std::optional<Project> decodeProject(const QJsonValue &value);
std::optional<QList<Project>> decodeProjects(const QJsonValue &value);
std::optional<TimeEntry> decodeTimeEntry(const QJsonValue &value);
std::optional<QList<TimeEntry>> decodeTimeEntries(const QJsonValue &value);
// null for no running entry.
std::optional<std::optional<TimeEntry>> decodeCurrentEntry(const QJsonValue &value);
std::optional<QList<ListedEntry>> decodeListedEntries(const QJsonValue &value);
// The Pomodoro lengths in a preferences object. As on the server, a value
// that is missing, not an integer or out of its range reads as its default,
// one key at a time. nullopt only for a value that is not an object.
std::optional<PomodoroConfig> decodePomodoroPreferences(const QJsonValue &value);
// Every field of the state and of what it holds must have its type, and a
// running entry must run; nullopt otherwise. The running entry, pause,
// session and discarded pomodoro must be present; null means none.
std::optional<TimerState> decodeTimerState(const QJsonValue &value);

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
// {"revision":n}, for an action that applies only to the state it was sent
// against.
QByteArray encodeRevision(qint64 revision);
QByteArray encodePomodoroStart(const PomodoroStart &start, qint64 workspaceId, const QString &createdWith);

}
