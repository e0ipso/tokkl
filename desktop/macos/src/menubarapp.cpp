#include "menubarapp.h"

#include "clock.h"
#include "connection.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "settingswindow.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuswords.h"
#include "timercontroller.h"
#include "timerstateclient.h"
#include "transport.h"

#include <QSettings>

namespace Tokkl
{

QString MenuBarApp::clientName()
{
    return QStringLiteral("tokkl-macos");
}

Transport *MenuBarApp::createTransport(QObject *parent)
{
    return new NetworkTransport(clientName(), parent);
}

MenuBarApp::MenuBarApp(Transport *transport,
                       CredentialStore *store,
                       StatusItem *statusItem,
                       LoginItem *loginItem,
                       AlarmPlayer *alarmPlayer,
                       QSettings *settings,
                       Clock *clock,
                       QObject *parent)
    : QObject(parent)
    , m_statusItem(statusItem)
    , m_settings(settings)
    , m_ownClock(clock ? nullptr : std::make_unique<SystemClock>())
    , m_clock(clock ? clock : m_ownClock.get())
    , m_connection(std::make_unique<Connection>(transport, store, clientName()))
    , m_pomodoroStore(settings ? std::make_unique<SettingsPomodoroStore>(settings) : nullptr)
    , m_stateClient(std::make_unique<TimerStateClient>(m_connection.get(), m_clock))
    , m_timer(std::make_unique<TimerController>(m_clock))
{
    // The timer and the session read the same state client, so they agree
    // on the server's timer and session.
    m_timer->setStateClient(m_stateClient.get());
    m_preferences = std::make_unique<PomodoroPreferences>(m_connection.get());
    m_session = std::make_unique<PomodoroSession>(m_clock, m_timer.get(), m_stateClient.get(), m_pomodoroStore.get());
    m_alarm = std::make_unique<PomodoroAlarm>(m_session.get(), alarmPlayer, settings);
    m_menu = std::make_unique<StatusMenu>(m_timer.get(), m_session.get());
    m_settingsWindow = std::make_unique<SettingsWindow>(transport, store, settings, loginItem, m_preferences.get(), m_alarm.get());

    connect(m_menu.get(), &StatusMenu::settingsRequested, this, &MenuBarApp::showSettings);
    connect(m_menu.get(), &StatusMenu::openRequested, this, &MenuBarApp::openUrlRequested);
    connect(m_menu.get(), &StatusMenu::quitRequested, this, &MenuBarApp::quitRequested);
    connect(m_settingsWindow.get(), &SettingsWindow::saved, this, &MenuBarApp::applySettings);

    for (auto signal : {&TimerController::elapsedChanged,
                        &TimerController::statusChanged,
                        &TimerController::currentEntryChanged,
                        &TimerController::chainChanged,
                        &TimerController::choiceChanged,
                        &TimerController::projectsChanged,
                        &TimerController::entryProjectChanged,
                        &TimerController::indicatorChanged}) {
        connect(m_timer.get(), signal, this, &MenuBarApp::updateItem);
    }
    for (auto signal : {&PomodoroSession::modeChanged, &PomodoroSession::sessionChanged, &PomodoroSession::countdownChanged}) {
        connect(m_session.get(), signal, this, &MenuBarApp::updateItem);
    }

    if (m_statusItem) {
        m_statusItem->setMenu(m_menu->menu());
        connect(m_statusItem, &StatusItem::activated, this, &MenuBarApp::activate);
        connect(m_statusItem, &StatusItem::reduceMotionChanged, this, &MenuBarApp::updateItem);
    }
    updateItem();
}

// The menu, the window and the alarm go before the session, timer and
// connection they show, and the session before the parts it uses.
MenuBarApp::~MenuBarApp()
{
    if (m_statusItem) {
        m_statusItem->setMenu(nullptr);
    }
    m_settingsWindow.reset();
    m_menu.reset();
    m_alarm.reset();
    m_session.reset();
    m_preferences.reset();
    m_timer.reset();
    m_stateClient.reset();
    m_connection.reset();
}

void MenuBarApp::start()
{
    applySettings();
    if (m_connection->instanceUrl().isEmpty()) {
        showSettings();
    }
}

Connection *MenuBarApp::connection() const
{
    return m_connection.get();
}

TimerController *MenuBarApp::timer() const
{
    return m_timer.get();
}

PomodoroSession *MenuBarApp::pomodoroSession() const
{
    return m_session.get();
}

PomodoroPreferences *MenuBarApp::pomodoroPreferences() const
{
    return m_preferences.get();
}

PomodoroAlarm *MenuBarApp::pomodoroAlarm() const
{
    return m_alarm.get();
}

StatusMenu *MenuBarApp::statusMenu() const
{
    return m_menu.get();
}

SettingsWindow *MenuBarApp::settingsWindow() const
{
    return m_settingsWindow.get();
}

void MenuBarApp::showSettings()
{
    if (!m_settingsWindow->isVisible()) {
        m_settingsWindow->load();
    }
    m_settingsWindow->show();
    m_settingsWindow->raise();
    m_settingsWindow->activateWindow();
    Q_EMIT settingsShown();
}

void MenuBarApp::applySettings()
{
    if (!m_settings) {
        return;
    }
    m_connection->setInstanceUrl(m_settings->value(SettingsWindow::instanceUrlKey).toString());
    m_connection->setAuthModeString(m_settings->value(SettingsWindow::authModeKey, QStringLiteral("token")).toString());
    m_connection->setEmail(m_settings->value(SettingsWindow::emailKey).toString());
    updateItem();
}

void MenuBarApp::activate()
{
    // Mid-phase a click must not skip the phase, so it opens the menu.
    if (m_session->activate() == PomodoroSession::Activation::OpenMenu && m_statusItem) {
        m_statusItem->popUpMenu();
    }
}

void MenuBarApp::resumed()
{
    // The timer forwards to the state client, which reads at once.
    m_timer->resumed();
    m_session->resumed();
}

void MenuBarApp::updateItem()
{
    if (!m_statusItem) {
        return;
    }
    m_statusItem->setTitle(StatusWords::menuBarTitle(*m_timer, *m_session));
    m_statusItem->setToolTip(StatusWords::summary(*m_timer, *m_session));
    m_statusItem->setAccessibleName(StatusWords::itemName(*m_timer, *m_session));
    const bool monochrome = m_settings && m_settings->value(SettingsWindow::monochromeIconKey, false).toBool();
    m_statusItem->setImage(
        StatusImage::compose(ProjectIndicator::fromTimer(*m_timer, m_statusItem->reduceMotion()), monochrome, m_session->pomodoroMode()));
}

}
