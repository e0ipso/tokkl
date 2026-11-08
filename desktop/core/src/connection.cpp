#include "connection.h"

#include <QSet>

#include <utility>

namespace Tokkl
{

Connection::Connection(Transport *transport, CredentialStore *store, const QString &clientName, QObject *parent)
    : QObject(parent)
    , m_clientName(clientName)
    , m_session(transport, store)
{
    connect(&m_session, &AuthSession::instanceTextChanged, this, &Connection::instanceUrlChanged);
    connect(&m_session, &AuthSession::authModeChanged, this, &Connection::authModeChanged);
    connect(&m_session, &AuthSession::emailChanged, this, &Connection::emailChanged);
    connect(&m_session, &AuthSession::stateChanged, this, &Connection::stateChanged);
    connect(&m_session, &AuthSession::accountChanged, this, &Connection::accountChanged);
    connect(&m_session, &AuthSession::generationChanged, this, &Connection::generationChanged);
}

QString Connection::instanceUrl() const
{
    return m_session.instanceText();
}

void Connection::setInstanceUrl(const QString &url)
{
    m_session.setInstanceText(url);
}

QUrl Connection::webUrl() const
{
    const InstanceUrl instance = parseInstanceUrl(m_session.instanceText());
    if (!instance.isValid()) {
        return QUrl();
    }
    QUrl url = instance.base.adjusted(QUrl::RemoveUserInfo | QUrl::RemoveQuery | QUrl::RemoveFragment);
    // The web app lives at the prefix itself: https://host/tokkl/.
    if (!url.path().endsWith(QLatin1Char('/'))) {
        url.setPath(url.path() + QLatin1Char('/'));
    }
    return url;
}

AuthMode Connection::authMode() const
{
    return m_session.authMode();
}

void Connection::setAuthMode(AuthMode mode)
{
    m_session.setAuthMode(mode);
}

QString Connection::authModeString() const
{
    return authModeToString(m_session.authMode());
}

void Connection::setAuthModeString(const QString &mode)
{
    m_session.setAuthMode(authModeFromString(mode));
}

QString Connection::email() const
{
    return m_session.email();
}

void Connection::setEmail(const QString &email)
{
    m_session.setEmail(email);
}

Connection::State Connection::state() const
{
    return m_session.state();
}

QString Connection::errorString() const
{
    return m_session.errorString();
}

bool Connection::isConnected() const
{
    return m_session.hasAccount();
}

bool Connection::isStale() const
{
    return m_session.hasAccount() && m_session.state() == Disconnected;
}

bool Connection::canWrite() const
{
    return m_session.canWrite();
}

QDateTime Connection::rateLimitedUntil() const
{
    return m_session.rateLimitedUntil();
}

quint64 Connection::generation() const
{
    return m_session.generation();
}

std::optional<Me> Connection::account() const
{
    return m_session.account();
}

QVariantMap Connection::accountMap() const
{
    const std::optional<Me> me = m_session.account();
    return me ? me->toVariantMap() : QVariantMap();
}

qint64 Connection::workspaceId() const
{
    const std::optional<Me> me = m_session.account();
    return me ? me->defaultWorkspaceId : 0;
}

QString Connection::owner() const
{
    const std::optional<Me> me = m_session.account();
    if (!me) {
        return QString();
    }
    return QStringLiteral("%1 %2 %3").arg(webUrl().toString(QUrl::FullyEncoded)).arg(me->id).arg(me->defaultWorkspaceId);
}

void Connection::reconnect()
{
    m_session.reconnect();
}

void Connection::refreshAccount()
{
    m_session.refreshAccount();
}

// ----- operations ----------------------------------------------------------

QUrl Connection::api(const QString &path) const
{
    return m_session.instance().api(path);
}

QUrl Connection::app(const QString &path) const
{
    return m_session.instance().app(path);
}

void Connection::fetchMe(Callback<Me> done)
{
    m_session.fetchMe(std::move(done));
}

struct Connection::ProjectPages {
    qint64 workspace = 0;
    int page = 1;
    QList<Project> projects;
    QSet<qint64> seen;
    Callback<ProjectList> done;
};

void Connection::fetchProjects(Callback<ProjectList> done)
{
    auto pages = std::make_shared<ProjectPages>();
    pages->workspace = workspaceId();
    pages->done = std::move(done);
    fetchProjectPage(pages);
}

void Connection::fetchProjectPage(const std::shared_ptr<ProjectPages> &pages)
{
    // The reply arrives only within this generation, so the workspace and
    // the pages read so far still belong to the bound account.
    m_session.api().call<QList<Project>>(
        "GET",
        api(QStringLiteral("/workspaces/%1/projects?active=true&page=%2&per_page=%3").arg(pages->workspace).arg(pages->page).arg(projectPageSize)),
        QByteArray(),
        ApiAccess::Read,
        &decodeProjects,
        [this, pages](const ApiResult<QList<Project>> &result) {
            if (!result.ok()) {
                if (pages->done) {
                    pages->done(ApiResult<ProjectList>::failure(result.error));
                }
                return;
            }
            bool added = false;
            for (const Project &project : *result.value) {
                if (pages->seen.contains(project.id)) {
                    continue;
                }
                pages->seen.insert(project.id);
                added = true;
                // Only the discovered workspace's projects may be offered.
                if (project.workspaceId == pages->workspace) {
                    pages->projects.append(project);
                }
            }
            // A full page may have a next one. A page with nothing new means
            // the server ignored the paging parameters.
            const bool more = result.value->size() >= projectPageSize && added;
            if (more && pages->page < maxProjectPages) {
                ++pages->page;
                fetchProjectPage(pages);
                return;
            }
            // Still more after the last page read: the list is cut short.
            if (pages->done) {
                pages->done(ApiResult<ProjectList>::success(ProjectList{pages->projects, more}));
            }
        });
}

void Connection::fetchProject(qint64 projectId, Callback<Project> done)
{
    const qint64 workspace = workspaceId();
    m_session.api().call<Project>(
        "GET",
        api(QStringLiteral("/workspaces/%1/projects/%2").arg(workspace).arg(projectId)),
        QByteArray(),
        ApiAccess::Read,
        [workspace, projectId](const QJsonValue &value) -> std::optional<Project> {
            std::optional<Project> project = decodeProject(value);
            if (project && (project->id != projectId || project->workspaceId != workspace)) {
                return std::nullopt;
            }
            return project;
        },
        std::move(done));
}

void Connection::fetchRecentEntries(Callback<QList<ListedEntry>> done)
{
    // Without dates the API answers with the entries started in the last 9
    // days.
    m_session.api().call<QList<ListedEntry>>("GET", api(QStringLiteral("/me/time_entries?meta=true")), QByteArray(), ApiAccess::Read, &decodeListedEntries, std::move(done));
}

void Connection::startEntry(const StartEntry &entry, Callback<TimeEntry> done)
{
    const qint64 workspace = workspaceId();
    m_session.api().call<TimeEntry>("POST",
                                    api(QStringLiteral("/workspaces/%1/time_entries").arg(workspace)),
                                    encodeStartEntry(entry, workspace, m_clientName),
                                    ApiAccess::Write,
                                    &decodeTimeEntry,
                                    std::move(done));
}

void Connection::stopEntry(qint64 entryId, Callback<TimeEntry> done)
{
    m_session.api().call<TimeEntry>("PATCH",
                                    api(QStringLiteral("/workspaces/%1/time_entries/%2/stop").arg(workspaceId()).arg(entryId)),
                                    QByteArray(),
                                    ApiAccess::Write,
                                    &decodeTimeEntry,
                                    std::move(done));
}

void Connection::updateEntry(qint64 entryId, const TimeEntryUpdate &update, Callback<TimeEntry> done)
{
    m_session.api().call<TimeEntry>("PUT",
                                    api(QStringLiteral("/workspaces/%1/time_entries/%2").arg(workspaceId()).arg(entryId)),
                                    encodeTimeEntryUpdate(update),
                                    ApiAccess::Write,
                                    &decodeTimeEntry,
                                    std::move(done));
}

void Connection::fetchPreferences(Callback<PomodoroConfig> done)
{
    preferencesCall("GET", QByteArray(), ApiAccess::Read, std::move(done));
}

void Connection::savePreferences(const PomodoroConfigUpdate &update, Callback<PomodoroConfig> done)
{
    preferencesCall("POST", encodePomodoroConfigUpdate(update), ApiAccess::Write, std::move(done));
}

ServerApi Connection::server() const
{
    const std::optional<Me> me = m_session.account();
    return me ? me->server : ServerApi();
}

void Connection::preferencesCall(const QByteArray &method, const QByteArray &body, ApiAccess access, Callback<PomodoroConfig> done)
{
    // A server without the app route has the v9 one, whose refusals name
    // the field only in their message.
    const QString path = QStringLiteral("/me/preferences");
    const QUrl url = server().appPreferences ? app(path) : api(path);
    m_session.api().call<PomodoroConfig>(method, url, body, access, &decodePomodoroPreferences, std::move(done));
}

void Connection::fetchTimerState(Callback<TimerState> done)
{
    m_session.api().call<TimerState>("GET", app(QStringLiteral("/timer")), QByteArray(), ApiAccess::Account, &decodeTimerState, std::move(done));
}

void Connection::pauseTimer(ActionCallback done)
{
    m_session.api().action(app(QStringLiteral("/timer/pause")), QByteArrayLiteral("{}"), std::move(done));
}

void Connection::resumeTimer(qint64 revision, ActionCallback done)
{
    m_session.api().action(app(QStringLiteral("/timer/resume")), encodeRevision(revision), std::move(done));
}

void Connection::discardPause(qint64 revision, ActionCallback done)
{
    m_session.api().action(app(QStringLiteral("/timer/discard")), encodeRevision(revision), std::move(done));
}

void Connection::startPomodoro(const PomodoroStart &start, ActionCallback done)
{
    m_session.api().action(app(QStringLiteral("/pomodoro")), encodePomodoroStart(start, workspaceId(), m_clientName), std::move(done));
}

void Connection::nextPomodoroPhase(qint64 revision, ActionCallback done)
{
    m_session.api().action(app(QStringLiteral("/pomodoro/next")), encodeRevision(revision), std::move(done));
}

void Connection::endPomodoro(qint64 revision, ActionCallback done)
{
    m_session.api().action(app(QStringLiteral("/pomodoro/end")), encodeRevision(revision), std::move(done));
}

namespace
{
TimerActionResult entryWrite(const ApiResult<TimeEntry> &reply)
{
    TimerActionResult result;
    result.error = reply.error;
    if (reply.ok()) {
        result.outcome = TimerActionResult::Outcome::Applied;
        result.entry = *reply.value;
    } else {
        result.outcome = reply.error.outcomeUnknown() ? TimerActionResult::Outcome::Unknown : TimerActionResult::Outcome::Refused;
    }
    return result;
}

Connection::Callback<TimeEntry> asAction(Connection::ActionCallback done)
{
    return [done = std::move(done)](const ApiResult<TimeEntry> &reply) {
        if (done) {
            done(entryWrite(reply));
        }
    };
}
}

void Connection::startTimer(qint64 revision, const StartEntry &entry, ActionCallback done)
{
    if (!server().timerActions) {
        startEntry(entry, asAction(std::move(done)));
        return;
    }
    m_session.api().action(app(QStringLiteral("/timer/start")), encodeTimerStart(revision, entry, workspaceId(), m_clientName), std::move(done));
}

void Connection::stopTimer(qint64 revision, qint64 entryId, ActionCallback done)
{
    if (!server().timerActions) {
        stopEntry(entryId, asAction(std::move(done)));
        return;
    }
    m_session.api().action(app(QStringLiteral("/timer/stop")), encodeRevision(revision), std::move(done));
}

PendingStream *Connection::openTimerEvents()
{
    return m_session.api().openStream(app(QStringLiteral("/timer/events")));
}

}
