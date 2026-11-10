#pragma once

#include <QObject>
#include <QString>

#include <functional>

namespace Tokkl
{

struct CredentialResult {
    Q_GADGET

public:
    enum class Status {
        Ok,
        NotFound, // no secret stored under the key
        Disabled, // the store is turned off
        Unavailable, // locked and not unlocked, or access denied
        Failed, // the store opened but the read or write failed
    };
    Q_ENUM(Status)

    Status status = Status::Failed;
    QString secret; // only for a successful read

    bool ok() const
    {
        return status == Status::Ok;
    }

    // Names no platform and never contains the secret.
    QString message() const;
};

// No plaintext fallback: when the store fails, the secret is kept nowhere
// else.
class CredentialStore : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;
    using Callback = std::function<void(const CredentialResult &)>;

    // Callbacks run later, and only while context is alive.
    virtual void read(const QString &key, QObject *context, Callback done) = 0;
    virtual void write(const QString &key, const QString &secret, QObject *context, Callback done) = 0;

    // Never contains the secret. A store overrides it to name its platform.
    virtual QString message(const CredentialResult &result) const;

Q_SIGNALS:
    void secretChanged(const QString &key);
    // Emitted even when the write() caller is gone, so whoever uses the key can
    // tell the user. The result carries no secret.
    void secretWriteFailed(const QString &key, const Tokkl::CredentialResult &result);

protected:
    void reportWrite(const QString &key, const CredentialResult &result);
};

}
