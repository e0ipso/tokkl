#pragma once

#include <QObject>
#include <QPointer>
#include <QUrl>

#include <memory>

class QSettings;

namespace Tokkl
{

class AlarmPlayer;
class Clock;
class Connection;
class CredentialStore;
class LoginItem;
class PomodoroAlarm;
class PomodoroPreferences;
class PomodoroSession;
class SettingsPomodoroStore;
class SettingsWindow;
class StatusItem;
class StatusMenu;
class TimerController;
class TimerStateClient;
class Transport;

// The menu bar app without its platform layer: the connection, the shared
// timer state client, the timer and Pomodoro session from the core, the menu
// bar item's text, logo, project indicator, hourglass and click, its menu,
// the alarm and the settings window. main.mm hands it the NSStatusItem, the
// Keychain store, the SMAppService login item, the NSSound player and the
// network; tests hand it fakes.
//
// The timer, the pause chain and the Pomodoro session belong to the server,
// so a timer or session started, paused or ended on another device shows
// here, in either mode. A primary click goes to PomodoroSession::activate().
// With a session active it confirms Next phase while the alarm rings and
// otherwise opens the menu, in either mode. Without one, in Timer mode and on
// a running or paused timer in either mode, it pauses a running timer,
// resumes a paused one and starts a stopped one. In Pomodoro mode with
// nothing running it starts a session. The menu's Start Timer starts a new
// entry and its Stop Timer ends the chain. Timer state, requests and the
// project and billable rules stay in TimerController; the session rules stay
// in PomodoroSession.
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
    // system clock; a null login item hides the toggle; a null alarm player
    // keeps the alarm silent. The settings keep
    // the Pomodoro mode and the alarm sounds; with null settings the mode
    // stays in memory only.
    MenuBarApp(Transport *transport,
               CredentialStore *store,
               StatusItem *statusItem,
               LoginItem *loginItem,
               AlarmPlayer *alarmPlayer,
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
    PomodoroAlarm *pomodoroAlarm() const;
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
    std::unique_ptr<SettingsPomodoroStore> m_pomodoroStore;
    std::unique_ptr<TimerStateClient> m_stateClient;
    std::unique_ptr<TimerController> m_timer;
    std::unique_ptr<PomodoroPreferences> m_preferences;
    std::unique_ptr<PomodoroSession> m_session;
    std::unique_ptr<PomodoroAlarm> m_alarm;
    std::unique_ptr<StatusMenu> m_menu;
    std::unique_ptr<SettingsWindow> m_settingsWindow;
};

}
