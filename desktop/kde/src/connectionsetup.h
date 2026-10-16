#pragma once

#include "credentialstore.h"
#include "transport.h"

#include <QObject>
#include <QPointer>
#include <QString>

namespace Tokkl
{

// Backs the Configure page: checks the address, loads and saves the secret in
// the credential store, and tests unsaved settings through GET /api/v9/me.
// Only nonsecret settings go to the widget configuration.
class ConnectionSetup : public QObject
{
    Q_OBJECT

    Q_PROPERTY(bool busy READ isBusy NOTIFY busyChanged)
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

    explicit ConnectionSetup(QObject *parent = nullptr);
    ConnectionSetup(Transport *transport, CredentialStore *store, QObject *parent = nullptr);
    ~ConnectionSetup() override;

    bool isBusy() const;
    TestResult testResult() const;
    QString testMessage() const;

    // An error message for the address, or an empty string when it is usable.
    Q_INVOKABLE QString urlError(const QString &url) const;
    // True for plain http to a host other than this machine: the secret would
    // travel unencrypted.
    Q_INVOKABLE bool isInsecure(const QString &url) const;

    // Emits secretLoaded or walletFailed.
    Q_INVOKABLE void loadSecret(const QString &url, const QString &authMode, const QString &email);
    // Emits secretSaved or walletFailed.
    Q_INVOKABLE void saveSecret(const QString &url, const QString &authMode, const QString &email, const QString &secret);
    // Updates testResult and testMessage, then emits testFinished.
    Q_INVOKABLE void testConnection(const QString &url, const QString &authMode, const QString &email, const QString &secret);

Q_SIGNALS:
    void busyChanged();
    void secretLoaded(const QString &secret);
    void secretSaved();
    void walletFailed(const QString &message);
    void testFinished();

private:
    void setBusy(int delta);
    void finishTest(TestResult result, const QString &message);

    QPointer<Transport> m_transport;
    QPointer<CredentialStore> m_store;
    int m_busy = 0;
    quint64 m_testSerial = 0;
    QPointer<PendingReply> m_testReply;
    TestResult m_testResult = NotTested;
    QString m_testMessage;
};

}
