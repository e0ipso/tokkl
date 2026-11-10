#include "clock.h"
#include "keychaincredentialstore.h"
#include "macalarmplayer.h"
#include "macloginitem.h"
#include "macstatusitem.h"
#include "menubarapp.h"
#include "translations.h"
#include "transport.h"

#include <QApplication>
#include <QDesktopServices>
#include <QPointer>
#include <QSettings>

#include <memory>

#import <AppKit/AppKit.h>

// Compiled with ARC.

namespace
{
// An agent app (LSUIElement) is never active on its own, so a window it
// opens would stay behind the frontmost app.
void bringToFront()
{
    if (@available(macOS 14.0, *)) {
        [NSApp activate];
    } else {
        [NSApp activateIgnoringOtherApps:YES];
    }
}
}

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    // Settings go to ~/Library/Preferences/com.canpicasoft.Tokkl.plist.
    QApplication::setOrganizationDomain(QStringLiteral("canpicasoft.com"));
    QApplication::setApplicationName(QStringLiteral("Tokkl"));
    QApplication::setApplicationVersion(QStringLiteral(TOKKL_VERSION_STRING));
    const QStringList localeDirs{QCoreApplication::applicationDirPath() + QStringLiteral("/../Resources/locale")};
    Tokkl::installTranslations(Tokkl::coreCatalog, localeDirs);
    Tokkl::installTranslations(QStringLiteral("tokkl_macos_qt"), localeDirs);
    QApplication::setQuitOnLastWindowClosed(false);

    const std::unique_ptr<Tokkl::Transport> transport(Tokkl::MenuBarApp::createTransport());
    Tokkl::KeychainCredentialStore store;
    Tokkl::MacStatusItem statusItem;
    Tokkl::MacLoginItem loginItem;
    Tokkl::MacAlarmPlayer alarmPlayer;
    QSettings settings;
    Tokkl::SystemClock clock;

    Tokkl::MenuBarApp tokkl(transport.get(),
                            &store,
                            statusItem,
                            loginItem,
                            alarmPlayer,
                            settings,
                            clock,
                            QCoreApplication::applicationDirPath() + QStringLiteral("/../Resources/sounds"));
    QObject::connect(&tokkl, &Tokkl::MenuBarApp::settingsShown, &tokkl, &bringToFront);
    // The configured base URL never holds credentials.
    QObject::connect(&tokkl, &Tokkl::MenuBarApp::openUrlRequested, &tokkl, [](const QUrl &url) {
        QDesktopServices::openUrl(url);
    });
    QObject::connect(&tokkl, &Tokkl::MenuBarApp::quitRequested, &app, &QCoreApplication::quit, Qt::QueuedConnection);

    // The core counts this and the late tick that follows as one wake.
    QPointer<Tokkl::MenuBarApp> menuBarApp(&tokkl);
    id wakeObserver = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidWakeNotification
                                                                                  object:nil
                                                                                   queue:NSOperationQueue.mainQueue
                                                                              usingBlock:^(NSNotification *notification) {
                                                                                  Q_UNUSED(notification);
                                                                                  if (menuBarApp) {
                                                                                      menuBarApp->resumed();
                                                                                  }
                                                                              }];

    tokkl.start();
    const int status = app.exec();
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:wakeObserver];
    return status;
}
