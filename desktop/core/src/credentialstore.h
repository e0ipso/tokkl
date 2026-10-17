#pragma once

#include <QObject>
#include <QString>

#include <functional>

namespace Tokkl
{

struct CredentialResult {
    enum class Status {
        Ok,
        NotFound, // no secret stored under the key
        Disabled, // the store is turned off
        Unavailable, // locked and not unlocked, or access denied
        Failed, // the store opened but the read or write failed
    };

    Status status = Status::Failed;
    QString secret; // only for a successful read

    bool ok() const
    {
        return status == Status::Ok;
    }

    // A message for the user that names no platform. It never contains the
    // secret. CredentialStore::message() gives the store's own wording.
    QString message() const;
};

// Where secrets live. There is no plaintext fallback: when the store fails,
// the secret is not kept anywhere else.
class CredentialStore : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;
    using Callback = std::function<void(const CredentialResult &)>;

    // Callbacks run later, from the event loop, and only while the context
    // object is alive.
    virtual void read(const QString &key, QObject *context, Callback done) = 0;
    virtual void write(const QString &key, const QString &secret, QObject *context, Callback done) = 0;

    // A message for the user about a result of this store. It never contains
    // the secret. The default is result.message(); a store overrides it to
    // name its platform.
    virtual QString message(const CredentialResult &result) const;

Q_SIGNALS:
    // This store wrote a secret under the key.
    void secretChanged(const QString &key);
    // This store could not write a secret under the key. It is emitted even
    // when the caller of write() is gone, so whoever uses that key can tell
    // the user. The result carries no secret.
    void secretWriteFailed(const QString &key, const Tokkl::CredentialResult &result);

protected:
    // Emits secretChanged or secretWriteFailed for the result of a write.
    void reportWrite(const QString &key, const CredentialResult &result);
};

}
