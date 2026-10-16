// tokkl-timerd: the Tokkl timer of the shared desktop core as
// org.tokkl.Timer1 on the session bus, for the GNOME Shell extension. D-Bus
// activation or its systemd user unit starts it.

#include "keychaincredentialstore.h"
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
    if (!service.registerOn(bus)) {
        std::fprintf(stderr, "tokkl-timerd: could not own %s on the session bus: %s\n", qPrintable(Tokkl::TimerService::serviceName),
                     qPrintable(bus.lastError().message()));
        return 1;
    }
    return app.exec();
}
