#include "keychaincredentialstore.h"

#include <QCoreApplication>
#include <QPointer>

#include <qt6keychain/keychain.h>

namespace Tokkl
{

const QString KeychainCredentialStore::service = QStringLiteral("tokkl");

namespace
{
CredentialResult::Status statusOf(QKeychain::Error error)
{
    switch (error) {
    case QKeychain::NoError:
        return CredentialResult::Status::Ok;
    case QKeychain::EntryNotFound:
        return CredentialResult::Status::NotFound;
    case QKeychain::AccessDeniedByUser:
    case QKeychain::AccessDenied:
    case QKeychain::NoBackendAvailable:
        return CredentialResult::Status::Unavailable;
    case QKeychain::CouldNotDeleteEntry:
    case QKeychain::NotImplemented:
    case QKeychain::OtherError:
        break;
    }
    return CredentialResult::Status::Failed;
}
}

KeychainCredentialStore::KeychainCredentialStore(QObject *parent)
    : CredentialStore(parent)
{
}

void KeychainCredentialStore::read(const QString &key, QObject *context, Callback done)
{
    auto *job = new QKeychain::ReadPasswordJob(service, this);
    job->setKey(key);
    job->setInsecureFallback(false);
    QPointer<QObject> guard(context);
    connect(job, &QKeychain::Job::finished, this, [job, guard, done] {
        if (!guard) {
            return;
        }
        CredentialResult result;
        result.status = statusOf(job->error());
        if (result.ok()) {
            result.secret = job->textData();
        }
        done(result);
    });
    job->start();
}

void KeychainCredentialStore::write(const QString &key, const QString &secret, QObject *context, Callback done)
{
    auto *job = new QKeychain::WritePasswordJob(service, this);
    job->setKey(key);
    job->setInsecureFallback(false);
    job->setTextData(secret);
    QPointer<QObject> guard(context);
    connect(job, &QKeychain::Job::finished, this, [this, job, key, guard, done] {
        CredentialResult result;
        result.status = statusOf(job->error());
        reportWrite(key, result);
        if (guard) {
            done(result);
        }
    });
    job->start();
}

QString KeychainCredentialStore::message(const CredentialResult &result) const
{
    switch (result.status) {
    case CredentialResult::Status::Ok:
    case CredentialResult::Status::NotFound:
    case CredentialResult::Status::Disabled:
        return CredentialStore::message(result);
    case CredentialResult::Status::Unavailable:
        return QCoreApplication::translate("Tokkl::CredentialStore",
                                           "The keyring is locked, missing or denied access to Tokkl. Unlock it and allow access, then try again.");
    case CredentialResult::Status::Failed:
        break;
    }
    return QCoreApplication::translate("Tokkl::CredentialStore", "The keyring could not read or save the Tokkl credentials.");
}

}
