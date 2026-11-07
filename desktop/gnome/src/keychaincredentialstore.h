#pragma once

#include "qtkeychainstore.h"

namespace Tokkl
{
// The user's keyring through QtKeychain, which uses the Secret Service
// (libsecret, as GNOME Keyring provides it) on GNOME. Secrets go under the
// service name "tokkl"; there is no plaintext fallback. A missing Secret
// Service reads as an unavailable keyring.
class KeychainCredentialStore : public QtKeychainStore
{
    Q_OBJECT

public:
    explicit KeychainCredentialStore(QObject *parent = nullptr);

    // Names the keyring.
    QString message(const CredentialResult &result) const override;

    static const QString service;
};
}
