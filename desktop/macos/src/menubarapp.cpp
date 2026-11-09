#include "menubarapp.h"

#include "alarmplayer.h"
#include "connectionsettings.h"
#include "pomodoroalarm.h"
#include "pomodorostore.h"
#include "settingssave.h"
#include "settingswindow.h"
#include "soundchoices.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuswords.h"
#include "timerstack.h"
#include "transport.h"

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
                       StatusItem &statusItem,
                       LoginItem &loginItem,
                       AlarmPlayer &alarmPlayer,
                       QSettings &settings,
                       Clock &clock,
                       const QString &soundsDirectory,
                       QObject *parent)
    : QObject(parent)
    , m_statusItem(statusItem)
    , m_settings(settings)
    , m_pomodoroStore(new SettingsPomodoroStore(&settings, this))
    , m_stack(new TimerStack(transport, store, *m_pomodoroStore, clock, clientName(), this))
    , m_connection(m_stack->connection())
    , m_timer(m_stack->timer())
    , m_preferences(m_stack->preferences())
    , m_session(m_stack->session())
{
    m_sounds = new SoundChoices(&settings, &MenuBarApp::soundKey, this);
    m_alarm = new PomodoroAlarm(*m_session, alarmPlayer, *m_sounds, soundsDirectory, this);
    m_menu = new StatusMenu(*m_timer, *m_session, *m_alarm, this);
    m_settingsWindow = std::make_unique<SettingsWindow>(transport, store, settings, loginItem, *m_preferences, *m_sounds, *m_alarm);

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

    m_statusItem.setMenu(m_menu->menu());
    connect(&m_statusItem, &StatusItem::activated, this, &MenuBarApp::activate);
    connect(&m_statusItem, &StatusItem::reduceMotionChanged, this, &MenuBarApp::updateItem);
    updateItem();
}

// The menu, the window and the alarm go before the session, timer and
// connection they show, and the stack before the store its session uses.
// The children would otherwise go in the order they were made.
MenuBarApp::~MenuBarApp()
{
    m_statusItem.setMenu(nullptr);
    m_settingsWindow.reset();
    delete m_menu;
    delete m_alarm;
    delete m_sounds;
    delete m_stack;
    delete m_pomodoroStore;
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
    ConnectionSettings::read(m_settings).applyTo(*m_connection);
    updateItem();
}

void MenuBarApp::activate()
{
    // Mid-phase a click must not skip the phase, so it opens the menu.
    if (m_session->activate() == PomodoroSession::Activation::OpenMenu) {
        m_statusItem.popUpMenu();
    }
}

void MenuBarApp::resumed()
{
    m_timer->stateClient()->resumed();
}

void MenuBarApp::updateItem()
{
    m_statusItem.setTitle(StatusWords::menuBarTitle(*m_timer, *m_session));
    m_statusItem.setToolTip(StatusWords::summary(*m_timer, *m_session));
    m_statusItem.setAccessibleName(StatusWords::itemName(*m_timer, *m_session));
    const bool monochrome = m_settings.value(SettingsSave::monochromeIconKey, false).toBool();
    m_statusItem.setImage(
        StatusImage::compose(ProjectIndicator::fromTimer(*m_timer, m_statusItem.reduceMotion()), monochrome, m_session->pomodoroMode()));
}

}
