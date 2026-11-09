#include "menubarapp.h"

#include "alarmplayer.h"
#include "clock.h"
#include "connection.h"
#include "connectionsettings.h"
#include "pomodoroalarm.h"
#include "pomodoropreferences.h"
#include "pomodorosession.h"
#include "pomodorostore.h"
#include "settingssave.h"
#include "settingswindow.h"
#include "soundchoices.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuswords.h"
#include "timercontroller.h"
#include "timerstateclient.h"
#include "transport.h"

#include <QCoreApplication>
#include <QSettings>

namespace Tokkl
{

QString MenuBarApp::clientName()
{
    return QStringLiteral("tokkl-macos");
}

QString MenuBarApp::soundKey(TransitionKind kind)
{
    return transitionKindName(kind) + QStringLiteral("Sound");
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
    , m_connection(new Connection(transport, store, clientName(), this))
    , m_pomodoroStore(settings ? new SettingsPomodoroStore(settings, this) : nullptr)
    , m_stateClient(new TimerStateClient(m_connection, m_clock, this))
    , m_timer(new TimerController(m_clock, this))
{
    m_connection->setClock(m_clock);
    // The timer and the session read the same state client, so they agree
    // on the server's timer and session.
    m_timer->setStateClient(m_stateClient);
    m_preferences = new PomodoroPreferences(m_connection, this);
    // The session reads and acts through the timer's state client.
    m_session = new PomodoroSession(m_clock, m_timer->coordinator(), m_stateClient, m_pomodoroStore, this);
    m_sounds = new SoundChoices(settings, &MenuBarApp::soundKey, this);
    // The bundle's Contents/Resources/sounds, which the build fills from
    // TOKKL_POMODORO_SOUND_FILES.
    m_alarm = new PomodoroAlarm(m_session,
                                alarmPlayer,
                                m_sounds,
                                QString(QCoreApplication::applicationDirPath() + QStringLiteral("/../Resources/sounds")),
                                this);
    m_menu = new StatusMenu(m_timer, m_timer->coordinator(), m_session, m_alarm, this);
    m_settingsWindow = std::make_unique<SettingsWindow>(transport, store, settings, loginItem, m_preferences, m_sounds, m_alarm);

    connect(m_menu, &StatusMenu::settingsRequested, this, &MenuBarApp::showSettings);
    connect(m_menu, &StatusMenu::openRequested, this, &MenuBarApp::openUrlRequested);
    connect(m_menu, &StatusMenu::quitRequested, this, &MenuBarApp::quitRequested);
    connect(m_settingsWindow.get(), &SettingsWindow::saved, this, &MenuBarApp::applySettings);

    for (auto signal : {&TimerModel::elapsedChanged,
                        &TimerModel::statusChanged,
                        &TimerModel::currentEntryChanged,
                        &TimerModel::chainChanged,
                        &TimerModel::choiceChanged,
                        &TimerModel::projectsChanged,
                        &TimerModel::entryProjectChanged,
                        &TimerModel::indicatorChanged}) {
        connect(m_timer, signal, this, &MenuBarApp::updateItem);
    }
    for (auto signal : {&PomodoroSession::modeChanged, &PomodoroSession::sessionChanged, &PomodoroSession::countdownChanged}) {
        connect(m_session, signal, this, &MenuBarApp::updateItem);
    }

    if (m_statusItem) {
        m_statusItem->setMenu(m_menu->menu());
        connect(m_statusItem, &StatusItem::activated, this, &MenuBarApp::activate);
        connect(m_statusItem, &StatusItem::reduceMotionChanged, this, &MenuBarApp::updateItem);
    }
    updateItem();
}

// The menu, the window and the alarm go before the session, timer and
// connection they show, and the session before the parts it uses. The
// children would otherwise go in the order they were made, the reverse.
MenuBarApp::~MenuBarApp()
{
    if (m_statusItem) {
        m_statusItem->setMenu(nullptr);
    }
    m_settingsWindow.reset();
    delete m_menu;
    delete m_alarm;
    delete m_sounds;
    delete m_session;
    delete m_preferences;
    delete m_timer;
    delete m_stateClient;
    delete m_connection;
}

void MenuBarApp::start()
{
    applySettings();
    if (m_connection->instanceUrl().isEmpty()) {
        showSettings();
    }
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
    ConnectionSettings::read(*m_settings).applyTo(*m_connection);
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
    const bool monochrome = m_settings && m_settings->value(SettingsSave::monochromeIconKey, false).toBool();
    m_statusItem->setImage(
        StatusImage::compose(ProjectIndicator::fromTimer(*m_timer, m_statusItem->reduceMotion()), monochrome, m_session->pomodoroMode()));
}

}
