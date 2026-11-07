// tokkl-timerd: the Tokkl timer and Pomodoro session of the shared desktop
// core as org.tokkl.Timer1 on the session bus, for the GNOME Shell
// extension, with the alarm played here on the sound server. D-Bus
// activation or its systemd user unit starts it.

#include "keychaincredentialstore.h"
#include "pomodoroalarm.h"
#include "pulsealarmbackend.h"
#include "timerservice.h"
#include "transport.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QLoggingCategory>
#include <QStandardPaths>

namespace
{
Q_LOGGING_CATEGORY(lcTimerd, "tokkl.timerd", QtInfoMsg)
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("tokkl-timerd"));
    QCoreApplication::setApplicationVersion(QStringLiteral(TOKKL_VERSION_STRING));

    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
        qCCritical(lcTimerd) << "No session bus:" << bus.lastError().message();
        return 1;
    }

    Tokkl::NetworkTransport transport(Tokkl::TimerService::clientName());
    Tokkl::KeychainCredentialStore store;
    const QString settingsFile = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/tokkl/tokkl-timerd.conf");
    Tokkl::TimerService service(&transport, &store, settingsFile);
    // The Pomodoro alarm, from the bundled sounds the package installs.
    Tokkl::PulseAlarmBackend alarmBackend(QCoreApplication::applicationName());
    QObject::connect(&alarmBackend, &Tokkl::PulseAlarmBackend::errorOccurred, &service, [](const QString &message) {
        qCWarning(lcTimerd) << "No sound:" << message;
    });
    Tokkl::PomodoroAlarm alarm(service.session(), &alarmBackend, service.soundChoices(), QStringLiteral(TOKKL_SOUNDS_DIR));
    service.setAlarm(&alarm);
    if (!service.registerOn(bus)) {
        qCCritical(lcTimerd) << "Could not own" << Tokkl::TimerService::serviceName << "on the session bus:" << bus.lastError().message();
        return 1;
    }
    return app.exec();
}
