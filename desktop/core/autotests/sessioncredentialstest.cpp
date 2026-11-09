// SessionCredentials on its own: which settings name the account, the
// secret read for them, and a write the store refused. connectiontest
// covers it through Connection.

#include "fakes.h"
#include "sessioncredentials.h"

#include <QSignalSpy>
#include <QTest>

using namespace Tokkl;
using Status = CredentialResult::Status;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test");

CredentialResult refused()
{
    return CredentialResult{Status::Unavailable, {}};
}
}

class SessionCredentialsTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void theInstanceAndModeNameTheAccount()
    {
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        QSignalSpy text(&credentials, &SessionCredentials::instanceTextChanged);
        QSignalSpy mode(&credentials, &SessionCredentials::authModeChanged);
        QSignalSpy changed(&credentials, &SessionCredentials::changed);
        credentials.setInstanceText(instanceA);
        credentials.setInstanceText(instanceA);
        QCOMPARE(text.count(), 1);
        QCOMPARE(changed.count(), 1);
        credentials.setAuthMode(AuthMode::Password);
        credentials.setAuthMode(AuthMode::Password);
        QCOMPARE(mode.count(), 1);
        QCOMPARE(changed.count(), 2);
    }

    void theEmailNamesTheAccountOnlyForPasswords()
    {
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        QSignalSpy email(&credentials, &SessionCredentials::emailChanged);
        QSignalSpy changed(&credentials, &SessionCredentials::changed);
        credentials.setEmail(QStringLiteral("bea@example.test"));
        QCOMPARE(email.count(), 1);
        QCOMPARE(changed.count(), 0);
        credentials.setAuthMode(AuthMode::Password);
        credentials.setEmail(QStringLiteral("cai@example.test"));
        QCOMPARE(email.count(), 2);
        QCOMPARE(changed.count(), 2);
    }

    void parsingChecksTheInstanceAndTheEmail()
    {
        SessionCredentials credentials(nullptr);
        QVERIFY(!credentials.hasStore());
        QVERIFY(!credentials.instance().isValid());
        credentials.setInstanceText(QStringLiteral("not a url"));
        QVERIFY(!credentials.parseInstance().isValid());
        QVERIFY(!credentials.parseInstance().error.isEmpty());
        credentials.setInstanceText(instanceA);
        QVERIFY(credentials.parseInstance().isValid());
        QVERIFY(credentials.instance().isValid());
        credentials.clearInstance();
        QVERIFY(!credentials.instance().isValid());
        QVERIFY(!credentials.lacksEmail());
        credentials.setAuthMode(AuthMode::Password);
        credentials.setEmail(QStringLiteral("  "));
        QVERIFY(credentials.lacksEmail());
    }

    void aReadAnswersWithTheSecret()
    {
        FakeCredentialStore store;
        store.secrets.insert(tokenKey(instanceA), QStringLiteral("tok"));
        SessionCredentials credentials(&store);
        credentials.setInstanceText(instanceA);
        credentials.parseInstance();
        QSignalSpy read(&credentials, &SessionCredentials::secretRead);
        credentials.read();
        QVERIFY(read.wait());
        const CredentialResult result = read.first().first().value<CredentialResult>();
        QVERIFY(result.ok());
        QCOMPARE(result.secret, QStringLiteral("tok"));
    }

    void aReadOfOtherSettingsOrBeforeADropIsIgnored_data()
    {
        QTest::addColumn<bool>("drop");
        QTest::newRow("dropped") << true;
        QTest::newRow("other instance") << false;
    }

    void aReadOfOtherSettingsOrBeforeADropIsIgnored()
    {
        QFETCH(bool, drop);
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        credentials.setInstanceText(instanceA);
        credentials.parseInstance();
        QSignalSpy read(&credentials, &SessionCredentials::secretRead);
        credentials.read();
        if (drop) {
            credentials.dropReads();
        } else {
            credentials.setInstanceText(instanceB);
            credentials.parseInstance();
        }
        QCOMPARE(store.reads, 1);
        QTest::qWait(10);
        QCOMPARE(read.count(), 0);
    }

    void aRefusedWriteOfTheCurrentSettingsIsReportedAtOnce()
    {
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        credentials.setInstanceText(instanceA);
        credentials.parseInstance();
        QSignalSpy failed(&credentials, &SessionCredentials::writeFailed);
        Q_EMIT store.secretWriteFailed(tokenKey(instanceA), refused());
        QCOMPARE(failed.count(), 1);
        QCOMPARE(failed.first().first().value<Status>(), Status::Unavailable);
        // Reported once: the next read goes to the store.
        credentials.read();
        QCOMPARE(store.reads, 1);
    }

    void aRefusedWriteBeforeItsSettingsIsReportedByTheRead()
    {
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        QSignalSpy failed(&credentials, &SessionCredentials::writeFailed);
        Q_EMIT store.secretWriteFailed(tokenKey(instanceA), refused());
        QCOMPARE(failed.count(), 0);
        credentials.setInstanceText(instanceA);
        credentials.parseInstance();
        credentials.read();
        QCOMPARE(failed.count(), 1);
        QCOMPARE(store.reads, 0);
    }

    void aSavedSecretOrReconnectForgetsARefusedWrite_data()
    {
        QTest::addColumn<bool>("saved");
        QTest::newRow("saved since") << true;
        QTest::newRow("forgotten") << false;
    }

    void aSavedSecretOrReconnectForgetsARefusedWrite()
    {
        QFETCH(bool, saved);
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        Q_EMIT store.secretWriteFailed(tokenKey(instanceA), refused());
        if (saved) {
            Q_EMIT store.secretChanged(tokenKey(instanceA));
        } else {
            credentials.forgetFailedWrite();
        }
        credentials.setInstanceText(instanceA);
        credentials.parseInstance();
        QSignalSpy failed(&credentials, &SessionCredentials::writeFailed);
        credentials.read();
        QCOMPARE(failed.count(), 0);
        QCOMPARE(store.reads, 1);
    }

    void aNewSecretForTheCurrentSettingsChangesThem()
    {
        FakeCredentialStore store;
        SessionCredentials credentials(&store);
        credentials.setInstanceText(instanceA);
        QSignalSpy changed(&credentials, &SessionCredentials::changed);
        // Not yet parsed: no key is current.
        Q_EMIT store.secretChanged(tokenKey(instanceA));
        QCOMPARE(changed.count(), 0);
        credentials.parseInstance();
        Q_EMIT store.secretChanged(tokenKey(instanceB));
        QCOMPARE(changed.count(), 0);
        Q_EMIT store.secretChanged(tokenKey(instanceA));
        QCOMPARE(changed.count(), 1);
    }

    void theSecretGivesTheAuthorization()
    {
        SessionCredentials credentials(nullptr);
        QVERIFY(credentials.authorization().isEmpty());
        QVERIFY(!credentials.differs(QStringLiteral("tok")));
        credentials.setSecret(QStringLiteral("tok"));
        QCOMPARE(credentials.authorization(), basicAuthorization(AuthMode::Token, QString(), QStringLiteral("tok")));
        QVERIFY(!credentials.differs(QStringLiteral("tok")));
        QVERIFY(credentials.differs(QStringLiteral("other")));
        credentials.forgetSecret();
        QVERIFY(credentials.authorization().isEmpty());
        QVERIFY(!credentials.differs(QStringLiteral("other")));
    }

    void withoutAStoreNothingIsRead()
    {
        SessionCredentials credentials(nullptr);
        credentials.setInstanceText(instanceA);
        credentials.parseInstance();
        QSignalSpy read(&credentials, &SessionCredentials::secretRead);
        QSignalSpy failed(&credentials, &SessionCredentials::writeFailed);
        credentials.read();
        QTest::qWait(10);
        QCOMPARE(read.count(), 0);
        QCOMPARE(failed.count(), 0);
    }
};

QTEST_GUILESS_MAIN(SessionCredentialsTest)

#include "sessioncredentialstest.moc"
