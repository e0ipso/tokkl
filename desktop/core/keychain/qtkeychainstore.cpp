#include "qtkeychainstore.h"

#include "logging.h"

#include <QPointer>

namespace Tokkl
{

namespace
{
// Runs done from the event loop, and only while the context is alive.
void deliver(const QPointer<QObject> &context, const CredentialStore::Callback &done, const CredentialResult &result)
{
    if (!context) {
        return;
    }
    QMetaObject::invokeMethod(
        context,
        [context, done, result] {
            if (context) {
                done(result);
            }
        },
        Qt::QueuedConnection);
}
}

QtKeychainStore::QtKeychainStore(const QString &service, QObject *parent)
    : CredentialStore(parent)
    , m_service(service)
{
}

CredentialResult::Status QtKeychainStore::status(QKeychain::Error error) const
{
    return defaultStatus(error);
}

CredentialResult::Status QtKeychainStore::defaultStatus(QKeychain::Error error)
{
    switch (error) {
    case QKeychain::NoError:
        return CredentialResult::Status::Ok;
    case QKeychain::EntryNotFound:
        return CredentialResult::Status::NotFound;
    case QKeychain::AccessDenied:
    case QKeychain::AccessDeniedByUser:
    case QKeychain::NoBackendAvailable:
        return CredentialResult::Status::Unavailable;
    case QKeychain::CouldNotDeleteEntry:
    case QKeychain::NotImplemented:
    case QKeychain::OtherError:
        break;
    }
    return CredentialResult::Status::Failed;
}

void QtKeychainStore::read(const QString &key, QObject *context, Callback done)
{
    QPointer<QObject> guard(context);
    auto *job = new QKeychain::ReadPasswordJob(m_service, this);
    job->setAutoDelete(true);
    job->setInsecureFallback(false);
    job->setKey(key);
    connect(job, &QKeychain::Job::finished, this, [this, guard, done, job] {
        CredentialResult result;
        result.status = status(job->error());
        if (result.ok()) {
            result.secret = job->textData();
        } else if (result.status != CredentialResult::Status::NotFound) {
            qCWarning(lcCredentials) << "Keychain read failed:" << result.status;
        }
        deliver(guard, done, result);
    });
    job->start();
}

void QtKeychainStore::write(const QString &key, const QString &secret, QObject *context, Callback done)
{
    QPointer<QObject> guard(context);
    auto *job = new QKeychain::WritePasswordJob(m_service, this);
    job->setAutoDelete(true);
    job->setInsecureFallback(false);
    job->setKey(key);
    job->setTextData(secret);
    connect(job, &QKeychain::Job::finished, this, [this, guard, done, key, job] {
        CredentialResult result;
        result.status = status(job->error());
        if (!result.ok()) {
            qCWarning(lcCredentials) << "Keychain write failed:" << result.status;
        }
        reportWrite(key, result);
        deliver(guard, done, result);
    });
    job->start();
}

}
