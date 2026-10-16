#include "keychaincredentialstore.h"

#include <QCoreApplication>
#include <QPointer>

namespace Tokkl
{

namespace
{
// Runs done from the event loop, and only while the context is alive.
void deliver(QObject *context, const CredentialStore::Callback &done, const CredentialResult &result)
{
    QPointer<QObject> guard(context);
    if (!guard) {
        return;
    }
    QMetaObject::invokeMethod(
        context,
        [guard, done, result] {
            if (guard) {
                done(result);
            }
        },
        Qt::QueuedConnection);
}
}

const QString KeychainCredentialStore::service = QStringLiteral("Tokkl");

KeychainCredentialStore::KeychainCredentialStore(QObject *parent)
    : CredentialStore(parent)
{
}

KeychainCredentialStore::~KeychainCredentialStore() = default;

CredentialResult::Status KeychainCredentialStore::statusFor(QKeychain::Error error)
{
    switch (error) {
    case QKeychain::NoError:
        return CredentialResult::Status::Ok;
    case QKeychain::EntryNotFound:
        return CredentialResult::Status::NotFound;
    case QKeychain::AccessDenied:
    case QKeychain::AccessDeniedByUser:
        return CredentialResult::Status::Unavailable;
    case QKeychain::NoBackendAvailable:
    case QKeychain::NotImplemented:
        return CredentialResult::Status::Disabled;
    case QKeychain::CouldNotDeleteEntry:
    case QKeychain::OtherError:
        break;
    }
    return CredentialResult::Status::Failed;
}

void KeychainCredentialStore::read(const QString &key, QObject *context, Callback done)
{
    QPointer<QObject> guard(context);
    auto *job = new QKeychain::ReadPasswordJob(service, this);
    job->setAutoDelete(true);
    job->setKey(key);
    connect(job, &QKeychain::Job::finished, this, [guard, done, job] {
        CredentialResult result;
        result.status = statusFor(job->error());
        if (result.ok()) {
            result.secret = job->textData();
        }
        if (guard) {
            deliver(guard, done, result);
        }
    });
    job->start();
}

void KeychainCredentialStore::write(const QString &key, const QString &secret, QObject *context, Callback done)
{
    QPointer<QObject> guard(context);
    auto *job = new QKeychain::WritePasswordJob(service, this);
    job->setAutoDelete(true);
    job->setKey(key);
    job->setTextData(secret);
    connect(job, &QKeychain::Job::finished, this, [this, guard, done, key, job] {
        CredentialResult result;
        result.status = statusFor(job->error());
        if (result.ok()) {
            Q_EMIT secretChanged(key);
        }
        if (guard) {
            deliver(guard, done, result);
        }
    });
    job->start();
}

QString KeychainCredentialStore::message(const CredentialResult &result) const
{
    switch (result.status) {
    case CredentialResult::Status::Ok:
        return QString();
    case CredentialResult::Status::NotFound:
        return QCoreApplication::translate("Tokkl::CredentialStore", "No credentials are saved for this instance. Enter them in Tokkl Settings.");
    case CredentialResult::Status::Disabled:
        return QCoreApplication::translate("Tokkl::CredentialStore", "The Keychain is not available to Tokkl. Tokkl does not store credentials anywhere else.");
    case CredentialResult::Status::Unavailable:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "The Keychain is locked or denied access to Tokkl. Unlock it and allow access, then try again.");
    case CredentialResult::Status::Failed:
        break;
    }
    return QCoreApplication::translate("Tokkl::CredentialStore", "The Keychain could not read or save the Tokkl credentials.");
}

}
