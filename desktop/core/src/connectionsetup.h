#pragma once

#include "credentialstore.h"
#include "transport.h"

#include <QObject>
#include <QPointer>
#include <QString>

#include <functional>

namespace Tokkl
{

// Backs the Configure page: checks the address, loads and saves the secret in
// the credential store, and tests unsaved settings through GET /api/v9/me.
// Only nonsecret settings go to the widget configuration.
//
// The page reports the account on screen with setAccount() and what the user
// types with editSecret(). The secret field belongs to one account: a secret
// read from the store, or saved under an account, is cleared as soon as the
// page shows another account, so it is never tested against or saved under
// that one. A secret the user typed stays until it is saved.
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

    // Uses the given transport and store; the page does not own them.
    ConnectionSetup(Transport *transport, CredentialStore *store, QObject *parent = nullptr);
    ~ConnectionSetup() override;

    bool isBusy() const;
    // The text for the secret field.
    QString secret() const;
    // Why the last wallet read or write failed, or an empty string.
    QString walletError() const;
    TestResult testResult() const;
    QString testMessage() const;

    // An error message for the address, or an empty string when it is usable.
    Q_INVOKABLE QString urlError(const QString &url) const;
    // True for plain http to a host other than this machine: the secret would
    // travel unencrypted.
    Q_INVOKABLE bool isInsecure(const QString &url) const;
    // The address to keep in the widget configuration: normalized, with any
    // path prefix, or an empty string when the address is not usable. User
    // info, queries and fragments are refused, so no credential is stored.
    Q_INVOKABLE QString persistedUrl(const QString &url) const;

    // The address, sign-in method and email on screen. Moving to another
    // account clears a secret that belongs to the previous one.
    Q_INVOKABLE void setAccount(const QString &url, const QString &authMode, const QString &email);
    // The user changed the secret field.
    Q_INVOKABLE void editSecret(const QString &secret);
    // Reads the stored secret of the current account into the field, unless
    // the user typed one. A result that arrives after the page moved to
    // another account is dropped.
    Q_INVOKABLE void loadSecret();
    // Saves the field under the current account, when it differs from what
    // is stored there.
    Q_INVOKABLE void saveSecret();
    // As saveSecret(), then calls done with true once the store has kept the
    // secret or when there was nothing to write, and with false when the
    // write failed; walletError says why. done runs at once when nothing is
    // written, and otherwise later, from the event loop, while context is
    // alive.
    void saveSecret(QObject *context, std::function<void(bool saved)> done);
    // Tests the current account with the secret in the field.
    Q_INVOKABLE void testAccount();

    // Updates testResult and testMessage, then emits testFinished.
    void testConnection(const QString &url, const QString &authMode, const QString &email, const QString &secret);

Q_SIGNALS:
    void busyChanged();
    void secretChanged();
    void walletErrorChanged();
    void testFinished();

private:
    void setBusy(int delta);
    void setSecret(const QString &secret, const QString &owner);
    void setWalletError(const QString &message);
    QString credentialMessage(const CredentialResult &result) const;
    void finishTest(TestResult result, const QString &message);

    QPointer<Transport> m_transport;
    QPointer<CredentialStore> m_store;
    int m_busy = 0;

    QString m_url;
    QString m_authMode;
    QString m_email;
    // The credential key of the account on screen; empty while the address
    // or email is incomplete.
    QString m_accountKey;
    QString m_secret;
    // The key the field's secret was read from or saved under; empty for a
    // secret the user typed and has not saved.
    QString m_secretOwner;
    // What the store holds, as far as this page knows, and under which key.
    QString m_storedKey;
    QString m_storedSecret;
    QString m_walletError;

    quint64 m_testSerial = 0;
    QPointer<PendingReply> m_testReply;
    TestResult m_testResult = NotTested;
    QString m_testMessage;
};

}
