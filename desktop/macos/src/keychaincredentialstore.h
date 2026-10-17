#pragma once

#include "credentialstore.h"

#include <qt6keychain/keychain.h>

namespace Tokkl
{

// Secrets in the platform keychain through QtKeychain: the macOS Keychain,
// as generic passwords of the service "Tokkl", one per credential key.
// There is no plaintext fallback.
class KeychainCredentialStore : public CredentialStore
{
    Q_OBJECT

public:
    static const QString service;

    explicit KeychainCredentialStore(QObject *parent = nullptr);
    ~KeychainCredentialStore() override;

    void read(const QString &key, QObject *context, Callback done) override;
    void write(const QString &key, const QString &secret, QObject *context, Callback done) override;
    // Names the Keychain and Tokkl Settings.
    QString message(const CredentialResult &result) const override;

    // The store's status for a QtKeychain job error.
    static CredentialResult::Status statusFor(QKeychain::Error error);
};

}
