#pragma once

#include "qtkeychainstore.h"

namespace Tokkl
{
// QtKeychain over the Secret Service. No plaintext fallback: a missing
// Secret Service reads as an unavailable keyring.
class KeychainCredentialStore : public QtKeychainStore
{
    Q_OBJECT

public:
    explicit KeychainCredentialStore(QObject *parent = nullptr);

    QString message(const CredentialResult &result) const override;

    static const QString service;
};
}
