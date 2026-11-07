#include "statusmenu.h"

#include "connection.h"
#include "pomodorosession.h"
#include "statuswords.h"
#include "timercontroller.h"

#include <QAction>
#include <QMenu>

namespace Tokkl
{

StatusMenu::StatusMenu(TimerController *timer, PomodoroSession *session, QObject *parent)
    : QObject(parent)
    , m_timer(timer)
    , m_session(session)
    , m_menu(std::make_unique<QMenu>())
{
    m_stateAction = m_menu->addAction(QString());
    m_stateAction->setEnabled(false);

    // The session's message, such as a pomodoro too short to save.
    m_messageAction = m_menu->addAction(QString());
    m_messageAction->setEnabled(false);

    m_startStopAction = m_menu->addAction(QString());
    connect(m_startStopAction, &QAction::triggered, this, [this] {
        if (!m_timer) {
            return;
        }
        if (m_timer->isRunning() || m_timer->isPaused()) {
            m_timer->stop();
        } else {
            m_timer->start();
        }
    });

    m_startSessionAction = m_menu->addAction(tr("Start session"));
    connect(m_startSessionAction, &QAction::triggered, this, [this] {
        if (m_session) {
            m_session->startSession();
        }
    });

    m_nextPhaseAction = m_menu->addAction(QString());
    connect(m_nextPhaseAction, &QAction::triggered, this, [this] {
        if (m_session) {
            m_session->confirmNextPhase();
        }
    });

    m_endSessionAction = m_menu->addAction(tr("End session"));
    connect(m_endSessionAction, &QAction::triggered, this, [this] {
        if (m_session) {
            m_session->endSession();
        }
    });

    m_pomodoroModeAction = m_menu->addAction(QString());
    m_pomodoroModeAction->setCheckable(true);
    connect(m_pomodoroModeAction, &QAction::triggered, this, [this] {
        if (m_session) {
            m_session->setPomodoroMode(!m_session->pomodoroMode());
        }
        refresh();
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
                            &TimerController::chainChanged,
                            &TimerController::sessionActiveChanged,
                            &TimerController::projectsChanged,
                            &TimerController::selectionChanged,
                            &TimerController::choiceChanged,
                            &TimerController::entryProjectChanged}) {
            connect(m_timer, signal, this, &StatusMenu::refresh);
        }
        connect(m_timer, &TimerController::connectionChanged, this, &StatusMenu::watchConnection);
        watchConnection();
    }
    if (m_session) {
        connect(m_session, &PomodoroSession::countdownChanged, this, &StatusMenu::refreshState);
        for (auto signal : {&PomodoroSession::modeChanged,
                            &PomodoroSession::modeLockedChanged,
                            &PomodoroSession::sessionChanged,
                            &PomodoroSession::canStartSessionChanged,
                            &PomodoroSession::messageChanged}) {
            connect(m_session, signal, this, &StatusMenu::refresh);
        }
    }
    refresh();
}

StatusMenu::~StatusMenu() = default;

