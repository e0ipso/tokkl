#pragma once

#include "credentialstore.h"

namespace Tokkl
{
// The user's keyring through QtKeychain, which uses the Secret Service
// (libsecret, as GNOME Keyring provides it) on GNOME. Secrets go under the
// service name "tokkl"; there is no plaintext fallback.
class KeychainCredentialStore : public CredentialStore
{
    Q_OBJECT

public:
    explicit KeychainCredentialStore(QObject *parent = nullptr);

    void read(const QString &key, QObject *context, Callback done) override;
    void write(const QString &key, const QString &secret, QObject *context, Callback done) override;
    // Names the keyring.
    QString message(const CredentialResult &result) const override;

    static const QString service;
};
}
