// ServiceSettings on its own, with no bus: what Configure checks, where the
// secret and the settings go, and which call wins when the store answers
// late. timerservicetest covers it through org.tokkl.Timer1.

#include "connection.h"
#include "fakes.h"
#include "servicesettings.h"

#include <QFile>
#include <QSettings>
#include <QTemporaryDir>
#include <QTest>

using namespace Tokkl;
using Kind = ServiceSettings::Outcome::Kind;

namespace
{
const QString instanceA = QStringLiteral("https://a.example.test");
const QString instanceB = QStringLiteral("https://b.example.test");

// A store whose writes answer only when the test says so.
class HeldStore : public CredentialStore
{
public:
    void read(const QString &, QObject *, Callback) override
    {
    }

    void write(const QString &key, const QString &secret, QObject *, Callback done) override
    {
        held.append({key, secret, std::move(done)});
    }

    void finish(qsizetype index, CredentialResult::Status status = CredentialResult::Status::Ok)
    {
        held.at(index).done(CredentialResult{status, {}});
    }

    struct Write {
        QString key;
        QString secret;
        Callback done;
    };
    QList<Write> held;
};

struct Fixture {
    QTemporaryDir dir;
    FakeTransport transport;
    FakeCredentialStore store;
    Connection connection{&transport, &store, testClientName()};
    QSettings settings{dir.filePath(QStringLiteral("tokkl-timerd.conf")), QSettings::IniFormat};
    ServiceSettings service{&settings, &connection, &store};

    // Runs configure() and waits for its outcome.
    ServiceSettings::Outcome configure(const QString &url, const QString &mode, const QString &email, const QString &secret)
    {
        std::optional<ServiceSettings::Outcome> outcome;
        service.configure(url, mode, email, secret, [&outcome](const ServiceSettings::Outcome &result) {
            outcome = result;
        });
        if (!QTest::qWaitFor([&outcome] {
                return outcome.has_value();
            })) {
            return ServiceSettings::Outcome{Kind::Invalid, QStringLiteral("no answer")};
        }
        return *outcome;
    }

    QString saved(const QString &key)
    {
        const QSettings file(settings.fileName(), QSettings::IniFormat);
        return file.value(key).toString();
    }
};
}

class ServiceSettingsTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void unusableSettingsChangeNothing_data()
    {
        QTest::addColumn<QString>("url");
        QTest::addColumn<QString>("mode");
        QTest::addColumn<QString>("email");
        QTest::newRow("address") << QStringLiteral("not a url") << QStringLiteral("token") << QString();
        QTest::newRow("method") << instanceA << QStringLiteral("cookie") << QString();
        QTest::newRow("email") << instanceA << QStringLiteral("password") << QStringLiteral("  ");
    }

    void unusableSettingsChangeNothing()
    {
        QFETCH(QString, url);
        QFETCH(QString, mode);
        QFETCH(QString, email);
        Fixture f;
        const ServiceSettings::Outcome outcome = f.configure(url, mode, email, QStringLiteral("secret"));
        QCOMPARE(outcome.kind, Kind::Invalid);
        QVERIFY(!outcome.message.isEmpty());
        QCOMPARE(f.store.writes, 0);
        QVERIFY(!QFile::exists(f.settings.fileName()));
        QVERIFY(f.connection.instanceUrl().isEmpty());
    }

    void theSecretGoesToTheStoreAndTheRestToTheFile()
    {
        Fixture f;
        const ServiceSettings::Outcome outcome = f.configure(instanceA + QLatin1Char('/'), QStringLiteral("token"), QString(), QStringLiteral(" tok-1 "));
        QCOMPARE(outcome.kind, Kind::Saved);
        QVERIFY(outcome.message.isEmpty());
        const QString base = parseInstanceUrl(instanceA).base.toString();
        // A token loses its surrounding whitespace.
        QCOMPARE(f.store.secrets.value(credentialKey(parseInstanceUrl(instanceA), AuthMode::Token, QString())), QStringLiteral("tok-1"));
        QCOMPARE(f.saved(QStringLiteral("instanceUrl")), base);
        QCOMPARE(f.saved(QStringLiteral("authMode")), QStringLiteral("token"));
        QCOMPARE(f.connection.instanceUrl(), base);
    }

    void aPasswordIsKeptAsTypedAndTheEmailTrimmed()
    {
        Fixture f;
        const ServiceSettings::Outcome outcome =
            f.configure(instanceA, QStringLiteral("password"), QStringLiteral(" bea@example.test "), QStringLiteral(" pass "));
        QCOMPARE(outcome.kind, Kind::Saved);
        const QString key = credentialKey(parseInstanceUrl(instanceA), AuthMode::Password, QStringLiteral("bea@example.test"));
        QCOMPARE(f.store.secrets.value(key), QStringLiteral(" pass "));
        QCOMPARE(f.saved(QStringLiteral("email")), QStringLiteral("bea@example.test"));
        QCOMPARE(f.connection.email(), QStringLiteral("bea@example.test"));
        QCOMPARE(f.connection.authMode(), AuthMode::Password);
    }

    void anEmptySecretKeepsTheStoredOne()
    {
        Fixture f;
        bool answered = false;
        f.service.configure(instanceA, QStringLiteral("token"), QString(), QStringLiteral("   "), [&answered](const ServiceSettings::Outcome &outcome) {
            answered = outcome.kind == Kind::Saved;
        });
        // At once, without a store write.
        QVERIFY(answered);
        QCOMPARE(f.store.writes, 0);
        QCOMPARE(f.saved(QStringLiteral("instanceUrl")), parseInstanceUrl(instanceA).base.toString());
    }

    void aRefusedSecretChangesNothing()
    {
        Fixture f;
        f.store.failure = CredentialResult::Status::Unavailable;
        const ServiceSettings::Outcome outcome = f.configure(instanceA, QStringLiteral("token"), QString(), QStringLiteral("tok-1"));
        QCOMPARE(outcome.kind, Kind::StoreRefused);
        QCOMPARE(outcome.message, f.store.message(CredentialResult{CredentialResult::Status::Unavailable, {}}));
        QVERIFY(!QFile::exists(f.settings.fileName()));
        QVERIFY(f.connection.instanceUrl().isEmpty());
    }

    void anUnwritableFileChangesNothing()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        // A regular file where the settings directory would be.
        QFile blocker(dir.filePath(QStringLiteral("blocker")));
        QVERIFY(blocker.open(QIODevice::WriteOnly));
        blocker.close();
        FakeTransport transport;
        FakeCredentialStore store;
        Connection connection(&transport, &store, testClientName());
        QSettings settings(dir.filePath(QStringLiteral("blocker/tokkl-timerd.conf")), QSettings::IniFormat);
        ServiceSettings service(&settings, &connection, &store);
        std::optional<ServiceSettings::Outcome> outcome;
        service.configure(instanceA, QStringLiteral("token"), QString(), QString(), [&outcome](const ServiceSettings::Outcome &result) {
            outcome = result;
        });
        QVERIFY(outcome);
        QCOMPARE(outcome->kind, Kind::NotWritten);
        QVERIFY(outcome->message.contains(settings.fileName()));
        QVERIFY(connection.instanceUrl().isEmpty());
        QVERIFY(settings.value(QStringLiteral("instanceUrl")).isNull());
    }

    void theLaterCallWinsWhicheverWriteEndsLast()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        FakeTransport transport;
        HeldStore store;
        Connection connection(&transport, &store, testClientName());
        QSettings settings(dir.filePath(QStringLiteral("tokkl-timerd.conf")), QSettings::IniFormat);
        ServiceSettings service(&settings, &connection, &store);
        QList<Kind> outcomes;
        const auto record = [&outcomes](const ServiceSettings::Outcome &outcome) {
            outcomes.append(outcome.kind);
        };
        service.configure(instanceA, QStringLiteral("token"), QString(), QStringLiteral("tok-a"), record);
        service.configure(instanceB, QStringLiteral("token"), QString(), QStringLiteral("tok-b"), record);
        QCOMPARE(store.held.size(), 2);
        QVERIFY(outcomes.isEmpty());
        const QString expected = parseInstanceUrl(instanceB).base.toString();
        store.finish(1);
        QCOMPARE(connection.instanceUrl(), expected);
        store.finish(0);
        QCOMPARE(connection.instanceUrl(), expected);
        QCOMPARE(settings.value(QStringLiteral("instanceUrl")).toString(), expected);
        // The first call's settings were never applied, and it says so.
        QCOMPARE(outcomes, (QList<Kind>{Kind::Saved, Kind::Superseded}));
    }

    void aReplacedCallEndsSupersededWhenItsWriteEndsFirst()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        FakeTransport transport;
        HeldStore store;
        Connection connection(&transport, &store, testClientName());
        QSettings settings(dir.filePath(QStringLiteral("tokkl-timerd.conf")), QSettings::IniFormat);
        ServiceSettings service(&settings, &connection, &store);
        QList<ServiceSettings::Outcome> outcomes;
        const auto record = [&outcomes](const ServiceSettings::Outcome &outcome) {
            outcomes.append(outcome);
        };
        service.configure(instanceA, QStringLiteral("token"), QString(), QStringLiteral("tok-a"), record);
        service.configure(instanceB, QStringLiteral("token"), QString(), QStringLiteral("tok-b"), record);
        store.finish(0);
        QCOMPARE(outcomes.size(), 1);
        QCOMPARE(outcomes.at(0).kind, Kind::Superseded);
        QVERIFY(!outcomes.at(0).message.isEmpty());
        QCOMPARE(connection.instanceUrl(), QString());
        QVERIFY(settings.value(QStringLiteral("instanceUrl")).isNull());
        store.finish(1);
        QCOMPARE(outcomes.size(), 2);
        QCOMPARE(outcomes.at(1).kind, Kind::Saved);
        QCOMPARE(connection.instanceUrl(), parseInstanceUrl(instanceB).base.toString());
    }

    void loadGivesTheConnectionASavedInstanceOnly()
    {
        Fixture f;
        f.service.load();
        QVERIFY(f.connection.instanceUrl().isEmpty());
        f.settings.setValue(QStringLiteral("instanceUrl"), instanceA);
        f.settings.setValue(QStringLiteral("authMode"), QStringLiteral("password"));
        f.settings.setValue(QStringLiteral("email"), QStringLiteral("bea@example.test"));
        f.service.load();
        QCOMPARE(f.connection.instanceUrl(), instanceA);
        QCOMPARE(f.connection.authMode(), AuthMode::Password);
        QCOMPARE(f.connection.email(), QStringLiteral("bea@example.test"));
    }
};

QTEST_GUILESS_MAIN(ServiceSettingsTest)

#include "servicesettingstest.moc"
