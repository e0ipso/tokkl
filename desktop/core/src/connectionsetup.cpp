#include "connectionsetup.h"

#include "apitypes.h"
#include "instanceurl.h"

#include <QCoreApplication>
#include <QHostAddress>

namespace Tokkl
{

namespace
{
// API tokens never contain spaces, so pasted whitespace is dropped. Passwords
// are used exactly as typed.
QString cleanSecret(AuthMode mode, const QString &secret)
{
    return mode == AuthMode::Token ? secret.trimmed() : secret;
}

// The credential key of an account, or an empty string while the address or
// the email for password sign-in is not usable.
QString accountKey(const QString &url, const QString &authMode, const QString &email)
{
    const InstanceUrl instance = parseInstanceUrl(url);
    const AuthMode mode = authModeFromString(authMode);
    if (!instance.isValid() || (mode == AuthMode::Password && email.trimmed().isEmpty())) {
        return QString();
    }
    return credentialKey(instance, mode, email);
}
}

ConnectionSetup::ConnectionSetup(Transport *transport, CredentialStore *store, QObject *parent)
    : QObject(parent)
    , m_transport(transport)
    , m_store(store)
{
}

ConnectionSetup::~ConnectionSetup()
{
    if (m_testReply) {
        disconnect(m_testReply, nullptr, this, nullptr);
        m_testReply->abort();
        m_testReply->deleteLater();
    }
}

bool ConnectionSetup::isBusy() const
{
    return m_busy > 0;
}

QString ConnectionSetup::secret() const
{
    return m_secret;
}

QString ConnectionSetup::walletError() const
{
    return m_walletError;
}

ConnectionSetup::TestResult ConnectionSetup::testResult() const
{
    return m_testResult;
}

QString ConnectionSetup::testMessage() const
{
    return m_testMessage;
}

QString ConnectionSetup::urlError(const QString &url) const
{
    return parseInstanceUrl(url).error;
}

bool ConnectionSetup::isInsecure(const QString &url) const
{
    const InstanceUrl instance = parseInstanceUrl(url);
    if (!instance.isValid() || instance.base.scheme() != QLatin1String("http")) {
        return false;
    }
    const QString host = instance.base.host();
    const QHostAddress address(host);
    return host != QLatin1String("localhost") && !address.isLoopback();
}

QString ConnectionSetup::persistedUrl(const QString &url) const
{
    const InstanceUrl instance = parseInstanceUrl(url);
    return instance.isValid() ? instance.key() : QString();
}

void ConnectionSetup::setBusy(int delta)
{
    const bool wasBusy = isBusy();
    m_busy += delta;
    if (wasBusy != isBusy()) {
        Q_EMIT busyChanged();
    }
}

void ConnectionSetup::setSecret(const QString &secret, const QString &owner)
{
    m_secretOwner = owner;
    if (m_secret != secret) {
        m_secret = secret;
        Q_EMIT secretChanged();
    }
}

void ConnectionSetup::setWalletError(const QString &message)
{
    if (m_walletError != message) {
        m_walletError = message;
        Q_EMIT walletErrorChanged();
    }
}

// The store's own wording, or the platform-neutral text once the store is gone.
QString ConnectionSetup::credentialMessage(const CredentialResult &result) const
{
    return m_store ? m_store->message(result) : result.message();
}

void ConnectionSetup::setAccount(const QString &url, const QString &authMode, const QString &email)
{
    m_url = url;
    m_authMode = authMode;
    m_email = email;
    const QString key = accountKey(url, authMode, email);
    if (key == m_accountKey) {
        return;
    }
    m_accountKey = key;
    if (!m_secretOwner.isEmpty() && m_secretOwner != key) {
        // The field holds another account's secret.
        setSecret(QString(), QString());
    }
}

void ConnectionSetup::editSecret(const QString &secret)
{
    setSecret(secret, QString());
}

void ConnectionSetup::loadSecret()
{
    const QString key = m_accountKey;
    if (key.isEmpty() || !m_store) {
        return;
    }
    setBusy(1);
    m_store->read(key, this, [this, key](const CredentialResult &result) {
        setBusy(-1);
        if (key != m_accountKey) {
            return; // the page shows another account now
        }
        if (!result.ok() && result.status != CredentialResult::Status::NotFound) {
            setWalletError(credentialMessage(result));
            return;
        }
        setWalletError(QString());
        m_storedKey = key;
        m_storedSecret = result.secret;
        // Keep what the user typed; Apply saves it under this account.
        if (m_secretOwner == key || m_secret.isEmpty()) {
            setSecret(result.secret, key);
        }
    });
}

void ConnectionSetup::saveSecret()
{
    saveSecret(this, [](bool) { });
}

void ConnectionSetup::saveSecret(QObject *context, std::function<void(bool saved)> done)
{
    const QString key = m_accountKey;
    const AuthMode mode = authModeFromString(m_authMode);
    const QString submitted = m_secret;
    const QString cleaned = cleanSecret(mode, submitted);
    if (key.isEmpty() || cleaned.isEmpty() || (key == m_storedKey && submitted == m_storedSecret)) {
        done(true);
        return;
    }
    // From now on the field belongs to this account.
    m_secretOwner = key;
    if (!m_store) {
        setWalletError(CredentialResult{CredentialResult::Status::Unavailable, {}}.message());
        done(false);
        return;
    }
    setWalletError(QString());
    setBusy(1);
    QPointer<QObject> guard(context);
    m_store->write(key, cleaned, this, [this, key, submitted, guard, done](const CredentialResult &result) {
        setBusy(-1);
        if (result.ok()) {
            m_storedKey = key;
            m_storedSecret = submitted;
        } else {
            setWalletError(credentialMessage(result));
        }
        if (guard) {
            done(result.ok());
        }
    });
}

void ConnectionSetup::testAccount()
{
    testConnection(m_url, m_authMode, m_email, m_secret);
}

void ConnectionSetup::testConnection(const QString &url, const QString &authMode, const QString &email, const QString &secret)
{
    if (m_testReply) {
        disconnect(m_testReply, nullptr, this, nullptr);
        m_testReply->abort();
        m_testReply->deleteLater();
        setBusy(-1);
    }
    const quint64 serial = ++m_testSerial;

    const InstanceUrl instance = parseInstanceUrl(url);
    const AuthMode mode = authModeFromString(authMode);
    const QString cleaned = cleanSecret(mode, secret);
    if (!instance.isValid()) {
        finishTest(Failed, instance.error);
        return;
    }
    if (mode == AuthMode::Password && email.trimmed().isEmpty()) {
        finishTest(Failed, tr("Enter the email address of your Tokkl account."));
        return;
    }
    if (cleaned.isEmpty()) {
        finishTest(Failed, mode == AuthMode::Token ? tr("Enter your API token.") : tr("Enter your password."));
        return;
    }
    if (!m_transport) {
        finishTest(Failed, tr("Could not reach the Tokkl instance."));
        return;
    }

    m_testResult = Testing;
    m_testMessage.clear();
    Q_EMIT testFinished();
    setBusy(1);
    PendingReply *reply = m_transport->send(HttpRequest{"GET", instance.api(QStringLiteral("/me")), basicAuthorization(mode, email, cleaned), QByteArray()});
    m_testReply = reply;
    connect(reply, &PendingReply::finished, this, [this, reply, serial](const HttpResponse &response) {
        reply->deleteLater();
        if (serial != m_testSerial) {
            return;
        }
        m_testReply.clear();
        setBusy(-1);
        if (response.outcome == HttpResponse::Outcome::Finished && response.status >= 200 && response.status < 300) {
            const std::optional<QJsonValue> json = parseJsonBody(response.body);
            const std::optional<Me> me = json ? decodeMe(*json) : std::nullopt;
            if (!me) {
                finishTest(Failed, tr("The address did not answer like a Tokkl instance. Check the instance URL."));
                return;
            }
            const QString name = me->fullname.isEmpty() ? me->email : QStringLiteral("%1 (%2)").arg(me->fullname, me->email);
            finishTest(Succeeded, tr("Connected as %1, workspace %2.").arg(name).arg(me->defaultWorkspaceId));
            return;
        }
        const ApiError error = errorFromResponse(response);
        if (error.kind == ApiError::Kind::Forbidden || error.kind == ApiError::Kind::Unauthorized) {
            finishTest(Failed, tr("The instance refused these credentials (%1).").arg(error.message));
        } else {
            finishTest(Failed, error.message);
        }
    });
}

void ConnectionSetup::finishTest(TestResult result, const QString &message)
{
    m_testResult = result;
    m_testMessage = message;
    Q_EMIT testFinished();
}

}
