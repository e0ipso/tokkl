#include "sessioncredentials.h"

#include <utility>

namespace Tokkl
{

SessionCredentials::SessionCredentials(CredentialStore *store, QObject *parent)
    : QObject(parent)
    , m_store(store)
{
    if (m_store) {
        connect(m_store, &CredentialStore::secretChanged, this, &SessionCredentials::onSecretChanged);
        connect(m_store, &CredentialStore::secretWriteFailed, this, &SessionCredentials::onSecretWriteFailed);
    }
}

QString SessionCredentials::instanceText() const
{
    return m_instanceText;
}

void SessionCredentials::setInstanceText(const QString &text)
{
    if (text == m_instanceText) {
        return;
    }
    m_instanceText = text;
    Q_EMIT instanceTextChanged();
    Q_EMIT changed();
}

AuthMode SessionCredentials::authMode() const
{
    return m_authMode;
}

void SessionCredentials::setAuthMode(AuthMode mode)
{
    if (mode == m_authMode) {
        return;
    }
    m_authMode = mode;
    Q_EMIT authModeChanged();
    Q_EMIT changed();
}

QString SessionCredentials::email() const
{
    return m_email;
}

void SessionCredentials::setEmail(const QString &email)
{
    if (email == m_email) {
        return;
    }
    // The email only identifies the account in password mode.
    const bool namesAccount = m_authMode == AuthMode::Password;
    m_email = email;
    Q_EMIT emailChanged();
    if (namesAccount) {
        Q_EMIT changed();
    }
}

const InstanceUrl &SessionCredentials::instance() const
{
    return m_instance;
}

void SessionCredentials::clearInstance()
{
    m_instance = InstanceUrl();
}

const InstanceUrl &SessionCredentials::parseInstance()
{
    m_instance = parseInstanceUrl(m_instanceText);
    return m_instance;
}

bool SessionCredentials::lacksEmail() const
{
    return m_authMode == AuthMode::Password && m_email.trimmed().isEmpty();
}

bool SessionCredentials::hasStore() const
{
    return m_store;
}

QString SessionCredentials::message(const CredentialResult &result) const
{
    return m_store ? m_store->message(result) : result.message();
}

QString SessionCredentials::currentKey() const
{
    return credentialKey(m_instance, m_authMode, m_email);
}

void SessionCredentials::read()
{
    if (!m_store) {
        return;
    }
    const quint64 reads = m_reads;
    const QString key = currentKey();
    const std::optional<FailedWrite> failedWrite = std::exchange(m_failedWrite, std::nullopt);
    if (failedWrite && failedWrite->key == key) {
        Q_EMIT writeFailed(failedWrite->status);
        return;
    }
    m_store->read(key, this, [this, reads, key](const CredentialResult &result) {
        if (reads == m_reads && key == currentKey()) {
            Q_EMIT secretRead(result);
        }
    });
}

void SessionCredentials::dropReads()
{
    ++m_reads;
}

void SessionCredentials::forgetFailedWrite()
{
    m_failedWrite.reset();
}

bool SessionCredentials::differs(const QString &secret) const
{
    return m_hasSecret && secret != m_secret;
}

void SessionCredentials::setSecret(const QString &secret)
{
    m_hasSecret = true;
    m_secret = secret;
    m_authorization = basicAuthorization(m_authMode, m_email, m_secret);
}

void SessionCredentials::forgetSecret()
{
    m_hasSecret = false;
    m_secret.clear();
    m_authorization.clear();
}

QByteArray SessionCredentials::authorization() const
{
    return m_authorization;
}

void SessionCredentials::onSecretChanged(const QString &key)
{
    if (m_failedWrite && m_failedWrite->key == key) {
        m_failedWrite.reset();
    }
    if (m_instance.isValid() && key == currentKey()) {
        Q_EMIT changed();
    }
}

void SessionCredentials::onSecretWriteFailed(const QString &key, const CredentialResult &result)
{
    if (m_instance.isValid() && key == currentKey()) {
        m_failedWrite.reset();
        Q_EMIT writeFailed(result.status);
        return;
    }
    // The settings for that key may still be on their way, as when a
    // settings page saves the secret before the settings.
    m_failedWrite = FailedWrite{key, result.status};
}

}
