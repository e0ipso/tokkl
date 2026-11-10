#pragma once

#include "qtkeychainstore.h"

namespace Tokkl
{

// Generic passwords of the service "Tokkl". No plaintext fallback: an
// unreachable Keychain reads as a disabled store.
class KeychainCredentialStore : public QtKeychainStore
{
    Q_OBJECT

public:
    static const QString service;

    explicit KeychainCredentialStore(QObject *parent = nullptr);
    ~KeychainCredentialStore() override;

    QString message(const CredentialResult &result) const override;

    static CredentialResult::Status statusFor(QKeychain::Error error);

protected:
    CredentialResult::Status status(QKeychain::Error error) const override;
};

}
