#include "statusmenu.h"

#include "connection.h"
#include "statuswords.h"
#include "timercontroller.h"

#include <QAction>
#include <QMenu>

namespace Tokkl
{

namespace
{
bool isNullId(const QVariant &id)
{
    return !id.isValid() || id.isNull();
}
}

StatusMenu::StatusMenu(TimerController *timer, QObject *parent)
    : QObject(parent)
    , m_timer(timer)
    , m_menu(std::make_unique<QMenu>())
{
    m_stateAction = m_menu->addAction(QString());
    m_stateAction->setEnabled(false);

    m_toggleAction = m_menu->addAction(QString());
    connect(m_toggleAction, &QAction::triggered, this, [this] {
        if (m_timer) {
            m_timer->toggle();
        }
    });

    m_menu->addSeparator();

    m_projectMenu = m_menu->addMenu(QString());

    m_billableAction = m_menu->addAction(tr("Billable"));
    m_billableAction->setCheckable(true);
    connect(m_billableAction, &QAction::triggered, this, [this] {
        if (m_timer) {
            m_timer->chooseBillable(!m_timer->chosenBillable());
        }
        refresh();
    });

    m_menu->addSeparator();

    m_reconnectAction = m_menu->addAction(tr("Reconnect"));
    connect(m_reconnectAction, &QAction::triggered, this, [this] {
        if (m_timer) {
            m_timer->reconnect();
        }
    });

    m_openAction = m_menu->addAction(tr("Open Tokkl"));
    connect(m_openAction, &QAction::triggered, this, [this] {
        // The configured base URL only: it never holds credentials.
        if (m_timer && m_timer->connection() && m_timer->connection()->webUrl().isValid()) {
            Q_EMIT openRequested(m_timer->connection()->webUrl());
        }
    });

    m_settingsAction = m_menu->addAction(tr("Settings…"));
    m_settingsAction->setMenuRole(QAction::PreferencesRole);
    connect(m_settingsAction, &QAction::triggered, this, &StatusMenu::settingsRequested);

    m_menu->addSeparator();

    m_quitAction = m_menu->addAction(tr("Quit Tokkl"));
    m_quitAction->setMenuRole(QAction::QuitRole);
    connect(m_quitAction, &QAction::triggered, this, &StatusMenu::quitRequested);

    if (m_timer) {
        connect(m_timer, &TimerController::elapsedChanged, this, &StatusMenu::refreshState);
        for (auto signal : {&TimerController::statusChanged,
                            &TimerController::currentEntryChanged,
                            &TimerController::projectsChanged,
                            &TimerController::selectionChanged,
                            &TimerController::choiceChanged,
                            &TimerController::entryProjectChanged}) {
            connect(m_timer, signal, this, &StatusMenu::refresh);
        }
        connect(m_timer, &TimerController::connectionChanged, this, &StatusMenu::watchConnection);
        watchConnection();
    }
    refresh();
}

StatusMenu::~StatusMenu() = default;

QMenu *StatusMenu::menu() const
{
    return m_menu.get();
}

QMenu *StatusMenu::projectMenu() const
{
    return m_projectMenu;
}

QAction *StatusMenu::stateAction() const
{
    return m_stateAction;
}

QAction *StatusMenu::toggleAction() const
{
    return m_toggleAction;
}

QAction *StatusMenu::billableAction() const
{
    return m_billableAction;
}

QAction *StatusMenu::reconnectAction() const
{
    return m_reconnectAction;
}

QAction *StatusMenu::openAction() const
{
    return m_openAction;
}

QAction *StatusMenu::settingsAction() const
{
    return m_settingsAction;
}

QAction *StatusMenu::quitAction() const
{
    return m_quitAction;
}

void StatusMenu::watchConnection()
{
    disconnect(m_generationWatch);
    if (m_timer && m_timer->connection()) {
        m_generationWatch = connect(m_timer->connection(), &Connection::generationChanged, this, &StatusMenu::onGenerationChanged);
    }
    refresh();
}

// Another instance, account or secret: close, so no choice made for the
// previous context can be triggered.
void StatusMenu::onGenerationChanged()
{
    m_menu->hide();
    refresh();
}

void StatusMenu::refreshState()
{
    if (!m_timer) {
        return;
    }
    const QString detail = StatusWords::detailText(*m_timer);
    m_stateAction->setText(tr("%1 %2 · %3").arg(StatusWords::runText(m_timer->isRunning()), m_timer->elapsedText(), StatusWords::statusText(m_timer->status())));
    m_stateAction->setToolTip(detail);
}

void StatusMenu::refresh()
{
    if (!m_timer) {
        return;
    }
    refreshState();

    const bool running = m_timer->isRunning();
    m_toggleAction->setText(running ? tr("Stop Timer") : tr("Start Timer"));
    m_toggleAction->setEnabled(m_timer->canWrite());

    m_billableAction->setEnabled(m_timer->canWrite());
    m_billableAction->setChecked(m_timer->chosenBillable());

    m_reconnectAction->setEnabled(m_timer->status() != TimerController::Unconfigured);
    const Connection *connection = m_timer->connection();
    m_openAction->setEnabled(connection && !connection->webUrl().isEmpty());

    rebuildProjects();
}

void StatusMenu::rebuildProjects()
{
    // A choice is possible: the timer can write and nothing runs.
    const bool choosable = m_timer->canWrite() && !m_timer->isRunning();
    const QVariant chosen = m_timer->chosenProjectId();

    m_projectMenu->setTitle(tr("Project: %1").arg(StatusWords::projectText(*m_timer)));
    m_projectMenu->menuAction()->setEnabled(choosable);
    // Later, not now: this may run inside the triggered signal of one of
    // these actions.
    const QList<QAction *> old = m_projectMenu->actions();
    for (QAction *action : old) {
        m_projectMenu->removeAction(action);
        action->deleteLater();
    }

    QAction *none = m_projectMenu->addAction(tr("No project"));
    none->setCheckable(true);
    none->setChecked(isNullId(chosen));
    none->setEnabled(choosable);
    connect(none, &QAction::triggered, this, [this] {
        if (m_timer) {
            m_timer->chooseProject(QVariant::fromValue(nullptr));
        }
        refresh();
    });

    // The current entry's archived project: shown and checked, never offered
    // for new work.
    const QVariantMap entryProject = m_timer->entryProjectVariant().toMap();
    if (m_timer->isRunning() && !entryProject.isEmpty() && !entryProject.value(QStringLiteral("active")).toBool()) {
        QAction *archived = m_projectMenu->addAction(StatusWords::projectLabel(entryProject));
        archived->setCheckable(true);
        archived->setChecked(true);
        archived->setEnabled(false);
    }

    // The projects read are fewer than the workspace has: say so and point
    // to the web app. Placed before the projects so a long list does not
    // bury it.
    if (m_timer->projectsIncomplete()) {
        QAction *cut = m_projectMenu->addAction(tr("Project list cut short. Use Open Tokkl for the others."));
        cut->setEnabled(false);
    }

    const QVariantList projects = m_timer->projects();
    for (const QVariant &value : projects) {
        const QVariantMap project = value.toMap();
        const qint64 id = project.value(QStringLiteral("id")).toLongLong();
        QAction *action = m_projectMenu->addAction(StatusWords::projectLabel(project));
        action->setCheckable(true);
        action->setChecked(!isNullId(chosen) && chosen.toLongLong() == id);
        action->setEnabled(choosable);
        action->setData(id);
        connect(action, &QAction::triggered, this, [this, id] {
            if (m_timer) {
                m_timer->chooseProject(id);
            }
            refresh();
        });
    }
}

}
