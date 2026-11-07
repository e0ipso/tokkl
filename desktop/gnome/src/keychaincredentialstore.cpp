#include "keychaincredentialstore.h"

#include <QCoreApplication>

namespace Tokkl
{

const QString KeychainCredentialStore::service = QStringLiteral("tokkl");

KeychainCredentialStore::KeychainCredentialStore(QObject *parent)
    : QtKeychainStore(service, parent)
{
}

QString KeychainCredentialStore::message(const CredentialResult &result) const
{
    switch (result.status) {
    case CredentialResult::Status::Ok:
    case CredentialResult::Status::NotFound:
    case CredentialResult::Status::Disabled:
        return CredentialStore::message(result);
    case CredentialResult::Status::Unavailable:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "The keyring is locked, missing or denied access to Tokkl. Unlock it and allow access, then try again.");
    case CredentialResult::Status::Failed:
        break;
    }
    return QCoreApplication::translate("Tokkl::CredentialStore", "The keyring could not read or save the Tokkl credentials.");
}

}
