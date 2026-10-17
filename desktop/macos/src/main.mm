// Tokkl for the macOS menu bar: the platform parts handed to MenuBarApp.

#include "keychaincredentialstore.h"
#include "macloginitem.h"
#include "macstatusitem.h"
#include "menubarapp.h"
#include "timercontroller.h"
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
    // QSettings keeps the nonsecret settings in
    // ~/Library/Preferences/com.github.e0ipso.Tokkl.plist.
    QApplication::setOrganizationDomain(QStringLiteral("e0ipso.github.com"));
    QApplication::setApplicationName(QStringLiteral("Tokkl"));
    QApplication::setApplicationVersion(QStringLiteral(TOKKL_VERSION_STRING));
    // Closing the settings window leaves the menu bar item running.
    QApplication::setQuitOnLastWindowClosed(false);

    const std::unique_ptr<Tokkl::Transport> transport(Tokkl::MenuBarApp::createTransport());
    Tokkl::KeychainCredentialStore store;
    Tokkl::MacStatusItem statusItem;
    Tokkl::MacLoginItem loginItem;
    QSettings settings;

    Tokkl::MenuBarApp tokkl(transport.get(), &store, &statusItem, &loginItem, &settings);
    QObject::connect(&tokkl, &Tokkl::MenuBarApp::settingsShown, &tokkl, &bringToFront);
    // The configured base URL only: it never holds credentials.
    QObject::connect(&tokkl, &Tokkl::MenuBarApp::openUrlRequested, &tokkl, [](const QUrl &url) {
        QDesktopServices::openUrl(url);
    });
    QObject::connect(&tokkl, &Tokkl::MenuBarApp::quitRequested, &app, &QCoreApplication::quit, Qt::QueuedConnection);

    // Read the timer at once after sleep instead of waiting for a late tick.
    QPointer<Tokkl::TimerController> timer = tokkl.timer();
    id wakeObserver = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidWakeNotification
                                                                                  object:nil
                                                                                   queue:NSOperationQueue.mainQueue
                                                                              usingBlock:^(NSNotification *notification) {
                                                                                  Q_UNUSED(notification);
                                                                                  if (timer) {
                                                                                      timer->resumed();
                                                                                  }
                                                                              }];

    tokkl.start();
    const int status = app.exec();
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:wakeObserver];
    return status;
}
