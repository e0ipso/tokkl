#pragma once

#include "credentialstore.h"

#include <qt6keychain/keychain.h>

namespace Tokkl
{

// Secrets in the platform keychain through QtKeychain, as generic passwords
// of one service, one per credential key. There is no plaintext fallback.
//
// The companions differ in the service name, which they pass, and in the
// wording and what a missing keychain backend means to the user, for which
// they override message() and status(). Callbacks run from the event loop,
// and only while their context is alive.
class QtKeychainStore : public CredentialStore
{
    Q_OBJECT

public:
    explicit QtKeychainStore(const QString &service, QObject *parent = nullptr);

    void read(const QString &key, QObject *context, Callback done) override;
    void write(const QString &key, const QString &secret, QObject *context, Callback done) override;

    // The status for a QtKeychain job error: a missing backend reads as an
    // unavailable store, and a call the backend lacks as a failure.
    static CredentialResult::Status defaultStatus(QKeychain::Error error);

protected:
    // The status of a finished job; defaultStatus() unless overridden.
    virtual CredentialResult::Status status(QKeychain::Error error) const;

private:
    const QString m_service;
};

}
