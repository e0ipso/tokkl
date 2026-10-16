#include "credentialstore.h"

#include <QCoreApplication>

namespace Tokkl
{

QString CredentialResult::message() const
{
    switch (status) {
    case Status::Ok:
        return QString();
    case Status::NotFound:
        return QCoreApplication::translate("Tokkl::CredentialStore", "No credentials are saved for this instance. Enter them in the widget settings.");
    case Status::Disabled:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "The credential store is disabled. Enable it to save Tokkl credentials; Tokkl does not store them anywhere else.");
    case Status::Unavailable:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "The credential store is locked or denied access to Tokkl. Unlock it and allow access, then try again.");
    case Status::Failed:
        break;
    }
    return QCoreApplication::translate("Tokkl::CredentialStore", "The credential store could not read or save the Tokkl credentials.");
}

QString CredentialStore::message(const CredentialResult &result) const
{
    return result.message();
}

}