QMenu *StatusMenu::menu() const
{
    return m_menu.get();
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

bool StatusMenu::sessionActive() const
{
    return (m_session && m_session->isActive()) || (m_timer && m_timer->isSessionActive());
}

bool StatusMenu::pomodoroIdle() const
{
    return m_session && m_session->pomodoroMode() && !(m_timer && (m_timer->isRunning() || m_timer->isPaused()));
}

void StatusMenu::refreshState()
{
    if (!m_timer) {
        return;
    }
    const QString detail = StatusWords::detailText(*m_timer);
    if (m_session && StatusWords::showsSession(*m_timer, *m_session)) {
        m_stateAction->setText(StatusWords::sessionLine(*m_timer, *m_session));
    } else {
        m_stateAction->setText(tr("%1 %2 · %3").arg(StatusWords::runText(*m_timer), m_timer->elapsedText(), StatusWords::statusText(m_timer->status())));
    }
    m_stateAction->setToolTip(detail);
}

void StatusMenu::refreshSession()
{
    const bool active = m_session && m_session->isActive();
    m_startSessionAction->setVisible(pomodoroIdle() && !sessionActive());
    m_startSessionAction->setEnabled(m_session && m_session->canStartSession());
    m_nextPhaseAction->setVisible(active);
    m_nextPhaseAction->setText(tr("Next phase: %1").arg(StatusWords::phaseName(m_session ? m_session->nextPhase() : QString())));
    m_endSessionAction->setVisible(active);

    const bool locked = m_session && m_session->modeLocked();
    m_pomodoroModeAction->setText(locked ? tr("Pomodoro mode (locked while running)") : tr("Pomodoro mode"));
    m_pomodoroModeAction->setEnabled(m_session && !locked);
    m_pomodoroModeAction->setChecked(m_session && m_session->pomodoroMode());

    const QString message = m_session ? m_session->message() : QString();
    m_messageAction->setText(message);
    m_messageAction->setVisible(!message.isEmpty());
}

void StatusMenu::refresh()
{
    if (!m_timer) {
        return;
    }
    refreshState();

    const bool paused = m_timer->isPaused();
    if (m_timer->isRunning() || paused) {
        m_startStopAction->setText(tr("Stop Timer"));
        // Stopping a paused chain discards it on the server, so it needs a
        // connection like any other write.
        m_startStopAction->setEnabled(m_timer->canWrite());
    } else {
        m_startStopAction->setText(tr("Start Timer"));
        // Pomodoro mode starts no timer, and a session, started here or on
        // another device, holds the timer.
        m_startStopAction->setEnabled(m_timer->canWrite() && !pomodoroIdle() && !sessionActive());
    }
    m_startStopAction->setVisible(!pomodoroIdle() && !sessionActive());
    refreshSession();

    m_billableAction->setEnabled(m_timer->canWrite() && !paused);
    m_billableAction->setChecked(m_timer->chosenBillable());

    m_reconnectAction->setEnabled(m_timer->status() != TimerController::Unconfigured);
    const Connection *connection = m_timer->connection();
    m_openAction->setEnabled(connection && !connection->webUrl().isEmpty());

    rebuildProjects();
}

void StatusMenu::rebuildProjects()
{
    const ProjectChoices choices = m_timer->projectChoices();
    m_projectMenu->setTitle(tr("Project: %1").arg(StatusWords::projectText(*m_timer)));
    m_projectMenu->menuAction()->setEnabled(choices.choosable);
    if (m_projectItems == choices) {
        return;
    }
    m_projectItems = choices;
    fillProjectMenu(choices);
}

void StatusMenu::fillProjectMenu(const ProjectChoices &choices)
{
    // Later, not now: this may run inside the triggered signal of one of
    // these actions.
    const QList<QAction *> old = m_projectMenu->actions();
    for (QAction *action : old) {
        m_projectMenu->removeAction(action);
        action->deleteLater();
    }

    addProjectChoice(tr("No project"), QVariant::fromValue(nullptr), choices.noProjectChecked, choices.choosable);

    for (const ProjectChoices::Row &row : choices.rows) {
        switch (row.kind) {
        case ProjectChoices::Row::Kind::Archived: {
            // Shown and checked, never offered for new work.
            QAction *archivedAction = m_projectMenu->addAction(StatusWords::projectLabel(row.project.toVariantMap()));
            archivedAction->setCheckable(true);
            archivedAction->setChecked(row.checked);
            archivedAction->setEnabled(false);
            break;
        }
        case ProjectChoices::Row::Kind::Incomplete: {
            // The projects read are fewer than the workspace has: say so and
            // point to the web app.
            QAction *cut = m_projectMenu->addAction(tr("Project list cut short. Use Open Tokkl for the others."));
            cut->setEnabled(false);
            break;
        }
        case ProjectChoices::Row::Kind::Project:
            addProjectChoice(StatusWords::projectLabel(row.project.toVariantMap()), row.project.id, row.checked, row.enabled)->setData(row.project.id);
            break;
        }
    }
}

QAction *StatusMenu::addProjectChoice(const QString &label, const QVariant &projectId, bool checked, bool enabled)
{
    QAction *action = m_projectMenu->addAction(label);
    action->setCheckable(true);
    action->setChecked(checked);
    action->setEnabled(enabled);
    connect(action, &QAction::triggered, this, [this, projectId] {
        if (m_timer) {
            m_timer->chooseProject(projectId);
        }
        // The action checked itself; a refused choice must not leave it so.
        m_projectItems.reset();
        refresh();
    });
    return action;
}

}
