#pragma once

#include "credentialstore.h"

#include <qt6keychain/keychain.h>

namespace Tokkl
{

// One generic password per credential key, no plaintext fallback. Companions
// override message() and status() for their wording and backend handling.
class QtKeychainStore : public CredentialStore
{
    Q_OBJECT

public:
    explicit QtKeychainStore(const QString &service, QObject *parent = nullptr);

    void read(const QString &key, QObject *context, Callback done) override;
    void write(const QString &key, const QString &secret, QObject *context, Callback done) override;

    // A missing backend reads as an unavailable store, and a call the backend
    // lacks as a failure.
    static CredentialResult::Status defaultStatus(QKeychain::Error error);

protected:
    virtual CredentialResult::Status status(QKeychain::Error error) const;

private:
    const QString m_service;
};

}
