#pragma once

// A session bus daemon of the test's own, so nothing a test does reaches the
// user's session bus, keyring or services. It listens in a temporary
// directory and has no service files unless the test passes a directory.

#include <QByteArray>
#include <QFile>
#include <QProcess>
#include <QString>
#include <QTest>

class PrivateBus
{
public:
    ~PrivateBus()
    {
        stop();
    }

    // Starts dbus-daemon with its socket and configuration in dir. Services
    // in serviceDir, if given, can be activated. Returns the bus address, or
    // an empty one on failure.
    QByteArray start(const QString &dir, const QString &serviceDir = QString())
    {
        const QString config = dir + QStringLiteral("/bus.conf");
        QFile file(config);
        if (!file.open(QIODevice::WriteOnly)) {
            return QByteArray();
        }
        file.write(
            "<!DOCTYPE busconfig PUBLIC \"-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN\"\n"
            " \"http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd\">\n"
            "<busconfig>\n"
            "  <type>session</type>\n"
            "  <listen>unix:dir="
            + dir.toUtf8() + "</listen>\n");
        if (!serviceDir.isEmpty()) {
            file.write("  <servicedir>" + serviceDir.toUtf8() + "</servicedir>\n");
        }
        file.write(
            "  <auth>EXTERNAL</auth>\n"
            "  <policy context=\"default\">\n"
            "    <allow send_destination=\"*\" eavesdrop=\"true\"/>\n"
            "    <allow eavesdrop=\"true\"/>\n"
            "    <allow own=\"*\"/>\n"
            "  </policy>\n"
            "</busconfig>\n");
        file.close();

        m_daemon.setProgram(QStringLiteral(TOKKL_DBUS_DAEMON));
        m_daemon.setArguments({QStringLiteral("--config-file=") + config, QStringLiteral("--nofork"), QStringLiteral("--print-address")});
        m_daemon.start();
        if (!m_daemon.waitForStarted()) {
            return QByteArray();
        }
        if (!QTest::qWaitFor([this] {
                return m_daemon.canReadLine() || m_daemon.state() != QProcess::Running;
            })) {
            return QByteArray();
        }
        return m_daemon.readLine().trimmed();
    }

    void stop()
    {
        if (m_daemon.state() != QProcess::NotRunning) {
            m_daemon.terminate();
            m_daemon.waitForFinished();
        }
    }

private:
    QProcess m_daemon;
};
