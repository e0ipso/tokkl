// How the Keychain store reads QtKeychain's errors and words them. Nothing
// here opens a keychain.

#include "keychaincredentialstore.h"

#include <QSet>
#include <QTest>

using namespace Tokkl;
using Status = CredentialResult::Status;

class KeychainCredentialStoreTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void statusFor_data()
    {
        // Plain ints: neither enum is a registered metatype.
        QTest::addColumn<int>("error");
        QTest::addColumn<int>("status");
        const auto row = [](const char *name, QKeychain::Error error, Status status) {
            QTest::newRow(name) << int(error) << int(status);
        };
        row("no error", QKeychain::NoError, Status::Ok);
        row("not found", QKeychain::EntryNotFound, Status::NotFound);
        row("denied by user", QKeychain::AccessDeniedByUser, Status::Unavailable);
        row("denied", QKeychain::AccessDenied, Status::Unavailable);
        row("no backend", QKeychain::NoBackendAvailable, Status::Disabled);
        row("not implemented", QKeychain::NotImplemented, Status::Disabled);
        row("delete failed", QKeychain::CouldNotDeleteEntry, Status::Failed);
        row("other", QKeychain::OtherError, Status::Failed);
    }

    void statusFor()
    {
        QFETCH(int, error);
        QFETCH(int, status);
        QCOMPARE(int(KeychainCredentialStore::statusFor(static_cast<QKeychain::Error>(error))), status);
    }

    // Every failure has its own wording that names the Keychain, and the
    // missing secret points to the app's settings, not a KDE widget.
    void messages()
    {
        const KeychainCredentialStore store;
        QVERIFY(store.message(CredentialResult{Status::Ok, {}}).isEmpty());
        QVERIFY(store.message(CredentialResult{Status::NotFound, {}}).contains(QStringLiteral("Tokkl Settings")));
        QSet<QString> seen;
        for (const Status status : {Status::Disabled, Status::Unavailable, Status::Failed}) {
            const QString text = store.message(CredentialResult{status, QStringLiteral("hunter2")});
            QVERIFY2(text.contains(QStringLiteral("Keychain")), qPrintable(text));
            QVERIFY(!text.contains(QStringLiteral("hunter2")));
            seen.insert(text);
        }
        QCOMPARE(seen.size(), 3);
    }
};

QTEST_GUILESS_MAIN(KeychainCredentialStoreTest)

#include "keychaincredentialstoretest.moc"
