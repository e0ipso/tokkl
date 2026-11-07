#include "keychaincredentialstore.h"

#include <QCoreApplication>

namespace Tokkl
{

const QString KeychainCredentialStore::service = QStringLiteral("Tokkl");

KeychainCredentialStore::KeychainCredentialStore(QObject *parent)
    : QtKeychainStore(service, parent)
{
}

KeychainCredentialStore::~KeychainCredentialStore() = default;

CredentialResult::Status KeychainCredentialStore::statusFor(QKeychain::Error error)
{
    switch (error) {
    case QKeychain::NoBackendAvailable:
    case QKeychain::NotImplemented:
        return CredentialResult::Status::Disabled;
    default:
        return defaultStatus(error);
    }
}

CredentialResult::Status KeychainCredentialStore::status(QKeychain::Error error) const
{
    return statusFor(error);
}

QString KeychainCredentialStore::message(const CredentialResult &result) const
{
    switch (result.status) {
    case CredentialResult::Status::Ok:
        return QString();
    case CredentialResult::Status::NotFound:
        return QCoreApplication::translate("Tokkl::CredentialStore", "No credentials are saved for this instance. Enter them in Tokkl Settings.");
    case CredentialResult::Status::Disabled:
        return QCoreApplication::translate("Tokkl::CredentialStore", "The Keychain is not available to Tokkl. Tokkl does not store credentials anywhere else.");
    case CredentialResult::Status::Unavailable:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "The Keychain is locked or denied access to Tokkl. Unlock it and allow access, then try again.");
    case CredentialResult::Status::Failed:
        break;
    }
    return QCoreApplication::translate("Tokkl::CredentialStore", "The Keychain could not read or save the Tokkl credentials.");
}

}
