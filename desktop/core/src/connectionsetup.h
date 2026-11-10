#pragma once

#include "credentialstore.h"
#include "transport.h"

#include <QObject>
#include <QPointer>
#include <QString>

#include <functional>

namespace Tokkl
{

// A secret read or saved under one account is cleared once the page shows
// another, so it is never tested or saved under the wrong account.
class ConnectionSetup : public QObject
{
    Q_OBJECT

    Q_PROPERTY(bool busy READ isBusy NOTIFY busyChanged)
    Q_PROPERTY(QString secret READ secret NOTIFY secretChanged)
    Q_PROPERTY(QString walletError READ walletError NOTIFY walletErrorChanged)
    Q_PROPERTY(TestResult testResult READ testResult NOTIFY testFinished)
    Q_PROPERTY(QString testMessage READ testMessage NOTIFY testFinished)

public:
    enum TestResult {
        NotTested,
        Testing,
        Succeeded,
        Failed,
    };
    Q_ENUM(TestResult)

    // The page owns neither; the store must outlive it.
    ConnectionSetup(Transport *transport, CredentialStore *store, QObject *parent = nullptr);
    ~ConnectionSetup() override;

    bool isBusy() const;
    QString secret() const;
    QString walletError() const;
    TestResult testResult() const;
    QString testMessage() const;

    Q_INVOKABLE QString urlError(const QString &url) const;
    // Plain http to a host other than this machine: the secret would travel
    // unencrypted.
    Q_INVOKABLE bool isInsecure(const QString &url) const;
    // Empty when unusable. User info, query and fragment are refused, so no
    // credential is stored.
    Q_INVOKABLE QString persistedUrl(const QString &url) const;

    // Moving to another account clears a secret that belongs to the previous one.
    Q_INVOKABLE void setAccount(const QString &url, const QString &authMode, const QString &email);
    Q_INVOKABLE void editSecret(const QString &secret);
    // Unless the user typed one. A result arriving after the page moved to
    // another account is dropped.
    Q_INVOKABLE void loadSecret();
    // Writes only when the field differs from what is stored.
    Q_INVOKABLE void saveSecret();
    // done(false) means the write failed; walletError says why. done runs at
    // once when nothing is written, otherwise later while context is alive.
    void saveSecret(QObject *context, std::function<void(bool saved)> done);
    Q_INVOKABLE void testAccount();

    void testConnection(const QString &url, const QString &authMode, const QString &email, const QString &secret);

Q_SIGNALS:
    void busyChanged();
    void secretChanged();
    void walletErrorChanged();
    // Same value and timing as the other overload's done callback.
    void secretSaveFinished(bool saved);
    void testFinished();

private:
    void setBusy(int delta);
    void setSecret(const QString &secret, const QString &owner);
    void setWalletError(const QString &message);
    void finishTest(TestResult result, const QString &message);

    QPointer<Transport> m_transport;
    CredentialStore *m_store;
    int m_busy = 0;

    QString m_url;
    QString m_authMode;
    QString m_email;
    // Empty while the address or email is incomplete.
    QString m_accountKey;
    QString m_secret;
    // Empty for a typed secret not yet saved.
    QString m_secretOwner;
    QString m_storedKey;
    QString m_storedSecret;
    QString m_walletError;

    quint64 m_testSerial = 0;
    QPointer<PendingReply> m_testReply;
    TestResult m_testResult = NotTested;
    QString m_testMessage;
};

}
