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

// The settings of one session, which name the instance, the sign-in mode
// and, for passwords, the email, and the secret the credential store holds
// for them.
//
// It reads the secret and remembers a write the store refused, but decides
// nothing about the account: Connection reacts to its signals.
class SessionCredentials : public QObject
{
    Q_OBJECT

public:
    // Uses the given store, which it does not own.
    explicit SessionCredentials(CredentialStore *store, QObject *parent = nullptr);

    QString instanceText() const;
    void setInstanceText(const QString &text);
    AuthMode authMode() const;
    void setAuthMode(AuthMode mode);
    QString email() const;
    void setEmail(const QString &email);
    // The instance of the last parseInstance(); invalid before one.
    const InstanceUrl &instance() const;
    const InstanceUrl &parseInstance();
    void clearInstance();
    // Password mode without an email.
    bool lacksEmail() const;
    bool hasStore() const;
    // The store's wording for result, or the platform-neutral text once the
    // store is gone.
    QString message(const CredentialResult &result) const;

    // Reads the secret of the current settings. Emits secretRead() with the
    // answer, unless the settings changed or dropReads() ran since. A write
    // the store refused for these settings is reported with writeFailed()
    // instead, at once.
    void read();
    // Answers to reads sent before are dropped.
    void dropReads();
    void forgetFailedWrite();

    // A secret is held and differs from secret.
    bool differs(const QString &secret) const;
    void setSecret(const QString &secret);
    void forgetSecret();
    // The Authorization header for the secret held; empty without one.
    QByteArray authorization() const;

Q_SIGNALS:
    void instanceTextChanged();
    void authModeChanged();
    void emailChanged();
    // A setting that names the account changed, or the store changed the
    // secret of the current settings.
    void changed();
    void secretRead(const Tokkl::CredentialResult &result);
    // The store did not save the secret of the current settings.
    void writeFailed(Tokkl::CredentialResult::Status status);

private:
    // A write the store refused, kept until the next read so a failure that
    // arrives before the matching settings is still shown. No secret.
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
    // Advanced by dropReads(); reads sent before are ignored.
    quint64 m_reads = 0;
};

}
