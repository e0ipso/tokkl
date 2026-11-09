#include "statusmenu.h"

#include "connection.h"
#include "menuactions.h"
#include "pomodoroalarm.h"
#include "pomodorosession.h"
#include "statuswords.h"
#include "timercontroller.h"

#include <QAction>
#include <QMenu>

namespace Tokkl
{

StatusMenu::StatusMenu(TimerController *timer, PomodoroSession *session, PomodoroAlarm *alarm, QObject *parent)
    : QObject(parent)
    , m_timer(timer)
    , m_session(session)
    , m_alarm(alarm)
    , m_menu(std::make_unique<QMenu>())
{
    // The projects have no stream: each opening asks the core to check
    // them, so a project renamed or deleted elsewhere does not stay listed.
    connect(m_menu.get(), &QMenu::aboutToShow, this, [this] {
        if (m_timer) {
            m_timer->refreshProjects();
        }
    });

    m_stateAction = m_menu->addAction(QString());
    m_stateAction->setEnabled(false);

    // The session's message, such as a pomodoro too short to save, or why
    // the alarm was silent.
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
        if (m_timer && m_timer->connection()->webUrl().isValid()) {
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

    // Stable names, so automation finds each item whatever its text.
    m_projectMenu->setObjectName(QStringLiteral("project"));
    const std::pair<QAction *, QString> named[] = {
        {m_stateAction, QStringLiteral("state")},
        {m_messageAction, QStringLiteral("message")},
        {m_startStopAction, QStringLiteral("startStop")},
        {m_startSessionAction, QStringLiteral("startSession")},
        {m_nextPhaseAction, QStringLiteral("nextPhase")},
        {m_endSessionAction, QStringLiteral("endSession")},
        {m_pomodoroModeAction, QStringLiteral("pomodoroMode")},
        {m_billableAction, QStringLiteral("billable")},
        {m_reconnectAction, QStringLiteral("reconnect")},
        {m_openAction, QStringLiteral("open")},
        {m_settingsAction, QStringLiteral("settings")},
        {m_quitAction, QStringLiteral("quit")},
    };
    for (const auto &[action, name] : named) {
        action->setObjectName(name);
    }

    if (m_timer) {
        connect(m_timer, &TimerModel::elapsedChanged, this, &StatusMenu::refreshState);
        for (auto signal : {&TimerModel::statusChanged,
                            &TimerModel::currentEntryChanged,
                            &TimerModel::chainChanged,
                            &TimerModel::sessionActiveChanged,
                            &TimerModel::projectsChanged,
                            &TimerModel::selectionChanged,
                            &TimerModel::choiceChanged,
                            &TimerModel::entryProjectChanged}) {
            connect(m_timer, signal, this, &StatusMenu::refresh);
        }
        connect(m_timer->connection(), &Connection::generationChanged, this, &StatusMenu::onGenerationChanged);
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
    if (m_alarm) {
        connect(m_alarm, &PomodoroAlarm::failureChanged, this, &StatusMenu::refresh);
    }
    refresh();
}

StatusMenu::~StatusMenu() = default;

QMenu *StatusMenu::menu() const
{
    return m_menu.get();
}

// Another instance, account or secret: close, so no choice made for the
// previous context can be triggered.
void StatusMenu::onGenerationChanged()
{
    m_menu->hide();
    refresh();
}

MenuActionStates StatusMenu::actions() const
{
    return MenuActionStates::of(*m_timer, m_session);
}

void StatusMenu::refreshState()
{
    if (!m_timer) {
        return;
    }
    if (m_session) {
        m_stateAction->setText(StatusWords::menuLine(*m_timer, *m_session));
    } else {
        m_stateAction->setText(tr("%1 %2 · %3").arg(StatusWords::runText(*m_timer), m_timer->elapsedText(), StatusWords::statusText(m_timer->status())));
    }
    m_stateAction->setToolTip(StatusWords::detailText(*m_timer));
}

void StatusMenu::refreshSession(const MenuActionStates &actions)
{
    show(m_startSessionAction, actions.startSession);
    show(m_nextPhaseAction, actions.nextPhase);
    m_nextPhaseAction->setText(tr("Next phase: %1").arg(StatusWords::phaseName(actions.nextPhase.label)));
    show(m_endSessionAction, actions.endSession);

    m_pomodoroModeAction->setText(actions.mode.label == QLatin1String("pomodoroModeLocked") ? tr("Pomodoro mode (locked while running)") : tr("Pomodoro mode"));
    m_pomodoroModeAction->setEnabled(actions.mode.enabled);
    m_pomodoroModeAction->setChecked(m_session && m_session->pomodoroMode());

    QString message = m_session ? m_session->message() : QString();
    if (message.isEmpty() && m_alarm) {
        message = m_alarm->failure();
    }
    m_messageAction->setText(message);
    m_messageAction->setVisible(!message.isEmpty());
}

void StatusMenu::show(QAction *action, const ActionState &state)
{
    action->setVisible(state.visible);
    action->setEnabled(state.enabled);
}

void StatusMenu::refresh()
{
    if (!m_timer) {
        return;
    }
    refreshState();

    const MenuActionStates actions = this->actions();
    m_startStopAction->setText(actions.run.label == QLatin1String("stop") ? tr("Stop Timer") : tr("Start Timer"));
    show(m_startStopAction, actions.run);
    refreshSession(actions);

    m_billableAction->setEnabled(actions.billable.enabled);
    m_billableAction->setChecked(m_timer->chosenBillable());

    m_reconnectAction->setEnabled(m_timer->status() != TimerModel::Unconfigured);
    const Connection *connection = m_timer->connection();
    m_openAction->setEnabled(connection && !connection->webUrl().isEmpty());

    rebuildProjects(actions);
}

void StatusMenu::rebuildProjects(const MenuActionStates &actions)
{
    const ProjectChoices choices = m_timer->projectChoices();
    m_projectMenu->setTitle(tr("Project: %1").arg(StatusWords::projectText(*m_timer)));
    m_projectMenu->menuAction()->setEnabled(actions.project.enabled);
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
            QAction *archivedAction = m_projectMenu->addAction(StatusWords::projectLabel(ProjectLabelParts::of(row.project)));
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
            addProjectChoice(StatusWords::projectLabel(ProjectLabelParts::of(row.project)), row.project.id, row.checked, row.enabled)->setData(row.project.id);
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
