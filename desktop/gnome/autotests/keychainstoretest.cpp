// The QtKeychain credential store against a real GNOME Keyring on a private
// D-Bus daemon, with its keyrings in a temporary directory: secrets reach the
// Secret Service through libsecret, and the user's keyring is never touched.

#include "keychaincredentialstore.h"
#include "privatebus.h"

#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusReply>
#include <QDir>
#include <QProcess>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

#include <functional>
#include <optional>

using namespace Tokkl;

namespace
{
const QString secretsService = QStringLiteral("org.freedesktop.secrets");
const QString key = QStringLiteral("token https://a.example.test");

// Runs one store operation and waits for its callback.
CredentialResult wait(const std::function<void(QObject *, CredentialStore::Callback)> &operation)
{
    QObject context;
    std::optional<CredentialResult> result;
    operation(&context, [&result](const CredentialResult &value) {
        result = value;
    });
    if (!QTest::qWaitFor(
            [&result] {
                return result.has_value();
            },
            20000)) {
        return CredentialResult{};
    }
    return *result;
}
}

class KeychainStoreTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(m_home.isValid());
        const QString runtime = m_home.filePath(QStringLiteral("runtime"));
        QVERIFY(QDir().mkpath(runtime));
        QVERIFY(QFile::setPermissions(runtime, QFile::ReadOwner | QFile::WriteOwner | QFile::ExeOwner));
        qputenv("HOME", m_home.path().toLocal8Bit());
        qputenv("XDG_DATA_HOME", m_home.filePath(QStringLiteral("data")).toLocal8Bit());
        qputenv("XDG_CONFIG_HOME", m_home.filePath(QStringLiteral("config")).toLocal8Bit());
        qputenv("XDG_RUNTIME_DIR", runtime.toLocal8Bit());
        // QtKeychain picks the Secret Service on GNOME.
        qputenv("XDG_CURRENT_DESKTOP", "GNOME");

        const QByteArray address = m_bus.start(m_home.path());
        QVERIFY(!address.isEmpty());
        qputenv("DBUS_SESSION_BUS_ADDRESS", address);

        // A keyring daemon of the test's own, unlocked with a throwaway
        // password, serving the Secret Service on the private bus.
        m_keyring.setProgram(QStringLiteral(TOKKL_GNOME_KEYRING_DAEMON));
        m_keyring.setArguments({QStringLiteral("--foreground"), QStringLiteral("--components=secrets"), QStringLiteral("--unlock")});
        m_keyring.setProcessEnvironment(QProcessEnvironment::systemEnvironment());
        m_keyring.start();
        QVERIFY2(m_keyring.waitForStarted(), qPrintable(m_keyring.errorString()));
        m_keyring.write("test-only-password");
        m_keyring.closeWriteChannel();

        QDBusConnection privateBus = QDBusConnection::connectToBus(QString::fromUtf8(address), QStringLiteral("keyring-check"));
        QVERIFY(privateBus.isConnected());
        const auto serving = [&privateBus] {
            return privateBus.interface()->isServiceRegistered(secretsService).value();
        };
        (void)QTest::qWaitFor(
            [this, &serving] {
                return serving() || m_keyring.state() != QProcess::Running;
            },
            20000);
        QVERIFY2(serving(), m_keyring.readAllStandardError().constData());

        // The bus libsecret uses is the private one.
        QDBusConnection session = QDBusConnection::sessionBus();
        QVERIFY(session.isConnected());
        const QDBusReply<QString> sessionId = session.interface()->call(QStringLiteral("GetId"));
        const QDBusReply<QString> privateId = privateBus.interface()->call(QStringLiteral("GetId"));
        QVERIFY(sessionId.isValid() && privateId.isValid());
        QCOMPARE(sessionId.value(), privateId.value());
        QDBusConnection::disconnectFromBus(QStringLiteral("keyring-check"));
    }

    void cleanupTestCase()
    {
        m_keyring.terminate();
        m_keyring.waitForFinished();
        m_bus.stop();
    }

    void readMissing()
    {
        KeychainCredentialStore store;
        const CredentialResult result = wait([&store](QObject *context, CredentialStore::Callback done) {
            store.read(QStringLiteral("token https://missing.example.test"), context, done);
        });
        QCOMPARE(result.status, CredentialResult::Status::NotFound);
        QVERIFY(result.secret.isEmpty());
    }

    void writeThenRead()
    {
        KeychainCredentialStore store;
        QSignalSpy changed(&store, &CredentialStore::secretChanged);
        const CredentialResult written = wait([&store](QObject *context, CredentialStore::Callback done) {
            store.write(key, QStringLiteral("tok-keyring-1"), context, done);
        });
        QCOMPARE(written.status, CredentialResult::Status::Ok);
        QCOMPARE(changed.count(), 1);
        QCOMPARE(changed.first().first().toString(), key);

        const CredentialResult read = wait([&store](QObject *context, CredentialStore::Callback done) {
            store.read(key, context, done);
        });
        QCOMPARE(read.status, CredentialResult::Status::Ok);
        QCOMPARE(read.secret, QStringLiteral("tok-keyring-1"));
    }

    // The secret is in the Secret Service, where libsecret's own tool finds
    // it under the key and the tokkl service.
    void storedInSecretService()
    {
        KeychainCredentialStore store;
        const CredentialResult written = wait([&store](QObject *context, CredentialStore::Callback done) {
            store.write(key, QStringLiteral("tok-keyring-2"), context, done);
        });
        QCOMPARE(written.status, CredentialResult::Status::Ok);

        QProcess lookup;
        lookup.start(QStringLiteral(TOKKL_SECRET_TOOL), {QStringLiteral("lookup"), QStringLiteral("user"), key, QStringLiteral("server"), KeychainCredentialStore::service});
        QVERIFY(lookup.waitForFinished(20000));
        QCOMPARE(lookup.exitCode(), 0);
        QCOMPARE(lookup.readAllStandardOutput(), QByteArray("tok-keyring-2"));
    }

private:
    QTemporaryDir m_home;
    PrivateBus m_bus;
    QProcess m_keyring;
};

QTEST_GUILESS_MAIN(KeychainStoreTest)
#include "keychainstoretest.moc"
