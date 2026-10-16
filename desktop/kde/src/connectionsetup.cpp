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
}

ConnectionSetup::ConnectionSetup(QObject *parent)
    : ConnectionSetup(nullptr, nullptr, parent)
{
    m_transport = new NetworkTransport(this);
    m_store = KWalletCredentialStore::shared();
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

void ConnectionSetup::setBusy(int delta)
{
    const bool wasBusy = isBusy();
    m_busy += delta;
    if (wasBusy != isBusy()) {
        Q_EMIT busyChanged();
    }
}

void ConnectionSetup::loadSecret(const QString &url, const QString &authMode, const QString &email)
{
    const InstanceUrl instance = parseInstanceUrl(url);
    const AuthMode mode = authModeFromString(authMode);
    if (!instance.isValid() || (mode == AuthMode::Password && email.trimmed().isEmpty()) || !m_store) {
        Q_EMIT secretLoaded(QString());
        return;
    }
    setBusy(1);
    m_store->read(credentialKey(instance, mode, email), this, [this](const CredentialResult &result) {
        setBusy(-1);
        if (result.ok() || result.status == CredentialResult::Status::NotFound) {
            Q_EMIT secretLoaded(result.secret);
        } else {
            Q_EMIT walletFailed(result.message());
        }
    });
}

void ConnectionSetup::saveSecret(const QString &url, const QString &authMode, const QString &email, const QString &secret)
{
    const InstanceUrl instance = parseInstanceUrl(url);
    const AuthMode mode = authModeFromString(authMode);
    if (!instance.isValid() || (mode == AuthMode::Password && email.trimmed().isEmpty())) {
        return;
    }
    if (!m_store) {
        Q_EMIT walletFailed(CredentialResult{CredentialResult::Status::Unavailable, {}}.message());
        return;
    }
    setBusy(1);
    m_store->write(credentialKey(instance, mode, email), cleanSecret(mode, secret), this, [this](const CredentialResult &result) {
        setBusy(-1);
        if (result.ok()) {
            Q_EMIT secretSaved();
        } else {
            Q_EMIT walletFailed(result.message());
        }
    });
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
