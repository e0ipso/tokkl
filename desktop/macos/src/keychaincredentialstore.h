#pragma once

#include "qtkeychainstore.h"

namespace Tokkl
{

// Secrets in the platform keychain through QtKeychain: the macOS Keychain,
// as generic passwords of the service "Tokkl", one per credential key.
// There is no plaintext fallback. A Keychain QtKeychain cannot reach reads
// as a disabled store.
class KeychainCredentialStore : public QtKeychainStore
{
    Q_OBJECT

public:
    static const QString service;

    explicit KeychainCredentialStore(QObject *parent = nullptr);
    ~KeychainCredentialStore() override;

    // Names the Keychain and Tokkl Settings.
    QString message(const CredentialResult &result) const override;

    // The store's status for a QtKeychain job error.
    static CredentialResult::Status statusFor(QKeychain::Error error);

protected:
    CredentialResult::Status status(QKeychain::Error error) const override;
};

}
