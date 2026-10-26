#include "connection.h"

#include <QCoreApplication>

#include <algorithm>
#include <utility>

namespace Tokkl
{

namespace
{
ApiError localError(ApiError::Kind kind, const QString &message)
{
    ApiError error;
    error.kind = kind;
    error.message = message;
    return error;
}

bool isSuccess(const HttpResponse &response)
{
    return response.outcome == HttpResponse::Outcome::Finished && response.status >= 200 && response.status < 300;
}

// Retry-After as delta seconds or an HTTP date.
qint64 retryAfterMs(const QByteArray &header)
{
    const QByteArray value = header.trimmed();
    if (value.isEmpty()) {
        return Connection::defaultCooldownMs;
    }
    bool isNumber = false;
    const qint64 seconds = value.toLongLong(&isNumber);
    qint64 ms = Connection::defaultCooldownMs;
    if (isNumber) {
        ms = seconds * 1000;
    } else {
        const QDateTime when = QDateTime::fromString(QString::fromLatin1(value), Qt::RFC2822Date);
        if (when.isValid()) {
            ms = QDateTime::currentDateTimeUtc().msecsTo(when);
        }
    }
    // A bad or hostile header cannot block the widget for hours or retry in a loop.
    return std::clamp<qint64>(ms, 1000, 3600 * 1000);
}
}

Connection::Connection(Transport *transport, CredentialStore *store, const QString &clientName, QObject *parent)
    : QObject(parent)
    , m_transport(transport)
    , m_store(store)
    , m_clientName(clientName)
{
    m_cooldownTimer.setSingleShot(true);
    connect(&m_cooldownTimer, &QTimer::timeout, this, &Connection::onCooldownEnded);
    m_retryTimer.setSingleShot(true);
    connect(&m_retryTimer, &QTimer::timeout, this, &Connection::refreshAccount);
    if (m_store) {
        connect(m_store, &CredentialStore::secretChanged, this, &Connection::onSecretChanged);
        connect(m_store, &CredentialStore::secretWriteFailed, this, &Connection::onSecretWriteFailed);
    }
}

Connection::~Connection()
{
    // Replies belong to the transport; stop them reaching this object.
    for (PendingReply *reply : std::as_const(m_pending)) {
        disconnect(reply, nullptr, this, nullptr);
        reply->abort();
        reply->deleteLater();
    }
}

QString Connection::instanceUrl() const
{
    return m_instanceText;
}

void Connection::setInstanceUrl(const QString &url)
{
    if (url == m_instanceText) {
        return;
    }
    m_instanceText = url;
    Q_EMIT instanceUrlChanged();
    settingsChanged();
}

QUrl Connection::webUrl() const
{
    const InstanceUrl instance = parseInstanceUrl(m_instanceText);
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
    return m_authMode;
}

void Connection::setAuthMode(AuthMode mode)
{
    if (mode == m_authMode) {
        return;
    }
    m_authMode = mode;
    Q_EMIT authModeChanged();
    settingsChanged();
}

QString Connection::authModeString() const
{
    return authModeToString(m_authMode);
}

void Connection::setAuthModeString(const QString &mode)
{
    setAuthMode(authModeFromString(mode));
}

QString Connection::email() const
{
    return m_email;
}

void Connection::setEmail(const QString &email)
{
    if (email == m_email) {
        return;
    }
    m_email = email;
    Q_EMIT emailChanged();
    // The email only identifies the account in password mode.
    if (m_authMode == AuthMode::Password) {
        settingsChanged();
    }
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
    return hasContext();
}

bool Connection::isStale() const
{
    return hasContext() && m_state == Disconnected;
}

bool Connection::canWrite() const
{
    return hasContext() && !m_authPaused && !coolingDown();
}

QDateTime Connection::rateLimitedUntil() const
{
    return coolingDown() ? m_cooldownUntil : QDateTime();
}

quint64 Connection::generation() const
{
    return m_generation;
}

std::optional<Me> Connection::account() const
{
    if (!hasContext()) {
        return std::nullopt;
    }
    return m_context->me;
}

QVariantMap Connection::accountMap() const
{
    return hasContext() ? m_context->me.toVariantMap() : QVariantMap();
}

qint64 Connection::workspaceId() const
{
    return hasContext() ? m_context->me.defaultWorkspaceId : 0;
}

QString Connection::owner() const
{
    if (!hasContext()) {
        return QString();
    }
    return QStringLiteral("%1 %2 %3").arg(webUrl().toString(QUrl::FullyEncoded)).arg(m_context->me.id).arg(m_context->me.defaultWorkspaceId);
}

QList<Project> Connection::projects() const
{
    return m_projects;
}

bool Connection::projectsIncomplete() const
{
    return m_projectsIncomplete;
}

QVariantList Connection::projectList() const
{
    QVariantList list;
    for (const Project &project : m_projects) {
        list.append(project.toVariantMap());
    }
    return list;
}

std::optional<TimeEntry> Connection::currentEntry() const
{
    return m_currentEntry;
}

QVariant Connection::currentEntryVariant() const
{
    return m_currentEntry ? QVariant(m_currentEntry->toVariantMap()) : QVariant::fromValue(nullptr);
}

std::optional<qint64> Connection::nextProjectId() const
{
    return m_nextProjectId;
}

void Connection::setNextProjectId(std::optional<qint64> projectId)
{
    if (projectId == m_nextProjectId) {
        return;
    }
    m_nextProjectId = projectId;
    Q_EMIT nextStartChanged();
}

QVariant Connection::nextProjectIdVariant() const
{
    return m_nextProjectId ? QVariant(*m_nextProjectId) : QVariant::fromValue(nullptr);
}

void Connection::setNextProjectIdVariant(const QVariant &projectId)
{
    bool ok = false;
    const qint64 id = projectId.toLongLong(&ok);
    setNextProjectId(ok && id > 0 ? std::optional<qint64>(id) : std::nullopt);
}

bool Connection::nextBillable() const
{
    return m_nextBillable;
}

void Connection::setNextBillable(bool billable)
{
    if (billable == m_nextBillable) {
        return;
    }
    m_nextBillable = billable;
    Q_EMIT nextStartChanged();
}

// ----- configuration and credentials ---------------------------------------

void Connection::settingsChanged()
{
    // Another instance or account: nothing from the old one may stay visible,
    // and its secret, pause and cooldown do not carry over.
    resetAccount();
    m_hasSecret = false;
    m_secret.clear();
    m_authorization.clear();
    m_authPaused = false;
    m_cooldownUntil = QDateTime();
    m_cooldownTimer.stop();
    m_retryTimer.stop();
    m_instance = InstanceUrl();
    setState(m_instanceText.trimmed().isEmpty() ? Unconfigured : LoadingCredentials);
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

QString Connection::currentCredentialKey() const
{
    return credentialKey(m_instance, m_authMode, m_email);
}

// The store's own wording, or the platform-neutral text once the store is gone.
QString Connection::credentialMessage(const CredentialResult &result) const
{
    return m_store ? m_store->message(result) : result.message();
}

void Connection::reload()
{
    m_reloadScheduled = false;
    m_retryTimer.stop();

    if (m_instanceText.trimmed().isEmpty()) {
        setState(Unconfigured);
        return;
    }
    m_instance = parseInstanceUrl(m_instanceText);
    if (!m_instance.isValid()) {
        setState(InvalidSettings, m_instance.error);
        return;
    }
    if (m_authMode == AuthMode::Password && m_email.trimmed().isEmpty()) {
        setState(InvalidSettings, tr("Enter the email address of your Tokkl account."));
        return;
    }
    if (!m_store) {
        setState(WalletError, CredentialResult{CredentialResult::Status::Unavailable, {}}.message());
        return;
    }

    if (!hasContext()) {
        setState(LoadingCredentials);
    }
    const quint64 generation = m_generation;
    const QString key = currentCredentialKey();
    const std::optional<FailedWrite> failedWrite = std::exchange(m_failedWrite, std::nullopt);
    if (failedWrite && failedWrite->key == key) {
        showFailedWrite(failedWrite->status);
        return;
    }
    m_store->read(key, this, [this, generation, key](const CredentialResult &result) {
        if (generation != m_generation || key != currentCredentialKey()) {
            return;
        }
        if (!result.ok()) {
            // Without the secret nothing can be validated or written.
            if (hasContext()) {
                resetAccount();
            }
            m_hasSecret = false;
            m_secret.clear();
            m_authorization.clear();
            setState(result.status == CredentialResult::Status::NotFound ? CredentialsMissing : WalletError, credentialMessage(result));
            return;
        }
        if (m_hasSecret && result.secret != m_secret) {
            resetAccount();
        }
        m_hasSecret = true;
        m_secret = result.secret;
        m_authorization = basicAuthorization(m_authMode, m_email, m_secret);
        authenticate(true);
    });
}

void Connection::onSecretChanged(const QString &key)
{
    if (m_failedWrite && m_failedWrite->key == key) {
        m_failedWrite.reset();
    }
    if (m_instance.isValid() && key == currentCredentialKey()) {
        settingsChanged();
    }
}

void Connection::onSecretWriteFailed(const QString &key, const CredentialResult &result)
{
    if (m_instance.isValid() && key == currentCredentialKey()) {
        m_failedWrite.reset();
        showFailedWrite(result.status);
        return;
    }
    // The settings for that key may still be on their way, as when a
    // settings page saves the secret before the settings.
    m_failedWrite = FailedWrite{key, result.status};
}

void Connection::showFailedWrite(CredentialResult::Status status)
{
    // A new generation, so a read issued before the failure cannot replace
    // this error. What the store now holds for the key is not what the user
    // entered, so nothing is validated or written with it.
    resetAccount();
    m_retryTimer.stop();
    m_hasSecret = false;
    m_secret.clear();
    m_authorization.clear();
    setState(WalletError, tr("The new credentials were not saved. %1").arg(credentialMessage(CredentialResult{status, {}})));
}

void Connection::reconnect()
{
    m_failedWrite.reset();
    m_authPaused = false;
    if (m_reloadScheduled) {
        return;
    }
    reload();
}

void Connection::refreshAccount()
{
    if (m_authPaused || m_authorization.isEmpty()) {
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
    if (coolingDown()) {
        setState(RateLimited, m_error);
        return;
    }
    if (!hasContext()) {
        setState(Connecting);
    }
    send("GET", QStringLiteral("/me"), QByteArray(), [this](const HttpResponse &response) {
        handleMe(response);
    });
}

void Connection::handleMe(const HttpResponse &response)
{
    if (isSuccess(response)) {
        const std::optional<QJsonValue> json = parseJsonBody(response.body);
        const std::optional<Me> me = json ? decodeMe(*json) : std::nullopt;
        if (!me) {
            resetAccount();
            setState(Error, tr("The address did not answer like a Tokkl instance. Check the instance URL."));
            return;
        }
        bind(*me);
        return;
    }

    const ApiError error = errorFromResponse(response);
    switch (error.kind) {
    case ApiError::Kind::Forbidden:
    case ApiError::Kind::Unauthorized:
        refuseCredentials(error);
        return;
    case ApiError::Kind::RateLimited:
        startCooldown(response.retryAfter);
        setState(RateLimited, error.message);
        return;
    case ApiError::Kind::Network:
    case ApiError::Kind::Timeout:
    case ApiError::Kind::Server:
        // Not an authentication failure. A bound account stays, marked stale.
        setState(Disconnected, error.message);
        if (!hasContext()) {
            m_retryTimer.start(retryDelayMs);
        }
        return;
    default:
        resetAccount();
        setState(Error, error.message);
        return;
    }
}

// The credentials were refused. A 403 alone does not say why, so the message
// does not claim the account is disabled. Wallet values stay so the user can
// correct them.
void Connection::refuseCredentials(const ApiError &error)
{
    resetAccount();
    m_authPaused = true;
    setState(AuthenticationFailed,
             tr("The instance refused these credentials (%1). Check them in the widget settings, then reconnect.").arg(error.message));
}

void Connection::bind(const Me &me)
{
    if (hasContext() && (m_context->me.id != me.id || m_context->me.defaultWorkspaceId != me.defaultWorkspaceId)) {
        // The same credentials now name another account or workspace.
        resetAccount();
    }
    const bool changed = !hasContext() || m_context->me.email != me.email || m_context->me.fullname != me.fullname
        || m_context->me.timezone != me.timezone || m_context->me.beginningOfWeek != me.beginningOfWeek
        || m_context->me.timeResolutionMinutes != me.timeResolutionMinutes;
    m_context = Context{m_generation, m_instance.key(), me};
    setState(Connected);
    if (changed) {
        Q_EMIT accountChanged();
    }
}

void Connection::resetAccount()
{
    ++m_generation;
    const QSet<PendingReply *> pending = std::exchange(m_pending, {});
    for (PendingReply *reply : pending) {
        // The reply still finishes; its generation no longer matches.
        reply->abort();
    }
    clearAccountData();
    Q_EMIT generationChanged();
}

void Connection::clearAccountData()
{
    const bool hadAccount = m_context.has_value();
    const bool hadProjects = !m_projects.isEmpty() || m_projectsIncomplete;
    const bool hadEntry = m_currentEntry.has_value();
    const bool hadChoices = m_nextProjectId.has_value() || m_nextBillable;
    m_context.reset();
    m_projects.clear();
    m_projectsIncomplete = false;
    m_currentEntry.reset();
    m_nextProjectId.reset();
    m_nextBillable = false;
    if (hadAccount) {
        Q_EMIT accountChanged();
        Q_EMIT stateChanged();
    }
    if (hadProjects) {
        Q_EMIT projectsChanged();
    }
    if (hadEntry) {
        Q_EMIT currentEntryChanged();
    }
    if (hadChoices) {
        Q_EMIT nextStartChanged();
    }
}

void Connection::setState(State state, const QString &error)
{
    if (state == m_state && error == m_error) {
        return;
    }
    m_state = state;
    m_error = error;
    Q_EMIT stateChanged();
}

bool Connection::hasContext() const
{
    return m_context.has_value() && m_context->generation == m_generation;
}

// ----- rate limiting -------------------------------------------------------

void Connection::startCooldown(const QByteArray &retryAfter)
{
    const qint64 ms = retryAfterMs(retryAfter);
    m_cooldownUntil = QDateTime::currentDateTimeUtc().addMSecs(ms);
    m_cooldownTimer.start(int(ms));
}

bool Connection::coolingDown() const
{
    return m_cooldownUntil.isValid() && QDateTime::currentDateTimeUtc() < m_cooldownUntil;
}

void Connection::onCooldownEnded()
{
    m_cooldownUntil = QDateTime();
    if (m_state != RateLimited) {
        Q_EMIT stateChanged();
        return;
    }
    if (hasContext()) {
        setState(Connected);
    } else if (!m_authPaused && !m_authorization.isEmpty()) {
        authenticate(false);
    } else {
        Q_EMIT stateChanged();
    }
}

// ----- requests ------------------------------------------------------------

void Connection::send(const QByteArray &method, const QString &path, const QByteArray &body, ResponseHandler handler)
{
    const quint64 generation = m_generation;
    PendingReply *reply = m_transport->send(HttpRequest{method, m_instance.api(path), m_authorization, body});
    m_pending.insert(reply);
    connect(reply, &PendingReply::finished, this, [this, reply, generation, handler](const HttpResponse &response) {
        m_pending.remove(reply);
        reply->deleteLater();
        if (generation != m_generation) {
            return; // issued for an earlier instance, account or credential
        }
        handler(response);
    });
}

template<typename T>
void Connection::failLater(ApiError error, Callback<T> done)
{
    if (!done) {
        return;
    }
    const quint64 generation = m_generation;
    QMetaObject::invokeMethod(
        this,
        [this, generation, error, done] {
            if (generation == m_generation) {
                done(ApiResult<T>::failure(error));
            }
        },
        Qt::QueuedConnection);
}

template<typename T>
void Connection::call(const QByteArray &method,
                      const QString &path,
                      const QByteArray &body,
                      Access access,
                      std::function<std::optional<T>(const QJsonValue &)> decode,
                      std::function<void(const T &)> apply,
                      Callback<T> done)
{
    if (!hasContext()) {
        failLater<T>(m_authPaused ? localError(ApiError::Kind::AuthenticationPaused, m_error)
                                  : localError(ApiError::Kind::NotConnected, tr("Not connected to a Tokkl account.")),
                     done);
        return;
    }
    if (coolingDown()) {
        failLater<T>(localError(ApiError::Kind::RateLimited, tr("Too many attempts. Wait until %1.").arg(m_cooldownUntil.toLocalTime().toString(Qt::TextDate))),
                     done);
        return;
    }
    if (access == Access::Write && !canWrite()) {
        failLater<T>(localError(ApiError::Kind::NotConnected, tr("Changes are not possible right now.")), done);
        return;
    }

    send(method, path, body, [this, access, decode, apply, done](const HttpResponse &response) {
        if (isSuccess(response)) {
            const std::optional<QJsonValue> json = parseJsonBody(response.body);
            std::optional<T> value = json ? decode(*json) : std::nullopt;
            if (!value) {
                if (done) {
                    done(ApiResult<T>::failure(localError(ApiError::Kind::InvalidResponse, tr("The instance sent a response Tokkl could not read."))));
                }
                return;
            }
            if (m_state == Disconnected) {
                setState(Connected);
            }
            if (apply) {
                apply(*value);
            }
            if (done) {
                done(ApiResult<T>::success(std::move(*value)));
            }
            return;
        }

        const ApiError error = errorFromResponse(response);
        if (error.kind == ApiError::Kind::RateLimited) {
            startCooldown(response.retryAfter);
            setState(RateLimited, error.message);
        } else if (access == Access::Account && (error.kind == ApiError::Kind::Forbidden || error.kind == ApiError::Kind::Unauthorized)) {
            refuseCredentials(error);
            return; // the generation changed; the caller's state is gone too
        } else if (error.kind == ApiError::Kind::Unauthorized) {
            resetAccount();
            m_authPaused = true;
            setState(AuthenticationFailed, error.message);
            return; // the generation changed; the caller's state is gone too
        } else if (error.isTransient()) {
            setState(Disconnected, error.message);
        }
        // A 403 from a workspace operation can mean many things; the caller
        // decides, for example by calling refreshAccount().
        if (done) {
            done(ApiResult<T>::failure(error));
        }
    });
}

void Connection::fetchMe(Callback<Me> done)
{
    call<Me>(
        "GET",
        QStringLiteral("/me"),
        QByteArray(),
        Access::Account,
        &decodeMe,
        [this](const Me &me) {
            bind(me);
        },
        std::move(done));
}

void Connection::fetchCurrentEntry(Callback<std::optional<TimeEntry>> done)
{
    call<std::optional<TimeEntry>>(
        "GET",
        QStringLiteral("/me/time_entries/current"),
        QByteArray(),
        Access::Account,
        &decodeCurrentEntry,
        [this](const std::optional<TimeEntry> &entry) {
            const bool changed = entry.has_value() != m_currentEntry.has_value() || (entry && entry->toVariantMap() != m_currentEntry->toVariantMap());
            m_currentEntry = entry;
            if (changed) {
                Q_EMIT currentEntryChanged();
            }
        },
        std::move(done));
}

struct Connection::ProjectPages {
    qint64 workspace = 0;
    int page = 1;
    QList<Project> projects;
    QSet<qint64> seen;
    Callback<QList<Project>> done;
};

void Connection::fetchProjects(Callback<QList<Project>> done)
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
    call<QList<Project>>(
        "GET",
        QStringLiteral("/workspaces/%1/projects?active=true&page=%2&per_page=%3").arg(pages->workspace).arg(pages->page).arg(projectPageSize),
        QByteArray(),
        Access::Read,
        &decodeProjects,
        {},
        [this, pages](const ApiResult<QList<Project>> &result) {
            if (!result.ok()) {
                if (pages->done) {
                    pages->done(result);
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
            m_projects = pages->projects;
            m_projectsIncomplete = more;
            Q_EMIT projectsChanged();
            if (pages->done) {
                pages->done(ApiResult<QList<Project>>::success(pages->projects));
            }
        });
}

void Connection::fetchProject(qint64 projectId, Callback<Project> done)
{
    const qint64 workspace = workspaceId();
    call<Project>(
        "GET",
        QStringLiteral("/workspaces/%1/projects/%2").arg(workspace).arg(projectId),
        QByteArray(),
        Access::Read,
        [workspace, projectId](const QJsonValue &value) -> std::optional<Project> {
            std::optional<Project> project = decodeProject(value);
            if (project && (project->id != projectId || project->workspaceId != workspace)) {
                return std::nullopt;
            }
            return project;
        },
        {},
        std::move(done));
}

void Connection::fetchRecentEntries(Callback<QList<ListedEntry>> done)
{
    // Without dates the API answers with the entries started in the last 9
    // days.
    call<QList<ListedEntry>>("GET", QStringLiteral("/me/time_entries?meta=true"), QByteArray(), Access::Read, &decodeListedEntries, {}, std::move(done));
}

void Connection::startEntry(const StartEntry &entry, Callback<TimeEntry> done)
{
    const qint64 workspace = workspaceId();
    call<TimeEntry>(
        "POST",
        QStringLiteral("/workspaces/%1/time_entries").arg(workspace),
        encodeStartEntry(entry, workspace, m_clientName),
        Access::Write,
        &decodeTimeEntry,
        [this](const TimeEntry &started) {
            m_currentEntry = started.isRunning() ? std::optional<TimeEntry>(started) : std::nullopt;
            Q_EMIT currentEntryChanged();
        },
        std::move(done));
}

void Connection::stopEntry(qint64 entryId, Callback<TimeEntry> done)
{
    call<TimeEntry>(
        "PATCH",
        QStringLiteral("/workspaces/%1/time_entries/%2/stop").arg(workspaceId()).arg(entryId),
        QByteArray(),
        Access::Write,
        &decodeTimeEntry,
        [this](const TimeEntry &stopped) {
            if (m_currentEntry && m_currentEntry->id == stopped.id) {
                m_currentEntry.reset();
                Q_EMIT currentEntryChanged();
            }
        },
        std::move(done));
}

void Connection::updateEntry(qint64 entryId, const TimeEntryUpdate &update, Callback<TimeEntry> done)
{
    call<TimeEntry>(
        "PUT",
        QStringLiteral("/workspaces/%1/time_entries/%2").arg(workspaceId()).arg(entryId),
        encodeTimeEntryUpdate(update),
        Access::Write,
        &decodeTimeEntry,
        [this](const TimeEntry &updated) {
            if (m_currentEntry && m_currentEntry->id == updated.id) {
                m_currentEntry = updated.isRunning() ? std::optional<TimeEntry>(updated) : std::nullopt;
                Q_EMIT currentEntryChanged();
            }
        },
        std::move(done));
}

void Connection::fetchPreferences(Callback<PomodoroConfig> done)
{
    call<PomodoroConfig>("GET", QStringLiteral("/me/preferences"), QByteArray(), Access::Read, &decodePomodoroPreferences, {}, std::move(done));
}

void Connection::savePreferences(const PomodoroConfigUpdate &update, Callback<PomodoroConfig> done)
{
    call<PomodoroConfig>("POST",
                         QStringLiteral("/me/preferences"),
                         encodePomodoroConfigUpdate(update),
                         Access::Write,
                         &decodePomodoroPreferences,
                         {},
                         std::move(done));
}

}
