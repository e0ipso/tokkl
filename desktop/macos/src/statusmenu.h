#pragma once

#include <QObject>
#include <QPointer>
#include <QUrl>

#include <memory>

class QAction;
class QMenu;

namespace Tokkl
{

class PomodoroSession;
class TimerController;

// The menu of the menu bar item: state, the session's message, Start Timer or
// Stop Timer, Start session, Next phase, End session, Pomodoro mode, Project,
// Billable, Reconnect, Open Tokkl, Settings and Quit.
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
// or why an action failed. Start session shows in Pomodoro mode while no
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
    // Uses the timer and the session, which it does not own.
    StatusMenu(TimerController *timer, PomodoroSession *session, QObject *parent = nullptr);
    ~StatusMenu() override;

    QMenu *menu() const;
    QMenu *projectMenu() const;
    QAction *stateAction() const;
    QAction *messageAction() const;
    QAction *startStopAction() const;
    QAction *startSessionAction() const;
    QAction *nextPhaseAction() const;
    QAction *endSessionAction() const;
    QAction *pomodoroModeAction() const;
    QAction *billableAction() const;
    QAction *reconnectAction() const;
    QAction *openAction() const;
    QAction *settingsAction() const;
    QAction *quitAction() const;

Q_SIGNALS:
    void openRequested(const QUrl &url);
    void settingsRequested();
    void quitRequested();

private:
    void rebuildProjects();
    void refresh();
    void refreshState();
    void refreshSession();
    void onGenerationChanged();
    void watchConnection();
    // A session is active, started on any device.
    bool sessionActive() const;
    // Pomodoro mode is on and no timer runs or is paused.
    bool pomodoroIdle() const;

    QPointer<TimerController> m_timer;
    QPointer<PomodoroSession> m_session;
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
};

}
