#include "menubarapp.h"

#include "chainstore.h"
#include "connection.h"
#include "settingswindow.h"
#include "statusitem.h"
#include "statusmenu.h"
#include "statuswords.h"
#include "timercontroller.h"
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
                       QSettings *settings,
                       Clock *clock,
                       QObject *parent)
    : QObject(parent)
    , m_statusItem(statusItem)
    , m_settings(settings)
    , m_connection(std::make_unique<Connection>(transport, store, clientName()))
    , m_chainStore(settings ? std::make_unique<SettingsChainStore>(settings) : nullptr)
    , m_timer(clock ? std::make_unique<TimerController>(clock) : std::make_unique<TimerController>())
    , m_settingsWindow(std::make_unique<SettingsWindow>(transport, store, settings, loginItem))
{
    // Before the connection: the stored chain is read with its first entry.
    m_timer->setChainStore(m_chainStore.get());
    m_timer->setConnection(m_connection.get());
    m_menu = std::make_unique<StatusMenu>(m_timer.get());

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

    if (m_statusItem) {
        m_statusItem->setMenu(m_menu->menu());
        connect(m_statusItem, &StatusItem::activated, m_timer.get(), &TimerController::toggle);
        connect(m_statusItem, &StatusItem::reduceMotionChanged, this, &MenuBarApp::updateItem);
    }
    updateItem();
}

// The menu and the window go before the timer and connection they show.
MenuBarApp::~MenuBarApp()
{
    if (m_statusItem) {
        m_statusItem->setMenu(nullptr);
    }
    m_settingsWindow.reset();
    m_menu.reset();
    m_timer.reset();
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

void MenuBarApp::updateItem()
{
    if (!m_statusItem) {
        return;
    }
    m_statusItem->setTitle(StatusWords::menuBarTitle(*m_timer));
    m_statusItem->setToolTip(StatusWords::summary(*m_timer));
    m_statusItem->setAccessibleName(StatusWords::itemName(*m_timer));
    const bool monochrome = m_settings && m_settings->value(SettingsWindow::monochromeIconKey, false).toBool();
    m_statusItem->setImage(StatusImage::compose(ProjectIndicator::fromTimer(*m_timer, m_statusItem->reduceMotion()), monochrome));
}

}
