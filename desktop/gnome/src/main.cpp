// tokkl-timerd: the Tokkl timer and Pomodoro session of the shared desktop
// core as org.tokkl.Timer1 on the session bus, for the GNOME Shell
// extension, with the alarm played here on the sound server. D-Bus
// activation or its systemd user unit starts it.

#include "alarmplayer.h"
#include "keychaincredentialstore.h"
#include "pulsealarmbackend.h"
#include "timerservice.h"
#include "transport.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QStandardPaths>

#include <cstdio>

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("tokkl-timerd"));
    QCoreApplication::setApplicationVersion(QStringLiteral(TOKKL_VERSION_STRING));

    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
        std::fprintf(stderr, "tokkl-timerd: no session bus: %s\n", qPrintable(bus.lastError().message()));
        return 1;
    }

    Tokkl::NetworkTransport transport(Tokkl::TimerService::clientName());
    Tokkl::KeychainCredentialStore store;
    const QString settingsFile = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/tokkl/tokkl-timerd.conf");
    Tokkl::TimerService service(&transport, &store, settingsFile);
    // The Pomodoro alarm, from the bundled sounds the package installs.
    Tokkl::PulseAlarmBackend alarmBackend(QCoreApplication::applicationName());
    QObject::connect(&alarmBackend, &Tokkl::PulseAlarmBackend::errorOccurred, &service, [](const QString &message) {
        std::fprintf(stderr, "tokkl-timerd: no sound: %s\n", qPrintable(message));
    });
    Tokkl::AlarmPlayer player(&service, &alarmBackend, QStringLiteral(TOKKL_SOUNDS_DIR));
    if (!service.registerOn(bus)) {
        std::fprintf(stderr, "tokkl-timerd: could not own %s on the session bus: %s\n", qPrintable(Tokkl::TimerService::serviceName),
                     qPrintable(bus.lastError().message()));
        return 1;
    }
    return app.exec();
}
