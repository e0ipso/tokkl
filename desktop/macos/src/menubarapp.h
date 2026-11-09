#pragma once

#include "apitypes.h"

#include <QObject>
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
class SoundChoices;
class StatusItem;
class StatusMenu;
class TimerController;
class TimerStack;
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
// entry and its Stop Timer ends the chain. TimerController keeps the
// request, project and billable rules; PomodoroSession the session rules.
class MenuBarApp : public QObject
{
    Q_OBJECT

public:
    // The User-Agent product and the created_with value of the macOS app.
    static QString clientName();
    // The settings key of a transition's sound: "workToShortRestSound" and
    // so on.
    static QString soundKey(TransitionKind kind);
    // The network transport for the app: requests send the User-Agent
    // "tokkl-macos/<Tokkl version>". The caller owns it.
    static Transport *createTransport(QObject *parent = nullptr);

    // Uses the given parts; the app owns none of them. The settings keep
    // the connection, the Pomodoro mode and the alarm sounds.
    MenuBarApp(Transport *transport,
               CredentialStore *store,
               StatusItem &statusItem,
               LoginItem &loginItem,
               AlarmPlayer &alarmPlayer,
               QSettings &settings,
               Clock &clock,
               QObject *parent = nullptr);
    ~MenuBarApp() override;

    // Applies the saved settings and, when no instance is set, opens the
    // settings window.
    void start();

public Q_SLOTS:
    void showSettings();
    // Gives the connection the address, sign-in method and email in the
    // settings.
    void applySettings();
    // The system woke from sleep: the timer's state client handles it as it
    // would a late tick, at once, and the timer and session follow it.
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

    StatusItem &m_statusItem;
    QSettings &m_settings;
    // The app's parts are its children; the destructor deletes the ones
    // that use others first. The settings window is a top-level widget, so
    // the app holds it apart.
    SettingsPomodoroStore *m_pomodoroStore = nullptr;
    // The connection, the timer, the session and the preferences client,
    // which the next four name.
    TimerStack *m_stack;
    Connection *m_connection;
    TimerController *m_timer;
    PomodoroPreferences *m_preferences;
    PomodoroSession *m_session;
    SoundChoices *m_sounds = nullptr;
    PomodoroAlarm *m_alarm = nullptr;
    StatusMenu *m_menu = nullptr;
    std::unique_ptr<SettingsWindow> m_settingsWindow;
};

}
