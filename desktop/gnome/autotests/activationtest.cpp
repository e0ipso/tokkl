// D-Bus activation of the built tokkl-timerd through the activation file the
// project installs, on a private D-Bus daemon whose only service directory
// holds that file. The first call to org.tokkl.Timer1 starts the program; a
// second copy cannot take the name and exits.

#include "privatebus.h"

#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusReply>
#include <QDBusVariant>
#include <QFileInfo>
#include <QProcess>
#include <QTemporaryDir>
#include <QTest>

#include <signal.h>

namespace
{
const QString service = QStringLiteral("org.tokkl.Timer1");
const QString path = QStringLiteral("/org/tokkl/Timer1");
const QString busName = QStringLiteral("activation-client");
}

class ActivationTest : public QObject
{
    Q_OBJECT

    QDBusMessage call(const QString &interface, const QString &method, const QVariantList &arguments = {})
    {
        QDBusMessage message = QDBusMessage::createMethodCall(service, path, interface, method);
        message.setArguments(arguments);
        QDBusPendingCall pending = QDBusConnection(busName).asyncCall(message, 20000);
        if (!QTest::qWaitFor(
                [&pending] {
                    return pending.isFinished();
                },
                25000)) {
            return QDBusMessage();
        }
        return pending.reply();
    }

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(m_home.isValid());
        // The program the bus starts inherits this environment: settings from
        // an empty directory and no address of another session bus.
        qputenv("HOME", m_home.path().toLocal8Bit());
        qputenv("XDG_CONFIG_HOME", m_home.filePath(QStringLiteral("config")).toLocal8Bit());
        qputenv("XDG_DATA_HOME", m_home.filePath(QStringLiteral("data")).toLocal8Bit());
        qunsetenv("DBUS_SESSION_BUS_ADDRESS");
        qunsetenv("DISPLAY");

        m_address = m_bus.start(m_home.path(), QStringLiteral(TOKKL_ACTIVATION_DIR));
        QVERIFY(!m_address.isEmpty());
        QVERIFY(QDBusConnection::connectToBus(QString::fromUtf8(m_address), busName).isConnected());
    }

    void cleanupTestCase()
    {
        // A service a failed check left running.
        if (m_pid != 0 && ::kill(static_cast<pid_t>(m_pid), 0) == 0) {
            ::kill(static_cast<pid_t>(m_pid), SIGTERM);
        }
        QDBusConnection::disconnectFromBus(busName);
        m_bus.stop();
    }

    void firstCallStartsTheService()
    {
        QDBusConnectionInterface *bus = QDBusConnection(busName).interface();
        QVERIFY(!bus->isServiceRegistered(service).value());
        QVERIFY(bus->activatableServiceNames().value().contains(service));

        const QDBusMessage status = call(QStringLiteral("org.freedesktop.DBus.Properties"), QStringLiteral("Get"), {service, QStringLiteral("Status")});
        QVERIFY2(status.type() == QDBusMessage::ReplyMessage, qPrintable(status.errorMessage()));
        QCOMPARE(status.arguments().constFirst().value<QDBusVariant>().variant().toString(), QStringLiteral("unconfigured"));

        const QDBusReply<uint> pid = bus->servicePid(service);
        QVERIFY(pid.isValid());
        m_pid = pid.value();
        QCOMPARE(QFileInfo(QStringLiteral("/proc/%1/exe").arg(m_pid)).canonicalFilePath(), QFileInfo(QStringLiteral(TOKKL_TIMERD)).canonicalFilePath());
    }

    void secondCopyExits()
    {
        QVERIFY(m_pid != 0);
        QProcess second;
        QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
        environment.insert(QStringLiteral("DBUS_SESSION_BUS_ADDRESS"), QString::fromUtf8(m_address));
        second.setProcessEnvironment(environment);
        second.start(QStringLiteral(TOKKL_TIMERD), QStringList());
        QVERIFY(second.waitForFinished(20000));
        QCOMPARE(second.exitStatus(), QProcess::NormalExit);
        QCOMPARE(second.exitCode(), 1);
        QVERIFY(second.readAllStandardError().contains("could not own org.tokkl.Timer1"));
        QCOMPARE(QDBusConnection(busName).interface()->servicePid(service).value(), m_pid);
    }

    void stopsOnTerm()
    {
        QVERIFY(m_pid != 0);
        QCOMPARE(::kill(static_cast<pid_t>(m_pid), SIGTERM), 0);
        QVERIFY(QTest::qWaitFor(
            [] {
                return !QDBusConnection(busName).interface()->isServiceRegistered(service).value();
            },
            20000));
    }

private:
    QTemporaryDir m_home;
    PrivateBus m_bus;
    QByteArray m_address;
    uint m_pid = 0;
};

QTEST_GUILESS_MAIN(ActivationTest)
#include "activationtest.moc"
