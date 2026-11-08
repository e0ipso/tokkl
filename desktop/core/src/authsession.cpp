#include "authsession.h"

#include "logging.h"

#include <QRandomGenerator>

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

bool refusesCredentials(const ApiError &error)
{
    return error.kind == ApiError::Kind::Forbidden || error.kind == ApiError::Kind::Unauthorized;
}

}

AuthSession::AuthSession(Transport *transport, CredentialStore *store, QObject *parent)
    : QObject(parent)
    , m_credentials(store)
    , m_api(transport, *this)
{
    connect(&m_credentials, &SessionCredentials::instanceTextChanged, this, &AuthSession::instanceTextChanged);
    connect(&m_credentials, &SessionCredentials::authModeChanged, this, &AuthSession::authModeChanged);
    connect(&m_credentials, &SessionCredentials::emailChanged, this, &AuthSession::emailChanged);
    connect(&m_credentials, &SessionCredentials::changed, this, &AuthSession::settingsChanged);
    connect(&m_credentials, &SessionCredentials::secretRead, this, &AuthSession::onSecretRead);
    connect(&m_credentials, &SessionCredentials::writeFailed, this, &AuthSession::showFailedWrite);
    connect(&m_cooldown, &Cooldown::ended, this, &AuthSession::onCooldownEnded);
    m_retryTimer.setSingleShot(true);
    connect(&m_retryTimer, &QTimer::timeout, this, &AuthSession::refreshAccount);
}

QString AuthSession::instanceText() const
{
    return m_credentials.instanceText();
}

void AuthSession::setInstanceText(const QString &text)
{
    m_credentials.setInstanceText(text);
}

AuthMode AuthSession::authMode() const
{
    return m_credentials.authMode();
}

void AuthSession::setAuthMode(AuthMode mode)
{
    m_credentials.setAuthMode(mode);
}

QString AuthSession::email() const
{
    return m_credentials.email();
}

void AuthSession::setEmail(const QString &email)
{
    m_credentials.setEmail(email);
}

const InstanceUrl &AuthSession::instance() const
{
    return m_credentials.instance();
}

AuthSession::State AuthSession::state() const
{
    return m_state;
}

QString AuthSession::errorString() const
{
    return m_error;
}

bool AuthSession::hasAccount() const
{
    return m_context.has_value() && m_context->generation == m_generation;
}

bool AuthSession::canWrite() const
{
    return hasAccount() && !m_authPaused && !m_cooldown.active();
}

QDateTime AuthSession::rateLimitedUntil() const
{
    return m_cooldown.until();
}

std::optional<Me> AuthSession::account() const
{
    if (!hasAccount()) {
        return std::nullopt;
    }
    return m_context->me;
}

ServerApi AuthSession::server() const
{
    // An account binds only after the announcement of its generation.
    return hasAccount() && m_announcement.generation == m_generation && m_announcement.known ? m_announcement.server : ServerApi();
}

ApiClient &AuthSession::api()
{
    return m_api;
}

// ----- configuration and credentials ---------------------------------------

void AuthSession::settingsChanged()
{
    // Another instance or account: nothing from the old one may stay visible,
    // and its secret, pause and cooldown do not carry over.
    resetAccount();
    m_credentials.forgetSecret();
    m_authPaused = false;
    m_cooldown.clear();
    m_retryTimer.stop();
    m_credentials.clearInstance();
    setState(m_credentials.instanceText().trimmed().isEmpty() ? Unconfigured : LoadingCredentials);
    scheduleReload();
}

void AuthSession::scheduleReload()
{
    // QML sets the three settings one after another; read the wallet once.
    if (m_reloadScheduled) {
        return;
    }
    m_reloadScheduled = true;
    QMetaObject::invokeMethod(this, &AuthSession::reload, Qt::QueuedConnection);
}

void AuthSession::reload()
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

    if (!hasAccount()) {
        setState(LoadingCredentials);
    }
    m_credentials.read();
}

