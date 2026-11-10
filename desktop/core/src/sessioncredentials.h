#pragma once

#include "credentialstore.h"
#include "instanceurl.h"

#include <QByteArray>
#include <QObject>
#include <QPointer>
#include <QString>

#include <optional>

namespace Tokkl
{

// Reads the secret and remembers a write the store refused, but decides
// nothing about the account: Connection reacts to its signals.
class SessionCredentials : public QObject
{
    Q_OBJECT

public:
    // The store is not owned.
    explicit SessionCredentials(CredentialStore *store, QObject *parent = nullptr);

    QString instanceText() const;
    void setInstanceText(const QString &text);
    AuthMode authMode() const;
    void setAuthMode(AuthMode mode);
    QString email() const;
    void setEmail(const QString &email);
    // Invalid before the first parseInstance().
    const InstanceUrl &instance() const;
    const InstanceUrl &parseInstance();
    void clearInstance();
    bool lacksEmail() const;
    bool hasStore() const;
    // Falls back to platform-neutral text once the store is gone.
    QString message(const CredentialResult &result) const;

    // secretRead() is skipped if the settings changed or dropReads() ran since.
    // A write the store refused for these settings emits writeFailed() at once.
    void read();
    void dropReads();
    void forgetFailedWrite();

    // A secret is held and differs from secret.
    bool differs(const QString &secret) const;
    void setSecret(const QString &secret);
    void forgetSecret();
    QByteArray authorization() const;

Q_SIGNALS:
    void instanceTextChanged();
    void authModeChanged();
    void emailChanged();
    // Also when the store changed the current settings' secret.
    void changed();
    void secretRead(const Tokkl::CredentialResult &result);
    void writeFailed(Tokkl::CredentialResult::Status status);

private:
    // Kept until the next read, so a failure that arrives before the matching
    // settings still shows. Holds no secret.
    struct FailedWrite {
        QString key;
        CredentialResult::Status status;
    };

    QString currentKey() const;
    void onSecretChanged(const QString &key);
    void onSecretWriteFailed(const QString &key, const CredentialResult &result);

    QPointer<CredentialStore> m_store;

    QString m_instanceText;
    AuthMode m_authMode = AuthMode::Token;
    QString m_email;
    InstanceUrl m_instance;

    bool m_hasSecret = false;
    QString m_secret;
    QByteArray m_authorization;
    std::optional<FailedWrite> m_failedWrite;
    quint64 m_reads = 0;
};

}
