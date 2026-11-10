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

// The menu bar app without its platform layer: main.mm hands it the AppKit
// parts, tests hand it fakes.
class MenuBarApp : public QObject
{
    Q_OBJECT

public:
    static QString clientName();
    static QString soundKey(TransitionKind kind);
    // The caller owns the transport.
    static Transport *createTransport(QObject *parent = nullptr);

    // Owns none of the parts.
    MenuBarApp(Transport *transport,
               CredentialStore *store,
               StatusItem &statusItem,
               LoginItem &loginItem,
               AlarmPlayer &alarmPlayer,
               QSettings &settings,
               Clock &clock,
               const QString &soundsDirectory,
               QObject *parent = nullptr);
    ~MenuBarApp() override;

    // Opens the settings window when no instance is set.
    void start();

public Q_SLOTS:
    void showSettings();
    void applySettings();
    // After sleep, handled at once like a late tick.
    void resumed();

Q_SIGNALS:
    // The platform brings the app forward.
    void settingsShown();
    void openUrlRequested(const QUrl &url);
    void quitRequested();

private:
    void activate();
    void updateItem();

    StatusItem &m_statusItem;
    QSettings &m_settings;
    // The destructor deletes the parts that use others first. The settings
    // window is a top-level widget, so it is not a child.
    SettingsPomodoroStore *m_pomodoroStore = nullptr;
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
