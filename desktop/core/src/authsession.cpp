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
    , m_store(store)
    , m_api(transport, *this)
{
    connect(&m_cooldown, &Cooldown::ended, this, &AuthSession::onCooldownEnded);
    m_retryTimer.setSingleShot(true);
    connect(&m_retryTimer, &QTimer::timeout, this, &AuthSession::refreshAccount);
    if (m_store) {
        connect(m_store, &CredentialStore::secretChanged, this, &AuthSession::onSecretChanged);
        connect(m_store, &CredentialStore::secretWriteFailed, this, &AuthSession::onSecretWriteFailed);
    }
}

QString AuthSession::instanceText() const
{
    return m_instanceText;
}

void AuthSession::setInstanceText(const QString &text)
{
    if (text == m_instanceText) {
        return;
    }
    m_instanceText = text;
    Q_EMIT instanceTextChanged();
    settingsChanged();
}

AuthMode AuthSession::authMode() const
{
    return m_authMode;
}

void AuthSession::setAuthMode(AuthMode mode)
{
    if (mode == m_authMode) {
        return;
    }
    m_authMode = mode;
    Q_EMIT authModeChanged();
    settingsChanged();
}

QString AuthSession::email() const
{
    return m_email;
}

void AuthSession::setEmail(const QString &email)
{
    if (email == m_email) {
        return;
    }
    // The email only identifies the account in password mode.
    const bool contextChanges = m_authMode == AuthMode::Password;
    m_email = email;
    Q_EMIT emailChanged();
    if (contextChanges) {
        settingsChanged();
    }
}

const InstanceUrl &AuthSession::instance() const
{
    return m_instance;
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
    forgetSecret();
    m_authPaused = false;
    m_cooldown.clear();
    m_retryTimer.stop();
    m_instance = InstanceUrl();
    setState(m_instanceText.trimmed().isEmpty() ? Unconfigured : LoadingCredentials);
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

QString AuthSession::currentCredentialKey() const
{
    return credentialKey(m_instance, m_authMode, m_email);
}

// The store's own wording, or the platform-neutral text once the store is gone.
QString AuthSession::credentialMessage(const CredentialResult &result) const
{
    return m_store ? m_store->message(result) : result.message();
}

void AuthSession::forgetSecret()
{
    m_hasSecret = false;
    m_secret.clear();
    m_authorization.clear();
}

void AuthSession::reload()
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

    if (!hasAccount()) {
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
        if (generation == m_generation && key == currentCredentialKey()) {
            onSecretRead(result);
        }
    });
}

void AuthSession::onSecretRead(const CredentialResult &result)
{
    if (!result.ok()) {
        qCWarning(lcCredentials) << "Reading the secret failed:" << result.status;
        // Without the secret nothing can be validated or written.
        if (hasAccount()) {
            resetAccount();
        }
        forgetSecret();
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
}

void AuthSession::onSecretChanged(const QString &key)
{
    if (m_failedWrite && m_failedWrite->key == key) {
        m_failedWrite.reset();
    }
    if (m_instance.isValid() && key == currentCredentialKey()) {
        settingsChanged();
    }
}

void AuthSession::onSecretWriteFailed(const QString &key, const CredentialResult &result)
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

void AuthSession::showFailedWrite(CredentialResult::Status status)
{
    qCWarning(lcCredentials) << "The store did not save the secret:" << status;
    // A new generation, so a read issued before the failure cannot replace
    // this error. What the store now holds for the key is not what the user
    // entered, so nothing is validated or written with it.
    resetAccount();
    m_retryTimer.stop();
    forgetSecret();
    setState(WalletError, tr("The new credentials were not saved. %1").arg(credentialMessage(CredentialResult{status, {}})));
}

void AuthSession::reconnect()
{
    m_failedWrite.reset();
    m_authPaused = false;
    if (m_reloadScheduled) {
        return;
    }
    reload();
}

void AuthSession::refreshAccount()
{
    if (m_authPaused || m_authorization.isEmpty()) {
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
    m_api.send("GET", m_instance.api(QStringLiteral("/me")), QByteArray(), [this](const HttpResponse &response) {
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
    m_api.call<Me>("GET", m_instance.api(QStringLiteral("/me")), QByteArray(), ApiAccess::Account, &decodeMe, [this, done](const ApiResult<Me> &result) {
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
        // The same credentials now name another account or workspace.
        resetAccount();
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
    } else if (!m_authPaused && !m_authorization.isEmpty()) {
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
    return m_authorization;
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
