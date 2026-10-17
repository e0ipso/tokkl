#pragma once

#include <QObject>
#include <QPointer>
#include <QUrl>

#include <memory>

class QSettings;

namespace Tokkl
{

class Clock;
class Connection;
class CredentialStore;
class LoginItem;
class SettingsWindow;
class StatusItem;
class StatusMenu;
class TimerController;
class Transport;

// The menu bar app without its platform layer: the connection and timer from
// the core, the menu bar item's text, project indicator and click, its menu
// and the settings window. main.mm hands it the NSStatusItem, the Keychain store, the
// SMAppService login item and the network; tests hand it fakes.
//
// A primary click on the item starts a stopped timer or stops a running one,
// as the menu's Start or Stop does. Timer state, requests and the project and
// billable rules stay in TimerController.
class MenuBarApp : public QObject
{
    Q_OBJECT

public:
    // The User-Agent product and the created_with value of the macOS app.
    static QString clientName();
    // The network transport for the app: requests send the User-Agent
    // "tokkl-macos/<Tokkl version>". The caller owns it.
    static Transport *createTransport(QObject *parent = nullptr);

    // Uses the given parts; the app owns none of them. A null clock is the
    // system clock; a null login item hides the toggle.
    MenuBarApp(Transport *transport,
               CredentialStore *store,
               StatusItem *statusItem,
               LoginItem *loginItem,
               QSettings *settings,
               Clock *clock = nullptr,
               QObject *parent = nullptr);
    ~MenuBarApp() override;

    // Applies the saved settings and, when no instance is set, opens the
    // settings window.
    void start();

    Connection *connection() const;
    TimerController *timer() const;
    StatusMenu *statusMenu() const;
    SettingsWindow *settingsWindow() const;

public Q_SLOTS:
    void showSettings();
    // Gives the connection the address, sign-in method and email in the
    // settings.
    void applySettings();

Q_SIGNALS:
    // The settings window is on screen; the platform brings the app forward.
    void settingsShown();
    void openUrlRequested(const QUrl &url);
    void quitRequested();

private:
    void updateItem();

    QPointer<StatusItem> m_statusItem;
    QPointer<QSettings> m_settings;
    std::unique_ptr<Connection> m_connection;
    std::unique_ptr<TimerController> m_timer;
    std::unique_ptr<StatusMenu> m_menu;
    std::unique_ptr<SettingsWindow> m_settingsWindow;
};

}
