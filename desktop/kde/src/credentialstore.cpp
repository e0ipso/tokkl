#include "credentialstore.h"

#include <KWallet>

#include <QCoreApplication>

#include <utility>

namespace Tokkl
{

namespace
{
void deliver(QObject *context, const CredentialStore::Callback &done, const CredentialResult &result)
{
    QMetaObject::invokeMethod(
        context,
        [done, result] {
            done(result);
        },
        Qt::QueuedConnection);
}
}

QString CredentialResult::message() const
{
    switch (status) {
    case Status::Ok:
        return QString();
    case Status::NotFound:
        return QCoreApplication::translate("Tokkl::CredentialStore", "No credentials are saved for this instance. Enter them in the widget settings.");
    case Status::Disabled:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "KDE Wallet is disabled. Enable it in System Settings to save Tokkl credentials; Tokkl does not store them anywhere else.");
    case Status::Unavailable:
        return QCoreApplication::translate("Tokkl::CredentialStore", "KDE Wallet is locked or denied access to Tokkl. Unlock the wallet and allow access, then try again.");
    case Status::Failed:
        break;
    }
    return QCoreApplication::translate("Tokkl::CredentialStore", "KDE Wallet could not read or save the Tokkl credentials.");
}

const QString KWalletCredentialStore::folder = QStringLiteral("Tokkl");

KWalletCredentialStore::KWalletCredentialStore(QObject *parent)
    : CredentialStore(parent)
{
}

KWalletCredentialStore *KWalletCredentialStore::shared()
{
    static QPointer<KWalletCredentialStore> instance;
    if (!instance) {
        instance = new KWalletCredentialStore(QCoreApplication::instance());
    }
    return instance;
}

KWalletCredentialStore::~KWalletCredentialStore() = default;

void KWalletCredentialStore::read(const QString &key, QObject *context, Callback done)
{
    QPointer<QObject> guard(context);
    withWallet([key, guard, done](KWallet::Wallet *wallet, CredentialResult::Status openStatus) {
        if (!guard) {
            return;
        }
        CredentialResult result;
        result.status = openStatus;
        if (wallet) {
            if (!wallet->hasEntry(key)) {
                result.status = CredentialResult::Status::NotFound;
            } else if (wallet->readPassword(key, result.secret) == 0) {
                result.status = CredentialResult::Status::Ok;
            } else {
                result.status = CredentialResult::Status::Failed;
                result.secret.clear();
            }
        }
        deliver(guard, done, result);
    });
}

void KWalletCredentialStore::write(const QString &key, const QString &secret, QObject *context, Callback done)
{
    QPointer<QObject> guard(context);
    withWallet([this, key, secret, guard, done](KWallet::Wallet *wallet, CredentialResult::Status openStatus) {
        CredentialResult result;
        result.status = openStatus;
        if (wallet) {
            result.status = wallet->writePassword(key, secret) == 0 ? CredentialResult::Status::Ok : CredentialResult::Status::Failed;
        }
        if (result.ok()) {
            Q_EMIT secretChanged(key);
        }
        if (guard) {
            deliver(guard, done, result);
        }
    });
}

void KWalletCredentialStore::withWallet(Operation operation)
{
    if (m_wallet && m_wallet->isOpen()) {
        operation(m_wallet.get(), CredentialResult::Status::Ok);
        return;
    }
    if (!KWallet::Wallet::isEnabled()) {
        operation(nullptr, CredentialResult::Status::Disabled);
        return;
    }
    m_queue.append(std::move(operation));
    if (m_opening) {
        return;
    }
    m_opening = true;
    m_wallet.reset(KWallet::Wallet::openWallet(KWallet::Wallet::NetworkWallet(), 0, KWallet::Wallet::Asynchronous));
    if (!m_wallet) {
        m_opening = false;
        runQueue(CredentialResult::Status::Unavailable);
        return;
    }
    connect(m_wallet.get(), &KWallet::Wallet::walletOpened, this, &KWalletCredentialStore::onWalletOpened);
    // A closed handle stays closed; the next operation opens a new one.
    connect(m_wallet.get(), &KWallet::Wallet::walletClosed, this, [this] {
        if (!m_opening && m_wallet) {
            m_wallet.release()->deleteLater();
        }
    });
}

void KWalletCredentialStore::onWalletOpened(bool success)
{
    m_opening = false;
    if (success && (m_wallet->hasFolder(folder) || m_wallet->createFolder(folder)) && m_wallet->setFolder(folder)) {
        runQueue(CredentialResult::Status::Ok);
        return;
    }
    runQueue(success ? CredentialResult::Status::Failed : CredentialResult::Status::Unavailable);
    if (m_wallet) {
        m_wallet.release()->deleteLater();
    }
}

void KWalletCredentialStore::runQueue(CredentialResult::Status status)
{
    const QList<Operation> queue = std::exchange(m_queue, {});
    for (const Operation &operation : queue) {
        operation(status == CredentialResult::Status::Ok ? m_wallet.get() : nullptr, status);
    }
}

}
