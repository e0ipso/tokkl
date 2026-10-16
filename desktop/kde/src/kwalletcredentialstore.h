#pragma once

#include "credentialstore.h"

#include <QList>
#include <QString>

#include <functional>
#include <memory>

namespace KWallet
{
class Wallet;
}

namespace Tokkl
{

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
    // Names KDE Wallet and System Settings.
    QString message(const CredentialResult &result) const override;

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
