#include "connection.h"

#include "logging.h"

#include <QSet>

#include <utility>

namespace Tokkl
{

Connection::Connection(Transport *transport, CredentialStore *store, const Clock &clock, const QString &clientName, QObject *parent)
    : QObject(parent)
    , m_clientName(clientName)
    , m_credentials(store)
    , m_cooldown(clock)
    , m_clock(clock)
    , m_api(transport, *this)
{
    connect(&m_credentials, &SessionCredentials::instanceTextChanged, this, &Connection::instanceUrlChanged);
    connect(&m_credentials, &SessionCredentials::authModeChanged, this, &Connection::authModeChanged);
    connect(&m_credentials, &SessionCredentials::emailChanged, this, &Connection::emailChanged);
    connect(&m_credentials, &SessionCredentials::changed, this, &Connection::settingsChanged);
    connect(&m_credentials, &SessionCredentials::secretRead, this, &Connection::onSecretRead);
    connect(&m_credentials, &SessionCredentials::writeFailed, this, &Connection::showFailedWrite);
    connect(&m_cooldown, &Cooldown::ended, this, &Connection::onCooldownEnded);
    m_retryTimer.setSingleShot(true);
    connect(&m_retryTimer, &QTimer::timeout, this, &Connection::refreshAccount);
}

QString Connection::instanceUrl() const
{
    return m_credentials.instanceText();
}

void Connection::setInstanceUrl(const QString &url)
{
    m_credentials.setInstanceText(url);
}

QUrl Connection::webUrl() const
{
    const InstanceUrl instance = parseInstanceUrl(m_credentials.instanceText());
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
    return m_credentials.authMode();
}

void Connection::setAuthMode(AuthMode mode)
{
    m_credentials.setAuthMode(mode);
}

QString Connection::authModeString() const
{
    return authModeToString(m_credentials.authMode());
}

void Connection::setAuthModeString(const QString &mode)
{
    m_credentials.setAuthMode(authModeFromString(mode));
}

QString Connection::email() const
{
    return m_credentials.email();
}

void Connection::setEmail(const QString &email)
{
    m_credentials.setEmail(email);
}

Connection::State Connection::state() const
{
    return m_state;
}

QString Connection::errorString() const
{
    return m_error;
}

bool Connection::isConnected() const
{
    return m_context.has_value() && m_context->generation == m_generation;
}

bool Connection::isStale() const
{
    return isConnected() && m_state == Disconnected;
}

bool Connection::canWrite() const
{
    return isConnected() && !m_authPaused && !m_cooldown.active();
}

QDateTime Connection::rateLimitedUntil() const
{
    return m_cooldown.until();
}

quint64 Connection::generation() const
{
    return m_generation;
}

std::optional<Me> Connection::account() const
{
    if (!isConnected()) {
        return std::nullopt;
    }
    return m_context->me;
}

QVariantMap Connection::accountMap() const
{
    const std::optional<Me> me = account();
    return me ? me->toVariantMap() : QVariantMap();
}

qint64 Connection::workspaceId() const
{
    const std::optional<Me> me = account();
    return me ? me->defaultWorkspaceId : 0;
}

QString Connection::owner() const
{
    const std::optional<Me> me = account();
    if (!me) {
        return QString();
    }
    return QStringLiteral("%1 %2 %3").arg(webUrl().toString(QUrl::FullyEncoded)).arg(me->id).arg(me->defaultWorkspaceId);
}

namespace
{
ApiError localError(ApiError::Kind kind, const QString &message)
{
    ApiError error;
    error.kind = kind;
    error.message = message;
    return error;
}

bool refusesCredentials(const ApiError &error)
{
    return error.kind == ApiError::Kind::Forbidden || error.kind == ApiError::Kind::Unauthorized;
}

}

ServerApi Connection::server() const
{
    // An account binds only after the announcement of its generation.
    return isConnected() && m_announcement.generation == m_generation ? m_announcement.server : ServerApi();
}

const Clock &Connection::clock() const
{
    return m_clock;
}

// ----- configuration and credentials ---------------------------------------

void Connection::settingsChanged()
{
    // Another instance or account: nothing from the old one may stay visible,
    // and its secret, pause and cooldown do not carry over.
    resetAccount();
    m_credentials.forgetSecret();
    m_authPaused = false;
    m_cooldown.clear();
    m_retryTimer.stop();
    m_retry.reset();
    m_credentials.clearInstance();
    setState(m_credentials.instanceText().trimmed().isEmpty() ? Unconfigured : LoadingCredentials);
    scheduleReload();
}

void Connection::scheduleReload()
{
    // QML sets the three settings one after another; read the wallet once.
    if (m_reloadScheduled) {
        return;
    }
    m_reloadScheduled = true;
    QMetaObject::invokeMethod(this, &Connection::reload, Qt::QueuedConnection);
}

void Connection::reload()
{
    m_reloadScheduled = false;
    m_retryTimer.stop();

    if (m_credentials.instanceText().trimmed().isEmpty()) {
        setState(Unconfigured);
        return;
    }
    const InstanceUrl &instance = m_credentials.parseInstance();
    if (!instance.isValid()) {
        setState(InvalidSettings, instance.error);
        return;
    }
    if (m_credentials.lacksEmail()) {
        setState(InvalidSettings, tr("Enter the email address of your Tokkl account."));
        return;
    }
    if (!m_credentials.hasStore()) {
        setState(WalletError, CredentialResult{CredentialResult::Status::Unavailable, {}}.message());
        return;
    }

    if (!isConnected()) {
        setState(LoadingCredentials);
    }
    m_credentials.read();
}

void Connection::onSecretRead(const CredentialResult &result)
{
    if (!result.ok()) {
        qCWarning(lcCredentials) << "Reading the secret failed:" << result.status;
        // Without the secret nothing can be validated or written.
        if (isConnected()) {
            resetAccount();
        }
        m_credentials.forgetSecret();
        setState(result.status == CredentialResult::Status::NotFound ? CredentialsMissing : WalletError, m_credentials.message(result));
        return;
    }
    if (m_credentials.differs(result.secret)) {
        resetAccount();
    }
    m_credentials.setSecret(result.secret);
    authenticate(true);
}

void Connection::showFailedWrite(CredentialResult::Status status)
{
    qCWarning(lcCredentials) << "The store did not save the secret:" << status;
    // A new generation, so a read issued before the failure cannot replace
    // this error. What the store now holds for the key is not what the user
    // entered, so nothing is validated or written with it.
    resetAccount();
    m_retryTimer.stop();
    m_credentials.forgetSecret();
    setState(WalletError, tr("The new credentials were not saved. %1").arg(m_credentials.message(CredentialResult{status, {}})));
}

void Connection::reconnect()
{
    m_credentials.forgetFailedWrite();
    m_authPaused = false;
    m_retry.reset();
    if (m_reloadScheduled) {
        return;
    }
    reload();
}

void Connection::refreshAccount()
{
    if (m_authPaused || m_credentials.authorization().isEmpty()) {
        return;
    }
    authenticate(false);
}

// ----- authentication ------------------------------------------------------

void Connection::authenticate(bool explicitRequest)
{
    m_retryTimer.stop();
    if (m_authPaused && !explicitRequest) {
        return;
    }
    if (m_cooldown.active()) {
        setState(RateLimited, m_error);
        return;
    }
    if (!isConnected()) {
        setState(Connecting);
    }
    if (m_announcement.generation != m_generation || (!m_announcement.pending && !m_announcement.server.isSupported())) {
        readAnnouncement();
    } else if (!m_announcement.pending) {
        sendMe();
    }
    // Otherwise the read in flight sends /me once it settles.
}

void Connection::readAnnouncement()
{
    // A supported announcement holds for the generation. Any other answer
    // is asked for again by the next validation, such as a reconnect after
    // the server was updated.
    m_announcement = Announcement{m_generation, true, ServerApi()};
    m_api.send("GET", app(QStringLiteral("/status")), QByteArray(), [this](const HttpResponse &response) {
        m_announcement.pending = false;
        const ApiError error = errorFromResponse(response);
        if (response.outcome != HttpResponse::Outcome::Finished || error.kind == ApiError::Kind::Server || asksToWait(response)) {
            handleFailure(response, error);
            return;
        }
        // Any other answer, an older server's 404 too, is the server's;
        // /me then tells a wrong address or refused credentials from a
        // server that is too old.
        m_announcement.server = serverApiFromResponse(response);
        sendMe();
    });
}

void Connection::sendMe()
{
    m_api.send("GET", api(QStringLiteral("/me")), QByteArray(), [this](const HttpResponse &response) {
        handleMe(response);
    });
}

void Connection::handleMe(const HttpResponse &response)
{
    const ApiResult<Me> me = meFromResponse(response);
    if (me.ok()) {
        bind(*me.value);
        return;
    }
    handleFailure(response, me.error);
}

void Connection::handleFailure(const HttpResponse &response, const ApiError &error)
{
    if (asksToWait(response)) {
        startCooldown(response.retryAfter, error.message);
        return;
    }
    switch (error.kind) {
    case ApiError::Kind::Forbidden:
    case ApiError::Kind::Unauthorized:
        refuseCredentials(error);
        return;
    case ApiError::Kind::Network:
    case ApiError::Kind::Timeout:
    case ApiError::Kind::Server:
        // Not an authentication failure. A bound account stays, marked stale.
        setState(Disconnected, error.message);
        if (!isConnected()) {
            m_retryTimer.start(m_retry.next(m_clock));
        }
        return;
    default:
        resetAccount();
        setState(Error, error.message);
        return;
    }
}

void Connection::fetchMe(Callback<Me> done)
{
    m_api.call<Me>("GET", api(QStringLiteral("/me")), QByteArray(), ApiAccess::Account, &decodeMe, [this, done](const ApiResult<Me> &result) {
        if (result.ok()) {
            bind(*result.value);
        }
        if (done) {
            done(result);
        }
    });
}

// The credentials were refused. A 403 alone does not say why, so the message
// does not claim the account is disabled. Wallet values stay so the user can
// correct them.
void Connection::refuseCredentials(const ApiError &error)
{
    pauseAuthentication(tr("The instance refused these credentials (%1). Check them in the widget settings, then reconnect.").arg(error.message));
}

void Connection::pauseAuthentication(const QString &message)
{
    resetAccount();
    m_authPaused = true;
    setState(AuthenticationFailed, message);
}

void Connection::bind(const Me &me)
{
    if (!m_announcement.server.isSupported()) {
        qCWarning(lcAuth) << "The server announces API version" << m_announcement.server.version << "with" << m_announcement.server.capabilities
                          << "; this app needs version" << ServerFloor::apiVersion << "with" << ServerFloor::capabilities();
        if (isConnected()) {
            resetAccount();
        }
        //: The connection's error when the server lacks what this app needs
        setState(Error, tr("This Tokkl server is too old for this app; update the server.", "connection error"));
        return;
    }
    if (isConnected() && (m_context->me.id != me.id || m_context->me.defaultWorkspaceId != me.defaultWorkspaceId)) {
        // The same credentials now name another account or workspace. The
        // instance is the same, so what it announced still holds.
        resetAccount();
        m_announcement.generation = m_generation;
    }
    const bool changed = !isConnected() || m_context->me != me;
    m_context = Context{m_generation, me};
    m_retry.reset();
    setState(Connected);
    if (changed) {
        Q_EMIT accountChanged();
    }
}

void Connection::resetAccount()
{
    ++m_generation;
    qCDebug(lcAuth) << "Generation" << m_generation;
    // A secret read sent before belongs to the old generation.
    m_credentials.dropReads();
    m_api.abortAll();
    clearAccount();
    Q_EMIT generationChanged();
}

void Connection::clearAccount()
{
    const bool hadAccount = m_context.has_value();
    m_context.reset();
    if (hadAccount) {
        Q_EMIT accountChanged();
        Q_EMIT stateChanged();
    }
}

void Connection::setState(State state, const QString &error)
{
    if (state == m_state && error == m_error) {
        return;
    }
    m_state = state;
    m_error = error;
    // Error texts are for the user and never carry a secret.
    qCInfo(lcAuth).nospace().noquote() << "Connection state " << state << (error.isEmpty() ? QString() : QStringLiteral(": ") + error);
    Q_EMIT stateChanged();
}

// ----- rate limiting -------------------------------------------------------

void Connection::startCooldown(const QByteArray &retryAfter, const QString &message)
{
    m_cooldown.start(retryAfter);
    setState(RateLimited, message);
}

void Connection::onCooldownEnded()
{
    if (m_state != RateLimited) {
        Q_EMIT stateChanged();
        return;
    }
    if (isConnected()) {
        setState(Connected);
    } else if (!m_authPaused && !m_credentials.authorization().isEmpty()) {
        authenticate(false);
    } else {
        Q_EMIT stateChanged();
    }
}

// ----- ApiSession ----------------------------------------------------------

QByteArray Connection::authorization() const
{
    return m_credentials.authorization();
}

std::optional<ApiError> Connection::refusal(ApiAccess access) const
{
    if (!isConnected()) {
        return m_authPaused ? localError(ApiError::Kind::AuthenticationPaused, m_error)
                            : localError(ApiError::Kind::NotConnected, tr("Not connected to a Tokkl account."));
    }
    if (m_cooldown.active()) {
        return localError(ApiError::Kind::RateLimited, tr("Too many attempts. Wait until %1.").arg(m_cooldown.until().toLocalTime().toString(Qt::TextDate)));
    }
    if (access == ApiAccess::Write && !canWrite()) {
        return localError(ApiError::Kind::NotConnected, tr("Changes are not possible right now."));
    }
    return std::nullopt;
}

void Connection::answered()
{
    if (m_state == Disconnected) {
        setState(Connected);
    }
}

bool Connection::absorbFailure(const HttpResponse &response, const ApiError &error, ApiAccess access)
{
    if (asksToWait(response)) {
        startCooldown(response.retryAfter, error.message);
    } else if (access == ApiAccess::Account && refusesCredentials(error)) {
        refuseCredentials(error);
        return false;
    } else if (error.kind == ApiError::Kind::Unauthorized) {
        pauseAuthentication(error.message);
        return false;
    } else if (error.isTransient()) {
        setState(Disconnected, error.message);
    }
    return true;
}

// ----- operations ----------------------------------------------------------

QUrl Connection::api(const QString &path) const
{
    return m_credentials.instance().api(path);
}

QUrl Connection::app(const QString &path) const
{
    return m_credentials.instance().app(path);
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
    m_api.call<QList<Project>>(
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

void Connection::fetchCatalogRevision(Callback<qint64> done)
{
    m_api.call<qint64>("GET",
                       app(QStringLiteral("/workspaces/%1/catalog").arg(workspaceId())),
                       QByteArray(),
                       ApiAccess::Read,
                       &decodeCatalogRevision,
                       std::move(done));
}

void Connection::fetchProject(qint64 projectId, Callback<Project> done)
{
    const qint64 workspace = workspaceId();
    m_api.call<Project>(
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

void Connection::fetchLatestEntry(Callback<std::optional<ListedEntry>> done)
{
    m_api.call<std::optional<ListedEntry>>("GET",
                                           app(QStringLiteral("/time_entries/latest")),
                                           QByteArray(),
                                           ApiAccess::Read,
                                           &decodeLatestEntry,
                                           std::move(done));
}

void Connection::fetchPreferences(Callback<PomodoroConfig> done)
{
    m_api.call<PomodoroConfig>("GET", app(QStringLiteral("/me/preferences")), QByteArray(), ApiAccess::Read, preferencesDecoder(), std::move(done));
}

void Connection::savePreferences(const PomodoroConfigUpdate &update, Callback<PomodoroConfig> done)
{
    m_api.call<PomodoroConfig>("POST",
                               app(QStringLiteral("/me/preferences")),
                               encodePomodoroConfigUpdate(update),
                               ApiAccess::Write,
                               preferencesDecoder(),
                               std::move(done));
}

ApiClient::Decoder<PomodoroConfig> Connection::preferencesDecoder() const
{
    // A request goes out only with a bound account, whose server announced
    // its limits.
    const PomodoroLimits limits = server().pomodoroLimits.value_or(PomodoroLimits::placeholder());
    return [limits](const QJsonValue &value) {
        return decodePomodoroPreferences(value, limits);
    };
}

void Connection::fetchTimerState(Callback<TimerState> done)
{
    m_api.call<TimerState>("GET", app(QStringLiteral("/timer")), QByteArray(), ApiAccess::Account, &decodeTimerState, std::move(done));
}

void Connection::pauseTimer(qint64 revision, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/timer/pause")), encodeRevision(revision), std::move(done));
}

void Connection::resumeTimer(qint64 revision, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/timer/resume")), encodeRevision(revision), std::move(done));
}

void Connection::discardPause(qint64 revision, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/timer/discard")), encodeRevision(revision), std::move(done));
}

void Connection::startPomodoro(qint64 revision, const PomodoroStart &start, ActionCallback done)
{
    m_api.keyedAction(app(QStringLiteral("/pomodoro")),
                      encodePomodoroStart(start, workspaceId(), m_clientName, revision),
                      ApiClient::newIdempotencyKey(),
                      std::move(done));
}

void Connection::nextPomodoroPhase(qint64 revision, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/pomodoro/next")), encodeRevision(revision), std::move(done));
}

void Connection::endPomodoro(qint64 revision, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/pomodoro/end")), encodeRevision(revision), std::move(done));
}

void Connection::startTimer(qint64 revision, const StartEntry &entry, ActionCallback done)
{
    m_api.keyedAction(app(QStringLiteral("/timer/start")),
                      encodeTimerStart(revision, entry, workspaceId(), m_clientName),
                      ApiClient::newIdempotencyKey(),
                      std::move(done));
}

void Connection::stopTimer(qint64 revision, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/timer/stop")), encodeRevision(revision), std::move(done));
}

void Connection::editTimer(qint64 entryId, const TimeEntryUpdate &update, ActionCallback done)
{
    m_api.action(app(QStringLiteral("/timer/edit")), encodeTimerEdit(entryId, update), std::move(done));
}

PendingStream *Connection::openTimerEvents()
{
    return m_api.openStream(app(QStringLiteral("/timer/events")));
}

}
