// tokkl-timerd: the Tokkl timer and Pomodoro session of the shared desktop
// core as org.tokkl.Timer1 on the session bus, for the GNOME Shell
// extension, with the alarm played here on the sound server. D-Bus
// activation or its systemd user unit starts it.

#include "keychaincredentialstore.h"
#include "pomodoroalarm.h"
#include "pulsealarmbackend.h"
#include "timerservice.h"
#include "translations.h"
#include "transport.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QLoggingCategory>
#include <QSocketNotifier>
#include <QStandardPaths>

#include <csignal>
#include <cstdio>
#include <sys/socket.h>
#include <unistd.h>

namespace
{
// The program's own messages. The two that end it before the event loop
// runs go straight to stderr instead, where D-Bus activation and the
// activation test read them; Qt may send category output to the journal.
Q_LOGGING_CATEGORY(lcTimerd, "tokkl.timerd", QtInfoMsg)

// The write end of the pipe the signal handler wakes the event loop with.
int signalPipe = -1;

void onTerminate(int)
{
    const char byte = 1;
    // Only async-signal-safe calls here; the event loop does the rest.
    [[maybe_unused]] const ssize_t written = ::write(signalPipe, &byte, 1);
}

// Quits the event loop on SIGTERM, which systemd sends on logout, and on
// SIGINT, so the service leaves the bus and stops the alarm streams before
// it exits.
bool quitOnTerminate(QCoreApplication &app)
{
    int fds[2];
    if (::socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, fds) != 0) {
        return false;
    }
    signalPipe = fds[0];
    auto *notifier = new QSocketNotifier(fds[1], QSocketNotifier::Read, &app);
    QObject::connect(notifier, &QSocketNotifier::activated, &app, [fds, notifier] {
        notifier->setEnabled(false);
        char byte;
        [[maybe_unused]] const ssize_t read = ::read(fds[1], &byte, 1);
        qCInfo(lcTimerd) << "terminating";
        QCoreApplication::quit();
    });
    struct sigaction action = {};
    action.sa_handler = onTerminate;
    sigemptyset(&action.sa_mask);
    action.sa_flags = SA_RESTART;
    return ::sigaction(SIGTERM, &action, nullptr) == 0 && ::sigaction(SIGINT, &action, nullptr) == 0;
}
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("tokkl-timerd"));
    QCoreApplication::setApplicationVersion(QStringLiteral(TOKKL_VERSION_STRING));
    // The core's messages and the service's own reach the extension as they
    // are, so they are translated here, in the session's locale.
    const QStringList localeDirs = Tokkl::systemLocaleDirs();
    Tokkl::installTranslations(Tokkl::coreCatalog, localeDirs);
    Tokkl::installTranslations(QStringLiteral("tokkl_timerd_qt"), localeDirs);
    if (!quitOnTerminate(app)) {
        qCWarning(lcTimerd) << "cannot catch SIGTERM; the service will exit without leaving the bus";
    }

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
        qCWarning(lcTimerd).noquote() << "no sound:" << message;
    });
    Tokkl::PomodoroAlarm alarm(service.session(), &alarmBackend, service.soundChoices(), QStringLiteral(TOKKL_SOUNDS_DIR));
    service.setAlarm(&alarm);
    if (!service.registerOn(bus)) {
        std::fprintf(stderr, "tokkl-timerd: could not own %s on the session bus: %s\n", qPrintable(Tokkl::TimerService::serviceName),
                     qPrintable(bus.lastError().message()));
        return 1;
    }
    return app.exec();
}
