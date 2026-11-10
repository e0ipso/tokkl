#pragma once

#include "menuactions.h"
#include "projectchoices.h"

#include <QObject>
#include <QUrl>

#include <QVariant>

#include <memory>
#include <optional>

class QAction;
class QMenu;

namespace Tokkl
{

class PomodoroAlarm;
class PomodoroSession;
class TimerController;

// Actions come from the core's MenuActionStates with the macOS policy. Check
// marks show the controller's choice, not the click.
class StatusMenu : public QObject
{
    Q_OBJECT

public:
    // Owns none of the parts.
    StatusMenu(TimerController &timer, PomodoroSession &session, PomodoroAlarm &alarm, QObject *parent = nullptr);
    ~StatusMenu() override;

    QMenu *menu() const;

Q_SIGNALS:
    void openRequested(const QUrl &url);
    void settingsRequested();
    void quitRequested();

private:
    void rebuildProjects(const MenuActionStates &actions);
    void fillProjectMenu(const ProjectChoices &choices);
    // A null projectId means no project.
    QAction *addProjectChoice(const QString &label, const QVariant &projectId, bool checked, bool enabled);
    void refresh();
    void refreshState();
    void refreshSession(const MenuActionStates &actions);
    void onGenerationChanged();
    MenuActionStates actions() const;
    static void show(QAction *action, const ActionState &state);

    TimerController &m_timer;
    PomodoroSession &m_session;
    PomodoroAlarm &m_alarm;
    std::unique_ptr<QMenu> m_menu;
    QMenu *m_projectMenu = nullptr;
    QAction *m_stateAction = nullptr;
    QAction *m_messageAction = nullptr;
    QAction *m_startStopAction = nullptr;
    QAction *m_startSessionAction = nullptr;
    QAction *m_nextPhaseAction = nullptr;
    QAction *m_endSessionAction = nullptr;
    QAction *m_pomodoroModeAction = nullptr;
    QAction *m_billableAction = nullptr;
    QAction *m_reconnectAction = nullptr;
    QAction *m_openAction = nullptr;
    QAction *m_settingsAction = nullptr;
    QAction *m_quitAction = nullptr;
    // The project items are rebuilt only when this changes.
    std::optional<ProjectChoices> m_projectItems;
};

}
