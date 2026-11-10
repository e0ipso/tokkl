// tokkl-timerd serves org.tokkl.Timer1 for the GNOME Shell extension and
// plays the alarm. main() builds and wires everything TimerService serves.

#include "clock.h"
#include "keychaincredentialstore.h"
#include "pomodoroalarm.h"
#include "pomodorostore.h"
#include "pulsealarmbackend.h"
#include "servicesettings.h"
#include "soundchoices.h"
#include "timerservice.h"
#include "timerstack.h"
#include "translations.h"
#include "transport.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QLoggingCategory>
#include <QSettings>
#include <QSocketNotifier>
#include <QStandardPaths>

#include <csignal>
#include <cstdio>
#include <sys/socket.h>
#include <unistd.h>

namespace
{
// Fatal startup errors go straight to stderr, where D-Bus activation and
// the activation test read them; Qt may send category output to the journal.
Q_LOGGING_CATEGORY(lcTimerd, "tokkl.timerd", QtInfoMsg)

int signalPipe = -1;

void onTerminate(int)
{
    const char byte = 1;
    // Only async-signal-safe calls here; the event loop does the rest.
    [[maybe_unused]] const ssize_t written = ::write(signalPipe, &byte, 1);
}

// SIGTERM (systemd on logout) and SIGINT quit the loop, so the service
// leaves the bus and stops the alarm streams.
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
    // Messages reach the extension as they are, so translate them here.
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
    // Never holds the secret.
    QSettings settings(QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/tokkl/tokkl-timerd.conf"),
                       QSettings::IniFormat);
    Tokkl::SystemClock clock;
    Tokkl::SettingsPomodoroStore pomodoroStore(&settings);
    Tokkl::TimerStack stack(&transport, &store, pomodoroStore, clock, Tokkl::TimerService::clientName());
    Tokkl::TimerController *timer = stack.timer();
    Tokkl::SoundChoices sounds(&settings, &Tokkl::TimerService::soundKey);
    Tokkl::ServiceSettings connectionSettings(&settings, stack.connection(), &store);
    Tokkl::PulseAlarmBackend alarmBackend(QCoreApplication::applicationName());
    QObject::connect(&alarmBackend, &Tokkl::PulseAlarmBackend::errorOccurred, &app, [](const QString &message) {
        qCWarning(lcTimerd).noquote() << "no sound:" << message;
    });
    Tokkl::PomodoroAlarm alarm(*stack.session(), alarmBackend, sounds, QStringLiteral(TOKKL_SOUNDS_DIR));
    Tokkl::TimerService service({timer, stack.session(), stack.preferences(), &sounds, &connectionSettings, &alarm});
    connectionSettings.load();
    if (!service.registerOn(bus)) {
        std::fprintf(stderr, "tokkl-timerd: could not own %s on the session bus: %s\n", qPrintable(Tokkl::TimerService::serviceName),
                     qPrintable(bus.lastError().message()));
        return 1;
    }
    return app.exec();
}