void AuthSession::onSecretRead(const CredentialResult &result)
{
    if (!result.ok()) {
        qCWarning(lcCredentials) << "Reading the secret failed:" << result.status;
        // Without the secret nothing can be validated or written.
        if (hasAccount()) {
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

void AuthSession::showFailedWrite(CredentialResult::Status status)
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

void AuthSession::reconnect()
{
    m_credentials.forgetFailedWrite();
    m_authPaused = false;
    if (m_reloadScheduled) {
        return;
    }
    reload();
}

void AuthSession::refreshAccount()
{
    if (m_authPaused || m_credentials.authorization().isEmpty()) {
        return;
    }
    authenticate(false);
}

// ----- authentication ------------------------------------------------------

void AuthSession::authenticate(bool explicitRequest)
{
    m_retryTimer.stop();
    if (m_authPaused && !explicitRequest) {
        return;
    }
    if (m_cooldown.active()) {
        setState(RateLimited, m_error);
        return;
    }
    if (!hasAccount()) {
        setState(Connecting);
    }
    if (m_announcement.generation != m_generation || (!m_announcement.pending && !m_announcement.known)) {
        readAnnouncement();
    } else if (!m_announcement.pending) {
        sendMe();
    }
    // Otherwise the read in flight sends /me once it settles.
}

void AuthSession::readAnnouncement()
{
    // Its answer never touches the session state. Until the server answers,
    // the routes are those of a server without the announcement, and the
    // next /me of the generation, such as the retry after a connectivity
    // failure, asks again. An answer, with the fields or without, or a
    // refusal holds for the generation.
    m_announcement = Announcement{m_generation, true, false, ServerApi()};
    m_api.send("GET", instance().app(QStringLiteral("/status")), QByteArray(), [this](const HttpResponse &response) {
        m_announcement.pending = false;
        m_announcement.known = response.outcome == HttpResponse::Outcome::Finished && response.status < 500;
        m_announcement.server = serverApiFromResponse(response);
        sendMe();
    });
}

void AuthSession::sendMe()
{
    m_api.send("GET", instance().api(QStringLiteral("/me")), QByteArray(), [this](const HttpResponse &response) {
        handleMe(response);
    });
}

void AuthSession::handleMe(const HttpResponse &response)
{
    const ApiResult<Me> me = meFromResponse(response);
    if (me.ok()) {
        bind(*me.value);
        return;
    }

    const ApiError &error = me.error;
    switch (error.kind) {
    case ApiError::Kind::Forbidden:
    case ApiError::Kind::Unauthorized:
        refuseCredentials(error);
        return;
    case ApiError::Kind::RateLimited:
        startCooldown(response.retryAfter, error.message);
        return;
    case ApiError::Kind::Network:
    case ApiError::Kind::Timeout:
    case ApiError::Kind::Server:
        // Not an authentication failure. A bound account stays, marked stale.
        setState(Disconnected, error.message);
        if (!hasAccount()) {
            m_retryTimer.start(retryDelayMs + int(QRandomGenerator::global()->bounded(retryJitterMs)));
        }
        return;
    default:
        resetAccount();
        setState(Error, error.message);
        return;
    }
}

void AuthSession::fetchMe(ApiClient::Callback<Me> done)
{
    m_api.call<Me>("GET", instance().api(QStringLiteral("/me")), QByteArray(), ApiAccess::Account, &decodeMe, [this, done](const ApiResult<Me> &result) {
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
void AuthSession::refuseCredentials(const ApiError &error)
{
    pauseAuthentication(tr("The instance refused these credentials (%1). Check them in the widget settings, then reconnect.").arg(error.message));
}

void AuthSession::pauseAuthentication(const QString &message)
{
    resetAccount();
    m_authPaused = true;
    setState(AuthenticationFailed, message);
}

void AuthSession::bind(const Me &me)
{
    if (hasAccount() && (m_context->me.id != me.id || m_context->me.defaultWorkspaceId != me.defaultWorkspaceId)) {
        // The same credentials now name another account or workspace. The
        // instance is the same, so what it announced still holds.
        resetAccount();
        m_announcement.generation = m_generation;
    }
    const bool changed = !hasAccount() || m_context->me != me;
    m_context = Context{m_generation, me};
    setState(Connected);
    if (changed) {
        Q_EMIT accountChanged();
    }
}

void AuthSession::resetAccount()
{
    ++m_generation;
    qCDebug(lcAuth) << "Generation" << m_generation;
    // A secret read sent before belongs to the old generation.
    m_credentials.dropReads();
    m_api.abortAll();
    clearAccount();
    Q_EMIT generationChanged();
}

void AuthSession::clearAccount()
{
    const bool hadAccount = m_context.has_value();
    m_context.reset();
    if (hadAccount) {
        Q_EMIT accountChanged();
        Q_EMIT stateChanged();
    }
    Q_EMIT accountCleared();
}

void AuthSession::setState(State state, const QString &error)
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

void AuthSession::startCooldown(const QByteArray &retryAfter, const QString &message)
{
    m_cooldown.start(retryAfter);
    setState(RateLimited, message);
}

void AuthSession::onCooldownEnded()
{
    if (m_state != RateLimited) {
        Q_EMIT stateChanged();
        return;
    }
    if (hasAccount()) {
        setState(Connected);
    } else if (!m_authPaused && !m_credentials.authorization().isEmpty()) {
        authenticate(false);
    } else {
        Q_EMIT stateChanged();
    }
}

// ----- ApiSession ----------------------------------------------------------

quint64 AuthSession::generation() const
{
    return m_generation;
}

QByteArray AuthSession::authorization() const
{
    return m_credentials.authorization();
}

std::optional<ApiError> AuthSession::refusal(ApiAccess access) const
{
    if (!hasAccount()) {
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

void AuthSession::answered()
{
    if (m_state == Disconnected) {
        setState(Connected);
    }
}

bool AuthSession::absorbFailure(const HttpResponse &response, const ApiError &error, ApiAccess access)
{
    if (error.kind == ApiError::Kind::RateLimited) {
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

}
