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
class SettingsChainStore;
class CredentialStore;
class LoginItem;
class PomodoroPreferences;
class PomodoroQueue;
class PomodoroSession;
class SettingsPomodoroStore;
class SettingsWindow;
class StatusItem;
class StatusMenu;
class TimerController;
class Transport;

// The menu bar app without its platform layer: the connection, timer and
// Pomodoro session from the core, the menu bar item's text, logo, project
// indicator, hourglass and click, its menu and the settings window. main.mm
// hands it the NSStatusItem, the Keychain store, the SMAppService login item
// and the network; tests hand it fakes.
//
// A primary click goes to PomodoroSession::activate(). In Timer mode, and on
// a running or paused timer in either mode, it pauses a running timer,
// resumes a paused one and starts a stopped one. In Pomodoro mode it starts a
// session, confirms Next phase while the alarm rings, and otherwise opens the
// menu. The menu's Start Timer starts a new entry and its Stop Timer ends the
// chain. Timer state, requests, the pause chain and the project and billable
// rules stay in TimerController; the session rules stay in PomodoroSession.
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
    // system clock; a null login item hides the toggle. The timer keeps its
    // pause chain in settings, so a relaunch keeps the total, and the session
    // keeps the mode, the session, the cached lengths and the unsaved
    // pomodoros there. With null settings the chain and the mode stay in
    // memory only, and no session can start.
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
    PomodoroSession *pomodoroSession() const;
    PomodoroPreferences *pomodoroPreferences() const;
    StatusMenu *statusMenu() const;
    SettingsWindow *settingsWindow() const;

public Q_SLOTS:
    void showSettings();
    // Gives the connection the address, sign-in method and email in the
    // settings.
    void applySettings();
    // The system woke from sleep: the timer reads the current entry and the
    // session the clock at once.
    void resumed();

Q_SIGNALS:
    // The settings window is on screen; the platform brings the app forward.
    void settingsShown();
    void openUrlRequested(const QUrl &url);
    void quitRequested();

private:
    // A primary click on the item.
    void activate();
    void updateItem();

    QPointer<StatusItem> m_statusItem;
    QPointer<QSettings> m_settings;
    // The system clock when none was given; m_clock is the one in use.
    std::unique_ptr<Clock> m_ownClock;
    Clock *m_clock = nullptr;
    std::unique_ptr<Connection> m_connection;
    std::unique_ptr<SettingsChainStore> m_chainStore;
    std::unique_ptr<SettingsPomodoroStore> m_pomodoroStore;
    std::unique_ptr<TimerController> m_timer;
    std::unique_ptr<PomodoroPreferences> m_preferences;
    std::unique_ptr<PomodoroQueue> m_queue;
    std::unique_ptr<PomodoroSession> m_session;
    std::unique_ptr<StatusMenu> m_menu;
    std::unique_ptr<SettingsWindow> m_settingsWindow;
};

}
