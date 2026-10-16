#pragma once

#include <QObject>
#include <QPointer>
#include <QString>

#include <functional>
#include <memory>

namespace KWallet
{
class Wallet;
}

namespace Tokkl
{

struct CredentialResult {
    enum class Status {
        Ok,
        NotFound, // no secret stored under the key
        Disabled, // the wallet subsystem is turned off
        Unavailable, // locked and not unlocked, or access denied
        Failed, // the wallet opened but the read or write failed
    };

    Status status = Status::Failed;
    QString secret; // only for a successful read

    bool ok() const
    {
        return status == Status::Ok;
    }

    // A message for the user. It never contains the secret.
    QString message() const;
};

// Where secrets live. There is no plaintext fallback: when the store fails,
// the secret is not kept anywhere else.
class CredentialStore : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;
    using Callback = std::function<void(const CredentialResult &)>;

    // Callbacks run later, from the event loop, and only while the context
    // object is alive.
    virtual void read(const QString &key, QObject *context, Callback done) = 0;
    virtual void write(const QString &key, const QString &secret, QObject *context, Callback done) = 0;

Q_SIGNALS:
    // This store wrote a secret under the key.
    void secretChanged(const QString &key);
};

// The user's network wallet, folder "Tokkl", opened asynchronously so a
// locked wallet prompts without blocking plasmashell.
class KWalletCredentialStore : public CredentialStore
{
    Q_OBJECT

public:
    explicit KWalletCredentialStore(QObject *parent = nullptr);
    ~KWalletCredentialStore() override;

    void read(const QString &key, QObject *context, Callback done) override;
    void write(const QString &key, const QString &secret, QObject *context, Callback done) override;

    // The store for the whole process, owned by the application. The panel
    // and the Configure dialog share it, so the panel hears about a new
    // secret, and a write finishes even after the dialog closes.
    static KWalletCredentialStore *shared();

    static const QString folder;

private:
    using Operation = std::function<void(KWallet::Wallet *wallet, CredentialResult::Status openStatus)>;
    void withWallet(Operation operation);
    void onWalletOpened(bool success);
    void runQueue(CredentialResult::Status status);

    std::unique_ptr<KWallet::Wallet> m_wallet;
    bool m_opening = false;
    QList<Operation> m_queue;
};

}
