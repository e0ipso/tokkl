#pragma once

#include "menuactions.h"
#include "projectchoices.h"

#include <QObject>
#include <QPointer>
#include <QUrl>

#include <QVariant>

#include <memory>
#include <optional>

class QAction;
class QMenu;
class MenuBarAppTest;

namespace Tokkl
{

class PomodoroAlarm;
class PomodoroSession;
class TimerCoordinator;
class TimerModel;

// The menu of the menu bar item: state, the session's message, Start Timer or
// Stop Timer, Start session, Next phase, End session, Pomodoro mode, Project,
// Billable, Reconnect, Open Tokkl, Settings and Quit. Which timer and session
// actions show and can be chosen comes from the core's MenuActionStates, with
// the macOS policy.
//
// The timer and the session are the server's, so a timer or session started
// on another device shows here too. Start Timer starts a new entry while the
// timer is stopped. Stop Timer, while an entry runs or a chain is paused, ends
// the chain; stopping a paused chain discards it on the server, so it needs a
// connection. The click on the item pauses and resumes. Both show only in
// Timer mode or while a timer runs or is paused, and never while a session is
// active, so Pomodoro mode and a session started elsewhere leave no timer to
// start.
//
// Next phase and End session show whenever a session is active, in either
// mode, and the state line then names the phase. The line under it shows the
// session's message when there is one, such as a pomodoro too short to save
// or why an action failed, and otherwise why the last alarm sound did not
// play. Start session shows in Pomodoro mode while no
// session is active and no timer runs or is paused, and is disabled until a
// state has been read and while an action is unsettled. Pomodoro mode is
// locked while a timer runs or is paused, or a session is active.
//
// Project sets only the project of the next start and is locked while an
// entry runs or a chain is paused: changing it means stopping and starting a
// new entry. Billable sets the next start too and, while an entry runs, edits
// that entry in place; while paused it is locked. During a session both set the
// next start only, as the session's pomodoro keeps the choice it started
// with. Both are disabled whenever the
// timer cannot write, so nothing is queued for another account. The check
// marks always show the controller's choice, not the click.
class StatusMenu : public QObject
{
    Q_OBJECT

public:
    // Shows timer and acts through actions; none of them is owned. The
    // alarm, when there is one, gives the message of a sound that did not
    // play.
    StatusMenu(TimerModel *timer, TimerCoordinator *actions, PomodoroSession *session, PomodoroAlarm *alarm = nullptr, QObject *parent = nullptr);
    ~StatusMenu() override;

    QMenu *menu() const;

Q_SIGNALS:
    void openRequested(const QUrl &url);
    void settingsRequested();
    void quitRequested();

private:
    // The app's tests trigger and read the actions.
    friend class ::MenuBarAppTest;

    void rebuildProjects(const MenuActionStates &actions);
    void fillProjectMenu(const ProjectChoices &choices);
    // A checkable item that chooses projectId, null for no project.
    QAction *addProjectChoice(const QString &label, const QVariant &projectId, bool checked, bool enabled);
    void refresh();
    void refreshState();
    void refreshSession(const MenuActionStates &actions);
    void onGenerationChanged();
    void watchConnection();
    // The core's rules for which actions show and can be chosen, with the
    // macOS policy.
    MenuActionStates actions() const;
    static void show(QAction *action, const ActionState &state);

    QPointer<TimerModel> m_timer;
    QPointer<TimerCoordinator> m_actions;
    QPointer<PomodoroSession> m_session;
    QPointer<PomodoroAlarm> m_alarm;
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
    QMetaObject::Connection m_generationWatch;
    // What the project items show. They are rebuilt only when it changes,
    // not on every refresh.
    std::optional<ProjectChoices> m_projectItems;
};

}
