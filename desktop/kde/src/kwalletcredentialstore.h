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

// Opens the wallet asynchronously so a locked wallet's prompt does not
// block plasmashell.
class KWalletCredentialStore : public CredentialStore
{
    Q_OBJECT

public:
    explicit KWalletCredentialStore(QObject *parent = nullptr);
    ~KWalletCredentialStore() override;

    void read(const QString &key, QObject *context, Callback done) override;
    void write(const QString &key, const QString &secret, QObject *context, Callback done) override;
    QString message(const CredentialResult &result) const override;

    // Shared by the panel and the Configure dialog, so the panel hears of a
    // new secret and a write finishes after the dialog closes.
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
